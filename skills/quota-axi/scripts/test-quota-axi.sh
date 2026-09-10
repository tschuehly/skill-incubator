#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FIXTURES="$HERE/../tests/fixtures"
CLI="$HERE/quota-axi"

assert_line() {
  local output="$1" expected="$2"
  grep -Fx "$expected" <<<"$output" >/dev/null || {
    printf 'expected line %s\noutput:\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

out="$($CLI recommend --task-shape bulk --input "$FIXTURES/healthy.json")"
assert_line "$out" 'ROUTE=configured'
assert_line "$out" 'FRESHNESS=fresh'

out="$($CLI recommend --task-shape fanout --input "$FIXTURES/claude-low.json")"
assert_line "$out" 'ROUTE=codex'

out="$($CLI recommend --task-shape bulk --input "$FIXTURES/codex-critical.json")"
assert_line "$out" 'ROUTE=claude'
assert_line "$out" 'CODEX_RESET=2026-07-17T00:00:00Z'

out="$($CLI recommend --task-shape review --input "$FIXTURES/stale.json")"
assert_line "$out" 'ROUTE=mixed'
assert_line "$out" 'FRESHNESS=stale'

printf 'quota-axi recommendation tests: PASS\n'
