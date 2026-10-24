package controller

import (
	"net/http"

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
			"model_costs":        cfg.ModelCosts,
			"consume_tiers":      cfg.ConsumeTiers,
			"checkin_min_points": cfg.CheckinMinPoints,
			"checkin_max_points": cfg.CheckinMaxPoints,
			"invitee_points":     cfg.InviteePoints,
			"inviter_points":     cfg.InviterPoints,
			"sponsor_points":     cfg.SponsorPoints,
		},
	})
}
