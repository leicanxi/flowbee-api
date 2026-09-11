package model

import (
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"math"
	"math/big"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// ============================================================================
// 生日抽奖：数据层
//
// 设计要点（与签到 checkin 的关键差异）：
//  1. 不做「第一次必中」。所有档位都是固定份数，总成本 = Σ(份数 × 面值)，
//     一分钱不可能超支。必中会让「第一次」变成可预测的安慰奖，用户传一句话就废掉了。
//  2. 不发兑换码、不预生成码池。抽中直接把额度写进 user.quota，天然原子、
//     不需要「已发放未兑换」这种中间状态，也不会产生可流转的凭据。
//  3. 次数上限由 (user_id, draw_date, seq) 唯一索引保证，不靠业务层判断。
//  4. 未中奖也写记录 —— seq 记的是「抽了一次」而不是「中了一次」。
// ============================================================================

// ============================================================================
// 表定义
// ============================================================================

// LotteryPrizeStock 奖池库存（运行时状态）。
//
// 库存为什么必须单独建表、不能放配置里：配置是可被后台整体覆盖的静态结构体，
// 一次保存就会重建一遍；而「还剩几份」是运行时可变的持久状态。
// 两者混在一起，会出现「改一次配置，已经发出去的份数全部复活」的严重问题。
//
// RoundKey 区分活动轮次（取活动开始时间戳）。换期活动会新建一组库存行，
// 历史活动的库存与记录都保留，便于事后导出回查。
type LotteryPrizeStock struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	RoundKey  string `json:"round_key" gorm:"type:varchar(32);not null;uniqueIndex:idx_lottery_round_prize"`
	PrizeId   string `json:"prize_id" gorm:"type:varchar(64);not null;uniqueIndex:idx_lottery_round_prize"`
	Name      string `json:"name" gorm:"type:varchar(64)"`
	Quota     int    `json:"quota"`
	Total     int    `json:"total"`
	Weight    int    `json:"weight"`
	Remaining int    `json:"remaining"`
}

func (LotteryPrizeStock) TableName() string {
	return "lottery_prizes"
}

// LotteryDraw 抽奖记录。
//
// 唯一索引 (user_id, round_key, draw_date, seq) 是次数上限的唯一保证：第 N+1 次请求
// 会因为 seq 冲突插不进去，不需要在业务层写「先查次数再决定」那种
// 在并发下必被绕过的判断。
//
// round_key 必须进入索引：活动是「一轮一轮」的，重配一次活动时间就是新一轮。
// 不含 round_key 的话，同一天内调整活动时间会让老轮次的 seq 占住位置，
// 导致新一轮全员显示「次数已用完」—— 这个坑只有在测试时才会发现。
type LotteryDraw struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_lottery_user_round_seq"`
	RoundKey     string `json:"round_key" gorm:"type:varchar(32);not null;index;uniqueIndex:idx_lottery_user_round_seq"`
	DrawDate     string `json:"draw_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_lottery_user_round_seq"`
	Seq          int    `json:"seq" gorm:"not null;uniqueIndex:idx_lottery_user_round_seq"`
	PrizeId      string `json:"prize_id" gorm:"type:varchar(64)"`
	PrizeName    string `json:"prize_name" gorm:"type:varchar(64)"`
	QuotaAwarded int    `json:"quota_awarded"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
}

func (LotteryDraw) TableName() string {
	return "lottery_draws"
}

// LotteryShare 分享解锁记录。
//
// 为什么需要这张表：免费次数之外的抽奖机会必须由「一个真实发生过的动作」来解锁，
// 否则「分享再抽一次」就只是前端文案，调一次接口就能绕过去。
//
// 唯一的索引 (user_id, round_key) 让分享天然幂等：重复点击、连点、重放请求
// 都只会得到一条记录，不会攒出多次机会。分享本身无法在服务端验证真伪，
// 所以这里校验的是「用户点过分享」而不是「分享确实生效了」——
// 这一层弱校验是刻意的，够用且成本最低。
type LotteryShare struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"not null;uniqueIndex:idx_lottery_share_user_round"`
	RoundKey  string `json:"round_key" gorm:"type:varchar(32);not null;uniqueIndex:idx_lottery_share_user_round"`
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
}

