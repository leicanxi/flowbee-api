package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/go-redis/redis/v8"
)

// 限流计数 key 的组成部分，自 middleware 迁移而来。key 格式保持不变，
// 以兼容存量 Redis 计数与内存计数。
const (
	modelRequestRateLimitCountMark        = "MRRL"
	modelRequestRateLimitSuccessCountMark = "MRRLS"
	modelRateLimitTimeFormat              = "2006-01-02T15:04:05.000Z"
)

// ErrAutoGroupsRateLimited 表示 auto 令牌的所有候选分组都被分组级限流
// （余额分档或分组限速）挡住，渠道选择未能进行。
var ErrAutoGroupsRateLimited = errors.New("all auto groups are rate limited")

// ModelRateLimitRedisKeys 生成 Redis 限流计数 key。
// scope 为空时保持官方原始 key（历史行为不变）；非空时按分组隔离，
// 避免与其他分组的调用互相挤占额度。
func ModelRateLimitRedisKeys(scope string, userId string) (totalKey, successKey string) {
	if scope != "" {
		return fmt.Sprintf("rateLimit:G:%s:%s", scope, userId),
			fmt.Sprintf("rateLimit:G:%s:%s:%s", scope, modelRequestRateLimitSuccessCountMark, userId)
	}
	return fmt.Sprintf("rateLimit:%s", userId),
		fmt.Sprintf("rateLimit:%s:%s", modelRequestRateLimitSuccessCountMark, userId)
}

// ModelRateLimitMemoryKeys 生成内存限流计数 key，隔离规则同 Redis。
func ModelRateLimitMemoryKeys(scope string, userId string) (totalKey, successKey string) {
	if scope != "" {
		return "G:" + scope + ":" + modelRequestRateLimitCountMark + userId,
			"G:" + scope + ":" + modelRequestRateLimitSuccessCountMark + userId
	}
	return modelRequestRateLimitCountMark + userId, modelRequestRateLimitSuccessCountMark + userId
}

// RateLimitDurationSeconds 把限流窗口分钟数换算成秒，带溢出保护。
func RateLimitDurationSeconds(durationMinutes int) int64 {
	if durationMinutes <= 0 {
		return 0
	}
	minutes := int64(durationMinutes)
	if minutes > math.MaxInt64/60 {
		return math.MaxInt64
	}
	return minutes * 60
}

// CheckRedisRateLimit 只读检查 Redis 中的请求限制，不写入。
func CheckRedisRateLimit(ctx context.Context, rdb *redis.Client, key string, maxCount int, duration int64) (bool, error) {
	// 如果maxCount为0，表示不限制
	if maxCount == 0 {
		return true, nil
	}

	length, err := rdb.LLen(ctx, key).Result()
	if err != nil {
		return false, err
	}
	if length < int64(maxCount) {
		return true, nil
	}

	// 检查时间窗口
	oldTimeStr, _ := rdb.LIndex(ctx, key, -1).Result()
	oldTime, err := time.Parse(modelRateLimitTimeFormat, oldTimeStr)
	if err != nil {
		return false, err
	}
	nowTime, err := time.Parse(modelRateLimitTimeFormat, time.Now().UTC().Format(modelRateLimitTimeFormat))
	if err != nil {
		return false, err
	}
	// 如果在时间窗口内已达到限制，拒绝请求
	if int64(nowTime.Sub(oldTime).Seconds()) < duration {
		rdb.Expire(ctx, key, time.Duration(setting.ModelRequestRateLimitDurationMinutes)*time.Minute)
		return false, nil
	}
	return true, nil
}

// RecordRedisRequest 记录一次成功请求到 Redis 计数。
func RecordRedisRequest(ctx context.Context, rdb *redis.Client, key string, maxCount int) {
	// 如果maxCount为0，不记录请求
	if maxCount == 0 {
		return
	}
	now := time.Now().UTC().Format(modelRateLimitTimeFormat)
	rdb.LPush(ctx, key, now)
	rdb.LTrim(ctx, key, 0, int64(maxCount-1))
	rdb.Expire(ctx, key, time.Duration(setting.ModelRequestRateLimitDurationMinutes)*time.Minute)
}

