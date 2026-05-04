# TEST_PLAN

## 目的

`obsflow` を外部ネットワーク・外部API・実Slack・実1Passwordなしで検証できるようにし、チェックポイントごとに unit / integration / contract-fixture / idempotency-replay / failure-path / e2e smoke を段階的に実行する。

## 共通方針

- すべてのテストはオフラインで完結させる。
- X API、AI API、Slack Webhook、RSS HTTP取得、1Password CLI `op` はテスト時に必ず mock / fixture / env 注入へ差し替える。
- `obsflow` のデフォルト provider は安全側に倒し、X は `mock` を既定にする。
- fixture ベースの contract test を置き、real provider skeleton が同じ domain model に変換できる前提を保つ。
- fail-soft 時の終了コード優先順位は `1 > 2 > 3` とする。
- 主要コマンド:
  - `go test ./... -count=1`
  - `go test -race ./... -count=1`

## Checkpoint 1: 土台（cmd/config/slog/uuid run_id）

### 対象

- `cmd/obsflow`
- `internal/config`
- `internal/handler`
- `internal/logging`
- `internal/apperror`

### Unit / Integration

```bash
go test ./internal/config ./internal/handler ./internal/logging ./internal/apperror -count=1
go test ./... -run 'TestValidateConfig|TestRootCommand|TestTickRunID|TestJSONLogger' -count=1
```

### Failure-path

```bash
go test ./... -run 'TestValidateConfigMissingRequired|TestExitCodeConfigError' -count=1
```

### 全体

```bash
go test ./... -count=1
go test -race ./... -count=1
```

## Checkpoint 2: state repository (SQLite) + Tx境界

### 対象

- `internal/repository/interfaces.go`
- `internal/repository/state_sqlite.go`
- `internal/model`

### Unit / Integration

```bash
go test ./internal/repository -run 'TestSQLiteStateRepository' -count=1
go test ./internal/repository -run 'TestStateRepositoryInTx' -count=1
```

### Idempotency / Replay

```bash
go test ./internal/repository -run 'TestSeenSourceItemIdempotent|TestContentHashReplay|TestJobRunReplay' -count=1
```

### Failure-path

```bash
go test ./internal/repository -run 'TestStateTxRollbackOnError|TestStateRepositoryClose' -count=1
```

## Checkpoint 3: vault repository + summary置換

### 対象

- `internal/repository/vault_fs.go`
- `internal/service/summarize_service.go`
- `testdata/vault`

### Unit

```bash
go test ./internal/repository -run 'TestVaultWriteRecord|TestReplaceAISummarySection' -count=1
```

### Contract-fixture

```bash
go test ./internal/repository -run 'TestVaultFrontmatterMatchesObsidianSchemaFixture' -count=1
```

### Idempotency / Replay

```bash
go test ./internal/repository -run 'TestVaultUpsertRecordIdempotent|TestAISummaryReplacementDoesNotChangeRawContent' -count=1
```

## Checkpoint 4: source repository: RSS + X mock

### 対象

- `internal/repository/source_rss.go`
- `internal/repository/source_x.go`
- `testdata/rss`
- `testdata/x`

### Unit

```bash
go test ./internal/repository -run 'TestRSSParseFixture|TestXMockSearch|TestXMockLists|TestXMockBookmarks' -count=1
```

### Contract-fixture

```bash
go test ./internal/repository -run 'TestRSSFixtureContract|TestXAPIFixtureContract' -count=1
```

### 外部ネットワーク未使用保証

```bash
go test ./internal/repository -run 'TestRSSFixtureDoesNotUseNetwork|TestXMockDoesNotUseNetwork' -count=1
```

## Checkpoint 5: AI mock + digest生成

### 対象

- `internal/repository/ai_mock.go`
- `internal/service/summarize_service.go`
- `internal/service/digest_service.go`

### Unit

```bash
go test ./internal/service -run 'TestSummarizeWithAIMock|TestBuildDigestWithAIMock' -count=1
```

### Contract-fixture

```bash
go test ./internal/service -run 'TestDigestFixtureDaily|TestDigestFixtureWeekly|TestDigestFixtureMonthly' -count=1
```

### Idempotency / Replay

```bash
go test ./internal/service -run 'TestSummarizeReplayUpdatesOnlyAISummary|TestDigestReplayStableOutput' -count=1
```

## Checkpoint 6: tick due判定（LastJobRun/catch-up/fail-soft）

### 対象

- `internal/service/tick_service.go`
- `internal/service/schedule.go`

### Unit / Integration

```bash
go test ./internal/service -run 'TestTickDueByLastJobRun|TestTickCatchUpRunsOneSlot|TestTickSkipsNotDue' -count=1
```

### Failure-path / exit code priority

```bash
go test ./internal/service ./internal/handler -run 'TestFailSoftContinuesAfterTargetFailure|TestExitCodePriority1Over2Over3|TestExitCodePriority2Over3' -count=1
```

## Checkpoint 7: alert/slack mock連携

### 対象

- `internal/repository/alert_mock.go`
- `internal/repository/alert_slack.go`
- `internal/service/tick_service.go`

### Unit / Integration

```bash
go test ./internal/repository ./internal/service -run 'TestAlertMockSendError|TestTickSendsAlertOnFailure' -count=1
```

### Failure-path

```bash
go test ./internal/service -run 'TestAlertDeduplicatesSameCauseInTick|TestAlertFailureDoesNotMaskHigherPriorityExitCode' -count=1
```

### 外部ネットワーク未使用保証

```bash
go test ./internal/repository -run 'TestSlackMockDoesNotUseNetwork' -count=1
```

## Checkpoint 8: xurl adapter skeleton（real provider）

### 対象

- `internal/repository/source_x_xurl.go`

### Unit / Skeleton contract

```bash
go test ./internal/repository -run 'TestXURLAdapterBuildsCommand|TestXURLAdapterParsesFixtureOutput|TestXURLAdapterContextCancel' -count=1
```

### 外部ネットワーク未使用保証

```bash
go test ./internal/repository -run 'TestXURLAdapterUsesFakeCommandInTests' -count=1
```

## Checkpoint 9: e2eスモーク（完全オフライン）

### 対象

- `test/e2e` または `internal/e2e`
- `testdata/e2e`

### E2E smoke

```bash
go test ./... -run 'TestOfflineTickSmoke' -count=1
```

### Replay / Idempotency

```bash
go test ./... -run 'TestOfflineTickSmokeReplayDoesNotDuplicateRecords|TestOfflineTickSmokeCatchUp' -count=1
```

### Failure-path

```bash
go test ./... -run 'TestOfflineTickSmokeFailSoftAndAlert|TestOfflineTickSmokeExitCodePriority' -count=1
```

## リリース前総合確認

```bash
go test ./... -count=1
go test -race ./... -count=1
```

追加で、CLI バイナリの smoke を行う場合:

```bash
go run ./cmd/obsflow validate --config ./testdata/e2e/config.yaml
go run ./cmd/obsflow tick --config ./testdata/e2e/config.yaml
```

いずれも外部ネットワーク・実API・実Webhook・実`op`を使わない fixture 構成で実行する。
