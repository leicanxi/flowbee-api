package model

import (
	"fmt"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm/clause"
)

// OverviewDailyStat 是概览页「开始使用」卡片用的按天聚合。
//
// 为什么不在请求时累加、也不在概览里现算：
//   - 概览要的是「近 30 天」，现算就得按用户扫 30 天日志，而福利分组的
//     logs.quota 恒为 0（分组倍率 0），真实价值只能从 other 这个 JSON 列里
//     按当时记录的 model_ratio 还原。跨库 JSON 抽取是移植性陷阱，所以只在
//     master 的定时任务里用 Go 解析一次，概览只读聚合结果。
//   - 请求时累加会给热路径加一次库写，福利分组恰恰是流量最大的分组。
//
// 两个口径都是「站点替用户承担的部分」= 牌价 - 用户实付：
//   - WelfareValue：福利分组（免费模型）
//   - SubsidyValue：补贴分组（flowbee专属补贴 / 国模企业补贴…）
//
// 数值单位与 logs.quota 一致（QuotaPerUnit 个单位为 1 美元），前端用同一个
// formatQuota 渲染，货币符号由站点配置决定。
type OverviewDailyStat struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_overview_daily_user_date"`
	Date         string `json:"date" gorm:"type:varchar(10);not null;uniqueIndex:idx_overview_daily_user_date"`
	WelfareValue int64  `json:"welfare_value" gorm:"not null;default:0"`
	SubsidyValue int64  `json:"subsidy_value" gorm:"not null;default:0"`
	UpdatedAt    int64  `json:"updated_at" gorm:"bigint;not null;default:0"`
}

func (OverviewDailyStat) TableName() string {
	return "user_usage_daily_stats"
}

// overviewLogOther 只取还原牌价所需的字段，日志里其他键（admin_info 等）忽略。
type overviewLogOther struct {
	ModelRatio          float64 `json:"model_ratio"`
	ModelPrice          float64 `json:"model_price"`
	CompletionRatio     float64 `json:"completion_ratio"`
	CacheTokens         int     `json:"cache_tokens"`
	CacheRatio          float64 `json:"cache_ratio"`
	CacheCreationTokens int     `json:"cache_creation_tokens"`
	CacheCreationRatio  float64 `json:"cache_creation_ratio"`
	ImageOutputTokens   int     `json:"image_output"`
	ImageRatio          float64 `json:"image_ratio"`
}

type overviewLogRow struct {
	UserId           int
	Group            string
	Quota            int64
	PromptTokens     int
	CompletionTokens int
	CreatedAt        int64
	Other            string
}

// listPriceQuota 还原一次请求在牌价（分组倍率按 1）下的额度。
//
// 复刻 service/text_quota.go 的口径：按 token 计费的模型先把 cache / cache
// 写入 / 图片 token 从 prompt 里剔除，再各自乘自己的倍率；按次计价的模型
// （model_price）直接取 price × QuotaPerUnit。日志缺失的字段按 0 处理，
// 因此结果对老日志是保守估计（不会凭空多出价值）。
func listPriceQuota(row overviewLogRow) float64 {
	var other overviewLogOther
	if row.Other != "" {
		// other 是历史数据，解析失败不该让整天的聚合作废。
		_ = common.UnmarshalJsonStr(row.Other, &other)
	}

	if other.ModelPrice > 0 {
		return other.ModelPrice * common.QuotaPerUnit
	}
	if other.ModelRatio <= 0 {
		// 没有倍率就退回用户实付，避免把 0 当成免费额度算进去。
		return float64(row.Quota)
	}

	base := float64(row.PromptTokens - other.CacheTokens - other.CacheCreationTokens - other.ImageOutputTokens)
	if base < 0 {
		base = 0
	}
	tokens := base +
		float64(other.CacheTokens)*other.CacheRatio +
		float64(other.CacheCreationTokens)*other.CacheCreationRatio +
		float64(other.ImageOutputTokens)*other.ImageRatio +
		float64(row.CompletionTokens)*other.CompletionRatio
	if tokens <= 0 {
		return 0
	}
	return tokens * other.ModelRatio
}

// coveredQuota 返回站点替用户承担的部分：牌价 - 用户实付，负数按 0 收。
func coveredQuota(row overviewLogRow) float64 {
	covered := listPriceQuota(row) - float64(row.Quota)
	if covered <= 0 || math.IsNaN(covered) || math.IsInf(covered, 0) {
		return 0
	}
	return covered
}

func overviewStatDay(createdAt int64) string {
	return time.Unix(createdAt, 0).In(welfarePointsLocation).Format("2006-01-02")
}

