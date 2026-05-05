import { describe, expect, it } from "vitest";

import { runTick } from "../../src/orchestrator.js";

describe("failure paths", () => {
  it("returns 1 for missing config", async () => {
    const code = await runTick("/no/such/config.yaml", process.cwd());
    expect(code).toBe(1);
  });
});
