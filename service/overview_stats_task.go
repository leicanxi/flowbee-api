package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	// overviewStatsWindowDays 是概览卡片的口径（近 30 天，含今天）。
	overviewStatsWindowDays = 30
	// overviewStatsRetainDays 比窗口多留半个月：改口径或补数时还有回旋余地。
	overviewStatsRetainDays = 45
	// overviewStatsTickInterval 决定「今天」的数字有多新。重算只扫福利/补贴
	// 分组的当日日志，代价很小，所以不需要等午夜才跑一次。
	overviewStatsTickInterval = 30 * time.Minute
)

var (
	overviewStatsTaskOnce sync.Once
	overviewStatsPurgeDay string
)

// StartOverviewStatsTask 维护概览用的每日聚合：
//   - 启动时把窗口内缺失的日期补上（首次部署会回填 30 天）；
//   - 之后每 30 分钟重算「昨天 + 今天」，昨天的数字在午夜后自然收敛为终值；
//   - 每天清一次超过保留期的行。
//
// 全部操作都是整行覆盖，重复执行结果一致，重启或并发不会写脏。
func StartOverviewStatsTask() {
	overviewStatsTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ctx := context.Background()
			backfillOverviewStats(ctx)

			recompute := func() {
				today := model.WelfarePointsToday()
				yesterday := model.WelfarePointsYesterday()
				start := time.Now()
				rows, err := model.RecomputeOverviewDailyStats(
					yesterday, today,
					setting.GetWelfarePointsGroup(),
					setting.GetWelfarePointsSubsidyGroups(),
				)
				if err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("overview stats: recompute %s..%s failed: %v", yesterday, today, err))
					return
				}
				logger.LogDebug(ctx, fmt.Sprintf("overview stats: recomputed %s..%s, %d user-days in %s",
					yesterday, today, rows, time.Since(start).Round(time.Millisecond)))

				if overviewStatsPurgeDay == today {
					return
				}
				cutoff := model.WelfarePointsDateOffset(-overviewStatsRetainDays)
				if err := model.PurgeOverviewDailyStatsBefore(cutoff); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("overview stats: purge before %s failed: %v", cutoff, err))
					return
				}
				overviewStatsPurgeDay = today
			}

			recompute()
			ticker := time.NewTicker(overviewStatsTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				recompute()
			}
		})
	})
}

// backfillOverviewStats 只补「还没算过」的日期。已经算过的天数不重扫：
// 重启一台 master 不该变成一次 30 天全表扫描。
func backfillOverviewStats(ctx context.Context) {
	windowStart := model.WelfarePointsDateOffset(-(overviewStatsWindowDays - 1))
	yesterday := model.WelfarePointsYesterday()

	missing := model.OverviewStatDatesMissing(windowStart, yesterday)
	if len(missing) == 0 {
		return
	}
	// 从第一天缺失开始一次性重算到今天：缺失日期通常是连续的一段，
	// 逐天各发一条查询没有意义。
	start := time.Now()
	rows, err := model.RecomputeOverviewDailyStats(
		missing[0], model.WelfarePointsToday(),
		setting.GetWelfarePointsGroup(),
		setting.GetWelfarePointsSubsidyGroups(),
	)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("overview stats: backfill from %s failed: %v", missing[0], err))
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("overview stats: backfilled %d missing day(s) from %s, %d user-days in %s",
		len(missing), missing[0], rows, time.Since(start).Round(time.Millisecond)))
}
