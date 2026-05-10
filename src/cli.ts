import path from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { loadEnvFile } from "./load-env.js";
import { runManual, runTick, runValidate } from "./orchestrator.js";
import type { RssBootstrapConfig } from "./types.js";

type RunCommandOptions = {
  config: string;
  targets?: string;
  bootstrapAllRss?: boolean;
  bootstrapMaxInitialItems?: number;
  bootstrapPublishedWithinDays?: number;
};

function parsePositiveIntOption(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function resolveRunBootstrapAllRssOverride(
  opts: Pick<
    RunCommandOptions,
    | "bootstrapAllRss"
    | "bootstrapMaxInitialItems"
    | "bootstrapPublishedWithinDays"
  >,
): RssBootstrapConfig | undefined {
  const hasBootstrapValues =
    opts.bootstrapMaxInitialItems !== undefined ||
    opts.bootstrapPublishedWithinDays !== undefined;
  if (!opts.bootstrapAllRss) {
    if (hasBootstrapValues) {
      throw new Error(
        "--bootstrap-max-initial-items and --bootstrap-published-within-days require --bootstrap-all-rss",
      );
    }
    return undefined;
  }
  if (!hasBootstrapValues) {
    throw new Error(
      "--bootstrap-all-rss requires at least one of --bootstrap-max-initial-items or --bootstrap-published-within-days",
    );
  }
  return {
    ...(opts.bootstrapMaxInitialItems !== undefined ?
      { max_initial_items: opts.bootstrapMaxInitialItems }
    : {}),
    ...(opts.bootstrapPublishedWithinDays !== undefined ?
      { published_within_days: opts.bootstrapPublishedWithinDays }
    : {}),
  };
}

export async function runCli(argv: string[]): Promise<void> {
  loadEnvFile();

  const program = new Command();
  program.name("obsflow").description("Obsidian ingest + digest pipeline");

  program
    .command("validate")
    .requiredOption("--config <path>", "path to config.yaml")
    .action(async (opts: { config: string }) => {
      const p = path.resolve(opts.config);
      await runValidate(p, process.cwd());
    });

  program
    .command("tick")
    .requiredOption("--config <path>", "path to config.yaml")
    .action(async (opts: { config: string }) => {
      const p = path.resolve(opts.config);
      const code = await runTick(p, process.cwd());
      process.exitCode = code;
    });

  program
    .command("run")
    .requiredOption("--config <path>", "path to config.yaml")
    .option("--targets <csv>", "comma-separated targets (omit to run all enabled jobs)")
    .option(
      "--bootstrap-all-rss",
      "apply CLI bootstrap limits to all RSS sources for this manual run",
    )
    .option(
      "--bootstrap-max-initial-items <n>",
      "first-run RSS bootstrap limit applied to all RSS sources when --bootstrap-all-rss is set",
      (value) => parsePositiveIntOption(value, "--bootstrap-max-initial-items"),
    )
    .option(
      "--bootstrap-published-within-days <days>",
      "first-run RSS bootstrap age window applied to all RSS sources when --bootstrap-all-rss is set",
      (value) =>
        parsePositiveIntOption(value, "--bootstrap-published-within-days"),
    )
    .action(async (opts: RunCommandOptions) => {
      let rssBootstrapAll: RssBootstrapConfig | undefined;
      try {
        rssBootstrapAll = resolveRunBootstrapAllRssOverride(opts);
      } catch (error) {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
        return;
      }
      const p = path.resolve(opts.config);
      const targets =
        opts.targets?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
      const code = await runManual(p, process.cwd(), targets, {
        rssBootstrapAll,
      });
      process.exitCode = code;
    });

  await program.parseAsync(argv, { from: "node" });
}
