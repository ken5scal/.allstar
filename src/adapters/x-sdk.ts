import { Client } from "@xdevplatform/xdk";

import { xContentHash } from "../hash.js";
import { stringFromUnknown } from "../string-utils.js";
import type { ObsidianSourceKind, SourceItem } from "../types.js";
import type { XCollectorAdapter } from "./interfaces.js";

function extractTweetArray(res: unknown): Array<Record<string, unknown>> {
  const r = res as { data?: unknown[] };
  if (!Array.isArray(r.data)) return [];
  return r.data.filter((x) => x && typeof x === "object") as Array<
    Record<string, unknown>
  >;
}

function urlsFromTweet(t: Record<string, unknown>): string[] {
  const ent = t.entities as Record<string, unknown> | undefined;
  const urls = ent?.urls as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(urls)) return [];
  return urls
    .map(
      (u) =>
        stringFromUnknown(u.expanded_url) || stringFromUnknown(u.url) || "",
    )
    .filter(Boolean);
}

function tweetToItem(
  t: Record<string, unknown>,
  source: ObsidianSourceKind,
  sourceId: string,
): SourceItem {
  const id = stringFromUnknown(t.id);
  const text = stringFromUnknown(t.text);
  const authorId = String(
    (t.author_id as string) ??
      ((t.author as Record<string, unknown> | undefined)?.id as string) ??
      "",
  );
  const createdRaw = stringFromUnknown(t.created_at);
  const created = createdRaw || undefined;
  const urls = urlsFromTweet(t);
  const hash = xContentHash({ text, urls, authorId });
  return {
    source,
    sourceId,
    source_item_key: id,
    content_hash: hash,
    title: text.slice(0, 120) || id,
    rawText: text,
    publishedAt: created,
    authorId,
    canonicalUrl: urls[0],
  };
}

export function createXSdkAdapter(opts: {
  bearerToken: string;
  oauthAccessToken?: string;
}): XCollectorAdapter {
  const bearerClient = new Client({ bearerToken: opts.bearerToken });
  const userClient = opts.oauthAccessToken
    ? new Client({ accessToken: opts.oauthAccessToken })
    : null;

  return {
    async collectSearch(sourceId: string, query: string): Promise<SourceItem[]> {
      const res = await bearerClient.posts.searchRecent(query, {
        maxResults: 100,
        "tweet.fields": ["created_at", "author_id", "entities"],
      });
      return extractTweetArray(res).map((t) =>
        tweetToItem(t, "x-search", sourceId),
      );
    },
    async collectList(sourceId: string, listId: string): Promise<SourceItem[]> {
      const res = await bearerClient.lists.getPosts(listId, {
        maxResults: 100,
        "tweet.fields": ["created_at", "author_id", "entities"],
      });
      return extractTweetArray(res).map((t) => tweetToItem(t, "x-list", sourceId));
    },
    async collectBookmarks(sourceId: string): Promise<SourceItem[]> {
      if (!userClient) {
        throw new Error("x-sdk bookmarks require OAuth2 access token");
      }
      const me = await userClient.users.getMe({ "user.fields": ["id"] });
      const meData = me as { data?: { id?: string } };
      const uid = meData.data?.id;
      if (!uid) throw new Error("getMe did not return user id");
      const res = await userClient.users.getBookmarks(uid, {
        maxResults: 100,
        "tweet.fields": ["created_at", "author_id", "entities"],
      });
      return extractTweetArray(res).map((t) =>
        tweetToItem(t, "x-bookmarks", sourceId),
      );
    },
  };
}
