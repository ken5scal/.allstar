import { describe, expect, it } from "vitest";

import { resolveRunBootstrapAllRssOverride } from "../../src/cli.js";

describe("resolveRunBootstrapAllRssOverride", () => {
  it("returns undefined when no CLI bootstrap override is provided", () => {
    expect(resolveRunBootstrapAllRssOverride({})).toBeUndefined();
  });

  it("rejects bootstrap limits without --bootstrap-all-rss", () => {
    expect(() =>
      resolveRunBootstrapAllRssOverride({
        bootstrapMaxInitialItems: 3,
      }),
    ).toThrow(/require --bootstrap-all-rss/);
  });

  it("rejects --bootstrap-all-rss without at least one limit", () => {
    expect(() =>
      resolveRunBootstrapAllRssOverride({
        bootstrapAllRss: true,
      }),
    ).toThrow(/requires at least one/);
  });

  it("returns an all-RSS override when the flag and limits are provided", () => {
    expect(
      resolveRunBootstrapAllRssOverride({
        bootstrapAllRss: true,
        bootstrapMaxInitialItems: 2,
        bootstrapPublishedWithinDays: 7,
      }),
    ).toEqual({
      max_initial_items: 2,
      published_within_days: 7,
    });
  });
});
