import path from "node:path";

import { Command } from "commander";

import { loadEnvFile } from "./load-env.js";
import { runManual, runTick, runValidate } from "./orchestrator.js";

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
    .requiredOption("--targets <csv>", "comma-separated targets")
    .action(async (opts: { config: string; targets: string }) => {
      const p = path.resolve(opts.config);
      const targets = opts.targets.split(",").map((s) => s.trim()).filter(Boolean);
      const code = await runManual(p, process.cwd(), targets);
      process.exitCode = code;
    });

  await program.parseAsync(argv, { from: "node" });
}
