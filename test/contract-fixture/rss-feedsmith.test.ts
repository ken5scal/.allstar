import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sourceItemsFromFeedXml } from "../../src/adapters/feedsmith.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("feedsmith fixtures", () => {
  it("parses sample rss xml", () => {
    const xml = readFileSync(path.join(here, "../fixtures/rss/sample.xml"), "utf8");
    const items = sourceItemsFromFeedXml(xml, "sample", "rss");
    expect(items.length).toBe(2);
    expect(items[0].source_item_key).toContain("item-1");
  });
});
