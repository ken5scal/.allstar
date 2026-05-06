import { afterEach, describe, expect, it, vi } from "vitest";

import { rssContentHash } from "../../src/hash.js";
import {
  fetchRssItems,
  hydrateRssItemWithLinkedContent,
} from "../../src/adapters/feedsmith.js";

const SAMPLE_FEED_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Sample Feed</title>
    <item>
      <title>Hello World</title>
      <link>https://example.com/articles/hello-world</link>
      <guid>item-1</guid>
      <description>Short summary from feed.</description>
      <pubDate>Tue, 06 May 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe("rss linked article content", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("extracts article text and refreshes content hash", async () => {
    const linkedHtml = `<!doctype html>
      <html>
        <body>
          <header>navigation</header>
          <article>
            <h1>Hello World</h1>
            <p>Linked story body line 1.</p>
            <p>Linked story body line 2 &amp; details.</p>
          </article>
        </body>
      </html>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(SAMPLE_FEED_XML, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(linkedHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    vi.stubGlobal("fetch", mockFetch);

    const items = await fetchRssItems("https://example.com/feed.xml", "sample", "rss");
    expect(items).toHaveLength(1);

    const hydrated = await hydrateRssItemWithLinkedContent(items[0], { timeoutMs: 3000 });
    expect(hydrated.rawText).toContain("Linked story body line 1.");
    expect(hydrated.rawText).toContain("Linked story body line 2 & details.");
    expect(hydrated.rawText).not.toContain("navigation");
    expect(hydrated.content_hash).toBe(
      rssContentHash({
        title: "Hello World",
        body: hydrated.rawText,
        canonicalUrl: "https://example.com/articles/hello-world",
      }),
    );
  });

  it("keeps feed summary when linked article fetch fails", async () => {
    const item = {
      source: "rss" as const,
      sourceId: "sample",
      source_item_key: "item-1",
      content_hash: "sha256:old",
      title: "Hello World",
      rawText: "Short summary from feed.",
      canonicalUrl: "https://example.com/articles/hello-world",
    };
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("bad", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const hydrated = await hydrateRssItemWithLinkedContent(item, { timeoutMs: 3000 });
    expect(hydrated).toEqual(item);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
