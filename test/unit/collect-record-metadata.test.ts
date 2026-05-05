import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigFile, normalizeConfig } from "../../src/config.js";
import { itemToVaultRecord } from "../../src/jobs/collect.js";
import type { SourceItem } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

describe("itemToVaultRecord metadata", () => {
  it("stores source metadata for frontmatter", () => {
    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, path.join(repo, "test", "fixtures"));

    const item: SourceItem = {
      source: "rss",
      sourceId: "hn",
      source_item_key: "https://example.com/posts/1",
      content_hash: "sha256:test",
      title: "Example Article Title",
      rawText: "raw body",
      publishedAt: "2026-05-05T00:00:00.000Z",
      canonicalUrl: "https://example.com/posts/1",
    };

    const cap = new Date("2026-05-05T06:30:00.000Z");
    const rec = itemToVaultRecord(item, "tick-1", "job-1", cfg, cap);

    expect(rec.source_id).toBe("hn");
    expect(rec.source).toBe("https://example.com/posts/1");
    expect(rec.record_kind).toBe("obsflow-record");
    expect(rec.source_group).toBe("rss");
    expect(rec.captured_at).toBe(cap.toISOString());
    expect(rec.created_at).toBe(cap.toISOString());
    expect(rec.published_at).toBe("2026-05-05T00:00:00.000Z");
  });
});
