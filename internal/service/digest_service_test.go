package service

import (
	"strings"
	"testing"

	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

func TestBuildDigestWithAIMock(t *testing.T) {
	svc := NewDigestService(repository.NewMockAIClient())
	digest, err := svc.Build(t.Context(), "daily", []model.Record{
		{Title: "First", Source: "rss", URL: "https://example.test/1"},
		{Title: "Second", Source: "x-search", URL: "https://x.com/a/status/1"},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if !strings.Contains(digest, "# daily digest") || !strings.Contains(digest, "- [First](https://example.test/1) (rss)") {
		t.Fatalf("digest missing expected content:\n%s", digest)
	}
}

func TestDigestFixtureDaily(t *testing.T) {
	assertDigestCadence(t, "daily")
}

func TestDigestFixtureWeekly(t *testing.T) {
	assertDigestCadence(t, "weekly")
}

func TestDigestFixtureMonthly(t *testing.T) {
	assertDigestCadence(t, "monthly")
}

func TestDigestReplayStableOutput(t *testing.T) {
	svc := NewDigestService(repository.NewMockAIClient())
	records := []model.Record{{Title: "Stable", Source: "rss", URL: "https://example.test/stable"}}
	first, err := svc.Build(t.Context(), "weekly", records)
	if err != nil {
		t.Fatalf("Build first: %v", err)
	}
	second, err := svc.Build(t.Context(), "weekly", records)
	if err != nil {
		t.Fatalf("Build second: %v", err)
	}
	if first != second {
		t.Fatalf("digest replay differed:\nfirst=%s\nsecond=%s", first, second)
	}
}

func assertDigestCadence(t *testing.T, cadence string) {
	t.Helper()
	svc := NewDigestService(repository.NewMockAIClient())
	digest, err := svc.Build(t.Context(), cadence, []model.Record{{Title: "Fixture", Source: "rss"}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if !strings.Contains(digest, "# "+cadence+" digest") {
		t.Fatalf("digest cadence missing:\n%s", digest)
	}
}
