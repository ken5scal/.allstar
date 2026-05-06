import type { AiAdapter } from "./interfaces.js";
import type { AiSummaryResult, VaultRecord } from "../types.js";

export type AiMockOptions = {
  handler?: (record: VaultRecord) => Promise<AiSummaryResult> | AiSummaryResult;
};

export function createAiMockAdapter(opts?: AiMockOptions): AiAdapter {
  return {
    async summarize(record: VaultRecord): Promise<AiSummaryResult> {
      if (opts?.handler) return opts.handler(record);
      const head = record.rawContent.trim().slice(0, 200);
      const body = record.rawContent.trim();
      return {
        short_summary: head ? `${head.replace(/\s+/g, " ")}…` : "(empty)",
        summary: `Mock summary for ${record.source}:\n\n${body}`,
        tags: [],
      };
    },
  };
}
