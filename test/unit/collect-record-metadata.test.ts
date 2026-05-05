import { describe, expect, it } from "vitest";

import { itemToVaultRecord } from "../../src/jobs/collect.js";
import type { SourceItem } from "../../src/types.js";

describe("itemToVaultRecord metadata", () => {
  it("stores title and source metadata for frontmatter", () => {
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

    const rec = itemToVaultRecord(item, "tick-1", "job-1");

    expect(rec.title).toBe("Example Article Title");
    expect(rec.source_id).toBe("hn");
    expect(rec.source).toBe("https://example.com/posts/1");
  });
});
