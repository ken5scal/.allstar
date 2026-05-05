import fs from "node:fs";

import { sourceItemsFromFeedXml } from "./feedsmith.js";
import type { RssAdapter } from "./interfaces.js";
import type { ObsidianSourceKind, SourceItem } from "../types.js";

export function createRssMockAdapter(opts: {
  sourceId: string;
  fixturePath: string;
  kind: ObsidianSourceKind;
}): RssAdapter {
  return {
    async collect(): Promise<SourceItem[]> {
      const xml = fs.readFileSync(opts.fixturePath, "utf8");
      return sourceItemsFromFeedXml(xml, opts.sourceId, opts.kind);
    },
  };
}
