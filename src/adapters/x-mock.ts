import fs from "node:fs";

import { xContentHash } from "../hash.js";
import type { ObsidianSourceKind, SourceItem } from "../types.js";
import type { XCollectorAdapter } from "./interfaces.js";

interface MockPost {
  id: string;
  text?: string;
  author_id?: string;
  urls?: string[];
  created_at?: string;
}

function loadPosts(path: string): MockPost[] {
  const raw = fs.readFileSync(path, "utf8");
  const data = JSON.parse(raw) as { posts?: MockPost[] };
  return data.posts ?? [];
}

function toItems(
  posts: MockPost[],
  source: ObsidianSourceKind,
  sourceId: string,
): SourceItem[] {
  return posts.map((p) => {
    const urls = p.urls ?? [];
    const text = p.text ?? "";
    const hash = xContentHash({
      text,
      urls,
      authorId: p.author_id ?? "",
    });
    return {
      source,
      sourceId,
      source_item_key: p.id,
      content_hash: hash,
      title: text.slice(0, 80) || p.id,
      rawText: text,
      publishedAt: p.created_at,
      authorId: p.author_id,
      canonicalUrl: urls[0],
    };
  });
}

export function createXMockAdapter(baseFixtureDir: string): XCollectorAdapter {
  return {
    async collectSearch(sourceId: string, _query: string): Promise<SourceItem[]> {
      const path = `${baseFixtureDir}/search-${sourceId}.json`;
      const posts = loadPosts(path);
      return toItems(posts, "x-search", sourceId);
    },
    async collectList(sourceId: string, _listId: string): Promise<SourceItem[]> {
      const path = `${baseFixtureDir}/list-${sourceId}.json`;
      const posts = loadPosts(path);
      return toItems(posts, "x-list", sourceId);
    },
    async collectBookmarks(sourceId: string): Promise<SourceItem[]> {
      const path = `${baseFixtureDir}/bookmarks-${sourceId}.json`;
      const posts = loadPosts(path);
      return toItems(posts, "x-bookmarks", sourceId);
    },
  };
}
