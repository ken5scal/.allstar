# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro-spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in English. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
- Phase 0 (optional): `/kiro-steering`, `/kiro-steering-custom`
- Discovery: `/kiro-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/kiro-spec-quick {feature} [--auto]` or step by step:
    - `/kiro-spec-init "description"`
    - `/kiro-spec-requirements {feature}`
    - `/kiro-validate-gap {feature}` (optional: for existing codebase)
    - `/kiro-spec-design {feature} [-y]`
    - `/kiro-validate-design {feature}` (optional: design review)
    - `/kiro-spec-tasks {feature} [-y]`
  - Multi-spec: `/kiro-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/kiro-impl {feature} [tasks]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `/kiro-validate-impl {feature}` (standalone re-validation)
- Progress check: `/kiro-spec-status {feature}` (use anytime)

## Skills Structure
Skills are located in `.claude/skills/kiro-*/SKILL.md`
- Each skill is a directory with a `SKILL.md` file
- Skills run inline with access to conversation context
- Skills may delegate parallel research to subagents for efficiency
- Additional files (templates, examples) can be added to skill directories
- `kiro-review` — task-local adversarial review protocol used by reviewer subagents
- `kiro-debug` — root-cause-first debug protocol used by debugger subagents
- `kiro-verify-completion` — fresh-evidence gate before success or completion claims
- `test-depth-selector` — choose and justify unit/integration/E2E test updates based on change risk and flow boundaries
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Test Cases(Should Fail) → Implementation  → Test and fix Until Succeed
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Documentation Governance
- `AGENTS.md`, `CLAUDE.md`, and every `.kiro/steering/*.md` file are mandatory context before planning, specification work, or implementation.
- Treat `.kiro/steering/**` and `.kiro/specs/**` as protected, human-reviewed documents.
- Do not create, edit, rename, or delete protected files unless the human explicitly approves that document change in the current thread.
- Exception: `.kiro/specs/<feature>/note-from-coding-agents.md` is agent-writable and append-only for the active feature.
- During implementation, append concise notes to the active feature's `.kiro/specs/<feature>/note-from-coding-agents.md` when user instructions, design rationale, implementation discoveries, validation findings, or spec/code mismatches need to survive the session.
- Each note entry must include date/time, agent name, session or branch identifier, related files/specs, and the key decision, finding, or open issue.
- After implementation is accepted in human review, compare the accepted code and feedback notes with steering/spec documents. If requirements or design are stale, propose the required updates and apply them only when the human explicitly approves the protected-document change.
- If work does not belong to an existing feature spec yet, keep restart notes in `docs/ai/` until the feature has a home under `.kiro/specs/`.
- `docs/` is for durable general project documentation.
- `docs/ai/` is for rough AI working notes, validation steps, and restart context scoped to one task, issue, or refactor slice.
- `docs/ai/plan/` is the canonical location for new plan outputs. Treat `docs/ai/plans/` as a legacy path and do not add new files there.

### Test Depth Policy (Unit / Integration / E2E)

- Every behavior change MUST update or add unit tests for deterministic logic.
- Add integration tests when behavior depends on interactions across modules/adapters but does not require full command orchestration.
- Add E2E tests when **any** of the following is true:
  - The change affects command-level behavior (for example, `run --targets ...`, orchestration sequencing, or final exit/result behavior).
  - The change adds or modifies external I/O in a user-visible flow (network fetch, vault/file output, DB/checkpoint writes, provider boundary effects).
  - Correctness depends on multi-step fallback/error paths spanning more than one component.
  - A new config flag toggles runtime behavior and a regression would not be caught by unit-only coverage.
  - Acceptance criteria are about final captured output artifacts rather than an isolated helper function.
- E2E tests should prefer deterministic local fixtures (for example, in-test HTTP servers) and verify both final artifact content and critical side effects (such as job status/checkpoint updates).
- If E2E is warranted but cannot run in the current environment, explicitly report the gap and provide the exact CI/local command needed; do not claim full validation.

## Steering Configuration
- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro-steering-custom`)
