# Notes From Coding Agents

updated_at: 2026-05-10

## Purpose

- Append-only implementation log for the `rss-summarize-cost-control` feature
- Place to preserve decisions, constraints, validation notes, and spec/code gaps that should survive the current session

## Append Rules

- Do not rewrite past entries; append at the end
- Keep facts, decisions, hypotheses, and open issues clearly separated
- Record any follow-up needed for `requirements.md`, `design.md`, or steering after human review
- Keep entries concise and useful for restart, review, and post-implementation spec sync

## Entry Template

```md
## YYYY-MM-DD HH:MM JST | agent=<codex|claude|cursor> | session=<thread-or-branch>

- Scope:
- Related specs:
- Related steering/docs:
- Related code:
- User instructions / decision source:
- Findings / rationale:
- Validation:
- Follow-up for protected docs:
```
