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
            <p>Linked story body line 1 with <strong>bold</strong> and <em>italic</em>.</p>
            <p><del>Removed</del> <u>Underline</u> <mark>Marked</mark>.</p>
            <ul>
              <li>Bullet one</li>
              <li><input type="checkbox" checked />Done task</li>
            </ul>
            <p>Reference: <a href="https://example.com/docs">docs</a>.</p>
            <p><img src="https://example.com/image.png" alt="Hero image" /></p>
            <pre><code class="language-ts">const value = 1;\nconsole.log(value);</code></pre>
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
    expect(hydrated.rawText).toContain("# Hello World");
    expect(hydrated.rawText).toContain("Linked story body line 1 with **bold** and *italic*.");
    expect(hydrated.rawText).toContain("~~Removed~~ <u>Underline</u> <mark>Marked</mark>.");
    expect(hydrated.rawText).toContain("- Bullet one");
    expect(hydrated.rawText).toContain("- [x] Done task");
    expect(hydrated.rawText).toContain("[docs](https://example.com/docs)");
    expect(hydrated.rawText).toContain("![Hero image](https://example.com/image.png)");
    expect(hydrated.rawText).toContain("```ts");
    expect(hydrated.rawText).toContain("const value = 1;");
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

  it("removes share and audio boilerplate from article chrome", async () => {
    const item = {
      source: "rss" as const,
      sourceId: "sample",
      source_item_key: "item-2",
      content_hash: "sha256:old-2",
      title: "Gemma Article",
      rawText: "Fallback summary",
      canonicalUrl: "https://example.com/articles/gemma",
    };
    const noisyHtml = `<!doctype html>
      <html>
        <body>
          <article>
            <nav aria-label="Breadcrumb">Breadcrumb / Innovation / AI</nav>
            <div class="share-toolbar">Share <a href="https://x.com/">x.com</a> Copy link</div>
            <section class="audio-player">
              <p>Your browser does not support the audio element.</p>
              <p>Listen to article</p>
              <p>[[duration]] minutes</p>
              <p>Voice</p>
              <p>Speed</p>
            </section>
            <h1>Accelerating Gemma 4</h1>
            <p>Main body paragraph with details.</p>
            <p>Another paragraph for developers.</p>
          </article>
        </body>
      </html>`;
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(noisyHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const hydrated = await hydrateRssItemWithLinkedContent(item, { timeoutMs: 3000 });
    expect(hydrated.rawText).toContain("# Accelerating Gemma 4");
    expect(hydrated.rawText).toContain("Main body paragraph with details.");
    expect(hydrated.rawText).toContain("Another paragraph for developers.");
    expect(hydrated.rawText).not.toContain("Breadcrumb");
    expect(hydrated.rawText).not.toContain("Share");
    expect(hydrated.rawText).not.toContain("Copy link");
    expect(hydrated.rawText).not.toContain("Listen to article");
    expect(hydrated.rawText).not.toContain("Your browser does not support the audio element.");
    expect(hydrated.rawText).not.toContain("[[duration]] minutes");
    expect(hydrated.rawText).not.toContain("Voice");
    expect(hydrated.rawText).not.toContain("Speed");
  });
});
