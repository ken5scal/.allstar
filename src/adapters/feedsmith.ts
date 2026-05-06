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

function readHtmlAttribute(tag: string, attrName: string): string | undefined {
  const attr = tag.match(
    new RegExp(
      `${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`,
      "i",
    ),
  );
  if (!attr) return undefined;
  return decodeHtmlEntities((attr[1] ?? attr[2] ?? attr[3] ?? "").trim());
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInlineText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

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

function inlineHtmlToMarkdown(html: string): string {
  let out = html;

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = readHtmlAttribute(tag, "src");
    if (!src) return "";
    const alt = (readHtmlAttribute(tag, "alt") ?? "").replace(/]/g, "\\]");
    return `![${alt}](${src})`;
  });

  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\s*\/\s*a>/gi, (_m, attrs: string, inner: string) => {
    const href = readHtmlAttribute(attrs, "href");
    const label = normalizeInlineText(inlineHtmlToMarkdown(inner));
    if (!href) return label;
    return `[${label || href}](${href})`;
  });

  out = out.replace(
    /<(strong|b)\b[^>]*>([\s\S]*?)<\s*\/\s*\1>/gi,
    (_m, _tag: string, inner: string) => `**${inlineHtmlToMarkdown(inner)}**`,
  );
  out = out.replace(
    /<(em|i)\b[^>]*>([\s\S]*?)<\s*\/\s*\1>/gi,
    (_m, _tag: string, inner: string) => `*${inlineHtmlToMarkdown(inner)}*`,
  );
  out = out.replace(
    /<(s|strike|del)\b[^>]*>([\s\S]*?)<\s*\/\s*\1>/gi,
    (_m, _tag: string, inner: string) => `~~${inlineHtmlToMarkdown(inner)}~~`,
  );
  out = out.replace(
    /<u\b[^>]*>([\s\S]*?)<\s*\/\s*u>/gi,
    (_m, inner: string) => `<u>${inlineHtmlToMarkdown(inner)}</u>`,
  );
  out = out.replace(
    /<mark\b[^>]*>([\s\S]*?)<\s*\/\s*mark>/gi,
    (_m, inner: string) => `<mark>${inlineHtmlToMarkdown(inner)}</mark>`,
  );
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\s*\/\s*code>/gi, (_m, inner: string) => {
    const code = decodeHtmlEntities(
      inner.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
    ).trim();
    return code.length > 0 ? `\`${code.replace(/`/g, "\\`")}\`` : "";
  });

  out = out
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|section|article|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(?:p|div|section|article|li|h[1-6])\b[^>]*>/gi, " ")
    .replace(/<(?!\/?(?:u|mark)\b)[^>]+>/gi, " ");

  return normalizeInlineText(decodeHtmlEntities(out));
}

