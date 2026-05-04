package repository

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ken5scal/obsflow/internal/model"
)

func TestVaultWriteRecord(t *testing.T) {
	vault, err := NewFSVaultRepository(t.TempDir())
	if err != nil {
		t.Fatalf("NewFSVaultRepository: %v", err)
	}
	record := testRecord()

	path, err := vault.UpsertRecord(t.Context(), record)
	if err != nil {
		t.Fatalf("UpsertRecord: %v", err)
	}
	body := readFile(t, path)

	for _, want := range []string{
		`record_id: record-1`,
		`schema_version: 1`,
		`source: rss`,
		`source_item_key: guid-1`,
		`content_hash: sha256:abc`,
		`status: captured`,
		`ai_drafted: false`,
		`tick_run_id: tick-1`,
		`job_run_id: job-1`,
		"## Raw Content\n\nRaw body",
		"## AI Summary\n\n",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("note missing %q:\n%s", want, body)
		}
	}
	if filepath.Base(path) != "Fixture-Record-guid-1.md" {
		t.Fatalf("path = %q, want Fixture-Record-guid-1.md", path)
	}
}

func TestVaultFrontmatterMatchesObsidianSchemaFixture(t *testing.T) {
	vault, err := NewFSVaultRepository(t.TempDir())
	if err != nil {
		t.Fatalf("NewFSVaultRepository: %v", err)
	}
	record := testRecord()
	record.Tags = []string{"digital_identity", "privacy"}
	record.Intent = []string{"wantRead"}
	record.Summary = "short summary"

	path, err := vault.UpsertRecord(t.Context(), record)
	if err != nil {
		t.Fatalf("UpsertRecord: %v", err)
	}
	body := readFile(t, path)

	for _, key := range []string{
		"record_id:",
		"schema_version:",
		"source:",
		"source_item_key:",
		"content_hash:",
		"status:",
		"ai_drafted:",
		"category:",
		"tags:",
		"intent:",
		"created_at:",
		"updated_at:",
		"summary:",
		"tick_run_id:",
		"job_run_id:",
	} {
		if !strings.Contains(body, key) {
			t.Fatalf("frontmatter missing %s:\n%s", key, body)
		}
	}
}

func TestReplaceAISummarySection(t *testing.T) {
	input := `---
record_id: "record-1"
---

# Title

## Raw Content

Keep me

## AI Summary

Old summary

## Notes

Keep notes
`

	got := ReplaceAISummarySection(input, "New summary")
	if strings.Contains(got, "Old summary") {
		t.Fatalf("old summary remained:\n%s", got)
	}
	if !strings.Contains(got, "## AI Summary\n\nNew summary\n\n## Notes") {
		t.Fatalf("new summary not placed before next section:\n%s", got)
	}
	if !strings.Contains(got, "## Raw Content\n\nKeep me") || !strings.Contains(got, "## Notes\n\nKeep notes") {
		t.Fatalf("non-summary sections changed:\n%s", got)
	}
}

func TestAISummaryReplacementDoesNotChangeRawContent(t *testing.T) {
	vault, err := NewFSVaultRepository(t.TempDir())
	if err != nil {
		t.Fatalf("NewFSVaultRepository: %v", err)
	}
	record := testRecord()
	path, err := vault.UpsertRecord(t.Context(), record)
	if err != nil {
		t.Fatalf("UpsertRecord: %v", err)
	}

	if err := vault.UpdateAISummary(t.Context(), path, "Summary v1"); err != nil {
		t.Fatalf("UpdateAISummary v1: %v", err)
	}
	if err := vault.UpdateAISummary(t.Context(), path, "Summary v2"); err != nil {
		t.Fatalf("UpdateAISummary v2: %v", err)
	}

	body := readFile(t, path)
	if strings.Count(body, "## AI Summary") != 1 {
		t.Fatalf("expected one AI Summary section:\n%s", body)
	}
	if strings.Contains(body, "Summary v1") {
		t.Fatalf("old summary remained:\n%s", body)
	}
	if !strings.Contains(body, "Summary v2") {
		t.Fatalf("new summary missing:\n%s", body)
	}
	if !strings.Contains(body, "## Raw Content\n\nRaw body") {
		t.Fatalf("raw content changed:\n%s", body)
	}
}

func TestVaultUpsertRecordIdempotent(t *testing.T) {
	vault, err := NewFSVaultRepository(t.TempDir())
	if err != nil {
		t.Fatalf("NewFSVaultRepository: %v", err)
	}
	record := testRecord()
	path1, err := vault.UpsertRecord(t.Context(), record)
	if err != nil {
		t.Fatalf("UpsertRecord first: %v", err)
	}
	path2, err := vault.UpsertRecord(t.Context(), record)
	if err != nil {
		t.Fatalf("UpsertRecord second: %v", err)
	}
	if path1 != path2 {
		t.Fatalf("paths differ: %q vs %q", path1, path2)
	}
	if strings.Count(readFile(t, path1), "## Raw Content") != 1 {
		t.Fatalf("duplicate raw content section:\n%s", readFile(t, path1))
	}
}

func testRecord() model.Record {
	now := time.Date(2026, 5, 4, 4, 0, 0, 0, time.UTC)
	return model.Record{
		RecordID:      "record-1",
		SchemaVersion: 1,
		Source:        "rss",
		SourceItemKey: "guid-1",
		ContentHash:   "sha256:abc",
		Status:        "captured",
		AIDrafted:     false,
		Category:      "papers",
		CreatedAt:     now,
		UpdatedAt:     now,
		Summary:       "",
		TickRunID:     "tick-1",
		JobRunID:      "job-1",
		Title:         "Fixture Record",
		RawContent:    "Raw body",
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file %s: %v", path, err)
	}
	return string(body)
}
