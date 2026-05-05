import type { AiAdapter, VaultAdapter } from "../adapters/interfaces.js";
import type { ObsflowConfig } from "../types.js";

export async function runSummarizeJob(args: {
  cfg: ObsflowConfig;
  vault: VaultAdapter;
  ai: AiAdapter;
  jobId: string;
}): Promise<number> {
  const roots = [args.cfg.records.root_folder];
  let n = 0;
  for (const root of roots) {
    const paths = await args.vault.listNotePathsUnder(root);
    for (const rel of paths) {
      const rec = await args.vault.readRecord(rel);
      if (!rec) continue;
      if (rec.status !== "captured") continue;
      const out = await args.ai.summarize(rec);
      await args.vault.updateAiSummary(rel, out.summary, {
        status: "summarized",
        summary: out.short_summary ?? out.summary.slice(0, 500),
        updated_at: new Date().toISOString(),
      });
      n += 1;
    }
  }
  void args.jobId;
  return n;
}
