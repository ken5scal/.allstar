import fs from "node:fs";

import YAML from "yaml";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface CategoryMasterFile {
  version: number;
  source?: string;
  updated_at?: string;
  categories: string[];
}

/** Load and validate category master YAML (sync). Throws on empty list, duplicates, or invalid shape. */
export function loadCategoryMasterFile(absPath: string): CategoryMasterFile {
  const rawText = fs.readFileSync(absPath, "utf8");
  const doc = YAML.parse(rawText) as unknown;
  if (!isRecord(doc)) throw new Error(`category master ${absPath}: root must be a mapping`);
  const ver = doc.version;
  if (typeof ver !== "number" || !Number.isInteger(ver)) {
    throw new Error(`category master ${absPath}: version must be an integer`);
  }
  const categoriesRawUnknown = doc.categories;
  if (!Array.isArray(categoriesRawUnknown)) {
    throw new Error(`category master ${absPath}: categories must be an array`);
  }
  const categoriesRaw = categoriesRawUnknown as unknown[];
  if (categoriesRaw.length === 0) {
    throw new Error(`category master ${absPath}: categories must be non-empty`);
  }
  const categories: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < categoriesRaw.length; i++) {
    const c = categoriesRaw[i];
    if (typeof c !== "string" || !c.trim().length) {
      throw new Error(`category master ${absPath}: categories[${i}] must be a non-empty string`);
    }
    const norm = c;
    if (seen.has(norm)) {
      throw new Error(`category master ${absPath}: duplicate category "${norm}"`);
    }
    seen.add(norm);
    categories.push(norm);
  }
  const source = doc.source;
  const updated_at = doc.updated_at;
  return {
    version: ver,
    ...(typeof source === "string" ? { source } : {}),
    ...(typeof updated_at === "string" ? { updated_at } : {}),
    categories,
  };
}

export function categoryMasterSet(file: CategoryMasterFile): Set<string> {
  return new Set(file.categories);
}
