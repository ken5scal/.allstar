import fs from "node:fs";
import path from "node:path";

import { loadConfigFile, normalizeConfig, validateConfigEnv } from "./config.js";
import { newId } from "./ids.js";
import { createRootLogger } from "./logger.js";
import { isCronDue } from "./schedule.js";
import type { ObsflowConfig, ExitSeverity, FailureReport, JobRun } from "./types.js";
import type { AlertAdapter } from "./adapters/interfaces.js";
import { createAlertMockAdapter } from "./adapters/alert-mock.js";
import { createSlackAlertAdapter } from "./adapters/alert-slack.js";
import { createAiCursorAdapter } from "./adapters/ai-cursor.js";
import { createAiMockAdapter } from "./adapters/ai-mock.js";
import { createAiRealStubAdapter } from "./adapters/ai-real.js";
import { SqliteStateRepository } from "./adapters/state-sqlite.js";
import { createVaultAgentAdapter } from "./adapters/vault-agent.js";
import { createVaultMockAdapter } from "./adapters/vault-mock.js";
import { createXMockAdapter } from "./adapters/x-mock.js";
import { createXSdkAdapter } from "./adapters/x-sdk.js";
import { ensureVaultBases } from "./bases.js";
import {
  collectRssSource,
  collectXBookmarks,
  collectXList,
  collectXSearch,
} from "./jobs/collect.js";
import { runDigestJob } from "./jobs/digest.js";
import { runSummarizeJob } from "./jobs/summarize.js";

const perTickLoggers = new Map<string, ReturnType<typeof createRootLogger>>();

function getTickLogger(tickRunId: string) {
  const existing = perTickLoggers.get(tickRunId);
  if (existing) return existing;
  const created = createRootLogger(tickRunId);
  perTickLoggers.set(tickRunId, created);
  return created;
}

class DedupAlert implements AlertAdapter {
  private readonly inner: AlertAdapter;
  private readonly map = new Map<string, FailureReport>();

  constructor(inner: AlertAdapter) {
    this.inner = inner;
  }

  async notifyFailure(report: FailureReport): Promise<void> {
    const key = `${report.target}::${report.message.slice(0, 240)}`;
    if (!this.map.has(key)) this.map.set(key, report);
  }

  async flush(): Promise<void> {
    for (const r of this.map.values()) {
      await this.inner.notifyFailure(r);
    }
    this.map.clear();
  }
}

function envVal(name: string | undefined, fallback: string): string {
  const k = name ?? fallback;
  const v = process.env[k];
  if (!v) throw new Error("missing required environment variable");
  return v;
}

function aggregateExit(failures: FailureReport[]): ExitSeverity {
  if (failures.some((f) => f.severity === 1)) return 1;
  if (failures.some((f) => f.severity === 2)) return 2;
  if (failures.some((f) => f.severity === 3)) return 3;
  return 0;
}

function toSafeErrorLog(_e: unknown): { error_type: string; msg: string } {
  return { error_type: "error", msg: "orchestration_error" };
}

type ManualJobResult = {
  jobId: string;
  sourceId?: string;
  status: "success" | "failed";
  processed?: number;
  skipped?: number;
  error?: string;
};

type JobOutcomeTotals = {
  total: number;
  success: number;
  failed: number;
};

