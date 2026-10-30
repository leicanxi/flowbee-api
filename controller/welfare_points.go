package controller

import (
	"cmp"
	"net/http"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

// GetWelfarePointLogs 返回当前用户的积分流水（分页）。
//
// 积分是虚拟账本而不是余额：用户看不到「每一笔为什么来、为什么走」时就只会
// 怀疑扣费，所以概览的「积分明细」直接把这本账摊开给他看。
func GetWelfarePointLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	if err := model.GetWelfarePointLogs(c.GetInt("id"), pageInfo); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    pageInfo,
	})
}

// GetWelfarePoints returns the current user's points buckets plus the
// public configuration the welfare page needs to explain costs and rewards.
func GetWelfarePoints(c *gin.Context) {
	userId := c.GetInt("id")
	daily, permanent, err := model.GetWelfarePointsBalance(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取福利积分失败",
		})
		return
	}

	cfg := setting.GetWelfarePointsSetting()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled":            cfg.Enabled,
			"group":              cfg.Group,
			"daily":              daily,
			"permanent":          permanent,
			"total":              daily + permanent,
			"daily_base_points":  cfg.DailyBasePoints,
			"new_user_points":    cfg.NewUserPoints,
			"model_costs":        cfg.ModelCosts,
			"consume_tiers":      cfg.ConsumeTiers,
			"checkin_min_points": cfg.CheckinMinPoints,
			"checkin_max_points": cfg.CheckinMaxPoints,
			"invitee_points":     cfg.InviteePoints,
			"inviter_points":     cfg.InviterPoints,
			"sponsor_points":     cfg.SponsorPoints,

			"inviter_rebate_percent":   cfg.InviterRebatePercent,
			"inviter_rebate_max_quota": cfg.InviterRebateMaxQuota,
		},
	})
}

// welfareModelUsageItem 是「免费模型消耗」弹窗的一行。
// PointsSpent 只在服务端算一次：单次积分价可能有通配前缀和 default，
// 前端不应复制这套规则。
type welfareModelUsageItem struct {
	ModelName    string `json:"model_name"`
	RequestCount int64  `json:"request_count"`
	PointsSpent  int64  `json:"points_spent"`
	LastUsedAt   int64  `json:"last_used_at"`
}

// GetWelfareModelUsage 返回当前用户在福利分组内按模型聚合的积分消耗。
//
// 口径是「请求次数 × 当前单次积分价」，不是 token：福利分组的消费日志
// quota 恒为 0，token_used 又只覆盖文本模型；用次数换算可以同时覆盖文本、
// 图片和任务模型，也正好对应用户实际被扣的福利积分。
//
// 不返回具体金额给前端展示，前端只拿 points_spent 决定条形长度。
func GetWelfareModelUsage(c *gin.Context) {
	group := setting.GetWelfarePointsGroup()
	if group == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"group":          "",
				"data_available": false,
				"models":         []welfareModelUsageItem{},
			},
		})
		return
	}

	startTimestamp := common.GetTimestamp() - int64(overviewStatsWindowDays)*86400
	rows, err := model.GetWelfareModelUsage(c.GetInt("id"), group, startTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]welfareModelUsageItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, welfareModelUsageItem{
			ModelName:    row.ModelName,
			RequestCount: row.RequestCount,
			PointsSpent:  row.RequestCount * int64(setting.GetWelfarePointCost(row.ModelName)),
			LastUsedAt:   row.LastUsedAt,
		})
	}
	// 消耗高的排前面；同分时再看请求次数，最后按模型名保证顺序稳定。
	slices.SortFunc(items, func(a, b welfareModelUsageItem) int {
		if order := cmp.Compare(b.PointsSpent, a.PointsSpent); order != 0 {
			return order
		}
		if order := cmp.Compare(b.RequestCount, a.RequestCount); order != 0 {
			return order
		}
		return cmp.Compare(a.ModelName, b.ModelName)
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"group":          group,
			"data_available": common.DataExportEnabled,
			"models":         items,
		},
	})
}
