import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { runManual } from "../../src/orchestrator.js";

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

describe("collect-rss bootstrap e2e", () => {
  it("limits first-run capture through run --targets collect-rss", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-bootstrap-e2e-"));
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
            id: "rss-bootstrap-e2e",
            enabled: true,
            schedule: "* * * * *",
            fixture: fixturePath,
            bootstrap: {
              max_initial_items: 1,
            },
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

    const firstCode = await runManual(configPath, tmp, ["collect-rss"]);
    expect(firstCode).toBe(0);

    const vault = createVaultMockAdapter(vaultPath);
    const notesAfterFirst = await vault.listNotePathsUnder("src");
    expect(notesAfterFirst).toHaveLength(1);
    expect(notesAfterFirst[0]).toContain("Newest Item");

    const state = new SqliteStateRepository(stateDsn);
    expect(await state.seenSourceItem("rss:rss-bootstrap-e2e", "middle")).toBe(true);
    expect(await state.seenSourceItem("rss:rss-bootstrap-e2e", "oldest")).toBe(true);
    const firstRun = await state.lastJobRun("collect-rss:rss-bootstrap-e2e");
    expect(firstRun?.status).toBe("success");

    const secondCode = await runManual(configPath, tmp, ["collect-rss"]);
    expect(secondCode).toBe(0);

    const notesAfterSecond = await vault.listNotePathsUnder("src");
    expect(notesAfterSecond).toHaveLength(1);
    const secondRun = await state.lastJobRun("collect-rss:rss-bootstrap-e2e");
    expect(secondRun?.status).toBe("success");
    await state.close();
  });
});
