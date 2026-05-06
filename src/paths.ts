import fs from "node:fs";
import path from "node:path";

import type { ObsflowConfig, ObsidianSourceKind, RecordsConfig, SourceItem } from "./types.js";

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

export function sourceFamily(
  kind: ObsidianSourceKind,
): "rss" | "x" | "web" | "youtube" {
  switch (kind) {
    case "rss":
      return "rss";
    case "x-search":
    case "x-list":
    case "x-bookmarks":
      return "x";
    case "manual-web":
      return "web";
    case "manual-youtube":
      return "youtube";
  }
}

const TEMPLATE_VARS = new Set([
  "source_group",
  "source_id",
  "yyyy",
  "mm",
  "dd",
  "slug",
  "source_type",
  "origin",
]);

function assertKnownPlaceholders(template: string, label: string): void {
  for (const m of template.matchAll(/\{([a-z_]+)\}/g)) {
    const name = m[1];
    if (!TEMPLATE_VARS.has(name)) {
      throw new Error(`${label}: unknown placeholder {${name}}`);
    }
  }
}

function applyTemplate(template: string, vars: Record<string, string>, label: string): string {
  assertKnownPlaceholders(template, label);
  return template.replace(/\{([a-z_]+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`${label}: missing value for {${k}}`);
    return v;
  });
}

/** Safe single path segment for vault-relative directories and filenames. */
export function safePathSegment(s: string, maxLen = 120): string {
  const cleaned = s.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  const sliced = cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen);
  return sliced.length ? sliced : "_";
}

/** URL-safe slug for record filenames. */
export function slugForRecordNote(item: SourceItem, maxLen = 120): string {
  const raw = (item.title || item.source_item_key).toLowerCase();
  let s = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s.length) s = "item";
  return s.length <= maxLen ? s : s.slice(0, maxLen);
}

/** Human-readable filename stem from item title (for RSS articles). */
function titleStemForRecordNote(item: SourceItem, maxLen = 120): string {
  const rawTitle = item.title.trim();
  if (!rawTitle.length) {
    return slugForRecordNote(item, maxLen);
  }
  const safe = safePathSegment(rawTitle, maxLen);
  return safe.length ? safe : "item";
}

function pathDateForItem(
  cfg: RecordsConfig,
  item: SourceItem,
  capturedAt: Date,
): Date {
  if (cfg.date_source === "captured_at") return capturedAt;
  if (item.publishedAt) {
    const d = new Date(item.publishedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return capturedAt;
}

function originSegment(item: SourceItem): string {
  if (item.canonicalUrl) {
    try {
      return new URL(item.canonicalUrl).hostname;
    } catch {
      /* ignore */
    }
  }
  return item.sourceId;
}

/** Safe file base name (no path separators). */
export function safeNoteBasename(sourceItemKey: string, maxLen = 120): string {
  const cleaned = sourceItemKey.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, " ");
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen);
}

function rootSegments(rootFolder: string): string[] {
  const norm = path.normalize(rootFolder.trim());
  const parts = norm.split(/[/\\]+/).filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error("records.root_folder must not contain .. segments");
  }
  return parts.map((p) => safePathSegment(p, 200));
}

/**
 * Vault-relative POSIX path for a new Markdown record (under `cfg.records`).
 */
export function recordNoteRelPath(
  cfg: ObsflowConfig,
  item: SourceItem,
  capturedAt: Date,
): string {
  const r = cfg.records;
  const family = sourceFamily(item.source);
  const sourceGroupRaw = r.source_groups[family];
  if (sourceGroupRaw === undefined) {
    throw new Error(
      `records.source_groups["${family}"] is not defined (required for source_type ${item.source})`,
    );
  }
  const pathD = pathDateForItem(r, item, capturedAt);
  const yyyy = String(pathD.getUTCFullYear());
  const mm = String(pathD.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(pathD.getUTCDate()).padStart(2, "0");
  const slug =
    item.source === "rss" ? titleStemForRecordNote(item) : slugForRecordNote(item);
  const vars: Record<string, string> = {
    source_group: safePathSegment(sourceGroupRaw),
    source_id: safePathSegment(item.sourceId),
    yyyy,
    mm,
    dd,
    slug: safePathSegment(slug, 120),
    source_type: safePathSegment(item.source, 64),
    origin: safePathSegment(originSegment(item), 200),
  };

  const dirPart = applyTemplate(r.path_template, vars, "records.path_template");
  const filePart = applyTemplate(r.filename_template, vars, "records.filename_template");
  if (filePart.includes("/") || filePart.includes("\\")) {
    throw new Error("records.filename_template must not contain path separators");
  }

  const dirSegs = dirPart
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== ".");
  if (dirSegs.some((s) => s === "..")) {
    throw new Error("records.path_template resolves to invalid segment ..");
  }

  const parts = [...rootSegments(r.root_folder), ...dirSegs, filePart];
  if (parts.some((s) => s === "..")) {
    throw new Error("invalid record path");
  }
  return path.posix.join(...parts);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
