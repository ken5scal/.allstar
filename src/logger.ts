import pino from "pino";

export type AppLogger = ReturnType<typeof createRootLogger>;

export function createRootLogger(tickRunId: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { tick_run_id: tickRunId },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
