package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	hostsetting "github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetCheckinStatus 获取用户签到状态和历史记录
func GetCheckinStatus(c *gin.Context) {
	checkinSetting := operation_setting.GetCheckinSetting()
	if !checkinSetting.Enabled {
		common.ApiErrorT(c, "Check-in feature is not enabled")
		return
	}
	userId := c.GetInt("id")
	// 获取月份参数，默认为当前月份（与积分每日重置使用同一时区）
	month := c.DefaultQuery("month", model.WelfarePointsToday()[:7])

	stats, err := model.GetUserCheckinStats(userId, month)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	minPoints, maxPoints := hostsetting.GetWelfareCheckinPoints()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"enabled":    checkinSetting.Enabled,
			"min_quota":  checkinSetting.MinQuota,
			"max_quota":  checkinSetting.MaxQuota,
			"min_points": minPoints,
			"max_points": maxPoints,
			"stats":      stats,
		},
	})
}

// DoCheckin 执行用户签到
func DoCheckin(c *gin.Context) {
	checkinSetting := operation_setting.GetCheckinSetting()
	if !checkinSetting.Enabled {
		common.ApiErrorT(c, "Check-in feature is not enabled")
		return
	}

	userId := c.GetInt("id")

	checkin, err := model.UserCheckin(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, common.NewMessage("Daily check-in: received {{quota}}, earned {{points}} points", map[string]any{
		"quota":  logger.FormatQuota(checkin.QuotaAwarded),
		"points": checkin.PointsAwarded,
	}))
	common.ApiSuccessT(c, "Check-in successful", gin.H{
		"quota_awarded":  checkin.QuotaAwarded,
		"points_awarded": checkin.PointsAwarded,
		"checkin_date":   checkin.CheckinDate,
	})
}
