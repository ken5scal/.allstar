---
name: test-depth-selector
description: Decide whether a change needs unit-only coverage, integration tests, or end-to-end tests, and produce an explicit test update plan with runnable commands.
allowed-tools: Read, Bash, Grep, Glob
argument-hint: <change-summary>
---

# test-depth-selector

## Overview

Use this skill to choose the correct testing depth for a code change:
- Unit tests only
- Unit + integration tests
- Unit + integration + E2E tests

It is designed to prevent both under-testing (missing E2E for runtime flows) and over-testing (slow, noisy E2E for isolated logic).

## When to Use

- Any implementation task that changes behavior
- Any task that introduces new configuration flags
- Any task that touches orchestration, providers, persistence, or external I/O
- Before claiming verification is complete

Do not use this skill for pure refactors with no behavioral change.

## Inputs

Provide:
- The change summary and acceptance criteria
- Touched files
- User-visible behavior expectations
- Existing test coverage relevant to the change
- Available CI/local test commands

## Outputs

Return:
- `REQUIRED_TEST_DEPTH`: `UNIT_ONLY` | `UNIT_AND_INTEGRATION` | `UNIT_INTEGRATION_E2E`
- `WHY`: concise rationale tied to concrete change surfaces
- `TEST_UPDATES`: exact tests to add/update
- `RUN_COMMANDS`: exact validation commands
- `GAPS`: anything not verifiable in current environment

## Decision Procedure

### 1) Always require unit coverage

If behavior changed, add or update unit tests for deterministic logic (parsing, transforms, pure branching).

### 2) Require integration tests when module boundaries matter

Require integration tests if correctness depends on interaction between two or more components, such as:
- adapter + job logic
- config parser + runtime selection
- state repository + processing flow

### 3) Escalate to E2E when runtime flow risk exists

Escalate to E2E if **any** condition is true:

1. Command-level behavior changed (CLI target behavior, orchestration sequence, exit/result behavior).
2. External I/O in user-visible flow changed (network fetch, vault/file output, DB/checkpoint writes, provider boundary effects).
3. Correctness depends on fallback/error handling across multiple components.
4. New config flags toggle runtime behavior in ways unit tests cannot fully represent.
5. Acceptance criteria are about final captured artifacts (not only helper outputs).

If one condition is true, choose `UNIT_INTEGRATION_E2E`.

## E2E Quality Bar

E2E tests should:
- Use deterministic local fixtures where possible (for example, in-test HTTP server).
- Assert final artifact content (for example, generated markdown/raw content).
- Assert critical side effects (for example, job status/checkpoint updates).
- Avoid nondeterministic external dependencies unless explicitly intended.

## If E2E Cannot Be Run Locally

Do not claim full validation.
Report:
- exact missing dependency (tool/runtime/service),
- exact CI command expected to validate,
- expected pass criteria.

## Project-Calibrated Example

For a `collect-rss` change that fetches linked article pages and writes extracted content to vault records:
- Unit: HTML extraction/hash update logic
- Integration: RSS collection path and config toggle parsing
- E2E: `run --targets collect-rss` with local feed/article fixture server, then assert vault `Raw Content` and job run status

This example maps to `UNIT_INTEGRATION_E2E`.

## Output Format

```md
## Test Depth Decision
- REQUIRED_TEST_DEPTH: UNIT_ONLY | UNIT_AND_INTEGRATION | UNIT_INTEGRATION_E2E
- WHY:
  - <condition triggered>
- TEST_UPDATES:
  - Unit: <files/cases>
  - Integration: <files/cases or N/A>
  - E2E: <files/cases or N/A>
- RUN_COMMANDS:
  - <command>
  - <command>
- GAPS:
  - <none or explicit gap>
```