func (LotteryShare) TableName() string {
	return "lottery_shares"
}

// ============================================================================
// 错误
// ============================================================================

var (
	ErrLotteryDisabled       = errors.New("抽奖活动未开启")
	ErrLotteryNotStarted     = errors.New("抽奖活动还未开始")
	ErrLotteryEnded          = errors.New("抽奖活动已结束")
	ErrLotteryDrawsExhausted = errors.New("抽奖次数已用完")
	ErrLotteryPrizeEmpty     = errors.New("奖品已发完")
	// ErrLotteryShareRequired 专门用于「还有机会，但需要先分享」这一种情况。
	// 它和 ErrLotteryDrawsExhausted 必须分开：前者把最后一次机会明明白白
	// 交到用户手上（文案+按钮能直接引导分享），后者只能让用户放弃。
	// 文案写在错误里是因为它会被直接透传给前端展示。
	ErrLotteryShareRequired = errors.New("分享给朋友后可再抽一次")
)

// ============================================================================
// 基础工具
// ============================================================================

// LotteryRoundKey 用活动开始时间作为轮次标识。
// 只要重新配置 StartTime，就自动进入新一轮，库存会重新初始化，
// 历史轮次的数据保留在表里可供导出。
func LotteryRoundKey(setting *operation_setting.LotterySetting) string {
	return fmt.Sprintf("r%d", setting.StartTime)
}

// secureRandomInt 返回 [0, n) 的密码学安全随机数。
//
// 刻意不用 math/rand：这是决定「发多少钱」的地方，math/rand 的全局源
// 在理论上是可预测的，一旦被推算出来，攻击者就能「只在会中的时刻抽」。
// crypto/rand 在这里没有任何性能代价。
func secureRandomInt(n int) int {
	if n <= 0 {
		return 0
	}
	v, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(n)))
	if err != nil {
		// 极端情况下退化为时间纳秒取模，保证不会 panic
		return int(time.Now().UnixNano() % int64(n))
	}
	return int(v.Int64())
}

// ============================================================================
// 分享解锁
// ============================================================================

