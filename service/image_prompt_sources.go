package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

const imagePromptSourceMaxBytes = 16 << 20

type imagePromptSource struct {
	id               string
	name             string
	repoURL          string
	rawBase          string
	files            []string
	fallbackCategory string
	parse            func(imagePromptSource, map[string]string) []ImagePrompt
}

// 提示词素材取自公开的提示词精选仓库：这些仓库本身就是社区整理、可公开访问的
// 内容，提示词广场只做聚合与缓存，不镜像内容。
var imagePromptSources = []imagePromptSource{
	{
		id:      "davidwu-gpt-image-2",
		name:    "Awesome GPT Image 2",
		repoURL: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
		rawBase: "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main",
		files:   []string{"prompts.json"},
		parse:   parseDavidWuImagePrompts,
	},
	{
		id:               "zero-lu-gpt-image",
		name:             "Awesome GPT Image",
		repoURL:          "https://github.com/ZeroLu/awesome-gpt-image",
		rawBase:          "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main",
		files:            []string{"README.zh-CN.md"},
		fallbackCategory: "GPT Image 2",
		parse:            parseZeroLuImagePrompts,
	},
	{
		id:               "youmind-nano-banana-pro",
		name:             "Nano Banana Pro Prompts",
		repoURL:          "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
		rawBase:          "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main",
		files:            []string{"README_zh.md"},
		fallbackCategory: "Nano Banana Pro",
		parse:            parseYouMindImagePrompts,
	},
	{
		id:               "youmind-gpt-image-2",
		name:             "GPT Image 2 Prompts",
		repoURL:          "https://github.com/YouMind-OpenLab/awesome-gpt-image-2",
		rawBase:          "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main",
		files:            []string{"README_zh.md"},
		fallbackCategory: "GPT Image 2",
		parse:            parseYouMindImagePrompts,
	},
}

var (
	imagePromptLinkPattern            = regexp.MustCompile(`\[([^\]]+)]\([^)]+\)`)
	imagePromptEmojiPrefixPattern     = regexp.MustCompile(`^[^\p{L}\p{N}]+`)
	imagePromptBylinePattern          = regexp.MustCompile(`(?i)\s+\(by\b.*$`)
	imagePromptImgTagPattern          = regexp.MustCompile(`<img[^>]+src="([^"]+)"`)
	imagePromptMarkdownImagePattern   = regexp.MustCompile(`!\[[^\]]*]\(([^)\s]+)\)`)
	imagePromptSectionHeadingPattern  = regexp.MustCompile(`(?m)^##\s+(.+)$`)
	imagePromptItemHeadingPattern     = regexp.MustCompile(`(?m)^###\s+(.+)$`)
	imagePromptNumberedHeadingPattern = regexp.MustCompile(`(?m)^###\s+No\.\s*\d+:\s*(.+)$`)
	// ZeroLu 与 YouMind 都用「提示词」标题加代码块承载提示词：
	// 一种是 **提示词:**，另一种是 #### 📝 提示词，后面都紧跟围栏代码块。
	imagePromptFencePattern  = regexp.MustCompile("(?s)(?:\\*\\*[^\\n]*提示词[^\\n]*\\*\\*|#{3,4}[^\\n]*提示词[^\\n]*)\\r?\\n+```[^\\n]*\\r?\\n(.*?)\\r?\\n```")
	imagePromptSourcePattern = regexp.MustCompile(`(?m)^\*{0,2}来源[:：]?\*{0,2}\s*\[([^\]]+)]\(([^)]+)\)`)
)

func fetchImagePrompts(ctx context.Context) ([]ImagePrompt, error) {
	client := GetSSRFProtectedHTTPClient()
	if client == nil {
		return nil, ErrImagePromptUpstream
	}
	results := make([][]ImagePrompt, len(imagePromptSources))
	var failures int
	var failuresMu sync.Mutex

	var wg sync.WaitGroup
	for index := range imagePromptSources {
		wg.Go(func() {
			source := imagePromptSources[index]
			items, err := fetchSingleImagePromptSource(ctx, client, source)
			if err != nil {
				common.SysLog(common.LogText("image prompt source unavailable (source=%s): %s", source.id, err.Error()))
				failuresMu.Lock()
				failures++
				failuresMu.Unlock()
				return
			}
			results[index] = items
		})
	}
	wg.Wait()

	if failures == len(imagePromptSources) {
		return nil, ErrImagePromptUpstream
	}

	total := 0
	for _, items := range results {
		total += len(items)
	}
	merged := make([]ImagePrompt, 0, total)
	seen := make(map[string]bool, total)
	for _, items := range results {
		for _, item := range items {
			// 多个素材源互相转载的情况很常见，按提示词正文去重。
			if seen[item.Prompt] {
				continue
			}
			seen[item.Prompt] = true
			item.searchText = imagePromptSearchText(item)
			merged = append(merged, item)
		}
	}

	if len(merged) < imagePromptMinItems {
		return nil, fmt.Errorf("%w: only %d items parsed", ErrImagePromptUpstream, len(merged))
	}
	return merged, nil
}

