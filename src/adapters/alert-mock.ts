import type { AlertAdapter } from "./interfaces.js";
import type { FailureReport } from "../types.js";

export function createAlertMockAdapter(
  sink: { messages: FailureReport[] } = { messages: [] },
): AlertAdapter {
  return {
    async notifyFailure(report: FailureReport): Promise<void> {
      sink.messages.push(report);
    },
  };
}
