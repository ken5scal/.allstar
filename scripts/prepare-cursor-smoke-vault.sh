#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="$ROOT/test/work/cursor-ai-smoke-vault"
SRC="$ROOT/test/fixtures/test-output-vault"

rm -rf "$VAULT"
mkdir -p "$VAULT/src/rss/sample/2026/05/05"
cp "$SRC/Records.base" "$VAULT/Records.base"
cp "$SRC/src/rss/sample/2026/05/05/second.md" "$VAULT/src/rss/sample/2026/05/05/second.md"

echo "Prepared smoke vault at $VAULT (one captured note: second.md)"
