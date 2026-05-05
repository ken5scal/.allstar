import fs from "node:fs";
import path from "node:path";

import { parseVaultNote, renderVaultNote, replaceAiSummarySection } from "../note.js";
import { ensureDir } from "../paths.js";
import type { VaultRecord } from "../types.js";
import type { VaultAdapter } from "./interfaces.js";

export function createVaultMockAdapter(vaultRoot: string): VaultAdapter {
  const root = vaultRoot;
  return {
    async upsertRecord(record: VaultRecord, noteRelPath: string): Promise<void> {
      const full = path.join(root, noteRelPath);
      ensureDir(path.dirname(full));
      fs.writeFileSync(full, renderVaultNote(record), "utf8");
    },
    async updateAiSummary(
      noteRelPath: string,
      aiSummaryMarkdown: string,
      patch,
    ): Promise<void> {
      const full = path.join(root, noteRelPath);
      const prev = fs.readFileSync(full, "utf8");
      const rec = parseVaultNote(prev);
      if (!rec) throw new Error(`invalid note: ${noteRelPath}`);
      const nextFm = {
        ...rec,
        aiSummary: aiSummaryMarkdown,
        ...patch,
      } satisfies VaultRecord;
      const md = replaceAiSummarySection(prev, aiSummaryMarkdown);
      const reParsed = parseVaultNote(md);
      if (!reParsed) throw new Error("replace failed");
      const merged: VaultRecord = { ...reParsed, ...nextFm };
      fs.writeFileSync(full, renderVaultNote(merged), "utf8");
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
