import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfigFile, normalizeConfig, validateConfigEnv } from "../../src/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

describe("config", () => {
  it("loads mock fixture and validates env (mock providers)", () => {
    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, repo);
    expect(cfg.sources.rss[0].id).toBe("sample");
    validateConfigEnv(cfg);
  });
});
