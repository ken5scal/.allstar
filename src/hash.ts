import { createHash } from "node:crypto";

function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** RSS: normalized title + summary/content + canonical URL */
export function rssContentHash(parts: {
  title: string;
  body: string;
  canonicalUrl: string;
}): string {
  const h = createHash("sha256");
  h.update(
    normalizeText(parts.title) +
      "\n" +
      normalizeText(parts.body) +
      "\n" +
      normalizeText(parts.canonicalUrl),
  );
  return `sha256:${h.digest("hex")}`;
}

/** X: normalized text + expanded URLs joined + author id */
export function xContentHash(parts: {
  text: string;
  urls: string[];
  authorId: string;
}): string {
  const h = createHash("sha256");
  h.update(
    normalizeText(parts.text) +
      "\n" +
      parts.urls.map((u) => normalizeText(u)).join("|") +
      "\n" +
      normalizeText(parts.authorId),
  );
  return `sha256:${h.digest("hex")}`;
}
