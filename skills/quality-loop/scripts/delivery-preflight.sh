#!/usr/bin/env bash
# delivery-preflight.sh — deterministic gate before Chapter integration or the final PR.
#
# Usage:
#   delivery-preflight.sh chapter <id> --default-branch <name> --target <integration>
#     [--critical-evidence <key>] [budget args]
#   delivery-preflight.sh final --default-branch <name> --target <target>
set -euo pipefail

KIND="${1:?usage: delivery-preflight.sh chapter <id>|final ...}"; shift
CHAPTER=""
if [ "$KIND" = "chapter" ]; then CHAPTER="${1:?chapter needs <id>}"; shift; fi
[ "$KIND" = "chapter" ] || [ "$KIND" = "final" ] \
  || { echo "error: kind must be chapter|final" >&2; exit 2; }

DEFAULT=""; TARGET=""; CRITICAL_EVIDENCE="mutation"; BUDGET_ARGS=()
BUDGET_CONFIGURED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --default-branch) DEFAULT="${2:?}"; shift 2;;
    --target) TARGET="${2:?}"; shift 2;;
    --critical-evidence) CRITICAL_EVIDENCE="${2:?}"; shift 2;;
    --budget) BUDGET_CONFIGURED=1; BUDGET_ARGS+=("$1" "${2:?}"); shift 2;;
    --exclude) BUDGET_ARGS+=("$1" "${2:?}"); shift 2;;
    *) echo "error: unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$DEFAULT" ] && [ -n "$TARGET" ] \
  || { echo "error: --default-branch and --target are required" >&2; exit 2; }
[ "$BUDGET_CONFIGURED" -eq 1 ] || [ "${#BUDGET_ARGS[@]}" -eq 0 ] \
  || { echo "error: --exclude requires an explicit --budget" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FAIL=0
check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "  PASS $name"; else echo "  FAIL $name" >&2; FAIL=1; fi
}

BRANCH="$(git branch --show-current)"
echo "delivery-preflight: $KIND${CHAPTER:+ $CHAPTER}"
check "clean tree" test -z "$(git status --porcelain)"

if [ "$KIND" = "chapter" ]; then
  [ "$BRANCH" != "$DEFAULT" ] && [ "$BRANCH" != "$TARGET" ] \
    && echo "  PASS Chapter branch ($BRANCH)" \
    || { echo "  FAIL Chapter branch — use a Chapter branch, not $DEFAULT/$TARGET" >&2; FAIL=1; }
  RECORDED_BRANCH="$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].branch")"
  check "recorded Chapter branch" test "$BRANCH" = "$RECORDED_BRANCH"
  check "status is reviewed" test "$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].status")" = "reviewed"
  check "review round recorded" test "$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].review_rounds")" -gt 0
  check "RED evidence recorded" test "$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].evidence.red.exit")" = "0"
  check "GREEN evidence recorded" test "$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].evidence.green.exit")" = "0"
  CRITICALITY="$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].criticality")"
  if [ "$CRITICALITY" = "critical" ]; then
    check "$CRITICAL_EVIDENCE evidence recorded" \
      test "$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].evidence[\"$CRITICAL_EVIDENCE\"].exit")" = "0"
  fi
  BASE="$("$SCRIPT_DIR/ledger.sh" get ".chapters[\"$CHAPTER\"].base")"
  check "recorded Chapter base exists" git rev-parse --verify "$BASE^{commit}"
  echo "  --- change size ---"
  if [ "$BUDGET_CONFIGURED" -eq 0 ]; then
    echo "  SKIP numeric diff limit — reviewer judgment is the configured policy"
  elif "$SCRIPT_DIR/diff-budget.sh" --base "$BASE" "${BUDGET_ARGS[@]+"${BUDGET_ARGS[@]}"}"; then
    echo "  PASS configured diff budget"
  else
    echo "  FAIL configured diff budget" >&2; FAIL=1
  fi
else
  INTEGRATION="$("$SCRIPT_DIR/ledger.sh" get '.integration_branch')"
  [ "$BRANCH" = "$INTEGRATION" ] \
    && echo "  PASS integration branch ($BRANCH)" \
    || { echo "  FAIL integration branch — expected $INTEGRATION, got $BRANCH" >&2; FAIL=1; }
  check "Design approved" test "$("$SCRIPT_DIR/ledger.sh" get '.design.approved')" = "true"
  check "System Story accepted" test "$("$SCRIPT_DIR/ledger.sh" get '.story.accepted')" = "true"
  check "all Chapters integrated" test "$("$SCRIPT_DIR/ledger.sh" get '([.chapters[].status]|all(.=="integrated"))')" = "true"
  check "no open deviations" test "$("$SCRIPT_DIR/ledger.sh" get '([.deviations[]?|select(.status=="open")]|length)==0')" = "true"
  check "no open decisions" test "$("$SCRIPT_DIR/ledger.sh" get '([.decisions[]?|select(.status=="open")]|length)==0')" = "true"
  check "no unratified provisional ADRs" test "$("$SCRIPT_DIR/ledger.sh" get '([.adrs[]?|select(.status=="provisional")]|length)==0')" = "true"
  check "final PR not already opened" test "$("$SCRIPT_DIR/ledger.sh" get '.final_pr.status')" = "none"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "GATE delivery-preflight: FAIL — fix the checks above" >&2
  exit 1
fi
echo "GATE delivery-preflight: PASS"
