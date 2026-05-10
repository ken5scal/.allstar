# Obsidian Base レコード登録機能 実装計画

最終更新: 2026-05-05

## 1. 目的

取得した記事・投稿などの `VaultRecord` を、Obsidian Vault 内の任意ディレクトリに Markdown ページとして作成し、Vault 直下または特定フォルダに配置された Obsidian Bases (`.base`) からレコードとして参照できるようにする。

本計画では、Obsidian Bases を「独立した DB への INSERT 先」ではなく「Vault 内 Markdown ノートを properties/frontmatter / file metadata で絞り込む宣言的ビュー」として扱う。これは Obsidian の Bases が `filters` と `views` で Vault 内ノートを表示するモデルに沿った方針である。したがって、登録の実体は次の 2 点で成立させる。

1. レコードページを所定パスへ作成し、Base が参照できる frontmatter を記入する。
2. Base ファイル側に、そのレコード群を拾う `filters` / `views` / `order` を定義する。

### 1.1 Obsidian-native な Base 登録方式

Obsidian Bases は、Base ファイルの中にレコード行そのものを保存する仕組みではない。Vault 内にある Markdown ページを、properties/frontmatter の値やファイル情報で絞り込み、表・カード・リストとして表示する仕組みとして扱う。

つまり「Base に登録する」とは、Base ファイルへ 1 行 append することではなく、次のような Markdown ページを作ることを意味する。

```markdown
---
record_kind: "obsflow-record"
source_type: "rss"
source_group: "rss"
source_id: "hn"
source: "https://example.com/article"
status: "captured"
category: "blog"
tags: []
summary: ""
published_at: "2026-05-04T12:00:00Z"
captured_at: "2026-05-05T06:30:00Z"
---

## Raw Content

...
```

Base 側は、たとえば以下のような filter で該当ページを拾う。

```yaml
filters:
  and:
    - 'record_kind == "obsflow-record"'
    - 'file.inFolder("src")'

views:
  - type: table
    name: "All Records"
    order:
      - file.name
      - source_group
      - source_id
      - status
      - category
      - tags
      - summary
      - captured_at
```

この方式では、レコードページの作成と properties/frontmatter 更新が完了した時点で、Base の条件に合う限り自動的に Base 上の 1 行として表示される。obsflow はこの Obsidian-native な方式を採用する。

## 2. 既存設計・実装から分かったこと

### 2.1 既存設計

- `ARCHITECTURE_OVERVIEW.md`
  - 正本は Obsidian Markdown-first。
  - 1 ソース = 1 レコード。
  - Vault 更新は Cursor SDK + Obsidian Skills 経由。
- `DETAILED_DESIGN.md`
  - `obsflow tick` を主実行入口とする。
  - Vault 保存は source 種別ごとの固定ディレクトリ配下。
  - `## AI Summary` セクションのみを更新対象にする。
  - frontmatter 詳細は当初の非ゴールだった。
- `OBSIDIAN_SCHEMA.md`
  - `source_type`, `source`, `source_id`, `status`, `category`, `tags`, `summary`, `tick_run_id`, `job_run_id` などの最小 schema は定義済み。
  - `tags` は後続 AI 分類・要約処理で付与する想定。
  - Bases のフィルタで enum 制約を担保できることが明記されている。

### 2.2 既存実装

- `src/jobs/collect.ts`
  - 収集アイテムを `VaultRecord` に変換し、`noteRelPathForItem()` で保存先を決める。
- `src/paths.ts`
  - 保存先は `Sources/RSS`, `Sources/X/Search`, `Sources/X/Lists`, `Sources/X/Bookmarks` に固定。
- `src/config.ts` / `src/types.ts`
  - `defaults.vault_path`, `defaults.vault_folder`, `defaults.vault_provider` はあるが、レコードパステンプレートや Base 定義はない。
- `src/adapters/vault-agent.ts`
  - レコード作成は Cursor SDK local agent に委譲している。
  - `updateAiSummary()` は現状 `fs` で直接書き換えており、「Vault 更新は Obsidian Skills 経由」という設計と完全には一致していない。
- `src/jobs/summarize.ts` / `src/jobs/digest.ts`
  - 対象ルートが `Sources/...` に固定されている。
- `config/config.yaml`
  - `vault_provider`, `vault_path`, `auth.cursor_api_key_env` はあるが、Base/レコード配置/agent/sub-agent 設定はない。

