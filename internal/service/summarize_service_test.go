package service

import (
	"strings"
	"testing"

	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

func TestSummarizeWithAIMock(t *testing.T) {
	ai := repository.NewMockAIClient()
	svc := NewSummarizeService(ai)
	record := model.Record{Source: "rss", SourceItemKey: "item-1", Title: "Title", RawContent: "This is the raw content for summarization."}

	summary, err := svc.Summarize(t.Context(), record)
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if !strings.Contains(summary, "Mock summary for Title") {
		t.Fatalf("summary = %q", summary)
	}
}

func TestSummarizeReplayUpdatesOnlyAISummary(t *testing.T) {
	ai := repository.NewMockAIClient()
	svc := NewSummarizeService(ai)
	record := model.Record{Source: "rss", SourceItemKey: "replay-1", Title: "Replay", RawContent: "Stable body"}

	first, err := svc.Summarize(t.Context(), record)
	if err != nil {
		t.Fatalf("Summarize first: %v", err)
	}
	second, err := svc.Summarize(t.Context(), record)
	if err != nil {
		t.Fatalf("Summarize second: %v", err)
	}
	if first != second {
		t.Fatalf("summary replay changed: %q vs %q", first, second)
	}
}
