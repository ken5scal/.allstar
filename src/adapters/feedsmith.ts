import { parseFeed } from "feedsmith";

import { rssContentHash } from "../hash.js";
import type { ObsidianSourceKind, SourceItem } from "../types.js";

function pickText(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
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
