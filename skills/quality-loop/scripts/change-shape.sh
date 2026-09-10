#!/usr/bin/env bash
# change-shape.sh — deterministic bounded-diff evidence for the review board.
# Usage: change-shape.sh --base <ref> --test-root <path>... [--skip-pattern <ere>] [--json <output.json>]
set -euo pipefail

BASE=""
JSON_OUT=""
TEST_ROOTS=()
SKIP_PATTERN='(@Disabled|@Ignore|assume[A-Za-z]*[(]|Assumptions[.]|@EnabledIf|@DisabledIf|pytest[.]mark[.]skip|unittest[.]skip|(^|[^A-Za-z])(describe|it|test)[.]skip)'
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:?--base needs a ref}"; shift 2;;
    --json) JSON_OUT="${2:?--json needs a path}"; shift 2;;
    --test-root) TEST_ROOTS+=("${2:?--test-root needs a path}"); shift 2;;
    --skip-pattern) SKIP_PATTERN="${2:?--skip-pattern needs an extended regular expression}"; shift 2;;
    *) echo "error: unknown argument $1" >&2; exit 2;;
  esac
done
[ -n "$BASE" ] && [ "${#TEST_ROOTS[@]}" -gt 0 ] \
  || { echo "usage: change-shape.sh --base <ref> --test-root <path>... [--skip-pattern <ere>] [--json <output.json>]" >&2; exit 2; }

MERGE_BASE="$(git merge-base "$BASE" HEAD)"
RANGE="$MERGE_BASE..HEAD"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/change-shape.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
STATUS="$ROOT/status.tsv"
TEST_DIFF="$ROOT/test.diff"
CHANGED_PATHS="$ROOT/changed-paths"
RENAMES="$ROOT/renames"
TEST_PATHS="$ROOT/test-paths"
MISMATCHES="$ROOT/path-package-mismatches"

git diff --name-status -M "$RANGE" -- > "$STATUS"
git diff --unified=0 "$RANGE" -- "${TEST_ROOTS[@]}" > "$TEST_DIFF"

awk -F '\t' '{print $NF}' "$STATUS" | sed '/^$/d' | sort -u > "$CHANGED_PATHS"
awk -F '\t' '$1 ~ /^R/ {print $2 " -> " $3}' "$STATUS" | sort -u > "$RENAMES"
git diff --name-only --diff-filter=ACMR "$RANGE" -- "${TEST_ROOTS[@]}" | sort -u > "$TEST_PATHS"

: > "$MISMATCHES"
while IFS= read -r path; do
  [ -f "$path" ] || continue
  case "$path" in
    src/test/kotlin/*) relative="${path#src/test/kotlin/}";;
    */src/test/kotlin/*) relative="${path#*/src/test/kotlin/}";;
    src/test/java/*) relative="${path#src/test/java/}";;
    */src/test/java/*) relative="${path#*/src/test/java/}";;
    *) continue;;
  esac
  directory="${relative%/*}"
  if [ "$directory" = "$relative" ]; then expected=""; else expected="${directory//\//.}"; fi
  declared="$(sed -nE 's/^[[:space:]]*package[[:space:]]+([^;[:space:]]+).*/\1/p' "$path" | head -1)"
  if [ "$declared" != "$expected" ]; then
    printf '%s\tdeclared=%s\texpected=%s\n' "$path" "$declared" "$expected" >> "$MISMATCHES"
  fi
done < "$TEST_PATHS"

CHANGED_FILES="$(wc -l < "$CHANGED_PATHS" | tr -d ' ')"
RENAMED_FILES="$(wc -l < "$RENAMES" | tr -d ' ')"
TEST_ADDED="$(git diff --name-only --diff-filter=A "$RANGE" -- "${TEST_ROOTS[@]}" | sed '/^$/d' | wc -l | tr -d ' ')"
TEST_DELETED="$(git diff --name-only --diff-filter=D "$RANGE" -- "${TEST_ROOTS[@]}" | sed '/^$/d' | wc -l | tr -d ' ')"
NON_MECHANICAL_TEST_LINES="$(awk '
  /^\+\+\+/ {next}
  /^\+/ {
    line=substr($0,2)
    if (line ~ /^[[:space:]]*$/) next
    if (line ~ /^[[:space:]]*(package|import)[[:space:]]/) next
    n++
  }
  END {print n+0}
' "$TEST_DIFF")"
SKIP_ADDITIONS="$(awk -v pattern="$SKIP_PATTERN" '
  /^\+\+\+/ {next}
  /^\+/ && $0 ~ pattern {n++}
  END {print n+0}
' "$TEST_DIFF")"
PATH_MISMATCHES="$(wc -l < "$MISMATCHES" | tr -d ' ')"

array_json() { jq -Rsc 'split("\n") | map(select(length > 0))' "$1"; }
REPORT="$(jq -n \
  --arg base "$BASE" --arg merge_base "$MERGE_BASE" --arg range "$RANGE" \
  --arg skip_pattern "$SKIP_PATTERN" --argjson test_roots "$(printf '%s\n' "${TEST_ROOTS[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')" \
  --argjson changed_files "$CHANGED_FILES" --argjson renamed_files "$RENAMED_FILES" \
  --argjson test_files_added "$TEST_ADDED" --argjson test_files_deleted "$TEST_DELETED" \
  --argjson non_mechanical_test_lines "$NON_MECHANICAL_TEST_LINES" \
  --argjson skip_control_additions "$SKIP_ADDITIONS" \
  --argjson path_package_mismatches "$PATH_MISMATCHES" \
  --argjson changed_paths "$(array_json "$CHANGED_PATHS")" \
  --argjson renames "$(array_json "$RENAMES")" \
  --argjson changed_test_paths "$(array_json "$TEST_PATHS")" \
  --argjson path_package_mismatch_paths "$(array_json "$MISMATCHES")" \
  '{kind:"quality-loop-change-shape",base:$base,merge_base:$merge_base,range:$range,
    test_roots:$test_roots,skip_pattern:$skip_pattern,path_package_check:"JVM package declarations only",
    changed_files:$changed_files,renamed_files:$renamed_files,
    test_files_added:$test_files_added,test_files_deleted:$test_files_deleted,
    non_mechanical_test_lines:$non_mechanical_test_lines,
    skip_control_additions:$skip_control_additions,
    path_package_mismatches:$path_package_mismatches,
    changed_paths:$changed_paths,renames:$renames,changed_test_paths:$changed_test_paths,
    path_package_mismatch_paths:$path_package_mismatch_paths}')"

if [ -n "$JSON_OUT" ]; then
  mkdir -p "$(dirname "$JSON_OUT")"
  printf '%s\n' "$REPORT" > "$JSON_OUT"
fi
printf '%s\n' "$REPORT"
