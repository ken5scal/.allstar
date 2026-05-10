# Brief: rss-summarize-cost-control

## Problem
When several RSS feeds are configured at once, the first `collect-rss` run can capture 10-30 records per feed. The current `summarize` job then treats every `status: captured` record under the records root as eligible in one pass, which creates a risk of unexpected AI cost.

## Current State
`collect-rss` writes every new item as a vault record with `status: captured`. `runSummarizeJob()` scans all notes under `cfg.records.root_folder`, reads each record, and summarizes every captured record with no built-in cap, no deterministic backlog policy, and no first-run bootstrap protection.

## Desired Outcome
Summarization cost should be bounded and predictable before execution. A user should not be able to accidentally summarize a large initial backlog through `tick` or a plain manual `run`. The system should support gradual backlog processing and make the selected summarize scope visible before spend happens.

## Approach
Add cost-control guardrails around backlog creation and backlog consumption. Prefer a narrow first implementation that adds summarize-side selection limits and deterministic ordering, then consider collect-side bootstrap limits if initial backlog size still creates too much operational risk.

## Scope
- **In**: summarize target selection policy, per-run caps, deterministic ordering, manual/tick safety, operator-visible summary counts
- **Out**: AI provider changes, pricing estimation against live provider rates, unrelated digest behavior, full queueing system redesign

## Boundary Candidates
- Summarize-side backlog selection and execution policy
- Collect-side first-run/bootstrap import policy
- CLI/operator preview and observability for pending summarize work

## Out of Boundary
- Replacing Cursor SDK
- Reworking vault note schema
- Changing RSS parsing semantics outside backlog/cost control

## Upstream / Downstream
- **Upstream**: RSS collection, vault record creation, record status model, config parsing
- **Downstream**: summarize job execution, manual run UX, scheduled `tick` behavior, tests and operational docs

## Existing Spec Touchpoints
- **Extends**: none yet
- **Adjacent**: RSS ingestion steering in `.kiro/steering/rss-ingestion.md`, summarize observability plans in `docs/OBSERVABILITY_CONTENT_CATEGORY_PLAN.md`

## Constraints
Keep the first implementation small and safe. The chosen guardrail must work for both manual `run` and scheduled `tick`, and test coverage should include command-level behavior because the change affects orchestration and final execution scope.
