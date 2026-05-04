package service

import (
	"context"
	"fmt"
	"os"
	"time"
	"uuid"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

type OfflinePipeline struct {
	State repository.StateRepository
	Vault repository.VaultRepository
	RSS   repository.RSSClient
	X     repository.XClient
	AI    repository.AIClient
	Alert repository.AlertClient

	Now        time.Time
	RSSPath    string
	BeforeItem func(itemKey string) error
}

type OfflinePipelineResult struct {
	Tick     TickResult
	Created  int
	Failures []TickFailure
	ExitCode apperror.Code
}

func (p *OfflinePipeline) Run(ctx context.Context) OfflinePipelineResult {
	now := p.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	result := OfflinePipelineResult{}
	tick := NewTickService(p.State, fixedClock{now: now}, func(ctx context.Context, job model.TickTarget) error {
		items, err := p.loadItems(ctx)
		if err != nil {
			return apperror.New(apperror.CodeExternalDependency, err)
		}
		paths, failures := p.collectItemsFailSoft(ctx, job.ID, items)
		result.Created += len(paths)
		result.Failures = append(result.Failures, failures...)
		if len(failures) > 0 {
			return apperror.New(failures[0].Code, failures[0].Err)
		}
		return nil
	}).WithAlert(p.Alert)
	result.Tick = tick.Run(ctx, []model.TickTarget{{ID: "offline-collect", Schedule: "0 * * * *", Enabled: true}})
	result.Failures = append(result.Failures, result.Tick.Failures...)
	result.ExitCode = result.Tick.ExitCode
	return result
}

func (p OfflinePipeline) CollectAndSummarize(ctx context.Context, sourceID string, items []model.SourceItem) ([]string, error) {
	if p.State == nil || p.Vault == nil || p.AI == nil {
		return nil, fmt.Errorf("offline pipeline dependencies are required")
	}
	now := func() time.Time { return time.Now().UTC() }
	if !p.Now.IsZero() {
		now = func() time.Time { return p.Now }
	}
	tickRunID := uuid.New().String()
	jobRunID := uuid.New().String()
	paths := []string{}
	for _, item := range items {
		if item.SourceID == "" {
			item.SourceID = sourceID
		}
		seen, err := p.State.SeenSourceItem(ctx, item.SourceID, item.SourceItemKey)
		if err != nil {
			return nil, err
		}
		if seen {
			continue
		}
		record := sourceItemToRecord(item, tickRunID, jobRunID)
		if record.CreatedAt.IsZero() {
			record.CreatedAt = now()
		}
		if record.UpdatedAt.IsZero() {
			record.UpdatedAt = now()
		}
		path, err := p.Vault.UpsertRecord(ctx, record)
		if err != nil {
			return nil, err
		}
		summary, err := p.AI.Summarize(ctx, record)
		if err != nil {
			return nil, err
		}
		if err := p.Vault.UpdateAISummary(ctx, path, summary); err != nil {
			return nil, err
		}
		if err := p.State.InTx(ctx, func(tx repository.StateTx) error {
			if err := tx.MarkSourceItemSeen(ctx, item.SourceID, item.SourceItemKey, item.ContentHash); err != nil {
				return err
			}
			return tx.PutCheckpoint(ctx, model.Checkpoint{SourceID: item.SourceID, Cursor: item.SourceItemKey, UpdatedAt: now()})
		}); err != nil {
			return nil, err
		}
		paths = append(paths, path)
	}
	return paths, nil
}

func (p *OfflinePipeline) loadItems(ctx context.Context) ([]model.SourceItem, error) {
	var items []model.SourceItem
	if p.RSS != nil && p.RSSPath != "" {
		file, err := os.Open(p.RSSPath)
		if err != nil {
			return nil, err
		}
		rssItems, err := p.RSS.Parse(ctx, "offline-rss", file)
		_ = file.Close()
		if err != nil {
			return nil, err
		}
		items = append(items, rssItems...)
	}
	if p.X != nil {
		xItems, err := p.X.Search(ctx, "offline-x-search", "fixture")
		if err != nil {
			return nil, err
		}
		if len(xItems) > 0 {
			items = append(items, xItems[0])
		}
	}
	return items, nil
}

func (p *OfflinePipeline) collectItemsFailSoft(ctx context.Context, jobID string, items []model.SourceItem) ([]string, []TickFailure) {
	var paths []string
	var failures []TickFailure
	for _, item := range items {
		if p.BeforeItem != nil {
			if err := p.BeforeItem(item.SourceItemKey); err != nil {
				failures = append(failures, TickFailure{JobID: jobID + ":" + item.SourceItemKey, Code: apperror.FromError(err), Err: err})
				continue
			}
		}
		got, err := p.CollectAndSummarize(ctx, item.SourceID, []model.SourceItem{item})
		if err != nil {
			failures = append(failures, TickFailure{JobID: jobID + ":" + item.SourceItemKey, Code: apperror.FromError(err), Err: err})
			continue
		}
		paths = append(paths, got...)
	}
	return paths, failures
}

func sourceItemToRecord(item model.SourceItem, tickRunID, jobRunID string) model.Record {
	return model.Record{
		Source:        item.Source,
		SourceItemKey: item.SourceItemKey,
		ContentHash:   item.ContentHash,
		Status:        "captured",
		Title:         item.Title,
		RawContent:    item.Text,
		URL:           item.URL,
		CreatedAt:     item.PublishedAt,
		UpdatedAt:     item.PublishedAt,
		TickRunID:     tickRunID,
		JobRunID:      jobRunID,
	}
}
