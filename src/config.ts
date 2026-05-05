import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import type {
  AiConfig,
  BaseConfig,
  BaseViewConfig,
  DefaultsBlock,
  JobConfig,
  JobType,
  ObsflowConfig,
  RecordsConfig,
  RssSourceConfig,
  XSourcesConfig,
} from "./types.js";
import { OBSFLOW_RECORD_KIND } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, key: string): string {
  if (typeof v !== "string" || !v.length) throw new Error(`${key} must be a non-empty string`);
  return v;
}

function bool(v: unknown, key: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${key} must be boolean`);
  return v;
}

function optStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return undefined;
  return v;
}

function optNum(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

const DEFAULT_SOURCE_GROUPS: Record<string, string> = {
  rss: "rss",
  x: "sns",
  web: "web",
  youtube: "youtube",
};

function defaultRecordsConfig(): RecordsConfig {
  return {
    root_folder: "src",
    path_template: "{source_group}/{source_id}/{yyyy}/{mm}/{dd}",
    filename_template: "{slug}.md",
    date_source: "captured_at",
    source_groups: { ...DEFAULT_SOURCE_GROUPS },
  };
}

function defaultBasesConfig(): BaseConfig[] {
  return [
    {
      id: "all-records",
      path: "Records.base",
      mode: "create_if_missing",
      filters: [`record_kind == "${OBSFLOW_RECORD_KIND}"`],
      views: [
        {
          type: "table",
          name: "All",
          order: [
            "file.name",
            "source_type",
            "source_id",
            "source_group",
            "status",
            "category",
            "tags",
            "summary",
            "captured_at",
            "updated_at",
          ],
        },
      ],
    },
  ];
}

/** Vault-relative path: no absolute paths, no `..` segments. */
function assertVaultRelPath(rel: string, key: string, requireBaseExt?: ".base"): void {
  const trimmed = rel.trim();
  if (!trimmed.length) throw new Error(`${key} must be non-empty`);
  if (path.isAbsolute(trimmed)) throw new Error(`${key} must be a vault-relative path`);
  const norm = path.normalize(trimmed);
  const segments = norm.split(/[/\\]+/).filter((s) => s.length > 0);
  if (segments.some((s) => s === "..")) {
    throw new Error(`${key} must not traverse outside the vault (no .. segments)`);
  }
  const posixNorm = segments.join("/");
  if (requireBaseExt && !posixNorm.endsWith(requireBaseExt)) {
    throw new Error(`${key} must end with ${requireBaseExt}`);
  }
}

function parseRecordsBlock(raw: unknown, keyPrefix: string): RecordsConfig {
  const base = defaultRecordsConfig();
  if (raw === undefined || raw === null) return base;
  if (!isRecord(raw)) throw new Error(`${keyPrefix} must be a mapping`);

  const root_folder = optStr(raw.root_folder)?.trim();
  const path_template = optStr(raw.path_template)?.trim();
  const filename_template = optStr(raw.filename_template)?.trim();
  const dateRaw = optStr(raw.date_source)?.trim();

  const out: RecordsConfig = {
    root_folder: root_folder && root_folder.length ? root_folder : base.root_folder,
    path_template:
      path_template && path_template.length ? path_template : base.path_template,
    filename_template:
      filename_template && filename_template.length ?
        filename_template
      : base.filename_template,
    date_source: base.date_source,
    source_groups: { ...base.source_groups },
  };

  if (dateRaw === "captured_at" || dateRaw === "published_at_or_captured_at") {
    out.date_source = dateRaw;
  } else if (dateRaw !== undefined && dateRaw.length) {
    throw new Error(
      `${keyPrefix}.date_source must be captured_at or published_at_or_captured_at`,
    );
  }

  assertVaultRelPath(out.root_folder, `${keyPrefix}.root_folder`);
  assertVaultRelPath(out.path_template, `${keyPrefix}.path_template`);
  assertVaultRelPath(out.filename_template, `${keyPrefix}.filename_template`);

  const sg = raw.source_groups;
  if (sg !== undefined && sg !== null) {
    if (!isRecord(sg)) throw new Error(`${keyPrefix}.source_groups must be a mapping`);
    for (const [k, v] of Object.entries(sg)) {
      if (!k.length) throw new Error(`${keyPrefix}.source_groups key must be non-empty`);
      if (typeof v !== "string" || !v.trim().length) {
        throw new Error(`${keyPrefix}.source_groups["${k}"] must be a non-empty string`);
      }
      const seg = v.trim().replace(/[/\\]/g, "_");
      out.source_groups[k] = seg;
    }
  }

  return out;
}

function parseBaseView(row: unknown, i: number): BaseViewConfig {
  if (!isRecord(row)) throw new Error(`bases[].views[${i}] invalid`);
  const t = row.type;
  if (t !== "table" && t !== "cards" && t !== "list" && t !== "map") {
    throw new Error(`bases[].views[${i}].type must be table, cards, list, or map`);
  }
  const name = str(row.name, `bases[].views[${i}].name`);
  const orderRaw = row.order;
  let order: string[] | undefined;
  if (orderRaw !== undefined && orderRaw !== null) {
    if (!Array.isArray(orderRaw)) throw new Error(`bases[].views[${i}].order must be an array`);
    order = orderRaw.map((c, j) =>
      str(c, `bases[].views[${i}].order[${j}]`),
    );
  }
  const limit = optNum(row.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error(`bases[].views[${i}].limit must be a non-negative integer`);
  }
  return { type: t, name, order, limit };
}

function parseBaseFilterStrings(filtersRaw: unknown, key: string): string[] {
  if (filtersRaw === undefined || filtersRaw === null) return [];
  if (typeof filtersRaw === "string") {
    if (!filtersRaw.trim().length) return [];
    return [filtersRaw.trim()];
  }
  if (!Array.isArray(filtersRaw)) {
    throw new Error(`${key} must be a string or array of strings`);
  }
  return filtersRaw.map((row, i) => str(row, `${key}[${i}]`));
}

function parseBasesBlock(raw: unknown): BaseConfig[] {
  if (raw === undefined || raw === null) return defaultBasesConfig();
  if (!Array.isArray(raw)) throw new Error("bases must be an array");
  if (raw.length === 0) return [];

  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  return raw.map((row, i) => {
    if (!isRecord(row)) throw new Error(`bases[${i}] invalid`);
    const id = str(row.id, `bases[${i}].id`);
    if (seenIds.has(id)) throw new Error(`duplicate bases[].id: ${id}`);
    seenIds.add(id);

    const p = str(row.path, `bases[${i}].path`);
    assertVaultRelPath(p, `bases[${i}].path`, ".base");
    const posixPath = path
      .normalize(p)
      .split(/[/\\]+/)
      .filter((s) => s.length > 0)
      .join("/");
    if (seenPaths.has(posixPath)) throw new Error(`duplicate bases[].path: ${posixPath}`);
    seenPaths.add(posixPath);

    const modeRaw = row.mode;
    const mode =
      modeRaw === "reference" || modeRaw === "create_if_missing" || modeRaw === "managed" ?
        modeRaw
      : "create_if_missing";

    const filters = parseBaseFilterStrings(row.filters, `bases[${i}].filters`);
    const viewsRaw = row.views;
    if (!Array.isArray(viewsRaw) || !viewsRaw.length) {
      throw new Error(`bases[${i}].views must be a non-empty array`);
    }
    const views = viewsRaw.map((v, j) => parseBaseView(v, j));

    const formulas = isRecord(row.formulas) ?
      Object.fromEntries(
        Object.entries(row.formulas).map(([k, v]) => [
          k,
          str(v, `bases[${i}].formulas.${k}`),
        ]),
      )
    : undefined;

    const propsRaw = isRecord(row.properties) ? row.properties : undefined;
    const properties =
      propsRaw ?
        Object.fromEntries(
          Object.entries(propsRaw).map(([k, v]) => {
            if (!isRecord(v)) throw new Error(`bases[${i}].properties["${k}"] invalid`);
            const displayName = optStr(v.displayName);
            return [k, { ...(displayName ? { displayName } : {}) }];
          }),
        )
      : undefined;

    const sumsRaw = isRecord(row.summaries) ? row.summaries : undefined;
    const summaries =
      sumsRaw ?
        Object.fromEntries(
          Object.entries(sumsRaw).map(([k, v]) => [
            k,
            str(v, `bases[${i}].summaries.${k}`),
          ]),
        )
      : undefined;

    return {
      id,
      path: posixPath,
      mode,
      filters,
      views,
      ...(formulas && Object.keys(formulas).length ? { formulas } : {}),
      ...(properties && Object.keys(properties).length ? { properties } : {}),
      ...(summaries && Object.keys(summaries).length ? { summaries } : {}),
    };
  });
}

function normalizeVaultPaths(cwd: string, vaultPathRaw: string, vaultFolderRaw: unknown): {
  vaultPath: string;
  vaultFolder?: string;
} {
  const vaultBase = path.resolve(cwd, vaultPathRaw);
  const folder = optStr(vaultFolderRaw)?.trim();
  if (!folder) {
    return { vaultPath: vaultBase };
  }
  if (path.isAbsolute(folder)) {
    throw new Error("defaults.vault_folder must be a relative path");
  }
  const resolved = path.resolve(vaultBase, folder);
  const relFromBase = path.relative(vaultBase, resolved);
  if (relFromBase.startsWith("..") || path.isAbsolute(relFromBase)) {
    throw new Error("defaults.vault_folder must stay within defaults.vault_path");
  }
  return {
    vaultPath: resolved,
    vaultFolder: folder,
  };
}

export function loadConfigFile(configPath: string): unknown {
  const raw = fs.readFileSync(configPath, "utf8");
  return YAML.parse(raw);
}

/** Merge defaults into RSS rows and fill missing top-level timezone from defaults. */
export function normalizeConfig(raw: unknown, cwd: string): ObsflowConfig {
  if (!isRecord(raw)) throw new Error("config root must be a mapping");
  const version = raw.version;
  if (typeof version !== "number" || version !== 1) {
    throw new Error(`unsupported config version: ${String(version)}`);
  }

  const d = raw.defaults;
  if (!isRecord(d)) throw new Error("defaults is required");

  const stateBlock = isRecord(d.state) ? d.state : {};
  const vaultNormalized = normalizeVaultPaths(
    cwd,
    str(d.vault_path, "defaults.vault_path"),
    d.vault_folder,
  );

  const defaults: DefaultsBlock = {
    vault_path: vaultNormalized.vaultPath,
    vault_folder: vaultNormalized.vaultFolder,
    vault_provider:
      d.vault_provider === "mock" || d.vault_provider === "agent"
        ? d.vault_provider
        : "mock",
    timezone: str(d.timezone ?? "UTC", "defaults.timezone"),
    rss_provider:
      d.rss_provider === "feedsmith" || d.rss_provider === "mock"
        ? d.rss_provider
        : "mock",
    state: {
      driver: "sqlite",
      dsn: path.resolve(cwd, str(stateBlock.dsn ?? "./state.db", "defaults.state.dsn")),
    },
    auth: {
      x_bearer_token_env: optStr(
        isRecord(d.auth) ? d.auth.x_bearer_token_env : undefined,
      ),
      x_oauth2_access_token_env: optStr(
        isRecord(d.auth) ? d.auth.x_oauth2_access_token_env : undefined,
      ),
      ai_api_key_env: optStr(
        isRecord(d.auth) ? d.auth.ai_api_key_env : undefined,
      ),
      slack_webhook_env: optStr(
        isRecord(d.auth) ? d.auth.slack_webhook_env : undefined,
      ),
      cursor_api_key_env: optStr(
        isRecord(d.auth) ? d.auth.cursor_api_key_env : undefined,
      ),
    },
    alert: {
      provider:
        isRecord(d.alert) &&
        (d.alert.provider === "slack" || d.alert.provider === "mock")
          ? d.alert.provider
          : "mock",
      slack_webhook_env: optStr(
        isRecord(d.alert) ? d.alert.slack_webhook_env : undefined,
      ),
    },
  };

  const sourcesRaw = raw.sources;
  if (!isRecord(sourcesRaw)) throw new Error("sources is required");

  const rssRaw = sourcesRaw.rss;
  if (!Array.isArray(rssRaw)) throw new Error("sources.rss must be an array");

  const rss: RssSourceConfig[] = rssRaw.map((row, i) => {
    if (!isRecord(row)) throw new Error(`sources.rss[${i}] invalid`);
    return {
      id: str(row.id, `sources.rss[${i}].id`),
      enabled: bool(row.enabled, `sources.rss[${i}].enabled`),
      schedule: str(row.schedule, `sources.rss[${i}].schedule`),
      url: optStr(row.url),
      fixture: row.fixture ? path.resolve(cwd, str(row.fixture, `sources.rss[${i}].fixture`)) : undefined,
      provider:
        row.provider === "feedsmith" || row.provider === "mock"
          ? row.provider
          : undefined,
    };
  });

  const xRaw = sourcesRaw.x;
  if (!isRecord(xRaw)) throw new Error("sources.x is required");
  const searchRaw = Array.isArray(xRaw.search) ? xRaw.search : [];
  const listsRaw = Array.isArray(xRaw.lists) ? xRaw.lists : [];
  const bookmarksRaw = Array.isArray(xRaw.bookmarks) ? xRaw.bookmarks : [];

  const x: XSourcesConfig = {
    provider: xRaw.provider === "x-sdk" ? "x-sdk" : "mock",
    search: searchRaw.map((row, i) => {
      if (!isRecord(row)) throw new Error(`sources.x.search[${i}] invalid`);
      return {
        id: str(row.id, `sources.x.search[${i}].id`),
        enabled: bool(row.enabled, `sources.x.search[${i}].enabled`),
        schedule: str(row.schedule, `sources.x.search[${i}].schedule`),
        query: str(row.query, `sources.x.search[${i}].query`),
      };
    }),
    lists: listsRaw.map((row, i) => {
      if (!isRecord(row)) throw new Error(`sources.x.lists[${i}] invalid`);
      return {
        id: str(row.id, `sources.x.lists[${i}].id`),
        enabled: bool(row.enabled, `sources.x.lists[${i}].enabled`),
        schedule: str(row.schedule, `sources.x.lists[${i}].schedule`),
        list_id: str(row.list_id, `sources.x.lists[${i}].list_id`),
      };
    }),
    bookmarks: bookmarksRaw.map((row, i) => {
      if (!isRecord(row)) throw new Error(`sources.x.bookmarks[${i}] invalid`);
      return {
        id: str(row.id, `sources.x.bookmarks[${i}].id`),
        enabled: bool(row.enabled, `sources.x.bookmarks[${i}].enabled`),
        schedule: str(row.schedule, `sources.x.bookmarks[${i}].schedule`),
      };
    }),
  };

  const aiRaw = raw.ai;
  if (!isRecord(aiRaw)) throw new Error("ai is required");
  const ai: AiConfig = {
    provider: aiRaw.provider === "real" ? "real" : "mock",
  };

  const jobsRaw = raw.jobs;
  if (!Array.isArray(jobsRaw)) throw new Error("jobs must be an array");
  const jobs: JobConfig[] = jobsRaw.map((row, i) => {
    if (!isRecord(row)) throw new Error(`jobs[${i}] invalid`);
    if (row.type !== "digest" && row.type !== "summarize") {
      throw new Error(`jobs[${i}].type must be summarize or digest`);
    }
    const type: JobType = row.type;
    return {
      id: str(row.id, `jobs[${i}].id`),
      type,
      enabled: bool(row.enabled, `jobs[${i}].enabled`),
      schedule: str(row.schedule, `jobs[${i}].schedule`),
      cadence: optStr(row.cadence) as JobConfig["cadence"],
    };
  });

  const timezone = str(raw.timezone ?? defaults.timezone, "timezone");

  const records = parseRecordsBlock(raw.records, "records");
  const bases = parseBasesBlock(raw.bases);

  return {
    version: 1,
    timezone,
    defaults,
    sources: { rss, x },
    ai,
    jobs,
    records,
    bases,
  };
}

function envNamePresent(name: string | undefined): boolean {
  if (!name) return false;
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
}

/** Validate required env vars for enabled providers (throws on missing). */
export function validateConfigEnv(cfg: ObsflowConfig): void {
  if (cfg.defaults.vault_provider === "agent") {
    const k = cfg.defaults.auth.cursor_api_key_env ?? "CURSOR_API_KEY";
    if (!envNamePresent(k)) throw new Error(`missing env ${k} for vault_provider=agent`);
  }

  const alertProv =
    cfg.defaults.alert.provider === "slack" ? "slack" : cfg.defaults.alert.provider;
  if (alertProv === "slack") {
    const k = cfg.defaults.alert.slack_webhook_env ?? cfg.defaults.auth.slack_webhook_env;
    const name = k ?? "SLACK_WEBHOOK_URL";
    if (!envNamePresent(name)) throw new Error(`missing env ${name} for alert slack provider`);
  }

  if (cfg.ai.provider === "real") {
    const k = cfg.defaults.auth.ai_api_key_env ?? "AI_API_KEY";
    if (!envNamePresent(k)) throw new Error(`missing env ${k} for ai provider=real`);
  }

  if (cfg.sources.x.provider === "x-sdk") {
    const bt = cfg.defaults.auth.x_bearer_token_env ?? "X_BEARER_TOKEN";
    if (!envNamePresent(bt)) throw new Error(`missing env ${bt} for x-sdk (search/lists)`);

    const anyBookmarks = cfg.sources.x.bookmarks.some((b) => b.enabled);
    if (anyBookmarks) {
      const at =
        cfg.defaults.auth.x_oauth2_access_token_env ?? "X_OAUTH2_ACCESS_TOKEN";
      if (!envNamePresent(at)) {
        throw new Error(
          `missing env ${at} for x-sdk bookmarks (user OAuth2 access token required)`,
        );
      }
    }
  }
}
