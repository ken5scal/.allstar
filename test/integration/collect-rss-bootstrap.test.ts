import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfigFile, normalizeConfig } from "../../src/config.js";
import { newId } from "../../src/ids.js";
import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";
import { createVaultMockAdapter } from "../../src/adapters/vault-mock.js";
import { collectRssSource } from "../../src/jobs/collect.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..");

function renderFeed(items: Array<{ key: string; title: string; pubDate?: string }>): string {
  const rows = items
    .map(
      (item) => `    <item>
      <title>${item.title}</title>
      <guid>${item.key}</guid>
      <link>https://example.com/${item.key}</link>
      <description>${item.title} body</description>
      ${item.pubDate ? `<pubDate>${item.pubDate}</pubDate>` : ""}
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

describe("collectRssSource bootstrap", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      process.chdir(repoRoot);
    }
    tmp = undefined;
  });

  it("only captures latest N items on first run and marks deferred backlog as seen", async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-bootstrap-int-"));
    const fixturePath = path.join(tmp, "feed.xml");
    writeFileSync(
      fixturePath,
      renderFeed([
        {
          key: "older",
          title: "Older Item",
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

    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, path.join(repoRoot, "test", "fixtures"));
    cfg.defaults.state.dsn = path.join(tmp, "state.db");
    cfg.defaults.vault_path = path.join(tmp, "vault");
    cfg.sources.rss[0] = {
      ...cfg.sources.rss[0],
      fixture: fixturePath,
      bootstrap: {
        max_initial_items: 2,
      },
    };

    const state = new SqliteStateRepository(cfg.defaults.state.dsn);
    const vault = createVaultMockAdapter(cfg.defaults.vault_path);
    const rss = cfg.sources.rss[0];

    await collectRssSource({
      cfg,
      rss,
      state,
      vault,
      tickRunId: newId(),
      jobRunId: newId(),
    });

    const notesAfterFirst = await vault.listNotePathsUnder(cfg.records.root_folder);
    expect(notesAfterFirst).toHaveLength(2);
    expect(notesAfterFirst.some((note) => note.includes("Newest Item"))).toBe(true);
    expect(notesAfterFirst.some((note) => note.includes("Middle Item"))).toBe(true);
    expect(notesAfterFirst.some((note) => note.includes("Older Item"))).toBe(false);
    expect(await state.seenSourceItem("rss:sample", "older")).toBe(true);

    await collectRssSource({
      cfg,
      rss,
      state,
      vault,
      tickRunId: newId(),
      jobRunId: newId(),
    });

    const notesAfterSecond = await vault.listNotePathsUnder(cfg.records.root_folder);
    expect(notesAfterSecond).toHaveLength(2);
    await state.close();
  });

  it("applies published_within_days only on the initial rss checkpoint", async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-bootstrap-age-"));
    const fixturePath = path.join(tmp, "feed.xml");
    const now = Date.now();
    const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toUTCString();
    const old = new Date(now - 20 * 24 * 60 * 60 * 1000).toUTCString();
    writeFileSync(
      fixturePath,
      renderFeed([
        { key: "recent", title: "Recent Item", pubDate: recent },
        { key: "old", title: "Old Item", pubDate: old },
        { key: "undated", title: "Undated Item" },
      ]),
      "utf8",
    );

    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, path.join(repoRoot, "test", "fixtures"));
    cfg.defaults.state.dsn = path.join(tmp, "state.db");
    cfg.defaults.vault_path = path.join(tmp, "vault");
    cfg.sources.rss[0] = {
      ...cfg.sources.rss[0],
      fixture: fixturePath,
      bootstrap: {
        published_within_days: 7,
      },
    };

    const state = new SqliteStateRepository(cfg.defaults.state.dsn);
    const vault = createVaultMockAdapter(cfg.defaults.vault_path);
    const rss = cfg.sources.rss[0];

    await collectRssSource({
      cfg,
      rss,
      state,
      vault,
      tickRunId: newId(),
      jobRunId: newId(),
    });

    const notes = await vault.listNotePathsUnder(cfg.records.root_folder);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Recent Item");
    expect(await state.seenSourceItem("rss:sample", "old")).toBe(true);
    expect(await state.seenSourceItem("rss:sample", "undated")).toBe(true);
    await state.close();
  });
});