## 3. 実装方針

### 3.1 レコードページ配置

設定で Vault 内の相対保存先テンプレートを指定できるようにする。

初期案:

```yaml
records:
  root_folder: "src"
  path_template: "{source_group}/{source_id}/{yyyy}/{mm}/{dd}"
  filename_template: "{slug}.md"
  date_source: "captured_at"
  source_groups:
    rss: "rss"
    x: "sns"
    web: "web"
    youtube: "youtube"
```

例:

```text
<vault>/src/rss/hn/2026/05/05/example-title.md
<vault>/src/sns/my-bookmarks/2026/05/05/post-123.md
<vault>/src/web/clipper/2026/05/05/example-title.md
<vault>/src/youtube/my-channel/2026/05/05/example-video.md
```

`source_group` は `rss`, `sns`, `web`, `youtube` などの大まかな取得タイプまたはカテゴリを表す。`source_groups` のキーは raw な `source_type` ではなく正規化した取得 family とし、`x-search` / `x-list` / `x-bookmarks` はすべて `x` family として `sns` にまとめる。Web 取得は `web: "web"`、YouTube 取得は `youtube: "youtube"` として扱う。`source_id` は取得設定上の識別子をそのまま使う。

日付ディレクトリは初期値として `captured_at` を推奨する。理由は、Vault への投入日でまとまるため再処理・バックアップ・「今日取り込んだもの」の確認が安定するため。公開日時は `published_at` property として別に保持し、Base の sort/filter で使う。公開日時順のフォルダ整理を強く優先する場合だけ、`date_source: "published_at_or_captured_at"` に切り替える。

### 3.2 Base 定義

Base ファイルを設定で宣言し、必要に応じて作成/更新する。

Base ファイルの管理モードは次の 3 段階で考える。

| mode | 意味 | 手動編集との相性 |
| --- | --- | --- |
| `reference` | 既存 Base を人が管理する。obsflow は Base ファイルを書き換えず、レコード frontmatter だけを揃える。 | 高い |
| `create_if_missing` | Base ファイルがなければ初回だけ作る。存在する場合は上書きしない。 | 中間 |
| `managed` | 設定ファイルを正として、obsflow が Base ファイルを生成・上書きする。 | 低い |

「managed」は、Base の YAML 定義を `config.yaml` 側で管理し、実行時に `.base` を再生成するという意味である。再現性は高いが、Obsidian UI で Base を手動調整しても次回実行で上書きされる可能性がある。初期実装では `create_if_missing` を default、完全自動管理したい場合のみ `managed` を明示するのが安全。

初期案:

```yaml
bases:
  - id: "all-records"
    path: "Records.base"
    mode: "create_if_missing"
    filters:
      - 'record_kind == "obsflow-record"'
    views:
      - type: "table"
        name: "All"
        order:
          - file.name
          - source_type
          - source_id
          - status
          - category
          - tags
          - summary
          - updated_at
```

既存 Base をすでに人手で編集している場合は `mode: reference` とし、obsflow は Base が拾える frontmatter を書くことに専念する。

### 3.3 レコード frontmatter の追加候補

既存 schema に加えて、Base 絞り込みと運用を安定させるため以下を追加する。

| Key | 目的 |
| --- | --- |
| `record_kind` | Base フィルタ用の固定値。例: `obsflow-record` |
| `base_ids` | どの Base に表示対象とするか。複数 Base 対応 |
| `source_group` | `src/{取得タイプまたはカテゴリ}/...` と対応する正規化値。例: `rss`, `sns`, `web`, `youtube` |
| `origin` | 取得元の補助表示名。必要なら `source_id` や domain から導出 |
| `published_at` | コンテンツの公開日時。取得元から得られる場合のみ設定 |
| `captured_at` | 収集・保存時刻。`created_at` を公開日時に使う場合の実保存時刻 |

`status` は当面 1 つのまま維持する。全体のインプット用データベースとして使う範囲では、処理状態と読書状態を分離する必要はまだ薄い。本スコープでは `summary_status` / `tag_status` のような処理補助状態は追加しない。

### 3.4 Cursor SDK / Obsidian Skills / サブエージェント

設計上の重要な制約:

- Cursor SDK の custom sub-agents は cloud runtime 前提。
- Obsidian Vault がローカルファイルシステムにある場合、cloud sub-agent はその Vault を直接編集できない。
- local runtime で Obsidian Skills を使う場合、custom sub-agent は使えない前提で設計する必要がある。

