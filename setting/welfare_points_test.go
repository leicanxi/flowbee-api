package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useWelfarePointsSetting(t *testing.T, jsonValue string) {
	t.Helper()
	previous := WelfarePointsSetting2JSONString()
	require.NoError(t, UpdateWelfarePointsSettingByJSONString(jsonValue))
	t.Cleanup(func() {
		require.NoError(t, UpdateWelfarePointsSettingByJSONString(previous))
	})
}

func TestWelfarePointCostResolution(t *testing.T) {
	useWelfarePointsSetting(t, `{
		"enabled": true,
		"group": "福利",
		"model_costs": {
			"default": 1,
			"gpt-4o": 3,
			"claude-*": 5,
			"claude-3-5-sonnet*": 8
		}
	}`)

	assert.Equal(t, 3, GetWelfarePointCost("gpt-4o"))
	assert.Equal(t, 8, GetWelfarePointCost("claude-3-5-sonnet-20241022"), "the longest prefix wins")
	assert.Equal(t, 5, GetWelfarePointCost("claude-3-opus"))
	assert.Equal(t, 1, GetWelfarePointCost("deepseek-chat"))

	useWelfarePointsSetting(t, `{"enabled":false,"model_costs":{"default":1}}`)
	assert.Equal(t, 0, GetWelfarePointCost("gpt-4o"))
}

func TestWelfareConsumeTierPointsUsesHighestReachedTier(t *testing.T) {
	useWelfarePointsSetting(t, `{
		"enabled": true,
		"group": "福利",
		"consume_tiers": [
			{"min_quota": 0, "points": 0},
			{"min_quota": 500000, "points": 3},
			{"min_quota": 2500000, "points": 10}
		]
	}`)

	assert.Equal(t, 0, GetWelfareConsumeTierPoints(0))
	assert.Equal(t, 0, GetWelfareConsumeTierPoints(499999))
	assert.Equal(t, 3, GetWelfareConsumeTierPoints(500000))
	assert.Equal(t, 10, GetWelfareConsumeTierPoints(2500000))
}

func TestWelfareNewUserPointsRespectsEnabled(t *testing.T) {
	useWelfarePointsSetting(t, `{"enabled":true,"new_user_points":12,"model_costs":{"default":1}}`)
	assert.Equal(t, 12, GetWelfareNewUserPoints())

	useWelfarePointsSetting(t, `{"enabled":false,"new_user_points":12,"model_costs":{"default":1}}`)
	assert.Equal(t, 0, GetWelfareNewUserPoints(), "a disabled economy must not grant")
}

func TestCheckWelfarePointsSettingRejectsInvalidValues(t *testing.T) {
	cases := []struct {
		name string
		json string
	}{
		{"missing default when enabled", `{"enabled":true,"model_costs":{"gpt-4o":1}}`},
		{"negative model cost", `{"enabled":false,"model_costs":{"default":-1}}`},
		{"duplicate consume tier", `{"consume_tiers":[{"min_quota":0,"points":1},{"min_quota":0,"points":2}]}`},
		{"negative daily base", `{"daily_base_points":-1}`},
		{"negative new user points", `{"new_user_points":-1}`},
		{"checkin max below min", `{"checkin_min_points":10,"checkin_max_points":5}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Error(t, CheckWelfarePointsSetting(tc.json))
		})
	}

	assert.NoError(t, CheckWelfarePointsSetting(`{
		"enabled": true,
		"group": "福利",
		"model_costs": {"default": 1},
		"consume_tiers": [{"min_quota": 0, "points": 0}]
	}`))
}
