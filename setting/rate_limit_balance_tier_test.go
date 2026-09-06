package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func resetBalanceTier() {
	ModelRequestRateLimitBalanceTier = map[string][]BalanceRateLimitTier{}
}

func TestGetBalanceRateLimit(t *testing.T) {
	defer resetBalanceTier()
	ModelRequestRateLimitBalanceTier = map[string][]BalanceRateLimitTier{
		"welfare": {
			{MinQuota: 0, Total: 5, Success: 5},
			{MinQuota: 1000000, Total: 20, Success: 20},
			{MinQuota: 5000000, Total: 60, Success: 60},
		},
	}

	cases := []struct {
		name      string
		group     string
		quota     int64
		wantState int
		wantTotal int
	}{
		{"group not configured", "default", 100, BalanceTierNotConfigured, 0},
		{"lowest tier", "welfare", 0, BalanceTierMatched, 5},
		{"middle tier boundary", "welfare", 1000000, BalanceTierMatched, 20},
		{"between middle and top", "welfare", 4999999, BalanceTierMatched, 20},
		{"top tier", "welfare", 6000000, BalanceTierMatched, 60},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state, total, _ := GetBalanceRateLimit(tc.group, tc.quota)
			if state != tc.wantState {
				t.Fatalf("state = %d, want %d", state, tc.wantState)
			}
			if total != tc.wantTotal {
				t.Fatalf("total = %d, want %d", total, tc.wantTotal)
			}
		})
	}
}

func TestGetBalanceRateLimitBelowMinimum(t *testing.T) {
	defer resetBalanceTier()
	ModelRequestRateLimitBalanceTier = map[string][]BalanceRateLimitTier{
		"welfare": {
			{MinQuota: 1000000, Total: 20, Success: 20},
		},
	}

	state, _, _ := GetBalanceRateLimit("welfare", 999999)
	if state != BalanceTierBelowMinimum {
		t.Fatalf("state = %d, want %d", state, BalanceTierBelowMinimum)
	}
}

func TestGetBalanceTierLevels(t *testing.T) {
	defer resetBalanceTier()

	sampleTiers := []BalanceRateLimitTier{
		{MinQuota: 0, Total: 5, Success: 5},
		{MinQuota: 1000000, Total: 20, Success: 20},
		{MinQuota: 5000000, Total: 60, Success: 60},
	}

	cases := []struct {
		name           string
		setTiers       bool // when true, configures sampleTiers under WelfareGroupName
		group          string
		quota          int64
		wantThresholds []int64
		wantLevel      int
	}{
		{"group not configured", false, WelfareGroupName, 100, nil, -1},
		{"lowest tier", true, WelfareGroupName, 0, []int64{0, 1000000, 5000000}, 0},
		{"middle tier boundary", true, WelfareGroupName, 1000000, []int64{0, 1000000, 5000000}, 1},
		{"top tier", true, WelfareGroupName, 99999999999, []int64{0, 1000000, 5000000}, 2},
		{"other group unaffected", true, "default", 0, nil, -1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ModelRequestRateLimitBalanceTier = map[string][]BalanceRateLimitTier{}
			if tc.setTiers {
				ModelRequestRateLimitBalanceTier[WelfareGroupName] = sampleTiers
			}
			thresholds, level := GetBalanceTierLevels(tc.group, tc.quota)
			assert.Equal(t, tc.wantThresholds, thresholds)
			assert.Equal(t, tc.wantLevel, level)
		})
	}
}

func TestCheckModelRequestRateLimitBalanceTier(t *testing.T) {
	cases := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{"valid", `{"welfare":[{"min_quota":0,"total":5,"success":5},{"min_quota":1000000,"total":20,"success":20}]}`, false},
		{"empty tier list", `{"welfare":[]}`, true},
		{"negative min_quota", `{"welfare":[{"min_quota":-1,"total":5,"success":5}]}`, true},
		{"zero success", `{"welfare":[{"min_quota":0,"total":5,"success":0}]}`, true},
		{"negative total", `{"welfare":[{"min_quota":0,"total":-1,"success":5}]}`, true},
		{"duplicate min_quota", `{"welfare":[{"min_quota":0,"total":5,"success":5},{"min_quota":0,"total":9,"success":9}]}`, true},
		{"invalid json", `{welfare}`, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckModelRequestRateLimitBalanceTier(tc.json)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}
