package service

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

type DigestService struct {
	ai repository.AIClient
}

func NewDigestService(ai repository.AIClient) *DigestService {
	return &DigestService{ai: ai}
}

func (s *DigestService) Build(ctx context.Context, cadence string, records []model.Record) (string, error) {
	if cadence == "" {
		return "", fmt.Errorf("digest cadence is required")
	}
	if s.ai == nil {
		return buildDeterministicDigest(cadence, records), nil
	}
	return s.ai.BuildDigest(ctx, cadence, records)
}

func buildDeterministicDigest(cadence string, records []model.Record) string {
	copied := append([]model.Record(nil), records...)
	sort.SliceStable(copied, func(i, j int) bool {
		if copied[i].UpdatedAt.Equal(copied[j].UpdatedAt) {
			return copied[i].SourceItemKey < copied[j].SourceItemKey
		}
		return copied[i].UpdatedAt.Before(copied[j].UpdatedAt)
	})

	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(cadence)
	b.WriteString(" digest\n\n")
	for _, record := range copied {
		title := record.Title
		if title == "" {
			title = record.SourceItemKey
		}
		b.WriteString("- ")
		b.WriteString(title)
		if record.Summary != "" {
			b.WriteString(": ")
			b.WriteString(record.Summary)
		}
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}
