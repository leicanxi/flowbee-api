package controller

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	imagePromptCoverMaxBytes = 6 << 20
	imagePromptCoverTimeout  = 20 * time.Second
)

// GetImagePrompts 返回提示词广场的提示词列表。
func GetImagePrompts(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	result, err := service.GetImagePrompts(c.Request.Context(), service.ImagePromptQuery{
		Category: c.Query("category"),
		Search:   c.Query("search"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		common.ApiErrorT(c, "Prompt gallery is temporarily unavailable")
		return
	}
	common.ApiSuccess(c, result)
}

// GetImagePromptCover 代理提示词素材图床的封面图。
//
// 素材图床在国内网络下经常不可达，而客户端直接引用外链又无法兜底，
// 因此这里按固定图床白名单做同源代理，只回传经过嗅探确认的图片内容。
func GetImagePromptCover(c *gin.Context) {
	target, err := service.ValidateImagePromptCoverURL(c.Query("url"))
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), imagePromptCoverTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	request.Header.Set("User-Agent", "new-api-image-prompt-gallery")
	request.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5")

	response, err := service.GetSSRFProtectedHTTPClient().Do(request)
	if err != nil {
		c.Status(http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		c.Status(http.StatusBadGateway)
		return
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, imagePromptCoverMaxBytes+1))
	if err != nil {
		c.Status(http.StatusBadGateway)
		return
	}
	if len(data) > imagePromptCoverMaxBytes {
		c.Status(http.StatusRequestEntityTooLarge)
		return
	}

	contentType := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
	if !strings.HasPrefix(contentType, "image/") {
		c.Status(http.StatusUnsupportedMediaType)
		return
	}

	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "public, max-age=604800")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, contentType, data)
}
