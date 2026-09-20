package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// 支持金额的绝对上限（本地货币）。
//
// 这是一道与 CustomMaxMoney 无关的硬闸：后台把 CustomMaxMoney 误填成
// 一个荒谬的大数时，仍然不能创建一个天价订单。用户提交的金额在进入
// 订单表之前必须先过这里。
const SponsorshipHardMaxMoney = 100000.0

// SponsorshipTier 一个固定支持档位。
//
// Money 是实付金额（本地货币），不经过任何额度换算 —— 支持是纯支出，
// 不进钱包余额、不加额度，所以这里不需要 QuotaPerUnit 之类的口径。
type SponsorshipTier struct {
	Id      string  `json:"id"`
	Label   string  `json:"label"`
	IconUrl string  `json:"icon_url"`
	Money   float64 `json:"money"`
}

// SponsorshipSetting 支持（赞助）功能的全部可调参数。
//
// 设计要点：
//   - 支持不是充值：付了钱不产生余额、不产生额度，只产生一条支持记录。
//     因此这里没有任何与 quota 相关的字段，也不需要计费安全那套换算。
//   - 档位只是"推荐金额"，自定义金额始终开放；档位存在的意义是降低决策成本。
//   - 称号与站点等级（welfare 分组余额档）完全独立：等级说"你用到什么程度"，
//     称号说"你和这个站是什么关系"。两者不共享阈值，也不互相驱动。
type SponsorshipSetting struct {
	Enabled bool   `json:"enabled"`
	Title   string `json:"title"`

	// 固定档位（前端按顺序渲染，与自定义档一起构成四个并列的选项）。
	Tiers []SponsorshipTier `json:"tiers"`

	// 自定义档（第四个选项）。
	//
	// 单独建模而不是塞进 Tiers 里靠 Money==0 区分：它的金额来自用户输入，
	// 走的是完全不同的校验路径（区间 + 硬上限），混在一起迟早会被误用。
	CustomLabel    string  `json:"custom_label"`
	CustomIconUrl  string  `json:"custom_icon_url"`
	CustomMinMoney float64 `json:"custom_min_money"`
	CustomMaxMoney float64 `json:"custom_max_money"`

	// ---- 筹集目标 ----
	//
	// 目标按月重置：口径是「本月收到的支持」对「每月固定开销」，与服务器、
	// API 这类持续支出对得上，达成后下月自动重新开始。刻意不做成一次性总额 ——
	// 一次性目标达成之后这一块就没内容可展示了，而月费是每个月都会再来一次的。
	//
	// 名称与目标金额都留成后台可配，不要写进代码：开销会变，
	// 让人改一次代码才能调整目标不合适。
	GoalEnabled     bool    `json:"goal_enabled"`
	GoalName        string  `json:"goal_name"`
	GoalTargetMoney float64 `json:"goal_target_money"`

	// 寄语。不写寄语时用 DefaultMessage 兜底，让名单里的每一格都有内容，
	// 不会出现一片空白。
	MaxMessageLength int    `json:"max_message_length"`
	DefaultMessage   string `json:"default_message"`

	// ---- 称号参数 ----
	//
	// 首期只发两个称号，且都必须有区分度：
	// "支持过"本身不是称号 —— 出现在名单里就已经是证明，人人都有等于没有。
	//
	// EarlySupporterDeadline 为 Unix 时间戳，<=0 表示不发放早期称号。
	EarlySupporterDeadline int64 `json:"early_supporter_deadline"`

	// ContinuousWindowMonths 个月内支持次数达到 ContinuousMinCount，即为持续支持。
	// 只看"最近有没有支持"不叫持续，必须有次数下限，称号才对得起它的名字。
	ContinuousWindowMonths int `json:"continuous_window_months"`
	ContinuousMinCount     int `json:"continuous_min_count"`
}

