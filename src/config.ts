import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

import type {
  AiConfig,
  DefaultsBlock,
  JobConfig,
  JobType,
  ObsflowConfig,
  RssSourceConfig,
  XSourcesConfig,
} from "./types.js";

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

  return {
    version: 1,
    timezone,
    defaults,
    sources: { rss, x },
    ai,
    jobs,
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
