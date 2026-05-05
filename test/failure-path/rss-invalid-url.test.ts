import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { runManual } from "../../src/orchestrator.js";

describe("failure paths", () => {
  it("returns 2 when rss url is unreachable", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-rss-fail-"));
    const configPath = path.join(tmp, "config.yaml");
    const stateDsn = path.join(tmp, "state.db");

    const rawConfig = {
      version: 1,
      timezone: "UTC",
      defaults: {
        vault_path: "./vault",
        vault_provider: "mock",
        timezone: "UTC",
        rss_provider: "feedsmith",
        state: {
          driver: "sqlite",
          dsn: "./state.db",
        },
        auth: {},
        alert: {
          provider: "mock",
        },
      },
      sources: {
        rss: [
          {
            id: "bad-rss",
            enabled: true,
            schedule: "* * * * *",
            url: "http://127.0.0.1:1/unreachable.xml",
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
    expect(code).toBe(2);

    const state = new SqliteStateRepository(stateDsn);
    const run = await state.lastJobRun("collect-rss:bad-rss");
    expect(run?.status).toBe("failed");
    await state.close();
  });
});
