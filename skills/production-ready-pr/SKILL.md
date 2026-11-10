---
name: production-ready-pr
description: Turn completed work into a decision-ready GitHub pull request.
disable-model-invocation: true
---

# Production-ready PR

Take completed work through local review, GitHub CI, and external feedback. Invocation authorizes
pushing the current branch and opening or updating its pull request. It never authorizes merging.

`<skill-dir>` is the directory containing this file.

## Select intensity

Invocation accepts `[low|medium|high|critical] [faceoff] [noeval] [<pr-number-or-branch>]`. Before honoring a supplied
level or classifying an omitted one, resolve the target with read-only repository and PR evidence and
read its applicable agent instructions, contribution guidance, and build policy to establish the
mandatory floor. Read the existing PR's Copilot request and review state and the repository's recent
Copilot reviews for evidence that a request registers and quota remains; when it shows Copilot
unavailable, ask for a substitute judge in the same question as the level. When a level is supplied, use the higher of it and that floor and state any raise.
When it is omitted, recommend the highest applicable level below, state what that level will run,
and ask the human to approve, choose another level, or cancel. Before approval, create no worktree
and run no tests, reviews, edits, commits, pushes, or PR mutations.

| Level | Highest applicable signal |
|---|---|
| `low` | Documentation, comments, test-only changes, or a provably behavior-preserving mechanical refactor |
| `medium` | Bounded, reversible runtime behavior in one area with no sensitive, persisted, or public contract |
| `high` | Data mapping or persistence, LLM prompts or tool routing, external integrations, public APIs, concurrency, permissions, or broad cross-module scope |
| `critical` | Authentication, credentials, destructive migrations, payments, irreversible data operations, or production infrastructure |

Impact outranks diff size. Scope may raise the level but never lower consequence. The approved level
is the run's minimum; repository rules may add checks or review but never remove them.

## 1. Pin the delivery scope

Identify the repository, current branch, target branch, originating issue or specification, and
merge-base. Use any PR number or branch named in the invocation before inferring from the current
checkout. Resolve the root with `git rev-parse --show-toplevel`, the branch with
`git branch --show-current`, repository identity with `gh repo view --json nameWithOwner`, PR state
with `gh pr view`, and known checkouts with `git worktree list --porcelain`. Keep that initial
worktree inventory in the session before creating another worktree. Run commands only against paths
those commands printed; ask the human when identities conflict or multiple worktrees are plausible.
Fetch before judging freshness and follow the repository's update policy. Reuse the open pull
request for the current branch; never create a duplicate. If the branch belongs to a
stack, load `gh-stack` and preserve the stack's branch and PR boundaries. Treat the stack as one
delivery unit: one review contract over the combined diff from the bottom layer's merge-base to the
top layer, and one full gate on the top layer. Fix each finding in the layer that owns it and run
that layer's affected checks. Record each layer's branch, PR, base, and head SHA, and bind the
shared review contract and top-layer full gate to that recorded stack revision: while it is
unchanged, they satisfy every layer's review and full-gate requirements. Each layer still needs its
own affected checks and remote evidence; run them as soon as that layer's head is final. Apply sections 4–7 to every layer's PR; the stack is
decision-ready only when every layer is.

Record the current head SHA. Every check and review below applies to a named SHA; a push invalidates
remote evidence for the previous SHA.

**Complete when:** the base, head SHA, specification source, existing PR state, and any stack are
explicit.

## 2. Establish local readiness

Read the repository's agent instructions, contribution guidance, and build configuration. Before
the first gate, compare the active toolchain versions with the repository's pins. Run the
smallest repository-prescribed compile, test, lint, type-check, and generated-file checks that cover
the diff. A check is affected when a change touches any source, test, fixture, prompt, or
configuration it reads. A failed required gate remains blocking until that gate is satisfied for the
resulting state or the human explicitly accepts its documented unavailability; a narrower passing
command is supplementary evidence, not a replacement.

