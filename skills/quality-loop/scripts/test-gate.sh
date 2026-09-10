#!/usr/bin/env bash
# test-gate.sh — durable RED/GREEN and baseline/comparison evidence.
#
# Usage:
#   QL_RUN_DIR=<run-dir> test-gate.sh red|green <chapter> -- <command...>
#   QL_RUN_DIR=<run-dir> test-gate.sh baseline|compare <chapter> <key> -- <command...>
#
# baseline captures the configured command even when the project is already red. compare runs a
# project-owned evaluator with QL_BASELINE_LOG and QL_BASELINE_MANIFEST exported. Every attempt
# retains a content-digested log and a JSON manifest containing the mechanical gate verdict.
set -uo pipefail

MODE="${1:?usage: test-gate.sh red|green|baseline|compare <chapter> [key] -- <cmd...>}"
CHAPTER="${2:?missing Chapter id}"
case "$MODE" in
  baseline|compare)
    KEY="${3:?$MODE needs a stable evidence key}"
    [[ "$KEY" =~ ^[A-Za-z0-9._-]+$ ]] \
      || { echo "error: evidence key may contain only letters, digits, dot, underscore, and hyphen" >&2; exit 2; }
    [ "${4:-}" = "--" ] || { echo "usage: test-gate.sh $MODE $CHAPTER <key> -- <cmd...>" >&2; exit 2; }
    shift 4
    ;;
  red|green)
    KEY="$MODE"
    [ "${3:-}" = "--" ] || { echo "usage: test-gate.sh $MODE $CHAPTER -- <cmd...>" >&2; exit 2; }
    shift 3
    ;;
  *) echo "error: mode must be red|green|baseline|compare" >&2; exit 2;;
