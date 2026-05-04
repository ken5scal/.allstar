package repository

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRSSParseFixture(t *testing.T) {
	file, err := os.Open(filepath.Join("..", "..", "testdata", "rss", "hn.xml"))
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer file.Close()

	client := NewRSSClient(nil)
	items, err := client.Parse(t.Context(), "hn", file)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}
	if items[0].SourceItemKey != "fixture-guid-1" {
		t.Fatalf("source item key = %q", items[0].SourceItemKey)
	}
	if !strings.HasPrefix(items[0].ContentHash, "sha256:") {
		t.Fatalf("content hash = %q", items[0].ContentHash)
	}
}

func TestRSSFixtureContract(t *testing.T) {
	file, err := os.Open(filepath.Join("..", "..", "testdata", "rss", "hn.xml"))
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer file.Close()

	items, err := NewRSSClient(nil).Parse(t.Context(), "hn", file)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	got := items[0]
	if got.Source != "rss" || got.SourceID != "hn" || got.URL == "" || got.Title == "" || got.PublishedAt.IsZero() {
		t.Fatalf("RSS contract item incomplete: %#v", got)
	}
}

func TestRSSFixtureDoesNotUseNetwork(t *testing.T) {
	file, err := os.Open(filepath.Join("..", "..", "testdata", "rss", "hn.xml"))
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer file.Close()

	client := NewRSSClient(nil)
	items, err := client.Parse(t.Context(), "hn", file)
	if err != nil {
		t.Fatalf("Fetch fixture: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected fixture items")
	}
}
