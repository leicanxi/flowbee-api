package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSponsorshipBadges 锁定称号的判定契约：
// 两个称号都必须有区分度，"支持过"本身不发称号；持续称号必须有次数下限，
// 否则它退化成"最近支持过一次"，与名称不符。
func TestSponsorshipBadges(t *testing.T) {
	setting := operation_setting.GetSponsorshipSetting()
	originalDeadline := setting.EarlySupporterDeadline
	originalMinCount := setting.ContinuousMinCount
	originalMajorMin := setting.MajorSupporterMinMoney
	originalCumulativeMin := setting.CumulativeSupporterMinMoney
	defer func() {
		setting.EarlySupporterDeadline = originalDeadline
		setting.ContinuousMinCount = originalMinCount
		setting.MajorSupporterMinMoney = originalMajorMin
		setting.CumulativeSupporterMinMoney = originalCumulativeMin
	}()

	setting.EarlySupporterDeadline = 1000
	setting.ContinuousMinCount = 2
	setting.MajorSupporterMinMoney = 100
	setting.CumulativeSupporterMinMoney = 200

	cases := []struct {
		name        string
		firstTime   int64
		windowCount int64
		maxMoney    float64
		totalMoney  float64
		want        []string
	}{
		{
			name:      "支持次数不足时只有早期称号",
			firstTime: 500, windowCount: 0,
			want: []string{SponsorshipBadgeEarlySupporter},
		},
		{
			name:      "过了截止期但窗口内支持够次数时只有持续称号",
			firstTime: 5000, windowCount: 2,
			want: []string{SponsorshipBadgeContinuousSupporter},
		},
		{
			name:      "两个条件都满足时同时授予",
			firstTime: 500, windowCount: 3,
			want: []string{SponsorshipBadgeEarlySupporter, SponsorshipBadgeContinuousSupporter},
		},
		{
			name:      "窗口内少一次就不发持续称号",
			firstTime: 5000, windowCount: 1,
			want: []string{},
		},
		{
			name:      "截止时间之后首次支持不发早期称号",
			firstTime: 1001, windowCount: 0,
			want: []string{},
		},
		{
			name:      "截止时间当天仍算早期支持",
			firstTime: 1000, windowCount: 0,
			want: []string{SponsorshipBadgeEarlySupporter},
		},
		{
			name:      "单笔恰好到门槛发一掷千金称号",
			firstTime: 5000, maxMoney: 100, totalMoney: 100,
			want: []string{SponsorshipBadgeMajorSupporter},
		},
		{
			name:      "单笔差一点不发一掷千金称号",
			firstTime: 5000, maxMoney: 99.99, totalMoney: 99.99,
			want: []string{},
		},
		{
			name:      "累计恰好到门槛发累计称号",
			firstTime: 5000, maxMoney: 20, totalMoney: 200,
			want: []string{SponsorshipBadgeCumulativeSupporter},
		},
		{
			name:      "累计差一点不发累计称号",
			firstTime: 5000, maxMoney: 20, totalMoney: 199.99,
			want: []string{},
		},
		{
			name:      "金额门槛同时满足时按固定顺序授予",
			firstTime: 5000, maxMoney: 100, totalMoney: 200,
			want: []string{SponsorshipBadgeMajorSupporter, SponsorshipBadgeCumulativeSupporter},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, sponsorshipBadges(tc.firstTime, tc.windowCount, tc.maxMoney, tc.totalMoney))
		})
	}

	t.Run("截止时间未配置时不发早期称号", func(t *testing.T) {
		setting.EarlySupporterDeadline = 0
		assert.Equal(t, []string{}, sponsorshipBadges(500, 0, 0, 0))
	})

	t.Run("金额门槛为 0 时对应的称号不发放", func(t *testing.T) {
		setting.MajorSupporterMinMoney = 0
		setting.CumulativeSupporterMinMoney = 0
		assert.Equal(t, []string{}, sponsorshipBadges(5000, 0, 10000, 10000))
	})
}

