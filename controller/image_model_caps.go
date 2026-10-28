package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
)

// GetImageModelCaps 把生图模型能力表下发给前端。
//
// 这里刻意只读、也没有配套的后台编辑页：上游中转站随时会改模型清单和参数
// 口径，运维用 PUT /api/option/ 写 ImageModelCaps 即可，写完 OptionMap 立即
// 生效，不需要改代码或重启容器。前端拿到整张表后按模型名本地匹配。
func GetImageModelCaps(c *gin.Context) {
	common.ApiSuccess(c, setting.LoadImageModelCaps())
}
