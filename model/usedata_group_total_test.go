package model

import (
	"testing"

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
