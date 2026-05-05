import type {
  BaseConfig,
  Checkpoint,
  JobRun,
  SourceItem,
  VaultRecord,
  AiSummaryResult,
  FailureReport,
} from "../types.js";

export interface StateTx {
  getCheckpoint(sourceId: string): Checkpoint | null;
  putCheckpoint(cp: Checkpoint): void;
  seenSourceItem(sourceId: string, itemKey: string): boolean;
  markSourceItemSeen(sourceId: string, itemKey: string, contentHash: string): void;
  seenContentHash(sourceId: string, contentHash: string): boolean;
}

export interface StateRepository {
  getCheckpoint(sourceId: string): Promise<Checkpoint | null>;
  putCheckpoint(cp: Checkpoint): Promise<void>;
  seenSourceItem(sourceId: string, itemKey: string): Promise<boolean>;
  markSourceItemSeen(
    sourceId: string,
    itemKey: string,
    contentHash: string,
  ): Promise<void>;
  seenContentHash(sourceId: string, contentHash: string): Promise<boolean>;
  lastJobRun(jobId: string): Promise<JobRun | null>;
  saveJobRun(run: JobRun): Promise<void>;
  /** Synchronous transaction body; do not await inside `fn`. */
  inTx<T>(fn: (tx: StateTx) => T): Promise<T>;
  tryAcquireTickLock(tickRunId: string, staleMs: number): boolean;
  releaseTickLock(tickRunId: string): void;
  close(): Promise<void>;
}

export interface RssAdapter {
  collect(sourceId: string): Promise<SourceItem[]>;
}

export interface XCollectorAdapter {
  collectSearch(sourceId: string, query: string): Promise<SourceItem[]>;
  collectList(sourceId: string, listId: string): Promise<SourceItem[]>;
  collectBookmarks(sourceId: string): Promise<SourceItem[]>;
}

export interface VaultAdapter {
  upsertRecord(record: VaultRecord, noteRelPath: string): Promise<void>;
  upsertBase(base: BaseConfig): Promise<void>;
  updateAiSummary(
    noteRelPath: string,
    aiSummaryMarkdown: string,
    patch: Partial<Pick<VaultRecord, "summary" | "status" | "updated_at" | "tags" | "category">>,
  ): Promise<void>;
  listNotePathsUnder(prefix: string): Promise<string[]>;
  readRecord(noteRelPath: string): Promise<VaultRecord | null>;
}

export interface AiAdapter {
  summarize(record: VaultRecord): Promise<AiSummaryResult>;
}

export interface AlertAdapter {
  notifyFailure(report: FailureReport): Promise<void>;
  /** Flush aggregated duplicates for this tick. */
  flush?: () => Promise<void>;
}
