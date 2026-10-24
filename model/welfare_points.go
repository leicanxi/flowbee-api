package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WelfarePointsMaxBalance is the per-bucket saturation boundary. Points are
// virtual and small, but every grant/charge is still bounded so an accidental
// huge admin value cannot overflow int arithmetic.
const WelfarePointsMaxBalance = 1_000_000_000

// Point ledger sources. They are stored in welfare_point_logs.source.
const (
	WelfarePointsSourceCheckin       = "checkin"
	WelfarePointsSourceInvitee       = "invitee"
	WelfarePointsSourceInviter       = "inviter"
	WelfarePointsSourceConsumeRebate = "consume_rebate"
	WelfarePointsSourceSponsor       = "sponsor"
	WelfarePointsSourceRequest       = "request"
)

// welfarePointsLocation is intentionally a fixed offset rather than a named
// zone: the production container may not ship tzdata, and the product day
// boundary is China Standard Time.
var welfarePointsLocation = time.FixedZone("CST", 8*60*60)

// WelfarePointLog is an append-only audit trail for every points grant/charge.
// The (source, source_ref) unique index makes every business event idempotent.
type WelfarePointLog struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	Change    int    `json:"change" gorm:"not null;default:0"`
	Daily     int    `json:"daily" gorm:"not null;default:0"`
	Permanent int    `json:"permanent" gorm:"not null;default:0"`
	Source    string `json:"source" gorm:"type:varchar(32);not null;uniqueIndex:idx_welfare_point_source"`
	SourceRef string `json:"source_ref" gorm:"type:varchar(128);not null;uniqueIndex:idx_welfare_point_source"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null"`
}

func (WelfarePointLog) TableName() string {
	return "welfare_point_logs"
}

func WelfarePointsToday() string {
	return time.Now().In(welfarePointsLocation).Format("2006-01-02")
}

func WelfarePointsYesterday() string {
	return time.Now().In(welfarePointsLocation).AddDate(0, 0, -1).Format("2006-01-02")
}

// WelfarePointsDateOffset 返回相对今天偏移 offset 天的产品日（负数向过去）。
func WelfarePointsDateOffset(offset int) string {
	return time.Now().In(welfarePointsLocation).AddDate(0, 0, offset).Format("2006-01-02")
}

// EffectiveWelfarePoints returns the balances as they should be shown right
// now. When the stored daily bucket belongs to an earlier day, it is reported
// as today's base amount without writing to the database; the real reset
// happens lazily on the next grant/charge.
func EffectiveWelfarePoints(user *User) (daily int, permanent int) {
	if user == nil {
		return 0, 0
	}
	daily = user.WelfarePointsDaily
	if user.WelfarePointsDailyDate != WelfarePointsToday() {
		daily = setting.GetWelfareDailyBasePoints()
	}
	permanent = user.WelfarePointsPermanent
	if daily < 0 {
		daily = 0
	}
	if permanent < 0 {
		permanent = 0
	}
	return daily, permanent
}

func GetWelfarePointsBalance(userId int) (daily int, permanent int, err error) {
	var user User
	err = DB.Select("welfare_points_daily", "welfare_points_permanent", "welfare_points_daily_date").
		Where("id = ?", userId).First(&user).Error
	if err != nil {
		return 0, 0, err
	}
	daily, permanent = EffectiveWelfarePoints(&user)
	return daily, permanent, nil
}

// ensureWelfareDailyPointsWithTx resets the daily bucket to the configured
// base amount when the stored date is not today. The conditional UPDATE is
// atomic, so concurrent first requests of the day only reset once.
func ensureWelfareDailyPointsWithTx(tx *gorm.DB, userId int) error {
	today := WelfarePointsToday()
	base := setting.GetWelfareDailyBasePoints()
	return tx.Model(&User{}).
		Where("id = ? AND (welfare_points_daily_date IS NULL OR welfare_points_daily_date <> ?)", userId, today).
		Updates(map[string]interface{}{
			"welfare_points_daily":      base,
			"welfare_points_daily_date": today,
		}).Error
}

func clampWelfarePoints(value int) (int, bool) {
	if value < 0 {
		return 0, true
	}
	if value > WelfarePointsMaxBalance {
		return WelfarePointsMaxBalance, true
	}
	return value, false
}

