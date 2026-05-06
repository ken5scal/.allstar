import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadCategoryMasterFile } from "../../src/category-master.js";

const mockCfgDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);
const repo = path.join(mockCfgDir, "..", "..");

describe("category master file", () => {
  it("loads valid fixture", () => {
    const f = loadCategoryMasterFile(path.join(mockCfgDir, "category-master.min.yaml"));
    expect(f.categories).toEqual(["blogs", "papers", "sns"]);
  });

  it("rejects duplicates", () => {
    expect(() =>
      loadCategoryMasterFile(path.join(mockCfgDir, "category-master.bad-dup.yaml")),
    ).toThrow(/duplicate/);
  });

  it("rejects empty category list", () => {
    expect(() =>
      loadCategoryMasterFile(path.join(mockCfgDir, "category-master.bad-empty.yaml")),
    ).toThrow(/non-empty/);
  });

  it("keeps repository category master in sync with OBSIDIAN_SCHEMA category enum", () => {
    const master = loadCategoryMasterFile(path.join(repo, "config", "category-master.yaml"));
    const schema = fs.readFileSync(path.join(repo, "docs", "OBSIDIAN_SCHEMA.md"), "utf8");
    const match = schema.match(/### 2\.3 `category` enum[\s\S]*?(?=\n> 実装上の注意:)/);
    expect(match).not.toBeNull();
    const categories = [...match![0].matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
    expect(master.categories).toEqual(categories);
  });
});
