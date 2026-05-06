import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { runManual } from "../../src/orchestrator.js";

describe("manual run with multiple rss sources", () => {
  it("collects from all enabled rss sources for collect-rss target", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-manual-multi-"));
    const configPath = path.join(tmp, "config.yaml");
    const vaultPath = path.join(tmp, "vault");
    const stateDsn = path.join(tmp, "state.db");
    const fixturePath = path.resolve(
      process.cwd(),
      "test/fixtures/rss/sample.xml",
    );

    const rawConfig = {
      version: 1,
      timezone: "UTC",
      defaults: {
        vault_path: "./vault",
        vault_provider: "mock",
        timezone: "UTC",
        rss_provider: "mock",
        state: {
          driver: "sqlite",
          dsn: "./state.db",
        },
        auth: {
          cursor_api_key_env: "CURSOR_API_KEY",
          x_bearer_token_env: "X_BEARER_TOKEN",
          x_oauth2_access_token_env: "X_OAUTH2_ACCESS_TOKEN",
        },
        alert: {
          provider: "mock",
        },
      },
      sources: {
        rss: [
          {
            id: "rss-a",
            enabled: true,
            schedule: "* * * * *",
            fixture: fixturePath,
          },
          {
            id: "rss-b",
            enabled: true,
            schedule: "* * * * *",
            fixture: fixturePath,
          },
        ],
        x: {
          provider: "mock",
          search: [],
          lists: [],
          bookmarks: [],
        },
      },
      ai: {
        provider: "mock",
      },
      jobs: [],
    };

    writeFileSync(configPath, YAML.stringify(rawConfig), "utf8");

    const code = await runManual(configPath, tmp, ["collect-rss"]);
    expect(code).toBe(0);

    const vault = createVaultMockAdapter(vaultPath);
    const notes = await vault.listNotePathsUnder("src");
    expect(notes.length).toBe(4);
    expect(notes.some((n) => n.includes("rss-a") && n.includes("Hello RSS"))).toBe(
      true,
    );
    expect(notes.some((n) => n.includes("rss-b"))).toBe(true);

    const state = new SqliteStateRepository(stateDsn);
    const runA = await state.lastJobRun("collect-rss:rss-a");
    const runB = await state.lastJobRun("collect-rss:rss-b");
    expect(runA?.status).toBe("success");
    expect(runB?.status).toBe("success");
    await state.close();
  });
});
