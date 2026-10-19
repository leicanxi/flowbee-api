package controller

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
)

func TestInlineUpstreamImageURLsReplacesURLWithBase64(t *testing.T) {
	imageBytes := []byte("fake-png-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(imageBytes)
	}))
	defer server.Close()

	body := []byte(`{"created":1,"data":[{"url":"` + server.URL + `/a.png","revised_prompt":"x"}]}`)
	out := inlineUpstreamImageURLs(body)

	if bytes.Contains(out, []byte(server.URL)) {
		t.Fatalf("upstream url leaked to client: %s", out)
	}

	var payload map[string]any
	if err := common.Unmarshal(out, &payload); err != nil {
		t.Fatalf("unmarshal rewritten body: %v", err)
	}
	items, ok := payload["data"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("unexpected data shape: %v", payload["data"])
	}
	item := items[0].(map[string]any)
	encoded, _ := item["b64_json"].(string)
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode b64_json: %v", err)
	}
	if !bytes.Equal(decoded, imageBytes) {
		t.Fatalf("decoded image mismatch: %q", decoded)
	}
	if _, exists := item["url"]; exists {
		t.Fatal("url field should be removed")
	}
	if item["revised_prompt"] != "x" {
		t.Fatal("unrelated fields must be preserved")
	}
	if payload["created"] == nil {
		t.Fatal("top level fields must be preserved")
	}
}

func TestInlineUpstreamImageURLsKeepsBodyWhenDownloadFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusNotFound)
	}))
	defer server.Close()

	body := []byte(`{"data":[{"url":"` + server.URL + `/missing.png"}]}`)
	out := inlineUpstreamImageURLs(body)

	if !bytes.Contains(out, []byte(server.URL)) {
		t.Fatal("a failed download must keep the original url instead of dropping the image")
	}
}

func TestInlineUpstreamImageURLsIgnoresNonJSONBodies(t *testing.T) {
	body := []byte("data: {\"partial\":true}\n\n")
	out := inlineUpstreamImageURLs(body)
	if !bytes.Equal(body, out) {
		t.Fatalf("streaming body must pass through untouched, got %q", out)
	}
}

func TestPath2RelayModeRecognisesPlaygroundImageRoute(t *testing.T) {
	if got := relayconstant.Path2RelayMode("/pg/images/generations"); got != relayconstant.RelayModeImagesGenerations {
		t.Fatalf("expected image generations relay mode, got %d", got)
	}
}