function printManualSummary(args: {
  tickRunId: string;
  results: ManualJobResult[];
  exitCode: number;
  failures: number;
}): void {
  const lines: string[] = [];
  lines.push("");
  lines.push(`obsflow run result (tick_run_id=${args.tickRunId})`);

  if (args.results.length === 0) {
    lines.push("- no jobs were executed (check --targets and enabled jobs)");
  } else {
    for (const r of args.results) {
      const scope = r.sourceId ? `${r.jobId} [${r.sourceId}]` : r.jobId;
      if (r.processed !== undefined) {
        lines.push(
          `- ${scope}: ${r.status} processed=${r.processed} skipped=${r.skipped ?? 0}`,
        );
      } else if (r.error) {
        lines.push(`- ${scope}: ${r.status} error=${r.error}`);
      } else {
        lines.push(`- ${scope}: ${r.status}`);
      }
    }
  }

  const collectRows = args.results.filter((r) => r.processed !== undefined);
  const processedTotal = collectRows.reduce((n, r) => n + (r.processed ?? 0), 0);
  const skippedTotal = collectRows.reduce((n, r) => n + (r.skipped ?? 0), 0);
  lines.push(
    `summary: exit=${args.exitCode} failures=${args.failures} collected_processed=${processedTotal} collected_skipped=${skippedTotal}`,
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function saveJob(
  state: SqliteStateRepository,
  run: JobRun,
): Promise<void> {
  await state.saveJobRun(run);
  const logger = getTickLogger(run.tick_run_id);
  const payload = {
    msg: "job_run_status",
    job_run_id: run.job_run_id,
    job_id: run.job_id,
    source_id: run.source_id,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    error_message: run.error_message,
  };
  if (run.status === "failed") {
    logger.error(payload);
    return;
  }
  logger.info(payload);
}

export async function runValidate(
  configPath: string,
  cwd: string,
): Promise<void> {
  const configBaseDir = path.dirname(path.resolve(cwd, configPath));
  const raw = loadConfigFile(configPath);
  const cfg = normalizeConfig(raw, configBaseDir);
  validateConfigEnv(cfg);
}

export async function runTick(
  configPath: string,
  cwd: string,
): Promise<number> {
  return runOrchestration(configPath, cwd, { mode: "tick" });
}

export async function runManual(
  configPath: string,
  cwd: string,
  targets: string[],
): Promise<number> {
  return runOrchestration(configPath, cwd, { mode: "manual", targets });
}

type Mode =
  | { mode: "tick" }
  | { mode: "manual"; targets: string[] };

async function runOrchestration(
  configPath: string,
  cwd: string,
  mode: Mode,
): Promise<number> {
  const tickRunId = newId();
  const log = createRootLogger(tickRunId);
  const failures: FailureReport[] = [];
  const manualResults: ManualJobResult[] = [];
  const outcomeTotals: JobOutcomeTotals = { total: 0, success: 0, failed: 0 };
  const configBaseDir = path.dirname(path.resolve(cwd, configPath));

  let cfg: ObsflowConfig;
  try {
    const raw = loadConfigFile(configPath);
    cfg = normalizeConfig(raw, configBaseDir);
    validateConfigEnv(cfg);
  } catch (e) {
    log.error({ error_type: errorType(e), msg: "config_error" });
    process.stderr.write("Configuration error. Check configuration and required environment variables.\n");
    return 1;
  }

  const slackWebhook =
    cfg.defaults.alert.slack_webhook_env ??
    cfg.defaults.auth.slack_webhook_env ??
    "SLACK_WEBHOOK_URL";
  const inner: AlertAdapter =
    cfg.defaults.alert.provider === "slack"
      ? createSlackAlertAdapter(envVal(slackWebhook, "SLACK_WEBHOOK_URL"))
      : createAlertMockAdapter();
  const dedupAlert = new DedupAlert(inner);

  let state: SqliteStateRepository;
  try {
    state = new SqliteStateRepository(cfg.defaults.state.dsn);
  } catch (e) {
    log.error({ err: e, msg: "state_error", dsn: cfg.defaults.state.dsn });
    process.stderr.write(String(e) + "\n");
    return 1;
  }
  const lockOk = state.tryAcquireTickLock(tickRunId, 60 * 60 * 1000);
  if (!lockOk) {
    log.warn({ msg: "tick_lock_busy" });
    await state.close();
    return 3;
  }

  try {
    const vault =
      cfg.defaults.vault_provider === "agent"
        ? createVaultAgentAdapter({
            vaultRoot: cfg.defaults.vault_path,
            apiKey: envVal(cfg.defaults.auth.cursor_api_key_env, "CURSOR_API_KEY"),
          })
        : createVaultMockAdapter(cfg.defaults.vault_path);

    fs.mkdirSync(path.join(cfg.defaults.vault_path, "Digests"), {
      recursive: true,
    });

    await ensureVaultBases(cfg, vault);

    const ai = (() => {
      switch (cfg.ai.provider) {
        case "mock":
          return createAiMockAdapter();
        case "real":
          return createAiRealStubAdapter();
        case "cursor":
          return createAiCursorAdapter({
            apiKey: envVal(cfg.defaults.auth.cursor_api_key_env, "CURSOR_API_KEY"),
            model: cfg.ai.model,
            tagMasterPath: cfg.ai.tags!.master_path,
            maxTags: cfg.ai.tags!.max_tags,
          });
        default: {
          const neverProvider: never = cfg.ai.provider;
          throw new Error(`unsupported ai.provider: ${String(neverProvider)}`);
        }
      }
    })();

    const fixtureDir = path.join(cwd, "test/fixtures/x");
    const xCollector =
      cfg.sources.x.provider === "x-sdk"
        ? createXSdkAdapter({
            bearerToken: envVal(cfg.defaults.auth.x_bearer_token_env, "X_BEARER_TOKEN"),
            oauthAccessToken:
              cfg.sources.x.bookmarks.some((b) => b.enabled) ?
                envVal(
                  cfg.defaults.auth.x_oauth2_access_token_env,
                  "X_OAUTH2_ACCESS_TOKEN",
                )
              : undefined,
          })
        : createXMockAdapter(fixtureDir);

    const now = new Date();
    const targetSet =
      mode.mode === "manual" && mode.targets.length > 0 ?
        new Set(mode.targets.map((t) => t.trim()))
      : null;

    const want = (name: string) =>
      mode.mode === "tick" || !targetSet ? true : targetSet.has(name);

    for (const rss of cfg.sources.rss) {
      if (!rss.enabled) continue;
      if (!want("collect-rss")) continue;
      const jobId = `collect-rss:${rss.id}`;
      const due =
        mode.mode === "manual" ||
        isCronDue(
          rss.schedule,
          (await state.lastJobRun(jobId))?.finished_at ?? null,
          now,
          cfg.timezone,
        );
      if (!due) continue;
      const jr = newId();
      const started = new Date().toISOString();
      await saveJob(state, {
        job_run_id: jr,
        tick_run_id: tickRunId,
        job_id: jobId,
        source_id: rss.id,
        started_at: started,
        status: "running",
      });
      try {
        const result = await collectRssSource({
          cfg,
          rss,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: rss.id,
            status: "success",
            processed: result.processed,
            skipped: result.skipped,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.success += 1;
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: rss.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "success",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: rss.id,
            status: "failed",
            error: msg,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.failed += 1;
        failures.push({
          severity: 2,
          target: jobId,
          source_id: rss.id,
          tick_run_id: tickRunId,
          job_run_id: jr,
          message: msg,
          cause: e,
        });
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: rss.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "failed",
          error_message: msg,
        });
      }
    }

    for (const s of cfg.sources.x.search) {
      if (!s.enabled) continue;
      if (!want("collect-x-search")) continue;
      const jobId = `collect-x-search:${s.id}`;
      const due =
        mode.mode === "manual" ||
        isCronDue(
          s.schedule,
          (await state.lastJobRun(jobId))?.finished_at ?? null,
          now,
          cfg.timezone,
        );
      if (!due) continue;
      const jr = newId();
      const started = new Date().toISOString();
      await saveJob(state, {
        job_run_id: jr,
        tick_run_id: tickRunId,
        job_id: jobId,
        source_id: s.id,
        started_at: started,
        status: "running",
      });
      try {
        const result = await collectXSearch({
          cfg,
          search: s,
          collector: xCollector,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: s.id,
            status: "success",
            processed: result.processed,
            skipped: result.skipped,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.success += 1;
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: s.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "success",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: s.id,
            status: "failed",
            error: msg,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.failed += 1;
        failures.push({
          severity: 2,
          target: jobId,
          source_id: s.id,
          tick_run_id: tickRunId,
          job_run_id: jr,
          message: msg,
          cause: e,
        });
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: s.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "failed",
          error_message: msg,
        });
      }
    }

    for (const L of cfg.sources.x.lists) {
      if (!L.enabled) continue;
      if (!want("collect-x-lists")) continue;
      const jobId = `collect-x-lists:${L.id}`;
      const due =
        mode.mode === "manual" ||
        isCronDue(
          L.schedule,
          (await state.lastJobRun(jobId))?.finished_at ?? null,
          now,
          cfg.timezone,
        );
      if (!due) continue;
      const jr = newId();
      const started = new Date().toISOString();
      await saveJob(state, {
        job_run_id: jr,
        tick_run_id: tickRunId,
        job_id: jobId,
        source_id: L.id,
        started_at: started,
        status: "running",
      });
      try {
        const result = await collectXList({
          cfg,
          list: L,
          collector: xCollector,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: L.id,
            status: "success",
            processed: result.processed,
            skipped: result.skipped,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.success += 1;
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: L.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "success",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: L.id,
            status: "failed",
            error: msg,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.failed += 1;
        failures.push({
          severity: 2,
          target: jobId,
          source_id: L.id,
          tick_run_id: tickRunId,
          job_run_id: jr,
          message: msg,
          cause: e,
        });
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: L.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "failed",
          error_message: msg,
        });
      }
    }

    for (const b of cfg.sources.x.bookmarks) {
      if (!b.enabled) continue;
      if (!want("collect-x-bookmarks")) continue;
      const jobId = `collect-x-bookmarks:${b.id}`;
      const due =
        mode.mode === "manual" ||
        isCronDue(
          b.schedule,
          (await state.lastJobRun(jobId))?.finished_at ?? null,
          now,
          cfg.timezone,
        );
      if (!due) continue;
      const jr = newId();
      const started = new Date().toISOString();
      await saveJob(state, {
        job_run_id: jr,
        tick_run_id: tickRunId,
        job_id: jobId,
        source_id: b.id,
        started_at: started,
        status: "running",
      });
      try {
        const result = await collectXBookmarks({
          cfg,
          bm: b,
          collector: xCollector,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: b.id,
            status: "success",
            processed: result.processed,
            skipped: result.skipped,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.success += 1;
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: b.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "success",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode.mode === "manual") {
          manualResults.push({
            jobId,
            sourceId: b.id,
            status: "failed",
            error: msg,
          });
        }
        outcomeTotals.total += 1;
        outcomeTotals.failed += 1;
        failures.push({
          severity: 2,
          target: jobId,
          source_id: b.id,
          tick_run_id: tickRunId,
          job_run_id: jr,
          message: msg,
          cause: e,
        });
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          source_id: b.id,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "failed",
          error_message: msg,
        });
      }
    }

    if (want("summarize")) {
      for (const job of cfg.jobs.filter((j) => j.type === "summarize" && j.enabled)) {
        const due =
          mode.mode === "manual" ||
          isCronDue(
            job.schedule,
            (await state.lastJobRun(job.id))?.finished_at ?? null,
            now,
            cfg.timezone,
          );
        if (!due) continue;
        const jr = newId();
        const started = new Date().toISOString();
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: job.id,
          started_at: started,
          status: "running",
        });
        try {
          await runSummarizeJob({ cfg, vault, ai, jobId: job.id });
          if (mode.mode === "manual") {
            manualResults.push({ jobId: job.id, status: "success" });
          }
          outcomeTotals.total += 1;
          outcomeTotals.success += 1;
          await saveJob(state, {
            job_run_id: jr,
            tick_run_id: tickRunId,
            job_id: job.id,
            started_at: started,
            finished_at: new Date().toISOString(),
            status: "success",
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (mode.mode === "manual") {
            manualResults.push({ jobId: job.id, status: "failed", error: msg });
          }
          outcomeTotals.total += 1;
          outcomeTotals.failed += 1;
          failures.push({
            severity: 3,
            target: job.id,
            tick_run_id: tickRunId,
            job_run_id: jr,
            message: msg,
            cause: e,
          });
          await saveJob(state, {
            job_run_id: jr,
            tick_run_id: tickRunId,
            job_id: job.id,
            started_at: started,
            finished_at: new Date().toISOString(),
            status: "failed",
            error_message: msg,
          });
        }
      }
    }

    const digestJobs = cfg.jobs.filter((j) => j.type === "digest" && j.enabled);

    for (const job of digestJobs) {
      if (job.type !== "digest" || !job.cadence) continue;
      if (mode.mode === "manual") {
        if (!(want(`digest-${job.cadence}`) || want("digest-all"))) continue;
      }
      const jobId = job.id;
      const due =
        mode.mode === "manual" ||
        isCronDue(
          job.schedule,
          (await state.lastJobRun(jobId))?.finished_at ?? null,
          now,
          cfg.timezone,
        );
      if (!due) continue;
      const prevDigest = await state.lastJobRun(jobId);
      const jr = newId();
      const started = new Date().toISOString();
      await saveJob(state, {
        job_run_id: jr,
        tick_run_id: tickRunId,
        job_id: jobId,
        started_at: started,
        status: "running",
      });
      try {
        await runDigestJob({
          cfg,
          vault,
          job: { ...job, type: "digest", cadence: job.cadence },
          sinceIso: prevDigest?.finished_at ?? null,
          tickRunId,
          jobRunId: jr,
        });
        if (mode.mode === "manual") {
          manualResults.push({ jobId, status: "success" });
        }
        outcomeTotals.total += 1;
        outcomeTotals.success += 1;
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "success",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode.mode === "manual") {
          manualResults.push({ jobId, status: "failed", error: msg });
        }
        outcomeTotals.total += 1;
        outcomeTotals.failed += 1;
        failures.push({
          severity: 3,
          target: jobId,
          tick_run_id: tickRunId,
          job_run_id: jr,
          message: msg,
          cause: e,
        });
        await saveJob(state, {
          job_run_id: jr,
          tick_run_id: tickRunId,
          job_id: jobId,
          started_at: started,
          finished_at: new Date().toISOString(),
          status: "failed",
          error_message: msg,
        });
      }
    }

    for (const f of failures) {
      await dedupAlert.notifyFailure(f);
    }
    await dedupAlert.flush();

    const code = aggregateExit(failures);
    if (mode.mode === "manual") {
      printManualSummary({
        tickRunId,
        results: manualResults,
        exitCode: code,
        failures: failures.length,
      });
    }
    log.info({
      msg: "tick_done",
      exit: code,
      failures: failures.length,
      total: outcomeTotals.total,
      success: outcomeTotals.success,
      failed: outcomeTotals.failed,
    });
    return code;
  } catch (e) {
    log.error(toSafeErrorLog(e));
    process.stderr.write("orchestration_error\n");
    return 1;
  } finally {
    state.releaseTickLock(tickRunId);
    await state.close();
    perTickLoggers.delete(tickRunId);
  }
}
