#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node --check "$ROOT/scripts/overlay.js"
node --check "$ROOT/scripts/findings.mjs"
node --check "$ROOT/scripts/validate-findings.mjs"
node --check "$ROOT/scripts/build-mount.mjs"
node "$ROOT/scripts/validate-findings.mjs" "$ROOT/references/example-findings.json"

MOUNT="$(node "$ROOT/scripts/build-mount.mjs" "$ROOT/references/example-findings.json")"
[[ "$MOUNT" == window.contextualAnnotations.mount* ]]
[[ "$MOUNT" == *'"id":"IA-01"'* ]]
[[ "$MOUNT" == *'"status":"resolved"'* ]]

echo "contextual-annotations checks passed"
