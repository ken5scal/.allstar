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
import { createAiMockAdapter } from "./adapters/ai-mock.js";
import { createAiRealStubAdapter } from "./adapters/ai-real.js";
import { SqliteStateRepository } from "./adapters/state-sqlite.js";
import { createVaultAgentAdapter } from "./adapters/vault-agent.js";
import { createVaultMockAdapter } from "./adapters/vault-mock.js";
import { createXMockAdapter } from "./adapters/x-mock.js";
import { createXSdkAdapter } from "./adapters/x-sdk.js";
import {
  collectRssSource,
  collectXBookmarks,
  collectXList,
  collectXSearch,
} from "./jobs/collect.js";
import { runDigestJob } from "./jobs/digest.js";
import { runSummarizeJob } from "./jobs/summarize.js";

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
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

function aggregateExit(failures: FailureReport[]): ExitSeverity {
  if (failures.some((f) => f.severity === 1)) return 1;
  if (failures.some((f) => f.severity === 2)) return 2;
  if (failures.some((f) => f.severity === 3)) return 3;
  return 0;
}

async function saveJob(
  state: SqliteStateRepository,
  run: JobRun,
): Promise<void> {
  await state.saveJobRun(run);
}

export async function runValidate(
  configPath: string,
  cwd: string,
): Promise<void> {
  const raw = loadConfigFile(configPath);
  const cfg = normalizeConfig(raw, cwd);
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

  let cfg: ObsflowConfig;
  try {
    const raw = loadConfigFile(configPath);
    cfg = normalizeConfig(raw, cwd);
    validateConfigEnv(cfg);
  } catch (e) {
    log.error({ err: e, msg: "config_error" });
    process.stderr.write(String(e) + "\n");
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

  const state = new SqliteStateRepository(cfg.defaults.state.dsn);
  const lockOk = state.tryAcquireTickLock(tickRunId, 60 * 60 * 1000);
  if (!lockOk) {
    log.warn({ msg: "tick_lock_busy" });
    await state.close();
    return 3;
  }

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

  const ai =
    cfg.ai.provider === "real"
      ? createAiRealStubAdapter()
      : createAiMockAdapter();

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
    mode.mode === "manual" ? new Set(mode.targets.map((t) => t.trim())) : null;

  const want = (name: string) =>
    mode.mode === "tick" || !targetSet ? true : targetSet.has(name);

  try {
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
        await collectRssSource({
          cfg,
          rss,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
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
        await collectXSearch({
          search: s,
          collector: xCollector,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
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
        await collectXList({
          list: L,
          collector: xCollector,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
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
        await collectXBookmarks({
          bm: b,
          collector: xCollector,
          state,
          vault,
          tickRunId,
          jobRunId: jr,
        });
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
    log.info({ msg: "tick_done", exit: code, failures: failures.length });
    return code;
  } finally {
    state.releaseTickLock(tickRunId);
    await state.close();
  }
}
