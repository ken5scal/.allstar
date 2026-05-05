import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SqliteStateRepository } from "../../src/adapters/state-sqlite.js";

describe("state-sqlite", () => {
  it("inTx marks items seen", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "obsflow-state-"));
    const dbPath = path.join(dir, "test.db");
    const repo = new SqliteStateRepository(dbPath);
    await repo.inTx((tx) => {
      tx.markSourceItemSeen("s1", "k1", "h1");
    });
    expect(await repo.seenSourceItem("s1", "k1")).toBe(true);
    expect(await repo.seenContentHash("s1", "h1")).toBe(true);
    await repo.close();
  });

  it("creates parent directories for dsn automatically", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "obsflow-state-"));
    const dbPath = path.join(dir, "nested", "state", "obsflow.db");
    const repo = new SqliteStateRepository(dbPath);
    await repo.putCheckpoint({
      sourceId: "rss:sample",
      cursor: "cursor-1",
    });
    expect(await repo.getCheckpoint("rss:sample")).toEqual({
      sourceId: "rss:sample",
      cursor: "cursor-1",
    });
    await repo.close();
  });
});
