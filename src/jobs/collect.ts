import type { ObsflowConfig, SourceItem, VaultRecord } from "../types.js";
import { OBSFLOW_RECORD_KIND } from "../types.js";
import { recordNoteRelPath, sourceFamily } from "../paths.js";
import { createRssMockAdapter } from "../adapters/rss-mock.js";
import {
  fetchRssItems,
  hydrateRssItemWithLinkedContent,
} from "../adapters/feedsmith.js";
import type { AppLogger } from "../logger.js";
import type {
  StateRepository,
  StateTx,
  VaultAdapter,
  XCollectorAdapter,
} from "../adapters/interfaces.js";

type RssBootstrapSelection = {
  selected: SourceItem[];
  excluded: SourceItem[];
  filteredByAge: number;
  filteredByLimit: number;
};

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

function publishedAtMillis(item: SourceItem): number | null {
  if (!item.publishedAt) return null;
  const millis = Date.parse(item.publishedAt);
  return Number.isNaN(millis) ? null : millis;
}

export function selectRssBootstrapItems(args: {
  items: SourceItem[];
  maxInitialItems?: number;
  publishedWithinDays?: number;
  now?: Date;
}): RssBootstrapSelection {
  const nowMs = (args.now ?? new Date()).getTime();
  const decorated = args.items.map((item, originalIndex) => ({
    item,
    originalIndex,
    publishedAtMs: publishedAtMillis(item),
  }));

  let eligible = decorated;
  let filteredByAge = 0;
  if (args.publishedWithinDays !== undefined) {
    const thresholdMs = nowMs - args.publishedWithinDays * 24 * 60 * 60 * 1000;
    eligible = decorated.filter(
      (row) => row.publishedAtMs !== null && row.publishedAtMs >= thresholdMs,
    );
    filteredByAge = decorated.length - eligible.length;
  }

  let selectedDecorated = eligible;
  if (args.maxInitialItems !== undefined) {
    selectedDecorated = [...eligible]
      .sort((a, b) => {
        if (a.publishedAtMs !== null && b.publishedAtMs !== null) {
          if (a.publishedAtMs !== b.publishedAtMs) {
            return b.publishedAtMs - a.publishedAtMs;
          }
          return a.originalIndex - b.originalIndex;
        }
        if (a.publishedAtMs !== null) return -1;
        if (b.publishedAtMs !== null) return 1;
        return a.originalIndex - b.originalIndex;
      })
      .slice(0, args.maxInitialItems);
  }

  const selectedIndexes = new Set(
    selectedDecorated.map((row) => row.originalIndex),
  );
  const excluded = decorated
    .filter((row) => !selectedIndexes.has(row.originalIndex))
    .map((row) => row.item);

  return {
    selected: selectedDecorated.map((row) => row.item),
    excluded,
    filteredByAge,
    filteredByLimit: eligible.length - selectedDecorated.length,
  };
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
  checkpointItems?: SourceItem[];
  itemTransformer?: (item: SourceItem) => Promise<SourceItem>;
}): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;
  for (const item of args.items) {
    const sourceSeen = await args.state.inTx((tx: StateTx) =>
      tx.seenSourceItem(args.checkpointSourceId, item.source_item_key),
    );
    if (sourceSeen) {
      skipped += 1;
      continue;
    }

    const transformed =
      args.itemTransformer ? await args.itemTransformer(item) : item;
    const hashSeen = await args.state.inTx((tx: StateTx) =>
      tx.seenContentHash(args.checkpointSourceId, transformed.content_hash),
    );
    if (hashSeen) {
      skipped += 1;
      continue;
    }

    const capturedAt = new Date();
    const rec = itemToVaultRecord(
      transformed,
      args.tickRunId,
      args.jobRunId,
      args.cfg,
      capturedAt,
    );
    const rel = recordNoteRelPath(args.cfg, transformed, capturedAt);
    await args.vault.upsertRecord(rec, rel);
    await args.state.inTx((tx) => {
      tx.markSourceItemSeen(
        args.checkpointSourceId,
        transformed.source_item_key,
        transformed.content_hash,
      );
    });
    processed += 1;
  }
  const cursor = args.cursorBuilder(args.checkpointItems ?? args.items);
  await args.state.putCheckpoint({
    sourceId: args.checkpointSourceId,
    cursor,
  });
  return { processed, skipped };
}

