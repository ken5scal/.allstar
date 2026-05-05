# Obsidian Data Schema

最終更新: 2026-05-05

## 1. 目的

Obsidian ノート (1 ソース = 1 レコード) の frontmatter スキーマを定義する。

本スキーマは、`ARCHITECTURE_OVERVIEW.md` / `DETAILED_DESIGN.md` と整合する最小構成を優先する。

## 2. Obsidian frontmatter への対応

| Field | Obsidian key | Data shape | Obsidian property type (UI) | Required | Example | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| source_type | `source_type` | string (enum, single value) | Text | yes | `x-search` | 収集元種別。**List ではない**。許容値は下記 `source_type` enum に固定する |
| source URL | `source` | string (URL) | Text | yes | `https://example.com/posts/123` | 元コンテンツの正規化URL |
| source identifier | `source_id` | string | Text | yes | `hn` | 収集設定上の識別子（例: RSS source id） |
| status | `status` | string (enum, single value) | Text | yes | `captured` | **List ではない**。1レコードにつき 1 値のみ。許容値は下記 `status` enum に固定する |
| category | `category` | string (enum, single value) | Text | yes | `papers` | **List ではない**。1レコードにつき 1 値のみ。許容値は下記 `category` enum に固定する |
| tags | `tags` | array[string] | List (or Tags) | no | `["digital_identity", "privacy"]` | 初期登録時は設定しない。後続の AI 分類・要約処理で付与する |
| createdAt | `created_at` | datetime (ISO8601) | Date & time | yes | `2025-01-26T08:08:00+09:00` | レコード作成時刻 |
| updatedAt | `updated_at` | datetime (ISO8601) | Date & time | yes | `2025-08-16T13:53:00+09:00` | レコード更新時刻 |
| Files & media | `attachments` | array[object] | List | no | `[{name: "kk44-1-1.pdf", path: "assets/kk44-1-1.pdf"}]` | 添付ファイル参照 |
| summary | `summary` | string | Text | no | `...` | 要約本文の短縮版 |
| schema version | `schema_version` | integer | Number | yes | `1` | スキーマ移行管理 |
| record kind | `record_kind` | string (enum) | Text | yes | `obsflow-record` | Bases 等で行を識別 |
| base ids | `base_ids` | array[string] | List | no | `["all-records"]` | 任意。現時点では必須ではなく、既定 Base は `record_kind` フィルタで成立する。将来の複数 Base 運用・振り分け拡張に備えた補助キーとして保持する |
| source group | `source_group` | string | Text | yes | `rss` | パス・フィルタ用に `rss` / `sns` / `web` / `youtube` など |
| origin hint | `origin` | string | Text | no | `example.com` | 取得元の補助表示（URL hostname 等） |
| published at | `published_at` | datetime (ISO8601) | Date & time | no | `2026-05-04T12:00:00Z` | 取得元から得られた公開日時 |
| captured at | `captured_at` | datetime (ISO8601) | Date & time | yes | `2026-05-05T06:30:00Z` | Vault へ取り込んだ時刻（パス日付の既定ソース） |

### 2.1 `source_type` enum (single-select)

`source_type` は次のいずれか 1 つのみを取る。

- `rss`
- `x-search`
- `x-list`
- `x-bookmarks`
- `manual-web`
- `manual-youtube`

> 実装上の注意: Obsidian 側の型は `Text` として保持し、値制約（enum）はアプリケーションロジックまたは Bases のフィルタで担保する。

### 2.2 `status` enum (single-select)

`status` は次のいずれか 1 つのみを取る。

- `captured` - 収集直後（未処理）
- `summarized` - AI 要約処理済み
- `failed` - 処理失敗（再処理対象）
- `unread` - 未読
- `glance` - ざっと確認済み
- `read` - 読了
- `digested` - digest 化・整理済み

> 実装上の注意: Obsidian 側の型は `Text` として保持し、値制約（enum）はアプリケーションロジックまたは Bases のフィルタで担保する。

### 2.3 `category` enum (single-select)

`category` は次のいずれか 1 つのみを取る。

- `books`
- `reports`
- `presentations`
- `podcasts`
- `papers`
- `standards`
- `specs`
- `blogs`
- `oss`
- `policies`
- `lectures`
- `hands_on`
- `sns`

> 実装上の注意: Obsidian 側の型は `Text` として保持し、値制約（enum）はアプリケーションロジックまたは Bases のフィルタで担保する。

## 3. 実行トラッキングキー

### 2.4 `base_ids` の運用方針

- `base_ids` は **任意**。単一 Base 運用では未使用でも動作上の問題はない。
- 既定の `Records.base` は `record_kind == "obsflow-record"` で拾うため、`base_ids` がなくても表示対象判定はできる。
- 一方で、将来 `all-records` / `rss-records` / `to-read` など複数 Base を使い分ける際に、`base_ids` をフィルタ条件として利用できる。
- このため初期実装では、将来拡張を見据えて `base_ids` を frontmatter に保持する。

`tick_run_id` と `job_run_id` は TypeScript の `crypto.randomUUID()` (`globalThis.crypto` / `node:crypto`) で生成する。

### 3.1 親子関係

- `tick_run_id` は `obsflow tick` 1 回全体の実行 ID（親）
- `job_run_id` は同一 tick 内で実行される各ジョブの実行 ID（子）
- 1 つの `tick_run_id` に対して、`job_run_id` は 0..N 件ぶら下がる
- ジョブ開始/終了（success/failed）ログは、`tick_run_id` と `job_run_id` を同時に出力して相関可能にする

## 4. 推奨 frontmatter 例

```yaml
---
schema_version: 1

record_kind: "obsflow-record"
base_ids:
  - "all-records"

source_type: "rss"
source: "https://example.com/posts/123"
source_id: "hn"
source_group: "rss"
origin: "example.com"

status: "captured"
category: "papers"

published_at: "2026-05-04T12:00:00Z"
captured_at: "2026-05-05T06:30:00Z"
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

## 5. 本文セクションの規約

frontmatter とは別に本文側は以下を持つ。

- `## Raw Content` (収集本文)
- `## AI Summary` (要約; 更新対象)

`DETAILED_DESIGN.md` で定義した通り、要約更新時は `## AI Summary` セクションのみ置換する。

## 6. 未確定事項

以下は後続で調整する:

- `tags` の統制語彙
- 添付ファイルの保存戦略（当面は Vault 直下）
