package repository

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/ken5scal/obsflow/internal/model"
)

func TestSQLiteStateRepositoryCheckpoint(t *testing.T) {
	ctx := context.Background()
	repo := openTestStateRepository(t)

	cp, err := repo.GetCheckpoint(ctx, "rss:hn")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetCheckpoint empty error = %v, want ErrNotFound", err)
	}
	if cp != (model.Checkpoint{}) {
		t.Fatalf("empty checkpoint = %#v, want zero value", cp)
	}

	want := model.Checkpoint{
		SourceID:  "rss:hn",
		Cursor:    "cursor-1",
		UpdatedAt: time.Date(2026, 5, 4, 1, 2, 3, 0, time.UTC),
	}
	if err := repo.PutCheckpoint(ctx, want); err != nil {
		t.Fatalf("PutCheckpoint: %v", err)
	}
	got, err := repo.GetCheckpoint(ctx, "rss:hn")
	if err != nil {
		t.Fatalf("GetCheckpoint: %v", err)
	}
	if got.SourceID != want.SourceID || got.Cursor != want.Cursor || !got.UpdatedAt.Equal(want.UpdatedAt) {
		t.Fatalf("checkpoint = %#v, want %#v", got, want)
	}
}

func TestStateRepositoryInTxCommitsSeenAndCheckpoint(t *testing.T) {
	ctx := context.Background()
	repo := openTestStateRepository(t)
	updatedAt := time.Date(2026, 5, 4, 2, 0, 0, 0, time.UTC)

	if err := repo.InTx(ctx, func(tx StateTx) error {
		if err := tx.MarkSourceItemSeen(ctx, "rss:hn", "item-1", "sha256:one"); err != nil {
			return err
		}
		return tx.PutCheckpoint(ctx, model.Checkpoint{
			SourceID:  "rss:hn",
			Cursor:    "item-1",
			UpdatedAt: updatedAt,
		})
	}); err != nil {
		t.Fatalf("InTx commit: %v", err)
	}

	seen, err := repo.SeenSourceItem(ctx, "rss:hn", "item-1")
	if err != nil {
		t.Fatalf("SeenSourceItem: %v", err)
	}
	if !seen {
		t.Fatal("source item was not marked seen")
	}
	cp, err := repo.GetCheckpoint(ctx, "rss:hn")
	if err != nil {
		t.Fatalf("GetCheckpoint: %v", err)
	}
	if cp.Cursor != "item-1" {
		t.Fatalf("checkpoint cursor = %q, want item-1", cp.Cursor)
	}
}

func TestStateTxRollbackOnError(t *testing.T) {
	ctx := context.Background()
	repo := openTestStateRepository(t)
	errRollback := errors.New("force rollback")

	err := repo.InTx(ctx, func(tx StateTx) error {
		if err := tx.MarkSourceItemSeen(ctx, "rss:hn", "item-rollback", "sha256:rollback"); err != nil {
			return err
		}
		if err := tx.PutCheckpoint(ctx, model.Checkpoint{
			SourceID:  "rss:hn",
			Cursor:    "item-rollback",
			UpdatedAt: time.Now().UTC(),
		}); err != nil {
			return err
		}
		return errRollback
	})
	if !errors.Is(err, errRollback) {
		t.Fatalf("InTx error = %v, want %v", err, errRollback)
	}

	seen, err := repo.SeenSourceItem(ctx, "rss:hn", "item-rollback")
	if err != nil {
		t.Fatalf("SeenSourceItem: %v", err)
	}
	if seen {
		t.Fatal("source item remained after rollback")
	}
	cp, err := repo.GetCheckpoint(ctx, "rss:hn")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetCheckpoint error = %v, want ErrNotFound", err)
	}
	if cp != (model.Checkpoint{}) {
		t.Fatalf("checkpoint after rollback = %#v, want zero value", cp)
	}
}

func TestSeenSourceItemIdempotentAndContentHashReplay(t *testing.T) {
	ctx := context.Background()
	repo := openTestStateRepository(t)

	for i := 0; i < 2; i++ {
		if err := repo.MarkSourceItemSeen(ctx, "x:search", "tweet-1", "sha256:tweet"); err != nil {
			t.Fatalf("MarkSourceItemSeen iteration %d: %v", i, err)
		}
	}

	seenItem, err := repo.SeenSourceItem(ctx, "x:search", "tweet-1")
	if err != nil {
		t.Fatalf("SeenSourceItem: %v", err)
	}
	if !seenItem {
		t.Fatal("expected source item to be seen")
	}
	seenHash, err := repo.SeenContentHash(ctx, "x:search", "sha256:tweet")
	if err != nil {
		t.Fatalf("SeenContentHash: %v", err)
	}
	if !seenHash {
		t.Fatal("expected content hash to be seen")
	}
}

func TestJobRunReplay(t *testing.T) {
	ctx := context.Background()
	repo := openTestStateRepository(t)
	run := model.JobRun{
		JobRunID:  "job-run-1",
		TickRunID: "tick-run-1",
		JobID:     "summarize-main",
		StartedAt: time.Date(2026, 5, 4, 3, 0, 0, 0, time.UTC),
		EndedAt:   time.Date(2026, 5, 4, 3, 1, 0, 0, time.UTC),
		Status:    "success",
	}

	if err := repo.SaveJobRun(ctx, run); err != nil {
		t.Fatalf("SaveJobRun first: %v", err)
	}
	run.Status = "success"
	if err := repo.SaveJobRun(ctx, run); err != nil {
		t.Fatalf("SaveJobRun replay: %v", err)
	}
	got, err := repo.LastJobRun(ctx, "summarize-main")
	if err != nil {
		t.Fatalf("LastJobRun: %v", err)
	}
	if got.JobRunID != run.JobRunID || got.TickRunID != run.TickRunID || got.Status != run.Status {
		t.Fatalf("job run = %#v, want %#v", got, run)
	}
}

func openTestStateRepository(t *testing.T) *SQLiteStateRepository {
	t.Helper()

	repo, err := NewSQLiteStateRepository(context.Background(), filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatalf("NewSQLiteStateRepository: %v", err)
	}
	t.Cleanup(func() {
		if err := repo.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	})
	return repo
}
