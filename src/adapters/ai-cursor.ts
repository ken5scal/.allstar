import { Agent } from "@cursor/sdk";

import { parseAndNormalizeAiSummaryJson } from "../ai-summary-result.js";
import { loadTagMasterFile, tagMasterSet } from "../tag-master.js";
import type { AiSummaryResult, VaultRecord } from "../types.js";
import type { AiAdapter } from "./interfaces.js";

const DEFAULT_MODEL_ID = "composer-2";
const MAX_RAW_CHARS = 120_000;

function buildSummarizePrompt(record: VaultRecord, tagBulletLines: string): string {
  const meta = [
    `source_type: ${record.source_type}`,
    `source: ${record.source}`,
    ...(record.source_id ? [`source_id: ${record.source_id}`] : []),
    `source_group: ${record.source_group}`,
    ...(record.origin ? [`origin: ${record.origin}`] : []),
    ...(record.category ? [`existing_category: ${record.category}`] : []),
    ...(record.tags.length ? [`existing_tags: ${JSON.stringify(record.tags)}`] : []),
    ...(record.summary.trim() ? [`frontmatter_summary_hint: ${record.summary.trim().slice(0, 500)}`] : []),
    ...(record.published_at ? [`published_at: ${record.published_at}`] : []),
    `captured_at: ${record.captured_at}`,
  ].join("\n");

  let raw = record.rawContent.trim();
  let truncated = "";
  if (raw.length > MAX_RAW_CHARS) {
    raw = raw.slice(0, MAX_RAW_CHARS);
    truncated = "\n\n[raw content truncated for processing]";
  }

  return [
    "You classify and summarize vault capture records. Follow the steps exactly and respond with JSON only, no markdown, no commentary.",
    "All human-readable summary fields MUST be written in Japanese.",
    "",
    "Step 1: Read the raw content below and write a clear Japanese summary (`summary`). Use concise Japanese markdown bullet lines in `summary` if helpful.",
    'Step 2: Using ONLY the summary you wrote in Step 1 (not the raw content), plus the record metadata, pick tags from the allowed tag master list. Tags MUST be copied exactly as shown (character-for-character). If nothing fits, return an empty array.',
    "Step 3: Optionally set `category` as a short string when it helps organization; omit or null if unsure.",
    "",
    "Rules:",
    "- Output a single JSON object with keys: summary, short_summary, tags, category.",
    "- `summary` is required, non-empty, and Japanese.",
    '- `short_summary` is one short Japanese line (optional).',
    "- `tags` is an array of strings from the master list only; no invented tags; max number of tags will be enforced downstream but pick the smallest useful set.",
    "- `category` is optional string or null.",
    "",
    "Allowed tags (master):",
    tagBulletLines,
    "",
    "Record metadata:",
    meta,
    "",
    "Raw content:",
    raw + truncated,
  ].join("\n");
}

export function createAiCursorAdapter(opts: {
  apiKey: string;
  model?: string;
  tagMasterPath: string;
  maxTags: number;
}): AiAdapter {
  const masterFile = loadTagMasterFile(opts.tagMasterPath);
  const master = tagMasterSet(masterFile);
  const tagBulletLines = masterFile.tags.map((t) => `- ${JSON.stringify(t)}`).join("\n");
  const modelId = opts.model?.trim() || DEFAULT_MODEL_ID;

  return {
    async summarize(record: VaultRecord): Promise<AiSummaryResult> {
      const prompt = buildSummarizePrompt(record, tagBulletLines);
      let result;
      try {
        result = await Agent.prompt(prompt, {
          apiKey: opts.apiKey,
          model: { id: modelId },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Cursor AI request failed: ${msg}`, { cause: e });
      }
      if (result.status === "error" || result.status === "cancelled") {
        throw new Error(
          `Cursor AI run finished with status=${result.status} run=${result.id}`,
        );
      }
      const text = result.result?.trim();
      if (!text) {
        throw new Error("Cursor AI returned empty result text");
      }
      return parseAndNormalizeAiSummaryJson(text, master, opts.maxTags);
    },
  };
}