// RecomputeOverviewDailyStats 重算 [startDate, endDate] 闭区间内每天、每个用户的
// 免费使用与补贴金额，整行覆盖写入（不是累加，重复执行结果一致）。
//
// 只扫「福利 + 补贴分组 + 消费类型」的日志：其余流量对这两个数字没有贡献，先在
// SQL 里挡掉，一天几十万条日志也不会被搬进内存。
func RecomputeOverviewDailyStats(startDate, endDate string, welfareGroup string, subsidyGroups []string) (int, error) {
	if welfareGroup == "" {
		return 0, fmt.Errorf("welfare group is empty")
	}
	start, err := time.ParseInLocation("2006-01-02", startDate, welfarePointsLocation)
	if err != nil {
		return 0, err
	}
	end, err := time.ParseInLocation("2006-01-02", endDate, welfarePointsLocation)
	if err != nil {
		return 0, err
	}
	end = end.AddDate(0, 0, 1)

	groups := make([]string, 0, len(subsidyGroups)+1)
	subsidySet := make(map[string]bool, len(subsidyGroups))
	groups = append(groups, welfareGroup)
	for _, group := range subsidyGroups {
		if group == "" || group == welfareGroup {
			continue
		}
		groups = append(groups, group)
		subsidySet[group] = true
	}

	var rows []overviewLogRow
	err = LOG_DB.Model(&Log{}).
		Select("user_id, "+commonGroupCol+" AS "+commonGroupCol+", quota, prompt_tokens, completion_tokens, created_at, other").
		Where("type = ? AND created_at >= ? AND created_at < ? AND "+commonGroupCol+" IN ?",
			LogTypeConsume, start.Unix(), end.Unix(), groups).
		Find(&rows).Error
	if err != nil {
		return 0, err
	}

	type dayUserKey struct {
		userId int
		date   string
	}
	aggregated := make(map[dayUserKey]*OverviewDailyStat, 64)
	for _, row := range rows {
		if row.UserId <= 0 {
			continue
		}
		if !subsidySet[row.Group] && row.Group != welfareGroup {
			continue
		}
		date := overviewStatDay(row.CreatedAt)
		if date < startDate || date > endDate {
			continue
		}
		covered := coveredQuota(row)
		if covered <= 0 {
			continue
		}
		key := dayUserKey{userId: row.UserId, date: date}
		stat := aggregated[key]
		if stat == nil {
			stat = &OverviewDailyStat{UserId: row.UserId, Date: date}
			aggregated[key] = stat
		}
		amount := int64(math.Round(covered))
		if row.Group == welfareGroup {
			stat.WelfareValue += amount
		} else {
			stat.SubsidyValue += amount
		}
	}

	if len(aggregated) == 0 {
		return 0, nil
	}

	now := common.GetTimestamp()
	batch := make([]OverviewDailyStat, 0, 200)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		for i := range batch {
			batch[i].UpdatedAt = now
		}
		err := DB.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "date"}},
			DoUpdates: clause.AssignmentColumns([]string{"welfare_value", "subsidy_value", "updated_at"}),
		}).CreateInBatches(batch, len(batch)).Error
		batch = batch[:0]
		return err
	}

	for _, stat := range aggregated {
		batch = append(batch, *stat)
		if len(batch) >= 200 {
			if err := flush(); err != nil {
				return 0, err
			}
		}
	}
	if err := flush(); err != nil {
		return 0, err
	}
	return len(aggregated), nil
}

// OverviewStatsSummary 是概览卡片直接消费的两个数字。
type OverviewStatsSummary struct {
	WelfareValue int64 `json:"welfare_value"`
	SubsidyValue int64 `json:"subsidy_value"`
}

// GetOverviewStatsSummary 汇总最近 days 天（含今天）的聚合结果。
// 日期是定宽字符串，字典序比较在所有支持的数据库上都等价于按时间比较。
func GetOverviewStatsSummary(userId int, days int) (OverviewStatsSummary, error) {
	summary := OverviewStatsSummary{}
	if userId <= 0 {
		return summary, nil
	}
	if days <= 0 {
		days = 30
	}
	since := time.Now().In(welfarePointsLocation).AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	var row struct {
		WelfareValue int64
		SubsidyValue int64
	}
	err := DB.Model(&OverviewDailyStat{}).
		Select("COALESCE(SUM(welfare_value), 0) AS welfare_value, COALESCE(SUM(subsidy_value), 0) AS subsidy_value").
		Where("user_id = ? AND date >= ?", userId, since).
		Scan(&row).Error
	if err != nil {
		return summary, err
	}
	summary.WelfareValue = row.WelfareValue
	summary.SubsidyValue = row.SubsidyValue
	return summary, nil
}

// PurgeOverviewDailyStatsBefore 删除过期聚合，避免表无限增长。
func PurgeOverviewDailyStatsBefore(date string) error {
	return DB.Where("date < ?", date).Delete(&OverviewDailyStat{}).Error
}

// OverviewStatDatesMissing 返回 [startDate, endDate] 里还没有任何聚合行的日期，
// 供启动时只补真正缺的那几天，而不是每次重启重扫 30 天。
func OverviewStatDatesMissing(startDate, endDate string) []string {
	var existing []string
	if err := DB.Model(&OverviewDailyStat{}).
		Where("date >= ? AND date <= ?", startDate, endDate).
		Distinct().Pluck("date", &existing).Error; err != nil {
		return nil
	}
	have := make(map[string]bool, len(existing))
	for _, date := range existing {
		have[date] = true
	}
	start, err := time.ParseInLocation("2006-01-02", startDate, welfarePointsLocation)
	if err != nil {
		return nil
	}
	end, err := time.ParseInLocation("2006-01-02", endDate, welfarePointsLocation)
	if err != nil {
		return nil
	}
	missing := make([]string, 0, 32)
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		if !have[date] {
			missing = append(missing, date)
		}
	}
	return missing
}
