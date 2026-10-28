package controller

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"maps"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// playgroundImageMaxBytes caps how much of a single upstream image we buffer
// before deciding it is too large to inline. 32MB covers a 4K PNG comfortably.
const playgroundImageMaxBytes = 32 << 20

const (
	// 参考图的张数、单张大小与格式与生图接口的常见上限保持一致。
	playgroundEditMaxImages     = 4
	playgroundEditMaxImageBytes = 10 << 20
)

// playgroundImageResponse is the OpenAI-compatible envelope returned to the
// playground frontend. Fields we do not touch are preserved through the
// generic map so created/usage metadata reaches the client intact.
type playgroundImageResponse map[string]any

var (
	errPlaygroundImagesUnavailable = errors.New("generated images could not be loaded")

	// 上游错误里可能带着它自己的图片或接口地址，这些地址同样不能出现在网页端。
	playgroundAbsoluteURLPattern = regexp.MustCompile(`(?i)https?://[^\s"'<>]+`)

	playgroundEditImageTypes = map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/webp": true,
	}
)

// PlaygroundImage relays an image generation or edit request on behalf of the
// logged-in user, then rewrites every upstream URL into an inline base64
// payload so the browser never learns which upstream served the image.
func PlaygroundImage(c *gin.Context) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(common.UpstreamAddresses(c)...),
			})
		}
	}()

	if relayconstant.Path2RelayMode(c.Request.URL.Path) == relayconstant.RelayModeImagesEdits {
		if message := validatePlaygroundImageEdit(c); message != nil {
			writePlaygroundImageMessage(c, http.StatusBadRequest, message)
			return
		}
	}

	newAPIError = preparePlaygroundRelay(c)
	if newAPIError != nil {
		return
	}

	originalWriter := c.Writer
	// 记录进入 relay 前已有的响应头：relay 会照抄上游响应头（Server、Content-Length 等），
	// 这些头既可能暴露上游实现，也会因为响应体被改写而变成错误长度。
	ownHeaders := make(map[string]struct{}, len(originalWriter.Header()))
	for name := range originalWriter.Header() {
		ownHeaders[name] = struct{}{}
	}

	capture := &imageCaptureWriter{ResponseWriter: originalWriter}
	c.Writer = capture

	Relay(c, types.RelayFormatOpenAIImage)

	c.Writer = originalWriter

	statusCode := capture.Status()
	body := capture.body.Bytes()

	if statusCode >= http.StatusOK && statusCode < http.StatusMultipleChoices {
		rewritten, err := inlineUpstreamImageURLs(body)
		if err != nil {
			writePlaygroundImageMessage(c, http.StatusBadGateway, common.NewMessage("Generated images could not be loaded"))
			return
		}
		body = rewritten
	} else {
		body = redactPlaygroundImageErrorBody(body)
	}

	for name := range originalWriter.Header() {
		if _, ok := ownHeaders[name]; !ok {
			originalWriter.Header().Del(name)
		}
	}
	originalWriter.Header().Set("Content-Type", "application/json; charset=utf-8")
	originalWriter.Header().Set("Content-Length", strconv.Itoa(len(body)))

	originalWriter.WriteHeader(statusCode)
	_, _ = originalWriter.Write(body)
}

// validatePlaygroundImageEdit 校验浏览器上传的参考图表单。
//
// 上游对参考图有张数、大小和格式要求，网关先拦掉明显不合规的请求，
// 避免把超大文件整个转发给上游。返回 nil 表示通过。
func validatePlaygroundImageEdit(c *gin.Context) *common.Message {
	if !strings.Contains(c.Request.Header.Get("Content-Type"), "multipart/form-data") {
		// JSON 改图请求没有上传文件，交给下游解析。
		return nil
	}

	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return common.NewMessage("Invalid reference image upload")
	}
	values := url.Values(form.Value)
	c.Request.MultipartForm = form
	c.Request.PostForm = values

	if strings.TrimSpace(values.Get("model")) == "" || strings.TrimSpace(values.Get("prompt")) == "" {
		return common.NewMessage("Model and prompt are required")
	}

	files := form.File["image"]
	if len(files) == 0 {
		return common.NewMessage("At least one reference image is required")
	}
	if len(files) > playgroundEditMaxImages {
		return common.NewMessage("A maximum of {{count}} reference images is allowed", map[string]any{"count": playgroundEditMaxImages})
	}

	for _, file := range files {
		if file.Size <= 0 {
			return common.NewMessage("Reference image could not be read")
		}
		if file.Size > playgroundEditMaxImageBytes {
			return common.NewMessage("Each reference image must be {{size}} MB or smaller", map[string]any{"size": playgroundEditMaxImageBytes >> 20})
		}
		kind, err := sniffPlaygroundImageType(file)
		if err != nil {
			return err
		}
		if !playgroundEditImageTypes[kind] {
			return common.NewMessage("Reference images must be PNG, JPEG or WebP")
		}
	}
	return nil
}

func sniffPlaygroundImageType(file *multipart.FileHeader) (string, *common.Message) {
	reader, err := file.Open()
	if err != nil {
		return "", common.NewMessage("Reference image could not be read")
	}
	defer reader.Close()

	header := make([]byte, 512)
	read, readErr := io.ReadFull(reader, header)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) && !errors.Is(readErr, io.EOF) {
		return "", common.NewMessage("Reference image could not be read")
	}
	kind := http.DetectContentType(header[:read])
	if index := strings.IndexByte(kind, ';'); index >= 0 {
		kind = kind[:index]
	}
	return strings.ToLower(kind), nil
}

