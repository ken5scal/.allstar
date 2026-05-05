import fs from "node:fs";
import path from "node:path";

import { newId } from "../ids.js";
import { ensureDir } from "../paths.js";
import type { VaultAdapter } from "../adapters/interfaces.js";
import type { DigestCadence, ObsflowConfig } from "../types.js";

function digestFilename(cadence: DigestCadence, now: Date): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${cadence}-${y}-${mo}-${d}.md`;
}

export async function runDigestJob(args: {
  cfg: ObsflowConfig;
  vault: VaultAdapter;
  job: ObsflowConfig["jobs"][number] & { type: "digest"; cadence: DigestCadence };
  sinceIso: string | null;
  tickRunId: string;
  jobRunId: string;
}): Promise<string> {
  const since = args.sinceIso ? new Date(args.sinceIso) : new Date(0);
  const roots = [
    path.join("Sources", "RSS"),
    path.join("Sources", "X", "Search"),
    path.join("Sources", "X", "Lists"),
    path.join("Sources", "X", "Bookmarks"),
  ];
  const lines: string[] = [];
  for (const root of roots) {
    const paths = await args.vault.listNotePathsUnder(root);
    for (const rel of paths) {
      const rec = await args.vault.readRecord(rel);
      if (!rec) continue;
      const created = new Date(rec.created_at);
      if (created >= since) {
        lines.push(`- [[${rel.replace(/\.md$/, "")}]] — ${rec.source} ${rec.source_item_key}`);
      }
    }
  }
  const now = new Date();
  const fname = digestFilename(args.job.cadence, now);
  const relOut = path.join("Digests", fname);
  const full = path.join(args.cfg.defaults.vault_path, relOut);
  ensureDir(path.dirname(full));
  const body = [
    "---",
    `record_id: "${newId()}"`,
    "schema_version: 1",
    `source: "manual-web"`,
    `source_item_key: "${args.job.id}-${fname}"`,
    `content_hash: "digest:${args.job.cadence}:${fname}"`,
    'status: "captured"',
    "ai_drafted: false",
    "tags: []",
    "intent: []",
    "attachments: []",
    'summary: ""',
    `created_at: "${now.toISOString()}"`,
    `updated_at: "${now.toISOString()}"`,
    `tick_run_id: "${args.tickRunId}"`,
    `job_run_id: "${args.jobRunId}"`,
    "---",
    "",
    `# Digest (${args.job.cadence})`,
    "",
    lines.length ? lines.join("\n") : "_No new items in this window._",
    "",
  ].join("\n");
  fs.writeFileSync(full, body, "utf8");
  return relOut;
}
