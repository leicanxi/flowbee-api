package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useWelfarePointsTestSetting(t *testing.T, jsonValue string) {
	t.Helper()
	previous := setting.WelfarePointsSetting2JSONString()
	require.NoError(t, setting.UpdateWelfarePointsSettingByJSONString(jsonValue))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateWelfarePointsSettingByJSONString(previous))
	})
}

func createWelfarePointsTestUser(t *testing.T, daily int, permanent int, dailyDate string) User {
	t.Helper()
	user := User{
		Username:               "welfare-points-user",
		AffCode:                "welfare-points-aff",
		Status:                 1,
		Role:                   1,
		Group:                  "default",
		AuthVersion:            1,
		WelfarePointsDaily:     daily,
		WelfarePointsPermanent: permanent,
		WelfarePointsDailyDate: dailyDate,
	}
	require.NoError(t, DB.Create(&user).Error)
	return user
}

func TestWelfarePointsGrantIsIdempotentAndSpendNeverGoesNegative(t *testing.T) {
	setupUserUpdateTestState(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"group":"福利","daily_base_points":0,"model_costs":{"default":1}}`)

	user := createWelfarePointsTestUser(t, 0, 0, WelfarePointsToday())

	require.NoError(t, AddWelfarePoints(user.Id, 0, 10, "test_grant", "grant-1"))
	require.NoError(t, AddWelfarePoints(user.Id, 0, 10, "test_grant", "grant-1"))

	daily, permanent, err := GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 0, daily)
	assert.Equal(t, 10, permanent, "the same source_ref must not grant twice")

	spent, err := SpendWelfarePoints(user.Id, 4, "test_spend", "spend-1")
	require.NoError(t, err)
	assert.True(t, spent)
	daily, permanent, err = GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 0, daily)
	assert.Equal(t, 6, permanent)

	spent, err = SpendWelfarePoints(user.Id, 7, "test_spend", "spend-2")
	require.NoError(t, err)
	assert.False(t, spent)
	daily, permanent, err = GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 6, daily+permanent, "a failed spend must not change the balance")

	// Replaying the same successful spend must not charge twice.
	spent, err = SpendWelfarePoints(user.Id, 4, "test_spend", "spend-1")
	require.NoError(t, err)
	assert.True(t, spent)
	daily, permanent, err = GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 6, daily+permanent)
}

func TestMigrateAffQuotaToBalanceIsIdempotent(t *testing.T) {
	setupUserUpdateTestState(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"group":"福利","model_costs":{"default":1}}`)

	user := User{
		Username: "aff-migration-user",
		AffCode:  "aff-migration-code",
		Status:   1,
		Role:     1,
		Group:    "default",
		Quota:    100,
		AffQuota: 50,
	}
	require.NoError(t, DB.Create(&user).Error)

	require.NoError(t, MigrateAffQuotaToBalance())
	var stored User
	require.NoError(t, DB.Select("quota", "aff_quota").Where("id = ?", user.Id).First(&stored).Error)
	assert.Equal(t, 150, stored.Quota)
	assert.Equal(t, 0, stored.AffQuota)

	require.NoError(t, MigrateAffQuotaToBalance())
	require.NoError(t, DB.Select("quota", "aff_quota").Where("id = ?", user.Id).First(&stored).Error)
	assert.Equal(t, 150, stored.Quota, "the sweep must not transfer twice")
}

func TestGrantDailyConsumeRebateUsesNetWalletConsumption(t *testing.T) {
	setupUserUpdateTestState(t)
	useWelfarePointsTestSetting(t, `{
		"enabled": true,
		"group": "福利",
		"model_costs": {"default": 1},
		"consume_tiers": [
			{"min_quota": 0, "points": 0},
			{"min_quota": 100, "points": 5}
		]
	}`)

	user := createWelfarePointsTestUser(t, 0, 0, WelfarePointsToday())
	yesterday := time.Now().In(welfarePointsLocation).AddDate(0, 0, -1)
	noon := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 12, 0, 0, 0, welfarePointsLocation).Unix()

	require.NoError(t, DB.Create(&Log{
		UserId: user.Id, CreatedAt: noon, Type: LogTypeConsume, Quota: 120, BillingSource: "wallet",
	}).Error)
	require.NoError(t, DB.Create(&Log{
		UserId: user.Id, CreatedAt: noon, Type: LogTypeRefund, Quota: 20, BillingSource: "wallet",
	}).Error)
	// Subscription consumption must not earn welfare points.
	require.NoError(t, DB.Create(&Log{
		UserId: user.Id, CreatedAt: noon, Type: LogTypeConsume, Quota: 1000, BillingSource: "subscription",
	}).Error)

	require.NoError(t, GrantDailyConsumeRebate(WelfarePointsYesterday()))
	daily, permanent, err := GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 0, daily)
	assert.Equal(t, 5, permanent)

	// Re-running the task must not double-grant.
	require.NoError(t, GrantDailyConsumeRebate(WelfarePointsYesterday()))
	_, permanent, err = GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 5, permanent)
}

func TestWelfarePointsDailyBucketResetsAndIsSpentFirst(t *testing.T) {
	setupUserUpdateTestState(t)
	useWelfarePointsTestSetting(t, `{"enabled":true,"group":"福利","daily_base_points":5,"model_costs":{"default":1}}`)

	user := createWelfarePointsTestUser(t, 100, 3, "2000-01-01")

	daily, permanent, err := GetWelfarePointsBalance(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 5, daily, "a stale daily bucket reports today's base without writing")
	assert.Equal(t, 3, permanent)

	spent, err := SpendWelfarePoints(user.Id, 6, "test_spend", "spend-daily-first")
	require.NoError(t, err)
	assert.True(t, spent)

	var stored User
	require.NoError(t, DB.Select("welfare_points_daily", "welfare_points_permanent", "welfare_points_daily_date").
		Where("id = ?", user.Id).First(&stored).Error)
	assert.Equal(t, 0, stored.WelfarePointsDaily)
	assert.Equal(t, 2, stored.WelfarePointsPermanent)
	assert.Equal(t, WelfarePointsToday(), stored.WelfarePointsDailyDate)
}
