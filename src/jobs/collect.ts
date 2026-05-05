import type { ObsflowConfig, SourceItem, VaultRecord } from "../types.js";
import { OBSFLOW_RECORD_KIND } from "../types.js";
import { recordNoteRelPath, sourceFamily } from "../paths.js";
import { createRssMockAdapter } from "../adapters/rss-mock.js";
import { fetchRssItems } from "../adapters/feedsmith.js";
import type {
  StateRepository,
  StateTx,
  VaultAdapter,
  XCollectorAdapter,
} from "../adapters/interfaces.js";

function originFromItem(item: SourceItem): string | undefined {
  if (item.canonicalUrl) {
    try {
      return new URL(item.canonicalUrl).hostname;
    } catch {
      /* ignore */
    }
  }
  return item.sourceId;
}

export function itemToVaultRecord(
  item: SourceItem,
  tickRunId: string,
  jobRunId: string,
  cfg: ObsflowConfig,
  capturedAt: Date,
): VaultRecord {
  const nowIso = capturedAt.toISOString();
  const publishedIso =
    item.publishedAt && !Number.isNaN(new Date(item.publishedAt).getTime()) ?
      new Date(item.publishedAt).toISOString()
    : undefined;
  const family = sourceFamily(item.source);
  const sourceGroup = cfg.records.source_groups[family];
  if (sourceGroup === undefined) {
    throw new Error(
      `records.source_groups["${family}"] missing (source_type ${item.source})`,
    );
  }
  const base_ids = cfg.bases.map((b) => b.id);

  return {
    schema_version: 1,
    record_kind: OBSFLOW_RECORD_KIND,
    base_ids,
    source_type: item.source,
    source: item.canonicalUrl ?? item.source_item_key,
    source_id: item.sourceId,
    source_group: sourceGroup,
    origin: originFromItem(item),
    status: "captured",
    tags: [],
    attachments: [],
    summary: "",
    published_at: publishedIso,
    captured_at: nowIso,
    // Record creation time in the vault (not source publish time).
    created_at: nowIso,
    updated_at: nowIso,
    tick_run_id: tickRunId,
    job_run_id: jobRunId,
    rawContent: item.rawText,
    aiSummary: "",
  };
}

async function processNewItems(args: {
  cfg: ObsflowConfig;
  items: SourceItem[];
  checkpointSourceId: string;
  state: StateRepository;
  vault: VaultAdapter;
  tickRunId: string;
  jobRunId: string;
  cursorBuilder: (items: SourceItem[]) => string;
}): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;
  for (const item of args.items) {
    const shouldSkip = await args.state.inTx((tx: StateTx) => {
      if (tx.seenSourceItem(args.checkpointSourceId, item.source_item_key)) {
        return true;
      }
      if (tx.seenContentHash(args.checkpointSourceId, item.content_hash)) {
        return true;
      }
      return false;
    });
    if (shouldSkip) {
      skipped += 1;
      continue;
    }
    const capturedAt = new Date();
    const rec = itemToVaultRecord(
      item,
      args.tickRunId,
      args.jobRunId,
      args.cfg,
      capturedAt,
    );
    const rel = recordNoteRelPath(args.cfg, item, capturedAt);
    await args.vault.upsertRecord(rec, rel);
    await args.state.inTx((tx) => {
      tx.markSourceItemSeen(
        args.checkpointSourceId,
        item.source_item_key,
        item.content_hash,
      );
    });
    processed += 1;
  }
  const cursor = args.cursorBuilder(args.items);
  await args.state.putCheckpoint({
    sourceId: args.checkpointSourceId,
    cursor,
  });
  return { processed, skipped };
}

export async function collectRssSource(args: {
  cfg: ObsflowConfig;
  rss: ObsflowConfig["sources"]["rss"][number];
  state: StateRepository;
  vault: VaultAdapter;
  tickRunId: string;
  jobRunId: string;
}): Promise<{ processed: number; skipped: number }> {
  const prov =
    args.rss.provider ?? args.cfg.defaults.rss_provider;
  let items: SourceItem[];
  if (prov === "mock") {
    const fix = args.rss.fixture;
    if (!fix) throw new Error(`rss ${args.rss.id}: mock requires fixture`);
    const adapter = createRssMockAdapter({
      sourceId: args.rss.id,
      fixturePath: fix,
      kind: "rss",
    });
    items = await adapter.collect(args.rss.id);
  } else {
    if (!args.rss.url) throw new Error(`rss ${args.rss.id}: feedsmith requires url`);
    items = await fetchRssItems(args.rss.url, args.rss.id, "rss");
  }
  const cpId = `rss:${args.rss.id}`;
  return processNewItems({
    cfg: args.cfg,
    items,
    checkpointSourceId: cpId,
    state: args.state,
    vault: args.vault,
    tickRunId: args.tickRunId,
    jobRunId: args.jobRunId,
    cursorBuilder: (it) =>
      JSON.stringify({
        polled_at: new Date().toISOString(),
        item_count: it.length,
      }),
  });
}

export async function collectXSearch(args: {
  cfg: ObsflowConfig;
  search: ObsflowConfig["sources"]["x"]["search"][number];
  collector: XCollectorAdapter;
  state: StateRepository;
  vault: VaultAdapter;
  tickRunId: string;
  jobRunId: string;
}): Promise<{ processed: number; skipped: number }> {
  const items = await args.collector.collectSearch(args.search.id, args.search.query);
  const cpId = `x-search:${args.search.id}`;
  return processNewItems({
    cfg: args.cfg,
    items,
    checkpointSourceId: cpId,
    state: args.state,
    vault: args.vault,
    tickRunId: args.tickRunId,
    jobRunId: args.jobRunId,
    cursorBuilder: (it) => {
      const ids = it.map((i) => i.source_item_key).sort();
      return JSON.stringify({ latest: ids.at(-1), count: it.length });
    },
  });
}

export async function collectXList(args: {
  cfg: ObsflowConfig;
  list: ObsflowConfig["sources"]["x"]["lists"][number];
  collector: XCollectorAdapter;
  state: StateRepository;
  vault: VaultAdapter;
  tickRunId: string;
  jobRunId: string;
}): Promise<{ processed: number; skipped: number }> {
  const items = await args.collector.collectList(args.list.id, args.list.list_id);
  const cpId = `x-list:${args.list.id}`;
  return processNewItems({
    cfg: args.cfg,
    items,
    checkpointSourceId: cpId,
    state: args.state,
    vault: args.vault,
    tickRunId: args.tickRunId,
    jobRunId: args.jobRunId,
    cursorBuilder: (it) =>
      JSON.stringify({ latest: it.map((i) => i.source_item_key).sort().at(-1) }),
  });
}

export async function collectXBookmarks(args: {
  cfg: ObsflowConfig;
  bm: ObsflowConfig["sources"]["x"]["bookmarks"][number];
  collector: XCollectorAdapter;
  state: StateRepository;
  vault: VaultAdapter;
  tickRunId: string;
  jobRunId: string;
}): Promise<{ processed: number; skipped: number }> {
  const items = await args.collector.collectBookmarks(args.bm.id);
  const cpId = `x-bookmarks:${args.bm.id}`;
  return processNewItems({
    cfg: args.cfg,
    items,
    checkpointSourceId: cpId,
    state: args.state,
    vault: args.vault,
    tickRunId: args.tickRunId,
    jobRunId: args.jobRunId,
    cursorBuilder: (it) =>
      JSON.stringify({ latest: it.map((i) => i.source_item_key).sort().at(-1) }),
  });
}
