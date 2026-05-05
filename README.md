# .allstar

## Documentation

- [Architecture Overview](./ARCHITECTURE_OVERVIEW.md)
- [Detailed Design](./DETAILED_DESIGN.md)
- [Obsidian Schema](./OBSIDIAN_SCHEMA.md)
- [TEST_PLAN](./TEST_PLAN.md)

## obsflow (TypeScript CLI)

Personal RSS / X ingest pipeline with SQLite state, optional Cursor SDK vault agent, and Slack alerts.

```bash
npm install
npm run build
npm run obsflow -- validate --config test/fixtures/config.mock.yaml
OBSFLOW_SKIP_TICK_LOCK=1 npm run obsflow -- tick --config test/fixtures/config.mock.yaml
```

Optional credentials via `.env` (`CURSOR_API_KEY`, `SLACK_WEBHOOK_URL`, `X_BEARER_TOKEN`, etc.). See [TEST_PLAN.md](./TEST_PLAN.md) for test and smoke commands. Example launchd: [launchd/obsflow.example.plist](launchd/obsflow.example.plist).

