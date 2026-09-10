#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FIXTURES="$HERE/../tests/fixtures"
VALIDATOR="$HERE/contract.mjs"
LEASE="$HERE/workspace-lease.mjs"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agent-orchestration-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

"$VALIDATOR" validate "$FIXTURES/handoff.json" | grep -Fx 'CONTRACT=PASS' >/dev/null
"$VALIDATOR" validate "$FIXTURES/checkpoint.json" | grep -Fx 'CONTRACT=PASS' >/dev/null
if "$VALIDATOR" validate "$FIXTURES/invalid.json" >/dev/null 2>&1; then
  echo 'invalid contract unexpectedly passed' >&2
  exit 1
fi
if "$VALIDATOR" validate "$FIXTURES/invalid-lease.json" >/dev/null 2>&1; then
  echo 'invalid workspace lease unexpectedly passed' >&2
  exit 1
fi
jq '.workspaceLease.mutableOutputs=["target"]' "$FIXTURES/handoff.json" > "$ROOT/invalid-shared.json"
if "$VALIDATOR" validate "$ROOT/invalid-shared.json" >/dev/null 2>&1; then
  echo 'shared-read lease with mutable outputs unexpectedly passed' >&2
  exit 1
fi
"$VALIDATOR" template handoff | grep -F '"kind": "handoff"' >/dev/null
"$VALIDATOR" template handoff | grep -F '"workspaceLease"' >/dev/null
"$VALIDATOR" template handoff | grep -F '"modelBinding"' >/dev/null
"$VALIDATOR" template handoff | grep -F '"lifecycle"' >/dev/null
"$VALIDATOR" template handoff | grep -F '"effort": "replace-with-routed-effort"' >/dev/null

jq '.lifecycle.mode="reuse-reviewer"' "$FIXTURES/handoff.json" > "$ROOT/invalid-lifecycle.json"
if "$VALIDATOR" validate "$ROOT/invalid-lifecycle.json" >/dev/null 2>&1; then
  echo 'invalid lifecycle unexpectedly passed' >&2
  exit 1
fi
jq '.lifecycle.mode="fresh-per-artifact" | .lifecycle.artifactRevision=null' "$FIXTURES/handoff.json" > "$ROOT/missing-artifact-revision.json"
if "$VALIDATOR" validate "$ROOT/missing-artifact-revision.json" >/dev/null 2>&1; then
  echo 'fresh reviewer without artifact revision unexpectedly passed' >&2
  exit 1
fi
jq '.lifecycle.mode="fresh-per-artifact" | .lifecycle.artifactRevision="git:abc123"' "$FIXTURES/handoff.json" > "$ROOT/fresh-reviewer.json"
"$VALIDATOR" validate "$ROOT/fresh-reviewer.json" | grep -Fx 'LIFECYCLE=fresh-per-artifact' >/dev/null
jq '.modelBinding.effort="auto"' "$FIXTURES/handoff.json" > "$ROOT/invalid-effort.json"
if "$VALIDATOR" validate "$ROOT/invalid-effort.json" >/dev/null 2>&1; then
  echo 'invalid model effort unexpectedly passed' >&2
  exit 1
fi
jq 'del(.modelBinding.quotaSnapshot)' "$FIXTURES/handoff.json" > "$ROOT/missing-quota.json"
if "$VALIDATOR" validate "$ROOT/missing-quota.json" >/dev/null 2>&1; then
  echo 'handoff without raw quota snapshot unexpectedly passed' >&2
  exit 1
fi
jq '.modelBinding.quotaSnapshot.stale=true | .modelBinding.quotaSnapshot.refreshedAt=null | .modelBinding.quotaSnapshot.error=null' \
  "$FIXTURES/handoff.json" > "$ROOT/stale-without-evidence.json"
if "$VALIDATOR" validate "$ROOT/stale-without-evidence.json" >/dev/null 2>&1; then
  echo 'stale quota without refresh timestamp and error unexpectedly passed' >&2
  exit 1
fi

STORE="$ROOT/leases.json"
WORKSPACE="$ROOT/worktree"
mkdir -p "$WORKSPACE"
jq --arg path "$WORKSPACE" '.workspaceLease |=
  (.id="writer-one" | .mode="exclusive" | .path=$path | .mutableOutputs=["target"] | .activeProcess=null)' \
  "$FIXTURES/handoff.json" > "$ROOT/writer-one.json"
jq --arg path "$WORKSPACE" '.role="reviewer" | .workspaceLease |=
  (.id="reviewer-one" | .mode="shared-read" | .path=$path | .owner="reviewer" | .mutableOutputs=[] | .activeProcess=null)' \
  "$FIXTURES/handoff.json" > "$ROOT/reviewer-one.json"
jq --arg path "$WORKSPACE" '.workspaceLease |=
  (.id="writer-two" | .mode="exclusive" | .path=$path | .mutableOutputs=["target"] | .activeProcess=null)' \
  "$FIXTURES/handoff.json" > "$ROOT/writer-two.json"