func fetchSingleImagePromptSource(ctx context.Context, client *http.Client, source imagePromptSource) ([]ImagePrompt, error) {
	files := make(map[string]string, len(source.files))
	for _, name := range source.files {
		body, err := fetchImagePromptSourceFile(ctx, client, source.rawBase+"/"+name)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		files[name] = body
	}
	return source.parse(source, files), nil
}

func fetchImagePromptSourceFile(ctx context.Context, client *http.Client, rawURL string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", "new-api-image-prompt-gallery")
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("unexpected status %d", response.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, imagePromptSourceMaxBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > imagePromptSourceMaxBytes {
		return "", fmt.Errorf("source file exceeds %d bytes", imagePromptSourceMaxBytes)
	}
	return string(data), nil
}

// parseDavidWuImagePrompts 解析结构化 prompts.json 素材。
func parseDavidWuImagePrompts(source imagePromptSource, files map[string]string) []ImagePrompt {
	var records []struct {
		ID         int    `json:"id"`
		TitleEN    string `json:"title_en"`
		TitleCN    string `json:"title_cn"`
		Category   string `json:"category"`
		CategoryCN string `json:"category_cn"`
		Prompt     string `json:"prompt"`
		Author     string `json:"author"`
		NeedsRef   bool   `json:"needs_ref"`
		Image      string `json:"image"`
	}
	if err := common.Unmarshal([]byte(files["prompts.json"]), &records); err != nil {
		return nil
	}

	items := make([]ImagePrompt, 0, len(records))
	for _, record := range records {
		title := strings.TrimSpace(record.TitleCN)
		if title == "" {
			title = strings.TrimSpace(record.TitleEN)
		}
		prompt := strings.TrimSpace(record.Prompt)
		cover := absoluteImagePromptURL(source.rawBase, record.Image)
		if title == "" || prompt == "" {
			continue
		}
		if _, ok := parseImagePromptCoverURL(cover); !ok {
			continue
		}

		category := strings.TrimSpace(record.CategoryCN)
		if category == "" {
			category = strings.TrimSpace(record.Category)
		}
		if category == "" {
			category = "GPT Image 2"
		}
		tags := make([]string, 0, 2)
		if author := strings.TrimSpace(record.Author); author != "" {
			tags = append(tags, author)
		}
		if record.NeedsRef {
			tags = append(tags, "需要参考图")
		}
		items = append(items, newImagePrompt(source, len(items), title, category, prompt, cover, tags, source.repoURL))
	}
	return items
}

// parseZeroLuImagePrompts 解析「## 分类 / ### 案例 / **提示词:** 代码块」结构。
func parseZeroLuImagePrompts(source imagePromptSource, files map[string]string) []ImagePrompt {
	items := []ImagePrompt{}
	for _, section := range splitImagePromptBlocks(files["README.zh-CN.md"], "## ") {
		category := cleanImagePromptText(firstImagePromptMatch(section, imagePromptSectionHeadingPattern))
		if category == "" {
			category = source.fallbackCategory
		}
		for _, block := range splitImagePromptBlocks(section, "### ") {
			title := cleanImagePromptText(firstImagePromptMatch(block, imagePromptItemHeadingPattern))
			prompt := strings.TrimSpace(firstImagePromptMatch(block, imagePromptFencePattern))
			images := markdownImageURLs(source, block)
			if title == "" || prompt == "" || len(images) == 0 {
				continue
			}

			sourceURL := source.repoURL
			tags := []string{}
			if match := imagePromptSourcePattern.FindStringSubmatch(block); len(match) == 3 {
				sourceURL = strings.TrimSpace(match[2])
				tags = append(tags, strings.TrimSpace(match[1]))
			}
			items = append(items, newImagePrompt(source, len(items), title, category, prompt, images[0], tags, sourceURL))
		}
	}
	return items
}

// parseYouMindImagePrompts 解析「### No. N: 标题 / #### 📝 提示词 代码块」结构。
// 标题常写成「分类 - 标题」，前半段会拆成分类用于筛选。
func parseYouMindImagePrompts(source imagePromptSource, files map[string]string) []ImagePrompt {
	items := []ImagePrompt{}
	for _, block := range splitImagePromptBlocks(files["README_zh.md"], "### ") {
		rawTitle := firstImagePromptMatch(block, imagePromptNumberedHeadingPattern)
		prompt := strings.TrimSpace(firstImagePromptMatch(block, imagePromptFencePattern))
		images := markdownImageURLs(source, block)
		if rawTitle == "" || prompt == "" || len(images) == 0 {
			continue
		}

		category, title := splitYouMindImagePromptTitle(cleanImagePromptText(rawTitle), source.fallbackCategory)
		items = append(items, newImagePrompt(source, len(items), title, category, prompt, images[0], nil, source.repoURL))
	}
	return items
}

func splitYouMindImagePromptTitle(rawTitle string, fallbackCategory string) (string, string) {
	before, after, found := strings.Cut(rawTitle, " - ")
	before = strings.TrimSpace(before)
	after = strings.TrimSpace(after)
	if found && before != "" && after != "" {
		return before, after
	}
	return fallbackCategory, rawTitle
}

func newImagePrompt(source imagePromptSource, index int, title, category, prompt, cover string, tags []string, sourceURL string) ImagePrompt {
	return ImagePrompt{
		ID:         fmt.Sprintf("%s-%03d", source.id, index+1),
		Title:      title,
		Prompt:     prompt,
		CoverURL:   cover,
		Category:   category,
		Tags:       tags,
		SourceName: source.name,
		SourceURL:  sourceURL,
	}
}

func imagePromptSearchText(item ImagePrompt) string {
	prompt := []rune(item.Prompt)
	if len(prompt) > imagePromptSearchPromptRunes {
		prompt = prompt[:imagePromptSearchPromptRunes]
	}
	return strings.ToLower(strings.Join([]string{
		item.Title,
		item.Category,
		strings.Join(item.Tags, " "),
		string(prompt),
	}, "\n"))
}

// splitImagePromptBlocks 按 Markdown 标题前缀切分区块，返回包含该标题行的区块。
func splitImagePromptBlocks(markdown string, prefix string) []string {
	blocks := []string{}
	lines := []string{}
	for line := range strings.SplitSeq(markdown, "\n") {
		if len(lines) > 0 && strings.HasPrefix(line, prefix) {
			blocks = append(blocks, strings.Join(lines, "\n"))
			lines = nil
		}
		lines = append(lines, line)
	}
	if len(lines) > 0 {
		blocks = append(blocks, strings.Join(lines, "\n"))
	}
	return blocks
}

func firstImagePromptMatch(value string, pattern *regexp.Regexp) string {
	match := pattern.FindStringSubmatch(value)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

// cleanImagePromptText 去掉标题里的链接、作者署名和开头的 emoji。
func cleanImagePromptText(raw string) string {
	text := strings.TrimSpace(raw)
	text = imagePromptLinkPattern.ReplaceAllString(text, "$1")
	text = imagePromptBylinePattern.ReplaceAllString(text, "")
	text = imagePromptEmojiPrefixPattern.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}

func markdownImageURLs(source imagePromptSource, block string) []string {
	images := []string{}
	for _, pattern := range []*regexp.Regexp{imagePromptImgTagPattern, imagePromptMarkdownImagePattern} {
		for _, match := range pattern.FindAllStringSubmatch(block, -1) {
			candidate := absoluteImagePromptURL(source.rawBase, match[1])
			if _, ok := parseImagePromptCoverURL(candidate); !ok || slices.Contains(images, candidate) {
				continue
			}
			images = append(images, candidate)
		}
	}
	return images
}

func absoluteImagePromptURL(baseURL string, image string) string {
	image = strings.TrimSpace(image)
	if image == "" {
		return ""
	}
	if strings.HasPrefix(image, "http://") || strings.HasPrefix(image, "https://") {
		return image
	}
	// 部分仓库的案例文件位于子目录，其中的 ../images 仍相对仓库根目录。
	for strings.HasPrefix(image, "../") {
		image = strings.TrimPrefix(image, "../")
	}
	image = strings.TrimPrefix(image, "./")
	return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(image, "/")
}
