#!/usr/bin/env bash
# End-to-end contract test for the Quality Loop Ledger, gates, and delivery preflight.
# Covers the state path, both operating modes, the decision envelope, the Decision Inbox,
# provisional ADRs, the review-round cap, selective blocking, and the failure branches of
# test-gate.sh, diff-budget.sh, and delivery-preflight.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/quality-loop-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_fail() {
  if "$@" >/dev/null 2>&1; then fail "command unexpectedly passed: $*"; fi
}
assert_eq() {
  local expected="$1" actual="$2" label="$3"
  [ "$expected" = "$actual" ] || fail "$label: expected '$expected', got '$actual'"
}
next_value() {
  "$SCRIPT_DIR/next.sh" "$QL_RUN_DIR" | sed -n "s/^$1=//p"
}

cd "$ROOT"
git init -q -b main
git config user.email quality-loop-test@example.invalid
git config user.name quality-loop-test
printf '.scratch/\n' > .gitignore
printf 'base\n' > system.txt
mkdir -p src/test/kotlin/demo
printf 'package demo\nclass OldTest {\n  fun one() = 1\n  fun two() = 2\n  fun three() = 3\n  fun four() = 4\n  fun five() = 5\n}\n' > src/test/kotlin/demo/OldTest.kt
mkdir -p modules/mail/src/test/kotlin/demo
printf 'package demo\nclass ModuleOldTest {\n  fun one() = 1\n  fun two() = 2\n  fun three() = 3\n  fun four() = 4\n  fun five() = 5\n}\n' > modules/mail/src/test/kotlin/demo/ModuleOldTest.kt
git add .gitignore system.txt src/test/kotlin/demo/OldTest.kt modules/mail/src/test/kotlin/demo/ModuleOldTest.kt
git commit -q -m base

export QL_RUN_DIR="$ROOT/.scratch/quality-loop/demo"
export QL_SESSION_ID=session-base
"$SCRIPT_DIR/ledger.sh" init demo
assert_eq issue "$("$SCRIPT_DIR/ledger.sh" get .phase)" "initial phase"
assert_eq supervised "$("$SCRIPT_DIR/ledger.sh" mode get)" "initial mode"
assert_eq design "$(next_value ACTION)" "initial dispatch"
assert_eq bind-required "$(next_value SESSION_BOUNDARY)" "initial session binding"
expect_fail "$SCRIPT_DIR/ledger.sh" add-chapter 01 standard contained

"$SCRIPT_DIR/ledger.sh" session bind design driver
"$SCRIPT_DIR/ledger.sh" issue 399 https://example.invalid/issues/399
export QL_SESSION_ID=session-design
"$SCRIPT_DIR/ledger.sh" session bind design driver
expect_fail env QL_SESSION_ID=session-base "$SCRIPT_DIR/ledger.sh" session bind design driver
assert_eq session-design "$(next_value SESSION_ID)" "dispatch session id"
assert_eq bind-required "$(env QL_SESSION_ID=unbound "$SCRIPT_DIR/next.sh" "$QL_RUN_DIR" | sed -n 's/^SESSION_BOUNDARY=//p')" \
  "unbound runtime session dispatch"
expect_fail env QL_SESSION_ID=unbound "$SCRIPT_DIR/ledger.sh" integration-branch forbidden