// writePlaygroundImageMessage 返回 OpenAI 形状的错误，同时带上 webpage 可翻译的
// message_key，让生图工作室能显示本地化文案。
func writePlaygroundImageMessage(c *gin.Context, status int, message *common.Message) {
	body := gin.H{
		"error": gin.H{"message": message.Error(), "type": "invalid_request_error"},
	}
	maps.Copy(body, message.Fields())
	c.JSON(status, body)
}

// inlineUpstreamImageURLs replaces every data[].url with a base64 payload and
// drops images that cannot be fetched. It never returns a body that still
// carries an upstream URL: the browser must not learn where images come from.
func inlineUpstreamImageURLs(body []byte) ([]byte, error) {
	if len(body) == 0 || bytes.HasPrefix(bytes.TrimSpace(body), []byte("data:")) {
		return body, nil
	}

	var payload playgroundImageResponse
	if err := common.Unmarshal(body, &payload); err != nil {
		return body, nil
	}

	rawItems, ok := payload["data"].([]any)
	if !ok || len(rawItems) == 0 {
		return body, nil
	}

	hadURL := false
	kept := make([]any, 0, len(rawItems))
	for _, rawItem := range rawItems {
		item, ok := rawItem.(map[string]any)
		if !ok {
			kept = append(kept, rawItem)
			continue
		}
		upstreamURL, _ := item["url"].(string)
		if !strings.HasPrefix(upstreamURL, "http://") && !strings.HasPrefix(upstreamURL, "https://") {
			kept = append(kept, item)
			continue
		}
		hadURL = true

		encoded, err := downloadImageAsBase64(upstreamURL)
		if err != nil {
			// 拉不到就丢掉这一张，绝不把上游地址原样透传给浏览器。
			common.SysLog(common.LogText("playground image inline failed: %s", common.LocalLogPreview(err.Error())))
			continue
		}
		item["b64_json"] = encoded
		delete(item, "url")
		kept = append(kept, item)
	}

	if !hadURL {
		return body, nil
	}
	if len(kept) == 0 {
		return nil, errPlaygroundImagesUnavailable
	}

	payload["data"] = kept
	rewritten, err := common.Marshal(payload)
	if err != nil {
		return nil, errPlaygroundImagesUnavailable
	}
	return rewritten, nil
}

// redactPlaygroundImageErrorBody 清掉错误响应里出现的上游地址。
func redactPlaygroundImageErrorBody(body []byte) []byte {
	var payload map[string]any
	if err := common.Unmarshal(body, &payload); err != nil {
		return body
	}
	rawError, ok := payload["error"].(map[string]any)
	if !ok {
		return body
	}
	message, _ := rawError["message"].(string)
	redacted := redactPlaygroundImageMessage(message)
	if redacted == message {
		return body
	}

	rawError["message"] = redacted
	if key, ok := payload["message_key"].(string); ok {
		payload["message_key"] = redactPlaygroundImageMessage(key)
	}
	rewritten, err := common.Marshal(payload)
	if err != nil {
		return body
	}
	return rewritten
}

func redactPlaygroundImageMessage(message string) string {
	return playgroundAbsoluteURLPattern.ReplaceAllString(message, "***")
}

func downloadImageAsBase64(imageURL string) (string, error) {
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Get(imageURL)
	if err != nil {
		return "", fmt.Errorf("download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download image: upstream returned %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, playgroundImageMaxBytes+1))
	if err != nil {
		return "", fmt.Errorf("read image: %w", err)
	}
	if len(data) > playgroundImageMaxBytes {
		return "", fmt.Errorf("image exceeds %d bytes", playgroundImageMaxBytes)
	}
	if len(data) == 0 {
		return "", fmt.Errorf("image body is empty")
	}

	return base64.StdEncoding.EncodeToString(data), nil
}

// imageCaptureWriter buffers whatever the relay writes so the body can be
// rewritten before it reaches the client. Headers are held back as well.
type imageCaptureWriter struct {
	gin.ResponseWriter
	body          bytes.Buffer
	statusCode    int
	headerWritten bool
}

func (w *imageCaptureWriter) WriteHeader(code int) {
	if w.headerWritten {
		return
	}
	w.statusCode = code
	w.headerWritten = true
}

func (w *imageCaptureWriter) Write(data []byte) (int, error) {
	return w.body.Write(data)
}

func (w *imageCaptureWriter) WriteString(value string) (int, error) {
	return w.body.WriteString(value)
}

func (w *imageCaptureWriter) WriteHeaderNow() {
	if w.headerWritten {
		return
	}
	w.statusCode = http.StatusOK
	w.headerWritten = true
}

func (w *imageCaptureWriter) Written() bool {
	return w.headerWritten
}

func (w *imageCaptureWriter) Size() int {
	return w.body.Len()
}

func (w *imageCaptureWriter) Status() int {
	if !w.headerWritten {
		return http.StatusOK
	}
	return w.statusCode
}

// Flush 必须吞掉：图片响应要整体缓冲后再改写，提前落盘会泄漏未改写的上游地址。
func (w *imageCaptureWriter) Flush() {}
