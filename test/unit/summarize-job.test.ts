import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createAiMockAdapter } from "../../src/adapters/ai-mock.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { loadConfigFile, normalizeConfig } from "../../src/config.js";
import { runSummarizeJob } from "../../src/jobs/summarize.js";
import { parseVaultNote } from "../../src/note.js";

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
    const src = path.join(repo, "test/fixtures/test-output-vault", rel);
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);

    const raw = loadConfigFile(path.join(repo, "test/fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, path.join(repo, "test/fixtures"));
    cfg.defaults.vault_path = tmp;

    const vault = createVaultMockAdapter(tmp);
    const ai = createAiMockAdapter({
      handler: () => ({
        summary: "- 要点1\n- 要点2",
        short_summary: "短い要約",
        tags: ["cursor", "llm/ai"],
        category: "blogs",
      }),
    });

    const n = await runSummarizeJob({ cfg, vault, ai, jobId: "t" });
    expect(n).toBe(1);

    const md = fs.readFileSync(dst, "utf8");
    expect(md).toContain("Second body.");
    expect(md).not.toContain("## AI Summary");
    const rec = parseVaultNote(md);
    expect(rec?.status).toBe("summarized");
    expect(rec?.summary).toBe("- 要点1\n- 要点2");
    expect(rec?.tags).toEqual(["cursor", "llm/ai"]);
    expect(rec?.category).toBe("blogs");
    expect(rec?.aiSummary).toBe("");

    const body = md.split("---").slice(2).join("---");
    const rawSection = body.match(/## Raw Content\s*\n([\s\S]*?)(?=\n## |\s*$)/)?.[1];
    expect(rawSection?.trim()).toBe("Second body.");
  });
});
