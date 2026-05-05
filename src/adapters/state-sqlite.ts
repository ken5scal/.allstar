import Database from "better-sqlite3";

import type { Checkpoint, JobRun } from "../types.js";
import type { StateRepository, StateTx } from "./interfaces.js";

function nowIso(): string {
  return new Date().toISOString();
}

class SqliteTx implements StateTx {
  constructor(private readonly db: Database.Database) {}

  getCheckpoint(sourceId: string): Checkpoint | null {
    const row = this.db
      .prepare(`SELECT cursor FROM checkpoints WHERE source_id = ?`)
      .get(sourceId) as { cursor: string } | undefined;
    if (!row) return null;
    return { sourceId, cursor: row.cursor };
  }

  putCheckpoint(cp: Checkpoint): void {
    this.db
      .prepare(
        `INSERT INTO checkpoints (source_id, cursor, updated_at)
         VALUES (@source_id, @cursor, @updated_at)
         ON CONFLICT(source_id) DO UPDATE SET
           cursor = excluded.cursor,
           updated_at = excluded.updated_at`,
      )
      .run({
        source_id: cp.sourceId,
        cursor: cp.cursor,
        updated_at: nowIso(),
      });
  }

  seenSourceItem(sourceId: string, itemKey: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM seen_items WHERE source_id = ? AND item_key = ?`,
      )
      .get(sourceId, itemKey);
    return !!row;
  }

  markSourceItemSeen(sourceId: string, itemKey: string, contentHash: string): void {
    this.db
      .prepare(
        `INSERT INTO seen_items (source_id, item_key, content_hash, seen_at)
         VALUES (@source_id, @item_key, @content_hash, @seen_at)
         ON CONFLICT(source_id, item_key) DO UPDATE SET
           content_hash = excluded.content_hash,
           seen_at = excluded.seen_at`,
      )
      .run({
        source_id: sourceId,
        item_key: itemKey,
        content_hash: contentHash,
        seen_at: nowIso(),
      });
  }

  seenContentHash(sourceId: string, contentHash: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM seen_items WHERE source_id = ? AND content_hash = ? LIMIT 1`,
      )
      .get(sourceId, contentHash);
    return !!row;
  }
}

export class SqliteStateRepository implements StateRepository {
  private readonly db: Database.Database;

  constructor(dsn: string) {
    this.db = new Database(dsn);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS checkpoints (
        source_id TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seen_items (
        source_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (source_id, item_key)
      );
      CREATE INDEX IF NOT EXISTS idx_seen_hash ON seen_items (source_id, content_hash);
      CREATE TABLE IF NOT EXISTS job_runs (
        job_run_id TEXT PRIMARY KEY,
        tick_run_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        source_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs (job_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS tick_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tick_run_id TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL
      );
    `);
  }

  async getCheckpoint(sourceId: string): Promise<Checkpoint | null> {
    const row = this.db
      .prepare(`SELECT source_id, cursor FROM checkpoints WHERE source_id = ?`)
      .get(sourceId) as { source_id: string; cursor: string } | undefined;
    if (!row) return null;
    return { sourceId: row.source_id, cursor: row.cursor };
  }

  async putCheckpoint(cp: Checkpoint): Promise<void> {
    new SqliteTx(this.db).putCheckpoint(cp);
  }

  async seenSourceItem(sourceId: string, itemKey: string): Promise<boolean> {
    return new SqliteTx(this.db).seenSourceItem(sourceId, itemKey);
  }

  async markSourceItemSeen(
    sourceId: string,
    itemKey: string,
    contentHash: string,
  ): Promise<void> {
    new SqliteTx(this.db).markSourceItemSeen(sourceId, itemKey, contentHash);
  }

  async seenContentHash(sourceId: string, contentHash: string): Promise<boolean> {
    return new SqliteTx(this.db).seenContentHash(sourceId, contentHash);
  }

  async lastJobRun(jobId: string): Promise<JobRun | null> {
    const row = this.db
      .prepare(
        `SELECT job_run_id, tick_run_id, job_id, source_id, started_at, finished_at, status, error_message
         FROM job_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(jobId) as
      | {
          job_run_id: string;
          tick_run_id: string;
          job_id: string;
          source_id: string | null;
          started_at: string;
          finished_at: string | null;
          status: string;
          error_message: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      job_run_id: row.job_run_id,
      tick_run_id: row.tick_run_id,
      job_id: row.job_id,
      source_id: row.source_id ?? undefined,
      started_at: row.started_at,
      finished_at: row.finished_at ?? undefined,
      status: row.status as JobRun["status"],
      error_message: row.error_message ?? undefined,
    };
  }

  async saveJobRun(run: JobRun): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO job_runs (
           job_run_id, tick_run_id, job_id, source_id, started_at, finished_at, status, error_message
         ) VALUES (
           @job_run_id, @tick_run_id, @job_id, @source_id, @started_at, @finished_at, @status, @error_message
         )
         ON CONFLICT(job_run_id) DO UPDATE SET
           finished_at = excluded.finished_at,
           status = excluded.status,
           error_message = excluded.error_message`,
      )
      .run({
        job_run_id: run.job_run_id,
        tick_run_id: run.tick_run_id,
        job_id: run.job_id,
        source_id: run.source_id ?? null,
        started_at: run.started_at,
        finished_at: run.finished_at ?? null,
        status: run.status,
        error_message: run.error_message ?? null,
      });
  }

  async inTx<T>(fn: (tx: StateTx) => T): Promise<T> {
    const run = this.db.transaction(() => {
      const tx = new SqliteTx(this.db);
      return fn(tx);
    });
    return Promise.resolve(run());
  }

  tryAcquireTickLock(tickRunId: string, staleMs: number): boolean {
    if (process.env.OBSFLOW_SKIP_TICK_LOCK === "1") return true;
    const now = Date.now();
    try {
      const run = this.db.transaction(() => {
        const row = this.db
          .prepare(`SELECT tick_run_id, started_at_ms FROM tick_lock WHERE id = 1`)
          .get() as { tick_run_id: string; started_at_ms: number } | undefined;
        if (row && now - row.started_at_ms < staleMs) {
          return false;
        }
        this.db
          .prepare(
            `INSERT INTO tick_lock (id, tick_run_id, started_at_ms)
             VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               tick_run_id = excluded.tick_run_id,
               started_at_ms = excluded.started_at_ms`,
          )
          .run(tickRunId, now);
        return true;
      });
      return run();
    } catch {
      return false;
    }
  }

  releaseTickLock(tickRunId: string): void {
    if (process.env.OBSFLOW_SKIP_TICK_LOCK === "1") return;
    this.db
      .prepare(`DELETE FROM tick_lock WHERE id = 1 AND tick_run_id = ?`)
      .run(tickRunId);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
