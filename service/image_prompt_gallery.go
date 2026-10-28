package service

import (
	"cmp"
	"context"
	"errors"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	imagePromptCacheTTL          = 6 * time.Hour
	imagePromptRetryDelay        = 5 * time.Minute
	imagePromptFetchTimeout      = 40 * time.Second
	imagePromptDefaultPageSize   = 24
	imagePromptMaxPageSize       = 48
	imagePromptMaxSearchRunes    = 80
	imagePromptMinItems          = 50
	imagePromptSearchPromptRunes = 2000
)

// ErrImagePromptUpstream 表示所有远程提示词素材源都不可用。
var ErrImagePromptUpstream = errors.New("image prompt sources are unavailable")

// ImagePrompt 是提示词广场里的一条提示词。素材来自公开的提示词精选仓库。
type ImagePrompt struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	Prompt     string   `json:"prompt"`
	CoverURL   string   `json:"cover_url"`
	Category   string   `json:"category"`
	Tags       []string `json:"tags,omitempty"`
	SourceName string   `json:"source_name"`
	SourceURL  string   `json:"source_url"`

	searchText string
}

// ImagePromptCategory 是提示词分类及其条目数。
type ImagePromptCategory struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// ImagePromptQuery 是提示词广场的筛选条件。
type ImagePromptQuery struct {
	Category string
	Search   string
	Page     int
	PageSize int
}

// ImagePromptPage 是分页后的提示词列表。
type ImagePromptPage struct {
	Items      []ImagePrompt         `json:"items"`
	Total      int                   `json:"total"`
	Page       int                   `json:"page"`
	PageSize   int                   `json:"page_size"`
	Categories []ImagePromptCategory `json:"categories"`
}

type imagePromptSnapshot struct {
	items      []ImagePrompt
	categories []ImagePromptCategory
	fetchedAt  time.Time
}

type imagePromptGallery struct {
	mu       sync.Mutex
	snapshot *imagePromptSnapshot
	retryAt  time.Time
	fetch    func(context.Context) ([]ImagePrompt, error)
}

var imagePromptGalleryCache = &imagePromptGallery{fetch: fetchImagePrompts}

// GetImagePrompts 返回筛选后的提示词广场数据。
func GetImagePrompts(ctx context.Context, query ImagePromptQuery) (ImagePromptPage, error) {
	normalized := normalizeImagePromptQuery(query)
	snapshot, err := imagePromptGalleryCache.load(ctx)
	if err != nil {
		return ImagePromptPage{}, err
	}

	items, total := filterImagePrompts(snapshot.items, normalized)
	return ImagePromptPage{
		Items:      items,
		Total:      total,
		Page:       normalized.Page,
		PageSize:   normalized.PageSize,
		Categories: snapshot.categories,
	}, nil
}

// load 返回缓存的提示词快照，过期时同步刷新；刷新失败时继续使用旧快照。
func (gallery *imagePromptGallery) load(ctx context.Context) (*imagePromptSnapshot, error) {
	gallery.mu.Lock()
	defer gallery.mu.Unlock()

	now := time.Now()
	if gallery.snapshot != nil && now.Sub(gallery.snapshot.fetchedAt) < imagePromptCacheTTL {
		return gallery.snapshot, nil
	}
	if now.Before(gallery.retryAt) {
		if gallery.snapshot != nil {
			return gallery.snapshot, nil
		}
		return nil, ErrImagePromptUpstream
	}

	// 缓存填充不应跟随某个访客请求一起取消，否则首个请求断开会让所有并发请求失败。
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), imagePromptFetchTimeout)
	defer cancel()
	items, err := gallery.fetch(fetchCtx)
	if err != nil {
		gallery.retryAt = now.Add(imagePromptRetryDelay)
		if gallery.snapshot != nil {
			return gallery.snapshot, nil
		}
		return nil, err
	}

	gallery.snapshot = &imagePromptSnapshot{
		items:      items,
		categories: buildImagePromptCategories(items),
		fetchedAt:  now,
	}
	gallery.retryAt = time.Time{}
	return gallery.snapshot, nil
}

func normalizeImagePromptQuery(query ImagePromptQuery) ImagePromptQuery {
	query.Category = strings.TrimSpace(query.Category)
	search := []rune(strings.ToLower(strings.TrimSpace(query.Search)))
	if len(search) > imagePromptMaxSearchRunes {
		search = search[:imagePromptMaxSearchRunes]
	}
	query.Search = string(search)
	if query.Page < 1 {
		query.Page = 1
	}
	if query.PageSize <= 0 {
		query.PageSize = imagePromptDefaultPageSize
	}
	query.PageSize = min(query.PageSize, imagePromptMaxPageSize)
	return query
}

func filterImagePrompts(items []ImagePrompt, query ImagePromptQuery) ([]ImagePrompt, int) {
	matches := make([]ImagePrompt, 0, len(items))
	for _, item := range items {
		if query.Category != "" && item.Category != query.Category {
			continue
		}
		if query.Search != "" && !strings.Contains(item.searchText, query.Search) {
			continue
		}
		matches = append(matches, item)
	}

	start := min((query.Page-1)*query.PageSize, len(matches))
	end := min(start+query.PageSize, len(matches))
	return matches[start:end], len(matches)
}

func buildImagePromptCategories(items []ImagePrompt) []ImagePromptCategory {
	counts := make(map[string]int, len(items))
	for _, item := range items {
		counts[item.Category]++
	}

	categories := make([]ImagePromptCategory, 0, len(counts))
	for name, count := range counts {
		categories = append(categories, ImagePromptCategory{Name: name, Count: count})
	}
	slices.SortFunc(categories, func(a, b ImagePromptCategory) int {
		if a.Count != b.Count {
			return cmp.Compare(b.Count, a.Count)
		}
		return strings.Compare(a.Name, b.Name)
	})
	return categories
}

// 封面只接受提示词素材源自带的图床，避免这个代理被用来拉取任意地址。
var imagePromptCoverHosts = []string{
	"cms-assets.youmind.com",
	"github.com",
	"pbs.twimg.com",
	"raw.githubusercontent.com",
}

func parseImagePromptCoverURL(rawURL string) (*url.URL, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" {
		return nil, false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "github.com" {
		return parsed, strings.HasPrefix(parsed.Path, "/user-attachments/assets/")
	}
	return parsed, slices.Contains(imagePromptCoverHosts, host)
}

// ValidateImagePromptCoverURL 只放行提示词素材图床的图片地址。
func ValidateImagePromptCoverURL(rawURL string) (*url.URL, error) {
	parsed, ok := parseImagePromptCoverURL(rawURL)
	if !ok {
		return nil, errors.New("unsupported image prompt cover url")
	}
	if err := ValidateSSRFProtectedFetchURL(parsed.String()); err != nil {
		return nil, err
	}
	return parsed, nil
}
