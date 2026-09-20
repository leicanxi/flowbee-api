package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// freeTokensGroup 是站内完全免费的分组（其 GroupRatio 为 0，调用不扣任何额度），
// 独立首页「免费提供」展示的就是这个分组的累计用量。
const freeTokensGroup = "福利"

type SiteStatsResponse struct {
	FreeTokens int64 `json:"free_tokens"`
}

// GetSiteStats 返回独立首页展示用的公开统计，未登录可读。
func GetSiteStats(c *gin.Context) {
	freeTokens, err := model.GetGroupUsedTokenTotal(freeTokensGroup)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": SiteStatsResponse{
			FreeTokens: freeTokens,
		},
	})
}
