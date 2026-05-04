package repository

import (
	"path/filepath"
	"testing"
)

func TestXMockSearch(t *testing.T) {
	client := NewXMockClient(filepath.Join("..", "..", "testdata", "x", "search.json"), "", "")
	items, err := client.Search(t.Context(), "ai-search", "llm")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	if items[0].Source != "x-search" || items[0].SourceItemKey != "1890011223344556677" {
		t.Fatalf("first item = %#v", items[0])
	}
	if items[0].AuthorID != "42" || items[0].AuthorUsername != "alice" {
		t.Fatalf("author fields not mapped: %#v", items[0])
	}
}

func TestXMockLists(t *testing.T) {
	client := NewXMockClient("", filepath.Join("..", "..", "testdata", "x", "lists.json"), "")
	items, err := client.Lists(t.Context(), "trusted-list", "1234567890")
	if err != nil {
		t.Fatalf("Lists: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].Source != "x-list" {
		t.Fatalf("source = %q, want x-list", items[0].Source)
	}
}

func TestXMockBookmarks(t *testing.T) {
	client := NewXMockClient("", "", filepath.Join("..", "..", "testdata", "x", "bookmarks.json"))
	items, err := client.Bookmarks(t.Context(), "my-bookmarks")
	if err != nil {
		t.Fatalf("Bookmarks: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	if items[0].Source != "x-bookmarks" {
		t.Fatalf("source = %q, want x-bookmarks", items[0].Source)
	}
}

func TestXAPIFixtureContract(t *testing.T) {
	client := NewXMockClient(filepath.Join("..", "..", "testdata", "x", "search.json"), "", "")
	fixture, err := client.loadFixture(t.Context(), filepath.Join("..", "..", "testdata", "x", "search.json"))
	if err != nil {
		t.Fatalf("loadFixture: %v", err)
	}
	if len(fixture.Data) == 0 {
		t.Fatal("fixture must include data")
	}
	if fixture.Meta.ResultCount != len(fixture.Data) {
		t.Fatalf("meta.result_count = %d, want %d", fixture.Meta.ResultCount, len(fixture.Data))
	}
	if len(fixture.Includes.Users) == 0 {
		t.Fatal("fixture must include includes.users")
	}
	if fixture.Data[0].ID == "" || fixture.Data[0].Text == "" || fixture.Data[0].AuthorID == "" {
		t.Fatalf("fixture tweet missing basic X API fields: %#v", fixture.Data[0])
	}
}

func TestXMockDoesNotUseNetwork(t *testing.T) {
	client := NewXMockClient(filepath.Join("..", "..", "testdata", "x", "search.json"), "", "")
	items, err := client.Search(t.Context(), "ai-search", "llm")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("fixture search returned no items")
	}
}
