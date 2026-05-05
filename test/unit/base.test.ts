import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { renderBaseYaml } from "../../src/base.js";
import type { BaseConfig } from "../../src/types.js";

describe("renderBaseYaml", () => {
  it("emits single filter as string and multiple as and-array", () => {
    const one: BaseConfig = {
      id: "t",
      path: "T.base",
      mode: "managed",
      filters: ['record_kind == "obsflow-record"'],
      views: [{ type: "table", name: "V", order: ["file.name"] }],
    };
    const doc1 = YAML.parse(renderBaseYaml(one)) as Record<string, unknown>;
    expect(typeof doc1.filters).toBe("string");

    const two: BaseConfig = {
      id: "t2",
      path: "T2.base",
      mode: "managed",
      filters: ['a == "1"', 'b == "2"'],
      views: [{ type: "list", name: "L" }],
    };
    const doc2 = YAML.parse(renderBaseYaml(two)) as {
      filters: { and: string[] };
    };
    expect(doc2.filters.and).toHaveLength(2);
  });
});
