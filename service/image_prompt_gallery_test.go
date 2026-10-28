package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseZeroLuImagePrompts(t *testing.T) {
	markdown := strings.Join([]string{
		"## 📷 摄影与照片级写实",
		"",
		"用于生成超真实场景。",
		"",
		"### 现实中的名人",
		`<img width="500" alt="image" src="https://github.com/user-attachments/assets/case-1" />`,
		"",
		"**提示词:**",
		"```text",
		"三位名人在电影院柜台后面工作",
		"```",
		"**来源:** [@flowersslop](https://x.com/flowersslop/status/1)",
		"",
		"### 只有图片的案例",
		`<img src="https://github.com/user-attachments/assets/case-2" />`,
		"",
		"## 🎮 游戏与娱乐",
		"",
		"### 像素冒险",
		`![预览](https://pbs.twimg.com/media/case-3?format=jpg&name=large)`,
		"",
		"**提示词:**",
		"```text",
		"复古像素风冒险场景",
		"```",
	}, "\n")

	source := imagePromptSource{
		id:               "zero-lu-gpt-image",
		name:             "Awesome GPT Image",
		repoURL:          "https://github.com/ZeroLu/awesome-gpt-image",
		rawBase:          "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main",
		fallbackCategory: "GPT Image 2",
	}

	items := parseZeroLuImagePrompts(source, map[string]string{"README.zh-CN.md": markdown})

	require.Len(t, items, 2)
	assert.Equal(t, "zero-lu-gpt-image-001", items[0].ID)
	assert.Equal(t, "现实中的名人", items[0].Title)
	assert.Equal(t, "摄影与照片级写实", items[0].Category)
	assert.Equal(t, "三位名人在电影院柜台后面工作", items[0].Prompt)
	assert.Equal(t, "https://github.com/user-attachments/assets/case-1", items[0].CoverURL)
	assert.Equal(t, []string{"@flowersslop"}, items[0].Tags)
	assert.Equal(t, "https://x.com/flowersslop/status/1", items[0].SourceURL)

	assert.Equal(t, "像素冒险", items[1].Title)
	assert.Equal(t, "游戏与娱乐", items[1].Category)
	assert.Equal(t, "https://pbs.twimg.com/media/case-3?format=jpg&name=large", items[1].CoverURL)
	assert.Empty(t, items[1].Tags)
	assert.Equal(t, source.repoURL, items[1].SourceURL)
}

func TestParseYouMindImagePrompts(t *testing.T) {
	markdown := strings.Join([]string{
		"### No. 1: 个人资料 / 头像 - 真实街头遛狗自拍快照",
		"",
		"![Language-EN](https://img.shields.io/badge/Language-EN-blue)",
		"",
		"#### 📝 提示词",
		"",
		"```",
		"一张街头自拍快照",
		"```",
		"",
		"#### 🖼️ 生成图片",
		"",
		`<img src="https://cms-assets.youmind.com/media/first.jpg" width="700" />`,
		"",
		"### No. 2: 没有配图的提示词",
		"",
		"#### 📝 提示词",
		"",
		"```",
		"只有文字",
		"```",
		"",
		"### No. 3: 越南夜市小吃摊",
		"",
		"#### 📝 提示词",
		"",
		"```",
		"热闹的夜市小吃摊",
		"```",
		"",
		`<img src="https://cms-assets.youmind.com/media/third.jpg" width="700" />`,
	}, "\n")

	source := imagePromptSource{
		id:               "youmind-nano-banana-pro",
		name:             "Nano Banana Pro Prompts",
		repoURL:          "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
		rawBase:          "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main",
		fallbackCategory: "Nano Banana Pro",
	}

	items := parseYouMindImagePrompts(source, map[string]string{"README_zh.md": markdown})

	require.Len(t, items, 2)
	assert.Equal(t, "真实街头遛狗自拍快照", items[0].Title)
	assert.Equal(t, "个人资料 / 头像", items[0].Category)
	assert.Equal(t, "一张街头自拍快照", items[0].Prompt)
	assert.Equal(t, "https://cms-assets.youmind.com/media/first.jpg", items[0].CoverURL)

	assert.Equal(t, "越南夜市小吃摊", items[1].Title)
	assert.Equal(t, "Nano Banana Pro", items[1].Category)
}

func TestParseDavidWuImagePrompts(t *testing.T) {
	raw := `[
		{"id": 1, "title_en": "Real Object Ad", "title_cn": "实物+手绘涂鸦创意广告", "category": "advertising",
		 "category_cn": "广告设计", "prompt": "A minimalist creative advertisement", "author": "@azed_ai",
		 "needs_ref": true, "image": "images/1.png"},
		{"id": 2, "title_cn": "", "title_en": "", "prompt": "orphan record", "image": "images/2.png"},
		{"id": 3, "title_en": "Korea Market", "category": "advertising", "prompt": "A Korea market snapshot",
		 "image": "https://pbs.twimg.com/media/direct?format=jpg"},
		{"id": 4, "title_en": "Blocked cover", "prompt": "image outside the allowlist", "image": "https://example.com/4.png"}
	]`

	source := imagePromptSource{
		id:      "davidwu-gpt-image-2",
		name:    "Awesome GPT Image 2",
		repoURL: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
		rawBase: "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main",
	}

	items := parseDavidWuImagePrompts(source, map[string]string{"prompts.json": raw})

	require.Len(t, items, 2)
	assert.Equal(t, "实物+手绘涂鸦创意广告", items[0].Title)
	assert.Equal(t, "广告设计", items[0].Category)
	assert.Equal(t, "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main/images/1.png", items[0].CoverURL)
	assert.Equal(t, []string{"@azed_ai", "需要参考图"}, items[0].Tags)

	assert.Equal(t, "Korea Market", items[1].Title)
	assert.Equal(t, "advertising", items[1].Category)
	assert.Equal(t, "https://pbs.twimg.com/media/direct?format=jpg", items[1].CoverURL)
}