"$SCRIPT_DIR/ledger.sh" integration-branch run/demo
git switch -q -c run/demo
"$SCRIPT_DIR/ledger.sh" design surface http://localhost:4747 design-demo
"$SCRIPT_DIR/ledger.sh" add-chapter 01 standard contained
"$SCRIPT_DIR/ledger.sh" chapter 01 links mail.routing,mail.trace ingestion.runner
"$SCRIPT_DIR/ledger.sh" add-chapter 02 critical high 01
"$SCRIPT_DIR/ledger.sh" chapter 02 links mail.routing ingestion.agent
"$SCRIPT_DIR/ledger.sh" chapter 01 plan standard contained
expect_fail "$SCRIPT_DIR/ledger.sh" add-chapter 03 bogus low
expect_fail "$SCRIPT_DIR/ledger.sh" add-chapter 03 low bogus
"$SCRIPT_DIR/ledger.sh" timeline proposed 02,01
expect_fail "$SCRIPT_DIR/ledger.sh" design approve invalid-order
"$SCRIPT_DIR/ledger.sh" timeline proposed 01,02
expect_fail "$SCRIPT_DIR/ledger.sh" envelope approve elevated 2 "premature — Design not approved"
"$SCRIPT_DIR/ledger.sh" design approve design-r1
assert_eq chapter "$(next_value ACTION)" "approved Design dispatch"
assert_eq 01 "$(next_value CHAPTER)" "first Chapter dispatch"
assert_eq fresh-required "$(next_value SESSION_BOUNDARY)" "Design-to-Chapter boundary"
assert_eq "/quality-loop $QL_RUN_DIR" "$(next_value RESUME)" "base Quality Loop resume"
export QL_SESSION_ID=session-chapter-01
"$SCRIPT_DIR/ledger.sh" session bind chapter:01 driver
assert_eq continue "$(next_value SESSION_BOUNDARY)" "Chapter session binding"
expect_fail "$SCRIPT_DIR/ledger.sh" add-chapter 03 low low 02
test -n "$("$SCRIPT_DIR/ledger.sh" get .design.plan_digest)" || fail "approved plan digest is empty"
"$SCRIPT_DIR/ledger.sh" collaborator bind quality-advisor agent-123 design-r1
"$SCRIPT_DIR/ledger.sh" collaborator checkpoint quality-advisor chapter-01-start
expect_fail "$SCRIPT_DIR/ledger.sh" collaborator checkpoint unbound-role anywhere
expect_fail "$SCRIPT_DIR/ledger.sh" record 99 red 0 "unknown chapter"
expect_fail "$SCRIPT_DIR/ledger.sh" record 02 probe 0 "wrong session scope"
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 resume design-r1
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 02 status red

# Modes, decision envelope, and provisional ADRs.
expect_fail "$SCRIPT_DIR/ledger.sh" mode set afk tschuehly
"$SCRIPT_DIR/ledger.sh" envelope approve elevated 2 \
  "invariants: routing unchanged; scope: mail module; stop: any persistence change"
"$SCRIPT_DIR/ledger.sh" mode set afk tschuehly
assert_eq afk "$("$SCRIPT_DIR/ledger.sh" mode get)" "AFK mode entered"
"$SCRIPT_DIR/ledger.sh" adr add adr-01 contained 01 "conservative retry policy, reversible"
expect_fail "$SCRIPT_DIR/ledger.sh" adr add adr-too-big high 01 "exceeds envelope ceiling"
"$SCRIPT_DIR/ledger.sh" adr add adr-02 elevated 02 "provisional queue naming"
expect_fail "$SCRIPT_DIR/ledger.sh" adr add adr-03 low 01 "envelope ADR budget exhausted"

# Decision Inbox: high impact is a deviation, open decisions block only affected Chapters.
expect_fail "$SCRIPT_DIR/ledger.sh" decision add bad-material high irreversible 01 "must be a deviation"
expect_fail "$SCRIPT_DIR/ledger.sh" decision add ghost contained reversible 99 "unknown chapter"
"$SCRIPT_DIR/ledger.sh" decision add naming contained reversible 01 "tension: name X vs Y; recommend X"
assert_eq decision "$(next_value ACTION)" "blocked frontier dispatch"
git switch -q -c chapter/01
"$SCRIPT_DIR/ledger.sh" chapter 01 branch chapter/01
"$SCRIPT_DIR/ledger.sh" chapter 01 base "$(git merge-base run/demo HEAD)"
"$SCRIPT_DIR/test-gate.sh" baseline 01 full-suite -- bash -c 'echo BASE_FAIL; exit 7' >/dev/null
assert_eq 7 "$("$SCRIPT_DIR/ledger.sh" get '.chapters["01"].evidence["baseline:full-suite"].command_exit')" "baseline command exit"
assert_eq PASS "$("$SCRIPT_DIR/ledger.sh" get '.chapters["01"].evidence["baseline:full-suite"].verdict')" "baseline verdict"
BASELINE_LOG="$("$SCRIPT_DIR/ledger.sh" get '.chapters["01"].evidence["baseline:full-suite"].log')"
test -f "$QL_RUN_DIR/$BASELINE_LOG" || fail "baseline log was not persisted"
grep -q BASE_FAIL "$QL_RUN_DIR/$BASELINE_LOG" || fail "baseline log lost command output"
printf 'chapter one\n' >> system.txt
git add system.txt
git commit -q -m chapter-01
expect_fail "$SCRIPT_DIR/test-gate.sh" baseline 01 post-change -- bash -c 'exit 0'
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 status red
"$SCRIPT_DIR/ledger.sh" decision answer naming "X, per recommendation"
"$SCRIPT_DIR/ledger.sh" chapter 01 status red
assert_eq chapter "$(next_value ACTION)" "active Chapter dispatch"
assert_eq 01 "$(next_value CHAPTER)" "active Chapter id"

