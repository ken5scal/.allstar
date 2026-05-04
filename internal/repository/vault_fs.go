package repository

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/ken5scal/obsflow/internal/model"
)

const (
	rawContentHeading = "## Raw Content"
	aiSummaryHeading  = "## AI Summary"
)

type FSVaultRepository struct {
	root string
	now  func() time.Time
}

func NewFSVaultRepository(root string) (*FSVaultRepository, error) {
	if root == "" {
		return nil, fmt.Errorf("vault root is required")
	}
	return &FSVaultRepository{root: root, now: func() time.Time { return time.Now().UTC() }}, nil
}

func (r *FSVaultRepository) UpsertRecord(ctx context.Context, record model.Record) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if record.Source == "" || record.SourceItemKey == "" {
		return "", fmt.Errorf("record source and source_item_key are required")
	}
	if record.RecordID == "" {
		record.RecordID = stableRecordID(record.Source, record.SourceItemKey)
	}
	if record.SchemaVersion == 0 {
		record.SchemaVersion = 1
	}
	if record.Status == "" {
		record.Status = "captured"
	}
	now := r.now()
	if record.CreatedAt.IsZero() {
		record.CreatedAt = now
	}
	if record.UpdatedAt.IsZero() {
		record.UpdatedAt = now
	}
	if record.ContentHash == "" {
		record.ContentHash = contentHash(record.Title, record.RawContent, record.URL)
	}

	path := r.recordPath(record)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create vault directory: %w", err)
	}

	body, err := renderRecordMarkdown(record)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		return "", fmt.Errorf("write vault record: %w", err)
	}
	return path, nil
}

func (r *FSVaultRepository) ReadRecord(ctx context.Context, path string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read vault record: %w", err)
	}
	return data, nil
}

func (r *FSVaultRepository) UpdateAISummary(ctx context.Context, path string, summary string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read vault record: %w", err)
	}
	updated := ReplaceAISummarySection(string(data), summary)
	if err := os.WriteFile(path, []byte(updated), 0o600); err != nil {
		return fmt.Errorf("write ai summary: %w", err)
	}
	return nil
}

func (r *FSVaultRepository) recordPath(record model.Record) string {
	dir := sanitizePathSegment(record.Source)
	name := sanitizePathSegment(record.SourceItemKey)
	if record.Title != "" {
		name = sanitizePathSegment(record.Title + "-" + record.SourceItemKey)
	}
	return filepath.Join(r.root, dir, name+".md")
}

func renderRecordMarkdown(record model.Record) ([]byte, error) {
	frontmatter := map[string]any{
		"record_id":       record.RecordID,
		"schema_version":  record.SchemaVersion,
		"source":          record.Source,
		"source_item_key": record.SourceItemKey,
		"content_hash":    record.ContentHash,
		"status":          record.Status,
		"ai_drafted":      record.AIDrafted,
		"category":        record.Category,
		"tags":            record.Tags,
		"intent":          record.Intent,
		"attachments":     record.Attachments,
		"summary":         record.Summary,
		"tick_run_id":     record.TickRunID,
		"job_run_id":      record.JobRunID,
		"created_at":      record.CreatedAt.Format(time.RFC3339),
		"updated_at":      record.UpdatedAt.Format(time.RFC3339),
	}
	if record.Title != "" {
		frontmatter["title"] = record.Title
	}
	if record.URL != "" {
		frontmatter["url"] = record.URL
	}

	var buf bytes.Buffer
	buf.WriteString("---\n")
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(frontmatter); err != nil {
		return nil, fmt.Errorf("encode frontmatter: %w", err)
	}
	if err := enc.Close(); err != nil {
		return nil, fmt.Errorf("close yaml encoder: %w", err)
	}
	buf.WriteString("---\n\n")
	if record.Title != "" {
		buf.WriteString("# ")
		buf.WriteString(record.Title)
		buf.WriteString("\n\n")
	}
	buf.WriteString(rawContentHeading)
	buf.WriteString("\n\n")
	buf.WriteString(strings.TrimSpace(record.RawContent))
	buf.WriteString("\n\n")
	buf.WriteString(aiSummaryHeading)
	buf.WriteString("\n\n")
	buf.WriteString(strings.TrimSpace(record.Summary))
	buf.WriteString("\n")
	return buf.Bytes(), nil
}

func ReplaceAISummarySection(markdown string, summary string) string {
	summary = strings.TrimSpace(summary)
	start := strings.Index(markdown, aiSummaryHeading)
	if start == -1 {
		base := strings.TrimRight(markdown, "\n")
		if base != "" {
			base += "\n\n"
		}
		return base + aiSummaryHeading + "\n\n" + summary + "\n"
	}

	contentStart := start + len(aiSummaryHeading)
	if contentStart < len(markdown) && markdown[contentStart] == '\r' {
		contentStart++
	}
	if contentStart < len(markdown) && markdown[contentStart] == '\n' {
		contentStart++
	}
	if contentStart < len(markdown) && markdown[contentStart] == '\r' {
		contentStart++
	}
	if contentStart < len(markdown) && markdown[contentStart] == '\n' {
		contentStart++
	}

	next := findNextH2(markdown, contentStart)
	replacement := aiSummaryHeading + "\n\n" + summary + "\n"
	if next == -1 {
		return strings.TrimRight(markdown[:start], "\n") + "\n\n" + replacement
	}
	return strings.TrimRight(markdown[:start], "\n") + "\n\n" + replacement + "\n" + strings.TrimLeft(markdown[next:], "\n")
}

func findNextH2(markdown string, from int) int {
	idx := strings.Index(markdown[from:], "\n## ")
	if idx == -1 {
		return -1
	}
	return from + idx + 1
}

var unsafePathChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func sanitizePathSegment(value string) string {
	value = strings.TrimSpace(value)
	value = unsafePathChars.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-._")
	if value == "" {
		return "record"
	}
	if len(value) > 120 {
		value = value[:120]
		value = strings.Trim(value, "-._")
	}
	return value
}

func stableRecordID(source string, itemKey string) string {
	sum := sha256.Sum256([]byte(source + "\x00" + itemKey))
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

func contentHash(parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		_, _ = h.Write([]byte(strings.TrimSpace(part)))
		_, _ = h.Write([]byte{0})
	}
	return fmt.Sprintf("sha256:%x", h.Sum(nil))
}
