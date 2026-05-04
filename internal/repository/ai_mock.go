package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/ken5scal/obsflow/internal/model"
)

type MockAIClient struct {
	prefix string
}

func NewMockAIClient(prefix ...string) *MockAIClient {
	value := ""
	if len(prefix) > 0 {
		value = prefix[0]
	}
	if value == "" {
		value = "Mock summary"
	}
	return &MockAIClient{prefix: value}
}

func (c *MockAIClient) Summarize(ctx context.Context, record model.Record) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if record.SourceItemKey == "" {
		return "", fmt.Errorf("record source_item_key is required")
	}
	text := firstNonEmpty(record.Summary, record.RawContent, record.Title)
	text = strings.Join(strings.Fields(text), " ")
	if len(text) > 120 {
		text = text[:120]
	}
	title := firstNonEmpty(record.Title, record.SourceItemKey)
	return fmt.Sprintf("%s for %s: %s", c.prefix, title, text), nil
}

func (c *MockAIClient) BuildDigest(ctx context.Context, cadence string, records []model.Record) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if cadence == "" {
		return "", fmt.Errorf("digest cadence is required")
	}
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(strings.ToLower(cadence))
	b.WriteString(" digest\n\n")
	if len(records) == 0 {
		b.WriteString("- No records.\n")
		return b.String(), nil
	}
	for _, record := range records {
		title := firstNonEmpty(record.Title, record.SourceItemKey)
		b.WriteString("- ")
		if record.URL != "" {
			b.WriteString("[")
			b.WriteString(title)
			b.WriteString("](")
			b.WriteString(record.URL)
			b.WriteString(")")
		} else {
			b.WriteString(title)
		}
		if record.Source != "" {
			b.WriteString(" (")
			b.WriteString(record.Source)
			b.WriteString(")")
		}
		if record.Summary != "" {
			b.WriteString(": ")
			b.WriteString(strings.Join(strings.Fields(record.Summary), " "))
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}
