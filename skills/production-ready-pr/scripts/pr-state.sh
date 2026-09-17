#!/usr/bin/env bash
# Print an actionable PR state and its evidence as JSON. Read-only.
set -euo pipefail

command -v gh >/dev/null || { echo "error: gh is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "error: jq is required" >&2; exit 2; }

target="${1:-}"
[ -z "$target" ] || [[ "$target" =~ ^[0-9]+$ ]] \
  || { echo "error: PR must be a number in the current repository" >&2; exit 2; }
allow_no_ci="${ALLOW_NO_CI:-0}"
allow_missing_copilot="${ALLOW_MISSING_COPILOT:-0}"
[[ "$allow_no_ci" =~ ^[01]$ ]] \
  || { echo "error: ALLOW_NO_CI must be 0 or 1" >&2; exit 2; }
[[ "$allow_missing_copilot" =~ ^[01]$ ]] \
  || { echo "error: ALLOW_MISSING_COPILOT must be 0 or 1" >&2; exit 2; }

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fields='number,headRefOid,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'
if [ -n "$target" ]; then
  pr="$(gh pr view "$target" --json "$fields")"
else
  pr="$(gh pr view --json "$fields")"
fi
number="$(jq -r .number <<<"$pr")"
owner="${repo%%/*}"
name="${repo#*/}"

query='query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100){
        pageInfo{hasNextPage}
        nodes{id isResolved comments(first:100){pageInfo{hasNextPage} nodes{author{login} body url createdAt}}}
      }
      reviews(last:100){
        pageInfo{hasPreviousPage}
        nodes{author{login} state submittedAt commit{oid} url body}
      }
      comments(last:100){
        pageInfo{hasPreviousPage}
        nodes{id author{login} body url createdAt}
      }
    }
  }
}'
review="$(gh api graphql -f query="$query" -f owner="$owner" -f name="$name" -F number="$number")"

snapshot="$(jq -n \
  --arg repo "$repo" \
  --argjson pr "$pr" \
  --argjson review "$review" \
  --argjson allowNoCi "$allow_no_ci" \
  --argjson allowMissingCopilot "$allow_missing_copilot" '
  def login: (. // "" | sub("\\[bot\\]$"; ""));
  def check_result:
    ([.conclusion, .state, .status] | map(select(. != null and . != "")) | .[0] // "UNKNOWN" | ascii_upcase);
  def copilot_summary_feedback:
    (.body // "")
    | test("changes recommended|needs a closer look|(suppressed comments|comments suppressed|previously missed( comments)?)[^\\n]*\\([1-9][0-9]*\\)"; "i");
  ($review.data.repository.pullRequest) as $remote
  | ($pr.statusCheckRollup // []) as $checks
  | [$checks[] | . + {result: check_result}] as $normalizedChecks
  | [$normalizedChecks[] | select(.result | test("^(SUCCESS|NEUTRAL|SKIPPED)$"))] as $passing
  | [$normalizedChecks[] | select(.result | test("^(PENDING|QUEUED|IN_PROGRESS|EXPECTED|REQUESTED|WAITING|UNKNOWN)$"))] as $pending
  | [$normalizedChecks[] | select(.result | test("^(SUCCESS|NEUTRAL|SKIPPED|PENDING|QUEUED|IN_PROGRESS|EXPECTED|REQUESTED|WAITING|UNKNOWN)$") | not)] as $failing
  | [$remote.reviewThreads.nodes[]? | select(.isResolved | not)] as $threads
  | [$remote.reviews.nodes[]? | select((.author.login | login) == "copilot-pull-request-reviewer")] as $copilotReviews
  | ($copilotReviews | sort_by(.submittedAt) | last) as $copilot
  | [$remote.comments.nodes[]?
      | select((.body // "" | test("acceptance blocker\\s*:"; "i"))
          and ((.body // "" | test("^\\s*(🤖\\s*)?✅\\s*resolved\\s*[—-]"; "i")) | not))] as $topLevelBlockers
  | [$copilotReviews[]
      | select(.commit.oid == $pr.headRefOid and copilot_summary_feedback)] as $copilotSummaryFeedbackReviews
  | (($copilotSummaryFeedbackReviews | length) > 0) as $copilotSummaryFeedback
  | (($remote.reviewThreads.pageInfo.hasNextPage // false)
      or ($remote.reviews.pageInfo.hasPreviousPage // false)
      or ($remote.comments.pageInfo.hasPreviousPage // false)
      or any($remote.reviewThreads.nodes[]?; .comments.pageInfo.hasNextPage // false)) as $truncated
  | (if $truncated then "BLOCKED_TRUNCATED"
     elif $pr.isDraft then "DRAFT"
     elif $pr.mergeable == "CONFLICTING" or $pr.mergeStateStatus == "DIRTY" then "MERGE_BLOCKED"
     elif ($pr.reviewDecision // "") == "CHANGES_REQUESTED" then "REVIEW_BLOCKED"
     elif ($failing | length) > 0 then "CI_FAILED"
     elif ($threads | length) > 0 or ($topLevelBlockers | length) > 0 or $copilotSummaryFeedback then "REVIEW_FEEDBACK"
     elif ($pending | length) > 0 then "CI_PENDING"
     elif ($checks | length) == 0 and $allowNoCi == 0 then "NO_CI"
     elif (($copilot == null
            or $copilot.commit.oid != $pr.headRefOid
            or (($copilot.state // "") | IN("COMMENTED", "APPROVED", "CHANGES_REQUESTED") | not))
           and $allowMissingCopilot == 0) then "COPILOT_PENDING"
     elif $pr.mergeable != "MERGEABLE" or $pr.mergeStateStatus == "UNKNOWN" then "MERGE_PENDING"
     elif $pr.mergeStateStatus == "BLOCKED" and ($pr.reviewDecision // "") == "REVIEW_REQUIRED" then "READY_CANDIDATE"
     elif ($pr.mergeStateStatus | IN("CLEAN", "HAS_HOOKS") | not) then "MERGE_BLOCKED"
     else "READY_CANDIDATE" end) as $state
  | {
      state: $state,
      repository: $repo,
      number: $pr.number,
      headSha: $pr.headRefOid,
      draft: $pr.isDraft,
      mergeable: $pr.mergeable,
      mergeStateStatus: $pr.mergeStateStatus,
      reviewDecision: ($pr.reviewDecision // ""),
      checks: {passing: $passing, pending: $pending, failing: $failing},
      copilot: $copilot,
      reviewAuthors: ([$remote.reviews.nodes[]?.author.login // empty] | unique),
      unresolvedThreads: [$threads[] | {
        id,
        author: (.comments.nodes[0].author.login // "unknown"),
        url: (.comments.nodes[0].url // ""),
        body: (.comments.nodes[0].body // "")
      }],
      topLevelBlockers: [$topLevelBlockers[] | {
        id,
        author: (.author.login // "unknown"),
        url: (.url // ""),
        body: (.body // "")
      }],
      copilotSummaryFeedback: $copilotSummaryFeedback,
      copilotSummaryFeedbackReviews: [$copilotSummaryFeedbackReviews[] | {
        submittedAt,
        url: (.url // ""),
        body: (.body // "")
      }],
      allowances: {noCi: $allowNoCi, missingCopilot: $allowMissingCopilot},
      truncated: $truncated
    }
')"

printf 'STATE=%s\n' "$(jq -r .state <<<"$snapshot")"
jq . <<<"$snapshot"