async function markItemsSeen(args: {
  state: StateRepository;
  checkpointSourceId: string;
  items: SourceItem[];
}): Promise<void> {
  if (!args.items.length) return;
  await args.state.inTx((tx) => {
    for (const item of args.items) {
      tx.markSourceItemSeen(
        args.checkpointSourceId,
        item.source_item_key,
        item.content_hash,
      );
    }
  });
}

export async function collectRssSource(args: {
  cfg: ObsflowConfig;
  rss: ObsflowConfig["sources"]["rss"][number];
  state: StateRepository;
  vault: VaultAdapter;
  tickRunId: string;
  jobRunId: string;
  logger?: AppLogger;
}): Promise<{ processed: number; skipped: number }> {
  const prov =
    args.rss.provider ?? args.cfg.defaults.rss_provider;
  const fetchArticleContent = args.rss.fetch_article_content ?? true;
  const articleFetchTimeoutMs =
    args.rss.article_fetch_timeout_ms ?? 12_000;

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
  const bootstrap = args.rss.bootstrap;
  const isBootstrapRun =
    bootstrap !== undefined &&
    (await args.state.getCheckpoint(cpId)) === null;
  const selection =
    isBootstrapRun ?
      selectRssBootstrapItems({
        items,
        maxInitialItems: bootstrap.max_initial_items,
        publishedWithinDays: bootstrap.published_within_days,
      })
    : undefined;
  const itemsToProcess = selection?.selected ?? items;
  const itemsToSkip = selection?.excluded ?? [];

  if (selection) {
    args.logger?.info({
      msg: "collect_rss_bootstrap_start",
      job_run_id: args.jobRunId,
      source_id: args.rss.id,
      checkpoint_source_id: cpId,
      fetched_total: items.length,
      bootstrap_max_initial_items: bootstrap?.max_initial_items,
      bootstrap_published_within_days: bootstrap?.published_within_days,
    });
    await markItemsSeen({
      state: args.state,
      checkpointSourceId: cpId,
      items: itemsToSkip,
    });
    args.logger?.info({
      msg: "collect_rss_bootstrap_applied",
      job_run_id: args.jobRunId,
      source_id: args.rss.id,
      checkpoint_source_id: cpId,
      fetched_total: items.length,
      bootstrap_selected_total: selection.selected.length,
      bootstrap_filtered_by_age_total: selection.filteredByAge,
      bootstrap_filtered_by_limit_total: selection.filteredByLimit,
    });
  }

  const result = await processNewItems({
    cfg: args.cfg,
    items: itemsToProcess,
    checkpointItems: items,
    checkpointSourceId: cpId,
    state: args.state,
    vault: args.vault,
    tickRunId: args.tickRunId,
    jobRunId: args.jobRunId,
    itemTransformer:
      prov === "feedsmith" && fetchArticleContent ?
        (item) =>
          hydrateRssItemWithLinkedContent(item, {
            timeoutMs: articleFetchTimeoutMs,
          })
      : undefined,
    cursorBuilder: (it) =>
      JSON.stringify({
        polled_at: new Date().toISOString(),
        item_count: it.length,
      }),
  });
  if (selection) {
    args.logger?.info({
      msg: "collect_rss_bootstrap_done",
      job_run_id: args.jobRunId,
      source_id: args.rss.id,
      checkpoint_source_id: cpId,
      fetched_total: items.length,
      bootstrap_selected_total: selection.selected.length,
      bootstrap_filtered_by_age_total: selection.filteredByAge,
      bootstrap_filtered_by_limit_total: selection.filteredByLimit,
      processed: result.processed,
      skipped: result.skipped,
    });
  }
  return result;
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
