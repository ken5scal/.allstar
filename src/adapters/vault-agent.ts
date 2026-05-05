import fs from "node:fs";
import path from "node:path";

import { Agent } from "@cursor/sdk";

import { parseVaultNote, renderVaultNote, replaceAiSummarySection } from "../note.js";
import { renderBaseYaml } from "../base.js";
import type { BaseConfig, VaultRecord } from "../types.js";
import type { VaultAdapter } from "./interfaces.js";

const MODEL_ID = "composer-2";

export function createVaultAgentAdapter(opts: {
  vaultRoot: string;
  apiKey: string;
}): VaultAdapter {
  const root = opts.vaultRoot;
  return {
    async upsertRecord(record: VaultRecord, noteRelPath: string): Promise<void> {
      const markdown = renderVaultNote(record);
      const agent = await Agent.create({
        apiKey: opts.apiKey,
        model: { id: MODEL_ID },
        local: { cwd: root, settingSources: [] },
      });
      try {
        const prompt = [
          "Create or replace this Obsidian note using workspace-relative path.",
          `Path: ${noteRelPath}`,
          "Use Obsidian-flavored markdown. Keep exactly this file content:",
          "",
          "```markdown",
          markdown.trimEnd(),
          "```",
        ].join("\n");
        const run = await agent.send(prompt);
        const result = await run.wait();
        if (result.status === "error") {
          throw new Error(`agent vault upsert failed run=${result.id}`);
        }
      } finally {
        await agent[Symbol.asyncDispose]();
      }
    },
    async upsertBase(base: BaseConfig): Promise<void> {
      if (base.mode === "reference") return;
      const full = path.join(root, base.path);
      if (base.mode === "create_if_missing" && fs.existsSync(full)) return;
      const agent = await Agent.create({
        apiKey: opts.apiKey,
        model: { id: MODEL_ID },
        local: { cwd: root, settingSources: [] },
      });
      try {
        const body = renderBaseYaml(base);
        const prompt = [
          "Create or replace this Obsidian Bases file using workspace-relative path.",
          `Path: ${base.path}`,
          "The file extension must be .base and the content must match exactly:",
          "",
          "```yaml",
          body.trimEnd(),
          "```",
        ].join("\n");
        const run = await agent.send(prompt);
        const result = await run.wait();
        if (result.status === "error") {
          throw new Error(`agent vault base upsert failed run=${result.id}`);
        }
      } finally {
        await agent[Symbol.asyncDispose]();
      }
    },
    async updateAiSummary(
      noteRelPath: string,
      aiSummaryMarkdown: string,
      patch,
    ): Promise<void> {
      const full = path.join(root, noteRelPath);
      if (!fs.existsSync(full)) {
        throw new Error(`note missing: ${noteRelPath}`);
      }
      const prev = fs.readFileSync(full, "utf8");
      const rec = parseVaultNote(prev);
      if (!rec) throw new Error(`invalid note: ${noteRelPath}`);
      const merged: VaultRecord = {
        ...rec,
        aiSummary: aiSummaryMarkdown,
        ...patch,
      };
      const md = replaceAiSummarySection(prev, aiSummaryMarkdown);
      const re = parseVaultNote(md);
      const finalRec = re ? { ...re, ...patch, aiSummary: aiSummaryMarkdown } : merged;
      fs.writeFileSync(full, renderVaultNote(finalRec), "utf8");
    },
    async listNotePathsUnder(prefix: string): Promise<string[]> {
      const base = path.join(root, prefix);
      if (!fs.existsSync(base)) return [];
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const name of fs.readdirSync(dir)) {
          const p = path.join(dir, name);
          const st = fs.statSync(p);
          if (st.isDirectory()) walk(p);
          else if (name.endsWith(".md")) out.push(path.relative(root, p));
        }
      };
      walk(base);
      return out;
    },
    async readRecord(noteRelPath: string): Promise<VaultRecord | null> {
      const full = path.join(root, noteRelPath);
      if (!fs.existsSync(full)) return null;
      return parseVaultNote(fs.readFileSync(full, "utf8"));
    },
  };
}
