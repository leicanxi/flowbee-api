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

// 改造#23：rateLimitParams 是一次模型请求限速实际生效的参数。把「计数」和「文案」
// 所需的上下文打包传递，避免处理器再逐个透传额度来源。
type rateLimitParams struct {
	duration        int64
	totalMaxCount   int
	successMaxCount int
	// scope 非空表示按分组隔离计数（分组限速或余额分档）。
	scope string
	// balanceTier 表示本次额度来自余额分档，即提升余额可以解锁更高档位；
	// atTopTier 表示用户已在最高档，此时文案不能再承诺「提升余额」——
	// 那样等于让用户去充值，而充值并不能解决问题。
	balanceTier bool
	atTopTier   bool
}

// 改造#25：overLimitMessage 生成限流 429 文案。
//
// 余额分档刻意不回显具体次数：这些数字是防刷号闸门，写进错误信息等于把
// 「一分钟只能请求一次」当成产品能力展示。文案改为指向有效动作。
//
// auto 分组是这里主推的动作，因为它零成本且即时生效：线上 AutoGroups 的顺序是
// 「福利 → flowbee专属补贴 → 国模企业补贴 → default → …」，而 service 侧对候选
// 分组逐个过 CheckGroupRateLimit，被限速或余额低于门槛的分组直接跳过、继续试
// 下一个。所以「本分组额度用尽 → 换 auto」确实能落到其他补贴分组上继续调用。
//
// 顶档与非顶档必须分开：顶档之上没有更高档位，再提「提升余额」就是引导白充值。
// 顶档只给「改用 auto」与「稍后重试」两个出口；非顶档两个出口都有意义（auto 免费
// 即时，提升余额解锁更高速率），且把 auto 放前面 —— 不需要花钱的那条先给。
//
// 「（最高档位防刷限速）」这个理由写在文案里是刻意的：429 通常出现在用户的聊天
// 客户端里，而解释这件事的页面（福利页）用户不会去看。只说「已达上限」会被读成
// 「平台在无故卡我」，给出理由才能把摩擦变成一条可接受的规则。
//
// 非余额分档（全局限额、分组固定限速）的额度与余额无关，保留上游原始文案，
// 让用户能据此判断重试节奏。
func overLimitMessage(p rateLimitParams, countedFailures bool) string {
	if p.balanceTier {
		if p.atTopTier {
			return "免费模型调用速率已达上限（最高档位防刷限速）。可改用 auto 分组继续：优先福利分组，限速时自动尝试其他补贴分组；或稍后重试。"
		}
		return "免费模型调用速率已达当前档位上限。可改用 auto 分组继续：优先福利分组，限速时自动尝试其他补贴分组；或提升余额解锁更高速率。"
	}
	if countedFailures {
		return fmt.Sprintf("您已达到总请求数限制：%d分钟内最多请求%d次，包括失败次数，请检查您的请求是否正确", setting.ModelRequestRateLimitDurationMinutes, p.totalMaxCount)
	}
	return fmt.Sprintf("您已达到请求数限制：%d分钟内最多请求%d次", setting.ModelRequestRateLimitDurationMinutes, p.successMaxCount)
}

// 改造#27：belowMinimumMessage 是「余额低于该分组最低档」的 429 文案。
//
// 这是余额不足的用户看到的**第一条**信息（早于任何一次成功调用），比页面上任何
// 常驻说明都更容易被读到，所以「免费模型额度按余额分档」这个概念直接在这里讲清楚，
// 而不是指望用户去看福利页的卡片。
//
// 改造#27 重写了原句：原句把「改用 auto 分组令牌」当成主要出路，但 auto 的选路是
// 服务端内部行为，用户在客户端里既看不到分组、也无从判断它是否真的落到了别的分组
// 上，那条建议读起来更像推卸；而「充值」和「更换分组」是用户手上真正有的两个动作。
// 分组名也不再回显：「该分组」就是用户当前使用的那个分组，指名反而会让只绑了一个
// 分组的用户去怀疑是自己选错了分组。
//
// 不说具体次数：额度是防刷闸门，不是产品能力。
const belowMinimumMessage = "免费模型调用额度按余额分档，你的账户余额未达到该分组最低要求，请充值或更换其他分组。"

