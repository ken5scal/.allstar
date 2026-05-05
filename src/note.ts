import YAML from "yaml";

import type { VaultRecord } from "./types.js";
import { OBSFLOW_RECORD_KIND } from "./types.js";
import { stringFromUnknown } from "./string-utils.js";

export const RAW_SECTION = "## Raw Content";
export const AI_SECTION = "## AI Summary";

export function renderVaultNote(r: VaultRecord): string {
  const fm: Record<string, unknown> = {
    schema_version: r.schema_version,
    record_kind: r.record_kind,
    base_ids: r.base_ids,
    source_type: r.source_type,
    source: r.source,
    source_group: r.source_group,
    status: r.status,
    tags: r.tags,
    attachments: r.attachments,
    summary: r.summary,
    captured_at: r.captured_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    tick_run_id: r.tick_run_id,
    job_run_id: r.job_run_id,
  };
  if (r.source_id !== undefined) fm.source_id = r.source_id;
  if (r.origin !== undefined) fm.origin = r.origin;
  if (r.category !== undefined) fm.category = r.category;
  if (r.published_at !== undefined) fm.published_at = r.published_at;
  const body = [
    "",
    RAW_SECTION,
    "",
    r.rawContent.trim(),
    "",
    AI_SECTION,
    "",
    r.aiSummary.trim(),
    "",
  ].join("\n");
  return `---\n${YAML.stringify(fm).trim()}\n---${body}`;
}

/** Replace only the `## AI Summary` section; preserve other sections. */
export function replaceAiSummarySection(markdown: string, newAiSummary: string): string {
  const marker = `\n${AI_SECTION}\n`;
  const startIdx = markdown.indexOf(marker);
  if (startIdx === -1) {
    return `${markdown.trimEnd()}\n\n${AI_SECTION}\n\n${newAiSummary.trim()}\n`;
  }
  const afterHeading = startIdx + marker.length;
  const rest = markdown.slice(afterHeading);
  const nextH2 = rest.search(/\n## /);
  const end =
    nextH2 === -1 ? markdown.length : startIdx + marker.length + nextH2;
  const before = markdown.slice(0, startIdx + marker.length);
  return `${before}\n${newAiSummary.trim()}\n${markdown.slice(end)}`;
}

function defaultSourceGroupForKind(kind: VaultRecord["source_type"]): string {
  switch (kind) {
    case "rss":
      return "rss";
    case "x-search":
    case "x-list":
    case "x-bookmarks":
      return "sns";
    case "manual-web":
      return "web";
    case "manual-youtube":
      return "youtube";
  }
}

export function parseVaultNote(markdown: string): VaultRecord | null {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!m) return null;
  const fm = YAML.parse(m[1]) as Record<string, unknown>;
  const body = m[2];
  const rawRe = /## Raw Content\s*\n([\s\S]*?)(?=\n## |\s*$)/;
  const aiRe = /## AI Summary\s*\n([\s\S]*?)(?=\n## |\s*$)/;
  const rawM = body.match(rawRe);
  const aiM = body.match(aiRe);
  const opt = (v: unknown): string | undefined => {
    const s = stringFromUnknown(v);
    return s.length > 0 ? s : undefined;
  };
  const createdAt = stringFromUnknown(fm.created_at);
  const capturedAtRaw = stringFromUnknown(fm.captured_at);
  const captured_at = capturedAtRaw.length ? capturedAtRaw : createdAt;
  const recKind = stringFromUnknown(fm.record_kind);
  const baseIdsRaw = fm.base_ids;
  const base_ids = Array.isArray(baseIdsRaw) ? (baseIdsRaw as string[]).map(String) : [];
  const kind = (fm.source_type ?? fm.source) as VaultRecord["source_type"];
  const sg = stringFromUnknown(fm.source_group);
  return {
    schema_version: Number(fm.schema_version ?? 1),
    record_kind: recKind.length ? recKind : OBSFLOW_RECORD_KIND,
    base_ids,
    source_type: kind,
    source: stringFromUnknown(fm.source),
    source_id: opt(fm.source_id),
    source_group: sg.length ? sg : defaultSourceGroupForKind(kind),
    origin: opt(fm.origin),
    status: fm.status as VaultRecord["status"],
    category:
      fm.category !== undefined ? stringFromUnknown(fm.category) : undefined,
    tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
    attachments: Array.isArray(fm.attachments)
      ? (fm.attachments as VaultRecord["attachments"])
      : [],
    summary: stringFromUnknown(fm.summary),
    published_at: opt(fm.published_at),
    captured_at,
    created_at: createdAt,
    updated_at: stringFromUnknown(fm.updated_at),
    tick_run_id: stringFromUnknown(fm.tick_run_id),
    job_run_id: stringFromUnknown(fm.job_run_id),
    rawContent: rawM ? rawM[1].trim() : "",
    aiSummary: aiM ? aiM[1].trim() : "",
  };
}
