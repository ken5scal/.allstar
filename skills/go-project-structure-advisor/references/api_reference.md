# Go Structure Profile Matrix

Use this reference to classify project complexity and choose a practical directory pattern.

## Profiles

### P0: Lean single-application

Choose `P0` when most are true:
- One binary or one main CLI entrypoint.
- One team (or solo) owning all modules.
- Limited integrations and straightforward workflows.
- Main goal is speed of iteration over strict modular boundaries.

Recommended pattern: `handler/service/repository`.

Canonical tree:

```text
cmd/<app>/main.go
internal/
  config/
  model/
  handler/
  service/
  repository/
```

Notes:
- Keep interfaces at repository boundaries.
- Keep cross-cutting concerns as small helper packages only when needed (`internal/clock`, `internal/telemetry`).

### P1: Growing product with multiple bounded areas

Choose `P1` when one or more are true:
- Multiple independently evolving domains (for example ingest, billing, analytics).
- More than one runtime role (API + worker).
- Ownership boundaries start to matter for reviews and releases.

Recommended pattern: feature-oriented modules under `internal/<domain>`.

Canonical tree:

```text
cmd/
  api/main.go
  worker/main.go
internal/
  platform/          # shared infra: db, logging, queue, auth adapters
  ingest/
    handler/
    service/
    repository/
  digest/
    handler/
    service/
    repository/
```

Notes:
- Preserve `handler/service/repository` inside each domain module.
- Avoid global `service` or global `repository` once domain split starts.

### P2: Platform-scale or high-governance system

Choose `P2` only when clearly required:
- Strong compliance boundaries, multi-tenant isolation, complex event choreography.
- Multiple teams releasing semi-independently.
- Shared contracts and versioned interfaces are operationally necessary.

Recommended pattern: modular monolith or service set with explicit contracts.

Canonical tree:

```text
cmd/
  <service-a>/main.go
  <service-b>/main.go
internal/
  modules/
    <domain-a>/
      app/
      domain/
      infra/
      transport/
  platform/
    observability/
    persistence/
    messaging/
```

Notes:
- Use only with clear organizational and runtime need.
- Do not introduce this profile preemptively.

## Complexity Signals Checklist

Use this quick checklist before selecting `P1` or `P2`:

1. Number of binaries and runtime roles.
2. Number of bounded contexts with independent lifecycle.
3. Integration complexity and failure isolation requirements.
4. Team ownership boundaries and review bottlenecks.
5. Compliance/security constraints requiring strict segregation.

If uncertain, choose `P0`.

## Migration Guidance

### P0 -> P1
- Split by domain first, not by technical layer.
- Keep existing handlers/services/repositories and move them under domain folders.
- Create `internal/platform` for shared infra that is truly cross-domain.

### P1 -> P2
- Introduce explicit contracts and module boundaries only for proven hotspots.
- Move shared concerns into platform submodules with stable APIs.
- Prefer incremental extraction over full rewrite.

## Applied Example for Current Docs

For a design emphasizing:
- personal development and maintainability,
- single CLI entrypoint (`tick` based execution),
- avoidance of over-splitting,
- repository abstraction over external I/O,

select profile `P0` and use:

```text
cmd/obsflow/main.go
internal/
  config/
  model/
  handler/
  service/
  repository/
```
