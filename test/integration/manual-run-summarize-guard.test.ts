import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { runManual } from "../../src/orchestrator.js";
import { renderVaultNote } from "../../src/note.js";
import { OBSFLOW_RECORD_KIND, type VaultRecord } from "../../src/types.js";

function makeCapturedRecord(overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    schema_version: 1,
    record_kind: OBSFLOW_RECORD_KIND,
    base_ids: ["all-records"],
    source_type: "rss",
    source: "https://example.com/default",
    source_id: "sample",
    source_group: "rss",
    origin: "example.com",
    status: "captured",
    tags: [],
    attachments: [],
    summary: "",
    captured_at: "2026-05-05T10:13:16.968Z",
    created_at: "2026-05-05T10:13:16.968Z",
    updated_at: "2026-05-05T10:13:16.968Z",
    tick_run_id: "tick-test",
    job_run_id: "job-test",
    rawContent: "Default body.",
    aiSummary: "",
    ...overrides,
  };
}

describe("manual summarize guard integration", () => {
  it("keeps captured records untouched when backlog guard blocks summarize", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-summarize-guard-"));
    const configPath = path.join(tmp, "config.yaml");
    const vaultPath = path.join(tmp, "vault");
    const stateDsn = path.join(tmp, "state.db");

    for (const [name, capturedAt] of [
      ["one", "2026-05-05T10:00:00.000Z"],
      ["two", "2026-05-05T11:00:00.000Z"],
      ["three", "2026-05-05T12:00:00.000Z"],
    ] as const) {
      const rel = `src/rss/sample/2026/05/05/${name}.md`;
      const full = path.join(vaultPath, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(
        full,
        renderVaultNote(
          makeCapturedRecord({
            source: `https://example.com/${name}`,
            captured_at: capturedAt,
            created_at: capturedAt,
            updated_at: capturedAt,
            rawContent: `${name} body`,
          }),
        ),
        "utf8",
      );
    }

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
        rss: [],
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
      jobs: [
        {
          id: "summarize-main",
          type: "summarize",
          enabled: true,
          schedule: "* * * * *",
          selection: {
            skip_if_pending_over: 2,
            order_by: "captured_at",
            order: "newest_first",
          },
        },
      ],
    };

    writeFileSync(configPath, YAML.stringify(rawConfig), "utf8");

    const code = await runManual(configPath, tmp, ["summarize"]);
    expect(code).toBe(0);

    const vault = createVaultMockAdapter(vaultPath);
    for (const name of ["one", "two", "three"]) {
      const rec = await vault.readRecord(`src/rss/sample/2026/05/05/${name}.md`);
      expect(rec?.status).toBe("captured");
      expect(rec?.summary).toBe("");
    }

    const state = new SqliteStateRepository(stateDsn);
    const run = await state.lastJobRun("summarize-main");
    expect(run?.status).toBe("success");
    await state.close();
  });
});
