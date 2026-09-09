package middleware

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/limiter"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// Redis限流处理器。scope 非空表示该分组配置了独立限速（分组限速或余额分档），
// 计数 key 按分组隔离，避免与其他分组的调用互相挤占额度。
func redisRateLimitHandler(duration int64, totalMaxCount, successMaxCount int, scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		ctx := context.Background()
		rdb := common.RDB

		totalKey, successKey := service.ModelRateLimitRedisKeys(scope, userId)

		// 1. 检查成功请求数限制
		allowed, err := service.CheckRedisRateLimit(ctx, rdb, successKey, successMaxCount, duration)
		if err != nil {
			fmt.Println("检查成功请求数限制失败:", err.Error())
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
			return
		}
		if !allowed {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, fmt.Sprintf("您已达到请求数限制：%d分钟内最多请求%d次", setting.ModelRequestRateLimitDurationMinutes, successMaxCount))
			return
		}

		//2.检查总请求数限制并记录总请求（当totalMaxCount为0时会自动跳过，使用令牌桶限流器
		if totalMaxCount > 0 {
			// 初始化
			tb := limiter.New(ctx, rdb)
			allowed, err = tb.Allow(
				ctx,
				totalKey,
				limiter.WithCapacity(rateLimitCapacity(totalMaxCount, duration)),
				limiter.WithRate(int64(totalMaxCount)),
				limiter.WithRequested(duration),
			)

			if err != nil {
				fmt.Println("检查总请求数限制失败:", err.Error())
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}

			if !allowed {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, fmt.Sprintf("您已达到总请求数限制：%d分钟内最多请求%d次，包括失败次数，请检查您的请求是否正确", setting.ModelRequestRateLimitDurationMinutes, totalMaxCount))
			}
		}

		// 4. 处理请求
		c.Next()

		// 5. 如果请求成功，记录成功请求
		if c.Writer.Status() < 400 {
			service.RecordRedisRequest(ctx, rdb, successKey, successMaxCount)
		}
	}
}

// 内存限流处理器。成功数限制使用只读预检（Check），请求成功后再实际记账，
// 与 Redis 路径语义一致：失败的请求不占成功额度。
func memoryRateLimitHandler(duration int64, totalMaxCount, successMaxCount int, scope string) gin.HandlerFunc {
	common.SharedInMemoryRateLimiter.Init(time.Duration(setting.ModelRequestRateLimitDurationMinutes) * time.Minute)

	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		totalKey, successKey := service.ModelRateLimitMemoryKeys(scope, userId)

		// 1. 检查总请求数限制（当totalMaxCount为0时跳过）
		if totalMaxCount > 0 && !common.SharedInMemoryRateLimiter.Request(totalKey, totalMaxCount, duration) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, fmt.Sprintf("您已达到总请求数限制：%d分钟内最多请求%d次，包括失败次数，请检查您的请求是否正确", setting.ModelRequestRateLimitDurationMinutes, totalMaxCount))
			return
		}

		// 2. 只读检查成功请求数限制，请求成功后在第 4 步实际记账
		if !common.SharedInMemoryRateLimiter.Check(successKey, successMaxCount, duration) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, fmt.Sprintf("您已达到请求数限制：%d分钟内最多请求%d次", setting.ModelRequestRateLimitDurationMinutes, successMaxCount))
			return
		}

		// 3. 处理请求
		c.Next()

		// 4. 如果请求成功，记录到成功请求计数中
		if c.Writer.Status() < 400 && successMaxCount > 0 {
			common.SharedInMemoryRateLimiter.Request(successKey, successMaxCount, duration)
		}
	}
}

// ModelRequestRateLimit 模型请求限流中间件。
// 非 auto 令牌：入口处按分组做余额分档/分组限速预检（历史行为）。
// auto 令牌：分组在渠道选择时才解析，分组级限流推迟到分组解析处执行
// （service.CheckGroupRateLimit），此处只保留全局限流；请求成功后按
// 实际落地的分组补记成功数（service.RecordGroupRateLimitSuccess）。
func ModelRequestRateLimit() func(c *gin.Context) {
	return func(c *gin.Context) {
		// 在每个请求时检查是否启用限流
		if !setting.ModelRequestRateLimitEnabled {
			c.Next()
			return
		}

		// 计算限流参数
		duration := service.RateLimitDurationSeconds(setting.ModelRequestRateLimitDurationMinutes)
		totalMaxCount := setting.ModelRequestRateLimitCount
		successMaxCount := setting.ModelRequestRateLimitSuccessCount

		// 获取分组
		group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		}

		// 计数隔离范围：仅对配置了独立限速的分组按分组记账，
		// 未配置的分组继续共享官方原始计数 key（历史行为不变）。
		scope := ""

		// auto 分组的解析发生在渠道选择阶段，此处跳过分组级预检，
		// 否则查 map 只会得到 "auto" 这个 key，永远无法命中分组配置。
		if group != "auto" {
			// 优先查余额分档：按用户余额选择该分组的限速档位
			userQuota := int64(common.GetContextKeyInt(c, constant.ContextKeyUserQuota))
			state, tierTotal, tierSuccess := setting.GetBalanceRateLimit(group, userQuota)
			if state == setting.BalanceTierBelowMinimum {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, "您的账户余额未达到该分组最低要求，无法使用该分组，请充值或更换其他分组令牌")
				return
			}
			if state == setting.BalanceTierMatched {
				totalMaxCount = tierTotal
				successMaxCount = tierSuccess
				scope = group
			} else {
				// 未配置余额分档时，走分组限速配置
				groupTotalCount, groupSuccessCount, found := setting.GetGroupRateLimit(group)
				if found {
					totalMaxCount = groupTotalCount
					successMaxCount = groupSuccessCount
					scope = group
				}
			}
		}

		// 根据存储类型选择并执行限流处理器
		if common.RedisEnabled {
			redisRateLimitHandler(duration, totalMaxCount, successMaxCount, scope)(c)
		} else {
			memoryRateLimitHandler(duration, totalMaxCount, successMaxCount, scope)(c)
		}

		// auto 令牌：请求结束后按实际落地的分组补记分组级成功数。
		// 落地分组未配置分组级限速时不记账；请求失败也不记账。
		if group == "auto" && c.Writer != nil && c.Writer.Status() < http.StatusBadRequest {
			if resolvedGroup := common.GetContextKeyString(c, constant.ContextKeyAutoGroup); resolvedGroup != "" {
				userQuota := int64(common.GetContextKeyInt(c, constant.ContextKeyUserQuota))
				service.RecordGroupRateLimitSuccess(c.GetInt("id"), resolvedGroup, userQuota)
			}
		}
	}
}

func rateLimitCapacity(count int, durationSeconds int64) int64 {
	if count <= 0 || durationSeconds <= 0 {
		return 0
	}
	c := int64(count)
	if c > math.MaxInt64/durationSeconds {
		return math.MaxInt64
	}
	return c * durationSeconds
}
