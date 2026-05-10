# AI 要約・タグ選定・レコード更新 実装計画

最終更新: 2026-05-05

## 1. 目的

ソースから取得して登録済みのレコードに対し、Cursor SDK を使った AI 処理で以下を行う。

1. レコード本文からサマリを作成する。
2. 作成したサマリをもとに、ローカルの tag master から tags を選定する。
3. サマリ・tags・category・status などをレコードへ反映する。

本計画では、Notion DB の `tags` プロパティは初期シードとして参照済みとし、実行時には Notion に依存しない。今後の正本はリポジトリ内の `config/tag-master.yaml` とする。

## 2. 前提と決定事項

- tag master ファイル名は `config/tag-master.yaml` とする。
- tags は Notion 由来の表記をそのまま使う。
  - 例: `llm/ai`, `llm/agent`, `interest:high`, `malware/ransom`
- category は Notion の category 候補へ合わせなくてよい。
- AI が tag master 外のタグを思いついても、`config/tag-master.yaml` は自動更新しない。
- 初期実装では、新規タグ候補の自動採用は行わない。
- タグ選定は、必ずサマリ作成後に行う。タグ選定の主入力は raw content ではなく、AI が作成したサマリとレコードメタデータとする。

## 3. 対象レコードと処理順序

既存の summarize job と同じく、基本対象は `status: captured` のレコードとする。

処理順序は以下とする。

1. Vault から対象レコードを読み込む。
2. レコード本文 (`rawContent`) をもとに AI サマリを作成する。
3. 作成済みサマリをもとに tags を選定する。
4. 必要に応じて category を選定する。
5. レコードを更新する。

重要な順序制約:

- tags は raw content から直接選ばない。
- まずサマリを確定し、そのサマリを分類対象として tags を選ぶ。
- これにより、タグ選定が本文のノイズよりも要点に引きずられるようにする。

## 4. tag master

### 4.1 ファイル形式

`config/tag-master.yaml` を追加する。