初回実装では案 A を採用する。

#### 採用案 A: ローカル Vault 更新優先

- メインの local Cursor SDK agent が Obsidian Skills を使ってレコード作成・プロパティ更新・Base ファイル更新を行う。
- 本スコープではレコードページ作成、properties/frontmatter 記入、Base ファイル作成/更新のみを扱う。
- SDK の「custom sub-agents」ではないが、ローカル Vault を安全に扱いやすい。

#### 後日検討案 B: custom sub-agent 優先

- cloud runtime の custom sub-agent に要約・タグ候補生成だけを委譲する。
- sub-agent は Vault を直接編集せず、JSON などの構造化結果を返す。
- メイン処理がローカル Vault に反映する。
- 将来、Vault を Git リポジトリとして cloud agent が扱える運用にするなら、cloud agent に Base/record 更新まで寄せられる。

案 B は初回実装の対象外とし、将来 cloud runtime / custom sub-agent を使った要約・タグ候補生成を検討するための設計メモとして残す。

## 4. 更新が必要そうなファイル

### 4.1 設定・型

- `config/config.yaml`
  - `records` ブロックを追加する。
  - `bases` ブロックを追加する。
- `test/fixtures/config.mock.yaml`
  - 新設定の最小 fixture を追加する。
- `test/fixtures/config.run.mock.yaml`
  - manual run fixture も必要に応じて更新する。
- `src/types.ts`
  - `RecordsConfig`, `BaseConfig`, `BaseViewConfig` などを追加する。
  - `VaultRecord` に Base 表示用 frontmatter を追加する。
- `src/config.ts`
  - 新ブロックの parse / default / validation を追加する。
  - Base path と record path template が Vault 外に出ないことを検証する。
  - `mode: reference|create_if_missing|managed`、view type、filter/order の最小 validation を追加する。

### 4.2 パス・ノート生成

- `src/paths.ts`
  - 固定 `Sources/...` ではなく、設定に基づく `recordRelPathForItem()` を追加する。
  - `{source_group}`, `{source_id}`, `{yyyy}`, `{mm}`, `{dd}`, `{slug}`, `{source_type}`, `{origin}` の置換を扱う。
  - path traversal を防ぐ。
- `src/jobs/collect.ts`
  - `noteRelPathForItem()` を設定対応に変更する。
  - `itemToVaultRecord()` に `record_kind`, `base_ids`, `source_group`, `origin`, `published_at`, `captured_at` を設定する。
- `src/note.ts`
  - 追加 frontmatter の render/parse を対応する。
  - `tags` / `category` / `summary` 更新が Base に即反映される形を維持する。
- `OBSIDIAN_SCHEMA.md`
  - 追加 frontmatter と enum を追記する。

### 4.3 Base ファイル生成・更新

- 新規 `src/base.ts` または `src/bases.ts`
  - `.base` YAML を生成する。
  - `filters`, `properties`, `views`, `order`, `summaries` を schema 化する。
  - Obsidian Bases の YAML quoting ルールに沿って出力する。
- `src/adapters/interfaces.ts`
  - `VaultAdapter` に `upsertBase(base: BaseConfig): Promise<void>` を追加するか、Base 専用 adapter を追加する。
- `src/adapters/vault-mock.ts`
  - mock でも `.base` ファイルを書けるようにする。
- `src/adapters/vault-agent.ts`
  - Cursor SDK local agent に Base ファイル作成/更新を依頼する。
  - `mode: managed` の場合は生成内容を置換、`mode: create_if_missing` の場合は存在しない時だけ作成、`mode: reference` の場合は変更しない。
- `src/orchestrator.ts`
  - config load 後、収集/要約前に managed/create_if_missing Base の存在を保証する。

### 4.4 要約・タグ付け agent

本スコープでは扱わない。後続で要約・タグ付けを Cursor SDK agent または custom sub-agent に委譲するかを検討する。

### 4.5 digest / 参照系

- `src/jobs/digest.ts`
  - hardcoded roots を設定由来に変更する。
  - wikilink 生成時、`src/...` 配置でも正しくリンクできるようにする。

### 4.6 ドキュメント・テスト

- `DETAILED_DESIGN.md`
  - Vault 更新仕様に Base 登録、record path template、managed/reference Base を追記する。
