package plugins_test

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadSingPlugin(t *testing.T) *jsplugin.LoadedPlugin {
	t.Helper()
	source, err := builtinplugins.Source("sing")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "sing"})
	require.NoError(t, err)
	return plugin
}

func singRoundTrip(t *testing.T, value any) map[string]any {
	t.Helper()
	encoded, err := common.Marshal(value)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(encoded, &decoded))
	return decoded
}

func TestSingPluginNativeJobFlow(t *testing.T) {
	plugin := loadSingPlugin(t)
	submitCtx := map[string]any{
		"model":         "sing-song",
		"upstreamModel": "sing-song",
		"baseUrl":       "http://172.17.0.1:9001/",
		"apiKey":        "gateway-token",
		"requestBody":   map[string]any{"song": "雨爱", "voice": "keine", "duration": 60, "instrumental_volume": 0, "backup_vocals_volume": -12},
	}

	value, err := plugin.Engine.Call(t.Context(), "buildSubmitRequest", submitCtx)
	require.NoError(t, err)
	descriptor := singRoundTrip(t, value)
	assert.Equal(t, "http://172.17.0.1:9001/sing/v1/jobs", descriptor["url"])
	assert.Equal(t, "POST", descriptor["method"])
	headers := descriptor["headers"].(map[string]any)
	assert.Equal(t, "Bearer gateway-token", headers["Authorization"])
	body := descriptor["body"].(map[string]any)
	assert.Equal(t, "雨爱", body["song"])
	assert.Equal(t, float64(60), body["duration"])
	// 混音增益必须原样到达网关：网关默认 -60（伴奏静音），插件一旦丢掉这两个字段，
	// 客户端把 instrumental_volume 调成 0 也永远拿不到伴奏。0 不能当成空值过滤掉。
	assert.Equal(t, float64(0), body["instrumental_volume"])
	assert.Equal(t, float64(-12), body["backup_vocals_volume"])

	value, err = plugin.Engine.Call(t.Context(), "parseSubmitResponse", map[string]any{}, map[string]any{
		"body": map[string]any{"id": "job_1", "status": "queued"},
	})
	require.NoError(t, err)
	parsed := singRoundTrip(t, value)
	assert.Equal(t, "job_1", parsed["taskId"])

	value, err = plugin.Engine.Call(t.Context(), "buildQueryRequest", map[string]any{
		"taskId":  "job_1",
		"baseUrl": "http://172.17.0.1:9001",
		"apiKey":  "gateway-token",
	})
	require.NoError(t, err)
	descriptor = singRoundTrip(t, value)
	assert.Equal(t, "http://172.17.0.1:9001/sing/v1/jobs/job_1", descriptor["url"])

	value, err = plugin.Engine.Call(t.Context(), "parseTaskResult", map[string]any{"taskId": "job_1"}, map[string]any{
		"status": "succeeded", "audio_url": "https://cdn/a.mp3", "duration_seconds": 42, "cached": true,
	})
	require.NoError(t, err)
	result := singRoundTrip(t, value)
	assert.Equal(t, "SUCCESS", result["status"])
	assert.Equal(t, "https://cdn/a.mp3", result["url"])
}

func TestSingPluginUsageFacts(t *testing.T) {
	plugin := loadSingPlugin(t)
	for _, testCase := range []struct {
		name     string
		request  map[string]any
		expected map[string]any
	}{
		{"requested", map[string]any{"duration": 60}, map[string]any{"seconds": float64(60), "cached": false}},
		{"clamps long", map[string]any{"duration": 999}, map[string]any{"seconds": float64(600), "cached": false}},
		{"defaults missing", map[string]any{}, map[string]any{"seconds": float64(25), "cached": false}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			value, err := plugin.Engine.Call(t.Context(), "extractUsage", map[string]any{
				"usagePurpose": "facts", "requestBody": testCase.request,
			})
			require.NoError(t, err)
			assert.Equal(t, testCase.expected, singRoundTrip(t, value))
		})
	}

	value, err := plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{}, map[string]any{}, map[string]any{
		"duration_seconds": 42, "cached": true,
	})
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"seconds": float64(42), "cached": true}, singRoundTrip(t, value))

	value, err = plugin.Engine.Call(t.Context(), "extractUsageOnComplete", map[string]any{}, map[string]any{}, map[string]any{})
	require.NoError(t, err)
	assert.Nil(t, value)
}

func TestSingPluginNativeStatusMapsHostFailure(t *testing.T) {
	plugin := loadSingPlugin(t)
	value, err := plugin.Engine.CallPath(t.Context(), "native", []string{"taskStatus"}, map[string]any{}, map[string]any{
		"status":      "FAILURE",
		"task_id":     "task_public",
		"fail_reason": "no song found",
		"data":        map[string]any{"status": "running", "error": ""},
	})
	require.NoError(t, err)
	view := singRoundTrip(t, value)
	assert.Equal(t, "failed", view["status"])
	assert.Equal(t, "no song found", view["error"])
	assert.Equal(t, "task_public", view["id"])
}

func TestSingPluginNativeDecodeResolvesModel(t *testing.T) {
	plugin := loadSingPlugin(t)
	body := map[string]any{"kind": "json", "value": map[string]any{"song": "雨爱", "duration": 30}}

	// Native routes carry no pinned model: the body's model wins...
	value, err := plugin.Engine.CallPath(t.Context(), "native", []string{"decodeSubmit"}, map[string]any{
		"body": map[string]any{"kind": "json", "value": map[string]any{"model": "sing-song", "song": "雨爱"}},
	})
	require.NoError(t, err)
	decoded := singRoundTrip(t, value)
	assert.Equal(t, "sing-song", decoded["model"])

	// ...and without one the plugin's only model is used.
	value, err = plugin.Engine.CallPath(t.Context(), "native", []string{"decodeSubmit"}, map[string]any{"body": body})
	require.NoError(t, err)
	decoded = singRoundTrip(t, value)
	assert.Equal(t, "sing-song", decoded["model"])
	assert.Equal(t, float64(30), plainMap(decoded["requestBody"])["duration"])
}

func plainMap(value any) map[string]any {
	m, _ := value.(map[string]any)
	return m
}

func TestSingPluginResponsesDecodeEchoesAlias(t *testing.T) {
	plugin := loadSingPlugin(t)
	value, err := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_responses", "decodeRequest"}, map[string]any{
		"model": "alias-under-test", "stream": false,
		"body": map[string]any{"kind": "json", "value": map[string]any{
			"model": "alias-under-test", "input": "雨爱", "duration": 30,
		}},
	})
	require.NoError(t, err)
	decoded := singRoundTrip(t, value)
	assert.Equal(t, "submit", decoded["kind"])
	assert.Equal(t, "alias-under-test", decoded["model"])
	requestBody := decoded["requestBody"].(map[string]any)
	assert.Equal(t, "雨爱", requestBody["song"])
	assert.Equal(t, float64(30), requestBody["duration"])
}
