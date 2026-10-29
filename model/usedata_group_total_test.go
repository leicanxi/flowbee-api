package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetGroupUsedTokenTotalSumsOnlyRequestedGroup(t *testing.T) {
	truncateTables(t)

	rows := []QuotaData{
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "gpt-a", CreatedAt: 3600, Count: 1, TokenUsed: 40},
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "gpt-b", CreatedAt: 7200, Count: 1, TokenUsed: 60},
		{UserID: 2, Username: "bob", UseGroup: "default", ModelName: "gpt-a", CreatedAt: 3600, Count: 1, TokenUsed: 999},
	}
	for i := range rows {
		require.NoError(t, DB.Create(&rows[i]).Error)
	}

	total, err := GetGroupUsedTokenTotal("福利")
	require.NoError(t, err)
	require.Equal(t, int64(100), total)

	// 分组被改名或删掉时聚合结果为空，必须返回 0 而不是报错，让调用方自己决定怎么降级。
	total, err = GetGroupUsedTokenTotal("不存在的分组")
	require.NoError(t, err)
	require.Equal(t, int64(0), total)
}

func TestGetWelfareModelUsageGroupsByModelAndSkipsOtherGroups(t *testing.T) {
	truncateTables(t)

	rows := []QuotaData{
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "gpt-a", CreatedAt: 1100, Count: 3, TokenUsed: 40},
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "gpt-a", CreatedAt: 1200, Count: 2, TokenUsed: 60},
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "gpt-b", CreatedAt: 1300, Count: 1, TokenUsed: 20},
		{UserID: 1, Username: "alice", UseGroup: "default", ModelName: "gpt-c", CreatedAt: 1400, Count: 9, TokenUsed: 900},
		{UserID: 2, Username: "bob", UseGroup: "福利", ModelName: "gpt-a", CreatedAt: 1500, Count: 9, TokenUsed: 900},
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "gpt-old", CreatedAt: 900, Count: 9, TokenUsed: 900},
		{UserID: 1, Username: "alice", UseGroup: "福利", ModelName: "", CreatedAt: 1600, Count: 9, TokenUsed: 900},
	}
	for i := range rows {
		require.NoError(t, DB.Create(&rows[i]).Error)
	}

	usage, err := GetWelfareModelUsage(1, "福利", 1000)
	require.NoError(t, err)
	require.Len(t, usage, 2, "only this user's models in the welfare group and window are counted")
	assert.Equal(t, "gpt-a", usage[0].ModelName, "higher request count sorts first")
	assert.Equal(t, int64(5), usage[0].RequestCount)
	assert.Equal(t, int64(1200), usage[0].LastUsedAt)
	assert.Equal(t, "gpt-b", usage[1].ModelName)
	assert.Equal(t, int64(1), usage[1].RequestCount)

	// 分组不存在时返回空结果而不是报错。
	usage, err = GetWelfareModelUsage(1, "不存在的分组", 1000)
	require.NoError(t, err)
	assert.Empty(t, usage)
}
