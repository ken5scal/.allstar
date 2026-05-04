package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"github.com/ken5scal/obsflow/internal/model"
)

var ErrNotFound = errors.New("repository item not found")

type SQLiteStateRepository struct {
	db *sql.DB
}

func NewSQLiteStateRepository(ctx context.Context, dsn string) (*SQLiteStateRepository, error) {
	if dsn == "" {
		return nil, fmt.Errorf("sqlite dsn is required")
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	repo := &SQLiteStateRepository{db: db}
	if err := repo.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return repo, nil
}

func (r *SQLiteStateRepository) Close() error {
	if r == nil || r.db == nil {
		return nil
	}
	return r.db.Close()
}

func (r *SQLiteStateRepository) GetCheckpoint(ctx context.Context, sourceID string) (model.Checkpoint, error) {
	return getCheckpoint(ctx, r.db, sourceID)
}

func (r *SQLiteStateRepository) PutCheckpoint(ctx context.Context, cp model.Checkpoint) error {
	return putCheckpoint(ctx, r.db, cp)
}

func (r *SQLiteStateRepository) SeenSourceItem(ctx context.Context, sourceID string, itemKey string) (bool, error) {
	return seenSourceItem(ctx, r.db, sourceID, itemKey)
}

func (r *SQLiteStateRepository) MarkSourceItemSeen(ctx context.Context, sourceID string, itemKey string, contentHash string) error {
	return markSourceItemSeen(ctx, r.db, sourceID, itemKey, contentHash)
}

func (r *SQLiteStateRepository) SeenContentHash(ctx context.Context, sourceID string, contentHash string) (bool, error) {
	return seenContentHash(ctx, r.db, sourceID, contentHash)
}

func (r *SQLiteStateRepository) LastJobRun(ctx context.Context, jobID string) (model.JobRun, error) {
	return lastJobRun(ctx, r.db, jobID)
}

func (r *SQLiteStateRepository) SaveJobRun(ctx context.Context, run model.JobRun) error {
	return saveJobRun(ctx, r.db, run)
}

func (r *SQLiteStateRepository) InTx(ctx context.Context, fn func(tx StateTx) error) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	if err := fn(sqliteStateTx{tx: tx}); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("rollback tx after %v: %w", err, rbErr)
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

type sqliteStateTx struct {
	tx *sql.Tx
}

func (t sqliteStateTx) GetCheckpoint(ctx context.Context, sourceID string) (model.Checkpoint, error) {
	return getCheckpoint(ctx, t.tx, sourceID)
}

func (t sqliteStateTx) PutCheckpoint(ctx context.Context, cp model.Checkpoint) error {
	return putCheckpoint(ctx, t.tx, cp)
}

func (t sqliteStateTx) SeenSourceItem(ctx context.Context, sourceID string, itemKey string) (bool, error) {
	return seenSourceItem(ctx, t.tx, sourceID, itemKey)
}

func (t sqliteStateTx) MarkSourceItemSeen(ctx context.Context, sourceID string, itemKey string, contentHash string) error {
	return markSourceItemSeen(ctx, t.tx, sourceID, itemKey, contentHash)
}

func (t sqliteStateTx) SeenContentHash(ctx context.Context, sourceID string, contentHash string) (bool, error) {
	return seenContentHash(ctx, t.tx, sourceID, contentHash)
}

func (t sqliteStateTx) LastJobRun(ctx context.Context, jobID string) (model.JobRun, error) {
	return lastJobRun(ctx, t.tx, jobID)
}

func (t sqliteStateTx) SaveJobRun(ctx context.Context, run model.JobRun) error {
	return saveJobRun(ctx, t.tx, run)
}

type sqlExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type sqlQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type sqlRunner interface {
	sqlExecer
	sqlQueryer
}

func (r *SQLiteStateRepository) migrate(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS checkpoints (
			source_id TEXT PRIMARY KEY,
			cursor TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS source_items (
			source_id TEXT NOT NULL,
			item_key TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			seen_at TEXT NOT NULL,
			PRIMARY KEY (source_id, item_key)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_source_items_hash ON source_items (source_id, content_hash)`,
		`CREATE TABLE IF NOT EXISTS job_runs (
			job_run_id TEXT PRIMARY KEY,
			tick_run_id TEXT NOT NULL,
			job_id TEXT NOT NULL,
			status TEXT NOT NULL,
			started_at TEXT NOT NULL,
			finished_at TEXT,
			error TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_job_runs_job_started ON job_runs (job_id, started_at DESC)`,
	}
	for _, stmt := range statements {
		if _, err := r.db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migrate sqlite state: %w", err)
		}
	}
	return nil
}

func getCheckpoint(ctx context.Context, q sqlQueryer, sourceID string) (model.Checkpoint, error) {
	var cp model.Checkpoint
	var updatedAt string
	err := q.QueryRowContext(ctx, `SELECT source_id, cursor, updated_at FROM checkpoints WHERE source_id = ?`, sourceID).
		Scan(&cp.SourceID, &cp.Cursor, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Checkpoint{}, ErrNotFound
	}
	if err != nil {
		return model.Checkpoint{}, fmt.Errorf("get checkpoint: %w", err)
	}
	parsed, err := time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return model.Checkpoint{}, fmt.Errorf("parse checkpoint updated_at: %w", err)
	}
	cp.UpdatedAt = parsed
	return cp, nil
}

func putCheckpoint(ctx context.Context, e sqlExecer, cp model.Checkpoint) error {
	if cp.SourceID == "" {
		return fmt.Errorf("checkpoint source_id is required")
	}
	if cp.UpdatedAt.IsZero() {
		cp.UpdatedAt = time.Now().UTC()
	}
	_, err := e.ExecContext(ctx, `
		INSERT INTO checkpoints (source_id, cursor, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(source_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
	`, cp.SourceID, cp.Cursor, cp.UpdatedAt.Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("put checkpoint: %w", err)
	}
	return nil
}

func seenSourceItem(ctx context.Context, q sqlQueryer, sourceID string, itemKey string) (bool, error) {
	var exists int
	err := q.QueryRowContext(ctx, `SELECT 1 FROM source_items WHERE source_id = ? AND item_key = ?`, sourceID, itemKey).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("seen source item: %w", err)
	}
	return true, nil
}

func markSourceItemSeen(ctx context.Context, e sqlExecer, sourceID string, itemKey string, contentHash string) error {
	if sourceID == "" || itemKey == "" || contentHash == "" {
		return fmt.Errorf("source_id, item_key, and content_hash are required")
	}
	_, err := e.ExecContext(ctx, `
		INSERT INTO source_items (source_id, item_key, content_hash, seen_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(source_id, item_key) DO UPDATE SET content_hash = excluded.content_hash, seen_at = excluded.seen_at
	`, sourceID, itemKey, contentHash, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("mark source item seen: %w", err)
	}
	return nil
}

func seenContentHash(ctx context.Context, q sqlQueryer, sourceID string, contentHash string) (bool, error) {
	var exists int
	err := q.QueryRowContext(ctx, `SELECT 1 FROM source_items WHERE source_id = ? AND content_hash = ? LIMIT 1`, sourceID, contentHash).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("seen content hash: %w", err)
	}
	return true, nil
}

func lastJobRun(ctx context.Context, q sqlQueryer, jobID string) (model.JobRun, error) {
	var run model.JobRun
	var startedAt, finishedAt sql.NullString
	var errorText sql.NullString
	err := q.QueryRowContext(ctx, `
		SELECT job_run_id, tick_run_id, job_id, status, started_at, finished_at, error
		FROM job_runs
		WHERE job_id = ?
		ORDER BY started_at DESC
		LIMIT 1
	`, jobID).Scan(&run.JobRunID, &run.TickRunID, &run.JobID, &run.Status, &startedAt, &finishedAt, &errorText)
	if errors.Is(err, sql.ErrNoRows) {
		return model.JobRun{}, ErrNotFound
	}
	if err != nil {
		return model.JobRun{}, fmt.Errorf("last job run: %w", err)
	}
	if startedAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, startedAt.String)
		if err != nil {
			return model.JobRun{}, fmt.Errorf("parse job started_at: %w", err)
		}
		run.StartedAt = parsed
	}
	if finishedAt.Valid {
		parsed, err := time.Parse(time.RFC3339Nano, finishedAt.String)
		if err != nil {
			return model.JobRun{}, fmt.Errorf("parse job finished_at: %w", err)
		}
		run.EndedAt = parsed
	}
	if errorText.Valid {
		run.Error = errorText.String
	}
	return run, nil
}

func saveJobRun(ctx context.Context, e sqlExecer, run model.JobRun) error {
	if run.JobRunID == "" || run.TickRunID == "" || run.JobID == "" || run.Status == "" {
		return fmt.Errorf("job_run_id, tick_run_id, job_id, and status are required")
	}
	if run.StartedAt.IsZero() {
		run.StartedAt = time.Now().UTC()
	}
	var finishedAt any
	if !run.EndedAt.IsZero() {
		finishedAt = run.EndedAt.Format(time.RFC3339Nano)
	}
	var errText any
	if run.Error != "" {
		errText = run.Error
	}
	_, err := e.ExecContext(ctx, `
		INSERT INTO job_runs (job_run_id, tick_run_id, job_id, status, started_at, finished_at, error)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(job_run_id) DO UPDATE SET
			tick_run_id = excluded.tick_run_id,
			job_id = excluded.job_id,
			status = excluded.status,
			started_at = excluded.started_at,
			finished_at = excluded.finished_at,
			error = excluded.error
	`, run.JobRunID, run.TickRunID, run.JobID, run.Status, run.StartedAt.Format(time.RFC3339Nano), finishedAt, errText)
	if err != nil {
		return fmt.Errorf("save job run: %w", err)
	}
	return nil
}