esac
[ $# -ge 1 ] || { echo "error: no test command given" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE="${QL_RUN_DIR:?QL_RUN_DIR not set — export the active Run directory}/state.json"
[ -f "$STATE" ] || { echo "error: $STATE missing" >&2; exit 2; }
INVALID_RED="${QL_INVALID_RED_PATTERN:-Compilation failed|compileKotlin FAILED|compileTestKotlin FAILED|error: cannot find symbol|Unresolved reference|BUILD FAILED.*[Cc]ompil}"
CHAPTER_BASE="$(jq -r --arg id "$CHAPTER" '.chapters[$id].base // ""' "$STATE")"
[ -n "$CHAPTER_BASE" ] || { echo "error: Chapter $CHAPTER has no recorded base" >&2; exit 2; }
HEAD_COMMIT="$(git rev-parse HEAD)"
WORKTREE="$(git rev-parse --show-toplevel)"
if [ -z "$(git status --porcelain)" ]; then WORKTREE_CLEAN=true; else WORKTREE_CLEAN=false; fi
if [ "$MODE" = "baseline" ] && { [ "$HEAD_COMMIT" != "$CHAPTER_BASE" ] || [ "$WORKTREE_CLEAN" != true ]; }; then
  echo "error: baseline must run in a clean worktree at recorded Chapter base $CHAPTER_BASE" >&2
  exit 3
fi

BASELINE_KEY=""
if [ "$MODE" = "compare" ]; then
  BASELINE_KEY="baseline:$KEY"
  BASELINE_LOG_REL="$(jq -r --arg id "$CHAPTER" --arg key "$BASELINE_KEY" '.chapters[$id].evidence[$key].log // ""' "$STATE")"
  BASELINE_MANIFEST_REL="$(jq -r --arg id "$CHAPTER" --arg key "$BASELINE_KEY" '.chapters[$id].evidence[$key].manifest // ""' "$STATE")"
  BASELINE_DIGEST="$(jq -r --arg id "$CHAPTER" --arg key "$BASELINE_KEY" '.chapters[$id].evidence[$key].digest // ""' "$STATE")"
  BASELINE_RECORDED_BASE="$(jq -r --arg id "$CHAPTER" --arg key "$BASELINE_KEY" '.chapters[$id].evidence[$key].chapter_base // ""' "$STATE")"
  [ -n "$BASELINE_LOG_REL" ] && [ -n "$BASELINE_MANIFEST_REL" ] && \
    [ -f "$QL_RUN_DIR/$BASELINE_LOG_REL" ] && [ -f "$QL_RUN_DIR/$BASELINE_MANIFEST_REL" ] || {
      echo "error: comparison requires durable $BASELINE_KEY evidence" >&2
      exit 2
    }
  ACTUAL_BASELINE_DIGEST="$(shasum -a 256 "$QL_RUN_DIR/$BASELINE_LOG_REL" | awk '{print $1}')"
  [ "$BASELINE_DIGEST" = "$ACTUAL_BASELINE_DIGEST" ] && [ "$BASELINE_RECORDED_BASE" = "$CHAPTER_BASE" ] && \
    jq -e --arg digest "$BASELINE_DIGEST" --arg base "$CHAPTER_BASE" \
      '.digest==$digest and .chapter_base==$base and .verdict=="PASS"' \
      "$QL_RUN_DIR/$BASELINE_MANIFEST_REL" >/dev/null || {
        echo "error: $BASELINE_KEY evidence failed integrity or Chapter-base verification" >&2
        exit 3
      }
  export QL_BASELINE_LOG="$QL_RUN_DIR/$BASELINE_LOG_REL"
  export QL_BASELINE_MANIFEST="$QL_RUN_DIR/$BASELINE_MANIFEST_REL"
fi

ATTEMPT="$(date -u +%Y%m%dT%H%M%SZ)-$$"
SAFE_CHAPTER="$(printf '%s' "$CHAPTER" | sed 's/[^A-Za-z0-9._-]/_/g')"
EVIDENCE_DIR="$QL_RUN_DIR/evidence/$SAFE_CHAPTER"
mkdir -p "$EVIDENCE_DIR"
LOG_REL="evidence/$SAFE_CHAPTER/$MODE-$KEY-$ATTEMPT.log"
MANIFEST_REL="evidence/$SAFE_CHAPTER/$MODE-$KEY-$ATTEMPT.json"
LOG="$QL_RUN_DIR/$LOG_REL"
MANIFEST="$QL_RUN_DIR/$MANIFEST_REL"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# `--` terminates jq's own option parsing: a test command carrying flags jq recognises (-p, -D, -o,
# …) would otherwise be eaten as jq options, yielding an empty manifest and unrecorded evidence.
COMMAND_JSON="$(jq -cn --args '$ARGS.positional' -- "$@")"

"$@" >"$LOG" 2>&1
COMMAND_EXIT=$?
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DIGEST="$(shasum -a 256 "$LOG" | awk '{print $1}')"
jq -n \
  --arg kind test-gate --arg mode "$MODE" --arg attempt "$ATTEMPT" \
  --arg log "$LOG_REL" --arg manifest "$MANIFEST_REL" --arg digest "$DIGEST" \
  --arg started_at "$STARTED_AT" --arg finished_at "$FINISHED_AT" \
  --arg head "$HEAD_COMMIT" --arg chapter_base "$CHAPTER_BASE" --arg worktree "$WORKTREE" \
  --argjson worktree_clean "$WORKTREE_CLEAN" \
  --arg baseline_key "$BASELINE_KEY" --argjson command "$COMMAND_JSON" \
  --argjson command_exit "$COMMAND_EXIT" \
  '{kind:$kind,mode:$mode,attempt:$attempt,command:$command,command_exit:$command_exit,
    log:$log,manifest:$manifest,digest:$digest,started_at:$started_at,finished_at:$finished_at,
    head:$head,chapter_base:$chapter_base,worktree:$worktree,worktree_clean:$worktree_clean} +
   (if $baseline_key == "" then {} else {baseline_key:$baseline_key} end)' > "$MANIFEST"
