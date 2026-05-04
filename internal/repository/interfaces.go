package repository

import (
	"context"
	"strings"

	"github.com/ken5scal/obsflow/internal/model"
)

type StateReader interface {
	GetCheckpoint(ctx context.Context, sourceID string) (model.Checkpoint, error)
	SeenSourceItem(ctx context.Context, sourceID string, itemKey string) (bool, error)
	SeenContentHash(ctx context.Context, sourceID string, contentHash string) (bool, error)
	LastJobRun(ctx context.Context, jobID string) (model.JobRun, error)
}

type StateWriter interface {
	PutCheckpoint(ctx context.Context, cp model.Checkpoint) error
	MarkSourceItemSeen(ctx context.Context, sourceID string, itemKey string, contentHash string) error
	SaveJobRun(ctx context.Context, run model.JobRun) error
}

type StateTx interface {
	StateReader
	StateWriter
}

type StateRepository interface {
	StateTx
	InTx(ctx context.Context, fn func(tx StateTx) error) error
	Close() error
}

type VaultRepository interface {
	UpsertRecord(ctx context.Context, record model.Record) (string, error)
	ReadRecord(ctx context.Context, path string) ([]byte, error)
	UpdateAISummary(ctx context.Context, path string, summary string) error
}

type RSSClient interface {
	Fetch(ctx context.Context, sourceID string, feedURL string) ([]model.SourceItem, error)
	Parse(ctx context.Context, sourceID string, data []byte) ([]model.SourceItem, error)
}

type XClient interface {
	Search(ctx context.Context, sourceID string, query string) ([]model.SourceItem, error)
	Lists(ctx context.Context, sourceID string, listID string) ([]model.SourceItem, error)
	Bookmarks(ctx context.Context, sourceID string) ([]model.SourceItem, error)
}

type AIClient interface {
	Summarize(ctx context.Context, record model.Record) (string, error)
	BuildDigest(ctx context.Context, cadence string, records []model.Record) (string, error)
}

type AlertClient interface {
	SendError(ctx context.Context, alert Alert) error
}

type Alert struct {
	TickRunID string
	Failures  []AlertFailure
}

type AlertFailure struct {
	TargetID     string
	ErrorSummary string
	RetryHint    string
}

func (a Alert) Summary() string {
	parts := make([]string, 0, len(a.Failures))
	for _, failure := range a.Failures {
		parts = append(parts, failure.TargetID+": "+failure.ErrorSummary)
	}
	return strings.Join(parts, "; ")
}