function stripNoisyHtmlBlocks(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\s*\/\s*script\b[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\s*\/\s*style\b[^>]*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\s*\/\s*noscript\b[^>]*>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\s*\/\s*svg\b[^>]*>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\s*\/\s*template\b[^>]*>/gi, " ");
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

function codeBlockFromPre(preHtml: string): string {
  const codeMatch = preHtml.match(/<code\b([^>]*)>([\s\S]*?)<\s*\/\s*code>/i);
  const attrs = codeMatch?.[1] ?? "";
  const inner = codeMatch?.[2] ?? preHtml;
  const cls = readHtmlAttribute(attrs, "class") ?? "";
  const langMatch = cls.match(/(?:language|lang)-([a-z0-9_-]+)/i);
  const lang = langMatch?.[1] ?? "";
  const code = decodeHtmlEntities(
    inner.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
  )
    .replace(/\r/g, "")
    .trimEnd();
  if (!code.length) return "";
  return `\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
}

function tableHtmlToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\s*\/\s*tr>/gi)];
  if (!rows.length) return "";
  const markdownRows = rows
    .map((row) => {
      const cells = [
        ...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\s*\/\s*t[hd]>/gi),
      ].map((cell) => inlineHtmlToMarkdown(cell[1]).replace(/\|/g, "\\|").trim());
      return cells;
    })
    .filter((cells) => cells.length > 0);
  if (!markdownRows.length) return "";
  const header = markdownRows[0];
  const divider = header.map(() => "---");
  const body = markdownRows.slice(1);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

function listHtmlToMarkdown(tag: "ul" | "ol", listHtml: string): string {
  const liMatches = [...listHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\s*\/\s*li>/gi)];
  if (!liMatches.length) return "";
  const lines = liMatches.map((li, idx) => {
    const rawItem = li[1];
    const hasCheckbox = /<input\b[^>]*type\s*=\s*["']?checkbox["']?[^>]*>/i.test(rawItem);
    const checked = /<input\b[^>]*type\s*=\s*["']?checkbox["']?[^>]*checked\b[^>]*>/i.test(
      rawItem,
    );
    const withoutCheckbox = rawItem.replace(
      /<input\b[^>]*type\s*=\s*["']?checkbox["']?[^>]*>/gi,
      "",
    );
    const body = blockHtmlToMarkdown(withoutCheckbox);
    const itemBody = body.length ? body : inlineHtmlToMarkdown(withoutCheckbox);
    const bulletPrefix = tag === "ol" ? `${idx + 1}.` : "-";
    const prefix = hasCheckbox ? `${bulletPrefix} [${checked ? "x" : " "}]` : bulletPrefix;
    const bodyLines = itemBody.split("\n");
    const first = `${prefix} ${bodyLines[0] ?? ""}`.trimEnd();
    if (bodyLines.length === 1) return first;
    const rest = bodyLines
      .slice(1)
      .map((line) => (line.length ? `   ${line}` : ""))
      .join("\n");
    return `${first}\n${rest}`;
  });
  return `\n${lines.join("\n")}\n`;
}

function blockquoteToMarkdown(quoteHtml: string): string {
  const inner = blockHtmlToMarkdown(quoteHtml);
  if (!inner.length) return "";
  const prefixed = inner
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n");
  return `\n\n${prefixed}\n\n`;
}

function detailsToMarkdown(detailsHtml: string): string {
  const summaryMatch = detailsHtml.match(/<summary\b[^>]*>([\s\S]*?)<\s*\/\s*summary>/i);
  const summaryText = summaryMatch ? inlineHtmlToMarkdown(summaryMatch[1]) : "Details";
  const content = detailsHtml.replace(/<summary\b[^>]*>[\s\S]*?<\s*\/\s*summary>/i, "");
  const body = blockHtmlToMarkdown(content);
  const quotedBody = body
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n");
  return `\n\n> [!note]- ${summaryText}\n${quotedBody}\n\n`;
}

function blockHtmlToMarkdown(html: string): string {
  let out = html;

  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\s*\/\s*pre>/gi, (_m, inner: string) =>
    codeBlockFromPre(inner),
  );
  out = out.replace(/<table\b[^>]*>([\s\S]*?)<\s*\/\s*table>/gi, (_m, inner: string) =>
    tableHtmlToMarkdown(inner),
  );
  out = out.replace(
    /<blockquote\b[^>]*>([\s\S]*?)<\s*\/\s*blockquote>/gi,
    (_m, inner: string) => blockquoteToMarkdown(inner),
  );
  out = out.replace(/<details\b[^>]*>([\s\S]*?)<\s*\/\s*details>/gi, (_m, inner: string) =>
    detailsToMarkdown(inner),
  );
  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\s*\/\s*h\1>/gi, (_m, level: string, inner: string) => {
    const heading = inlineHtmlToMarkdown(inner);
    return heading.length > 0 ? `\n\n${"#".repeat(Number(level))} ${heading}\n\n` : "";
  });

  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\s*\/\s*\1>/gi, (_m, tag: string, inner: string) =>
      listHtmlToMarkdown(tag === "ol" ? "ol" : "ul", inner),
    );
  }

  out = out
    .replace(/<\s*hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|section|article|main|header|footer|aside)\s*>/gi, "\n\n")
    .replace(/<\s*(?:p|div|section|article|main|header|footer|aside)\b[^>]*>/gi, "");

  out = inlineHtmlToMarkdown(out);
  return normalizeMarkdown(out);
}

function extractArticleMarkdownFromHtml(html: string): string {
  const sanitized = stripNoisyHtmlBlocks(html);
  const articleHtml = longestMatch(
    sanitized,
    /<article\b[^>]*>([\s\S]*?)<\s*\/\s*article\b[^>]*>/gi,
  );
  if (articleHtml.trim().length > 0) {
    return blockHtmlToMarkdown(articleHtml);
  }
  const mainHtml = longestMatch(
    sanitized,
    /<main\b[^>]*>([\s\S]*?)<\s*\/\s*main\b[^>]*>/gi,
  );
  if (mainHtml.trim().length > 0) {
    return blockHtmlToMarkdown(mainHtml);
  }
  const body = sanitized.match(/<body\b[^>]*>([\s\S]*?)<\s*\/\s*body\b[^>]*>/i);
  if (body?.[1]) {
    return blockHtmlToMarkdown(body[1]);
  }
  return blockHtmlToMarkdown(sanitized);
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
    const articleText = extractArticleMarkdownFromHtml(html);
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
