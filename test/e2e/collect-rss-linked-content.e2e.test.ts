import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import YAML from "yaml";
import { describe, expect, it } from "vitest";

import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { runManual } from "../../src/orchestrator.js";

async function startFixtureServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname === "/feed.xml") {
        const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Fixture Feed</title>
    <item>
      <title>Fixture Item</title>
      <guid>fixture-item-1</guid>
      <link>http://${host}/article/1</link>
      <description>Feed summary snippet that should be replaced.</description>
      <pubDate>Wed, 06 May 2026 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;
        res.statusCode = 200;
        res.setHeader("content-type", "application/rss+xml; charset=utf-8");
        res.end(xml);
        return;
      }
      if (url.pathname === "/article/1") {
        const html = `<!doctype html>
<html>
  <head><title>Fixture article</title></head>
  <body>
    <header>navigation links</header>
    <article>
      <h1>Fixture Item</h1>
      <p>Full linked article paragraph line 1 with <strong>bold</strong>.</p>
      <ul>
        <li>Bullet line in article</li>
      </ul>
      <p><a href="https://example.com/ref">Reference link</a></p>
    </article>
  </body>
</html>`;
        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind fixture server"));
        return;
      }
      const { port } = addr;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) {
                rejectClose(err);
                return;
              }
              resolveClose(undefined);
            });
          }),
      });
    });
  });
}

describe("collect-rss linked article content e2e", () => {
  it("stores linked article body into vault raw content", async () => {
    const fixtureServer = await startFixtureServer();
    try {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-rss-e2e-"));
      const configPath = path.join(tmp, "config.yaml");
      const vaultPath = path.join(tmp, "vault");
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
              id: "rss-linked-e2e",
              enabled: true,
              schedule: "* * * * *",
              url: `${fixtureServer.baseUrl}/feed.xml`,
              fetch_article_content: true,
              article_fetch_timeout_ms: 3000,
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
      expect(notes).toHaveLength(1);
      const rec = await vault.readRecord(notes[0]);
      expect(rec).not.toBeNull();
      if (!rec) throw new Error("expected captured record");
      expect(rec.rawContent).toContain("# Fixture Item");
      expect(rec.rawContent).toContain(
        "Full linked article paragraph line 1 with **bold**.",
      );
      expect(rec.rawContent).toContain("- Bullet line in article");
      expect(rec.rawContent).toContain("[Reference link](https://example.com/ref)");
      expect(rec.rawContent).not.toContain("Feed summary snippet that should be replaced.");

      const state = new SqliteStateRepository(stateDsn);
      const run = await state.lastJobRun("collect-rss:rss-linked-e2e");
      expect(run?.status).toBe("success");
      await state.close();
    } finally {
      await fixtureServer.close();
    }
  });
});