- `README.md`
  - 設定例と運用上の注意を追記する。
- `TEST_PLAN.md`
  - Base YAML 生成、record path template、agent smoke を追加する。
- `test/unit/config.test.ts`
  - 新設定の default / validation / path safety を追加する。
- 新規 `test/unit/paths.test.ts`
  - `src/{source_group}/{source_id}/YYYY/mm/dd` 生成、slug、衝突回避、path traversal を検証する。
- 新規 `test/unit/base.test.ts`
  - `.base` YAML 生成と YAML parse 可能性を検証する。
- 既存 collect / summarize / digest tests
  - hardcoded `Sources/...` 前提を更新する。

## 5. 実装ステップ

### Step 1: Config と型を追加する

- `records` / `bases` 設定を `src/types.ts` に追加。
- `src/config.ts` で parse/default/validation を実装。
- `config/config.yaml` と test fixtures を更新。
- 完了条件:
  - `obsflow validate` が新旧最小設定で通る。
  - 不正な絶対 Base path、`..` を含む record template、未知 view type が失敗する。

### Step 2: レコード保存パスを設定化する

- `src/paths.ts` に template renderer を追加。
- `collect.ts` の保存先決定を設定ベースに変更。
- 既存の `Sources/...` は後方互換 default として残すか、`records.root_folder: "Sources"` 相当の default で表現する。
- 完了条件:
  - `src/{source_group}/{source_id}/YYYY/mm/dd` 配置で Markdown が生成される。
  - 既存 mock/integration tests が更新後のパスで通る。

### Step 3: frontmatter を Base 対応に拡張する

- `VaultRecord` / `renderVaultNote()` / `parseVaultNote()` を拡張。
- `record_kind`, `base_ids`, `source_group`, `origin`, `published_at`, `captured_at` を初期値付きで出力。
- 完了条件:
  - 生成ノートを parse して追加 property が保持される。
  - Base filter に使う property が常に存在する。

### Step 4: managed Base を生成する

- `.base` YAML renderer を追加。
- mock/agent adapter で `upsertBase()` を実装。
- `orchestrator` が実行開始時に managed/create_if_missing Base を保証する。
- 完了条件:
  - `Records.base` のような Base ファイルが Vault 直下または指定フォルダに作成される。
  - YAML parse が通り、未定義 formula 参照などを生成しない。

### Step 5: Vault 更新を Obsidian Skills 経由へ寄せる

- レコード作成、properties/frontmatter 更新、Base 更新の prompt を分け、失敗箇所をログで追えるようにする。
- 完了条件:
  - agent mode の smoke でレコード作成と properties/frontmatter 更新ができる。
  - mock mode のテストは外部 Cursor SDK 呼び出しなしで通る。

### Step 6: docs とテストを更新する

- `DETAILED_DESIGN.md`, `OBSIDIAN_SCHEMA.md`, `README.md`, `TEST_PLAN.md` を更新。
- unit/integration/idempotency/failure-path を更新。
- 完了条件:
  - `npm run typecheck`
  - `npm run lint`
  - `OBSFLOW_SKIP_TICK_LOCK=1 npm test`
  - `npm run obsflow -- validate --config test/fixtures/config.mock.yaml`
  - `OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- tick --config test/fixtures/config.mock.yaml`

## 6. リスクと注意点

- Obsidian Bases は Markdown ノートの view であり、Base ファイルへ個別 row を直接 append するモデルではない。実装では frontmatter と Base filter の整合が重要。
- Cursor SDK custom sub-agents は cloud-only 前提のため、ローカル Vault 直接編集とは相性に制約がある。初回は local agent を採用し、この制約を避ける。
- `src/` という Vault 内フォルダ名はリポジトリの `src/` と混同しやすい。設定名やログでは `vault_rel_path` と明記する。
- 日付ディレクトリを `published_at` ベースにすると古い記事が過去フォルダへ入り、投入日の追跡が難しくなる。一方で `captured_at` ベースにすると公開年月でのファイルツリー整理は弱くなるため、Base の sort/filter で補う。
- 既存 `status` は当面維持し、処理補助状態は本スコープでは追加しない。
- Base を `managed` で上書きする場合、手動編集が失われる。`reference` モードまたは managed block marker の採用を検討する。

## 7. 確定した初期方針