At `low`, run affected prescribed checks. At `medium` and `high`, run affected checks during
iteration and the full prescribed gate once on the final candidate, after section 3 resolves its
findings and before section 4. Start static, architecture, and lint checks in parallel with review
round 1, and the full gate too when its lock is free; their failures join round 1's findings.
Immediately before the final-candidate gate, fetch and rebase onto the latest target branch, so the
gate, the review contract, and CI share one base; publish right after it passes. After publication, CI on the pushed SHA supplies the full gate at
`medium` and `high`; rerun the local full gate only after a scope-expanding change (section 3). At
`critical`, run the full local gate before review and after every material code change, including
after publication. Repository policy is the floor at every level.

A failure is a **known flake** only when it matches a documented flaky failure mode for that test,
or the same nondeterministic failure reproduces on an unchanged target-branch SHA; for a failure
outside the diff, rerun that single test on the target-branch SHA to get this evidence. Record the test,
failure message, and baseline evidence under Verification. That check is **waived**, never passed.
A check is **satisfied** when it passes or is waived; every other failure blocks. Run no more PR or stack owners at once than there are free full-gate slots
across the Mac, the Windows PC (`~/.local/bin/pc-run <gate>`; exit 75 means the PC is unavailable:
run locally, never retry), and CI. At `medium` and `high`, when the repository serializes full
gates behind a shared lock, use the queue time for reviews and affected checks, and queue the full
gate for the final candidate only; once the lock wait passes about 15 minutes, use CI on the
candidate's draft push as the final-candidate gate.

Inspect the complete merge-base diff
and verify that it contains no secrets, accidental files, unrelated changes, or missing user-visible
documentation.

Commit the intended change. Keep generated output and unrelated local files out of the commit.

**Complete when:** the intended diff is committed, the working tree is clean apart from known
unrelated files, and affected checks are satisfied with command evidence; at `critical`, the full
gate is satisfied too.

## 3. Challenge the change

Load `model-orchestration` before delegation.

**Reviewer roster (trial).** Every independent reviewer below launches with the `modelOverride` and
`effort` from this table, not default routing, so the run compares Grok, Gemini, and Sol and spares
Codex quota. Astra is not on the roster.

| Slot | Model | Effort |
|---|---|---|
| Round 0 judge | `xai-auth/grok-4.7` | `high` |
| `medium` combined review; approved Copilot substitute | `antigravity-acp/gemini-4-argon` | `high` |
| `high` Standards lens | `openai-codex/gpt-6.1-sol` | `medium` |
| `high` Spec lens | `openai-codex/gpt-6.1-sol` | `high` |
| `high` Simplicity lens | `xai-auth/grok-4.7` | `medium` |
| Readiness judge A: invariants, data flow, abuse cases | `antigravity-acp/gemini-4-argon` | `high` |
| Readiness judge B: differential, state-transition, compatibility probes | `xai-auth/grok-4.7` | `high` |
| `critical` readiness judge C: falsify the merged findings | `openai-codex/gpt-6.1-sol` | `xhigh` |
| Delta re-review of a lens | that lens's model and effort | |
| Delta re-review of an unflagged change | `openai-codex/gpt-6.1-sol` | `medium` |

When a slot's model shares the author's family, or its launch blocks, use
`anthropic/claude-opus-5-5` at the same effort when the author is not Anthropic, otherwise another
roster model whose family differs from the author's; record the swap and its reason. `light-review`
keeps default routing. Start every lens report with `MODEL=<provider/model> EFFORT=<level>`. For
each run, append one JSON line to
`~/.pi-workbench/scratch/production-ready-pr-trial/ledger.jsonl` with repository, PR, level, and per
slot: model, effort, material findings, unique defect classes, refuted or noise findings, missed
findings later caught by another reviewer, and wall time.

