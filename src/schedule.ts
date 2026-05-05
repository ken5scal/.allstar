import { CronExpressionParser } from "cron-parser";

/** True if at least one cron tick has occurred strictly after `lastRunIso`. */
export function isCronDue(
  schedule: string,
  lastRunIso: string | null,
  now: Date,
  timeZone: string,
): boolean {
  const last = lastRunIso ? new Date(lastRunIso) : new Date(0);
  const expr = CronExpressionParser.parse(schedule, {
    currentDate: last,
    tz: timeZone,
  });
  const next = expr.next().toDate();
  return next.getTime() <= now.getTime();
}
