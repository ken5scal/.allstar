import type { AiAdapter, VaultAdapter } from "../adapters/interfaces.js";
import type { AppLogger } from "../logger.js";
import type { ObsflowConfig, SummarizeSelectionConfig, VaultRecord } from "../types.js";

export type SummarizeJobResult = {
  processed: number;
  skipped: number;
  failed: number;
  targetTotal: number;
  pendingTotal: number;
  deferredTotal: number;
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

type SummarizeTarget = {
  rel: string;
  rec: NonNullable<Awaited<ReturnType<VaultAdapter["readRecord"]>>>;
};

function capturedAtMs(rec: VaultRecord): number {
  const millis = Date.parse(rec.captured_at);
  return Number.isNaN(millis) ? 0 : millis;
}

function orderTargets(
  targets: SummarizeTarget[],
  selection?: SummarizeSelectionConfig,
): SummarizeTarget[] {
  const order = selection?.order ?? "oldest_first";
  const dir = order === "newest_first" ? -1 : 1;
  return [...targets].sort((a, b) => {
    const byCapturedAt = capturedAtMs(a.rec) - capturedAtMs(b.rec);
    if (byCapturedAt !== 0) return byCapturedAt * dir;
    return a.rel.localeCompare(b.rel);
  });
}

export async function runSummarizeJob(args: {
  cfg: ObsflowConfig;
  vault: VaultAdapter;
  ai: AiAdapter;
  jobId: string;
  jobRunId?: string;
  logger?: AppLogger;
  selection?: SummarizeSelectionConfig;
}): Promise<SummarizeJobResult> {
  const roots = [args.cfg.records.root_folder];
  const skippedPaths: Array<{ rel: string; reason: string }> = [];
  const pendingTargets: SummarizeTarget[] = [];

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
      pendingTargets.push({ rel, rec });
    }
  }

  const orderedTargets = orderTargets(pendingTargets, args.selection);
  const pendingTotal = orderedTargets.length;
  const backlogGuard = args.selection?.skip_if_pending_over;
  const selectedTargets =
    backlogGuard !== undefined && pendingTotal > backlogGuard ? []
    : args.selection?.max_items !== undefined ? orderedTargets.slice(0, args.selection.max_items)
    : orderedTargets;
  const deferredTotal = pendingTotal - selectedTargets.length;

  const result: SummarizeJobResult = {
    processed: 0,
    skipped: skippedPaths.length,
    failed: 0,
    targetTotal: selectedTargets.length,
    pendingTotal,
    deferredTotal,
  };
  const job_run_id = args.jobRunId;
  const job_id = args.jobId;

  args.logger?.info({
    msg: "summarize_job_start",
    job_run_id,
    job_id,
    records_root: args.cfg.records.root_folder,
    pending_total: result.pendingTotal,
    target_total: result.targetTotal,
    deferred_total: result.deferredTotal,
    selection_order_by: args.selection?.order_by ?? "captured_at",
    selection_order: args.selection?.order ?? "oldest_first",
    selection_max_items: args.selection?.max_items,
    selection_skip_if_pending_over: args.selection?.skip_if_pending_over,
  });

  if (backlogGuard !== undefined && pendingTotal > backlogGuard) {
    args.logger?.warn({
      msg: "summarize_job_deferred_by_policy",
      job_run_id,
      job_id,
      pending_total: pendingTotal,
      target_total: result.targetTotal,
      deferred_total: result.deferredTotal,
      skip_if_pending_over: backlogGuard,
    });
    args.logger?.info({
      msg: "summarize_job_done",
      job_run_id,
      job_id,
      processed: result.processed,
      skipped: result.skipped,
      failed: result.failed,
      pending_total: result.pendingTotal,
      target_total: result.targetTotal,
      deferred_total: result.deferredTotal,
    });
    return result;
  }

  for (const skipped of skippedPaths) {
    args.logger?.debug({
      msg: "summarize_item_skipped",
      job_run_id,
      job_id,
      vault_rel_path: skipped.rel,
      skip_reason: skipped.reason,
    });
  }

  for (let i = 0; i < selectedTargets.length; i++) {
    const { rel, rec } = selectedTargets[i];
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
        pending_total: result.pendingTotal,
        target_total: result.targetTotal,
        deferred_total: result.deferredTotal,
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
    pending_total: result.pendingTotal,
    target_total: result.targetTotal,
    deferred_total: result.deferredTotal,
  });
  return result;
}