**Face-off (trial).** When the invocation includes `faceoff` (at `medium` and above), round 1's
readiness review becomes a blind face-off. One frozen brief covering both judge A and judge B
focuses runs on the same SHA on `xai-auth/grok-4.7`, `antigravity-acp/gemini-4-argon`, and
`openai-codex/gpt-6.1-sol`, all at `high`. `openai-codex/gpt-6-astra` at `high` joins as a baseline
only when the human names it. These contestants replace judges A, B, and C for that round; the
other lenses run as usual. Skip a contestant from the author's family. Keep every report hidden from
the other contestants. The lead adjudicates each finding by running its probe or citing a refutation,
then merges duplicate classes. Credit each contestant with valid defect classes, unique valid classes,
noise findings, and wall time. Show that scoreboard to the human before fixing. Each contestant
receives the delta re-review of its own material findings. Mark the ledger line `"faceoff": true`.

**Round 0: should this PR exist?** At every level, before any lens, draft push, or Copilot request,
the roster's Round 0 judge receives the diff, specification, and repository rules and answers,
each with cited evidence:

- (a) Root cause or symptom? Name the layer where the meaning or behaviour is lost.
- (b) Does it work on an unrelated domain or schema, with no fixed keyword lists or label tables?
- (c) Is there measured user-facing value? A change switched off with no measurement, or a narrow
  metric moving while the outcome metric stays flat, counts as no.
- (d) Is there a simpler fix that removes the problem class rather than guarding it?

For a change with no runtime behaviour, such as documentation or tests, the judge marks (a) and
(b) not applicable, and (c) needs the specification's stated need instead of a measurement.
A symptom in (a), a no in (b) or (c), or a yes in (d) stops the PR: bring the judge's answers and
the alternative to the human before spending review effort. Round 0 is not a round in the count below
and does not use the two-round cap; rerun it when the human chooses a different fix.

**Eval mode (trial).** At `medium` and above, for a repository listed in `trial/faceoff.json`
`repos`, run `node <skill>/trial/faceoff.mjs --campaign eval eval <repo> <pr>` once Round 0 passes,
then continue without waiting. It queues a blind model panel in the background. Never read the
panel's results during the review; they exist only for the nightly comparison. Skip it when the
invocation includes `noeval` or `PRR_EVAL=0` is set.

Then apply the approved review contract against one merge-base and head SHA:

- `low`: the lead applies Standards, Spec, and deletion-first Simplicity lenses; Copilot remains the
  external review.
- `medium`: dispatch the roster's combined reviewer for Standards, Spec, Simplicity, and
  production-readiness falsification.
- `high`: run five isolated lenses on the roster—Standards, Spec, Simplicity, and readiness
  judges A and B—keeping their findings hidden from one another until all finish. Load
  `code-review` and `ponytail-review` for their review contracts. For a stack, each lens reviews
  every layer's own diff as a separate slice, with the combined diff as context, and reports
  findings per layer; this is still one round.

  Merge readiness judges' duplicate defect classes and record each judge's unique ones. Each judge
  counts as its own lens for delta re-reviews.

