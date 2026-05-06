import type { AiSummaryResult } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strip optional ```json fences and pull a single JSON object from agent text. */
export function extractJsonObjectFromAgentText(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("AI output did not contain a JSON object");
}

/** Filter to master tags, dedupe, preserve order, cap length. */
export function pickTagsFromMaster(
  tags: unknown,
  master: Set<string>,
  maxTags: number,
): string[] {
  if (tags === undefined || tags === null) return [];
  if (!Array.isArray(tags)) throw new Error("AI output tags must be an array");
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const s = t.trim();
    if (!s.length) continue;
    if (!master.has(s)) continue;
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= maxTags) break;
  }
  return out;
}

export function pickCategoryFromMaster(
  category: unknown,
  master: Set<string> | undefined,
): string | undefined {
  if (category === undefined || category === null) return undefined;
  if (typeof category !== "string") {
    throw new Error("AI output category must be a string when set");
  }
  const c = category.trim();
  if (!c.length) return undefined;
  if (master && !master.has(c)) return undefined;
  return c;
}

/**
 * Validate JSON shape from the AI and enforce tag master + max_tags.
 * @throws if summary is empty or tags is not an array (when present).
 */
export function normalizeAiSummaryResult(
  parsed: unknown,
  master: Set<string>,
  maxTags: number,
  categoryMaster?: Set<string>,
): AiSummaryResult {
  if (!isRecord(parsed)) throw new Error("AI output JSON must be an object");
  const summaryRaw = parsed.summary;
  if (typeof summaryRaw !== "string" || !summaryRaw.trim().length) {
    throw new Error("AI output summary must be a non-empty string");
  }
  const summary = summaryRaw.trim();
  let short_summary: string | undefined;
  if (parsed.short_summary !== undefined && parsed.short_summary !== null) {
    if (typeof parsed.short_summary !== "string") {
      throw new Error("AI output short_summary must be a string when set");
    }
    const ss = parsed.short_summary.trim();
    if (ss.length) short_summary = ss;
  }
  const tags = pickTagsFromMaster(parsed.tags, master, maxTags);
  const category = pickCategoryFromMaster(parsed.category, categoryMaster);
  return {
    summary,
    ...(short_summary ? { short_summary } : {}),
    tags,
    ...(category ? { category } : {}),
  };
}

export function parseAndNormalizeAiSummaryJson(
  agentText: string,
  master: Set<string>,
  maxTags: number,
  categoryMaster?: Set<string>,
): AiSummaryResult {
  const jsonText = extractJsonObjectFromAgentText(agentText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`AI output is not valid JSON: ${msg}`, { cause: e });
  }
  return normalizeAiSummaryResult(parsed, master, maxTags, categoryMaster);
}
