---
name: obsflow-launchd
description: >-
  Registers, re-registers, stops, and updates the obsflow macOS LaunchAgent
  (launchctl bootstrap/bootout/kickstart) with plist validation (plutil).
  Covers editing launchd/obsflow.plist.example, installing to
  ~/Library/LaunchAgents/com.local.obsflow.plist, and verifying the job and
  logs. Use when the user mentions launchd, LaunchAgents, launchctl, obsflow
  scheduling, or plist updates for the tick job.
---

# obsflow LaunchAgent (launchctl)

## Scope

- **Platform:** macOS user LaunchAgent (`gui/$(id -u)` domain).
- **Label:** `com.local.obsflow` (must match `<key>Label</key>` in the plist).
- **Installed plist:** `$HOME/Library/LaunchAgents/com.local.obsflow.plist`
- **Source template (repo):** `launchd/obsflow.plist.example`
- **Logs (default in template):** `$HOME/Library/Logs/obsflow/obsflow.out.jsonl` and `obsflow.err.jsonl` after replacing placeholder home paths—see [Normalize placeholder paths](#normalize-placeholder-paths).

## Prerequisites

- `obsflow` entrypoint in the plist points at `dist/main.js` → run `npm run build` in the repo when TypeScript sources change.
- Log directory exists: `mkdir -p "$HOME/Library/Logs/obsflow"`.

## Normalize placeholder paths

The example plist uses `{{WORKING_DIRECTORY}}` and may contain `/Users/you/...` for Node and log paths. After copying to `LaunchAgents`, apply:

1. Replace `{{WORKING_DIRECTORY}}` with the absolute repo root (no trailing slash required, but be consistent).
2. Replace the example Node binary path with the real interpreter: `NODE_BIN="$(command -v node)"` and substitute the **ProgramArguments** node string (first array element).
3. If log or `PATH` entries still contain `/Users/you`, replace with the current user home so files are written under `$HOME`:

```bash
PLIST="$HOME/Library/LaunchAgents/com.local.obsflow.plist"
sed -i '' "s|/Users/you|$HOME|g" "$PLIST"
```

(If you already substituted the full node path in ProgramArguments, step 3 is still useful for `EnvironmentVariables` / `PATH` and `StandardOutPath` / `StandardErrorPath`.)

## Validate plist

Always lint before `bootstrap`:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
```

Fix XML/plist errors until this reports OK.

## Register (first install)

From the repository root:

```bash
REPO_DIR="$(pwd)"   # or set explicitly to the .allstar checkout
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/obsflow"
cp "launchd/obsflow.plist.example" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
NODE_BIN="$(command -v node)"
sed -i '' "s|{{WORKING_DIRECTORY}}|$REPO_DIR|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
sed -i '' "s|/Users/you/.nodebrew/current/bin/node|$NODE_BIN|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
sed -i '' "s|/Users/you|$HOME|g" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl bootout "gui/$(id -u)" com.local.obsflow 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```

`bootout` before `bootstrap` avoids errors if an older job with the same label is already loaded.

## Re-register (refresh from repo template)

Use when you want the installed plist to match an updated `launchd/obsflow.plist.example`:

1. Edit `launchd/obsflow.plist.example` in the repo (interval, config path, env, etc.).
2. Repeat **Register** from `cp ... obsflow.plist.example` onward (re-apply `sed`, `plutil -lint`, `bootout`, `bootstrap`, `kickstart`).

## Stop

Unload the job from the current GUI session:

```bash
launchctl bootout "gui/$(id -u)" com.local.obsflow
```

The plist file can remain in `LaunchAgents`; it will not run until bootstrapped again.

## Update (edit installed plist or template)

**Important:** `launchctl kickstart -k` restarts the **running process** only; it does **not** re-read the plist from disk.

- **Changed plist on disk** (edited `com.local.obsflow.plist` or re-copied from example): run `plutil -lint`, then **full reload**:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl bootout "gui/$(id -u)" com.local.obsflow 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.local.obsflow.plist"
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```

- **No plist change** (e.g. stuck process): process-only restart:

```bash
launchctl kickstart -k "gui/$(id -u)/com.local.obsflow"
```

## Verify

```bash
launchctl print "gui/$(id -u)/com.local.obsflow"
tail -n 100 "$HOME/Library/Logs/obsflow/obsflow.out.jsonl"
tail -n 100 "$HOME/Library/Logs/obsflow/obsflow.err.jsonl"
```

Confirm `state`, `pid`, and last exit status in `launchctl print`; use stderr log for immediate failures (missing `dist/main.js`, bad config path, etc.).

## Pitfalls

- **Label mismatch:** `bootstrap` / `bootout` / `kickstart` must use label `com.local.obsflow` and domain `gui/$(id -u)`.
- **kickstart path:** Use `gui/$(id -u)/com.local.obsflow` (with slash before label) for `kickstart`.
- **WorkingDirectory:** Must be the repo root if `ProgramArguments` uses relative `--config` paths under that tree.

## Reference in repo

- [README.md](../../README.md) — Operations Quickstart (Register / Stop and restart).
- [launchd/obsflow.plist.example](../../launchd/obsflow.plist.example) — template plist (`StartInterval`, `tick`, config path).