```yaml
version: 1
source: notion-news-tags
updated_at: "2026-05-05"

tags:
  - "aad"
  - "microsoft"
  - "oss"
  - "red"
  - "osint"
  - "confidential_computing"
  - "device_mgt"
  - "architecture"
  - "aws"
  - "cncf"
  - "container"
  - "sre"
  - "blue"
  - "dfir"
  - "service"
  - "google"
  - "supply_chain"
  - "slsa"
  - "sigstore"
  - "trust"
  - "governance"
  - "jwt"
  - "oauth"
  - "digital_identity"
  - "oidc"
  - "vul_mgt"
  - "seccamp"
  - "fido"
  - "financial"
  - "github"
  - "cicd"
  - "datadog"
  - "observability/detection"
  - "terraform"
  - "edr"
  - "windows"
  - "enum"
  - "defcon"
  - "aml"
  - "netflix"
  - "paper"
  - "sto"
  - "siem"
  - "soar"
  - "sentinel"
  - "data_science/data_engineer"
  - "privacy"
  - "golang"
  - "threat_model"
  - "file_storage"
  - "pac"
  - "google_workspace"
  - "blockchain"
  - "ssi"
  - "gitlab"
  - "conf_codeblue"
  - "dev"
  - "osquery"
  - "devsecops"
  - "sdlc"
  - "mac"
  - "test"
  - "alb"
  - "ecs"
  - "cloudflare"
  - "iac"
  - "mitre"
  - "handbook"
  - "pmconf"
  - "research"
  - "odic"
  - "iddance"
  - "利害関係あり"
  - "phishing"
  - "training/education"
  - "gocon"
  - "hashiconf"
  - "business"
  - "cloudnative_days"
  - "ncsc"
  - "finolab"
  - "slack"
  - "chaos_eng"
  - "risk_mgt"
  - "audit"
  - "ossf"
  - "ebpf"
  - "cisa"
  - "data_modeling"
  - "serverless"
  - "soc"
  - "kql"
  - "jamf"
  - "career"
  - "nist"
  - "patch_mgt"
  - "zta"
  - "microsoft_defender"
  - "mercari"
  - "log4j"
  - "threat_intelligence"
  - "cis"
  - "interest:high"
  - "pki"
  - "misc"
  - "policy"
  - "space"
  - "book"
  - "products"
  - "GraphQL"
  - "awesome"
  - "crypto"
  - "sast"
  - "dast"
  - "robot"
  - "pdm"
  - "cspm"
  - "opa"
  - "ipa"
  - "heroku"
  - "dlp"
  - "auth0"
  - "owasp"
  - "ditstributed_systems"
  - "ietf"
  - "csa"
  - "jupiterOne"
  - "asset_mgt"
  - "csp"
  - "law"
  - "chainguard"
  - "secrets"
  - "my_thought"
  - "cwe"
  - "blender"
  - "cg"
  - "連載_戦略としての企業価値"
  - "black_hole"
  - "isac"
  - "dfir_半田病院"
  - "やってみた"
  - "attack_surface_mgt"
  - "writing"
  - "uem"
  - "sans"
  - "ssvc"
  - "jpcert"
  - "burp"
  - "typescript"
  - "dfir_uber"
  - "ctf"
  - "microsoft_ignite_2022"
  - "keynote"
  - "db"
  - "design_pattern"
  - "lastpass"
  - "stats"
  - "web_api"
  - "abac"
  - "lyft"
  - "dfir_lastpass"
  - "config_mgt"
  - "malware/ransom"
  - "oreilly"
  - "freee"
  - "idor"
  - "dns"
  - "gcp"
  - "dfir_circleci"
  - "public_comments"
  - "まとめ"
  - "aqua"
  - "llm/ai"
  - "conf_jsac2023"
  - "graph_data"
  - "pinterest"
  - "ntt"
  - "dod"
  - "thm"
  - "nisc"
  - "family"
  - "ssrf"
  - "conf_blackhat"
  - "nasa"
  - "conf_sans"
  - "dfir_okta"
  - "conf_oidc"
  - "enisa"
  - "periodic_reports"
  - "wiz"
  - "iam"
  - "splunk"
  - "atp29/midnight_blizzard/nobelium"
  - "crowdstrike"
  - "home"
  - "zanzibar"
  - "nsa"
  - "redcanary"
  - "risk"
  - "dfir_kadokawa"
  - "ネタ/thoughts/memo"
  - "twitter"
  - "cisco"
  - "jnsa"
  - "objective-see"
  - "snyk"
  - "school"
  - "conf_fwd:cloudsec"
  - "1password"
  - "まくにか マクニカ"
  - "ioc"
  - "trivy"
  - "kaggle"
  - "government"
  - "math"
  - "star"
  - "articaleOfTheDay"
  - "podcasts"
  - "Wiz"
  - "Iac"
  - "dfir_dmm"
  - "apache_iceberg"
  - "duckdb"
  - "byMe"
  - "elasticsearch"
  - "llm/prompt"
  - "llm/mcp"
  - "dfir_tjactions"
  - "flatt"
  - "LayerX"
  - "anthropic"
  - "llm/agent"
  - "obsidian"
  - "sysdig"
  - "OpenAI"
  - "fraud"
  - "fsa"
  - "uber"
  - "Palantir"
  - "cursor"
  - "dfir_trivy"
  - "notion"
```

### 4.2 運用方針

- このファイルを Git 管理する。
- 実行時に Notion DB から tags を取得しない。
- AI はこの一覧からのみ tags を選ぶ。
- master 外のタグはレコードには保存しない。
- `tag-master.yaml` の更新は人間が明示的に行う。

### 4.3 新規タグ候補の扱い

初期実装では、AI の新規タグ候補を `tag-master.yaml` に自動追記しない。

将来必要になった場合は、以下のような別仕組みを追加する。

- `.obsflow/tag-suggestions.jsonl`
- `config/tag-suggestions.yaml`

例:

```json
{"tag":"agentic_workflow","source":"src/rss/hn/2026/05/05/example.md","reason":"サマリ上はAIワークフロー設計が主題だが、masterに近いタグがない","created_at":"2026-05-05T00:00:00Z"}
```

この場合も、採用判断と `tag-master.yaml` への反映は人間が行う。

## 5. 設定設計

`ai.provider` に Cursor SDK 用 provider を追加する。

設定例:

```yaml
ai:
  provider: "cursor"
  model: "composer-2"
  tags:
    mode: "local_master"
    master_path: "./config/tag-master.yaml"
    max_tags: 5
```

各項目:

- `provider: cursor`
  - Cursor SDK を使ってサマリ・タグ選定を行う。
- `model`
  - Cursor SDK に渡すモデル ID。
  - 未指定時は既定値を使う。
- `tags.mode: local_master`
  - ローカル tag master からのみ選ぶ。
