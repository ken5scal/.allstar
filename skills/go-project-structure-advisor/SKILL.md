---
name: go-project-structure-advisor
description: Propose and scaffold right-sized Go project structures based on scale and operational needs without over-engineering. Use when users ask how to organize Golang repositories, compare architecture patterns, decide whether handler/service/repository is enough, or generate a starter directory layout from design documents such as DETAILED_DESIGN.md and ARCHITECTURE_OVERVIEW.md.
---

# Go Project Structure Advisor

## Overview

Select a practical Go architecture pattern that matches project scale, then provide a concrete directory structure and guardrails. Start simple and add layers only when explicit complexity signals appear.

## Workflow

Follow this sequence:

1. Read context docs and constraints first.
   - Prioritize architecture or detailed design docs when provided.
   - Inspect existing repository tree if user asks for migration or incremental refactor.
2. Classify scale with `references/api_reference.md`.
   - Use profile `P0` unless clear evidence requires `P1` or `P2`.
3. Decide one target pattern and explain trade-offs.
   - State why a simpler/more complex option was not selected.
4. Produce output using the "Response Format" section below.
5. If user asks to create files, scaffold with `scripts/recommend_layout.py`.
   - Run script with `--profile` and `--scaffold-root`.
   - Re-check generated tree and adjust names to project terminology.

## Decision Rules

Apply these default rules:

- Prefer `handler/service/repository` for small to medium single-product systems.
- Keep business flow in service; keep external I/O in repository.
- Keep transport concerns in handler only.
- Keep models in `internal/model` unless domain boundaries become explicit.
- Add `pkg/` only when building reusable public libraries.
- Avoid adding `usecase`, `domain`, `application`, or `infrastructure` packages unless complexity signals are present.

Escalate architecture only when at least one is true:

- Multiple independently deployable services or workers share code.
- Distinct bounded contexts with separate lifecycle or ownership.
- Significant cross-cutting concerns (multi-tenant, eventing, strict transactional boundaries).
- Team size and review load require stricter module ownership boundaries.

## Response Format

Use this exact high-level structure:

1. Decision
   - Selected profile (`P0`/`P1`/`P2`) and selected pattern.
2. Recommended directory tree
   - Show concise tree only.
3. Why this fits now
   - 3-5 bullets tied to user constraints.
4. Guardrails
   - 3-5 bullets describing what not to add yet.
5. Scale-up triggers
   - Explicit conditions that should prompt moving to the next profile.
6. Optional scaffolding command
   - Include script command when user wants file creation.

## Resources

### scripts/
- `scripts/recommend_layout.py`
  - Print recommended directory tree by profile.
  - Optionally scaffold starter folders/files with `--scaffold-root`.

### references/
- `references/api_reference.md`
  - Profile matrix (`P0`/`P1`/`P2`) and complexity signals.
  - Canonical directory templates and migration hints.

## Example Trigger

Use this skill for requests like:

- "この規模なら Go のレイヤーはどこまで分けるべき？"
- "handler/service/repository で十分か判断したい"
- "DETAILED_DESIGN.md を見て最小構成のディレクトリを作って"
