#!/usr/bin/env bash
# diff-budget.sh — computes a Chapter's net LOC against its recorded base, excluding the
# project's exclude patterns, and gates on the budget. The number comes from git, never
# from the model's estimate.
#
# Usage:
#   diff-budget.sh --base <branch> --budget <n> [--exclude <pathspec>]...
#
# Excludes are git pathspecs (e.g. 'src/main/jooq/**' '*.lock' 'src/test/**').
# There is deliberately no default limit. Exit 0 within the explicitly configured budget,
# 1 over budget, and 2 when the caller did not provide a valid policy.
set -euo pipefail

BASE="" BUDGET=""; EXCLUDES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --base)    BASE="${2:?}"; shift 2 ;;
    --budget)  BUDGET="${2:?}"; shift 2 ;;
    --exclude) EXCLUDES+=(":(exclude)${2:?}"); shift 2 ;;
    *) echo "error: unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -n "$BASE" ] && [ -n "$BUDGET" ] \
  || { echo "usage: diff-budget.sh --base <branch> --budget <n> [--exclude <pathspec>]..." >&2; exit 2; }
[[ "$BUDGET" =~ ^[0-9]+$ ]] \
  || { echo "error: --budget must be a non-negative integer" >&2; exit 2; }

RANGE="$(git merge-base "$BASE" HEAD)..HEAD"
STAT="$(git diff --numstat "$RANGE" -- . "${EXCLUDES[@]+"${EXCLUDES[@]}"}")"

ADD="$(echo "$STAT" | awk '$1!="-"{a+=$1} END{print a+0}')"
DEL="$(echo "$STAT" | awk '$2!="-"{d+=$2} END{print d+0}')"
NET=$((ADD - DEL))
CHANGED=$((ADD + DEL))

echo "diff-budget: base=$BASE range=$RANGE"
echo "  +$ADD -$DEL  net=$NET  changed=$CHANGED  budget=$BUDGET (net, excludes applied)"
echo "$STAT" | awk '{printf "    %s\n", $0}' | head -40

if [ "$NET" -gt "$BUDGET" ]; then
  echo "GATE diff-budget: OVER — net $NET > $BUDGET. Split the Chapter or record a revised human-approved policy." >&2
  exit 1
fi
echo "GATE diff-budget: PASS — net $NET <= $BUDGET"
