import { describe, expect, it } from "vitest";

import { isCronDue } from "../../src/schedule.js";

describe("schedule", () => {
  it("marks due when last run is before next cron occurrence", () => {
    const last = new Date("2020-01-01T00:00:00.000Z").toISOString();
    const now = new Date("2026-01-01T12:00:00.000Z");
    expect(isCronDue("0 * * * *", last, now, "UTC")).toBe(true);
  });

  it("not due immediately after tick", () => {
    const last = new Date("2026-01-01T12:05:00.000Z").toISOString();
    const now = new Date("2026-01-01T12:06:00.000Z");
    expect(isCronDue("0 * * * *", last, now, "UTC")).toBe(false);
  });
});
