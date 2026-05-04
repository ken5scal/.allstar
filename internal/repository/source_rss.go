package repository

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"

	"github.com/ken5scal/obsflow/internal/model"
)

type GofeedRSSClient struct {
	httpClient *http.Client
	parser     *gofeed.Parser
}

func NewGofeedRSSClient() *GofeedRSSClient {
	return NewRSSClient(nil)
}

func NewRSSClient(httpClient *http.Client) *GofeedRSSClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &GofeedRSSClient{httpClient: httpClient, parser: gofeed.NewParser()}
}

type RSSFetchRequest struct {
	SourceID string
	URL      string
	Fixture  string
}

func (c *GofeedRSSClient) FetchRequest(ctx context.Context, req RSSFetchRequest) ([]model.SourceItem, error) {
	if req.Fixture != "" {
		file, err := os.Open(req.Fixture)
		if err != nil {
			return nil, fmt.Errorf("open rss fixture: %w", err)
		}
		defer file.Close()
		return c.Parse(ctx, req.SourceID, file)
	}
	return c.Fetch(ctx, req.SourceID, req.URL)
}

func (c *GofeedRSSClient) Fetch(ctx context.Context, sourceID string, feedURL string) ([]model.SourceItem, error) {
	if sourceID == "" || feedURL == "" {
		return nil, fmt.Errorf("rss source_id and url are required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create rss request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch rss: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch rss: status %d", resp.StatusCode)
	}
	return c.Parse(ctx, sourceID, resp.Body)
}

func (c *GofeedRSSClient) Parse(ctx context.Context, sourceID string, r io.Reader) ([]model.SourceItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if sourceID == "" {
		return nil, fmt.Errorf("rss source_id is required")
	}
	feed, err := c.parser.Parse(r)
	if err != nil {
		return nil, fmt.Errorf("parse rss: %w", err)
	}
	items := make([]model.SourceItem, 0, len(feed.Items))
	for _, item := range feed.Items {
		sourceItem := rssItemToSourceItem(sourceID, item)
		if sourceItem.SourceItemKey != "" {
			items = append(items, sourceItem)
		}
	}
	return items, nil
}

func rssItemToSourceItem(sourceID string, item *gofeed.Item) model.SourceItem {
	publishedAt := time.Time{}
	if item.PublishedParsed != nil {
		publishedAt = item.PublishedParsed.UTC()
	} else if item.UpdatedParsed != nil {
		publishedAt = item.UpdatedParsed.UTC()
	}
	body := firstNonEmpty(item.Content, item.Description)
	key := firstNonEmpty(item.GUID, item.Link, strings.TrimSpace(item.Title+" "+publishedAt.Format(time.RFC3339)))
	return model.SourceItem{
		Source:        "rss",
		SourceID:      sourceID,
		SourceItemKey: key,
		ContentHash:   normalizedHash(item.Title, body, item.Link),
		Title:         item.Title,
		Text:          body,
		URL:           item.Link,
		AuthorID:      authorName(item),
		AuthorName:    authorName(item),
		PublishedAt:   publishedAt,
		Raw: map[string]any{
			"guid":        item.GUID,
			"link":        item.Link,
			"title":       item.Title,
			"description": item.Description,
			"content":     item.Content,
		},
	}
}

func authorName(item *gofeed.Item) string {
	if item.Author == nil {
		return ""
	}
	return item.Author.Name
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func normalizedHash(values ...string) string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		normalized = append(normalized, strings.Join(strings.Fields(value), " "))
	}
	sum := sha256.Sum256([]byte(strings.Join(normalized, "\x00")))
	return fmt.Sprintf("sha256:%x", sum[:])
}
