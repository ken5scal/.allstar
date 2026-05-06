# summarize 可観測性・本文欠落マーキング・category 統制 計画

最終更新: 2026-05-06

## 1. 目的

本計画は、次スコープで扱う以下 3 つの運用改善をまとめる。

1. summarize 実行時に、対象件数・処理記事・失敗記事をログから特定できるようにする。
2. RSS 本文欠落を、人間の読者が Obsidian Base 上でマーキングできるようにする。
3. AI が生成する `category` を schema/master に準拠させ、過推論による値の拡散を防ぐ。

本計画は `OBSIDIAN_BASE_RECORD_PLAN.md` の「次スコープ外だが先に管理する運用バックログ」を、実装に移せる粒度へ分解したものとする。

## 2. スコープ

### 対象

- `summarize` ジョブの構造化ログ改善
- manual 実行結果の summarize 件数表示
- RSS 本文品質を人間が記録する frontmatter / Base プロパティ追加
- `category` の master 管理と AI 出力正規化

### 対象外

- RSS 本文抽出ロジックの完全改善
- 全記事の本文取得カバレッジ 100% 保証
- category enum の意味論そのものの再設計
- Obsidian Base 以外の外部DB導入

## 3. 優先順位

### P0: summarize 可観測性

失敗時の調査効率に直結するため最優先で実装する。

### P1: category master 化

AI による `category` のデータ品質劣化を止めるため、早めに実装する。

### P1: RSS 本文欠落マーキング

人間運用のための schema / Base 拡張。category master 化とは別 PR にする。

## 4. P0: summarize 可観測性

### 現状課題

- `summarize-main` の開始/成功ログは見えるが、対象件数や記事単位の進捗が見えない。
- 失敗時にどの記事が失敗したか、ログだけでは特定しづらい。
- `runSummarizeJob` 内に記事単位の構造化ログがない。
- manual 実行結果に summarize の `processed/skipped/failed` が出ない。

### 追加するログイベント

- `summarize_job_start`
  - `job_run_id`
  - `job_id`
  - `records_root`
  - `target_total`
- `summarize_item_start`
  - `job_run_id`
  - `job_id`
  - `vault_rel_path`
  - `index`
  - `target_total`
  - `source_id`
  - `source`
  - `source_type`
- `summarize_item_success`
  - `job_run_id`
  - `job_id`
  - `vault_rel_path`
  - `index`
  - `target_total`
  - `duration_ms`
- `summarize_item_failed`
  - `job_run_id`
  - `job_id`
  - `vault_rel_path`
  - `source_id`
  - `source`
  - `error_message`
- `summarize_job_done`
  - `job_run_id`
  - `job_id`
  - `processed`
  - `skipped`
  - `failed`

### 実装方針

1. `orchestrator` の summarize ブロックから `tick_run_id` / `job_run_id` / logger を `runSummarizeJob` に渡す。
2. `runSummarizeJob` は処理前に `status: captured` の対象を列挙し、`target_total` を確定する。
3. 記事単位で start/success/failed を出す。
4. 失敗時は `vault_rel_path` を必ずログに含めてから例外を再 throw する。
5. manual 実行結果に summarize の `processed/skipped/failed` を表示する。

### 受け入れ条件

- `job_run_id` から summarize の対象件数、処理件数、失敗件数を追える。
- 失敗時に `vault_rel_path` だけで対象ノートを特定できる。
- `obsflow run --targets summarize` の出力で summarize 件数が分かる。

## 5. P1: RSS 本文欠落マーキング

### 現状課題

- RSS 本文抽出は記事によって欠落や薄さが残る。
- 現時点で抽出品質を 100% にするのは現実的ではない。
- 読者が気づいたタイミングで Base 上に印を残す仕組みがない。

### 追加するプロパティ

- `content_status`
  - optional string
  - 単一値 Text
  - 許容値:
    - 未設定: 未フラグ
    - `ok`: 本文に問題なし、または手動補正済み
    - `suspected_missing`: 本文欠落/薄さの疑い
    - `confirmed_missing`: 本文欠落が確定
- `content_issue_note`
  - optional string
  - 欠落状況や補足メモ
- `content_issue_marked_at`
  - optional ISO8601 string
  - 人間が問題をマークした日時