// MarkLotteryShared 记录一次分享动作（幂等）。
//
// 返回 true 表示这次调用真的记上了（此前没分享过）。
// 重复调用不会报错也不会产生多条记录 —— (user_id, round_key) 唯一索引
// 让「连点分享按钮」和「重放请求」都无法攒出额外机会。
func MarkLotteryShared(userId int, roundKey string) (bool, error) {
	if userId <= 0 {
		return false, errors.New("无效的用户")
	}
	shared, err := HasUserLotteryShared(userId, roundKey)
	if err != nil {
		return false, err
	}
	if shared {
		return false, nil
	}
	record := LotteryShare{
		UserId:    userId,
		RoundKey:  roundKey,
		CreatedAt: time.Now().Unix(),
	}
	if err := DB.Create(&record).Error; err != nil {
		// 并发下会撞唯一索引，此时说明另一个请求已经记上了，按已分享处理
		if exists, e := HasUserLotteryShared(userId, roundKey); e == nil && exists {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// HasUserLotteryShared 用户在本轮活动中是否完成过分享动作。
func HasUserLotteryShared(userId int, roundKey string) (bool, error) {
	var count int64
	err := DB.Model(&LotteryShare{}).
		Where("user_id = ? AND round_key = ?", userId, roundKey).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// LotteryDrawQuota 计算用户当前实际可抽次数，以及分享是否已解锁。
//
// 免费次数人人都有；超出的部分需要分享动作解锁。这是「分享再抽一次」
// 唯一可信的服务端依据 —— 只做在前端的话，直接调接口就能跳过。
func LotteryDrawQuota(setting *operation_setting.LotterySetting, userId int, roundKey string) (allowed int, shared bool, err error) {
	allowed = setting.LotteryFreeDrawsPerUser()
	maxDraws := setting.LotteryMaxDrawsPerUser()
	if allowed >= maxDraws {
		return maxDraws, false, nil
	}
	shared, err = HasUserLotteryShared(userId, roundKey)
	if err != nil {
		return allowed, false, err
	}
	if shared {
		allowed = maxDraws
	}
	return allowed, shared, nil
}

// ============================================================================
// 库存初始化
// ============================================================================

// SyncLotteryPrizeStock 按配置把奖池同步进库存表（幂等）。
//
// 只补不追：
//   - 行不存在 → 新建，remaining = total
//   - 配置份数变大 → remaining 补足差额（相当于加奖品）
//   - 配置份数变小 → 只改 total，不动 remaining（已经发出去的不可能收回）
func SyncLotteryPrizeStock(roundKey string, prizes []operation_setting.LotteryPrize) error {
	for _, p := range prizes {
		if p.Total <= 0 {
			continue
		}
		weight := p.Weight
		if weight <= 0 {
			weight = 1
		}
		var stock LotteryPrizeStock
		err := DB.Where("round_key = ? AND prize_id = ?", roundKey, p.Id).First(&stock).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			stock = LotteryPrizeStock{
				RoundKey:  roundKey,
				PrizeId:   p.Id,
				Name:      p.Name,
				Quota:     p.Quota,
				Total:     p.Total,
				Weight:    weight,
				Remaining: p.Total,
			}
			if err := DB.Create(&stock).Error; err != nil {
				// 并发创建撞唯一索引属于正常情况，忽略
				continue
			}
			continue
		}
		if err != nil {
			return err
		}
		updates := map[string]interface{}{
			"name":   p.Name,
			"quota":  p.Quota,
			"weight": weight,
			"total":  p.Total,
		}
		if p.Total > stock.Total {
			updates["remaining"] = stock.Remaining + (p.Total - stock.Total)
		}
		if err := DB.Model(&LotteryPrizeStock{}).Where("id = ?", stock.Id).Updates(updates).Error; err != nil {
			return err
		}
	}
	return nil
}

// ============================================================================
// 抽奖核心
// ============================================================================

// lotteryPacingAllows 决定本次是否允许发放奖品。
//
// 固定份数解决了「总量」，但解决不了「节奏」—— 如果不加控制，
// 活动开头一小时来的人会把奖品全部抽走，后面的人连机会都没有。
//
// 允许发放量 = 总份数 × min(1, 时间进度 × 松弛系数)。
// 松弛系数给前期留呼吸空间：严格线性时活动刚开场允许量几乎为 0，
// 第一批用户会被莫名其妙地全部判为未中奖。
func lotteryPacingAllows(setting *operation_setting.LotterySetting, issued, total int, now int64) bool {
	if total <= 0 || issued >= total {
		return false
	}
	span := setting.EndTime - setting.StartTime
	if span <= 0 {
		return true
	}
	progress := float64(now-setting.StartTime) / float64(span)
	if progress < 0 {
		progress = 0
	}
	if progress > 1 {
		progress = 1
	}
	slack := setting.PacingSlack
	if slack <= 0 {
		slack = 1
	}
	permitted := float64(total) * math.Min(1, progress*slack)
	return float64(issued) < permitted
}

// chooseLotteryPrize 决定本次发放哪一档。返回 nil 表示未中奖（谢谢参与）。
func chooseLotteryPrize(setting *operation_setting.LotterySetting, stocks []LotteryPrizeStock, userId int, now int64) *LotteryPrizeStock {
	total, remaining := 0, 0
	for i := range stocks {
		total += stocks[i].Total
		remaining += stocks[i].Remaining
	}
	if remaining <= 0 {
		return nil
	}

	// 内定预留位优先，且刻意绕过 Pacing：
	// 预留位的用途是让指定账号必定拿到某一档（活动造势），
	// 如果还被 Pacing 拦住，会出现「抽好几次都拿不到」的尴尬。
	// 预留份仍占用奖池名额、仍走完整抽奖流程与库存扣减，
	// 所以奖池预览与中奖截图能对得上。
	for i := range stocks {
		if stocks[i].Remaining <= 0 {
			continue
		}
		prize := setting.FindLotteryPrize(stocks[i].PrizeId)
		if prize != nil && prize.IsLotteryPrizeReservedFor(userId) {
			return &stocks[i]
		}
	}

	if !lotteryPacingAllows(setting, total-remaining, total, now) {
		return nil
	}
	return weightedPickLotteryPrize(stocks)
}

// weightedPickLotteryPrize 按 (weight × 剩余份数) 加权随机选档。
//
// 用「剩余份数」参与加权是刻意的：份数多的档被抽中概率自然更高，
// 这正好符合「小额覆盖广、大额极稀有」的目标，不需要再手工配概率。
// weight 只是一个额外的手动微调旋钮，默认 1。
func weightedPickLotteryPrize(stocks []LotteryPrizeStock) *LotteryPrizeStock {
	totalWeight := 0
	for i := range stocks {
		if stocks[i].Remaining <= 0 {
			continue
		}
		w := stocks[i].Weight
		if w <= 0 {
			w = 1
		}
		totalWeight += w * stocks[i].Remaining
	}
	if totalWeight <= 0 {
		return nil
	}
	target := secureRandomInt(totalWeight)
	acc := 0
	for i := range stocks {
		if stocks[i].Remaining <= 0 {
			continue
		}
		w := stocks[i].Weight
		if w <= 0 {
			w = 1
		}
		acc += w * stocks[i].Remaining
		if target < acc {
			return &stocks[i]
		}
	}
	// 数值兜底
	for i := len(stocks) - 1; i >= 0; i-- {
		if stocks[i].Remaining > 0 {
			return &stocks[i]
		}
	}
	return nil
}

// UserLotteryDraw 执行一次抽奖。
//
// 返回的 LotteryDraw 中 QuotaAwarded 为 0 且 PrizeId 为空表示未中奖；
// 无论中奖与否都会消耗一次机会。
func UserLotteryDraw(userId int) (*LotteryDraw, error) {
	setting := operation_setting.GetLotterySetting()
	if !setting.Enabled {
		return nil, ErrLotteryDisabled
	}
	if userId <= 0 {
		return nil, errors.New("无效的用户")
	}
	now := time.Now().Unix()
	if setting.StartTime > 0 && now < setting.StartTime {
		return nil, ErrLotteryNotStarted
	}
	// EndTime <= 0 视为活动未配置完成，一律不可抽。
	// 这是刻意的保守默认：宁可活动不开，也不能因为漏配结束时间而永久开放。
	if setting.EndTime <= 0 || now > setting.EndTime {
		return nil, ErrLotteryEnded
	}

	roundKey := LotteryRoundKey(setting)
	if err := SyncLotteryPrizeStock(roundKey, setting.Prizes); err != nil {
		return nil, err
	}

	today := time.Now().Format("2006-01-02")

	allowed, _, err := LotteryDrawQuota(setting, userId, roundKey)
	if err != nil {
		return nil, err
	}
	drawnToday, err := CountUserLotteryDraws(userId, roundKey, today)
	if err != nil {
		return nil, err
	}
	if int(drawnToday) >= allowed {
		// 分清「真的用完了」和「分享就能再来一次」。
		// 后者不能让用户以为没机会了 —— 最后一次机会正是分享的动机。
		if int(drawnToday) < setting.LotteryMaxDrawsPerUser() {
			return nil, ErrLotteryShareRequired
		}
		return nil, ErrLotteryDrawsExhausted
	}
	seq := int(drawnToday) + 1

	var stocks []LotteryPrizeStock
	if err := DB.Where("round_key = ?", roundKey).Find(&stocks).Error; err != nil {
		return nil, err
	}

	draw := &LotteryDraw{
		UserId:    userId,
		RoundKey:  roundKey,
		DrawDate:  today,
		Seq:       seq,
		CreatedAt: now,
	}

	if len(stocks) > 0 {
		if prize := chooseLotteryPrize(setting, stocks, userId, now); prize != nil {
			draw.PrizeId = prize.PrizeId
			draw.PrizeName = prize.Name
			draw.QuotaAwarded = prize.Quota
		}
	}

	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return userLotteryDrawNoTx(draw, userId, stocks)
	}
	return userLotteryDrawWithTx(draw, userId, stocks)
}

// userLotteryDrawWithTx 使用事务（MySQL / PostgreSQL）。
func userLotteryDrawWithTx(draw *LotteryDraw, userId int, stocks []LotteryPrizeStock) (*LotteryDraw, error) {
	var picked *LotteryPrizeStock
	if draw.PrizeId != "" {
		for i := range stocks {
			if stocks[i].PrizeId == draw.PrizeId {
				picked = &stocks[i]
				break
			}
		}
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		// 1. 写抽奖记录：唯一索引 (user_id, draw_date, seq) 会挡住并发重复与超限
		if err := tx.Create(draw).Error; err != nil {
			return ErrLotteryDrawsExhausted
		}

		if picked == nil {
			return nil
		}

		// 2. CAS 扣库存：绝不能「先查剩余再扣」，否则并发请求会发出同一份
		res := tx.Model(&LotteryPrizeStock{}).
			Where("id = ? AND remaining > 0", picked.Id).
			UpdateColumn("remaining", gorm.Expr("remaining - 1"))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// 这一份刚被并发请求抢走，本次降级为未中奖（记录保留，仍消耗次数）
			draw.PrizeId = ""
			draw.PrizeName = ""
			draw.QuotaAwarded = 0
			return nil
		}

		// 3. 入账
		if err := tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota + ?", picked.Quota)).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if draw.QuotaAwarded > 0 {
		go func() {
			_ = cacheIncrUserQuota(userId, int64(draw.QuotaAwarded))
		}()
	}
	return draw, nil
}

// userLotteryDrawNoTx 不使用事务（SQLite 不支持嵌套事务）。
func userLotteryDrawNoTx(draw *LotteryDraw, userId int, stocks []LotteryPrizeStock) (*LotteryDraw, error) {
	if err := DB.Create(draw).Error; err != nil {
		return nil, ErrLotteryDrawsExhausted
	}
	if draw.PrizeId == "" {
		return draw, nil
	}

	var picked *LotteryPrizeStock
	for i := range stocks {
		if stocks[i].PrizeId == draw.PrizeId {
			picked = &stocks[i]
			break
		}
	}
	if picked == nil {
		return draw, nil
	}

	res := DB.Model(&LotteryPrizeStock{}).
		Where("id = ? AND remaining > 0", picked.Id).
		UpdateColumn("remaining", gorm.Expr("remaining - 1"))
	if res.Error != nil {
		DB.Delete(draw)
		return nil, res.Error
	}

	clearPrize := func() {
		draw.PrizeId = ""
		draw.PrizeName = ""
		draw.QuotaAwarded = 0
		DB.Model(draw).Select("prize_id", "prize_name", "quota_awarded").Updates(draw)
	}

	if res.RowsAffected == 0 {
		// 被并发抢走，降级为未中奖
		clearPrize()
		return draw, nil
	}

	// db=true 强制直接写库，不使用批量更新，保证读到的额度立刻是最新的
	if err := IncreaseUserQuota(userId, picked.Quota, true); err != nil {
		// 入账失败 → 归还库存并降级为未中奖，避免「扣了份数但没给额度」
		DB.Model(&LotteryPrizeStock{}).Where("id = ?", picked.Id).
			UpdateColumn("remaining", gorm.Expr("remaining + 1"))
		clearPrize()
		return draw, nil
	}
	return draw, nil
}

// ============================================================================
// 查询
// ============================================================================

// GetLotteryStockStats 返回当前轮次的份数统计，用于前端展示进度与后端熔断判断。
func GetLotteryStockStats(roundKey string) (total int, remaining int, err error) {
	var stocks []LotteryPrizeStock
	if err = DB.Where("round_key = ?", roundKey).Find(&stocks).Error; err != nil {
		return 0, 0, err
	}
	for i := range stocks {
		total += stocks[i].Total
		remaining += stocks[i].Remaining
	}
	return total, remaining, nil
}

// GetUserLotteryDraws 取某用户在当前轮次的抽奖记录（倒序）。
func GetUserLotteryDraws(userId int, roundKey string) ([]LotteryDraw, error) {
	var draws []LotteryDraw
	err := DB.Where("user_id = ? AND round_key = ?", userId, roundKey).
		Order("seq ASC").Find(&draws).Error
	return draws, err
}

// CountUserLotteryDraws 返回用户本轮活动、指定日期已抽次数。
//
// 必须带上 round_key：次数上限是「每轮活动、每天 N 次」，
// 只按 user_id + draw_date 统计会让上一轮活动占住当天的名额。
func CountUserLotteryDraws(userId int, roundKey string, date string) (int64, error) {
	var count int64
	err := DB.Model(&LotteryDraw{}).
		Where("user_id = ? AND round_key = ? AND draw_date = ?", userId, roundKey, date).
		Count(&count).Error
	return count, err
}

// ============================================================================
// 导出（供运营在活动后做「倒霉蛋补偿」）
// ============================================================================

// LotteryDrawStat 按用户聚合的抽奖统计。
type LotteryDrawStat struct {
	UserId     int   `json:"user_id"`
	DrawCount  int64 `json:"draw_count"`
	WinCount   int64 `json:"win_count"`
	TotalQuota int64 `json:"total_quota"`
	LastDrawAt int64 `json:"last_draw_at"`
}

// GetLotteryDrawStats 按用户聚合当前轮次的抽奖情况。
func GetLotteryDrawStats(roundKey string) ([]LotteryDrawStat, error) {
	var stats []LotteryDrawStat
	err := DB.Model(&LotteryDraw{}).
		Select(`user_id,
			COUNT(*) AS draw_count,
			SUM(CASE WHEN quota_awarded > 0 THEN 1 ELSE 0 END) AS win_count,
			COALESCE(SUM(quota_awarded), 0) AS total_quota,
			MAX(created_at) AS last_draw_at`).
		Where("round_key = ?", roundKey).
		Group("user_id").
		Scan(&stats).Error
	return stats, err
}

// GetLotteryWinners 中奖明细（含奖项与时间），按时间正序。
func GetLotteryWinners(roundKey string) ([]LotteryDraw, error) {
	var draws []LotteryDraw
	err := DB.Where("round_key = ? AND quota_awarded > 0", roundKey).
		Order("created_at ASC").Find(&draws).Error
	return draws, err
}

// GetLotteryHourlyDistribution 按小时统计发放情况，用于判断奖品是否被前置消耗。
// 返回 map[小时] = {份数, 额度}
func GetLotteryHourlyDistribution(roundKey string) (map[int]map[string]int64, error) {
	type row struct {
		Hour  int   `json:"hour"`
		Count int64 `json:"count"`
		Quota int64 `json:"quota"`
	}
	var rows []row
	err := DB.Model(&LotteryDraw{}).
		Select(`CAST((created_at % 86400) / 3600 AS INTEGER) AS hour,
			COUNT(*) AS count,
			COALESCE(SUM(quota_awarded), 0) AS quota`).
		Where("round_key = ? AND quota_awarded > 0", roundKey).
		Group("hour").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]map[string]int64, len(rows))
	for _, r := range rows {
		result[r.Hour] = map[string]int64{"count": r.Count, "quota": r.Quota}
	}
	return result, nil
}