- Base 登録方式: Obsidian-native な方式として、レコードページの properties/frontmatter を Base filter で拾わせる。Base ファイルへ個別 row を書き込む実装はしない。
- Base mode: `create_if_missing` を標準にする。`reference` / `managed` は設定値として残すが、初期運用の主軸にはしない。
- 保存パス: `records.root_folder: "src"`, `path_template: "{source_group}/{source_id}/{yyyy}/{mm}/{dd}"`。
- `source_group`: 初期語彙は `rss`, `sns`, `web`, `youtube`。`x-search` / `x-list` / `x-bookmarks` は取得 family として `x` にまとめ、group 値は `sns` にする。
- 日付: ディレクトリは `captured_at` を使う。公開日時は `published_at` property として保持し、Base view の sort/filter で扱う。
- Cursor SDK: 初回は local agent を使う。案 B の custom sub-agent 設計は後日検討用メモとして残すが、初回実装では考慮しない。
- `status`: 当面単一のまま維持する。本スコープでは `summary_status` / `tag_status` のような処理補助状態は追加しない。

## 8. スコープ外として扱う点

以下は現時点では設計・実装対象にしない。

- 要約・タグ付け agent の入力形式や JSON contract。
- `tags` の統制語彙、`category` enum の見直し、タグ数上限、階層タグの可否。
- status の処理状態/読書状態への分離。
- 案 B の custom sub-agent 運用詳細。
- 同一記事再取得時の細かな更新方針。
- ファイル名衝突時の suffix 方式。

## 9. 次スコープ外だが先に管理する運用バックログ

このセクションは「今は作らないが、次の設計・実装で必ず扱う課題」を管理する。
管理先を本ドキュメントに置く理由は、以下 3 点がいずれも Base 表示・frontmatter schema・AI 要約/分類方針にまたがるため。

### 9.1 P0: summarize 実行の可観測性（失敗時に記事特定できること）

現状課題:

- `summarize-main` の開始/成功ログは見えるが、実行対象件数と対象記事の内訳が追いづらい。
- 失敗時に「どの記事（どの noteRelPath）が落ちたか」をログだけで即特定しづらい。
- `runSummarizeJob` 内に記事単位の構造化ログがなく、`tick_run_id` / `job_run_id` / Vault 相対パスが結合されていない。
- manual 実行サマリでは summarize の `processed/skipped/failed` 件数が見えない。

次スコープでやること:

- summarize 開始時に `summarize_job_start` を出す。
  - 必須フィールド: `job_run_id`, `job_id`, `records_root`, `target_total`
- 記事単位で以下のイベントを出す。
  - `summarize_item_start`
  - `summarize_item_success`
  - `summarize_item_failed`
  - 必須フィールド: `job_run_id`, `job_id`, `vault_rel_path`, `index`, `target_total`, `source_id`, `source`, `source_type`
- スキップを明示する場合は `summarize_item_skipped` を出す。
  - 必須フィールド: `job_run_id`, `job_id`, `vault_rel_path`, `skip_reason`
- summarize 完了時に `summarize_job_done` を出す。
  - 必須フィールド: `job_run_id`, `job_id`, `processed`, `skipped`, `failed`
- manual 実行サマリにも summarize の `processed/skipped/failed` 件数を出す。

実装メモ:

- `orchestrator` の summarize ブロックで採番済みの `tick_run_id` / `job_run_id` を `runSummarizeJob` に渡す。
- `runSummarizeJob` はまず `captured` 対象を列挙し、`target_total` を確定してから処理を開始する。
- 失敗時は `summarize_item_failed` に `vault_rel_path` を必ず含め、ログ検索だけで対象記事を特定できるようにする。

完了条件:

- 失敗した summarize 実行 1 回について、ログ検索だけで失敗記事を一意に特定できる。
- `job_run_id` から対象件数、処理済み件数、失敗件数を追える。
- `obsflow run --targets summarize` の結果表示で summarize の件数が分かる。

### 9.2 P1: RSS 本文欠落を人間がマーキングできるプロパティ

現状課題:

- RSS の本文抽出は完全ではなく、記事によって中身が薄い/欠落する。
- ただし現段階で 100% カバレッジ実装は現実的でない。
- 読者が本文欠落に気づいた時点で、Base 上に後続対応の印を残す仕組みがない。

次スコープでやること:

- Obsidian Base から人間が付与できる任意 frontmatter を追加する。
  - `content_status`: string (optional)
  - `content_issue_note`: string (optional)
  - `content_issue_marked_at`: ISO8601 string (optional)
- `content_status` は単一値 Text とし、許容値は以下にする。
  - 未設定: 未フラグ。通常状態。課題ビューには出さない。
  - `ok`: 本文に問題なし、または手動補正済み。
  - `suspected_missing`: 本文欠落/薄さの疑い。未検証。
  - `confirmed_missing`: 本文欠落が確定。後続対応対象。
- Base view に `content_status`, `content_issue_marked_at`, `content_issue_note` を表示する。
- `suspected_missing` / `confirmed_missing` のみを抽出する「本文取得課題」ビューを追加する。

実装メモ:

- 既存ノートにはキーを追加しない。未設定を正規状態として扱う。
- `content_*` は人間が付与する運用プロパティなので、collect や summarize の通常更新で消さない。
- `status` は処理状態のまま維持し、本文品質状態とは混ぜない。
- 正式実装時は `docs/OBSIDIAN_SCHEMA.md`, `src/types.ts`, `src/note.ts`, Base の order/filter を更新する。

完了条件:

- 読者が「本文欠落」を見つけた時に、Obsidian 上で即時マーキングし、あとで機械的に一覧化できる。
- 既存ノートに `content_*` がなくても parse/render/Base 表示が壊れない。
- `confirmed_missing` のノートを Base で一覧化し、補足メモまで追える。

### 9.3 P1: category 推論の統制（schema enum への準拠）

現状課題:

- category が過推論で広がり、`docs/OBSIDIAN_SCHEMA.md` の enum から逸脱しうる。
- 現在の AI 正規化では `tags` は master で制約される一方、`category` は非空文字列なら通ってしまう。

次スコープでやること:

- `tags` と同様に category もローカル正本化する。
- 例: `config/category-master.yaml` を追加し、`docs/OBSIDIAN_SCHEMA.md` の enum を初期値として管理する。
- 初期値は `docs/OBSIDIAN_SCHEMA.md` §2.3 と完全一致させる。
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
- AI には master 内からのみ category を選ばせる。迷う場合は `null` を返させる。
- master 外 category は永続化しない。
- 既存 category があり、AI が有効な category を返さない場合は、既存値を維持する方針を第一候補にする。
- `config` parse/validate と adapter 正規化で二重に制約をかける。

実装メモ:

- `tag-master` と同じパターンを再利用する。
  - loader: empty / duplicate / invalid shape を検出する。
  - config: `ai.categories.mode: local_master`, `ai.categories.master_path`
  - adapter: prompt に `Allowed categories (master):` を列挙する。
  - normalize: master 外を破棄する。
- `docs/OBSIDIAN_SCHEMA.md` と `config/category-master.yaml` の差分を検出するテストまたはレビュー手順を用意する。
- 既存Vaultのカテゴリを棚卸しし、schema外の値は人手で enum にマッピングする。

完了条件:

- 新規 summarize 後の `category` が schema enum/master 以外になることがない。
- `category-master.yaml` と `docs/OBSIDIAN_SCHEMA.md` の enum が同期している。
- AI が未知カテゴリを返しても、frontmatter へ未知値が保存されない。

### 9.4 推奨実装順序

1. **P0: summarize 可観測性**
   - 失敗時の調査効率に直結するため最優先。
   - 機能挙動を変えずログと manual summary を増やすだけなので、小さい PR にしやすい。
2. **P1: category master 化**
   - AI によるデータ品質劣化を止めるガードなので、早めに入れる。
   - `tag-master` の実装パターンを流用できる。
3. **P1: content_status 系プロパティ**
   - 人間運用のための schema/Base 拡張。Base view と運用フローを含むため、category とは別 PR がよい。

### 9.5 PR 分割方針

- PR 1: summarize 可観測性
  - 主な対象: `src/jobs/summarize.ts`, `src/orchestrator.ts`, summarize job tests, `README.md` / `TEST_PLAN.md`
- PR 2: category master
  - 主な対象: `config/category-master.yaml`, `src/config.ts`, `src/ai-summary-result.ts`, `src/adapters/ai-cursor.ts`, category tests, schema docs
- PR 3: content issue marking
  - 主な対象: `docs/OBSIDIAN_SCHEMA.md`, `src/types.ts`, `src/note.ts`, Base config/order/filter, parse/render tests
