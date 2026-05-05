# Obsidian Base レコード登録機能 実装計画

最終更新: 2026-05-05

## 1. 目的

取得した記事・投稿などの `VaultRecord` を、Obsidian Vault 内の任意ディレクトリに Markdown ページとして作成し、Vault 直下または特定フォルダに配置された Obsidian Bases (`.base`) からレコードとして参照できるようにする。

本計画では、Obsidian Bases を「独立した DB への INSERT 先」ではなく「Vault 内 Markdown ノートを frontmatter / file metadata で絞り込む宣言的ビュー」として扱う。したがって、登録の実体は次の 2 点で成立させる。

1. レコードページを所定パスへ作成し、Base が参照できる frontmatter を記入する。
2. Base ファイル側に、そのレコード群を拾う `filters` / `views` / `order` を定義する。

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
- `examples/config.yaml`
  - `vault_provider`, `vault_path`, `auth.cursor_api_key_env` はあるが、Base/レコード配置/agent/sub-agent 設定はない。

## 3. 実装方針

### 3.1 レコードページ配置

設定で Vault 内の相対保存先テンプレートを指定できるようにする。

初期案:

```yaml
records:
  root_folder: "src"
  path_template: "{origin}/{yyyy}/{mm}/{dd}"
  filename_template: "{slug}.md"
  date_source: "published_at_or_captured_at"
```

例:

```text
<vault>/src/hn/2026/05/05/example-title.md
<vault>/src/x-bookmarks/2026/05/05/post-123.md
```

`origin` は設定で明示できない場合、まず `source_id`、次に `source_type` を使う。

### 3.2 Base 定義

Base ファイルを設定で宣言し、必要に応じて作成/更新する。

初期案:

