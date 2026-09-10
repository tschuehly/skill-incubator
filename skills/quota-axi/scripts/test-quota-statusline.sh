#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STATUSLINE="$HERE/quota-statusline.mjs"
CONFIGURATOR="$HERE/configure-statusline.mjs"
FIXTURE="$HERE/../tests/fixtures/statusline.json"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quota-statusline-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

OUTPUT="$($STATUSLINE --quota-only --input "$FIXTURE")"
test "$OUTPUT" = 'Claude⚠ S67% W65% F64% | Codex W81%'

printf '%s\n' '{"theme":"dark","model":"claude-test"}' > "$ROOT/settings.json"
"$CONFIGURATOR" "$ROOT/settings.json" >/dev/null
jq -e --arg command "$STATUSLINE" \
  '.theme == "dark" and .model == "claude-test" and .statusLine.command == $command and .statusLine.refreshInterval == 10' \
  "$ROOT/settings.json" >/dev/null
test -f "$ROOT/settings.json.pre-quota-statusline"

printf 'quota statusline tests: PASS\n'
