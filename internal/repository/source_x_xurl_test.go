package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestXURLAdapterBuildsCommand(t *testing.T) {
	runner := fakeXURLCommand(t, filepath.Join("..", "..", "testdata", "x", "search.json"))
	client := NewXURLClient("xurl", runner)

	_, err := client.Search(t.Context(), "ai-search", "llm")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	want := []string{"xurl", "GET", "/2/tweets/search/recent", "-d", "query=llm"}
	if got := runner.last; len(got) != len(want) {
		t.Fatalf("command = %#v, want %#v", got, want)
	} else {
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("command = %#v, want %#v", got, want)
			}
		}
	}
}

func TestXURLAdapterParsesFixtureOutput(t *testing.T) {
	client := NewXURLClient("xurl", fakeXURLCommand(t, filepath.Join("..", "..", "testdata", "x", "search.json")))

	items, err := client.Search(t.Context(), "ai-search", "llm")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(items) != 2 || items[0].Source != "x-search" {
		t.Fatalf("items = %#v", items)
	}
}

func TestXURLAdapterContextCancel(t *testing.T) {
	client := NewXURLClient("xurl", XURLCommand(func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return nil, ctx.Err()
	}))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	_, err := client.Search(ctx, "ai-search", "llm")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
}

func TestXURLAdapterUsesFakeCommandInTests(t *testing.T) {
	used := false
	client := NewXURLClient("xurl", XURLCommand(func(ctx context.Context, name string, args ...string) ([]byte, error) {
		used = true
		return os.ReadFile(filepath.Join("..", "..", "testdata", "x", "bookmarks.json"))
	}))

	items, err := client.Bookmarks(t.Context(), "my-bookmarks")
	if err != nil {
		t.Fatalf("Bookmarks: %v", err)
	}
	if !used || len(items) != 1 {
		t.Fatalf("fake command used=%v items=%#v", used, items)
	}
}

type recordingXURLCommand struct {
	t       *testing.T
	fixture string
	last    []string
}

func fakeXURLCommand(t *testing.T, fixture string) *recordingXURLCommand {
	t.Helper()
	return &recordingXURLCommand{t: t, fixture: fixture}
}

func (r *recordingXURLCommand) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	r.t.Helper()
	r.last = append([]string{name}, args...)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return os.ReadFile(r.fixture)
}
