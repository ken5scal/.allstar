import { parseFeed } from "feedsmith";

import { rssContentHash } from "../hash.js";
import type { ObsidianSourceKind, SourceItem } from "../types.js";

const DEFAULT_ARTICLE_FETCH_TIMEOUT_MS = 12_000;

function pickText(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function isHttpUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? _m : String.fromCodePoint(code);
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? _m : String.fromCodePoint(code);
    }
    return NAMED_HTML_ENTITIES[entity] ?? _m;
  });
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*\/\s*(?:p|div|li|section|article|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripNoisyHtmlBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ");
}

function longestMatch(html: string, regex: RegExp): string {
  let longest = "";
  const clone = new RegExp(regex.source, regex.flags);
  for (const m of html.matchAll(clone)) {
    const block = m[1] ?? "";
    if (block.length > longest.length) {
      longest = block;
    }
  }
  return longest;
}

function extractArticleTextFromHtml(html: string): string {
  const sanitized = stripNoisyHtmlBlocks(html);
  const articleHtml = longestMatch(sanitized, /<article\b[^>]*>([\s\S]*?)<\/article>/gi);
  if (articleHtml.trim().length > 0) {
    return htmlToPlainText(articleHtml);
  }
  const mainHtml = longestMatch(sanitized, /<main\b[^>]*>([\s\S]*?)<\/main>/gi);
  if (mainHtml.trim().length > 0) {
    return htmlToPlainText(mainHtml);
  }
  const body = sanitized.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1]) {
    return htmlToPlainText(body[1]);
  }
  return htmlToPlainText(sanitized);
}

async function fetchLinkedArticleText(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    const html = await res.text();
    const articleText = extractArticleTextFromHtml(html);
    return articleText.length > 0 ? articleText : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function hydrateRssItemWithLinkedContent(
  item: SourceItem,
  opts?: {
    timeoutMs?: number;
  },
): Promise<SourceItem> {
  if (!isHttpUrl(item.canonicalUrl)) return item;
  const articleText = await fetchLinkedArticleText(
    item.canonicalUrl,
    opts?.timeoutMs ?? DEFAULT_ARTICLE_FETCH_TIMEOUT_MS,
  );
  if (!articleText) return item;
  const canonical = item.canonicalUrl ?? item.source_item_key;
  return {
    ...item,
    rawText: articleText,
    content_hash: rssContentHash({
      title: item.title || "(no title)",
      body: articleText,
      canonicalUrl: canonical,
    }),
  };
}

/** Normalize feedsmith parse result to SourceItem list (RSS / Atom; JSON Feed minimal). */
export function sourceItemsFromFeedXml(
  xml: string,
  sourceId: string,
  sourceKind: ObsidianSourceKind,
): SourceItem[] {
  const parsed = parseFeed(xml);
  if (parsed.format === "rss") {
    const items = parsed.feed.items ?? [];
    return items.map((it, idx) => {
      const guid =
        typeof it.guid === "string"
          ? it.guid
          : it.guid != null && typeof it.guid === "object" && "value" in it.guid
            ? String((it.guid as { value?: string }).value)
            : undefined;
      const link =
        typeof it.link === "string"
          ? it.link
          : it.link && typeof it.link === "object" && "href" in it.link
            ? String((it.link as { href?: string }).href)
            : undefined;
      const title = pickText(it.title);
      const pub =
        it.pubDate !== undefined
          ? String(it.pubDate)
          : it.dc?.date !== undefined
            ? String(it.dc.date)
            : undefined;
      const desc = pickText(it.description, it.content?.encoded);
      const itemKey =
        guid?.trim() || link?.trim() || `${title}\t${pub ?? ""}\t${idx}`;
      const canonical = link?.trim() ?? itemKey;
      const hash = rssContentHash({
        title: title || "(no title)",
        body: desc,
        canonicalUrl: canonical,
      });
      return {
        source: sourceKind,
        sourceId,
        source_item_key: itemKey,
        content_hash: hash,
        title: title || "(no title)",
        rawText: desc,
        publishedAt: pub,
        canonicalUrl: canonical,
      };
    });
  }
  if (parsed.format === "atom") {
    const entries = parsed.feed.entries ?? [];
    return entries.map((ent, idx) => {
      const id = String(ent.id ?? "");
      const title = pickText(ent.title);
      const link =
        ent.links?.find((l) => l.rel === "alternate" || !l.rel)?.href ??
        ent.links?.[0]?.href;
      const contentVal =
        typeof ent.content === "string"
          ? ent.content
          : ent.content != null &&
              typeof ent.content === "object" &&
              "value" in ent.content
            ? String((ent.content as { value?: string }).value)
            : undefined;
      const summary = pickText(ent.summary, contentVal);
      const updated = ent.updated !== undefined ? String(ent.updated) : undefined;
      const itemKey = id.trim() || link?.trim() || `${title}\t${updated ?? ""}\t${idx}`;
      const canonical = link?.trim() ?? itemKey;
      const hash = rssContentHash({
        title: title || "(no title)",
        body: summary,
        canonicalUrl: canonical,
      });
      return {
        source: sourceKind,
        sourceId,
        source_item_key: itemKey,
        content_hash: hash,
        title: title || "(no title)",
        rawText: summary,
        publishedAt: updated,
        canonicalUrl: canonical,
      };
    });
  }
  if (parsed.format === "json") {
    const items = parsed.feed.items ?? [];
    return items.map((it, idx) => {
      const id = String(it.id ?? "");
      const title = pickText(it.title);
      const url = it.url ? String(it.url) : "";
      const text = pickText(it.summary, it.content_text, it.content_html);
      const date = it.date_published ? String(it.date_published) : undefined;
      const itemKey = id.trim() || url.trim() || `${title}\t${date ?? ""}\t${idx}`;
      const canonical = url.trim() || itemKey;
      const hash = rssContentHash({
        title: title || "(no title)",
        body: text,
        canonicalUrl: canonical,
      });
      return {
        source: sourceKind,
        sourceId,
        source_item_key: itemKey,
        content_hash: hash,
        title: title || "(no title)",
        rawText: text,
        publishedAt: date,
        canonicalUrl: canonical,
      };
    });
  }
  return [];
}

export async function fetchRssItems(
  url: string,
  sourceId: string,
  sourceKind: ObsidianSourceKind,
): Promise<SourceItem[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`RSS fetch failed ${res.status} for ${url}`);
  }
  const xml = await res.text();
  return sourceItemsFromFeedXml(xml, sourceId, sourceKind);
}