// AddWelfarePointsWithTx grants points inside an existing transaction.
// daily goes to the reset-per-day bucket, permanent to the never-expiring
// bucket. The ledger unique index makes retries safe.
func AddWelfarePointsWithTx(tx *gorm.DB, userId int, daily int, permanent int, source string, sourceRef string) error {
	if daily < 0 || permanent < 0 {
		return errors.New("welfare points grant cannot be negative")
	}
	if daily == 0 && permanent == 0 {
		return nil
	}
	if source == "" || sourceRef == "" {
		return errors.New("welfare points grant requires source and source_ref")
	}
	if err := ensureWelfareDailyPointsWithTx(tx, userId); err != nil {
		return err
	}

	var user User
	if err := lockForUpdate(tx).Select("id", "welfare_points_daily", "welfare_points_permanent").
		Where("id = ?", userId).First(&user).Error; err != nil {
		return err
	}

	entry := &WelfarePointLog{
		UserId:    userId,
		Change:    daily + permanent,
		Daily:     daily,
		Permanent: permanent,
		Source:    source,
		SourceRef: sourceRef,
		CreatedAt: common.GetTimestamp(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(entry)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		// Already granted by an earlier attempt/callback.
		return nil
	}

	newDaily, dailyClamped := clampWelfarePoints(user.WelfarePointsDaily + daily)
	newPermanent, permanentClamped := clampWelfarePoints(user.WelfarePointsPermanent + permanent)
	if dailyClamped || permanentClamped {
		common.SysError(fmt.Sprintf("welfare points balance saturated: user=%d daily=%d permanent=%d", userId, newDaily, newPermanent))
	}
	return tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
		"welfare_points_daily":     newDaily,
		"welfare_points_permanent": newPermanent,
	}).Error
}

func AddWelfarePoints(userId int, daily int, permanent int, source string, sourceRef string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return AddWelfarePointsWithTx(tx, userId, daily, permanent, source, sourceRef)
	})
}

// CheckWelfarePoints reports whether the user can afford cost right now.
// It does not write the lazy daily reset.
func CheckWelfarePoints(userId int, cost int) (bool, error) {
	if cost <= 0 {
		return true, nil
	}
	daily, permanent, err := GetWelfarePointsBalance(userId)
	if err != nil {
		return false, err
	}
	return daily+permanent >= cost, nil
}

// SpendWelfarePoints atomically deducts cost, daily bucket first. It returns
// false when the balance is insufficient; it never allows a negative balance.
// sourceRef should identify the logical request so a retried settlement does
// not charge twice.
func SpendWelfarePoints(userId int, cost int, source string, sourceRef string) (bool, error) {
	if cost <= 0 {
		return true, nil
	}
	if source == "" || sourceRef == "" {
		return false, errors.New("welfare points spend requires source and source_ref")
	}

	spent := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := ensureWelfareDailyPointsWithTx(tx, userId); err != nil {
			return err
		}

		var user User
		if err := lockForUpdate(tx).Select("id", "welfare_points_daily", "welfare_points_permanent").
			Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		if user.WelfarePointsDaily+user.WelfarePointsPermanent < cost {
			return nil
		}

		dailyDeduct := cost
		if dailyDeduct > user.WelfarePointsDaily {
			dailyDeduct = user.WelfarePointsDaily
		}
		permanentDeduct := cost - dailyDeduct
		if user.WelfarePointsPermanent < permanentDeduct {
			return fmt.Errorf("welfare points accounting mismatch")
		}

		entry := &WelfarePointLog{
			UserId:    userId,
			Change:    -cost,
			Daily:     -dailyDeduct,
			Permanent: -permanentDeduct,
			Source:    source,
			SourceRef: sourceRef,
			CreatedAt: common.GetTimestamp(),
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(entry)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			// This logical request was already charged.
			spent = true
			return nil
		}

		if err := tx.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
			"welfare_points_daily":     user.WelfarePointsDaily - dailyDeduct,
			"welfare_points_permanent": user.WelfarePointsPermanent - permanentDeduct,
		}).Error; err != nil {
			return err
		}
		spent = true
		return nil
	})
	return spent, err
}

