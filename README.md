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

Optional credentials via `.env` (`CURSOR_API_KEY`, `SLACK_WEBHOOK_URL`, `X_BEARER_TOKEN`, etc.). See [TEST_PLAN.md](./TEST_PLAN.md) for test and smoke commands. Example launchd: [launchd/obsflow.example.plist](launchd/obsflow.example.plist).

- 設定ファイル内の相対パス（例: RSS mock の `fixture`、`state.dsn`）は **その YAML ファイルがあるディレクトリ** を基準に解決される（`obsflow tick --config path/to/config.yaml` 想定）。
- `base_ids` は現時点では任意の補助プロパティです。既定 Base は `record_kind` で機能しますが、将来の複数 Base 振り分けに備えて保持しています。
- `defaults.rss_provider: feedsmith` の場合、RSS 各 item のリンク先記事本文を取得し、見出し/強調/リスト/リンク/画像/コードなどを可能な限り Obsidian 向け Markdown へ変換して `Raw Content` に保存する（`sources.rss[].fetch_article_content: false` で無効化可能）。あわせて Breadcrumb / Share / Audio プレイヤー等の定型 UI ノイズは優先的に除外する。
