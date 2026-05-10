# .allstar

## Documentation

- [Architecture Overview](./ARCHITECTURE_OVERVIEW.md)
- [Detailed Design](./DETAILED_DESIGN.md)
- [Obsidian Schema](./OBSIDIAN_SCHEMA.md)
- [TEST_PLAN](./TEST_PLAN.md)

## obsflow (TypeScript CLI)

Personal RSS / X ingest pipeline with SQLite state, optional Cursor SDK vault agent, and Slack alerts.

**Prerequisite:** Node.js 24 or later (see `engines` in `package.json` and [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

```bash
npm install
npm run lint
npm run build
npm run obsflow -- validate --config test/fixtures/config.mock.yaml
OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- tick --config test/fixtures/config.mock.yaml
npm run obsflow -- run --config examples/config.yaml
npm run obsflow -- run --config examples/config.yaml --targets collect-rss
```

Optional credentials via `.env` (`CURSOR_API_KEY`, `SLACK_WEBHOOK_URL`, `X_BEARER_TOKEN`, etc.). See [TEST_PLAN.md](./TEST_PLAN.md) for test and smoke commands. Example launchd: [launchd/obsflow.plist.example](launchd/obsflow.plist.example).

## Operations Quickstart

### Clear state DB

`examples/config.yaml` currently points `defaults.state.dsn` to:

`/Users/k.suzuki/workspace/ken5scal/KnowledgeBase/state.db`

```bash
mv "/Users/k.suzuki/workspace/ken5scal/KnowledgeBase/state.db" "/Users/k.suzuki/workspace/ken5scal/KnowledgeBase/state.db.bak.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
rm -f "/Users/k.suzuki/workspace/ken5scal/KnowledgeBase/state.db-wal" "/Users/k.suzuki/workspace/ken5scal/KnowledgeBase/state.db-shm"
```

### Local one-shot run

```bash
cd /Users/k.suzuki/workspace/.allstar
npm run obsflow -- validate --config examples/config.yaml
OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- run --config examples/config.yaml --targets collect-rss,summarize
```

### Register launchd

```bash
cd /Users/k.suzuki/workspace/.allstar
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/obsflow"
cp "launchd/obsflow.plist.example" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
NODE_BIN="$(which node)"
REPO_DIR="/Users/k.suzuki/workspace/.allstar"
sed -i '' "s|{{WORKING_DIRECTORY}}|$REPO_DIR|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
sed -i '' "s|/Users/you/.nodebrew/current/bin/node|$NODE_BIN|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl bootout "gui/$(id -u)" com.local.obsflow 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```

### Stop and restart launchd

**Stop (unload the agent):** removes the job from your user’s `launchd` session until you bootstrap it again.

```bash
launchctl bootout "gui/$(id -u)/com.local.obsflow"
```

**Restart a job that is already loaded:** kills the running process and starts a new one (does not re-read the plist from disk).

```bash
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```

**Reload after editing the plist:** boot out, bootstrap the updated file, then kickstart (same sequence as in [Register launchd](#register-launchd) after `plutil -lint`).

```bash
launchctl bootout "gui/$(id -u)" com.local.obsflow 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```

To inspect:

```bash
launchctl print "gui/$(id -u)/com.local.obsflow"
tail -n 100 "$HOME/Library/Logs/obsflow/obsflow.out.jsonl"
tail -n 100 "$HOME/Library/Logs/obsflow/obsflow.err.jsonl"
```

- 設定ファイル内の相対パス（例: RSS mock の `fixture`、`state.dsn`）は **その YAML ファイルがあるディレクトリ** を基準に解決される（`obsflow tick --config path/to/config.yaml` 想定）。
- `base_ids` は現時点では任意の補助プロパティです。既定 Base は `record_kind` で機能しますが、将来の複数 Base 振り分けに備えて保持しています。
- `defaults.rss_provider: feedsmith` の場合、RSS 各 item のリンク先記事本文を取得し、見出し/強調/リスト/リンク/画像/コードなどを可能な限り Obsidian 向け Markdown へ変換して `Raw Content` に保存する（`sources.rss[].fetch_article_content: false` で無効化可能）。あわせて Breadcrumb / Share / Audio プレイヤー等の定型 UI ノイズは優先的に除外する。