CONCURRENT_STORE="$ROOT/concurrent-leases.json"
set +e
"$LEASE" acquire "$CONCURRENT_STORE" "$ROOT/writer-one.json" >"$ROOT/concurrent-one.out" 2>&1 &
FIRST_PID=$!
"$LEASE" acquire "$CONCURRENT_STORE" "$ROOT/writer-two.json" >"$ROOT/concurrent-two.out" 2>&1 &
SECOND_PID=$!
wait "$FIRST_PID"; FIRST_STATUS=$?
wait "$SECOND_PID"; SECOND_STATUS=$?
set -e
if { [ "$FIRST_STATUS" -eq 0 ] && [ "$SECOND_STATUS" -eq 0 ]; } || \
   { [ "$FIRST_STATUS" -ne 0 ] && [ "$SECOND_STATUS" -ne 0 ]; }; then
  echo 'concurrent exclusive acquisition did not produce exactly one owner' >&2
  exit 1
fi
test "$(jq '.leases | length' "$CONCURRENT_STORE")" -eq 1

OUTPUT_STORE="$ROOT/output-leases.json"
WORKSPACE_ONE="$ROOT/worktree-one"
WORKSPACE_TWO="$ROOT/worktree-two"
SHARED_CACHE="$ROOT/shared-cache"
mkdir -p "$WORKSPACE_ONE" "$WORKSPACE_TWO" "$SHARED_CACHE"
jq --arg path "$WORKSPACE_ONE" --arg output "$SHARED_CACHE" '.workspaceLease |=
  (.id="output-one" | .mode="exclusive" | .path=$path | .mutableOutputs=[$output] | .activeProcess=null)' \
  "$FIXTURES/handoff.json" > "$ROOT/output-one.json"
jq --arg path "$WORKSPACE_TWO" --arg output "$SHARED_CACHE" '.workspaceLease |=
  (.id="output-two" | .mode="exclusive" | .path=$path | .mutableOutputs=[$output] | .activeProcess=null)' \
  "$FIXTURES/handoff.json" > "$ROOT/output-two.json"
"$LEASE" acquire "$OUTPUT_STORE" "$ROOT/output-one.json" >/dev/null
if "$LEASE" acquire "$OUTPUT_STORE" "$ROOT/output-two.json" >/dev/null 2>&1; then
  echo 'shared mutable output across separate worktrees unexpectedly passed' >&2
  exit 1
fi

"$LEASE" acquire "$STORE" "$ROOT/writer-one.json" >/dev/null
if "$LEASE" acquire "$STORE" "$ROOT/reviewer-one.json" >/dev/null 2>&1; then
  echo 'overlapping workspace lease unexpectedly passed' >&2
  exit 1
fi
jq --arg path "$WORKSPACE" '.workspaceLease |=
  (.id="writer-one" | .mode="exclusive" | .path=$path | .mutableOutputs=["target"] |
   .activeProcess={pid:4242,command:"./gradlew test",outputPath:($path+"/.build/test.log"),owner:"surface-builder"})' \
  "$FIXTURES/checkpoint.json" > "$ROOT/writer-checkpoint.json"
"$LEASE" checkpoint "$STORE" "$ROOT/writer-checkpoint.json" >/dev/null
if "$LEASE" release "$STORE" writer-one surface-builder >/dev/null 2>&1; then
  echo 'lease with an active process unexpectedly released' >&2
  exit 1
fi
jq '.workspaceLease.activeProcess=null' "$ROOT/writer-checkpoint.json" > "$ROOT/writer-idle.json"
"$LEASE" checkpoint "$STORE" "$ROOT/writer-idle.json" >/dev/null
"$LEASE" release "$STORE" writer-one surface-builder >/dev/null
"$LEASE" acquire "$STORE" "$ROOT/reviewer-one.json" >/dev/null
"$LEASE" release "$STORE" reviewer-one reviewer >/dev/null

LIVE_STORE="$ROOT/live-leases.json"
jq --arg path "$WORKSPACE" '.workspaceLease |=
  (.id="live-writer" | .mode="exclusive" | .path=$path | .mutableOutputs=["target"] | .activeProcess=null)' \
  "$FIXTURES/handoff.json" > "$ROOT/live-writer.json"
"$LEASE" acquire "$LIVE_STORE" "$ROOT/live-writer.json" >/dev/null
jq --arg path "$WORKSPACE" --argjson pid "$$" '.workspaceLease |=
  (.id="live-writer" | .mode="exclusive" | .path=$path | .mutableOutputs=["target"] |
   .activeProcess={pid:$pid,command:"test-contract.sh",outputPath:($path+"/.build/live.log"),owner:"surface-builder"})' \
  "$FIXTURES/checkpoint.json" > "$ROOT/live-checkpoint.json"
"$LEASE" checkpoint "$LIVE_STORE" "$ROOT/live-checkpoint.json" >/dev/null
jq '.workspaceLease.activeProcess=null' "$ROOT/live-checkpoint.json" > "$ROOT/live-clear.json"
if "$LEASE" checkpoint "$LIVE_STORE" "$ROOT/live-clear.json" >/dev/null 2>&1; then
  echo 'live process was cleared from its lease' >&2
  exit 1
fi

printf 'collaborator contract tests: PASS\n'
