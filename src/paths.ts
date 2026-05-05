import fs from "node:fs";
import path from "node:path";

import type { ObsidianSourceKind } from "./types.js";

export function vaultSubdirForSource(kind: ObsidianSourceKind): string {
  switch (kind) {
    case "rss":
      return path.join("Sources", "RSS");
    case "x-search":
      return path.join("Sources", "X", "Search");
    case "x-list":
      return path.join("Sources", "X", "Lists");
    case "x-bookmarks":
      return path.join("Sources", "X", "Bookmarks");
    default:
      return path.join("Sources", "Other");
  }
}

/** Safe file base name (no path separators). */
export function safeNoteBasename(sourceItemKey: string, maxLen = 120): string {
  const cleaned = sourceItemKey.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, " ");
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
