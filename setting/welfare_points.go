package setting

import (
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// maxWelfarePointsValue bounds every configured point amount. Points are a
// virtual, non-monetary unit, but they still become an int in the database and
// in arithmetic, so an accidentally huge admin value must not be able to
// overflow grant/charge math.
const maxWelfarePointsValue = 1_000_000_000

// WelfarePointsConsumeTier maps yesterday's wallet consumption to a one-off
// permanent-points grant. The highest tier whose MinQuota is reached wins.
type WelfarePointsConsumeTier struct {
	MinQuota int `json:"min_quota"`
	Points   int `json:"points"`
}

// WelfarePointsSetting is the single JSON-editable configuration for the
// welfare points economy.
//
// Two buckets exist:
//   - daily: daily base + check-in points, reset every day;
//   - permanent: invite, consumption rebate and sponsorship points, never
//     expire.
//
// ModelCosts maps a model name to the points charged for one successful call.
// An exact match wins, then the longest trailing-"*" prefix, then "default".
type WelfarePointsSetting struct {
	Enabled bool   `json:"enabled"`
	Group   string `json:"group"`

	// SubsidyGroups 是概览页「站长补贴」的统计口径：这些分组的价格低于牌价，
	// 差额由站长承担。不在这里列出的分组，折扣不会被算成补贴。
	SubsidyGroups []string `json:"subsidy_groups"`

	DailyBasePoints int `json:"daily_base_points"`

	ModelCosts   map[string]int             `json:"model_costs"`
	ConsumeTiers []WelfarePointsConsumeTier `json:"consume_tiers"`

	CheckinMinPoints int `json:"checkin_min_points"`
	CheckinMaxPoints int `json:"checkin_max_points"`

	InviteePoints int `json:"invitee_points"`
	InviterPoints int `json:"inviter_points"`
	SponsorPoints int `json:"sponsor_points"`
}

var (
	welfarePointsMutex   sync.RWMutex
	subsidyGroupsDefault = []string{"flowbee专属补贴", "国模企业补贴"}
	welfarePointsSetting = WelfarePointsSetting{
		Enabled:          false,
		Group:            "福利",
		SubsidyGroups:    subsidyGroupsDefault,
		DailyBasePoints:  0,
		ModelCosts:       map[string]int{"default": 1},
		ConsumeTiers:     []WelfarePointsConsumeTier{{MinQuota: 0, Points: 0}},
		CheckinMinPoints: 0,
		CheckinMaxPoints: 0,
		InviteePoints:    0,
		InviterPoints:    0,
		SponsorPoints:    0,
	}
)

func normalizeWelfarePointsSetting(s *WelfarePointsSetting) {
	if s.Group == "" {
		s.Group = "福利"
	}
	if len(s.SubsidyGroups) == 0 {
		s.SubsidyGroups = append([]string(nil), subsidyGroupsDefault...)
	}
	if s.ModelCosts == nil {
		s.ModelCosts = map[string]int{"default": 1}
	}
	if s.ConsumeTiers == nil {
		s.ConsumeTiers = []WelfarePointsConsumeTier{{MinQuota: 0, Points: 0}}
	}
}

func copyWelfarePointsSetting(s WelfarePointsSetting) WelfarePointsSetting {
	out := s
	out.ModelCosts = make(map[string]int, len(s.ModelCosts))
	for k, v := range s.ModelCosts {
		out.ModelCosts[k] = v
	}
	out.SubsidyGroups = append([]string(nil), s.SubsidyGroups...)
	out.ConsumeTiers = make([]WelfarePointsConsumeTier, len(s.ConsumeTiers))
	copy(out.ConsumeTiers, s.ConsumeTiers)
	return out
}

func validateWelfarePointAmount(name string, value int) error {
	if value < 0 {
		return fmt.Errorf("%s must not be negative: %d", name, value)
	}
	if value > maxWelfarePointsValue {
		return fmt.Errorf("%s exceeds max %d: %d", name, maxWelfarePointsValue, value)
	}
	return nil
}

// CheckWelfarePointsSetting validates a JSON payload without applying it.
func CheckWelfarePointsSetting(jsonStr string) error {
	var candidate WelfarePointsSetting
	if err := common.Unmarshal([]byte(jsonStr), &candidate); err != nil {
		return err
	}
	normalizeWelfarePointsSetting(&candidate)

	if candidate.Group == "" {
		return fmt.Errorf("welfare points group must not be empty")
	}
	if err := validateWelfarePointAmount("daily_base_points", candidate.DailyBasePoints); err != nil {
		return err
	}
	if err := validateWelfarePointAmount("checkin_min_points", candidate.CheckinMinPoints); err != nil {
		return err
	}
	if err := validateWelfarePointAmount("checkin_max_points", candidate.CheckinMaxPoints); err != nil {
		return err
	}
	if candidate.CheckinMaxPoints < candidate.CheckinMinPoints {
		return fmt.Errorf("checkin_max_points must be >= checkin_min_points")
	}
	if err := validateWelfarePointAmount("invitee_points", candidate.InviteePoints); err != nil {
		return err
	}
	if err := validateWelfarePointAmount("inviter_points", candidate.InviterPoints); err != nil {
		return err
	}
	if err := validateWelfarePointAmount("sponsor_points", candidate.SponsorPoints); err != nil {
		return err
	}

	for model, cost := range candidate.ModelCosts {
		if strings.TrimSpace(model) == "" {
			return fmt.Errorf("model_costs contains an empty model name")
		}
		if err := validateWelfarePointAmount("model_costs."+model, cost); err != nil {
			return err
		}
	}
	seenSubsidyGroups := make(map[string]bool, len(candidate.SubsidyGroups))
	for _, group := range candidate.SubsidyGroups {
		name := strings.TrimSpace(group)
		if name == "" {
			return fmt.Errorf("subsidy_groups contains an empty group name")
		}
		if seenSubsidyGroups[name] {
			return fmt.Errorf("subsidy_groups has duplicate group: %s", name)
		}
		seenSubsidyGroups[name] = true
	}
	if candidate.Enabled {
		if _, ok := candidate.ModelCosts["default"]; !ok {
			return fmt.Errorf("model_costs.default is required when welfare points are enabled")
		}
	}

	seenTiers := make(map[int]bool, len(candidate.ConsumeTiers))
	for _, tier := range candidate.ConsumeTiers {
		if tier.MinQuota < 0 {
			return fmt.Errorf("consume_tiers min_quota must not be negative: %d", tier.MinQuota)
		}
		if err := validateWelfarePointAmount("consume_tiers.points", tier.Points); err != nil {
			return err
		}
		if seenTiers[tier.MinQuota] {
			return fmt.Errorf("consume_tiers has duplicate min_quota: %d", tier.MinQuota)
		}
		seenTiers[tier.MinQuota] = true
	}

	return nil
}

func WelfarePointsSetting2JSONString() string {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()

	jsonBytes, err := common.Marshal(welfarePointsSetting)
	if err != nil {
		common.SysLog("error marshalling welfare points setting: " + err.Error())
		return "{}"
	}
	return string(jsonBytes)
}

func UpdateWelfarePointsSettingByJSONString(jsonStr string) error {
	var next WelfarePointsSetting
	if err := common.Unmarshal([]byte(jsonStr), &next); err != nil {
		return err
	}
	normalizeWelfarePointsSetting(&next)

	welfarePointsMutex.Lock()
	defer welfarePointsMutex.Unlock()
	welfarePointsSetting = next
	return nil
}

func GetWelfarePointsSetting() WelfarePointsSetting {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	return copyWelfarePointsSetting(welfarePointsSetting)
}

func GetWelfarePointsEnabled() bool {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	return welfarePointsSetting.Enabled
}

func GetWelfarePointsGroup() string {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	if welfarePointsSetting.Group == "" {
		return "福利"
	}
	return welfarePointsSetting.Group
}

// GetWelfarePointsSubsidyGroups 返回概览「站长补贴」统计的分组名。
// 与福利分组重名的项会被剔除：同一个分组不能既算免费又算补贴。
func GetWelfarePointsSubsidyGroups() []string {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	groups := welfarePointsSetting.SubsidyGroups
	if len(groups) == 0 {
		groups = subsidyGroupsDefault
	}
	out := make([]string, 0, len(groups))
	for _, group := range groups {
		if group == "" || group == welfarePointsSetting.Group {
			continue
		}
		out = append(out, group)
	}
	return out
}

func GetWelfareDailyBasePoints() int {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	if !welfarePointsSetting.Enabled {
		return 0
	}
	return welfarePointsSetting.DailyBasePoints
}

func GetWelfareCheckinPoints() (min, max int) {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	if !welfarePointsSetting.Enabled {
		return 0, 0
	}
	return welfarePointsSetting.CheckinMinPoints, welfarePointsSetting.CheckinMaxPoints
}

func GetWelfareInviteePoints() int {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	if !welfarePointsSetting.Enabled {
		return 0
	}
	return welfarePointsSetting.InviteePoints
}

func GetWelfareInviterPoints() int {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	if !welfarePointsSetting.Enabled {
		return 0
	}
	return welfarePointsSetting.InviterPoints
}

func GetWelfareSponsorPoints() int {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()
	if !welfarePointsSetting.Enabled {
		return 0
	}
	return welfarePointsSetting.SponsorPoints
}

// GetWelfarePointCost resolves the per-call point cost for a model.
// It returns 0 when points are disabled or the cost is not configured as a
// positive number. The admin validator requires "default", so a missing
// default is a misconfiguration rather than a normal path.
func GetWelfarePointCost(modelName string) int {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()

	if !welfarePointsSetting.Enabled {
		return 0
	}

	if cost, ok := welfarePointsSetting.ModelCosts[modelName]; ok {
		if cost < 0 {
			return 0
		}
		return cost
	}

	bestPrefix := ""
	bestCost := 0
	for pattern, cost := range welfarePointsSetting.ModelCosts {
		if !strings.HasSuffix(pattern, "*") {
			continue
		}
		prefix := strings.TrimSuffix(pattern, "*")
		if prefix == "" || !strings.HasPrefix(modelName, prefix) {
			continue
		}
		if len(prefix) > len(bestPrefix) {
			bestPrefix = prefix
			bestCost = cost
		}
	}
	if bestPrefix != "" {
		if bestCost < 0 {
			return 0
		}
		return bestCost
	}

	cost, ok := welfarePointsSetting.ModelCosts["default"]
	if !ok || cost < 0 {
		return 0
	}
	return cost
}

// GetWelfareConsumeTierPoints returns the points for the highest tier whose
// min_quota is reached by the given consumption. It deliberately does not
// scale proportionally: tiers are a product decision, not a rate.
func GetWelfareConsumeTierPoints(quota int) int {
	welfarePointsMutex.RLock()
	defer welfarePointsMutex.RUnlock()

	if !welfarePointsSetting.Enabled {
		return 0
	}

	tiers := make([]WelfarePointsConsumeTier, len(welfarePointsSetting.ConsumeTiers))
	copy(tiers, welfarePointsSetting.ConsumeTiers)
	sort.Slice(tiers, func(i, j int) bool {
		return tiers[i].MinQuota < tiers[j].MinQuota
	})

	points := 0
	for _, tier := range tiers {
		if quota >= tier.MinQuota {
			points = tier.Points
		}
	}
	return points
}
