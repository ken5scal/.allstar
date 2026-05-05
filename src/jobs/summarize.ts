import path from "node:path";

import type { AiAdapter, VaultAdapter } from "../adapters/interfaces.js";
import type { ObsflowConfig } from "../types.js";

export async function runSummarizeJob(args: {
  cfg: ObsflowConfig;
  vault: VaultAdapter;
  ai: AiAdapter;
  jobId: string;
}): Promise<number> {
  const roots = [
    path.join("Sources", "RSS"),
    path.join("Sources", "X", "Search"),
    path.join("Sources", "X", "Lists"),
    path.join("Sources", "X", "Bookmarks"),
  ];
  let n = 0;
  for (const root of roots) {
    const paths = await args.vault.listNotePathsUnder(root);
    for (const rel of paths) {
      const rec = await args.vault.readRecord(rel);
      if (!rec) continue;
      if (rec.status !== "captured" || rec.ai_drafted) continue;
      const out = await args.ai.summarize(rec);
      await args.vault.updateAiSummary(rel, out.summary, {
        status: "summarized",
        ai_drafted: true,
        summary: out.short_summary ?? out.summary.slice(0, 500),
        updated_at: new Date().toISOString(),
      });
      n += 1;
    }
  }
  void args.jobId;
  return n;
}
