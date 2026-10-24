package controller

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	hostsetting "github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetCheckinStatus 获取用户签到状态和历史记录
func GetCheckinStatus(c *gin.Context) {
	checkinSetting := operation_setting.GetCheckinSetting()
	if !checkinSetting.Enabled {
		common.ApiErrorMsg(c, "签到功能未启用")
		return
	}
	userId := c.GetInt("id")
	// 获取月份参数，默认为当前月份（与积分每日重置使用同一时区）
	month := c.DefaultQuery("month", model.WelfarePointsToday()[:7])

	stats, err := model.GetUserCheckinStats(userId, month)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
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
		common.ApiErrorMsg(c, "签到功能未启用")
		return
	}

	userId := c.GetInt("id")

	checkin, err := model.UserCheckin(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("用户签到，获得 %d 积分", checkin.PointsAwarded))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "签到成功",
		"data": gin.H{
			"quota_awarded":  checkin.QuotaAwarded,
			"points_awarded": checkin.PointsAwarded,
			"checkin_date":   checkin.CheckinDate},
	})
}
