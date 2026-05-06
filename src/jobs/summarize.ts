import type { AiAdapter, VaultAdapter } from "../adapters/interfaces.js";
import type { AppLogger } from "../logger.js";
import type { ObsflowConfig } from "../types.js";

export type SummarizeJobResult = {
  processed: number;
  skipped: number;
  failed: number;
  targetTotal: number;
};

export class SummarizeJobError extends Error {
  readonly result: SummarizeJobResult;
  readonly vaultRelPath: string;

  constructor(vaultRelPath: string, result: SummarizeJobResult, cause: unknown) {
    super("summarize item failed", { cause });
    this.name = "SummarizeJobError";
    this.vaultRelPath = vaultRelPath;
    this.result = result;
  }
}

export async function runSummarizeJob(args: {
  cfg: ObsflowConfig;
  vault: VaultAdapter;
  ai: AiAdapter;
  jobId: string;
  jobRunId?: string;
  logger?: AppLogger;
}): Promise<SummarizeJobResult> {
  const roots = [args.cfg.records.root_folder];
  const skippedPaths: Array<{ rel: string; reason: string }> = [];
  const targets: Array<{
    rel: string;
    rec: NonNullable<Awaited<ReturnType<VaultAdapter["readRecord"]>>>;
  }> = [];

  for (const root of roots) {
    const paths = await args.vault.listNotePathsUnder(root);
    for (const rel of paths) {
      const rec = await args.vault.readRecord(rel);
      if (!rec) {
        skippedPaths.push({ rel, reason: "missing_record" });
        continue;
      }
      if (rec.status !== "captured") {
        skippedPaths.push({ rel, reason: "not_captured" });
        continue;
      }
      targets.push({ rel, rec });
    }
  }

  const result: SummarizeJobResult = {
    processed: 0,
    skipped: skippedPaths.length,
    failed: 0,
    targetTotal: targets.length,
  };
  const job_run_id = args.jobRunId;
  const job_id = args.jobId;

  args.logger?.info({
    msg: "summarize_job_start",
    job_run_id,
    job_id,
    records_root: args.cfg.records.root_folder,
    target_total: result.targetTotal,
  });

  for (const skipped of skippedPaths) {
    args.logger?.debug({
      msg: "summarize_item_skipped",
      job_run_id,
      job_id,
      vault_rel_path: skipped.rel,
      skip_reason: skipped.reason,
    });
  }

  for (let i = 0; i < targets.length; i++) {
    const { rel, rec } = targets[i];
    const index = i + 1;
    const startedAt = Date.now();
    args.logger?.info({
      msg: "summarize_item_start",
      job_run_id,
      job_id,
      vault_rel_path: rel,
      index,
      target_total: result.targetTotal,
      source_id: rec.source_id,
      source: rec.source,
      source_type: rec.source_type,
    });
    try {
      const out = await args.ai.summarize(rec);
      await args.vault.updateAiSummary(rel, "", {
        status: "summarized",
        summary: out.summary,
        tags: out.tags ?? [],
        ...(out.category?.trim() ? { category: out.category.trim() } : {}),
        updated_at: new Date().toISOString(),
      });
      result.processed += 1;
      args.logger?.info({
        msg: "summarize_item_success",
        job_run_id,
        job_id,
        vault_rel_path: rel,
        index,
        target_total: result.targetTotal,
        duration_ms: Date.now() - startedAt,
      });
    } catch (e) {
      result.failed += 1;
      args.logger?.error({
        msg: "summarize_item_failed",
        job_run_id,
        job_id,
        vault_rel_path: rel,
        source_id: rec.source_id,
        source: rec.source,
        error_message: "summarize item failed",
      });
      args.logger?.info({
        msg: "summarize_job_done",
        job_run_id,
        job_id,
        processed: result.processed,
        skipped: result.skipped,
        failed: result.failed,
      });
      throw new SummarizeJobError(rel, result, e);
    }
  }

  args.logger?.info({
    msg: "summarize_job_done",
    job_run_id,
    job_id,
    processed: result.processed,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
