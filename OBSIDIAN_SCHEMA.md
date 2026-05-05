# Obsidian Data Schema (Notion Property Based)

最終更新: 2026-05-04

## 1. 目的

`https://secure-brigade.notion.site/24-9ac9d1c1d6544b2594e8e3cbf72491b8` のプロパティを基に、
Obsidian ノート (1 ソース = 1 レコード) の frontmatter スキーマを定義する。

本スキーマは、`ARCHITECTURE_OVERVIEW.md` / `DETAILED_DESIGN.md` と整合する最小構成を優先する。

## 2. ソースとなる Notion プロパティ

取得できたプロパティ名:

- source
- status
- aiDrafted
- category
- tags
- createdAt
- updatedAt
- wantTry/wantRead
- Files & media
- summary

## 3. Obsidian frontmatter への対応

> 注: Notion 側の厳密型情報はこの参照方法では取得できないため、型は運用上の推奨を示す。

| Notion property | Obsidian key | Type | Required | Example | Notes |
|---|---|---|---|---|---|
| source | `source` | string | yes | `x-search` | 収集元種別 (`rss`, `x-search`, `x-list`, `x-bookmarks`, `manual-web`, `manual-youtube`) |
| status | `status` | string | yes | `captured` | `captured`, `summarized`, `failed` など |
| aiDrafted | `ai_drafted` | boolean | yes | `true` | AI 要約が初稿生成済みか |
| category | `category` | string | no | `papers` | 主分類 |
| tags | `tags` | array[string] | no | `["digital_identity", "privacy"]` | 関連タグ |
| createdAt | `created_at` | datetime (ISO8601) | yes | `2025-01-26T08:08:00+09:00` | レコード作成時刻 |
| updatedAt | `updated_at` | datetime (ISO8601) | yes | `2025-08-16T13:53:00+09:00` | レコード更新時刻 |
| wantTry/wantRead | `intent` | array[string] | no | `["wantRead"]` | `wantTry`, `wantRead` の複数選択可 |
| Files & media | `attachments` | array[object] | no | `[{name: "kk44-1-1.pdf", path: "assets/kk44-1-1.pdf"}]` | 添付ファイル参照 |
| summary | `summary` | string | no | `...` | 要約本文の短縮版 |

## 4. 必須追加キー (システム運用用)

Notion プロパティにはないが、パイプライン運用上必須のキー:

| Key | Type | Required | Example | Purpose |
|---|---|---|---|---|
| `record_id` | string (uuid) | yes | `0195a2ce-...` | レコード一意識別子 |
| `source_item_key` | string | yes | `1890011223344556677` | X tweet ID / RSS guid など |
| `content_hash` | string | yes | `sha256:...` | 重複判定 |
| `tick_run_id` | string (uuid) | yes | `0195a2ce-...` | どの tick 実行で処理されたか |
| `job_run_id` | string (uuid) | yes | `0195a2ce-...` | どの job 実行で処理されたか |
| `schema_version` | integer | yes | `1` | スキーマ移行管理 |

UUID は TypeScript の `crypto.randomUUID()` (`globalThis.crypto` / `node:crypto`) で生成する。

## 5. 推奨 frontmatter 例

```yaml
---
record_id: "0195a2ce-8f8b-7f1a-b65d-7fa5c7a0f6fb"
schema_version: 1

source: "rss"
source_item_key: "https://example.com/posts/123"
content_hash: "sha256:1f93..."

status: "captured"
ai_drafted: false
category: "papers"
tags: ["digital_identity", "privacy"]
intent: ["wantRead"]

created_at: "2025-01-26T08:08:00+09:00"
updated_at: "2025-01-26T08:08:00+09:00"

attachments:
  - name: "kk44-1-1.pdf"
    path: "assets/kk44-1-1.pdf"

summary: ""

tick_run_id: "0195a2ce-8f8c-77c1-bb99-8eb71fa1f880"
job_run_id: "0195a2ce-8f8d-781f-9f42-b08cf7054ca4"
---
```

## 6. 本文セクションの規約

frontmatter とは別に本文側は以下を持つ。

- `## Raw Content` (収集本文)
- `## AI Summary` (要約; 更新対象)

`DETAILED_DESIGN.md` で定義した通り、要約更新時は `## AI Summary` セクションのみ置換する。

## 7. 未確定事項

以下は後続で調整する:

- `status` の許容値厳密定義
- `category` / `tags` の統制語彙
- `intent` を単一値にするか複数値にするか
- 添付ファイルの保存戦略 (Vault 直下 or 外部ストレージ参照)