### Base 方針

- メインビューに `content_status` を表示する。
- `suspected_missing` / `confirmed_missing` のみを抽出するビューを追加する。
- `content_issue_note` と `content_issue_marked_at` を課題調査用ビューに表示する。

### 実装方針

1. `docs/OBSIDIAN_SCHEMA.md` に `content_*` プロパティを追加する。
2. `VaultRecord` に optional field として追加する。
3. `parseVaultNote()` / `renderVaultNote()` で既存値を保持する。
4. Base の view/order/filter に `content_status` を追加する。
5. collect / summarize 更新時に `content_*` を消さないことをテストする。

### 受け入れ条件

- 既存ノートに `content_*` がなくても parse/render が壊れない。
- 人間が Obsidian 上で `suspected_missing` / `confirmed_missing` を付与できる。
- Base で本文取得課題だけを一覧化できる。
- obsflow の再更新後も手入力した `content_*` が保持される。

## 6. P1: category master 化

### 現状課題

- `tags` は master で制約されるが、`category` は AI が返した非空文字列をそのまま通しうる。
- `docs/OBSIDIAN_SCHEMA.md` の category enum から逸脱する可能性がある。

### 管理ファイル案

`config/category-master.yaml` を追加する。

```yaml
version: 1
source: obsidian-schema-category
updated_at: "2026-05-06"

categories:
  - "books"
  - "reports"
  - "presentations"
  - "podcasts"
  - "papers"
  - "standards"
  - "specs"
  - "blogs"
  - "oss"
  - "policies"
  - "lectures"
  - "hands_on"
  - "sns"
```

### AI 入出力ルール

- prompt に `Allowed categories (master):` を列挙する。
- `category` は master 内の値、または `null` のみ許可する。
- master 外 category は永続化しない。
- AI が有効な category を返さない場合、既存 category があれば維持する方針を第一候補にする。

### 実装方針

1. `config/category-master.yaml` を追加する。
2. category master loader を追加する。`tag-master` と同様に empty / duplicate / invalid shape を検出する。
3. `config.ts` で `ai.categories.mode` / `ai.categories.master_path` を parse/validate する。
4. `ai-cursor.ts` の prompt に allowed categories を追加する。
5. `ai-summary-result.ts` で master 外 category を破棄する。
6. `docs/OBSIDIAN_SCHEMA.md` の enum と `category-master.yaml` の同期テストを追加する。

### 受け入れ条件

- 新規 summarize 後の `category` が schema enum/master 以外にならない。
- AI が未知 category を返しても frontmatter に保存されない。
- `category-master.yaml` と `docs/OBSIDIAN_SCHEMA.md` の enum が同期している。

## 7. 推奨 PR 分割

### PR 1: summarize 可観測性

主な対象:

- `src/jobs/summarize.ts`
- `src/orchestrator.ts`
- summarize job tests
- `README.md`
- `TEST_PLAN.md`

### PR 2: category master 化

主な対象:

- `config/category-master.yaml`
- `src/config.ts`
- `src/ai-summary-result.ts`
- `src/adapters/ai-cursor.ts`
- category tests
- `docs/OBSIDIAN_SCHEMA.md`

### PR 3: RSS 本文欠落マーキング

主な対象:

- `docs/OBSIDIAN_SCHEMA.md`
- `src/types.ts`
- `src/note.ts`
- Base config/order/filter
- parse/render tests

## 8. テスト方針

- unit
  - summarize ログイベントのフィールド検証
  - `content_*` の parse/render 保持
  - category master load / duplicate / empty
  - master 外 category の破棄
- integration
  - collect → summarize 後に Base 表示用 frontmatter が保持されること
  - manual summarize の `processed/skipped/failed` 表示
- e2e
  - RSS E2E で既存挙動が壊れないこと

## 9. ロールアウト方針

1. summarize 可観測性を先に入れる。挙動変更は最小にし、ログと表示だけ増やす。
2. category master 化で AI 出力のガードを入れる。既存 category の棚卸しは別作業として行う。
3. RSS 本文欠落マーキングは、schema/Base 追加後に人間運用で試し、必要に応じて抽出改善タスクへつなげる。
