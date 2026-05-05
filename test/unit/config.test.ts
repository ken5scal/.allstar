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

  it("resolves relative paths from provided config base dir", () => {
    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
    const baseDir = "/tmp/obsflow-config-base";
    const cfg = normalizeConfig(raw, baseDir);
    expect(cfg.defaults.state.dsn).toBe(path.resolve(baseDir, "./test-output-mock.sqlite"));
    expect(cfg.defaults.vault_path).toBe(path.resolve(baseDir, "./test-output-vault"));
    expect(cfg.sources.rss[0].fixture).toBe(
      path.resolve(baseDir, "./test/fixtures/rss/sample.xml"),
    );
  });

  it("supports defaults.vault_folder under vault_path", () => {
    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml")) as {
      defaults: { vault_folder?: string };
    };
    raw.defaults.vault_folder = "ObsFlow/Inbox";
    const baseDir = "/tmp/obsflow-config-base";
    const cfg = normalizeConfig(raw, baseDir);
    expect(cfg.defaults.vault_folder).toBe("ObsFlow/Inbox");
    expect(cfg.defaults.vault_path).toBe(
      path.resolve(baseDir, "./test-output-vault/ObsFlow/Inbox"),
    );
  });
});
