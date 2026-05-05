import YAML from "yaml";

import type { BaseConfig } from "./types.js";

function filtersDoc(filters: string[]): unknown {
  if (filters.length === 0) return undefined;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

/** Serialize Obsidian Bases `.base` file body (YAML only). */
export function renderBaseYaml(cfg: BaseConfig): string {
  const doc: Record<string, unknown> = {};
  const f = filtersDoc(cfg.filters);
  if (f !== undefined) doc.filters = f;
  if (cfg.formulas && Object.keys(cfg.formulas).length > 0) doc.formulas = cfg.formulas;
  if (cfg.properties && Object.keys(cfg.properties).length > 0) {
    doc.properties = cfg.properties;
  }
  if (cfg.summaries && Object.keys(cfg.summaries).length > 0) {
    doc.summaries = cfg.summaries;
  }
  doc.views = cfg.views.map((v) => {
    const row: Record<string, unknown> = { type: v.type, name: v.name };
    if (v.order !== undefined && v.order.length > 0) row.order = v.order;
    if (v.limit !== undefined) row.limit = v.limit;
    return row;
  });
  return `${YAML.stringify(doc).trimEnd()}\n`;
}
