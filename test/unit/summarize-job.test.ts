import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createAiMockAdapter } from "../../src/adapters/ai-mock.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { loadConfigFile, normalizeConfig } from "../../src/config.js";
import { runSummarizeJob } from "../../src/jobs/summarize.js";
import type { AppLogger } from "../../src/logger.js";
import { parseVaultNote, renderVaultNote } from "../../src/note.js";
import { OBSFLOW_RECORD_KIND, type VaultRecord } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

describe("runSummarizeJob", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("updates frontmatter summary, tags, category; removes AI Summary section; keeps raw body", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "obsflow-sum-"));
    const rel = "src/rss/sample/2026/05/05/second.md";
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const capturedRecord: VaultRecord = {
      schema_version: 1,
      record_kind: OBSFLOW_RECORD_KIND,
      base_ids: ["all-records"],
      source_type: "rss",
      source: "https://example.com/p/2",
      source_id: "sample",
      source_group: "rss",
      origin: "example.com",
      status: "captured",
      tags: [],
      attachments: [],
      summary: "",
      content_status: "suspected_missing",
      content_issue_note: "本文が短すぎる",
      content_issue_marked_at: "2026-05-06T13:00:00.000Z",
      captured_at: "2026-05-05T10:13:16.968Z",
      created_at: "2026-05-05T10:13:16.968Z",
      updated_at: "2026-05-05T10:13:16.968Z",
      tick_run_id: "tick-test",
      job_run_id: "job-test",
      rawContent: "Second body.",
      aiSummary: "Old AI summary",
    };
    fs.writeFileSync(dst, renderVaultNote(capturedRecord), "utf8");

    const raw = loadConfigFile(path.join(repo, "test/fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, path.join(repo, "test/fixtures"));
    cfg.defaults.vault_path = tmp;

    const vault = createVaultMockAdapter(tmp);
    const events: Array<Record<string, unknown>> = [];
    const logger = {
      info(row: Record<string, unknown>) {
        events.push(row);
      },
      debug(row: Record<string, unknown>) {
        events.push(row);
      },
      error(row: Record<string, unknown>) {
        events.push(row);
      },
    } as unknown as AppLogger;
    const ai = createAiMockAdapter({
      handler: () => ({
        summary: "- 要点1\n- 要点2",
        short_summary: "短い要約",
        tags: ["cursor", "llm/ai"],
        category: "blogs",
      }),
    });

    const result = await runSummarizeJob({
      cfg,
      vault,
      ai,
      jobId: "t",
      jobRunId: "jr-test",
      logger,
    });
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);

    const md = fs.readFileSync(dst, "utf8");
    expect(md).toContain("Second body.");
    expect(md).not.toContain("## AI Summary");
    const rec = parseVaultNote(md);
    expect(rec?.status).toBe("summarized");
    expect(rec?.summary).toBe("- 要点1\n- 要点2");
    expect(rec?.tags).toEqual(["cursor", "llm/ai"]);
    expect(rec?.category).toBe("blogs");
    expect(rec?.aiSummary).toBe("");
    expect(rec?.content_status).toBe("suspected_missing");
    expect(rec?.content_issue_note).toBe("本文が短すぎる");
    expect(rec?.content_issue_marked_at).toBe("2026-05-06T13:00:00.000Z");

    const body = md.split("---").slice(2).join("---");
    const rawSection = body.match(/## Raw Content\s*\n([\s\S]*?)(?=\n## |\s*$)/)?.[1];
    expect(rawSection?.trim()).toBe("Second body.");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          msg: "summarize_job_start",
          job_run_id: "jr-test",
          job_id: "t",
          target_total: 1,
        }),
        expect.objectContaining({
          msg: "summarize_item_start",
          vault_rel_path: rel,
          index: 1,
          target_total: 1,
        }),
        expect.objectContaining({
          msg: "summarize_item_success",
          vault_rel_path: rel,
          index: 1,
        }),
        expect.objectContaining({
          msg: "summarize_job_done",
          processed: 1,
          skipped: 0,
          failed: 0,
        }),
      ]),
    );
  });
});
