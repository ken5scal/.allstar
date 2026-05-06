import { describe, expect, it } from "vitest";

import {
  extractJsonObjectFromAgentText,
  normalizeAiSummaryResult,
  parseAndNormalizeAiSummaryJson,
  pickTagsFromMaster,
} from "../../src/ai-summary-result.js";

const master = new Set(["alpha", "beta", "gamma"]);

describe("ai-summary-result", () => {
  it("extractJsonObjectFromAgentText handles fenced json", () => {
    const s = 'Here:\n```json\n{"a":1}\n```\n';
    expect(extractJsonObjectFromAgentText(s)).toBe('{"a":1}');
  });

  it("pickTagsFromMaster keeps master-only, dedupes, honors max", () => {
    expect(
      pickTagsFromMaster(["beta", "nope", "alpha", "beta"], master, 2),
    ).toEqual(["beta", "alpha"]);
  });

  it("normalizeAiSummaryResult rejects empty summary", () => {
    expect(() =>
      normalizeAiSummaryResult({ summary: "  ", tags: [] }, master, 5),
    ).toThrow(/non-empty/);
  });

  it("normalizeAiSummaryResult rejects non-array tags", () => {
    expect(() =>
      normalizeAiSummaryResult({ summary: "ok", tags: "x" }, master, 5),
    ).toThrow(/array/);
  });

  it("parseAndNormalizeAiSummaryJson parses full payload", () => {
    const text = "```json\n" +
      JSON.stringify({
        summary: "- x",
        short_summary: "line",
        tags: ["gamma", "unknown"],
        category: "cat",
      }) +
      "\n```";
    const out = parseAndNormalizeAiSummaryJson(text, master, 5);
    expect(out.summary).toBe("- x");
    expect(out.short_summary).toBe("line");
    expect(out.tags).toEqual(["gamma"]);
    expect(out.category).toBe("cat");
  });
});