At `medium` and above, push the candidate before round 1 as draft PRs (section 4 creates them;
mark them draft until section 4's ready condition holds) and request Copilot, so its findings
join round 1's fix batch instead of arriving after publication. A draft push is preliminary:
"publication" in this skill means marking the PR ready in section 4. Before reconciling round 1,
wait for the lenses, section 2's parallel static, architecture, and lint checks and any full gate
already started, and the draft Copilot review or its approved substitute, then inventory Copilot's findings as section 6 describes. Verify once, before round 1, that the
request registered in GitHub state. When Copilot is unavailable, record the gap with its reason and
the head SHA and ask the human once to accept the gap or approve a substitute judge, unless the
level question already settled it; an approved substitute runs in round 1 alongside the lenses. No
other reviewer substitutes without that approval.

Each lens writes its report to a path the repository and global rules allow, such as `$PI_TMP`,
and the lead cites that path.
- `critical`: run the `high` contract plus readiness judge C and the consequence-sized checking
  panel required by `model-orchestration`, including its final evidence-boundary review, drawing
  panel members from the roster. If the required independent families are unavailable, report
  `ROUTING=BLOCKED` rather than degrading the panel.

Every independent readiness review receives the diff, specification, repository rules, and
local-check evidence, and looks for concrete correctness, security, data-loss, concurrency,
compatibility, operability, and missing-test failure modes. Every reviewer reports each finding as
a **defect class**: the violated rule, a minimal failing probe, every entry point that reaches it,
and neighbouring positive and negative cases. When the code reads a grammar or walks a state
machine, generate probes from that grammar or state machine—each construct, nesting, and
transition—not only from collected examples.

A **round** is every review of one head SHA, Copilot's included; number rounds 1, 2, 3 with no
suffixes. A retry on the same SHA stays in its round, and a resumed session continues the count. The first round runs the
complete contract on the complete diff. Later rounds are **delta re-reviews**: rerun only the lenses that reported material findings, give each its earlier findings
and the diff since the SHA it reviewed, and ask it to confirm each fix and check the touched code
for regressions. The **review contract** for a SHA is the latest full round plus every later
passing delta; lenses that passed earlier carry forward, with their reviewed SHA recorded as
evidence, once every change since the full round has passing delta coverage. A change that no
lens flagged, such as a fix for a gate failure, gets its delta re-review from the lead at `low`,
otherwise from the roster's unflagged-change reviewer. A **scope-expanding** change, one that adds a code path, schema, permission, or behavior
beyond the finding it fixes, starts a new full round. A rebase or restack keeps the review contract
when `git range-diff` shows unchanged patches. A hand-resolved conflict always gets a delta
re-review of the resolution, even when every lens passed: by the lead at `low`, otherwise by the
roster's unflagged-change reviewer.

State whether the reviewed head is
intentionally unpublished or a draft; before section 4, reviewers must not treat that expected publication
state as a code defect. A finding is actionable only when it cites code, a repository rule, the
specification, or a concrete failure mode. Treat unsupported "best practice" claims as noise. A
failed launch or unavailable required binding blocks its level and must be disclosed. Truncated output is incomplete; rerun narrower slices against the same base
and head whose union covers the complete diff. The lead's own review is not a substitute for an
independent review required by the selected level.

Reconcile every finding from every required report in the session as fixed, refuted with evidence,
non-material with a reason, or explicitly accepted by the human. Tag each finding raised after
round 1 as **missed** (already present in the round-1 head, including inherited code) or
**fix-introduced**, and count the two separately. Never describe a report as passing
when it says `FAIL`, `BLOCKING`, or `not a PASS`; after resolving such a verdict, run its delta
re-review against the resulting SHA. Fix material findings, refute incorrect findings
with evidence, and rerun affected checks. Fix the class, not the example: fix the shared cause
across every entry point and representation. Keep one **probe corpus** for the run beside the
lens reports, holding every probe from every reviewer with its command and expected result; the
lead writes the probe and neighbouring cases for a Copilot or other external finding that lacks
them. Rerun the whole corpus after every fix. A fix closes only when every probe in its class
passes and the controls (neighbouring cases and every earlier passing probe) still pass.

For code that reads syntax (a parser, matcher, rewriter, or validator), make the safe fix first:
where the code cannot fully interpret its input, it preserves the input, refuses the operation, or
counts the unknown conservatively across the whole ambiguous region. Only then add recognition
cases, preferring an existing parser, and record a follow-up issue for input left unsupported.
When the safe fix changes approved behavior, or after round 2, ask the human before applying it. Once required reports pass, do not change the candidate
solely for optional cleanup or a non-material simplification that cites no repository rule,
specification requirement, or concrete failure mode; record it as non-material unless the human
asks, because any edit reopens the selected contract. Ask the human when a finding changes approved intent or
requires a product decision. A fix that needs new design, a new API, another repository, or more
than about an hour of new work is an intent change: offer the human fix-here, follow-up PR, or
accepted limitation.

Cap the loop at two rounds. After round 2, run only fixes for **blocking** findings (security,
data loss, or a broken specification requirement) and their delta re-reviews; bring every other
finding to the human as one list, each marked fix-now, follow-up, or accept. A new blocking finding,
a new non-Copilot finding, or a failed fix verification after round 2 pauses the run for the human.

**Complete when:** the review contract holds for the resulting head SHA, every finding has an
explicit disposition, no material finding remains open without human acceptance, and that SHA
satisfies its required local checks. An unavailable required binding blocks this level until the human chooses
a different permitted level or the binding becomes available.

## 4. Publish the PR

Load `write-for-humans` before writing shared GitHub text. Start every agent-authored PR body and
comment with `🤖`. An independent check of PR text or comment replies uses the `light-review` role.

Push the branch. Create the pull request when none exists; otherwise update the existing one. Write
for a reviewer who has not followed the implementation. The opening sentence states the user or
system outcome without requiring codebase context. Use these sections in order:

1. **Goal** — the concrete problem, desired behavior, and originating issue or specification.
2. **What changed** — the implementation in plain language; name code symbols only when needed.
   When the shape takes a paragraph to explain, show the smallest visual instead: pseudocode, a
   call tree, a file tree with +/- markers, or a Mermaid diagram.
3. **Result** — the observable behavior, with a concrete example when it clarifies the outcome.
4. **Boundaries** — intentionally unsupported behavior, material risks, compatibility notes, and
   accepted limitations or decisions. Open with **Door:** one-way (hard to undo after merge:
   migrations, published APIs, deleted data) or two-way, and **Blast radius:** one word (none,
   module, service, users).
5. **Verification** — the commands, checks, and results that support the claims. Quote a numeric
   result only from successful output that can be cited; otherwise name the command and its pass or
   fail result. For a behavioral or visual change, pair **Before** and **After** from real output
   or screenshots.

For a stacked PR, explain this layer's distinct outcome and its dependency on adjacent layers.

Make the PR ready for review after the local readiness gate passes. Request Copilot review of the
published head with `--reviewer @copilot`; findings from its draft review belong to the same
reconciliation as round 1. If the repository requests Copilot through a ruleset, confirm the request in
GitHub state instead of issuing a duplicate. A failed or unavailable Copilot request is explicit;
it never silently counts as review.

**Complete when:** the PR URL, number, base, and published head SHA are known and Copilot review is
requested or its unavailability is explicit.

## 5. Observe CI and review

Run `<skill-dir>/scripts/pr-state.sh <pr-number>` once. It emits one machine-readable state followed
by a JSON snapshot. It is read-only and safe to use as a `monitor` poll source. Pass only a PR
number from the current repository.

Start one narrow observer for that PR and head SHA. Notify on:

- `STATE=CI_FAILED`;
- `STATE=MERGE_BLOCKED`;
- `STATE=REVIEW_BLOCKED`;
- `STATE=REVIEW_FEEDBACK`;
- `STATE=NO_CI`;
- `STATE=BLOCKED_TRUNCATED`; and
- `STATE=READY_CANDIDATE`.

Use `safetyClass: observer`, a bounded expiry, and a reuse key containing repository, PR number, and
head SHA. When a `/goal` is active, call `goal_wait` after the observer exists. Otherwise trust the
monitor ping and end the turn; the observer survives session restarts, while a `sleep` loop dies
with the session. Expiry means review is still pending, not
that it passed.

The snapshot reads GraphQL review threads, top-level PR comments, and every Copilot review body for
the current head. It treats an unresolved top-level `Acceptance blocker:` and exact-head Copilot
summaries that say `Changes recommended`, `Needs a closer look`, `Suppressed comments`, `Comments
suppressed`, or `Previously missed` as feedback. Reviews of earlier SHAs still require the manual
historical reconciliation in section 6.
`BLOCKED_TRUNCATED` means GitHub returned more review data than the bounded snapshot; inspect the
remaining pages before proceeding. `NO_CI` fails closed: after repository rules confirm that no
remote check is expected, rerun with `ALLOW_NO_CI=1`. On `CI_FAILED`, reconcile every failure;
when each one is a known flake (section 2), record the waivers and continue to section 7. Use `ALLOW_MISSING_COPILOT=1` only after the
human accepts documented Copilot unavailability.

**Complete when:** CI or review needs action, or the latest published SHA is a ready candidate.

## 6. Service feedback

Stop the observer before changing the branch. Fetch every top-level PR comment and every non-empty
Copilot review body, not only inline threads or the latest review. Expand `Suppressed comments` and
`Previously missed` sections and inventory each finding. Classify every thread, top-level comment,
and summary finding; a delegated classification uses the `light-review` role, while every code fix
keeps `review`:

- **fix:** implement, test, commit, and push;
- **refute:** reply with concise evidence;
- **intent change:** ask the human before editing; or
- **defer:** keep the PR blocked until the human accepts the limitation.

Resolve a Copilot thread only after its finding is fixed or refuted in a reply. A top-level
`Acceptance blocker:` remains blocking because issue comments have no resolution state. For an
agent-authored comment, edit the original after resolution to begin `🤖 ✅ Resolved —` and include
the evidence; never edit a human-authored comment on their behalf. Do not resolve a human
reviewer's thread on their behalf. After a push, reapply section 2's gate requirement to the
resulting SHA. At `low`, rerun the affected lead lenses. At `medium` and `high`, run focused tests for
each fix and one delta re-review of the feedback fixes by the roster's unflagged-change reviewer; a scope-expanding change
starts a new full round (section 3). At
`critical`, rerun the complete selected review contract from section 3 against the resulting SHA.
Push every fix from one Copilot review together, so each Copilot round costs one re-review.
Copilot shares the two-round cap. From its second round on, only a blocking finding pauses the run;
add each non-blocking finding to the human's list and keep going. After publication, rebase onto a
moved target branch only when GitHub reports a conflict or repository policy requires it, at most
once; a conflict that needs a
behavior choice goes to the human. Request another
Copilot review unless the repository's ruleset reviews new pushes automatically, then return to
observation.

**Complete when:** every thread, top-level comment, and summary finding is classified and evidenced,
with no blocking item deferred without human acceptance.

## 7. Declare decision readiness

Run `pr-state.sh` again and compare its `headSha` with local `HEAD`. Declare the PR decision-ready
only when:

- prescribed local and remote checks are satisfied for that SHA, with waived checks reported as
  waived;
- Round 0 passed, or the human chose to proceed after it stopped the PR;
- the section 3 review contract holds for that exact SHA;
- GitHub reports the branch mergeable;
- no required review requests changes;
- no unresolved review thread or top-level acceptance blocker remains;
- Copilot reviewed that SHA, or the human explicitly accepted documented unavailability and any
  approved substitute reviewed it;
- every finding in all Copilot review bodies, including suppressed and earlier findings, is
  explicitly resolved, refuted, or accepted;
- all adversarial findings are resolved or accepted;
- the PR body still describes the delivered behavior and evidence; and
- for a stack, every layer's PR meets these conditions.

Inspect `git worktree list --porcelain` and remove every clean worktree that was absent from the
initial inventory and explicitly created by this run. Preserve pre-existing, dirty, or
uncertain-ownership worktrees and report why they remain.

Report the PR URL, head SHA, checks run, review disposition, missed and fix-introduced counts,
accepted limitations, and the per-model trial line appended to the ledger. When eval mode ran,
add one line naming its case id (`live-<repo>-<pr>-<sha8>`). Leave the
merge to the human.
