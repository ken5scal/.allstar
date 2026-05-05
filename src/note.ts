import YAML from "yaml";

import type { VaultRecord } from "./types.js";
import { stringFromUnknown } from "./string-utils.js";

export const RAW_SECTION = "## Raw Content";
export const AI_SECTION = "## AI Summary";

export function renderVaultNote(r: VaultRecord): string {
  const fm: Record<string, unknown> = {
    schema_version: r.schema_version,
    source_type: r.source_type,
    source: r.source,
    status: r.status,
    tags: r.tags,
    attachments: r.attachments,
    summary: r.summary,
    created_at: r.created_at,
    updated_at: r.updated_at,
    tick_run_id: r.tick_run_id,
    job_run_id: r.job_run_id,
  };
  if (r.source_id !== undefined) fm.source_id = r.source_id;
  if (r.title !== undefined) fm.title = r.title;
  if (r.category !== undefined) fm.category = r.category;
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
  return {
    schema_version: Number(fm.schema_version ?? 1),
    source_type: (fm.source_type ?? fm.source) as VaultRecord["source_type"],
    source: stringFromUnknown(fm.source),
    source_id: opt(fm.source_id),
    title: opt(fm.title),
    status: fm.status as VaultRecord["status"],
    category:
      fm.category !== undefined ? stringFromUnknown(fm.category) : undefined,
    tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
    attachments: Array.isArray(fm.attachments)
      ? (fm.attachments as VaultRecord["attachments"])
      : [],
    summary: stringFromUnknown(fm.summary),
    created_at: stringFromUnknown(fm.created_at),
    updated_at: stringFromUnknown(fm.updated_at),
    tick_run_id: stringFromUnknown(fm.tick_run_id),
    job_run_id: stringFromUnknown(fm.job_run_id),
    rawContent: rawM ? rawM[1].trim() : "",
    aiSummary: aiM ? aiM[1].trim() : "",
  };
}
