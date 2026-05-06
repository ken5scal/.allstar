import fs from "node:fs";

import YAML from "yaml";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface TagMasterFile {
  version: number;
  source?: string;
  updated_at?: string;
  tags: string[];
}

/** Load and validate tag master YAML (sync). Throws on empty list, duplicates, or invalid shape. */
export function loadTagMasterFile(absPath: string): TagMasterFile {
  const rawText = fs.readFileSync(absPath, "utf8");
  const doc = YAML.parse(rawText) as unknown;
  if (!isRecord(doc)) throw new Error(`tag master ${absPath}: root must be a mapping`);
  const ver = doc.version;
  if (typeof ver !== "number" || !Number.isInteger(ver)) {
    throw new Error(`tag master ${absPath}: version must be an integer`);
  }
  const tagsRawUnknown = doc.tags;
  if (!Array.isArray(tagsRawUnknown)) {
    throw new Error(`tag master ${absPath}: tags must be an array`);
  }
  const tagsRaw = tagsRawUnknown as unknown[];
  if (tagsRaw.length === 0) {
    throw new Error(`tag master ${absPath}: tags must be non-empty`);
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tagsRaw.length; i++) {
    const t = tagsRaw[i];
    if (typeof t !== "string" || !t.trim().length) {
      throw new Error(`tag master ${absPath}: tags[${i}] must be a non-empty string`);
    }
    const norm = t;
    if (seen.has(norm)) {
      throw new Error(`tag master ${absPath}: duplicate tag "${norm}"`);
    }
    seen.add(norm);
    tags.push(norm);
  }
  const source = doc.source;
  const updated_at = doc.updated_at;
  return {
    version: ver,
    ...(typeof source === "string" ? { source } : {}),
    ...(typeof updated_at === "string" ? { updated_at } : {}),
    tags,
  };
}

export function tagMasterSet(file: TagMasterFile): Set<string> {
  return new Set(file.tags);
}