- `tags.master_path`
  - tag master YAML のパス。
  - 設定ファイルからの相対パスとして解決する。
- `tags.max_tags`
  - 1 レコードに付与する最大タグ数。

## 6. AI adapter 設計

新規 adapter を追加する。

```text
src/adapters/ai-cursor.ts
```

責務:

1. `VaultRecord.rawContent` とメタデータを受け取る。
2. Cursor SDK Agent を起動する。
3. まずサマリを作成させる。
4. 作成したサマリと tag master を使って tags を選ばせる。
5. JSON 出力を検証・正規化して `AiSummaryResult` として返す。

期待する AI 出力:

```json
{
  "summary": "- point 1\n- point 2",
  "short_summary": "1行の短い要約",
  "tags": ["llm/agent", "cursor"],
  "category": "blogs"
}
```

### 6.1 プロンプト方針

プロンプトでは以下を明示する。

- Step 1: raw content から summary を作る。
- Step 2: 作成した summary を読み、tag master から tags を選ぶ。
- tags は tag master に存在する値だけを返す。
- master 外タグを作らない。
- 適切なタグがなければ `tags: []` を返す。
- 出力は JSON のみとする。

### 6.2 正規化・検証

adapter 側でも以下を強制する。

- `summary` が空ならエラー。
- `tags` は配列のみ許可。
- `tags` は tag master に存在する値だけ採用。
- 重複タグは除去する。
- `max_tags` を超えた分は破棄する。
- `category` は任意。未知値でも初期実装では厳密な Notion category 互換を求めない。

## 7. summarize job の更新

既存の `runSummarizeJob` は `status: captured` のレコードを読み、AI 結果でレコードを更新する。

変更後は、AI 結果の以下を反映する。

- `aiSummary`
  - 本文の `## AI Summary` セクション。
  - `summary` の完全版を保存する。
- `summary`
  - frontmatter 用の短い要約。
  - `short_summary` があればそれを使う。
  - なければ `summary` を短縮する。
- `tags`
  - tag master から選ばれた tags。
- `category`
  - AI が返した場合のみ反映する。
- `status`
  - `summarized` に更新する。
- `updated_at`
  - 更新時刻へ更新する。

## 8. レコード更新の境界

要約・タグ付けでは以下を変更しない。

- `rawContent`
- `source`
- `source_type`
- `source_id`
- `created_at`
- `captured_at`
- `tick_run_id`
- `job_run_id`

更新対象は AI 処理に関係するプロパティに限定する。

## 9. エラー時の扱い

初期実装では fail-soft の既存方針に合わせる。

- Cursor SDK の起動失敗は summarize job の失敗として扱う。
- AI 出力が JSON として解釈できない場合は対象 job を失敗させる。
- tag master が読めない場合は設定エラーまたは summarize job 失敗とする。
- master 外タグが返った場合はエラーにせず破棄する。

## 10. テスト計画

最低限、以下を追加する。

1. config parse
   - `ai.provider: cursor` を読める。
   - `ai.tags.mode: local_master` を読める。
   - `ai.tags.master_path` を設定ファイル相対で解決できる。
2. tag master load
   - `config/tag-master.yaml` を読める。
   - 空・重複・不正形式を検出できる。
3. tag validation
   - master 内タグだけ採用される。
   - master 外タグは破棄される。
   - `max_tags` が効く。
4. summarize job
   - AI 結果の `summary` / `short_summary` / `tags` / `category` が VaultRecord に反映される。
   - `## Raw Content` は変更されない。
   - `## AI Summary` のみ更新される。
5. mock AI
   - 外部 Cursor SDK を使わず、unit test で summary-first の更新経路を確認できる。

## 11. 実装タスク案

1. `config/tag-master.yaml` を追加する。
2. `types.ts` に Cursor AI provider と tag 設定型を追加する。
3. `config.ts` で `ai.tags` を parse / validate する。
4. tag master loader を追加する。
5. `ai-cursor.ts` adapter を追加する。
6. `orchestrator.ts` で `provider: cursor` を選択できるようにする。
7. `runSummarizeJob` で `tags` / `category` を patch に含める。
8. unit test を追加する。
9. README / DETAILED_DESIGN の設定例を更新する。

## 12. 未対応・将来拡張

- AI の新規タグ候補ログ。
- `status: failed` の再処理。
- `summarized` レコードの強制再要約。
- tag master の整理・重複検出 CLI。
- Notion DB から tag master を再生成する one-shot import command。
