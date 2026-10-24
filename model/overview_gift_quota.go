package model

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 赠送额度（gift quota）没有独立字段，只能从管理审计日志里还原：
// 管理员在用户管理页「加额度」时会同时写一条 logs(type=LogTypeManage,
// action=user.quota_add) 的审计记录，params 里带 quota。
//
// 为什么用审计日志而不是 top_ups：top_ups 只记真实支付流水，没有「这是赠送」
// 的标记；而管理员手动加额度不入 top_ups，只入审计。
//
// 这是累计值（开站至今加过多少），不是「当前剩余」。用户把它消费掉之后，
// 这个数不会减少 —— 卡片上标注的就是「累计赠送」，与「充值余额」并列时
// 语义不同，前端文案不能写成「剩余赠送」。

const (
	// 管理员加额度的审计 action，与 controller/user.go 的 add_quota 分支一致。
	overviewQuotaAddAction = "user.quota_add"
	// 赠送额度是低频查询（一次扫审计日志），按用户缓存一段时间；管理员改额度
	// 不频繁，5 分钟的延迟对概览页足够，且避免每次打开概览都扫一遍。
	overviewGiftQuotaTTL = 5 * time.Minute
)

type overviewGiftQuotaEntry struct {
	quota     int64
	expiresAt time.Time
}

var overviewGiftQuotaCache sync.Map // map[int]overviewGiftQuotaEntry

// GetUserGiftQuota 返回某用户累计被管理员手动加上的额度（quota 单位）。
//
// 只统计 action=user.quota_add；subtract / override 不计入 —— 「赠送」问的是
// 「白给过多少」，管理员手工扣回不算抵消（那可能是误操作纠正）。overriding
// 更是直接把余额设成某个值，无法拆分其中多少是赠送。
func GetUserGiftQuota(userId int) (int64, error) {
	if userId <= 0 {
		return 0, nil
	}
	if cached, ok := overviewGiftQuotaCache.Load(userId); ok {
		entry := cached.(overviewGiftQuotaEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.quota, nil
		}
	}

	// 审计日志写在 LOG_DB（可能独立于主库），按日志库查询。
	var rows []Log
	err := LOG_DB.Select("id", "other").
		Where("type = ? AND user_id = ?", LogTypeManage, userId).
		Order("id DESC").
		Find(&rows).Error
	if err != nil {
		return 0, err
	}

	var total int64
	for _, row := range rows {
		var payload struct {
			Op struct {
				Action string `json:"action"`
				Params struct {
					Quota float64 `json:"quota"`
					// 管理员替他加额度时，target_user_id 指向被加的人，
					// user_id 是操作者。两种记法都要兼容。
					TargetUserId int `json:"target_user_id"`
				} `json:"params"`
			} `json:"op"`
		}
		if err := common.UnmarshalJsonStr(row.Other, &payload); err != nil {
			continue
		}
		if payload.Op.Action != overviewQuotaAddAction {
			continue
		}
		// target_user_id 存在且不等于本人时，说明这条审计的主体是别人
		// （user_id 记的是操作者），跳过。
		if payload.Op.Params.TargetUserId > 0 && payload.Op.Params.TargetUserId != userId {
			continue
		}
		if payload.Op.Params.Quota > 0 {
			total += int64(payload.Op.Params.Quota)
		}
	}

	overviewGiftQuotaCache.Store(userId, overviewGiftQuotaEntry{
		quota:     total,
		expiresAt: time.Now().Add(overviewGiftQuotaTTL),
	})
	return total, nil
}

// InvalidateUserGiftQuotaCache 在管理员改额度后清掉缓存。
// 目前没接进管理端（改动面会扩到 controller/user.go），5 分钟自然过期即可；
// 需要即时刷新时由调用方显式调用。
func InvalidateUserGiftQuotaCache(userId int) {
	overviewGiftQuotaCache.Delete(userId)
}
