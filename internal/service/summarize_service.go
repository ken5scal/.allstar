package service

import (
	"context"
	"fmt"

	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

type SummarizeService struct {
	ai    repository.AIClient
	vault repository.VaultRepository
}

func NewSummarizeService(ai repository.AIClient, vault ...repository.VaultRepository) *SummarizeService {
	var v repository.VaultRepository
	if len(vault) > 0 {
		v = vault[0]
	}
	return &SummarizeService{ai: ai, vault: v}
}

func (s *SummarizeService) Summarize(ctx context.Context, record model.Record) (string, error) {
	if s == nil || s.ai == nil {
		return "", fmt.Errorf("summarize service ai dependency is required")
	}
	return s.ai.Summarize(ctx, record)
}

func (s *SummarizeService) SummarizeRecord(ctx context.Context, notePath string, record model.Record) (string, error) {
	if s == nil || s.ai == nil || s.vault == nil {
		return "", fmt.Errorf("summarize service dependencies are required")
	}
	summary, err := s.ai.Summarize(ctx, record)
	if err != nil {
		return "", err
	}
	if err := s.vault.UpdateAISummary(ctx, notePath, summary); err != nil {
		return "", err
	}
	return summary, nil
}