// Redis限流处理器。scope 非空表示该分组配置了独立限速（分组限速或余额分档），
// 计数 key 按分组隔离，避免与其他分组的调用互相挤占额度。
func redisRateLimitHandler(p rateLimitParams) gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		ctx := context.Background()
		rdb := common.RDB

		totalKey, successKey := service.ModelRateLimitRedisKeys(p.scope, userId)

		// 1. 检查成功请求数限制
		allowed, err := service.CheckRedisRateLimit(ctx, rdb, successKey, p.successMaxCount, p.duration)
		if err != nil {
			fmt.Println("检查成功请求数限制失败:", err.Error())
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
			return
		}
		if !allowed {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, overLimitMessage(p, false))
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
				fmt.Println("检查总请求数限制失败:", err.Error())
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}

			if !allowed {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, overLimitMessage(p, true))
			}
		}

		// 4. 处理请求
		c.Next()

		// 5. 如果请求成功，记录成功请求
		if c.Writer.Status() < 400 {
			service.RecordRedisRequest(ctx, rdb, successKey, p.successMaxCount)
		}
	}
}

// 内存限流处理器。成功数限制使用只读预检（Check），请求成功后再实际记账，
// 与 Redis 路径语义一致：失败的请求不占成功额度。
func memoryRateLimitHandler(p rateLimitParams) gin.HandlerFunc {
	common.SharedInMemoryRateLimiter.Init(time.Duration(setting.ModelRequestRateLimitDurationMinutes) * time.Minute)

	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		totalKey, successKey := service.ModelRateLimitMemoryKeys(p.scope, userId)

		// 1. 检查总请求数限制（当totalMaxCount为0时跳过）
		if p.totalMaxCount > 0 && !common.SharedInMemoryRateLimiter.Request(totalKey, p.totalMaxCount, p.duration) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, overLimitMessage(p, true))
			return
		}

		// 2. 只读检查成功请求数限制，请求成功后在第 4 步实际记账
		if !common.SharedInMemoryRateLimiter.Check(successKey, p.successMaxCount, p.duration) {
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, overLimitMessage(p, false))
			return
		}

		// 3. 处理请求
		c.Next()

		// 4. 如果请求成功，记录到成功请求计数中
		if c.Writer.Status() < 400 && p.successMaxCount > 0 {
			common.SharedInMemoryRateLimiter.Request(successKey, p.successMaxCount, p.duration)
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

		// 本次额度是否来自余额分档：决定 429 文案能否引导「提升余额」。
		balanceTier := false
		atTopTier := false

		// auto 分组的解析发生在渠道选择阶段，此处跳过分组级预检，
		// 否则查 map 只会得到 "auto" 这个 key，永远无法命中分组配置。
		if group != "auto" {
			// 优先查余额分档：按用户余额选择该分组的限速档位
			userQuota := int64(common.GetContextKeyInt(c, constant.ContextKeyUserQuota))
			state, tierTotal, tierSuccess := setting.GetBalanceRateLimit(group, userQuota)
			if state == setting.BalanceTierBelowMinimum {
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, belowMinimumMessage)
				return
			}
			if state == setting.BalanceTierMatched {
				totalMaxCount = tierTotal
				successMaxCount = tierSuccess
				scope = group
				balanceTier = true
				// 最高档之上没有更高档位，文案必须与中间档区分：
				// 否则会引导一个已经充够钱的用户继续充值。
				thresholds, level := setting.GetBalanceTierLevels(group, userQuota)
				atTopTier = level >= 0 && level == len(thresholds)-1
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
		params := rateLimitParams{
			duration:        duration,
			totalMaxCount:   totalMaxCount,
			successMaxCount: successMaxCount,
			scope:           scope,
			balanceTier:     balanceTier,
			atTopTier:       atTopTier,
		}
		if common.RedisEnabled {
			redisRateLimitHandler(params)(c)
		} else {
			memoryRateLimitHandler(params)(c)
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
