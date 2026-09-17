package controller

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sponsorshipSettingForTest() *operation_setting.SponsorshipSetting {
	return &operation_setting.SponsorshipSetting{
		Tiers: []operation_setting.SponsorshipTier{
			{Id: "coffee", Label: "一杯咖啡", IconUrl: "https://example.com/coffee.png", Money: 10},
			{Id: "meal", Label: "一顿饭", IconUrl: "https://example.com/meal.png", Money: 50},
		},
		CustomMinMoney:   1,
		CustomMaxMoney:   2000,
		MaxMessageLength: 40,
		DefaultMessage:   "悄悄支持了一下",
	}
}

func TestResolveSponsorshipMoney(t *testing.T) {
	setting := sponsorshipSettingForTest()

	t.Run("固定档位价格由服务端决定，忽略客户端传入的金额", func(t *testing.T) {
		money, err := resolveSponsorshipMoney(setting, SponsorshipEpayPayRequest{TierId: "coffee", Money: 0.01})
		require.NoError(t, err)
		assert.Equal(t, 10.0, money)
	})

	t.Run("未知档位被拒绝", func(t *testing.T) {
		_, err := resolveSponsorshipMoney(setting, SponsorshipEpayPayRequest{TierId: "unknown"})
		require.Error(t, err)
	})

	t.Run("自定义金额取两位小数", func(t *testing.T) {
		money, err := resolveSponsorshipMoney(setting, SponsorshipEpayPayRequest{TierId: "custom", Money: 12.3456})
		require.NoError(t, err)
		assert.Equal(t, 12.35, money)
	})

	t.Run("NaN 与无穷必须先被挡掉，大小比较对它们无效", func(t *testing.T) {
		for name, money := range map[string]float64{
			"NaN":  math.NaN(),
			"正无穷": math.Inf(1),
			"负无穷": math.Inf(-1),
		} {
			t.Run(name, func(t *testing.T) {
				_, err := resolveSponsorshipMoney(setting, SponsorshipEpayPayRequest{TierId: "custom", Money: money})
				require.Error(t, err)
			})
		}
	})

	t.Run("超出区间的自定义金额被拒绝", func(t *testing.T) {
		for name, money := range map[string]float64{
			"低于下限": 0.5,
			"高于上限": 2000.01,
			"负数":   -10,
		} {
			t.Run(name, func(t *testing.T) {
				_, err := resolveSponsorshipMoney(setting, SponsorshipEpayPayRequest{TierId: "custom", Money: money})
				require.Error(t, err)
			})
		}
	})

	t.Run("后台把上限填成天文数字时仍然创建不出天价订单", func(t *testing.T) {
		misconfigured := &operation_setting.SponsorshipSetting{CustomMinMoney: 1, CustomMaxMoney: 1e18}
		_, err := resolveSponsorshipMoney(misconfigured, SponsorshipEpayPayRequest{TierId: "custom", Money: 1e17})
		require.Error(t, err)
	})
}

func TestSponsorshipCustomBounds(t *testing.T) {
	cases := []struct {
		name    string
		setting operation_setting.SponsorshipSetting
		wantMin float64
		wantMax float64
	}{
		{
			name:    "未配置时兜底为一个可用区间",
			setting: operation_setting.SponsorshipSetting{},
			wantMin: 1,
			wantMax: operation_setting.SponsorshipHardMaxMoney,
		},
		{
			name:    "上下限填反时收敛到同一个值而不是产生空区间",
			setting: operation_setting.SponsorshipSetting{CustomMinMoney: 50, CustomMaxMoney: 10},
			wantMin: 50,
			wantMax: 50,
		},
		{
			name:    "上限超过硬闸时收敛到硬闸",
			setting: operation_setting.SponsorshipSetting{CustomMinMoney: 1, CustomMaxMoney: 1e12},
			wantMin: 1,
			wantMax: operation_setting.SponsorshipHardMaxMoney,
		},
		{
			name:    "下限高于硬闸时回落到兜底下限",
			setting: operation_setting.SponsorshipSetting{CustomMinMoney: 1e12, CustomMaxMoney: 1e12},
			wantMin: 1,
			wantMax: operation_setting.SponsorshipHardMaxMoney,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			minMoney, maxMoney := tc.setting.SponsorshipCustomBounds()
			assert.Equal(t, tc.wantMin, minMoney)
			assert.Equal(t, tc.wantMax, maxMoney)
		})
	}
}

func TestSanitizeSponsorshipMessage(t *testing.T) {
	setting := sponsorshipSettingForTest()

	t.Run("空寄语返回空串，由读取侧补兜底文案", func(t *testing.T) {
		assert.Equal(t, "", sanitizeSponsorshipMessage(setting, "   "))
	})

	t.Run("首尾空白被去掉", func(t *testing.T) {
		assert.Equal(t, "谢谢你", sanitizeSponsorshipMessage(setting, "  谢谢你  "))
	})

	t.Run("换行与连续空白压成单个空格，保证每条寄语只占一行", func(t *testing.T) {
		assert.Equal(t, "加油 一直用", sanitizeSponsorshipMessage(setting, "加油\n\n一直用"))
	})

	t.Run("控制字符被剔除", func(t *testing.T) {
		assert.Equal(t, "ab", sanitizeSponsorshipMessage(setting, "a\x00b"))
	})

	t.Run("按字符数而非字节数截断", func(t *testing.T) {
		short := sponsorshipSettingForTest()
		short.MaxMessageLength = 5
		assert.Equal(t, "一二三四五", sanitizeSponsorshipMessage(short, "一二三四五六七八"))
	})

	t.Run("HTML 标签原样保留：寄语始终按纯文本渲染，不做标签过滤", func(t *testing.T) {
		// 这条断言锁定的是渲染契约 —— 后端不解析、前端只用文本节点输出，
		// 所以不存在 XSS 面，也不需要在这里做 HTML 清洗。
		assert.Equal(t, "<b>hi</b>", sanitizeSponsorshipMessage(setting, "<b>hi</b>"))
	})
}