# test-gate.sh: invalid REDs are refused and recorded; failed GREEN blocks the transition.
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 status green
expect_fail "$SCRIPT_DIR/test-gate.sh" compare 01 missing -- bash -c 'exit 0'
expect_fail "$SCRIPT_DIR/test-gate.sh" red 01 -- bash -c 'exit 0'
expect_fail "$SCRIPT_DIR/test-gate.sh" red 01 -- bash -c 'echo "Compilation failed: unresolved"; exit 1'
# A command that never ran is not a failing test: 126/127 must not read as a valid RED.
expect_fail "$SCRIPT_DIR/test-gate.sh" red 01 -- "$QL_RUN_DIR/no-such-command" test
"$SCRIPT_DIR/test-gate.sh" red 01 -- bash -c 'echo "AssertionError: expected routed"; exit 1' >/dev/null

# The manifest must record the command VERBATIM. Options the manifest writer's own tooling
# recognises (-c, -n, -p, -D, …) must reach the record intact: a gate that silently drops an
# argument attests to a command nobody ran.
"$SCRIPT_DIR/test-gate.sh" red 01 -- bash -c 'echo "AssertionError: flag fidelity"; exit 1' >/dev/null
RED_MANIFEST="$QL_RUN_DIR/$(jq -r '.chapters["01"].evidence.red.manifest' "$QL_RUN_DIR/state.json")"
assert_eq '["bash","-c","echo \"AssertionError: flag fidelity\"; exit 1"]' \
  "$(jq -c '.command' "$RED_MANIFEST")" "RED manifest records the command verbatim"
expect_fail "$SCRIPT_DIR/test-gate.sh" green 01 -- bash -c 'exit 1'
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 status green
cp "$QL_RUN_DIR/$BASELINE_LOG" "$QL_RUN_DIR/baseline-backup.log"
printf 'TAMPER\n' >> "$QL_RUN_DIR/$BASELINE_LOG"
expect_fail "$SCRIPT_DIR/test-gate.sh" compare 01 full-suite -- bash -c 'exit 0'
cp "$QL_RUN_DIR/baseline-backup.log" "$QL_RUN_DIR/$BASELINE_LOG"
"$SCRIPT_DIR/test-gate.sh" compare 01 full-suite -- bash -c 'test -f "$QL_BASELINE_LOG" && grep -q BASE_FAIL "$QL_BASELINE_LOG"' >/dev/null
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 status green
"$SCRIPT_DIR/test-gate.sh" green 01 -- bash -c 'exit 0' >/dev/null
printf 'TAMPER AFTER COMPARE\n' >> "$QL_RUN_DIR/$BASELINE_LOG"
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 status green
cp "$QL_RUN_DIR/baseline-backup.log" "$QL_RUN_DIR/$BASELINE_LOG"
test "$("$SCRIPT_DIR/ledger.sh" get '.chapters["01"].evidence_attempts|length')" -ge 6 \
  || fail "gate attempts were not retained"
