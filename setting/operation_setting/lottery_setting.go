package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// LotteryPrize 奖池中的一个奖品档位。
//
// Total 是该档位在整个活动周期内的总份数，它是「成本锁死」的来源：
// 无论来多少人抽，这一档最多只会发 Total 份，不存在超支可能。
//
// 注意：运行时剩余份数存在数据库表 lottery_prizes 里，不放在本配置中。
// 配置是可被后台覆盖的静态值，剩余份数是运行时状态，两者必须分开，
// 否则一次配置保存就会把已经发出去的份数重置回去（等于重复发放）。
//
// ReservedUserIds 是内定预留位：列在这里的用户抽奖时，只要该档位还有剩余，
// 就必定命中这一档。用于活动造势时让指定账号真实地抽到某个档位
// —— 关键是这一份仍然占用奖池名额、仍然真实经过抽奖接口，
// 所以奖池预览与中奖截图能对得上，不会出现「奖池里没有 5 元档却有人中了 5 元」的矛盾。
type LotteryPrize struct {
	Id              string `json:"id"`
	Name            string `json:"name"`
	Quota           int    `json:"quota"`
	Total           int    `json:"total"`
	Weight          int    `json:"weight"`
	ReservedUserIds []int  `json:"reserved_user_ids"`
}

// LotterySetting 抽奖活动的全部可调参数。
//
// 这里刻意做成「一套通用抽奖机制」而不是「一次生日活动」：活动名、奖池、
// 时间窗、分享文案全部可配，换一期活动只需要改配置，不需要改代码。
//
// 设计要点：
//   - 不做「第一次必中」——所有档位都是固定份数，总成本 = Σ(份数 × 面值)，一分钱不会超。
//   - 不做「按概率发奖」——用份数 + Pacing 控制节奏，比概率更直观也更好算。
//   - PacingSlack 负责把奖品摊到整个活动周期，避免前两小时被清空。
type LotterySetting struct {
	Enabled bool   `json:"enabled"`
	Title   string `json:"title"`

	// StartTime / EndTime 为 Unix 时间戳。EndTime <= 0 视为活动未配置完成，
	// 一律不可抽奖 —— 这是刻意的保守默认：宁可活动不开，也不能因为漏配结束时间而永久开放。
	StartTime int64 `json:"start_time"`
	EndTime   int64 `json:"end_time"`

	// MaxDrawsPerUser 每人最多抽几次（含分享获得的机会）。
	// 由 lottery_draws 表上的 (user_id, round_key, draw_date, seq) 唯一索引保证，
	// 不依赖业务层的判断，避免并发绕过。
	MaxDrawsPerUser int `json:"max_draws_per_user"`

	// FreeDrawsPerUser 无需任何前置动作即可抽取的次数。
	// 超出部分需要先完成一次「分享」动作解锁（记录在 lottery_shares 表）。
	//
	// 这一项存在的意义只有一个：让「分享再抽一次」成为服务端约束。
	// 如果只写在前端文案里，用户直接调接口就能跳过分享拿到第二次机会
	// —— 那这个活动设计就不成立了。
	FreeDrawsPerUser int `json:"free_draws_per_user"`

	// PacingSlack 平滑松弛系数，1.0 为严格线性；大于 1 给前期留呼吸空间。
	PacingSlack float64 `json:"pacing_slack"`

	// ShareText 分享按钮复制到剪贴板的文案。
	//
	// 复制的是「一段话」而不是一个链接：链接丢进群里没人点，一段带品牌与利益点
	// 的话才会被转发和二次复制。文案本身必须带上站点域名，否则转发出去无法回流。
	ShareText string `json:"share_text"`

	// ---- token 折算单价（仅用于展示，不参与任何真实计费）----
	//
	// 展示用的「≈ X 万 token」是由额度反推出来的，需要一条综合单价。
	// 这条单价不去拍脑袋，而是按 deepseek-flash 的现行公开价 + 本站实际调用条件算出来。
	// 各字段的语义与计算方式见 LotteryAnchorPricePerMillion。
	AnchorInputPricePerMillion  float64 `json:"anchor_input_price_per_million"`
	AnchorOutputPricePerMillion float64 `json:"anchor_output_price_per_million"`
	AnchorCachePricePerMillion  float64 `json:"anchor_cache_price_per_million"`
	AnchorCacheHitRate          float64 `json:"anchor_cache_hit_rate"`
	AnchorOutputShare           float64 `json:"anchor_output_share"`
	AnchorGroupRatio            float64 `json:"anchor_group_ratio"`

	Prizes []LotteryPrize `json:"prizes"`
}

