package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useGroupRateLimitMiniRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()

	previousRedisEnabled := common.RedisEnabled
	previousRedisClient := common.RDB
	redisServer := miniredis.RunT(t)
	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	require.NoError(t, redisClient.Ping(context.Background()).Err())

	common.RedisEnabled = true
	common.RDB = redisClient
	t.Cleanup(func() {
		_ = redisClient.Close()
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRedisClient
	})

	return redisServer, redisClient
}

func TestModelRedisRateLimitUsesUTCRegardlessOfLocalTimezone(t *testing.T) {
	redisServer, redisClient := useGroupRateLimitMiniRedis(t)
	previousLocation := time.Local
	time.Local = time.FixedZone("test-utc-plus-eight", 8*60*60)
	t.Cleanup(func() { time.Local = previousLocation })

	ctx := context.Background()
	recordKey := "rateLimit:model-utc-record"
	RecordRedisRequest(ctx, redisClient, recordKey, 2)
	recorded, err := redisClient.LIndex(ctx, recordKey, 0).Result()
	require.NoError(t, err)
	recordedAt, err := time.Parse(modelRateLimitTimeFormat, recorded)
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now().UTC(), recordedAt, 2*time.Second)

	checkKey := "rateLimit:model-utc-check"
	withinWindow := time.Now().UTC().Add(-30 * time.Second).Format(modelRateLimitTimeFormat)
	_, err = redisServer.Push(checkKey, withinWindow, withinWindow)
	require.NoError(t, err)
	allowed, err := CheckRedisRateLimit(ctx, redisClient, checkKey, 2, 60)
	require.NoError(t, err)
	assert.False(t, allowed, "an existing UTC timestamp inside the window must remain limited on a non-UTC host")
}

// setupGroupRateLimitSettings saves/restores the group rate limit settings and
// enables the feature with a one-minute window for the test.
func setupGroupRateLimitSettings(t *testing.T, groupLimitsJSON string) {
	t.Helper()

	originalEnabled := setting.ModelRequestRateLimitEnabled
	originalDuration := setting.ModelRequestRateLimitDurationMinutes
	originalGroupLimits := setting.ModelRequestRateLimitGroup2JSONString()
	originalRedisEnabled := common.RedisEnabled

	setting.ModelRequestRateLimitEnabled = true
	setting.ModelRequestRateLimitDurationMinutes = 1
	common.RedisEnabled = false
	require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(groupLimitsJSON))

	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled = originalEnabled
		setting.ModelRequestRateLimitDurationMinutes = originalDuration
		common.RedisEnabled = originalRedisEnabled
		require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(originalGroupLimits))
	})
}

func TestCheckGroupRateLimitDecisions(t *testing.T) {
	setupGroupRateLimitSettings(t, `{"cfg":[0,2]}`)

	// 未配置的分组：放行
	assert.Equal(t, GroupRateLimitAllow, CheckGroupRateLimit("unknown-group", 1, "gpt-4o"))

	// 配置了分组限速且未超限：放行
	assert.Equal(t, GroupRateLimitAllow, CheckGroupRateLimit("cfg", 1, "gpt-4o"))

	// 记满成功数后：超限跳过
	RecordGroupRateLimitSuccess(1, "cfg")
	RecordGroupRateLimitSuccess(1, "cfg")
	assert.Equal(t, GroupRateLimitSkipOverLimit, CheckGroupRateLimit("cfg", 1, "gpt-4o"))

	// 另一个用户不受影响
	assert.Equal(t, GroupRateLimitAllow, CheckGroupRateLimit("cfg", 2, "gpt-4o"))

	// 限流功能关闭时：一律放行
	setting.ModelRequestRateLimitEnabled = false
	assert.Equal(t, GroupRateLimitAllow, CheckGroupRateLimit("cfg", 1, "gpt-4o"))
	setting.ModelRequestRateLimitEnabled = true
}