// MigrateAffQuotaToBalance moves the legacy pending affiliate quota into the
// wallet balance once. New invite rewards no longer accrue aff_quota, so this
// sweep is naturally idempotent: after it runs, no positive aff_quota remains.
func MigrateAffQuotaToBalance() error {
	const batchSize = 200
	for {
		var users []User
		if err := DB.Select("id").Where("aff_quota > 0").Limit(batchSize).Find(&users).Error; err != nil {
			return err
		}
		if len(users) == 0 {
			return nil
		}

		migrated := 0
		for _, item := range users {
			var movedQuota int
			err := DB.Transaction(func(tx *gorm.DB) error {
				var user User
				if err := lockForUpdate(tx).Select("id", "quota", "aff_quota").Where("id = ?", item.Id).First(&user).Error; err != nil {
					return err
				}
				if user.AffQuota <= 0 {
					return nil
				}
				if err := tx.Model(&User{}).Where("id = ?", user.Id).Updates(map[string]interface{}{
					"quota":     gorm.Expr("quota + ?", user.AffQuota),
					"aff_quota": 0,
				}).Error; err != nil {
					return err
				}
				movedQuota = user.AffQuota
				return nil
			})
			if err != nil {
				return err
			}
			if movedQuota > 0 {
				syncCreditUserQuotaCache(item.Id, movedQuota, "aff quota migration")
				RecordLog(item.Id, LogTypeSystem, common.NewMessage("Historical invite quota {{quota}} was automatically transferred to your balance", map[string]any{"quota": logger.LogQuota(movedQuota)}))
				migrated++
			}
		}
		if migrated == 0 {
			return nil
		}
	}
}

// GrantDailyConsumeRebate grants the tiered permanent-points rebate for the
// given day's net wallet consumption. It is safe to call repeatedly: the
// ledger unique index keys on the date.
func GrantDailyConsumeRebate(date string) error {
	if !setting.GetWelfarePointsEnabled() {
		return nil
	}
	if !common.LogConsumeEnabled {
		common.SysLog("welfare points rebate skipped: consume log is disabled")
		return nil
	}

	dayStart, err := time.ParseInLocation("2006-01-02", date, welfarePointsLocation)
	if err != nil {
		return err
	}
	start := dayStart.Unix()
	end := dayStart.AddDate(0, 0, 1).Unix()

	type consumeRow struct {
		UserId int
		Quota  int
	}
	var rows []consumeRow
	err = LOG_DB.Table("logs").
		Select("user_id, SUM(CASE WHEN type = ? THEN quota WHEN type = ? THEN -quota ELSE 0 END) AS quota", LogTypeConsume, LogTypeRefund).
		Where("created_at >= ? AND created_at < ?", start, end).
		Where("(billing_source IS NULL OR billing_source = '' OR billing_source <> ?)", "subscription").
		Group("user_id").
		Scan(&rows).Error
	if err != nil {
		return err
	}

	for _, row := range rows {
		if row.Quota <= 0 {
			continue
		}
		points := setting.GetWelfareConsumeTierPoints(row.Quota)
		if points <= 0 {
			continue
		}
		if err := AddWelfarePoints(row.UserId, 0, points, WelfarePointsSourceConsumeRebate, date); err != nil {
			common.SysError(fmt.Sprintf("failed to grant welfare consume rebate: user=%d date=%s: %s", row.UserId, date, err.Error()))
			continue
		}
		RecordLog(row.UserId, LogTypeSystem, common.NewMessage("Daily spend rebate: earned {{points}} points", map[string]any{"points": points}))
	}
	return nil
}

// GetWelfarePointLogs 分页返回某个用户的积分流水，新的在前。
// 流水表是 append-only 的审计账本，概览的「积分明细」直接读它，不再另建视图。
func GetWelfarePointLogs(userId int, pageInfo *common.PageInfo) error {
	if userId <= 0 {
		return errors.New("invalid userId")
	}
	var total int64
	if err := DB.Model(&WelfarePointLog{}).Where("user_id = ?", userId).Count(&total).Error; err != nil {
		return err
	}
	logs := make([]WelfarePointLog, 0, pageInfo.GetPageSize())
	if err := DB.Where("user_id = ?", userId).
		Order("id desc").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Find(&logs).Error; err != nil {
		return err
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	return nil
}
