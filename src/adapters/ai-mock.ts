import type { AiAdapter } from "./interfaces.js";
import type { AiSummaryResult, VaultRecord } from "../types.js";

export function createAiMockAdapter(): AiAdapter {
  return {
    async summarize(record: VaultRecord): Promise<AiSummaryResult> {
      const head = record.rawContent.trim().slice(0, 200);
      const body = record.rawContent.trim();
      return {
        short_summary: head ? `${head.replace(/\s+/g, " ")}…` : "(empty)",
        summary: `Mock summary for ${record.source}:\n\n${body}`,
      };
    },
  };
}