// 默认配置。
//
// 默认关闭：这是要花钱的功能，管理员显式开启比默认打开安全。
var sponsorshipSetting = SponsorshipSetting{
	Enabled: false,
	Title:   "支持 FlowBee",
	Tiers: []SponsorshipTier{
		{Id: "coffee", Label: "一杯咖啡", IconUrl: "https://img.remit.ee/i/iy8CP7nMOsgH", Money: 10},
		{Id: "cake", Label: "一份甜点", IconUrl: "https://img.remit.ee/i/hDmAPrXEtflC", Money: 30},
		{Id: "meal", Label: "一顿饭", IconUrl: "https://img.remit.ee/i/liwgI5R71BVT", Money: 50},
	},
	CustomLabel:    "自定义",
	CustomIconUrl:  "https://img.remit.ee/i/etqE1hhkxZXb",
	CustomMinMoney: 1,
	CustomMaxMoney: 2000,

	MaxMessageLength: 40,
	DefaultMessage:   "悄悄支持了一下",

	GoalEnabled:     true,
	GoalName:        "每月服务器与 API 开销",
	GoalTargetMoney: 1500,

	// 2026-10-17 23:59:59 +08:00：上线后一个月的窗口。
	// 现在是"人人都拿得到"，但它是永久的，以后来的人拿不到 —— 这正是它的作用。
	EarlySupporterDeadline: 1792252799,
	ContinuousWindowMonths: 2,
	ContinuousMinCount:     2,
}

func init() {
	config.GlobalConfig.Register("sponsorship_setting", &sponsorshipSetting)
}

// GetSponsorshipSetting 获取支持功能配置
func GetSponsorshipSetting() *SponsorshipSetting {
	return &sponsorshipSetting
}

// IsSponsorshipEnabled 支持功能是否开启
func IsSponsorshipEnabled() bool {
	return sponsorshipSetting.Enabled
}

// FindSponsorshipTier 按 id 查固定档位，不包含自定义档。
func (s *SponsorshipSetting) FindSponsorshipTier(id string) *SponsorshipTier {
	for i := range s.Tiers {
		if s.Tiers[i].Id == id && s.Tiers[i].Money > 0 {
			return &s.Tiers[i]
		}
	}
	return nil
}

// SponsorshipGoalTarget 返回筹集目标是否展示、以及目标金额。
//
// 两个条件同时成立才展示：开关打开，且目标金额是正数。后台把金额清成 0
// （还没想好填多少）时按"先不展示"处理，而不是在页面上显示一个 0 元的目标。
func (s *SponsorshipSetting) SponsorshipGoalTarget() (float64, bool) {
	if !s.GoalEnabled || s.GoalTargetMoney <= 0 {
		return 0, false
	}
	return s.GoalTargetMoney, true
}

// SponsorshipGoalName 返回目标名称，未配置时兜底一个中性的说法。
func (s *SponsorshipSetting) SponsorshipGoalName() string {
	if s.GoalName == "" {
		return "每月开销"
	}
	return s.GoalName
}

// SponsorshipMaxMessageLength 返回寄语长度上限（按字符数），未配置时兜底 40。
func (s *SponsorshipSetting) SponsorshipMaxMessageLength() int {
	if s.MaxMessageLength <= 0 {
		return 40
	}
	return s.MaxMessageLength
}

// SponsorshipDefaultMessage 返回空寄语的兜底文案。
func (s *SponsorshipSetting) SponsorshipDefaultMessage() string {
	if s.DefaultMessage == "" {
		return "悄悄支持了一下"
	}
	return s.DefaultMessage
}

// SponsorshipCustomBounds 返回自定义金额的允许区间 [min, max]。
//
// 返回值保证 0 < min <= max <= SponsorshipHardMaxMoney，所以后台把两项填反、
// 填 0 或填成天文数字时，调用方拿到的仍然是一个可用的区间，不需要各自兜底。
func (s *SponsorshipSetting) SponsorshipCustomBounds() (float64, float64) {
	minMoney := s.CustomMinMoney
	if minMoney <= 0 || minMoney > SponsorshipHardMaxMoney {
		minMoney = 1
	}
	maxMoney := s.CustomMaxMoney
	if maxMoney <= 0 || maxMoney > SponsorshipHardMaxMoney {
		maxMoney = SponsorshipHardMaxMoney
	}
	if maxMoney < minMoney {
		maxMoney = minMoney
	}
	return minMoney, maxMoney
}

// SponsorshipContinuousWindowMonths 返回持续称号的时间窗（月），未配置时兜底 2。
func (s *SponsorshipSetting) SponsorshipContinuousWindowMonths() int {
	if s.ContinuousWindowMonths <= 0 {
		return 2
	}
	return s.ContinuousWindowMonths
}

// SponsorshipContinuousMinCount 返回持续称号所需的支持次数，未配置时兜底 2。
//
// 兜底为 2 而不是 1：次数下限为 1 时"持续"退化成"最近支持过一次"，
// 称号就名不副实了。
func (s *SponsorshipSetting) SponsorshipContinuousMinCount() int {
	if s.ContinuousMinCount <= 0 {
		return 2
	}
	return s.ContinuousMinCount
}
