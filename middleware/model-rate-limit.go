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
	"github.com/QuantumNous/new-api/i18n"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// rateLimitParams 是一次模型请求限速实际生效的参数。
type rateLimitParams struct {
	duration        int64
	totalMaxCount   int
	successMaxCount int
	// scope 非空表示按分组隔离计数。
	scope string
}

// Redis限流处理器。scope 非空表示该分组配置了独立限速，
// 计数 key 按分组隔离，避免与其他分组的调用互相挤占额度。
func redisRateLimitHandler(p rateLimitParams, userId string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := context.Background()
		rdb := common.RDB

		totalKey, successKey := service.ModelRateLimitRedisKeys(p.scope, userId)

		// 1. 检查成功请求数限制
		allowed, err := service.CheckRedisRateLimit(ctx, rdb, successKey, p.successMaxCount, p.duration)
		if err != nil {
			fmt.Println(common.LogText("failed to check the successful request limit: %s", err.Error()))
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
			return
		}
		if !allowed {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": p.successMaxCount}))
			return
		}

		//2.检查总请求数限制并记录总请求（当totalMaxCount为0时会自动跳过，使用令牌桶限流器
		if p.totalMaxCount > 0 {
			// 初始化
			tb := limiter.New(ctx, rdb)
			allowed, err = tb.Allow(
				ctx,
				totalKey,
				limiter.WithCapacity(rateLimitCapacity(p.totalMaxCount, p.duration)),
				limiter.WithRate(int64(p.totalMaxCount)),
				limiter.WithRequested(p.duration),
			)

			if err != nil {
				fmt.Println(common.LogText("failed to check the total request limit: %s", err.Error()))
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}

			if !allowed {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitTotalReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": p.totalMaxCount}))
				return
			}
		}

		// 4. 处理请求
		c.Next()

		// 5. 如果请求成功，记录成功请求
		if modelRequestSucceeded(c) {
			service.RecordRedisRequest(ctx, rdb, successKey, p.successMaxCount)
		}
	}
}

// 内存限流处理器。成功数限制用预留（Reserve）占位：失败的请求释放名额，
// 不占成功额度；与 Redis 路径语义一致。
func memoryRateLimitHandler(p rateLimitParams, userId string) gin.HandlerFunc {
	common.SharedInMemoryRateLimiter.Init(time.Duration(setting.ModelRequestRateLimitDurationMinutes) * time.Minute)

	return func(c *gin.Context) {
		totalKey, successKey := service.ModelRateLimitMemoryKeys(p.scope, userId)

		// 1. 检查总请求数限制（当totalMaxCount为0时跳过）
		if p.totalMaxCount > 0 && !common.SharedInMemoryRateLimiter.Request(totalKey, p.totalMaxCount, p.duration) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitTotalReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": p.totalMaxCount}))
			return
		}

		// 2. 成功请求数限制：预留名额，请求结束时按结果记账或释放
		var reservation *common.RateLimitReservation
		if p.successMaxCount > 0 {
			reservation = common.SharedInMemoryRateLimiter.Reserve(successKey, p.successMaxCount, p.duration)
			if reservation == nil {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": p.successMaxCount}))
				return
			}
			defer reservation.Complete(false)
		}

		// 3. 处理请求
		c.Next()

		// 4. 如果请求成功，记入成功请求计数
		reservation.Complete(modelRequestSucceeded(c))
	}
}

// modelRequestSucceeded 判定一次请求是否成功：HTTP 状态码之外，
// 流式响应中途失败（状态 200 但流内报错）也视为失败，不占成功额度。
func modelRequestSucceeded(c *gin.Context) bool {
	status, _ := common.GetContextKeyType[*relaycommon.StreamStatus](c, constant.ContextKeyResponseStreamStatus)
	return c.Writer.Status() < 400 && !status.ResponseFailed()
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

		userId := strconv.Itoa(c.GetInt("id"))

		// 计数隔离范围：仅对配置了独立限速的分组按分组记账，
		// 未配置的分组继续共享官方原始计数 key（历史行为不变）。
		scope := ""

		// auto 分组的解析发生在渠道选择阶段，此处跳过分组级预检，
		// 否则查 map 只会得到 "auto" 这个 key，永远无法命中分组配置。
		if group != "auto" {
			if groupTotalCount, groupSuccessCount, found := setting.GetGroupRateLimit(group); found {
				totalMaxCount = groupTotalCount
				successMaxCount = groupSuccessCount
				scope = group
			}
		}

		// 根据存储类型选择并执行限流处理器
		params := rateLimitParams{
			duration:        duration,
			totalMaxCount:   totalMaxCount,
			successMaxCount: successMaxCount,
			scope:           scope,
		}
		if common.RedisEnabled {
			redisRateLimitHandler(params, userId)(c)
		} else {
			memoryRateLimitHandler(params, userId)(c)
		}

		// auto 令牌：请求结束后按实际落地的分组补记分组级成功数。
		// 落地分组未配置分组级限速时不记账；请求失败也不记账。
		if group == "auto" && modelRequestSucceeded(c) {
			if resolvedGroup := common.GetContextKeyString(c, constant.ContextKeyAutoGroup); resolvedGroup != "" {
				service.RecordGroupRateLimitSuccess(c.GetInt("id"), resolvedGroup)
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
