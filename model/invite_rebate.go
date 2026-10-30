package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 邀请余额返利流水状态。
const (
	InviteRebateStatusGranted    = "granted"
	InviteRebateStatusClawedBack = "clawed_back"
)

// InviteRebateLog 是邀请余额返利的审计流水，每笔被返利的充值订单一行。
// topup_id 唯一索引保证每单至多返利一次；扣回把状态翻成 clawed_back 并
// 扣减邀请人余额。
type InviteRebateLog struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	TopupId   int    `json:"topup_id" gorm:"not null;uniqueIndex:idx_invite_rebate_topup"`
	InviterId int    `json:"inviter_id" gorm:"not null;index"`
	InviteeId int    `json:"invitee_id" gorm:"not null"`
	Amount    int    `json:"amount" gorm:"not null;default:0"`
	Status    string `json:"status" gorm:"type:varchar(20);not null"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null"`
	ClawedAt  int64  `json:"clawed_at" gorm:"bigint;not null;default:0"`
}

func (InviteRebateLog) TableName() string {
	return "invite_rebate_logs"
}

// inviteRebateAmount 按配置比例计算返利：到账额度 × 百分比（四舍五入到整数
// quota），再套单笔封顶。配置关闭或额度非正返回 0。换算走钱包域的
// WalletQuotaFromDecimalStrict，禁止裸 cast。
func inviteRebateAmount(creditedQuota int) int {
	percent := setting.GetWelfareInviterRebatePercent()
	if percent <= 0 || creditedQuota <= 0 {
		return 0
	}
	amount, err := common.WalletQuotaFromDecimalStrict(
		decimal.NewFromInt(int64(creditedQuota)).Mul(decimal.NewFromFloat(percent / 100)),
	)
	if err != nil {
		common.SysError(fmt.Sprintf("invite rebate conversion failed: credited=%d percent=%g: %s", creditedQuota, percent, err.Error()))
		return 0
	}
	if cap := setting.GetWelfareInviterRebateMaxQuota(); cap > 0 && amount > cap {
		amount = cap
	}
	return amount
}

// grantInviteRebateWithTx 给邀请人发放首充余额返利并落流水。必须在充值入账
// 事务内调用：topup_id 唯一索引幂等防重。入账复用 creditTopUpQuota 的钱包
// 封顶语义；邀请人触顶或账号缺失时记日志跳过返利，绝不影响被邀请人的充值
// 入账。返回实际发放额度，0 表示未发放。
func grantInviteRebateWithTx(tx *gorm.DB, inviterId int, inviteeId int, topUpId int, creditedQuota int) (int, error) {
	var cnt int64
	if err := tx.Model(&InviteRebateLog{}).Where("topup_id = ?", topUpId).Count(&cnt).Error; err != nil {
		return 0, err
	}
	if cnt > 0 {
		return 0, nil
	}

	amount := inviteRebateAmount(creditedQuota)
	if amount <= 0 {
		return 0, nil
	}
	if err := creditTopUpQuota(tx, inviterId, amount, nil); err != nil {
		if errors.Is(err, ErrTopUpQuotaLimitExceeded) || errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError(fmt.Sprintf("invite rebate skipped: inviter=%d topup=%d amount=%d: %s", inviterId, topUpId, amount, err.Error()))
			return 0, nil
		}
		return 0, err
	}

	entry := &InviteRebateLog{
		TopupId:   topUpId,
		InviterId: inviterId,
		InviteeId: inviteeId,
		Amount:    amount,
		Status:    InviteRebateStatusGranted,
		CreatedAt: common.GetTimestamp(),
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(entry)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		// 并发下这笔订单已发放过返利，回滚本事务防止双重入账。
		return 0, fmt.Errorf("invite rebate already granted for topup %d", topUpId)
	}
	return amount, nil
}

// ClawbackInviteRebate 扣回某笔充值订单的邀请余额返利：事务内行锁流水行，
// 把 granted 翻成 clawed_back，并从邀请人余额扣减返利（余额不足时扣到 0
// 为止，不产生负余额）。重复调用幂等，返回实际扣减的额度。
func ClawbackInviteRebate(topUpId int) (int, error) {
	deducted := 0
	var inviterId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var entry InviteRebateLog
		if err := lockForUpdate(tx).Where("topup_id = ?", topUpId).First(&entry).Error; err != nil {
			return err
		}
		if entry.Status != InviteRebateStatusGranted {
			return nil
		}

		var inviter User
		if err := lockForUpdate(tx).Select("id", "quota").Where("id = ?", entry.InviterId).First(&inviter).Error; err != nil {
			return err
		}
		deducted = entry.Amount
		if inviter.Quota < deducted {
			deducted = inviter.Quota
		}
		if deducted < 0 {
			deducted = 0
		}
		if deducted > 0 {
			if err := tx.Model(&User{}).Where("id = ?", entry.InviterId).
				Update("quota", gorm.Expr("quota - ?", deducted)).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&InviteRebateLog{}).Where("id = ?", entry.Id).Updates(map[string]any{
			"status":    InviteRebateStatusClawedBack,
			"clawed_at": common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		inviterId = entry.InviterId
		return nil
	})
	if err != nil {
		return 0, err
	}
	if deducted > 0 {
		if err := cacheDecrUserQuota(inviterId, int64(deducted)); err != nil {
			common.SysLog(common.LogText("failed to sync invite rebate clawback to user quota cache: %s", err.Error()))
		}
		RecordLog(inviterId, LogTypeSystem, common.NewMessage("Invite rebate of {{amount}} was clawed back", map[string]any{"amount": logger.FormatQuota(deducted)}))
	}
	return deducted, nil
}

// CountInviteRebateLogs 统计某邀请人已发放的返利笔数（含之后被扣回的：
// 「已发放次数」统计的是发放事件，不是当前有效返利）。
func CountInviteRebateLogs(inviterId int) (int, error) {
	var count int64
	err := DB.Model(&InviteRebateLog{}).Where("inviter_id = ?", inviterId).Count(&count).Error
	return int(count), err
}
