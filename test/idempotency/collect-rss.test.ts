import { mkdtempSync } from "node:fs";
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

describe("collect idempotency", () => {
  const prevLock = process.env.OBSFLOW_SKIP_TICK_LOCK;
  afterEach(() => {
    process.env.OBSFLOW_SKIP_TICK_LOCK = prevLock;
  });

  it("second collect creates no new notes", async () => {
    process.env.OBSFLOW_SKIP_TICK_LOCK = "1";
    const tmp = mkdtempSync(path.join(os.tmpdir(), "obsflow-idem-"));
    const raw = loadConfigFile(path.join(here, "../fixtures/config.mock.yaml"));
    const cfg = normalizeConfig(raw, repoRoot);
    cfg.defaults.state.dsn = path.join(tmp, "state.db");
    cfg.defaults.vault_path = path.join(tmp, "vault");

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
    const n1 = (await vault.listNotePathsUnder(path.join("Sources", "RSS"))).length;
    await collectRssSource({
      cfg,
      rss,
      state,
      vault,
      tickRunId: newId(),
      jobRunId: newId(),
    });
    const n2 = (await vault.listNotePathsUnder(path.join("Sources", "RSS"))).length;
    expect(n1).toBe(2);
    expect(n2).toBe(n1);
    await state.close();
  });
});
