import { describe, expect, it } from "vitest";

import { selectRssBootstrapItems } from "../../src/jobs/collect.js";
import type { SourceItem } from "../../src/types.js";

function makeItem(
  source_item_key: string,
  publishedAt?: string,
): SourceItem {
  return {
    source: "rss",
    sourceId: "sample",
    source_item_key,
    content_hash: `hash-${source_item_key}`,
    title: source_item_key,
    rawText: `${source_item_key} body`,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

describe("selectRssBootstrapItems", () => {
  it("keeps the latest N items by publishedAt on first-run bootstrap", () => {
    const result = selectRssBootstrapItems({
      items: [
        makeItem("oldest", "2026-05-01T00:00:00.000Z"),
        makeItem("newest", "2026-05-04T00:00:00.000Z"),
        makeItem("middle", "2026-05-03T00:00:00.000Z"),
      ],
      maxInitialItems: 2,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(result.selected.map((item) => item.source_item_key)).toEqual([
      "newest",
      "middle",
    ]);
    expect(result.excluded.map((item) => item.source_item_key)).toEqual([
      "oldest",
    ]);
    expect(result.filteredByAge).toBe(0);
    expect(result.filteredByLimit).toBe(1);
  });

  it("drops old and undated items when published_within_days is set", () => {
    const result = selectRssBootstrapItems({
      items: [
        makeItem("recent", "2026-05-09T00:00:00.000Z"),
        makeItem("old", "2026-04-20T00:00:00.000Z"),
        makeItem("undated"),
        makeItem("invalid-date", "not-a-date"),
      ],
      publishedWithinDays: 7,
      now: new Date("2026-05-10T00:00:00.000Z"),
    });

    expect(result.selected.map((item) => item.source_item_key)).toEqual([
      "recent",
    ]);
    expect(result.excluded.map((item) => item.source_item_key)).toEqual([
      "old",
      "undated",
      "invalid-date",
    ]);
    expect(result.filteredByAge).toBe(3);
    expect(result.filteredByLimit).toBe(0);
  });

  it("applies age filtering before latest-N selection", () => {
    const result = selectRssBootstrapItems({
      items: [
        makeItem("outside-window", "2026-04-25T00:00:00.000Z"),
        makeItem("recent-a", "2026-05-08T00:00:00.000Z"),
        makeItem("recent-b", "2026-05-09T00:00:00.000Z"),
        makeItem("recent-c", "2026-05-10T00:00:00.000Z"),
      ],
      maxInitialItems: 2,
      publishedWithinDays: 7,
      now: new Date("2026-05-10T12:00:00.000Z"),
    });

    expect(result.selected.map((item) => item.source_item_key)).toEqual([
      "recent-c",
      "recent-b",
    ]);
    expect(result.excluded.map((item) => item.source_item_key)).toEqual([
      "outside-window",
      "recent-a",
    ]);
    expect(result.filteredByAge).toBe(1);
    expect(result.filteredByLimit).toBe(1);
  });
});
