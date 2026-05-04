# 個人向け情報収集・要約パイプライン: 詳細設計

最終更新: 2026-05-04

## 1. 目的

`ARCHITECTURE_OVERVIEW.md` で合意した全体構成を、実装可能な粒度まで具体化する。

本ドキュメントは、個人開発で運用し続けられるシンプルさを優先する。

## 2. 設計原則

1. 単一実行入口を基本とし、定期実行は `obsflow tick` を中心に運用する。
2. レコード粒度は 1 ソース = 1 レコードを維持する。
3. 通知は定期ジョブではなく、エラーハンドリングの横断モジュールとして扱う。
4. Go の一般的な実装パターンに沿い、過剰分割を避ける。
5. 状態管理は interface で抽象化し、SQLite 以外のストアへ将来差し替え可能にする。

## 3. 技術スタック

- 言語: Go 1.25
- CLI: `spf13/cobra`
- 設定ファイル: YAML (`gopkg.in/yaml.v3`)
- 定期実行: macOS launchd
- 初期状態ストア: SQLite
- 通知: Slack Incoming Webhook

## 4. ディレクトリ構成

個人開発の保守性を重視し、`handler / service / repository` に寄せた最小構成とする。

```text
cmd/obsflow/main.go

internal/
  config/
    load.go
    types.go
  model/
    record.go
    job.go
  handler/
    tick.go
    run.go
  service/
    tick_service.go
    collect_service.go
    summarize_service.go
    digest_service.go
  repository/
    interfaces.go
    state_sqlite.go
    state_postgres.go      # 将来の非ローカル環境用 (初期は stub 可)
    source_rss.go
    source_x.go
    vault_fs.go
    ai_external.go
    alert_slack.go
```

補足:
- `internal` はアプリ固有コードを外部公開しないために利用する。
- `pkg` は外部向けライブラリ提供の必要が出るまで作成しない。

## 5. レイヤー責務

### 5.1 handler 層
- CLI の引数解釈と入出力制御を担当。
- ビジネスロジックは持たず、service 層を呼ぶ。

### 5.2 service 層
- ユースケース単位の処理フローを担当。
- repository interface に依存し、実装詳細には依存しない。

### 5.3 repository 層
- 外部 I/O を担当 (X API、RSS、Vault ファイル、AI API、Slack、状態 DB)。
- 永続化や API 呼び出しをカプセル化する。

## 6. CLI 仕様

## 6.1 コマンド名と構成

- 実行ファイル名は `obsflow` とする。
- `pipeline` は汎用名で衝突や誤認が起きやすいため、本プロジェクトでは利用しない。

コマンド構成:

- `obsflow tick --config <path>`
  - 定期実行用の主コマンド。設定に基づいて実行対象を判定する。
- `obsflow run --config <path> --targets <csv>`
  - 手動実行用。`targets` で明示した処理のみ実行する。
- `obsflow validate --config <path>`
  - 設定ファイル検証のみを行う。

`tick` はサブコマンド名であり、オプションではない。

## 6.2 `targets` の値

`run` で指定可能なターゲット:

- `collect-rss`
- `collect-x-search`
- `collect-x-lists`
- `collect-x-bookmarks`
- `summarize`
- `digest`

## 6.3 終了コード

- `0`: 正常終了
- `1`: 設定・入力エラー
- `2`: 外部依存エラー (API/ネットワーク/DB)
- `3`: 処理失敗 (一部または全体)

## 7. 設定ファイル仕様 (YAML)

k8s/dbt のように、上位に `version`、中位に `defaults`、下位に宣言配列を持つ形を採用する。

```yaml
version: 1
timezone: "Asia/Tokyo"

defaults:
  vault_path: "/Users/you/ObsidianVault"
  state:
    driver: "sqlite"
    dsn: "./state.db"
  alert:
    slack_webhook_env: "SLACK_WEBHOOK_URL"

sources:
  rss:
    - id: "hn"
      enabled: true
      url: "https://news.ycombinator.com/rss"
      schedule: "*/30 * * * *"

  x:
    search:
      - id: "ai-search"
        enabled: true
        query: "(llm OR agent) lang:ja -is:retweet -is:reply"
        schedule: "*/15 * * * *"
    lists:
      - id: "trusted-list"
        enabled: true
        list_id: "1234567890"
        schedule: "*/20 * * * *"
    bookmarks:
      - id: "my-bookmarks"
        enabled: true
        schedule: "0 * * * *"

jobs:
  summarize:
    enabled: true
    schedule: "*/15 * * * *"
  digest:
    enabled: true
    daily: "0 22 * * *"
    weekly: "0 21 * * 0"
```

## 8. 実行シーケンス

`tick` 実行時の標準フロー:

1. 設定読込・検証
2. 実行時刻に該当する source 収集を順次実行
3. 収集結果を 1 レコード単位で Vault へ保存
4. 該当時刻なら summarize を実行
5. 該当時刻なら digest を実行
6. 失敗があれば Alert で Slack 通知

失敗が発生しても、他ターゲットが実行可能なら継続する (fail-soft)。

## 9. 状態管理設計

状態管理は以下のために必須:

- 増分取得 (X の since_id、RSS の取得境界)
- 重複防止
- 失敗復旧
- 定期処理の整合

### 9.1 repository interface

```go
type StateRepository interface {
    GetCheckpoint(ctx context.Context, sourceID string) (Checkpoint, error)
    PutCheckpoint(ctx context.Context, cp Checkpoint) error

    Seen(ctx context.Context, contentHash string) (bool, error)
    MarkSeen(ctx context.Context, contentHash string, meta SeenMeta) error

    LastJobRun(ctx context.Context, jobID string) (JobRun, error)
    SaveJobRun(ctx context.Context, run JobRun) error

    Close() error
}
```

初期実装は SQLite、将来は PostgreSQL や DynamoDB への差し替えを想定する。

## 10. エラー通知設計

- 通知トリガー: 例外または非ゼロ終了相当の失敗
- 通知先: Slack Webhook
- 通知粒度: 失敗の都度
- 通知内容 (最小):
  - timestamp
  - target/source id
  - error summary
  - retry hint (可能なら)

## 11. ローカル運用 (launchd)

- launchd は一定間隔で `obsflow tick --config ...` を呼ぶ。
- スリープ復帰後の取りこぼしを避けるため、source 実装側で増分窓を持たせる。
- ログは標準出力/標準エラーへ出し、launchd 側でファイル化する。

## 12. 非ゴール / 将来拡張

本フェーズで扱わない事項:

- frontmatter の詳細項目定義
- トピック分類ルール詳細
- モデル評価・比較

将来拡張:

- GitHub Actions での同一バイナリ運用
- 状態ストアを非ローカル DB へ置換
- 通知チャネル追加 (メールなど)