// 默认配置（¥30 预算的一套示例参数）
//
// 奖池：大杯 ¥5 × 1（内定预留）+ 小惊喜 ¥2 × 8 + 小福袋 ¥0.2 × 45 = ¥30
// 档次刻意不放 ¥0.5：在固定份数模型下「概率高」就等于「份数多」，
// ¥0.5 在传播（不如 ¥2）与覆盖（不如 2.5 个 ¥0.2）两头都不占优，属于纯中间损耗。
//
// 额度换算基准：QuotaPerUnit=500000、USDExchangeRate=7.3，即 ¥1 ≈ 68,493 额度。
var lotterySetting = LotterySetting{
	Enabled:         false,
	Title:           "福利抽奖",
	StartTime:       0,
	EndTime:         0,
	MaxDrawsPerUser: 2,
	// 免费 1 次；第 2 次必须先完成分享动作。
	FreeDrawsPerUser: 1,
	PacingSlack:      1.3,
	ShareText:        "快来flowbee瓜分福利，免费ai额度，尽在flowbee.top",
	// deepseek-flash 现行价：输入 ¥1 / 输出 ¥4 / 缓存命中 ¥0.02（每百万 token）。
	AnchorInputPricePerMillion:  1,
	AnchorOutputPricePerMillion: 4,
	AnchorCachePricePerMillion:  0.02,
	// 高缓存场景：agent / 长上下文下前缀缓存命中率很高。
	AnchorCacheHitRate: 0.9,
	// 输出 token 占总量约 10%（输出单价高但体量小）。
	AnchorOutputShare: 0.1,
	// 「flowbee专属补贴」分组倍率 0.3，即 3 折价格。
	AnchorGroupRatio: 0.3,
	Prizes: []LotteryPrize{
		{
			Id:    "grand",
			Name:  "大杯",
			Quota: 342500, // ≈ ¥5
			Total: 1,
			// 内定预留位：活动造势账号，抽奖时必定命中本档。
			ReservedUserIds: []int{36},
		},
		{
			Id:     "lucky",
			Name:   "小惊喜",
			Quota:  137000, // ≈ ¥2
			Total:  8,
			Weight: 1,
		},
		{
			Id:     "daily",
			Name:   "小福袋",
			Quota:  13700, // ≈ ¥0.2
			Total:  45,
			Weight: 1,
		},
	},
}

func init() {
	config.GlobalConfig.Register("lottery_setting", &lotterySetting)
}

// GetLotterySetting 获取抽奖配置
func GetLotterySetting() *LotterySetting {
	return &lotterySetting
}

// IsLotteryEnabled 活动是否开启
func IsLotteryEnabled() bool {
	return lotterySetting.Enabled
}

// LotteryTotalPrizes 奖池总份数（成本硬上限的依据）
func (s *LotterySetting) LotteryTotalPrizes() int {
	total := 0
	for _, p := range s.Prizes {
		if p.Total > 0 {
			total += p.Total
		}
	}
	return total
}

// LotteryMaxDrawsPerUser 返回每人次数上限，未配置时兜底为 1，避免出现「无限抽」。
func (s *LotterySetting) LotteryMaxDrawsPerUser() int {
	if s.MaxDrawsPerUser <= 0 {
		return 1
	}
	return s.MaxDrawsPerUser
}

// LotteryFreeDrawsPerUser 返回无需分享即可抽取的次数。
//
// 兜底为 1，并夹在 [1, MaxDrawsPerUser] 区间内：免费次数超过上限时直接等于上限，
// 相当于本活动不设分享门槛，也不会出现「免费次数比上限还多」这种矛盾配置。
func (s *LotterySetting) LotteryFreeDrawsPerUser() int {
	maxDraws := s.LotteryMaxDrawsPerUser()
	if s.FreeDrawsPerUser <= 0 {
		return 1
	}
	if s.FreeDrawsPerUser > maxDraws {
		return maxDraws
	}
	return s.FreeDrawsPerUser
}

// LotteryAnchorPricePerMillion 计算展示用的综合单价（人民币 / 百万 token）。
//
// 公式（全部以「一百万 token」为单位）：
//
//	输入部分 = (1 - 输出占比) × [缓存命中率 × 缓存价 + (1 - 缓存命中率) × 输入价]
//	输出部分 = 输出占比 × 输出价
//	综合单价 = (输入部分 + 输出部分) × 分组倍率
//
// 两个假设值得单独说明，它们对结果的影响远大于单价本身：
//   - 缓存命中率默认 0.9。这一档单价（¥0.02）比输入价低两个数量级，
//     agent / 长上下文场景下命中率很高，所以它才是把综合单价压下来的主因。
//   - 输出占比默认 0.1。输出单价是输入价的 4 倍，但输出 token 数远少于输入，
//     取 0.1 是「对话为主、agent 为辅」的折中口径。
//
// 这两个假设是估算口径，不是计费依据：展示的 token 数只用于放大感知，
// 真实扣费仍然走 model_ratio，与这里完全无关。
//
// 全部字段为 0（配置未填）时兜底返回 1 元/百万，避免出现除零或荒谬的巨大数字。
func (s *LotterySetting) LotteryAnchorPricePerMillion() float64 {
	hit := clampLotteryRatio(s.AnchorCacheHitRate)
	outputShare := clampLotteryRatio(s.AnchorOutputShare)

	inputPart := (1 - outputShare) *
		(hit*s.AnchorCachePricePerMillion + (1-hit)*s.AnchorInputPricePerMillion)
	outputPart := outputShare * s.AnchorOutputPricePerMillion

	groupRatio := s.AnchorGroupRatio
	if groupRatio <= 0 {
		groupRatio = 1
	}

	price := (inputPart + outputPart) * groupRatio
	if price <= 0 {
		return 1
	}
	return price
}

// clampLotteryRatio 把比值类参数夹到 [0, 1]，防止后台误填出「命中率 1.5」这种值。
func clampLotteryRatio(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// FindLotteryPrize 按 id 查档位
func (s *LotterySetting) FindLotteryPrize(id string) *LotteryPrize {
	for i := range s.Prizes {
		if s.Prizes[i].Id == id {
			return &s.Prizes[i]
		}
	}
	return nil
}

// IsLotteryPrizeReservedFor 判断某档位是否把该用户列为内定预留位
func (p *LotteryPrize) IsLotteryPrizeReservedFor(userId int) bool {
	for _, id := range p.ReservedUserIds {
		if id == userId {
			return true
		}
	}
	return false
}
