import type { AlertAdapter } from "./interfaces.js";
import type { FailureReport } from "../types.js";

export function createSlackAlertAdapter(webhookUrl: string): AlertAdapter {
  return {
    async notifyFailure(report: FailureReport): Promise<void> {
      const text = [
        `*obsflow failure* (${report.severity})`,
        `target: ${report.target}`,
        report.source_id ? `source_id: ${report.source_id}` : "",
        `tick_run_id: ${report.tick_run_id}`,
        report.job_run_id ? `job_run_id: ${report.job_run_id}` : "",
        "",
        report.message,
      ]
        .filter(Boolean)
        .join("\n");
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        throw new Error(`slack webhook failed: ${res.status}`);
      }
    },
  };
}