[ -s "$MANIFEST" ] || { echo "error: gate manifest $MANIFEST_REL could not be written — the run produced $LOG_REL but NO durable evidence" >&2; exit 4; }

tail -n 40 "$LOG"

# Records the verdict, then announces it. Never announce a verdict that was not persisted: a gate
# whose evidence did not reach the Ledger has not passed, whatever the command exited.
record_gate() {
  local evidence_key="$1" gate_exit="$2" note="$3"
  local verdict="FAIL" tmp="$MANIFEST.tmp"
  if [ "$gate_exit" -eq 0 ]; then verdict="PASS"; fi
  jq --arg evidence_key "$evidence_key" --arg verdict "$verdict" --arg note "$note" \
    --argjson gate_exit "$gate_exit" \
    '. + {evidence_key:$evidence_key,gate_exit:$gate_exit,verdict:$verdict,note:$note}' \
    "$MANIFEST" > "$tmp" && mv "$tmp" "$MANIFEST" \
    || { echo "error: could not finalize gate manifest $MANIFEST_REL" >&2; exit 4; }
  "$SCRIPT_DIR/ledger.sh" record "$CHAPTER" "$evidence_key" "$gate_exit" "$note" "$MANIFEST" \
    || { echo "error: gate evidence was NOT recorded in the Ledger — treat this gate as unrun" >&2; exit 4; }
}

case "$MODE" in
  baseline)
    if [ "$COMMAND_EXIT" -eq 126 ] || [ "$COMMAND_EXIT" -eq 127 ]; then
      echo "GATE baseline: FAIL — command could not be executed (exit $COMMAND_EXIT)" >&2
      record_gate "baseline:$KEY" "$COMMAND_EXIT" "invalid baseline command: $*"
      exit "$COMMAND_EXIT"
    fi
    record_gate "baseline:$KEY" 0 "baseline captured: $*"
    echo "GATE baseline: PASS — captured command exit $COMMAND_EXIT"
    ;;
  red)
    if [ "$COMMAND_EXIT" -eq 0 ]; then
      echo "GATE red: FAIL — tests passed; there is no failing test to implement against" >&2
      record_gate red 1 "invalid: tests passed"
      exit 1
    fi
    if [ "$COMMAND_EXIT" -eq 126 ] || [ "$COMMAND_EXIT" -eq 127 ]; then
      echo "GATE red: FAIL — the test command could not be executed (exit $COMMAND_EXIT); a command that never ran is not a failing test" >&2
      record_gate red 1 "invalid: test command not executable (exit $COMMAND_EXIT)"
      exit 1
    fi
    if grep -qE "$INVALID_RED" "$LOG"; then
      echo "GATE red: FAIL — failure looks like a compile/build error, not an assertion failure" >&2
      record_gate red 1 "invalid: compile/build failure, not assertion"
      exit 1
    fi
    record_gate red 0 "valid RED: $*"
    echo "GATE red: PASS — failing test with a real assertion failure (exit $COMMAND_EXIT)"
    ;;
  green|compare)
    if [ "$COMMAND_EXIT" -ne 0 ]; then
      echo "GATE $MODE: FAIL — configured policy failed (exit $COMMAND_EXIT)" >&2
      if [ "$MODE" = "compare" ]; then
        record_gate "compare:$KEY" "$COMMAND_EXIT" "comparison against $BASELINE_KEY failed: $*"
      else
        record_gate green "$COMMAND_EXIT" "green failed: $*"
      fi
      exit "$COMMAND_EXIT"
    fi
    if [ "$MODE" = "compare" ]; then
      record_gate "compare:$KEY" 0 "comparison against $BASELINE_KEY: $*"
      echo "GATE compare: PASS — current evidence satisfies $BASELINE_KEY policy"
    else
      record_gate green 0 "GREEN: $*"
      echo "GATE green: PASS"
    fi
    ;;
esac
