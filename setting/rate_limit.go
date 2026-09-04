package setting

import (
	"fmt"
	"math"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// maxRateLimitDurationSeconds is the largest window the count cap is computed
// against (24h). Token-bucket capacity is count*duration; this keeps that
// product inside int64 when the window is at most a day.
const maxRateLimitDurationSeconds = 24 * 60 * 60

// maxModelRequestRateLimitCount is math.MaxInt64 / maxRateLimitDurationSeconds.
// It is the largest count that cannot overflow int64(count)*duration for a
// window of at most 24 hours.
const maxModelRequestRateLimitCount int64 = math.MaxInt64 / maxRateLimitDurationSeconds

var ModelRequestRateLimitEnabled = false
var ModelRequestRateLimitDurationMinutes = 1
var ModelRequestRateLimitCount = 0
var ModelRequestRateLimitSuccessCount = 1000
var ModelRequestRateLimitGroup = map[string][2]int{}
var ModelRequestRateLimitMutex sync.RWMutex

// BalanceRateLimitTier 定义一个余额档位：余额达到 min_quota 的用户享受
// [total, success] 的限速额度。余额低于该分组所有档位的最低 min_quota 时，
// 该分组请求直接被拒（429）。
type BalanceRateLimitTier struct {
	MinQuota int64 `json:"min_quota"`
	Total    int   `json:"total"`
	Success  int   `json:"success"`
}

var ModelRequestRateLimitBalanceTier = map[string][]BalanceRateLimitTier{}

// Balance rate limit lookup states.
const (
	BalanceTierNotConfigured = iota
	BalanceTierBelowMinimum
	BalanceTierMatched
)

func ModelRequestRateLimitGroup2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitGroup)
	if err != nil {
		common.SysLog("error marshalling model ratio: " + err.Error())
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitGroupByJSONString(jsonStr string) error {
	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()

	ModelRequestRateLimitGroup = make(map[string][2]int)
	return common.Unmarshal([]byte(jsonStr), &ModelRequestRateLimitGroup)
}

func GetGroupRateLimit(group string) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	if ModelRequestRateLimitGroup == nil {
		return 0, 0, false
	}

	limits, found := ModelRequestRateLimitGroup[group]
	if !found {
		return 0, 0, false
	}
	return limits[0], limits[1], true
}

func CheckModelRequestRateLimitGroup(jsonStr string) error {
	checkModelRequestRateLimitGroup := make(map[string][2]int)
	err := common.Unmarshal([]byte(jsonStr), &checkModelRequestRateLimitGroup)
	if err != nil {
		return err
	}
	for group, limits := range checkModelRequestRateLimitGroup {
		if limits[0] < 0 || limits[1] < 1 {
			return fmt.Errorf("group %s has negative rate limit values: [%d, %d]", group, limits[0], limits[1])
		}
		if int64(limits[0]) > maxModelRequestRateLimitCount || int64(limits[1]) > maxModelRequestRateLimitCount {
			return fmt.Errorf("group %s [%d, %d] exceeds max rate limit %d", group, limits[0], limits[1], maxModelRequestRateLimitCount)
		}
	}

	return nil
}

func ModelRequestRateLimitBalanceTier2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := common.Marshal(ModelRequestRateLimitBalanceTier)
	if err != nil {
		common.SysLog("error marshalling balance rate limit: " + err.Error())
	}
	return string(jsonBytes)
}

func UpdateModelRequestRateLimitBalanceTierByJSONString(jsonStr string) error {
	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()

	ModelRequestRateLimitBalanceTier = make(map[string][]BalanceRateLimitTier)
	return common.Unmarshal([]byte(jsonStr), &ModelRequestRateLimitBalanceTier)
}

// GetBalanceRateLimit 按用户余额查询分组对应的限速档位。
// 返回 state（未配置 / 低于最低档 / 命中）以及命中档位的 total、success。
// 余额命中多个档位时取 min_quota 最大的那一档。
func GetBalanceRateLimit(group string, quota int64) (state int, total, success int) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	tiers, found := ModelRequestRateLimitBalanceTier[group]
	if !found || len(tiers) == 0 {
		return BalanceTierNotConfigured, 0, 0
	}

	matched := false
	var best BalanceRateLimitTier
	for _, tier := range tiers {
		if quota >= tier.MinQuota && (!matched || tier.MinQuota > best.MinQuota) {
			best = tier
			matched = true
		}
	}
	if !matched {
		return BalanceTierBelowMinimum, 0, 0
	}
	return BalanceTierMatched, best.Total, best.Success
}

func CheckModelRequestRateLimitBalanceTier(jsonStr string) error {
	checkBalanceTier := make(map[string][]BalanceRateLimitTier)
	err := common.Unmarshal([]byte(jsonStr), &checkBalanceTier)
	if err != nil {
		return err
	}
	for group, tiers := range checkBalanceTier {
		if len(tiers) == 0 {
			return fmt.Errorf("group %s has an empty tier list", group)
		}
		seen := make(map[int64]bool)
		for _, tier := range tiers {
			if tier.MinQuota < 0 {
				return fmt.Errorf("group %s tier has negative min_quota: %d", group, tier.MinQuota)
			}
			if tier.Total < 0 || tier.Success < 1 {
				return fmt.Errorf("group %s tier [%d, %d] must satisfy total >= 0 and success >= 1", group, tier.Total, tier.Success)
			}
			if int64(tier.Total) > maxModelRequestRateLimitCount || int64(tier.Success) > maxModelRequestRateLimitCount {
				return fmt.Errorf("group %s tier [%d, %d] exceeds max rate limit %d", group, tier.Total, tier.Success, maxModelRequestRateLimitCount)
			}
			if seen[tier.MinQuota] {
				return fmt.Errorf("group %s has duplicate min_quota: %d", group, tier.MinQuota)
			}
			seen[tier.MinQuota] = true
		}
	}

	return nil
}
