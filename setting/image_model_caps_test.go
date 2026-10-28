package setting

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestBuiltinImageModelCapsResolvesKnownModels(t *testing.T) {
	caps := builtinImageModelCaps()
	normalizeImageModelCaps(&caps)

	cases := []struct {
		model      string
		wantSizes  []string
		wantRatios []string
	}{
		{"gpt-image-2", []string{"1024x1024", "1536x1024", "1024x1536", "2048x2048", "4096x4096"}, nil},
		{"gpt-image-2-2k", []string{"1024x1024", "2048x2048"}, nil},
		{"gemini-nano-banana-2.1", []string{"1024x1024", "2048x2048", "4096x4096"}, nil},
		{"grok-imagine-image", nil, []string{"16:9", "1:1", "9:16"}},
		{"grok-imagine-image-2.0", nil, nil},
		{"dall-e-3", []string{"1024x1024", "1792x1024", "1024x1792"}, nil},
	}
	for _, testCase := range cases {
		params, matched := caps.Resolve(testCase.model)
		if !matched {
			t.Fatalf("%s should match a rule", testCase.model)
		}
		if len(params.Size) != len(testCase.wantSizes) {
			t.Fatalf("%s sizes = %v, want %v", testCase.model, params.Size, testCase.wantSizes)
		}
		for i, size := range testCase.wantSizes {
			if params.Size[i] != size {
				t.Fatalf("%s size[%d] = %q, want %q", testCase.model, i, params.Size[i], size)
			}
		}
		for i, ratio := range testCase.wantRatios {
			if params.AspectRatio[i] != ratio {
				t.Fatalf("%s aspect_ratio[%d] = %q, want %q", testCase.model, i, params.AspectRatio[i], ratio)
			}
		}
	}
}

// gpt-image-2.5 与 gpt-image-2 前缀相近，前者必须走 prefix 规则而不是被
// exact 规则吞掉；同时 gpt-image-2-1k 这类名字带档位的模型不应命中 gpt-image-2。
func TestBuiltinImageModelCapsPrefersExactOverPrefix(t *testing.T) {
	caps := builtinImageModelCaps()
	normalizeImageModelCaps(&caps)

	flare, matched := caps.Resolve("gpt-image-2.5-flare")
	if !matched {
		t.Fatal("gpt-image-2.5-flare should match the gpt-image-2.5 prefix rule")
	}
	if len(flare.Size) != 2 || flare.Size[1] != "1254x1254" {
		t.Fatalf("gpt-image-2.5-flare sizes = %v, want the 2.5 tier list", flare.Size)
	}

	if _, matched := caps.Resolve("gpt-image-2-1k"); matched {
		t.Fatal("gpt-image-2-1k encodes its tier in the name and must not expose a size selector")
	}
}

func TestImageModelCapsUnknownModelDoesNotMatch(t *testing.T) {
	caps := builtinImageModelCaps()
	normalizeImageModelCaps(&caps)
	if _, matched := caps.Resolve("some-new-image-model"); matched {
		t.Fatal("unknown models must not fall back to a guessed option list")
	}
	if _, matched := caps.Resolve(""); matched {
		t.Fatal("empty model name must not match")
	}
}

func TestValidateImageModelCapsRejectsBadInput(t *testing.T) {
	cases := map[string]string{
		"not json":       `{`,
		"empty rules":    `{"version":1,"rules":[]}`,
		"missing model":  `{"rules":[{"size":["1024x1024"]}]}`,
		"bad match":      `{"rules":[{"match":"regex","model":"x"}]}`,
		"bad size":       `{"rules":[{"model":"x","size":["1024*1024"]}]}`,
		"bad ratio":      `{"rules":[{"model":"x","aspect_ratio":["16/9"]}]}`,
		"duplicate rule": `{"rules":[{"model":"x"},{"model":"x"}]}`,
	}
	for name, raw := range cases {
		if err := ValidateImageModelCaps(raw); err == nil {
			t.Fatalf("%s should be rejected", name)
		}
	}
}

func TestValidateImageModelCapsAcceptsManagedTable(t *testing.T) {
	raw := `{"version":1,"rules":[{"match":"prefix","model":"gpt-image-2.5","size":["1024x1024"],"note":"静默降级"},{"match":"exact","model":"grok-imagine-image","aspect_ratio":["16:9"]}]}`
	if err := ValidateImageModelCaps(raw); err != nil {
		t.Fatalf("valid table rejected: %v", err)
	}
}

func TestImageModelCaps2JSONStringFlattensParams(t *testing.T) {
	restore := setImageCapsOption(t, "")
	defer restore()

	raw := ImageModelCaps2JSONString()
	// 前端直接读 rules[].size / rules[].aspect_ratio，内嵌 struct 必须平铺，
	// 不能出现嵌套的 params 对象，否则下拉框会一直是空的。
	if !strings.Contains(raw, `"size":["1024x1024"`) {
		t.Fatalf("serialized rules should expose a flat size array, got %s", raw)
	}
	if strings.Contains(raw, "ImageModelCapsParams") || strings.Contains(raw, `"params"`) {
		t.Fatalf("embedded params must be flattened, got %s", raw)
	}
	if !strings.Contains(raw, `"aspect_ratio":["16:9"`) {
		t.Fatalf("serialized rules should expose aspect_ratio, got %s", raw)
	}
}

// 配置被写坏时必须回落到内置表，否则生图页会整页失去分辨率选项。
func TestLoadImageModelCapsFallsBackWhenBroken(t *testing.T) {
	restore := setImageCapsOption(t, `{"rules":`)
	defer restore()

	caps := LoadImageModelCaps()
	if _, matched := caps.Resolve("gpt-image-2"); !matched {
		t.Fatal("broken config should fall back to the builtin table")
	}
	if !strings.Contains(ImageModelCaps2JSONString(), "gpt-image-2") {
		t.Fatal("serialized caps should expose the builtin rules")
	}
}

// 配了自定义表时必须以自定义表为准，否则运维改了没反应。
func TestLoadImageModelCapsPrefersConfiguredTable(t *testing.T) {
	restore := setImageCapsOption(t, `{"version":1,"rules":[{"model":"gpt-image-2","size":["512x512"]}]}`)
	defer restore()

	caps := LoadImageModelCaps()
	params, matched := caps.Resolve("gpt-image-2")
	if !matched {
		t.Fatal("configured rule should match")
	}
	if len(params.Size) != 1 || params.Size[0] != "512x512" {
		t.Fatalf("sizes = %v, want the configured 512x512 only", params.Size)
	}
}

// setImageCapsOption 临时改写 OptionMap 中的能力表，返回的函数用于还原。
func setImageCapsOption(t *testing.T, raw string) func() {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	original, had := common.OptionMap[ImageModelCapsOptionKey]
	common.OptionMap[ImageModelCapsOptionKey] = raw
	common.OptionMapRWMutex.Unlock()

	return func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if had {
			common.OptionMap[ImageModelCapsOptionKey] = original
		} else {
			delete(common.OptionMap, ImageModelCapsOptionKey)
		}
	}
}
