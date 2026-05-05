import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeConfig, loadConfigFile } from "../../src/config.js";
import { recordNoteRelPath } from "../../src/paths.js";
import type { ObsflowConfig, SourceItem } from "../../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

function minimalCfg(overrides?: Partial<ObsflowConfig["records"]>): ObsflowConfig {
  const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
  const cfg = normalizeConfig(raw, path.join(repo, "test", "fixtures"));
  if (overrides) {
    cfg.records = { ...cfg.records, ...overrides };
  }
  return cfg;
}

describe("recordNoteRelPath", () => {
  it("builds src/rss/{id}/yyyy/mm/dd/{slug}.md from captured_at", () => {
    const cfg = minimalCfg();
    const item: SourceItem = {
      source: "rss",
      sourceId: "hn",
      source_item_key: "https://example.com/p/1",
      content_hash: "h1",
      title: "Hello RSS",
      rawText: "x",
      canonicalUrl: "https://example.com/p/1",
    };
    const cap = new Date(Date.UTC(2026, 4, 5, 12, 0, 0));
    const rel = recordNoteRelPath(cfg, item, cap);
    expect(rel).toBe(path.posix.join("src", "rss", "hn", "2026", "05", "05", "hello-rss.md"));
  });

  it("uses published_at for folders when date_source is published_at_or_captured_at", () => {
    const cfg = minimalCfg({ date_source: "published_at_or_captured_at" });
    const item: SourceItem = {
      source: "rss",
      sourceId: "hn",
      source_item_key: "k",
      content_hash: "h1",
      title: "T",
      rawText: "x",
      publishedAt: "2024-01-02T00:00:00.000Z",
    };
    const rel = recordNoteRelPath(cfg, item, new Date(Date.UTC(2026, 5, 1)));
    expect(rel).toContain(path.posix.join("2024", "01", "02"));
  });

  it("rejects path-breaking filename_template", () => {
    const cfg = minimalCfg({ filename_template: "{slug}/x.md" });
    const item: SourceItem = {
      source: "rss",
      sourceId: "a",
      source_item_key: "k",
      content_hash: "h",
      title: "T",
      rawText: "",
    };
    expect(() =>
      recordNoteRelPath(cfg, item, new Date(Date.UTC(2026, 0, 1))),
    ).toThrow(/path separators/);
  });
});
