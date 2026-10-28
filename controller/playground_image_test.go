package controller

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInlineUpstreamImageURLsReplacesURLWithBase64(t *testing.T) {
	imageBytes := []byte("fake-png-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(imageBytes)
	}))
	defer server.Close()

	body := []byte(`{"created":1,"data":[{"url":"` + server.URL + `/a.png","revised_prompt":"x"}]}`)
	out, err := inlineUpstreamImageURLs(body)
	require.NoError(t, err)

	if bytes.Contains(out, []byte(server.URL)) {
		t.Fatalf("upstream url leaked to client: %s", out)
	}

	var payload map[string]any
	require.NoError(t, common.Unmarshal(out, &payload))
	items, ok := payload["data"].([]any)
	require.True(t, ok)
	require.Len(t, items, 1)

	item := items[0].(map[string]any)
	encoded, _ := item["b64_json"].(string)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	require.NoError(t, err)
	assert.Equal(t, imageBytes, decoded)
	_, exists := item["url"]
	assert.False(t, exists, "url field should be removed")
	assert.Equal(t, "x", item["revised_prompt"])
	assert.NotNil(t, payload["created"])
}

func TestInlineUpstreamImageURLsDropsUnavailableImage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusNotFound)
	}))
	defer server.Close()

	body := []byte(`{"data":[{"url":"` + server.URL + `/missing.png"}]}`)
	out, err := inlineUpstreamImageURLs(body)

	require.ErrorIs(t, err, errPlaygroundImagesUnavailable)
	assert.Nil(t, out)
}

func TestInlineUpstreamImageURLsKeepsOnlyFetchedImages(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/missing.png") {
			http.Error(w, "nope", http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte("image-bytes"))
	}))
	defer server.Close()

	body := []byte(`{"data":[{"url":"` + server.URL + `/missing.png"},{"url":"` + server.URL + `/ok.png"}]}`)
	out, err := inlineUpstreamImageURLs(body)

	require.NoError(t, err)
	assert.NotContains(t, string(out), "/missing.png")
	assert.NotContains(t, string(out), server.URL+"/ok.png")
	assert.Contains(t, string(out), "b64_json")
}

func TestInlineUpstreamImageURLsIgnoresNonJSONBodies(t *testing.T) {
	body := []byte("data: {\"partial\":true}\n\n")
	out, err := inlineUpstreamImageURLs(body)

	require.NoError(t, err)
	assert.Equal(t, body, out)
}

func TestRedactPlaygroundImageErrorBody(t *testing.T) {
	body := []byte(`{"error":{"message":"failed to fetch https://cdn.provider.example/a.png"},"message_key":"failed to fetch https://cdn.provider.example/a.png"}`)

	out := redactPlaygroundImageErrorBody(body)

	assert.NotContains(t, string(out), "provider.example")
	assert.Contains(t, string(out), "***")
}

func TestPath2RelayModeRecognisesPlaygroundImageRoutes(t *testing.T) {
	assert.Equal(t, relayconstant.RelayModeImagesGenerations, relayconstant.Path2RelayMode("/pg/images/generations"))
	assert.Equal(t, relayconstant.RelayModeImagesEdits, relayconstant.Path2RelayMode("/pg/images/edits"))
}

func TestValidatePlaygroundImageEdit(t *testing.T) {
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)
	jpeg := append([]byte("\xff\xd8\xff\xe0"), make([]byte, 64)...)

	cases := []struct {
		name    string
		fields  map[string]string
		images  [][]byte
		wantKey string
	}{
		{
			name:   "accepts a supported image",
			fields: map[string]string{"model": "gpt-image-2.5", "prompt": "repaint"},
			images: [][]byte{png},
		},
		{
			name:   "accepts multiple images",
			fields: map[string]string{"model": "gpt-image-2.5", "prompt": "repaint"},
			images: [][]byte{png, jpeg},
		},
		{
			name:    "rejects a missing model",
			fields:  map[string]string{"prompt": "repaint"},
			images:  [][]byte{png},
			wantKey: "Model and prompt are required",
		},
		{
			name:    "rejects a request without images",
			fields:  map[string]string{"model": "gpt-image-2.5", "prompt": "repaint"},
			wantKey: "At least one reference image is required",
		},
		{
			name:    "rejects too many images",
			fields:  map[string]string{"model": "gpt-image-2.5", "prompt": "repaint"},
			images:  [][]byte{png, png, png, png, png},
			wantKey: "A maximum of {{count}} reference images is allowed",
		},
		{
			name:    "rejects files that are not images",
			fields:  map[string]string{"model": "gpt-image-2.5", "prompt": "repaint"},
			images:  [][]byte{[]byte("plain text is not an image")},
			wantKey: "Reference images must be PNG, JPEG or WebP",
		},
		{
			name:    "rejects oversized images",
			fields:  map[string]string{"model": "gpt-image-2.5", "prompt": "repaint"},
			images:  [][]byte{append(png, make([]byte, playgroundEditMaxImageBytes)...)},
			wantKey: "Each reference image must be {{size}} MB or smaller",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := newImageEditContext(tc.fields, tc.images)
			message := validatePlaygroundImageEdit(c)

			if tc.wantKey == "" {
				assert.Nil(t, message)
				return
			}
			require.NotNil(t, message)
			assert.Equal(t, tc.wantKey, message.Key)
		})
	}
}

func newImageEditContext(fields map[string]string, images [][]byte) *gin.Context {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		_ = writer.WriteField(key, value)
	}
	for index, image := range images {
		part, _ := writer.CreateFormFile("image", "ref-"+string(rune('a'+index))+".png")
		_, _ = part.Write(image)
	}
	_ = writer.Close()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/pg/images/edits", body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	return c
}