// TestSponsorshipContinuousMinCountFallback 锁定兜底值：
// 配置漏填或填 0 时必须落到 2，而不是 1 —— 次数下限为 1 时"持续"没有意义。
func TestSponsorshipContinuousMinCountFallback(t *testing.T) {
	cases := []struct {
		name  string
		value int
		want  int
	}{
		{name: "未配置", value: 0, want: 2},
		{name: "负数", value: -3, want: 2},
		{name: "显式配置 1 时尊重配置", value: 1, want: 1},
		{name: "正常配置", value: 4, want: 4},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setting := &operation_setting.SponsorshipSetting{ContinuousMinCount: tc.value}
			assert.Equal(t, tc.want, setting.SponsorshipContinuousMinCount())
		})
	}
}

func TestGetUserSponsorshipStatsSplitsLifetimeAndMonthlyCounts(t *testing.T) {
	truncateTables(t)
	setting := operation_setting.GetSponsorshipSetting()
	originalMajorMin := setting.MajorSupporterMinMoney
	originalCumulativeMin := setting.CumulativeSupporterMinMoney
	originalGoalEnabled := setting.GoalEnabled
	originalGoalTarget := setting.GoalTargetMoney
	defer func() {
		setting.MajorSupporterMinMoney = originalMajorMin
		setting.CumulativeSupporterMinMoney = originalCumulativeMin
		setting.GoalEnabled = originalGoalEnabled
		setting.GoalTargetMoney = originalGoalTarget
	}()
	setting.MajorSupporterMinMoney = 100
	setting.CumulativeSupporterMinMoney = 200
	setting.GoalEnabled = true
	setting.GoalTargetMoney = 1500
	monthStart := sponsorshipMonthStart()

	orders := []SponsorshipOrder{
		{UserId: 1, TradeNo: "sponsor-1-current", Status: common.TopUpStatusSuccess, CompleteTime: monthStart + 100, Money: 1},
		{UserId: 1, TradeNo: "sponsor-1-last", Status: common.TopUpStatusSuccess, CompleteTime: monthStart - 100, Money: 1},
		{UserId: 1, TradeNo: "sponsor-1-pending", Status: common.TopUpStatusPending, CompleteTime: monthStart + 200, Money: 1},
		{UserId: 2, TradeNo: "sponsor-2-current", Status: common.TopUpStatusSuccess, CompleteTime: monthStart + 300, Money: 100},
		{UserId: 3, TradeNo: "sponsor-3-current", Status: common.TopUpStatusSuccess, CompleteTime: monthStart + 400, Money: 100},
		{UserId: 2, TradeNo: "sponsor-2-last", Status: common.TopUpStatusSuccess, CompleteTime: monthStart - 200, Money: 100},
	}
	for i := range orders {
		require.NoError(t, DB.Create(&orders[i]).Error)
	}

	stats, err := GetUserSponsorshipStats(1)
	require.NoError(t, err)
	assert.True(t, stats.Supported)
	assert.Equal(t, int64(2), stats.SupportCount, "lifetime count includes last month")
	assert.Equal(t, int64(1), stats.MonthlySupportCount, "own monthly count excludes last month and pending")
	assert.Equal(t, int64(3), stats.MonthlySupporterCount, "site-wide monthly supporters are distinct users")
	assert.NotContains(t, stats.Badges, SponsorshipBadgeMajorSupporter, "small payments earn no amount badge")
	assert.NotContains(t, stats.Badges, SponsorshipBadgeCumulativeSupporter)

	stats2, err := GetUserSponsorshipStats(2)
	require.NoError(t, err)
	assert.Contains(t, stats2.Badges, SponsorshipBadgeMajorSupporter)
	assert.Contains(t, stats2.Badges, SponsorshipBadgeCumulativeSupporter, "two 100 payments reach the 200 cumulative threshold")

	stats3, err := GetUserSponsorshipStats(3)
	require.NoError(t, err)
	assert.Contains(t, stats3.Badges, SponsorshipBadgeMajorSupporter)
	assert.NotContains(t, stats3.Badges, SponsorshipBadgeCumulativeSupporter)

	goal, err := GetSponsorshipGoal()
	require.NoError(t, err)
	require.NotNil(t, goal)
	assert.Equal(t, int64(3), goal.SupporterCount, "monthly supporters are distinct users")
	assert.Equal(t, int64(3), goal.TotalSupporterCount, "lifetime supporters include last month and exclude pending")
}
