/** Parsed + normalized config (after YAML load and defaults merge). */
export type ObsidianSourceKind =
  | "rss"
  | "x-search"
  | "x-list"
  | "x-bookmarks"
  | "manual-web"
  | "manual-youtube";

export type RssProviderName = "mock" | "feedsmith";
export type XProviderName = "mock" | "x-sdk";
export type AiProviderName = "mock" | "real";
export type AlertProviderName = "mock" | "slack";
export type VaultProviderName = "mock" | "agent";

export interface AuthEnvNames {
  x_bearer_token_env?: string;
  x_oauth2_access_token_env?: string;
  ai_api_key_env?: string;
  slack_webhook_env?: string;
  cursor_api_key_env?: string;
}

export interface AlertDefaults {
  provider: AlertProviderName;
  slack_webhook_env?: string;
}

export interface StateDefaults {
  driver: "sqlite";
  dsn: string;
}

export interface DefaultsBlock {
  vault_path: string;
  /** Optional subdirectory under vault_path for obsflow-managed files. */
  vault_folder?: string;
  vault_provider: VaultProviderName;
  timezone: string;
  rss_provider: RssProviderName;
  state: StateDefaults;
  auth: AuthEnvNames;
  alert: AlertDefaults;
}

export interface RssSourceConfig {
  id: string;
  enabled: boolean;
  schedule: string;
  url?: string;
  /** When rss provider is mock: XML fixture path (repo-relative or absolute). */
  fixture?: string;
  provider?: RssProviderName;
}

export interface XSearchConfig {
  id: string;
  enabled: boolean;
  schedule: string;
  query: string;
}

export interface XListConfig {
  id: string;
  enabled: boolean;
  schedule: string;
  list_id: string;
}

export interface XBookmarksConfig {
  id: string;
  enabled: boolean;
  schedule: string;
}

export interface XSourcesConfig {
  provider: XProviderName;
  search: XSearchConfig[];
  lists: XListConfig[];
  bookmarks: XBookmarksConfig[];
}

export interface AiConfig {
  provider: AiProviderName;
}

export type DigestCadence =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annually";

export type JobType = "summarize" | "digest";

export interface JobConfig {
  id: string;
  type: JobType;
  enabled: boolean;
  schedule: string;
  cadence?: DigestCadence;
}

/** ISO folder date segments for record paths: captured time vs published fallback. */
export type RecordDateSource = "captured_at" | "published_at_or_captured_at";

/** Where and how Markdown record notes are laid out under the vault. */
export interface RecordsConfig {
  /** Vault-relative root (POSIX-style segments, e.g. `src` or `Sources`). */
  root_folder: string;
  /** Relative path under root_folder; supports `{source_group}`, `{source_id}`, `{yyyy}`, `{mm}`, `{dd}`, `{slug}`, `{source_type}`, `{origin}`. */
  path_template: string;
  filename_template: string;
  date_source: RecordDateSource;
  /** Map source family (`rss`, `x`, `web`, `youtube`) → directory segment (e.g. `sns`). */
  source_groups: Record<string, string>;
}

export type BaseMode = "reference" | "create_if_missing" | "managed";

export interface BaseViewConfig {
  type: "table" | "cards" | "list" | "map";
  name: string;
  order?: string[];
  limit?: number;
}

/** Declarative Obsidian Base (.base) managed by obsflow. */
export interface BaseConfig {
  id: string;
  /** Vault-relative path ending in `.base`. */
  path: string;
  mode: BaseMode;
  /** Combined with AND when emitting the Base file. */
  filters: string[];
  views: BaseViewConfig[];
  formulas?: Record<string, string>;
  properties?: Record<string, { displayName?: string }>;
  summaries?: Record<string, string>;
}

export const OBSFLOW_RECORD_KIND = "obsflow-record";

export interface ObsflowConfig {
  version: number;
  timezone: string;
  defaults: DefaultsBlock;
  sources: {
    rss: RssSourceConfig[];
    x: XSourcesConfig;
  };
  ai: AiConfig;
  jobs: JobConfig[];
  records: RecordsConfig;
  bases: BaseConfig[];
}

export interface Checkpoint {
  sourceId: string;
  cursor: string;
}

export interface JobRun {
  job_run_id: string;
  tick_run_id: string;
  job_id: string;
  source_id?: string;
  started_at: string;
  finished_at?: string;
  status: "running" | "success" | "failed";
  error_message?: string;
}

export type ExitSeverity = 0 | 1 | 2 | 3;

export interface FailureReport {
  severity: ExitSeverity;
  target: string;
  source_id?: string;
  tick_run_id: string;
  job_run_id?: string;
  message: string;
  cause?: unknown;
}

/** Normalized item from any source before Vault write. */
export interface SourceItem {
  source: ObsidianSourceKind;
  sourceId: string;
  source_item_key: string;
  content_hash: string;
  title: string;
  rawText: string;
  publishedAt?: string;
  authorId?: string;
  canonicalUrl?: string;
}

/** Frontmatter + body sections for a vault note. */
export interface VaultRecord {
  schema_version: number;
  /** Discriminator for Obsidian Bases filters (Obsidian-native “rows”). */
  record_kind: string;
  /** Optional Base ids this note should associate with (for filters that use it). */
  base_ids: string[];
  source_type: ObsidianSourceKind;
  source: string;
  source_id?: string;
  /** Normalized group segment for paths/filters (e.g. rss, sns, web). */
  source_group: string;
  /** Human-friendly origin hint (e.g. hostname or source id). */
  origin?: string;
  status: "captured" | "summarized" | "failed";
  category?: string;
  tags: string[];
  attachments: Array<{ name: string; path: string }>;
  summary: string;
  /** Content publish time when known (ISO8601). */
  published_at?: string;
  /** When the record was captured into the vault (ISO8601). */
  captured_at: string;
  created_at: string;
  updated_at: string;
  tick_run_id: string;
  job_run_id: string;
  rawContent: string;
  aiSummary: string;
}

export type AiSummaryResult = {
  summary: string;
  short_summary?: string;
  tags?: string[];
  category?: string;
};
