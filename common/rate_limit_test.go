package common

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestInMemoryRateLimiterCheckMirrorsRequest(t *testing.T) {
	var limiter InMemoryRateLimiter
	limiter.Init(10 * time.Minute)
	key := "test:check:mirrors"

	// 未记录过：允许
	assert.True(t, limiter.Check(key, 2, 60))
	// 记录两次后：额度已满，窗口内不允许
	assert.True(t, limiter.Request(key, 2, 60))
	assert.True(t, limiter.Request(key, 2, 60))
	assert.False(t, limiter.Check(key, 2, 60))
	// Check 不产生额外记录：连续多次 Check 结果不变
	assert.False(t, limiter.Check(key, 2, 60))
	// Request 同样被拒绝
	assert.False(t, limiter.Request(key, 2, 60))

	// maxRequestNum <= 0 视为不限制
	assert.True(t, limiter.Check(key, 0, 60))
}

func TestInMemoryRateLimiterCheckAllowsAfterWindow(t *testing.T) {
	var limiter InMemoryRateLimiter
	limiter.Init(10 * time.Minute)
	key := "test:check:window"

	assert.True(t, limiter.Request(key, 1, 1))
	assert.False(t, limiter.Check(key, 1, 1), "window of 1 second has not elapsed")

	// 等待窗口过期后放行
	time.Sleep(1100 * time.Millisecond)
	assert.True(t, limiter.Check(key, 1, 1))
}