func TestGetImagePromptsFiltersAndPaginates(t *testing.T) {
	previous := imagePromptGalleryCache
	t.Cleanup(func() { imagePromptGalleryCache = previous })

	items := []ImagePrompt{
		{ID: "1", Title: "Night Street Portrait", Category: "摄影", Prompt: "a neon street at night"},
		{ID: "2", Title: "Product Poster", Category: "海报设计", Prompt: "a minimal product poster"},
		{ID: "3", Title: "City Poster", Category: "海报设计", Prompt: "a rainy city poster"},
	}
	for index := range items {
		items[index].searchText = imagePromptSearchText(items[index])
	}
	imagePromptGalleryCache = &imagePromptGallery{
		fetch: func(context.Context) ([]ImagePrompt, error) { return items, nil },
	}

	page, err := GetImagePrompts(context.Background(), ImagePromptQuery{Category: "海报设计", Page: 1, PageSize: 1})
	require.NoError(t, err)
	assert.Equal(t, 2, page.Total)
	require.Len(t, page.Items, 1)
	assert.Equal(t, "2", page.Items[0].ID)
	assert.Equal(t, []ImagePromptCategory{
		{Name: "海报设计", Count: 2},
		{Name: "摄影", Count: 1},
	}, page.Categories)

	page, err = GetImagePrompts(context.Background(), ImagePromptQuery{Search: "NEON", Page: 1})
	require.NoError(t, err)
	assert.Equal(t, 1, page.Total)
	require.Len(t, page.Items, 1)
	assert.Equal(t, "1", page.Items[0].ID)

	page, err = GetImagePrompts(context.Background(), ImagePromptQuery{Page: 3, PageSize: 999})
	require.NoError(t, err)
	assert.Equal(t, imagePromptMaxPageSize, page.PageSize)
	assert.Empty(t, page.Items)
}

func TestImagePromptGalleryKeepsStaleSnapshotWhenRefreshFails(t *testing.T) {
	var calls int
	fresh := []ImagePrompt{{ID: "1", Title: "Cached", Category: "摄影", Prompt: "cached prompt"}}
	gallery := &imagePromptGallery{fetch: func(context.Context) ([]ImagePrompt, error) {
		calls++
		if calls > 1 {
			return nil, ErrImagePromptUpstream
		}
		return fresh, nil
	}}

	first, err := gallery.load(context.Background())
	require.NoError(t, err)
	require.Len(t, first.items, 1)

	gallery.snapshot.fetchedAt = time.Now().Add(-imagePromptCacheTTL - time.Minute)
	stale, err := gallery.load(context.Background())
	require.NoError(t, err)
	assert.Same(t, first, stale)
	assert.Equal(t, 2, calls)

	// 刷新失败后的重试窗口内不再回源，避免上游故障时被反复打满。
	_, err = gallery.load(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, calls)
}

func TestImagePromptGalleryFailsFastDuringRetryWindow(t *testing.T) {
	var calls int
	gallery := &imagePromptGallery{fetch: func(context.Context) ([]ImagePrompt, error) {
		calls++
		return nil, ErrImagePromptUpstream
	}}

	_, err := gallery.load(context.Background())
	assert.ErrorIs(t, err, ErrImagePromptUpstream)
	_, err = gallery.load(context.Background())
	assert.ErrorIs(t, err, ErrImagePromptUpstream)

	assert.Equal(t, 1, calls)
}

func TestValidateImagePromptCoverURL(t *testing.T) {
	allowed := []string{
		"https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main/images/1.png",
		"https://github.com/user-attachments/assets/1234-5678",
		"https://cms-assets.youmind.com/media/case.jpg",
		"https://pbs.twimg.com/media/case?format=jpg&name=large",
	}
	for _, rawURL := range allowed {
		_, err := ValidateImagePromptCoverURL(rawURL)
		assert.NoError(t, err, rawURL)
	}

	blocked := []string{
		"http://raw.githubusercontent.com/repo/image.png",
		"https://example.com/image.png",
		"https://github.com/someone/repo/raw/main/image.png",
		"",
	}
	for _, rawURL := range blocked {
		_, err := ValidateImagePromptCoverURL(rawURL)
		assert.Error(t, err, rawURL)
	}
}

func TestImagePromptSearchTextMatchesPromptBody(t *testing.T) {
	item := ImagePrompt{Title: "Market", Category: "电商主图", Prompt: "A Korean market snapshot", Tags: []string{"@author"}}
	item.searchText = imagePromptSearchText(item)

	_, total := filterImagePrompts([]ImagePrompt{item}, normalizeImagePromptQuery(ImagePromptQuery{Search: "korean"}))
	assert.Equal(t, 1, total)

	_, total = filterImagePrompts([]ImagePrompt{item}, normalizeImagePromptQuery(ImagePromptQuery{Search: "@author"}))
	assert.Equal(t, 1, total)

	_, total = filterImagePrompts([]ImagePrompt{item}, normalizeImagePromptQuery(ImagePromptQuery{Search: "missing"}))
	assert.Equal(t, 0, total)
}
