package model

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupOverviewStatsTestDB 用内存库接管 DB / LOG_DB，与 subscription_auth_test
// 的写法保持一致：两个指针都指向同一个内存库，测试结束再还原。
func setupOverviewStatsTestDB(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := DB, LOG_DB
	previousMainDatabaseType, previousLogDatabaseType := common.MainDatabaseType(), common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	require.NoError(t, db.AutoMigrate(&Log{}, &OverviewDailyStat{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		_ = sqlDB.Close()
	})
}

func overviewTestLog(userId int, group string, createdAt int64, quota int, promptTokens int, completionTokens int, other string) Log {
	return Log{
		UserId:           userId,
		CreatedAt:        createdAt,
		Type:             LogTypeConsume,
		Group:            group,
		Quota:            quota,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		Other:            other,
	}
}

func overviewTestDayStart(offsetDays int) time.Time {
	now := time.Now().In(welfarePointsLocation)
	day := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, welfarePointsLocation)
	return day.AddDate(0, 0, -offsetDays)
}

// 福利分组（分组倍率 0）的 logs.quota 恒为 0，价值必须按 model_ratio 还原；
// 补贴分组按「牌价 - 实付」算。两个口径混在一张表里，靠 group 分流。
func TestRecomputeOverviewDailyStatsValuation(t *testing.T) {
	setupOverviewStatsTestDB(t)

	today := overviewTestDayStart(0)
	// 福利分组：牌价 = (1000 + 500*2) * 0.5 = 1000，实付 0。
	require.NoError(t, LOG_DB.Create(&[]Log{
		overviewTestLog(1, "福利", today.Unix(), 0, 1000, 500,
			`{"model_ratio":0.5,"group_ratio":0,"completion_ratio":2,"cache_tokens":0,"cache_ratio":1,"model_price":0}`),
		// 补贴分组：牌价 = 0.01 * QuotaPerUnit，实付 3 成，covered 应为牌价的 7 成。
		overviewTestLog(1, "flowbee专属补贴", today.Unix(), 3000, 0, 0,
			`{"model_ratio":0,"group_ratio":0.3,"completion_ratio":1,"model_price":0.01}`),
		// 用户实付等于牌价：已经不是补贴，不该计入。
		overviewTestLog(1, "flowbee专属补贴", today.Unix(), 5000, 0, 0,
			`{"model_ratio":0,"group_ratio":1,"completion_ratio":1,"model_price":0.01}`),
		// 不在福利 / 补贴分组：完全无关。
		overviewTestLog(1, "default", today.Unix(), 999, 1000, 0,
			`{"model_ratio":1,"group_ratio":1,"completion_ratio":1,"model_price":0}`),
		// 另一个用户，应该单独成行。
		overviewTestLog(2, "福利", today.Unix(), 0, 2000, 0,
			`{"model_ratio":1,"group_ratio":0,"completion_ratio":1,"model_price":0}`),
		// 非消费类型：登录日志不该被算成用量的。
		{
			UserId:    1,
			CreatedAt: today.Unix(),
			Type:      LogTypeLogin,
			Group:     "福利",
			Other:     `{"model_ratio":10}`,
		},
	}).Error)

	written, err := RecomputeOverviewDailyStats(
		today.Format("2006-01-02"), today.Format("2006-01-02"), "福利", []string{"flowbee专属补贴", "国模企业补贴"})
	require.NoError(t, err)
	assert.Equal(t, 2, written)

	todayStr := today.Format("2006-01-02")
	var user1 OverviewDailyStat
	require.NoError(t, DB.Where("user_id = ? AND date = ?", 1, todayStr).First(&user1).Error)
	assert.EqualValues(t, 1000, user1.WelfareValue)

	subsidyListPrice := int64(0.01 * common.QuotaPerUnit)
	assert.EqualValues(t, subsidyListPrice-3000, user1.SubsidyValue)
	assert.Greater(t, user1.SubsidyValue, int64(0), "3000 实付应小于牌价，才有补贴可算")

	var user2 OverviewDailyStat
	require.NoError(t, DB.Where("user_id = ? AND date = ?", 2, todayStr).First(&user2).Error)
	assert.EqualValues(t, 2000, user2.WelfareValue)
	assert.EqualValues(t, 0, user2.SubsidyValue)
}

// 重复执行必须是覆盖而不是累加，否则定时任务每 30 分钟就会把金额翻倍。
func TestRecomputeOverviewDailyStatsIsIdempotent(t *testing.T) {
	setupOverviewStatsTestDB(t)

	today := overviewTestDayStart(0)
	require.NoError(t, LOG_DB.Create(&Log{
		UserId:       1,
		CreatedAt:    today.Unix(),
		Type:         LogTypeConsume,
		Group:        "福利",
		Quota:        0,
		Other:        `{"model_ratio":2,"group_ratio":0,"completion_ratio":1,"model_price":0}`,
		PromptTokens: 100,
	}).Error)

	date := today.Format("2006-01-02")
	for i := 0; i < 3; i++ {
		_, err := RecomputeOverviewDailyStats(date, date, "福利", nil)
		require.NoError(t, err)
	}

	var rows []OverviewDailyStat
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	assert.EqualValues(t, 200, rows[0].WelfareValue)
}

// 汇总只取窗口内的日期，且只取本人的行。
func TestGetOverviewStatsSummaryWindow(t *testing.T) {
	setupOverviewStatsTestDB(t)

	now := time.Now().In(welfarePointsLocation)
	today := now.Format("2006-01-02")
	edge := now.AddDate(0, 0, -29).Format("2006-01-02")
	outside := now.AddDate(0, 0, -30).Format("2006-01-02")
	require.NoError(t, DB.Create(&[]OverviewDailyStat{
		{UserId: 1, Date: today, WelfareValue: 100, SubsidyValue: 10},
		{UserId: 1, Date: edge, WelfareValue: 200, SubsidyValue: 20},
		{UserId: 1, Date: outside, WelfareValue: 400, SubsidyValue: 40},
		{UserId: 2, Date: today, WelfareValue: 800, SubsidyValue: 80},
	}).Error)

	summary, err := GetOverviewStatsSummary(1, 30)
	require.NoError(t, err)
	assert.EqualValues(t, 300, summary.WelfareValue)
	assert.EqualValues(t, 30, summary.SubsidyValue)
}

func TestOverviewStatDatesMissing(t *testing.T) {
	setupOverviewStatsTestDB(t)

	require.NoError(t, DB.Create(&OverviewDailyStat{UserId: 1, Date: "2026-03-02", WelfareValue: 1}).Error)

	missing := OverviewStatDatesMissing("2026-03-01", "2026-03-04")
	assert.Equal(t, []string{"2026-03-01", "2026-03-03", "2026-03-04"}, missing)

	require.NoError(t, PurgeOverviewDailyStatsBefore("2026-03-03"))
	var count int64
	require.NoError(t, DB.Model(&OverviewDailyStat{}).Count(&count).Error)
	assert.EqualValues(t, 0, count)
}
