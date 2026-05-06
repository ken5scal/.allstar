import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadTagMasterFile } from "../../src/tag-master.js";

const mockCfgDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

describe("tag master file", () => {
  it("loads valid fixture", () => {
    const f = loadTagMasterFile(path.join(mockCfgDir, "tag-master.min.yaml"));
    expect(f.tags).toContain("alpha");
    expect(f.tags.length).toBe(4);
  });

  it("rejects duplicates", () => {
    expect(() =>
      loadTagMasterFile(path.join(mockCfgDir, "tag-master.bad-dup.yaml")),
    ).toThrow(/duplicate/);
  });

  it("rejects empty tag list", () => {
    expect(() =>
      loadTagMasterFile(path.join(mockCfgDir, "tag-master.bad-empty.yaml")),
    ).toThrow(/non-empty/);
  });
});