"$SCRIPT_DIR/ledger.sh" chapter 01 status green
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 01 status reviewed
"$SCRIPT_DIR/ledger.sh" chapter 01 review-round
"$SCRIPT_DIR/ledger.sh" chapter 01 status reviewed
"$SCRIPT_DIR/delivery-preflight.sh" chapter 01 --default-branch main --target run/demo
"$SCRIPT_DIR/delivery-preflight.sh" chapter 01 --default-branch main --target run/demo --budget 20
git switch -q run/demo
git merge -q --ff-only chapter/01
"$SCRIPT_DIR/ledger.sh" chapter 01 status integrated
assert_eq 02 "$(next_value CHAPTER)" "dependency-ready Chapter dispatch"
assert_eq fresh-required "$(next_value SESSION_BOUNDARY)" "Chapter-to-Chapter boundary"
export QL_SESSION_ID=session-chapter-02
"$SCRIPT_DIR/ledger.sh" session bind chapter:02 driver

# diff-budget.sh: over-budget fails; excludes bring it back under.
git switch -q -c budget-probe
seq 1 30 > big.txt
git add big.txt
git commit -q -m budget-probe
expect_fail "$SCRIPT_DIR/diff-budget.sh" --base run/demo
expect_fail "$SCRIPT_DIR/diff-budget.sh" --base run/demo --budget 20
"$SCRIPT_DIR/diff-budget.sh" --base run/demo --budget 20 --exclude 'big.txt' >/dev/null
git switch -q run/demo
git branch -q -D budget-probe

# change-shape.sh: deterministic review evidence for mechanical test moves.
git switch -q -c shape-probe
git mv src/test/kotlin/demo/OldTest.kt src/test/kotlin/demo/NewTest.kt
printf '@Disabled\n' >> src/test/kotlin/demo/NewTest.kt
git mv modules/mail/src/test/kotlin/demo/ModuleOldTest.kt modules/mail/src/test/kotlin/demo/ModuleNewTest.kt
printf '@Ignore\n' >> modules/mail/src/test/kotlin/demo/ModuleNewTest.kt
git add src/test/kotlin/demo/NewTest.kt modules/mail/src/test/kotlin/demo/ModuleNewTest.kt
git commit -q -m shape-probe
SHAPE_JSON="$QL_RUN_DIR/shape.json"
"$SCRIPT_DIR/change-shape.sh" --base run/demo \
  --test-root src/test --test-root modules/mail/src/test --json "$SHAPE_JSON" >/dev/null
assert_eq 2 "$(jq -r .renamed_files "$SHAPE_JSON")" "change-shape rename count"
assert_eq 2 "$(jq -r .skip_control_additions "$SHAPE_JSON")" "change-shape skip delta"
assert_eq 2 "$(jq -r .non_mechanical_test_lines "$SHAPE_JSON")" "change-shape semantic test lines"
assert_eq 0 "$(jq -r .path_package_mismatches "$SHAPE_JSON")" "change-shape package paths"
git switch -q run/demo
git branch -q -D shape-probe

git switch -q -c chapter/02
printf 'chapter two\n' >> system.txt
git add system.txt
git commit -q -m chapter-02
"$SCRIPT_DIR/ledger.sh" chapter 02 branch chapter/02
"$SCRIPT_DIR/ledger.sh" chapter 02 base "$(git merge-base run/demo HEAD)"
"$SCRIPT_DIR/ledger.sh" chapter 02 status red
expect_fail "$SCRIPT_DIR/ledger.sh" record 02 red 0 "artifactless RED"
"$SCRIPT_DIR/test-gate.sh" red 02 -- bash -c 'echo "AssertionError: expected chapter two"; exit 1' >/dev/null
"$SCRIPT_DIR/test-gate.sh" green 02 -- bash -c 'exit 0' >/dev/null
"$SCRIPT_DIR/ledger.sh" chapter 02 status green

