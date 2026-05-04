package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/ken5scal/obsflow/internal/model"
)

type XMockClient struct {
	searchPath    string
	listsPath     string
	bookmarksPath string
}

func NewXMockClient(searchPath, listsPath, bookmarksPath string) *XMockClient {
	return &XMockClient{searchPath: searchPath, listsPath: listsPath, bookmarksPath: bookmarksPath}
}

func (c *XMockClient) Search(ctx context.Context, sourceID string, query string) ([]model.SourceItem, error) {
	return c.load(ctx, sourceID, "x-search", c.searchPath)
}

func (c *XMockClient) Lists(ctx context.Context, sourceID string, listID string) ([]model.SourceItem, error) {
	return c.load(ctx, sourceID, "x-list", c.listsPath)
}

func (c *XMockClient) Bookmarks(ctx context.Context, sourceID string) ([]model.SourceItem, error) {
	return c.load(ctx, sourceID, "x-bookmarks", c.bookmarksPath)
}

func (c *XMockClient) load(ctx context.Context, sourceID, source string, path string) ([]model.SourceItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	fixture, err := c.loadFixture(ctx, path)
	if err != nil {
		return nil, err
	}
	return xFixtureToSourceItems(sourceID, source, fixture)
}

func (c *XMockClient) loadFixture(ctx context.Context, path string) (xFixture, error) {
	if err := ctx.Err(); err != nil {
		return xFixture{}, err
	}
	if path == "" {
		return xFixture{}, fmt.Errorf("x mock fixture path is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return xFixture{}, fmt.Errorf("read x mock fixture: %w", err)
	}
	var fixture xFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		return xFixture{}, fmt.Errorf("parse x fixture: %w", err)
	}
	return fixture, nil
}

type xFixture struct {
	Data     []xTweet         `json:"data"`
	Includes xIncludes        `json:"includes"`
	Meta     xMeta            `json:"meta"`
	Errors   []map[string]any `json:"errors,omitempty"`
}

type xTweet struct {
	ID        string   `json:"id"`
	Text      string   `json:"text"`
	AuthorID  string   `json:"author_id"`
	CreatedAt string   `json:"created_at"`
	Lang      string   `json:"lang"`
	EditIDs   []string `json:"edit_history_tweet_ids"`
}

type xIncludes struct {
	Users []xUser `json:"users"`
}

type xUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
}

type xMeta struct {
	NewestID    string `json:"newest_id"`
	OldestID    string `json:"oldest_id"`
	ResultCount int    `json:"result_count"`
	NextToken   string `json:"next_token"`
}

func parseXFixture(sourceID, source string, data []byte) ([]model.SourceItem, error) {
	var fixture xFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		return nil, fmt.Errorf("parse x fixture: %w", err)
	}
	return xFixtureToSourceItems(sourceID, source, fixture)
}

func xFixtureToSourceItems(sourceID, source string, fixture xFixture) ([]model.SourceItem, error) {
	authors := map[string]xUser{}
	for _, user := range fixture.Includes.Users {
		authors[user.ID] = user
	}
	items := make([]model.SourceItem, 0, len(fixture.Data))
	for _, tweet := range fixture.Data {
		if tweet.ID == "" || tweet.Text == "" {
			return nil, fmt.Errorf("x fixture tweet id and text are required")
		}
		createdAt := time.Time{}
		if tweet.CreatedAt != "" {
			parsed, err := time.Parse(time.RFC3339, tweet.CreatedAt)
			if err != nil {
				return nil, fmt.Errorf("parse x created_at: %w", err)
			}
			createdAt = parsed
		}
		author := authors[tweet.AuthorID]
		title := tweet.ID
		if author.Username != "" {
			title = "@" + author.Username + "-" + tweet.ID
		}
		items = append(items, model.SourceItem{
			Source:         source,
			SourceID:       sourceID,
			SourceItemKey:  tweet.ID,
			Title:          title,
			AuthorID:       tweet.AuthorID,
			AuthorName:     author.Username,
			AuthorUsername: author.Username,
			Text:           tweet.Text,
			URL:            fmt.Sprintf("https://x.com/%s/status/%s", author.Username, tweet.ID),
			PublishedAt:    createdAt,
			Raw: map[string]any{
				"id":         tweet.ID,
				"author_id":  tweet.AuthorID,
				"created_at": tweet.CreatedAt,
				"lang":       tweet.Lang,
			},
		})
	}
	return items, nil
}
