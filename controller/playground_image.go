package controller

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

// playgroundImageMaxBytes caps how much of a single upstream image we buffer
// before deciding it is too large to inline. 32MB covers a 4K PNG comfortably.
const playgroundImageMaxBytes = 32 << 20

// playgroundImageResponse is the OpenAI-compatible envelope returned to the
// playground frontend. Fields we do not touch are preserved through the
// generic map so created/usage metadata reaches the client intact.
type playgroundImageResponse map[string]any

// PlaygroundImage relays an image generation request on behalf of the logged-in
// user, then rewrites every upstream URL into an inline base64 payload so the
// browser never learns which upstream served the image.
func PlaygroundImage(c *gin.Context) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	newAPIError = preparePlaygroundRelay(c)
	if newAPIError != nil {
		return
	}

	originalWriter := c.Writer
	capture := &imageCaptureWriter{ResponseWriter: originalWriter}
	c.Writer = capture

	Relay(c, types.RelayFormatOpenAI)

	c.Writer = originalWriter

	statusCode := capture.Status()
	body := capture.body.Bytes()

	if statusCode >= http.StatusOK && statusCode < http.StatusMultipleChoices {
		body = inlineUpstreamImageURLs(body)
	}

	originalWriter.WriteHeader(statusCode)
	_, _ = originalWriter.Write(body)
}

// inlineUpstreamImageURLs replaces every data[].url with a base64 payload.
// On any parse or download failure the original body is returned unchanged so
// a working image link is never downgraded into an error.
func inlineUpstreamImageURLs(body []byte) []byte {
	if len(body) == 0 || bytes.HasPrefix(bytes.TrimSpace(body), []byte("data:")) {
		return body
	}

	var payload playgroundImageResponse
	if err := common.Unmarshal(body, &payload); err != nil {
		return body
	}

	rawItems, ok := payload["data"].([]any)
	if !ok || len(rawItems) == 0 {
		return body
	}

	changed := false
	for _, rawItem := range rawItems {
		item, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		upstreamURL, _ := item["url"].(string)
		if !strings.HasPrefix(upstreamURL, "http://") && !strings.HasPrefix(upstreamURL, "https://") {
			continue
		}
		encoded, err := downloadImageAsBase64(upstreamURL)
		if err != nil {
			continue
		}
		item["b64_json"] = encoded
		delete(item, "url")
		changed = true
	}
	if !changed {
		return body
	}

	rewritten, err := common.Marshal(payload)
	if err != nil {
		return body
	}
	return rewritten
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