# Material deviations (high and critical) freeze the Run; a provisional ADR can be revised
# through the deviation; the stale envelope drops AFK mode at the new Design approval.
"$SCRIPT_DIR/ledger.sh" deviation add routing-order high "routing invariant changed"
"$SCRIPT_DIR/ledger.sh" deviation add data-loss critical "persisted queue could drop mail"
"$SCRIPT_DIR/ledger.sh" chapter 02 status blocked
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 02 resume design-r2
"$SCRIPT_DIR/ledger.sh" adr revise adr-02 routing-order
expect_fail "$SCRIPT_DIR/ledger.sh" design reopen routing-order
export QL_SESSION_ID=session-redesign
"$SCRIPT_DIR/ledger.sh" session bind design driver
"$SCRIPT_DIR/ledger.sh" design reopen routing-order
expect_fail "$SCRIPT_DIR/ledger.sh" deviation resolve routing-order design-r2
"$SCRIPT_DIR/ledger.sh" design approve design-r2
assert_eq supervised "$("$SCRIPT_DIR/ledger.sh" mode get)" "AFK dropped on new Design revision"
expect_fail "$SCRIPT_DIR/ledger.sh" mode set afk tschuehly
"$SCRIPT_DIR/ledger.sh" deviation resolve routing-order design-r2
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 02 resume design-r2
"$SCRIPT_DIR/ledger.sh" deviation resolve data-loss design-r2
export QL_SESSION_ID=session-chapter-02-resume
"$SCRIPT_DIR/ledger.sh" session bind chapter:02 driver
"$SCRIPT_DIR/ledger.sh" chapter 02 resume design-r2
"$SCRIPT_DIR/ledger.sh" chapter 02 impact critical "Correctness reviewer found cross-account data reach"
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 02 impact high "attempted downgrade"

# Review-round cap: the fourth round is refused.
"$SCRIPT_DIR/ledger.sh" chapter 02 review-round
"$SCRIPT_DIR/ledger.sh" chapter 02 review-round
"$SCRIPT_DIR/ledger.sh" chapter 02 review-round
expect_fail "$SCRIPT_DIR/ledger.sh" chapter 02 review-round
"$SCRIPT_DIR/ledger.sh" chapter 02 status reviewed
git switch -q chapter/01
expect_fail "$SCRIPT_DIR/delivery-preflight.sh" chapter 02 --default-branch main --target run/demo --budget 20
git switch -q chapter/02
expect_fail "$SCRIPT_DIR/delivery-preflight.sh" chapter 02 --default-branch main --target run/demo --budget 20
"$SCRIPT_DIR/ledger.sh" record 02 critical-verification 0 "configured compensating gate passed"
"$SCRIPT_DIR/delivery-preflight.sh" chapter 02 --default-branch main --target run/demo \
  --critical-evidence critical-verification --budget 20
expect_fail "$SCRIPT_DIR/delivery-preflight.sh" chapter 02 --default-branch main --target run/demo --budget 20
"$SCRIPT_DIR/ledger.sh" record 02 mutation 0 "all scoped mutants killed"
"$SCRIPT_DIR/delivery-preflight.sh" chapter 02 --default-branch main --target run/demo --budget 20
"$SCRIPT_DIR/ledger.sh" chapter 02 pr 42
"$SCRIPT_DIR/ledger.sh" chapter 02 status pr-open
git switch -q run/demo
git merge -q --ff-only chapter/02
"$SCRIPT_DIR/ledger.sh" chapter 02 status integrated
assert_eq ratification "$(next_value ACTION)" "provisional ADR dispatch"

# Story gates: provisional ADRs and open decisions must be cleared first.
expect_fail "$SCRIPT_DIR/delivery-preflight.sh" final --default-branch main --target main
expect_fail "$SCRIPT_DIR/ledger.sh" story begin
"$SCRIPT_DIR/ledger.sh" adr ratify adr-01
"$SCRIPT_DIR/ledger.sh" decision add story-check contained reversible 01 "held for the human's return"
"$SCRIPT_DIR/ledger.sh" notify decision-batch "1 decision awaiting the human"
assert_eq decision "$(next_value ACTION)" "Story-blocking decision dispatch"
expect_fail "$SCRIPT_DIR/ledger.sh" story begin
"$SCRIPT_DIR/ledger.sh" decision answer story-check "resolved on return"
assert_eq story "$(next_value ACTION)" "Story-ready dispatch"
assert_eq fresh-required "$(next_value SESSION_BOUNDARY)" "Chapter-to-Story boundary"
export QL_SESSION_ID=session-story
"$SCRIPT_DIR/ledger.sh" session bind story driver
"$SCRIPT_DIR/ledger.sh" story begin
"$SCRIPT_DIR/ledger.sh" story surface http://localhost:4748 story-demo
"$SCRIPT_DIR/ledger.sh" story accept story-r1
assert_eq delivery "$(next_value ACTION)" "delivery dispatch"
assert_eq fresh-required "$(next_value SESSION_BOUNDARY)" "Story-to-Delivery boundary"
export QL_SESSION_ID=session-delivery
"$SCRIPT_DIR/ledger.sh" session bind delivery driver

