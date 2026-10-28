package setting

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// ImageModelCapsOptionKey 是生图模型能力表在 option 表中的键。
//
// 这张表决定生成图片的网页给每个模型开放哪些分辨率/比例选项。它刻意不提供
// 后台编辑界面：上游（openpix 这类中转站）随时会改模型清单和参数口径，运维
// 只需要 PUT /api/option/ 写入一段新的 JSON，OptionMap 立即生效，既不用改代码
// 也不用重启容器。
//
// 约定：表里没有列出的模型，前端不显示任何分辨率选项（按上游默认尺寸出图）。
// 这比给一个可能全错的兜底列表安全——grok 只认 aspect_ratio，塞 size 给它
// 只会让用户以为选了生效而实际没生效。
const ImageModelCapsOptionKey = "ImageModelCaps"

const (
	ImageCapsMatchExact    = "exact"
	ImageCapsMatchPrefix   = "prefix"
	ImageCapsMatchSuffix   = "suffix"
	ImageCapsMatchContains = "contains"
)

// 匹配优先级：exact > prefix > suffix > contains。同优先级取表中靠前的一条。
var imageCapsMatchRank = map[string]int{
	ImageCapsMatchExact:    0,
	ImageCapsMatchPrefix:   1,
	ImageCapsMatchSuffix:   2,
	ImageCapsMatchContains: 3,
}

// ImageModelCapsParams 描述一个模型允许客户端指定的出图参数。
//
// size 与 aspect_ratio 通常互斥：真正的尺寸参数（gpt-image 系、gemini 系）认
// size，只出固定分辨率的模型（grok-imagine-image）认 aspect_ratio。
type ImageModelCapsParams struct {
	Size        []string `json:"size,omitempty"`
	AspectRatio []string `json:"aspect_ratio,omitempty"`
}

// ImageModelCapsRule 把一个模型名（或其前缀/后缀）绑定到一组可用参数。
//
// Note 只给运维看，前端不消费，用来记录实测结论（比如"传 4096 会被静默降到
// 1254"），免得下一个改这张表的人重新踩一遍。
type ImageModelCapsRule struct {
	Match string `json:"match,omitempty"`
	Model string `json:"model"`
	ImageModelCapsParams
	Note string `json:"note,omitempty"`
}

// ImageModelCaps 是整张能力表。
type ImageModelCaps struct {
	Version int                  `json:"version"`
	Rules   []ImageModelCapsRule `json:"rules"`
}

func defaultImageCapsMatch(match string) string {
	if strings.TrimSpace(match) == "" {
		return ImageCapsMatchExact
	}
	return strings.ToLower(strings.TrimSpace(match))
}

// builtinImageModelCaps 是 2026-10-29 对 openpix.cc 的实测结果。
//
// 只在 Option 里没有配置（全新部署）或配置被写坏时使用。日常调整走
// PUT /api/option/，不要改这里——改了要重新构建镜像。
func builtinImageModelCaps() ImageModelCaps {
	return ImageModelCaps{
		Version: 1,
		Rules: []ImageModelCapsRule{
			{
				Match: ImageCapsMatchExact,
				Model: "gpt-image-2",
				ImageModelCapsParams: ImageModelCapsParams{
					Size: []string{"1024x1024", "1536x1024", "1024x1536", "2048x2048", "4096x4096"},
				},
				Note: "4096 实测可用；非方形尺寸会被压到约 1.5MP",
			},
			{
				Match: ImageCapsMatchExact,
				Model: "gpt-image-2-2k",
				ImageModelCapsParams: ImageModelCapsParams{
					Size: []string{"1024x1024", "2048x2048"},
				},
				Note: "上游硬顶 2K，传 4096 直接报错",
			},
			{
				Match: ImageCapsMatchPrefix,
				Model: "gpt-image-2.5",
				ImageModelCapsParams: ImageModelCapsParams{
					Size: []string{"1024x1024", "1254x1254"},
				},
				Note: "全系静默降级：传更大尺寸返回 200 但实际出 1254",
			},
			{
				Match: ImageCapsMatchExact,
				Model: "gemini-nano-banana-2.1",
				ImageModelCapsParams: ImageModelCapsParams{
					Size: []string{"1024x1024", "2048x2048", "4096x4096"},
				},
				Note: "真 4K；后缀式 -1k/-2k/-4k 已被上游下架，只能用 size",
			},
			{
				Match: ImageCapsMatchExact,
				Model: "grok-imagine-image",
				ImageModelCapsParams: ImageModelCapsParams{
					AspectRatio: []string{"16:9", "1:1", "9:16"},
				},
				Note: "只认 aspect_ratio（16:9 出 1280x720），不能放大",
			},
			{
				Match: ImageCapsMatchExact,
				Model: "grok-imagine-image-2.0",
				Note:  "size 和 aspect_ratio 都被上游忽略，固定 1248x832",
			},
			{
				Match: ImageCapsMatchPrefix,
				Model: "dall-e",
				ImageModelCapsParams: ImageModelCapsParams{
					Size: []string{"1024x1024", "1792x1024", "1024x1792"},
				},
			},
		},
	}
}