```yaml
bases:
  - id: "all-records"
    path: "Records.base"
    mode: "managed"
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

`mode: managed` は obsflow が Base ファイルを生成・更新することを意味する。既存 Base を人手で編集している場合は `mode: reference` を用意し、obsflow はレコード側 frontmatter のみを合わせる。

### 3.3 レコード frontmatter の追加候補

既存 schema に加えて、Base 絞り込みと運用を安定させるため以下を追加する。

| Key | 目的 |
| --- | --- |
| `record_kind` | Base フィルタ用の固定値。例: `obsflow-record` |
| `base_ids` | どの Base に表示対象とするか。複数 Base 対応 |
| `origin` | `src/{取得元}/...` の `{取得元}` と対応する正規化値 |
| `captured_at` | 収集・保存時刻。`created_at` を公開日時に使う場合の実保存時刻 |
| `tag_status` | AI タグ付け状態。例: `pending`, `done`, `failed` |
| `summary_status` | AI 要約状態。例: `pending`, `done`, `failed` |

`status` は既存 schema のユーザー読書状態も含んでいるため、処理状態と読書状態を混ぜ続けるかは確認が必要。

### 3.4 Cursor SDK / Obsidian Skills / サブエージェント

設計上の重要な制約:

- Cursor SDK の custom sub-agents は cloud runtime 前提。
- Obsidian Vault がローカルファイルシステムにある場合、cloud sub-agent はその Vault を直接編集できない。
- local runtime で Obsidian Skills を使う場合、custom sub-agent は使えない前提で設計する必要がある。

そのため、初期実装は次のどちらかを選ぶ。

#### 案 A: ローカル Vault 更新優先

- メインの local Cursor SDK agent が Obsidian Skills を使ってレコード作成・プロパティ更新・Base ファイル更新を行う。
- 要約/タグ付けは `Agent.prompt()` または `Agent.create()` による別 local agent 呼び出しとして実装する。
- SDK の「custom sub-agents」ではないが、ローカル Vault を安全に扱いやすい。

#### 案 B: custom sub-agent 優先

- cloud runtime の custom sub-agent に要約・タグ候補生成だけを委譲する。
- sub-agent は Vault を直接編集せず、JSON などの構造化結果を返す。
- メイン処理がローカル Vault に反映する。
- 将来、Vault を Git リポジトリとして cloud agent が扱える運用にするなら、cloud agent に Base/record 更新まで寄せられる。

現時点では、ローカル Obsidian Vault 更新が要件の中心に見えるため、案 A を初期実装、案 B をオプション設計にするのが安全。

## 4. 更新が必要そうなファイル

### 4.1 設定・型

- `examples/config.yaml`
  - `records` ブロックを追加する。
  - `bases` ブロックを追加する。
  - `agents` または `ai.agent` ブロックを追加し、要約・タグ付け agent の provider / model / runtime 方針を設定できるようにする。
- `test/fixtures/config.mock.yaml`
  - 新設定の最小 fixture を追加する。
- `test/fixtures/config.run.mock.yaml`
  - manual run fixture も必要に応じて更新する。
- `src/types.ts`
  - `RecordsConfig`, `BaseConfig`, `BaseViewConfig`, `AgentRuntimeConfig` などを追加する。
  - `VaultRecord` に Base/処理状態用 frontmatter を追加する。
- `src/config.ts`
  - 新ブロックの parse / default / validation を追加する。
  - Base path と record path template が Vault 外に出ないことを検証する。
  - `mode: managed|reference`、view type、filter/order の最小 validation を追加する。

### 4.2 パス・ノート生成

- `src/paths.ts`
  - 固定 `Sources/...` ではなく、設定に基づく `recordRelPathForItem()` を追加する。
  - `{origin}`, `{yyyy}`, `{mm}`, `{dd}`, `{slug}`, `{source_type}`, `{source_id}` の置換を扱う。
  - path traversal を防ぐ。
- `src/jobs/collect.ts`
  - `noteRelPathForItem()` を設定対応に変更する。
  - `itemToVaultRecord()` に `record_kind`, `base_ids`, `origin`, `captured_at`, `summary_status`, `tag_status` を設定する。
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
  - `mode: managed` の場合は生成内容を置換、`mode: reference` の場合は変更しない。
- `src/orchestrator.ts`
  - config load 後、収集/要約前に managed Base の存在を保証する。

### 4.4 要約・タグ付け agent

- `src/adapters/ai-real.ts`
  - stub を実装するか、新規 `src/adapters/ai-agent.ts` を追加する。
  - `AiSummaryResult` の `tags` / `category` を返す prompt contract を定義する。
- `src/jobs/summarize.ts`
  - hardcoded roots を `records.root_folder` または Base 設定から導出する。
  - `out.tags`, `out.category` を `updateAiSummary()` patch に含める。
  - `summary_status`, `tag_status` を更新する。
- `src/adapters/vault-agent.ts`
  - `updateAiSummary()` の直接 `fs` 更新を Cursor SDK + Obsidian Skills 経由に寄せる。
  - local agent の `settingSources` をどう扱うかを設定可能にする。

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
  - Base YAML 生成、record path template、tag/category patch、agent smoke を追加する。
- `test/unit/config.test.ts`
  - 新設定の default / validation / path safety を追加する。
- 新規 `test/unit/paths.test.ts`
  - `src/{origin}/YYYY/mm/dd` 生成、slug、衝突回避、path traversal を検証する。
- 新規 `test/unit/base.test.ts`
  - `.base` YAML 生成と YAML parse 可能性を検証する。
- 既存 collect / summarize / digest tests
  - hardcoded `Sources/...` 前提を更新する。

## 5. 実装ステップ

### Step 1: Config と型を追加する

- `records` / `bases` / agent runtime 設定を `src/types.ts` に追加。
- `src/config.ts` で parse/default/validation を実装。
- `examples/config.yaml` と test fixtures を更新。
- 完了条件:
  - `obsflow validate` が新旧最小設定で通る。
  - 不正な絶対 Base path、`..` を含む record template、未知 view type が失敗する。

### Step 2: レコード保存パスを設定化する

- `src/paths.ts` に template renderer を追加。
- `collect.ts` の保存先決定を設定ベースに変更。
- 既存の `Sources/...` は後方互換 default として残すか、`records.root_folder: "Sources"` 相当の default で表現する。
- 完了条件:
  - `src/{origin}/YYYY/mm/dd` 配置で Markdown が生成される。
  - 既存 mock/integration tests が更新後のパスで通る。

### Step 3: frontmatter を Base 対応に拡張する

- `VaultRecord` / `renderVaultNote()` / `parseVaultNote()` を拡張。
- `record_kind`, `base_ids`, `origin`, `captured_at`, `summary_status`, `tag_status` を初期値付きで出力。
- 完了条件:
  - 生成ノートを parse して追加 property が保持される。
  - Base filter に使う property が常に存在する。

### Step 4: managed Base を生成する

- `.base` YAML renderer を追加。
- mock/agent adapter で `upsertBase()` を実装。
- `orchestrator` が実行開始時に managed Base を保証する。
- 完了条件:
  - `Records.base` のような Base ファイルが Vault 直下または指定フォルダに作成される。
  - YAML parse が通り、未定義 formula 参照などを生成しない。

### Step 5: 要約・タグ付けを agent 化する

- `ai-real` stub を置き換えるか、`ai.provider: agent` を追加する。
- prompt contract は JSON 出力を要求し、`summary`, `short_summary`, `tags`, `category` を返す。
- `summarize.ts` が `tags`, `category`, `summary_status`, `tag_status` を patch する。
- 完了条件:
  - mock provider では deterministic な tags/category を返す。
  - agent provider は Cursor SDK の startup failure と run failure を区別してエラー化する。

### Step 6: Vault 更新を Obsidian Skills 経由へ寄せる

- `vault-agent.updateAiSummary()` の直接 `fs` 更新を Cursor SDK agent prompt に変更する。
- レコード作成、property 更新、Base 更新の prompt を分け、失敗箇所をログで追えるようにする。
- 完了条件:
  - agent mode の smoke でレコード作成と property 更新ができる。
  - mock mode のテストは外部 Cursor SDK 呼び出しなしで通る。

### Step 7: docs とテストを更新する

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
- Cursor SDK custom sub-agents は cloud-only 前提のため、ローカル Vault 直接編集とは相性に制約がある。
- `src/` という Vault 内フォルダ名はリポジトリの `src/` と混同しやすい。設定名やログでは `vault_rel_path` と明記する。
- `created_at` を公開日時に使う場合、実保存時刻は `captured_at` として別管理した方がよい。
- 既存 `status` は処理状態と読書状態が混在しやすい。Base 運用開始前に分離を検討した方がよい。
- Base を `managed` で上書きする場合、手動編集が失われる。`reference` モードまたは managed block marker の採用を検討する。

## 7. 確認が必要な点

1. Base への「登録」は、Base ファイルに row を書くのではなく、レコードページの frontmatter を Base filter で拾わせる方式でよいか。
2. Base ファイルは obsflow が生成・上書きする `managed` でよいか。既存 Base を人手管理する `reference` も必要か。
3. レコード保存パス `src/{取得元}/YYYY/mm/dd` の `{取得元}` は `source_id`、`source_type`、ドメイン名、任意 alias のどれを優先するか。
4. 日付ディレクトリは公開日時 (`publishedAt`) と収集日時 (`captured_at`) のどちらを使うか。
5. Cursor SDK の custom sub-agent を必須にするか。必須の場合、cloud sub-agent がローカル Vault を直接触れない制約をどう扱うか。
6. 要約・タグ付け agent は Vault を読ませる必要があるか、それとも本文を prompt payload として渡して JSON 結果だけ受け取ればよいか。
7. `tags` の統制語彙、`category` enum の見直し、タグ数上限、階層タグの可否をどうするか。
8. `status` を処理状態と読書状態で分けるか。例: `processing_status` と `reading_status`。
9. 同一記事の再取得時は既存ページを更新するか、新規ページを作らず state のみ更新するか。
10. ファイル名衝突時の suffix は `source_item_key` hash、連番、日付時刻のどれにするか。

## 8. 推奨する初期決定

未確定事項が残る場合の初期実装は以下を推奨する。

- Base 登録方式: frontmatter + Base filter。
- Base mode: `managed` を標準、`reference` をオプション。
- 保存パス: `records.root_folder: "src"`, `{origin}` は `source_id` 優先。
- 日付: `publishedAt` があれば公開日時、なければ収集日時。
- agent: 初期は local Cursor SDK agent を使い、custom sub-agent は text-only 分類のオプションとして後続対応。
- `status`: 既存互換のため当面維持し、追加で `summary_status` / `tag_status` を導入。