# Final preflight: an open decision blocks delivery too.
"$SCRIPT_DIR/ledger.sh" decision add pr-window contained reversible 02 "post-accept check"
assert_eq decision "$(next_value ACTION)" "delivery-blocking decision dispatch"
expect_fail "$SCRIPT_DIR/delivery-preflight.sh" final --default-branch main --target main
"$SCRIPT_DIR/ledger.sh" decision answer pr-window "confirmed"
assert_eq delivery "$(next_value ACTION)" "resumed delivery dispatch"
"$SCRIPT_DIR/delivery-preflight.sh" final --default-branch main --target main
"$SCRIPT_DIR/ledger.sh" final-pr open 430
expect_fail "$SCRIPT_DIR/ledger.sh" finish
"$SCRIPT_DIR/ledger.sh" final-pr record ci 0 "CI green"
"$SCRIPT_DIR/ledger.sh" final-pr record external_review 0 "all comments fixed or refuted"
"$SCRIPT_DIR/ledger.sh" final-pr feedback-round
"$SCRIPT_DIR/ledger.sh" final-pr ready
"$SCRIPT_DIR/ledger.sh" finish
assert_eq done "$(next_value ACTION)" "completed dispatch"

assert_eq done "$("$SCRIPT_DIR/ledger.sh" get .phase)" "final phase"
assert_eq 2 "$("$SCRIPT_DIR/ledger.sh" get '.timeline.actual|length')" "actual timeline count"
assert_eq true "$("$SCRIPT_DIR/ledger.sh" get '.design.approved and .story.accepted')" "human gates"
assert_eq 42 "$("$SCRIPT_DIR/ledger.sh" get '.chapters["02"].pr')" "focused PR"
assert_eq design-r2 "$("$SCRIPT_DIR/ledger.sh" get .design.revision)" "resolved design revision"
assert_eq critical "$("$SCRIPT_DIR/ledger.sh" get '.chapters["02"].impact')" "raised impact"
assert_eq 3 "$("$SCRIPT_DIR/ledger.sh" get '.chapters["02"].review_rounds')" "capped review rounds"
assert_eq ready "$("$SCRIPT_DIR/ledger.sh" get '.final_pr.status')" "final PR readiness"
assert_eq chapter-01-start "$("$SCRIPT_DIR/ledger.sh" get '.collaborators["quality-advisor"].checkpoint')" "advisor checkpoint"
assert_eq supervised "$("$SCRIPT_DIR/ledger.sh" get .mode)" "final mode"
assert_eq 2 "$("$SCRIPT_DIR/ledger.sh" get '.mode_events|length')" "mode events recorded"
assert_eq true "$("$SCRIPT_DIR/ledger.sh" get '.envelope.approved')" "envelope recorded"
assert_eq ratified "$("$SCRIPT_DIR/ledger.sh" get '.adrs["adr-01"].status')" "ratified ADR"
assert_eq revised "$("$SCRIPT_DIR/ledger.sh" get '.adrs["adr-02"].status')" "revised ADR"
assert_eq 0 "$("$SCRIPT_DIR/ledger.sh" get '[.decisions[]|select(.status=="open")]|length')" "no open decisions"
assert_eq 1 "$("$SCRIPT_DIR/ledger.sh" get '.notifications|length')" "notification recorded"
assert_eq session-delivery "$("$SCRIPT_DIR/ledger.sh" get '.session.id')" "final session binding"
assert_eq 8 "$("$SCRIPT_DIR/ledger.sh" get '.session.events|length')" "session boundary events"

echo "PASS: Quality Loop Ledger, gates, modes, and delivery preflight"