// normalizeImageModelCaps 统一小写、去空白，让运行时匹配不必反复做字符串处理。
func normalizeImageModelCaps(caps *ImageModelCaps) {
	for i := range caps.Rules {
		rule := &caps.Rules[i]
		rule.Match = defaultImageCapsMatch(rule.Match)
		rule.Model = strings.ToLower(strings.TrimSpace(rule.Model))
		rule.Size = normalizeCapsValues(rule.Size)
		rule.AspectRatio = normalizeCapsValues(rule.AspectRatio)
	}
}

func normalizeCapsValues(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// LoadImageModelCaps 读取当前生效的能力表。
//
// 配置缺失或被写坏时回落到内置表：生图页是用户直接可见的入口，不能因为一段
// 配置错误就整页失去分辨率选择。
func LoadImageModelCaps() ImageModelCaps {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[ImageModelCapsOptionKey]
	common.OptionMapRWMutex.RUnlock()

	if strings.TrimSpace(raw) == "" {
		caps := builtinImageModelCaps()
		normalizeImageModelCaps(&caps)
		return caps
	}

	caps := ImageModelCaps{}
	if err := common.UnmarshalJsonStr(raw, &caps); err != nil || len(caps.Rules) == 0 {
		fallback := builtinImageModelCaps()
		normalizeImageModelCaps(&fallback)
		return fallback
	}
	normalizeImageModelCaps(&caps)
	return caps
}

// Resolve 返回该模型可用的参数。第二个返回值表示是否命中表中任意一条规则；
// 未命中时调用方应当不显示任何分辨率选项。
func (caps *ImageModelCaps) Resolve(modelName string) (ImageModelCapsParams, bool) {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if name == "" {
		return ImageModelCapsParams{}, false
	}
	bestRank := -1
	var matched *ImageModelCapsRule
	for i := range caps.Rules {
		rule := &caps.Rules[i]
		rank, ok := imageCapsRuleRank(rule, name)
		if !ok {
			continue
		}
		if bestRank == -1 || rank < bestRank {
			bestRank = rank
			matched = rule
		}
	}
	if matched == nil {
		return ImageModelCapsParams{}, false
	}
	return matched.ImageModelCapsParams, true
}

func imageCapsRuleRank(rule *ImageModelCapsRule, name string) (int, bool) {
	match := defaultImageCapsMatch(rule.Match)
	rank, known := imageCapsMatchRank[match]
	if !known || rule.Model == "" {
		return 0, false
	}
	var hit bool
	switch match {
	case ImageCapsMatchPrefix:
		hit = strings.HasPrefix(name, rule.Model)
	case ImageCapsMatchSuffix:
		hit = strings.HasSuffix(name, rule.Model)
	case ImageCapsMatchContains:
		hit = strings.Contains(name, rule.Model)
	default:
		hit = name == rule.Model
	}
	return rank, hit
}

var (
	imageCapsSizePattern  = regexp.MustCompile(`^[0-9]+x[0-9]+$`)
	imageCapsRatioPattern = regexp.MustCompile(`^[0-9]+:[0-9]+$`)
)

// ValidateImageModelCaps 在写入 option 前校验，避免把一段前端解析不了的 JSON
// 推进线上。返回的错误会直接显示给调用方。
func ValidateImageModelCaps(raw string) error {
	caps := ImageModelCaps{}
	if err := common.UnmarshalJsonStr(raw, &caps); err != nil {
		return fmt.Errorf("capability table must be valid JSON: %w", err)
	}
	if len(caps.Rules) == 0 {
		return fmt.Errorf("rules must not be empty; add at least one model entry")
	}
	seen := make(map[string]struct{}, len(caps.Rules))
	for i, rule := range caps.Rules {
		model := strings.ToLower(strings.TrimSpace(rule.Model))
		if model == "" {
			return fmt.Errorf("rules[%d].model is required", i)
		}
		match := defaultImageCapsMatch(rule.Match)
		if _, known := imageCapsMatchRank[match]; !known {
			return fmt.Errorf("rules[%d].match must be one of exact/prefix/suffix/contains", i)
		}
		key := match + ":" + model
		if _, duplicated := seen[key]; duplicated {
			return fmt.Errorf("rules[%d] duplicates %s rule for %q", i, match, model)
		}
		seen[key] = struct{}{}
		for _, size := range rule.Size {
			if !imageCapsSizePattern.MatchString(strings.TrimSpace(size)) {
				return fmt.Errorf("rules[%d].size %q must look like 1024x1024", i, size)
			}
		}
		for _, ratio := range rule.AspectRatio {
			if !imageCapsRatioPattern.MatchString(strings.TrimSpace(ratio)) {
				return fmt.Errorf("rules[%d].aspect_ratio %q must look like 16:9", i, ratio)
			}
		}
	}
	return nil
}

// ImageModelCaps2JSONString 供运维复制出一份可编辑的当前配置。
func ImageModelCaps2JSONString() string {
	bytes, err := common.Marshal(LoadImageModelCaps())
	if err != nil {
		return ""
	}
	return string(bytes)
}
