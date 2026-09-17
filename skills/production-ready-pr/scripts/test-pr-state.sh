#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "repo view")
    printf '%s\n' '{"nameWithOwner":"acme/widgets"}'
    ;;
  "pr view")
    check='{"name":"test","status":"COMPLETED","conclusion":"SUCCESS"}'
    merge_state=CLEAN
    review_decision=''
    [ "${CASE:-ready}" != pending ] || check='{"name":"test","status":"IN_PROGRESS","conclusion":""}'
    [ "${CASE:-ready}" != failed ] || check='{"name":"test","status":"COMPLETED","conclusion":"FAILURE"}'
    [ "${CASE:-ready}" != no_ci ] || check=''
    [ "${CASE:-ready}" != mergeblocked ] || merge_state=BEHIND
    if [ "${CASE:-ready}" = humanapproval ]; then merge_state=BLOCKED; review_decision=REVIEW_REQUIRED; fi
    printf '{"number":42,"headRefOid":"head","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"%s","reviewDecision":"%s","statusCheckRollup":[%s]}\n' "$merge_state" "$review_decision" "$check"
    ;;
  "api graphql")
    [ "${CASE:-ready}" != api_error ] || exit 1
    commit=head
    threads='[]'
    comments='[]'
    review_body=''
    previous=false
    [ "${CASE:-ready}" != stale ] || commit=old
    [ "${CASE:-ready}" != truncated ] || previous=true
    [ "${CASE:-ready}" != feedback ] || threads='[{"id":"thread-1","isResolved":false,"comments":{"pageInfo":{"hasNextPage":false},"nodes":[{"author":{"login":"reviewer"},"body":"Fix this","url":"https://example.test/comment","createdAt":"2026-01-01T00:00:00Z"}]}}]'
    [ "${CASE:-ready}" != suppressed ] || review_body='### Needs a closer look\n\n### Suppressed comments (2)\n\nFix both.'
    [ "${CASE:-ready}" != suppressed_alt ] || review_body='### Comments suppressed due to low confidence (2)'
    [ "${CASE:-ready}" != previously_missed ] || review_body='### Previously missed comments in this file (1)'
    [ "${CASE:-ready}" != top_level_blocker ] || comments='[{"id":"comment-1","author":{"login":"owner"},"body":"Acceptance blocker: prove the live schema works","url":"https://example.test/blocker","createdAt":"2026-01-01T00:00:00Z"}]'
    [ "${CASE:-ready}" != top_level_resolved ] || comments='[{"id":"comment-1","author":{"login":"owner"},"body":"🤖 ✅ Resolved — Acceptance blocker: proved","url":"https://example.test/blocker","createdAt":"2026-01-01T00:00:00Z"}]'
    [ "${CASE:-ready}" != resolved_embedded ] || comments='[{"id":"comment-1","author":{"login":"owner"},"body":"Acceptance blocker: new issue. Earlier ✅ Resolved — old issue.","url":"https://example.test/blocker","createdAt":"2026-01-01T00:00:00Z"}]'
    reviews="$(jq -cn --arg commit "$commit" --arg body "$review_body" '[{author:{login:"copilot-pull-request-reviewer"},state:"COMMENTED",submittedAt:"2026-01-01T00:00:00Z",commit:{oid:$commit},url:"https://example.test/review",body:$body}]')"
    [ "${CASE:-ready}" != older_exact_head_feedback ] || reviews='[{"author":{"login":"copilot-pull-request-reviewer"},"state":"COMMENTED","submittedAt":"2026-01-01T00:00:00Z","commit":{"oid":"head"},"url":"https://example.test/review/old","body":"### Needs a closer look"},{"author":{"login":"copilot-pull-request-reviewer"},"state":"COMMENTED","submittedAt":"2026-01-02T00:00:00Z","commit":{"oid":"head"},"url":"https://example.test/review/new","body":""}]'
    jq -cn \
      --argjson threads "$threads" \
      --argjson comments "$comments" \
      --argjson reviews "$reviews" \
      --argjson previous "$previous" \
      '{data:{repository:{pullRequest:{reviewThreads:{pageInfo:{hasNextPage:false},nodes:$threads},reviews:{pageInfo:{hasPreviousPage:$previous},nodes:$reviews},comments:{pageInfo:{hasPreviousPage:false},nodes:$comments}}}}}'
    ;;
  *)
    echo "unexpected gh call: $*" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$TMP/gh"

check() {
  local fixture="$1" expected="$2" output actual
  output="$(CASE="$fixture" PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" 42)"
  actual="${output%%$'\n'*}"
  [ "$actual" = "STATE=$expected" ] || {
    echo "$fixture: expected STATE=$expected, got $actual" >&2
    exit 1
  }
}

check ready READY_CANDIDATE
check pending CI_PENDING
check failed CI_FAILED
check stale COPILOT_PENDING
check feedback REVIEW_FEEDBACK
check suppressed REVIEW_FEEDBACK
check suppressed_alt REVIEW_FEEDBACK
check previously_missed REVIEW_FEEDBACK
check older_exact_head_feedback REVIEW_FEEDBACK
check top_level_blocker REVIEW_FEEDBACK
check top_level_resolved READY_CANDIDATE
check resolved_embedded REVIEW_FEEDBACK
check no_ci NO_CI
check truncated BLOCKED_TRUNCATED
check mergeblocked MERGE_BLOCKED
check humanapproval READY_CANDIDATE

CASE=ready PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" >/dev/null
output="$(CASE=no_ci ALLOW_NO_CI=1 PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" 42)"
[ "${output%%$'\n'*}" = "STATE=READY_CANDIDATE" ]
if CASE=api_error PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" 42 >/dev/null 2>&1; then
  echo "api_error: expected failure" >&2
  exit 1
fi
if PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" https://example.test/pr/42 >/dev/null 2>&1; then
  echo "URL target: expected rejection" >&2
  exit 1
fi
if ALLOW_NO_CI=yes PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" 42 >/dev/null 2>&1; then
  echo "ALLOW_NO_CI: expected rejection" >&2
  exit 1
fi

output="$(CASE=top_level_blocker PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" 42)"
jq -e '.topLevelBlockers | length == 1' <<<"${output#*$'\n'}" >/dev/null
output="$(CASE=older_exact_head_feedback PATH="$TMP:$PATH" "$SCRIPT_DIR/pr-state.sh" 42)"
jq -e '.copilotSummaryFeedback and (.copilotSummaryFeedbackReviews | length == 1)' \
  <<<"${output#*$'\n'}" >/dev/null

echo "pr-state tests: PASS"