// GroupRateLimitDecision 是 auto 分组门禁的判定结果。
type GroupRateLimitDecision int

const (
	// GroupRateLimitAllow 表示该分组当前可用。
	GroupRateLimitAllow GroupRateLimitDecision = iota
	// GroupRateLimitSkipBelowMinimum 表示用户余额低于该分组所有档位的最低要求。
	GroupRateLimitSkipBelowMinimum
	// GroupRateLimitSkipOverLimit 表示该分组的成功数限额已用尽。
	GroupRateLimitSkipOverLimit
)

// groupSuccessLimit 解析分组当前适用的成功数限额：优先余额分档，其次分组限速。
// limit 为 0 表示该分组没有独立限速配置。
func groupSuccessLimit(group string, quota int64) (limit int, belowMinimum bool) {
	state, _, success := setting.GetBalanceRateLimit(group, quota)
	switch state {
	case setting.BalanceTierBelowMinimum:
		return 0, true
	case setting.BalanceTierMatched:
		return success, false
	}
	_, groupSuccess, found := setting.GetGroupRateLimit(group)
	if !found {
		return 0, false
	}
	return groupSuccess, false
}

// CheckGroupRateLimit 判断 auto 请求现在能否使用指定分组。只读检查：
// 成功请求的记账发生在请求完成之后（RecordGroupRateLimitSuccess），
// 检查本身不消耗额度。总请求数限制不在 auto 路径执行——token bucket
// 检查即扣减，而 auto 请求最终可能落在其他分组，会造成误扣。
func CheckGroupRateLimit(group string, userId int, quota int64) GroupRateLimitDecision {
	if !setting.ModelRequestRateLimitEnabled {
		return GroupRateLimitAllow
	}
	limit, belowMinimum := groupSuccessLimit(group, quota)
	if belowMinimum {
		return GroupRateLimitSkipBelowMinimum
	}
	if limit <= 0 {
		return GroupRateLimitAllow
	}

	duration := RateLimitDurationSeconds(setting.ModelRequestRateLimitDurationMinutes)
	if common.RedisEnabled {
		_, successKey := ModelRateLimitRedisKeys(group, strconv.Itoa(userId))
		allowed, err := CheckRedisRateLimit(context.Background(), common.RDB, successKey, limit, duration)
		if err != nil {
			// Redis 异常时放行：入口的全局限流在同一故障下已直接拒绝请求，
			// 不会经由这里引入额外的绕过面。
			common.SysLog(fmt.Sprintf("auto group rate limit check failed (group=%s): %s", group, err.Error()))
			return GroupRateLimitAllow
		}
		if !allowed {
			return GroupRateLimitSkipOverLimit
		}
		return GroupRateLimitAllow
	}

	_, successKey := ModelRateLimitMemoryKeys(group, strconv.Itoa(userId))
	if !common.SharedInMemoryRateLimiter.Check(successKey, limit, duration) {
		return GroupRateLimitSkipOverLimit
	}
	return GroupRateLimitAllow
}

// RecordGroupRateLimitSuccess 在请求成功结束后，按实际落地的分组记账一次
// 成功请求。与入口预检（非 auto 令牌）共用同一套计数 key，保证 auto 令牌
// 与纯分组令牌消耗的是同一份分组额度。
func RecordGroupRateLimitSuccess(userId int, group string, quota int64) {
	if !setting.ModelRequestRateLimitEnabled {
		return
	}
	limit, belowMinimum := groupSuccessLimit(group, quota)
	if belowMinimum || limit <= 0 {
		return
	}

	if common.RedisEnabled {
		_, successKey := ModelRateLimitRedisKeys(group, strconv.Itoa(userId))
		RecordRedisRequest(context.Background(), common.RDB, successKey, limit)
		return
	}

	common.SharedInMemoryRateLimiter.Init(time.Duration(setting.ModelRequestRateLimitDurationMinutes) * time.Minute)
	_, successKey := ModelRateLimitMemoryKeys(group, strconv.Itoa(userId))
	common.SharedInMemoryRateLimiter.Request(successKey, limit, RateLimitDurationSeconds(setting.ModelRequestRateLimitDurationMinutes))
}
