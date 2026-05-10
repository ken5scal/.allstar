import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli.js";
import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";

function renderFeed(items: Array<{ key: string; title: string; pubDate: string }>): string {
  const rows = items
    .map(
      (item) => `    <item>
      <title>${item.title}</title>
      <guid>${item.key}</guid>
      <link>https://example.com/${item.key}</link>
      <description>${item.title} body</description>
      <pubDate>${item.pubDate}</pubDate>
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Fixture Feed</title>
${rows}
  </channel>
</rss>`;
}

describe("cli --bootstrap-all-rss e2e", () => {
  const prevExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = prevExitCode;
  });

  it("applies a first-run bootstrap override across all RSS sources only when explicitly requested", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-cli-bootstrap-"));
    const configPath = path.join(tmp, "config.yaml");
    const fixturePath = path.join(tmp, "feed.xml");
    const vaultPath = path.join(tmp, "vault");
    const stateDsn = path.join(tmp, "state.db");

    writeFileSync(
      fixturePath,
      renderFeed([
        {
          key: "oldest",
          title: "Oldest Item",
          pubDate: "Thu, 01 May 2026 10:00:00 GMT",
        },
        {
          key: "newest",
          title: "Newest Item",
          pubDate: "Sun, 04 May 2026 10:00:00 GMT",
        },
        {
          key: "middle",
          title: "Middle Item",
          pubDate: "Sat, 03 May 2026 10:00:00 GMT",
        },
      ]),
      "utf8",
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

    await runCli([
      "node",
      "obsflow",
      "run",
      "--config",
      configPath,
      "--targets",
      "collect-rss",
      "--bootstrap-all-rss",
      "--bootstrap-max-initial-items",
      "1",
    ]);

    expect(process.exitCode).toBe(0);

    const vault = createVaultMockAdapter(vaultPath);
    const notes = await vault.listNotePathsUnder("src");
    expect(notes).toHaveLength(2);
    expect(notes.every((note) => note.includes("Newest Item"))).toBe(true);

    const state = new SqliteStateRepository(stateDsn);
    expect(await state.seenSourceItem("rss:rss-a", "middle")).toBe(true);
    expect(await state.seenSourceItem("rss:rss-a", "oldest")).toBe(true);
    expect(await state.seenSourceItem("rss:rss-b", "middle")).toBe(true);
    expect(await state.seenSourceItem("rss:rss-b", "oldest")).toBe(true);
    await state.close();
  });
});
