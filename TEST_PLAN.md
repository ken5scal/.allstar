# TEST_PLAN.md — obsflow

## 基本方針

- 実行・CI の Node は **24**（`package.json` `engines` / GitHub Actions と一致）。
- 既定テストは外部ネットワークなし（RSS mock / X mock / Vault mock）。
- 実API・Slack・Cursor Agent は手動または `OBSFLOW_*` / 契約テストで明示有効化する。
- `OBSFLOW_SKIP_TICK_LOCK=1` でテスト並列・ローカル実行時の tick ロックを無効化できる。

## CP 別テスト観点（要約）

| CP | 観点 |
|----|------|
| CP0 | CLI `validate` / 設定パース / `tick_run_id` ログ |
| CP1 | SQLite checkpoint・seen・job_runs・`inTx` |
| CP2 | feedsmith fixture → `SourceItem`、収集の idempotency、`records` パステンプレート |
| CP3 | Vault note 本文・frontmatter、`.base` YAML 生成（Agent は手動 smoke） |
| CP4 | summarize / digest（mock AI） |
| CP5 | 失敗時 exit 優先度、Slack mock、RSS URL 到達不能の失敗 |
| CP6 | x-sdk / launchd 例（手動） |

## コマンド

| 種別 | コマンド |
|------|-----------|
| unit | `npm run test:unit` |
| integration | `npm run test:integration` |
| contract-fixture | `npm run test:contract-fixture` |
| idempotency | `npm run test:idempotency` |
| failure-path | `npm run test:failure-path` |
| 全部 | `OBSFLOW_SKIP_TICK_LOCK=1 npm test` |
| typecheck | `npm run typecheck` |
| lint | `npm run lint` |
| build | `npm run build` |
| validate | `npm run obsflow -- validate --config test/fixtures/config.mock.yaml` |
| tick | `OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- tick --config test/fixtures/config.mock.yaml` |
| run all (manual) | `npm run obsflow -- run --config config/config.yaml` |
| run targets | `OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- run --config test/fixtures/config.mock.yaml --targets collect-rss,summarize` |
| smoke | `npm run smoke` |

- summarize の backlog 制御を使う場合、manual 実行結果に `pending` / `selected` / `deferred` が出る。
- `jobs[].selection.skip_if_pending_over` を超えた backlog では summarize は成功終了のまま defer され、ノートは `captured` のまま残る。

## CP6 手動

- X: `sources.x.provider: x-sdk`、環境変数 `X_BEARER_TOKEN`、Bookmarks 利用時は `X_OAUTH2_ACCESS_TOKEN`。
- [TypeScript XDK overview](https://docs.x.com/xdks/typescript/overview) を参照。
- launchd: [launchd/obsflow.plist.example](launchd/obsflow.plist.example) をベースに `ProgramArguments` とログパスを自分の環境に合わせる。

## 運用メモ（ローカル）

### 状態 DB を完全リセットする

```bash
STATE_DB="/absolute/path/to/your/state.db"
mv "$STATE_DB" "$STATE_DB.bak.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
rm -f "${STATE_DB}-wal" "${STATE_DB}-shm"
```

### ローカル単発実行（収集→要約）

```bash
cd /absolute/path/to/.allstar
npm run obsflow -- validate --config config/config.yaml
OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- run --config config/config.yaml --targets collect-rss,summarize
```

### launchd 登録

```bash
REPO_DIR="/absolute/path/to/.allstar"
cd "$REPO_DIR"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/obsflow"
cp "launchd/obsflow.plist.example" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
NODE_BIN="$(which node)"
sed -i '' "s|{{WORKING_DIRECTORY}}|$REPO_DIR|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
sed -i '' "s|/Users/you/.nodebrew/current/bin/node|$NODE_BIN|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl bootout "gui/$(id -u)" com.local.obsflow 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```
