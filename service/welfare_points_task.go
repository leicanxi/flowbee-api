package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const welfarePointsRebateTickInterval = time.Minute

var (
	welfarePointsTaskOnce sync.Once
	welfarePointsLastDate string
)

// StartWelfarePointsTask runs the master-only welfare points maintenance:
// one legacy aff_quota -> wallet sweep at startup, then yesterday's consume
// rebate once per local day. GrantDailyConsumeRebate is idempotent through the
// points ledger, so a restart or a retry after a partial run is safe.
func StartWelfarePointsTask() {
	welfarePointsTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ctx := context.Background()
			if err := model.MigrateAffQuotaToBalance(); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("welfare points: legacy aff_quota migration failed: %v", err))
			}

			runOnce := func() {
				today := model.WelfarePointsToday()
				if welfarePointsLastDate == today {
					return
				}
				date := model.WelfarePointsYesterday()
				if err := model.GrantDailyConsumeRebate(date); err != nil {
					logger.LogWarn(ctx, fmt.Sprintf("welfare points: consume rebate for %s failed: %v", date, err))
					return
				}
				welfarePointsLastDate = today
				logger.LogInfo(ctx, fmt.Sprintf("welfare points: consume rebate for %s processed", date))
			}

			runOnce()
			ticker := time.NewTicker(welfarePointsRebateTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				runOnce()
			}
		})
	})
}
