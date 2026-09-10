# Implement, review, and integrate one Chapter

Use this reference for `chapter` and `blocked` actions from `scripts/next.sh`. Operate only on the
printed `CHAPTER`. Work one Chapter at a time unless the approved dependency graph and isolated
branches make parallel work demonstrably safe.

## Resume a blocked Chapter

For `blocked`, inspect the recorded blocker before acting. If a Decision Inbox entry remains open,
follow [modes.md](modes.md). If every material deviation is resolved in the current approved Design
revision, run `ledger.sh chapter <id> resume <design-revision>` and re-run `scripts/next.sh`. Preserve
the recorded `blocked_from` state; never administratively reset the Chapter.

## Implement

1. Branch from the current integration branch. Record the Chapter branch and base commit. When the
   Chapter uses a broad verification lock or a structural RED waiver, capture that configured gate
   at the untouched base in an isolated worktree:

   ```sh
   <skill-dir>/scripts/test-gate.sh baseline <chapter> <stable-key> -- <configured-command>
   ```

   A red baseline is evidence, not permission to weaken acceptance. Define a project-owned
   comparison evaluator that fails on any result outside the approved baseline policy.
2. **Choose the dispatch mechanism, before the first implementer, and journal the choice with its
   rationale.** Both mechanisms carry identical invariants — one writer at a time, an exclusive
   lease per writer, gates through `test-gate.sh`, Ledger transitions Driver-owned.

   - **Default — a Chapter-specific Workflow.** When a `Workflow` tool is in your tool list, author
     one for the implementation phase, per *Orchestrate implementation with a dynamic Workflow*
     below. Invoking this skill is the user's Workflow opt-in; do not ask.
   - **Fallback — hand-chained slices.** When no `Workflow` tool exists, or when the Chapter's
     implementation is one indivisible dispatch with no consult point and no slice boundary, per
     *Bound implementation slices* below.

   A Chapter that hand-chains without a journaled reason is a process deviation, not a style
   preference.

   **Then choose the implementer tier, and journal that too.** Ask one question: *can this brief
   prescribe the change, or must the implementer decide something the brief cannot settle?* Use the
   configured judgment-tier implementer by default. Drop to the prescribed tier only when you can
   name, in the journal, what makes the brief complete — the design decision already resolved, the
   transformation already specified, the shape already given. Criticality does not answer this
   question and must not stand in for it: a Chapter can be critical because its blast radius is
   large while its work is mechanical, and another can be routine while its central decision is
   empirical and only the implementer can make it.

3. Dispatch one fresh implementer **at a time** — under either mechanism — with the relevant
   approved `spec.md`, `design.md`, `concepts.md`, Chapter, project configuration, and binding
   project instructions. The Driver chains replacements; an implementer never delegates another
   implementer. Give the implementer an exclusive workspace lease naming every mutable build or
   generated-output directory, then acquire it in `<run-dir>/workspace-leases.json` before dispatch.
   Release it only after the implementer has no active process and returned a commit or validated
   checkpoint.

   A brief states as *fact* only what has been checked. Require every scout to mark each finding
   **verified** (it read the code path and quotes it) or **unverified** (inference, precedent, or a
   claim it did not exercise), and carry that mark into the brief. A claim that an invariant is
   already pinned by an existing test is verified only when the cited test exercises the
   load-bearing path — confirm that before it enters a brief, the journal, or a test comment. An
   unchallenged wrong citation propagates into the implementation's evidence and survives to the
   board, leaving the invariant it appeared to cover pinned by nothing. A scout works alone with no
   one to correct it; give the role a model that can be trusted alone, and read its claims as
   evidence, not conclusions.

   Leases coordinate *this Run's* agents; nothing enforces them. Before dispatch and again before
   delivery, verify the worktree carries no changes outside the Chapter — a foreign writer holds no
   lease and will not honour one. Fence every writer's brief away from unrelated dirty paths, and
   never resolve foreign changes by discarding them.

4. Follow project TDD: understand → valid RED → minimal coherent GREEN → configured verification.
5. Run and quote:

```sh
<skill-dir>/scripts/test-gate.sh red <chapter> -- <focused-test>
<skill-dir>/scripts/test-gate.sh green <chapter> -- <focused-test>
<skill-dir>/scripts/test-gate.sh compare <chapter> <stable-key> -- <comparison-evaluator>
<configured compile/lint/browser/full-suite checks>
<skill-dir>/scripts/diff-budget.sh --base <chapter-base> <explicit configured budget arguments> # only when configured
```

6. Let the implementer commit and return only commits, changed concept/architecture keys, gate
   evidence, and candidate deviations. Update the Chapter evidence and generated timeline.
7. Generate a deterministic review manifest with
   `<skill-dir>/scripts/change-shape.sh --base <chapter-base> --test-root <configured-test-root>...
   --json <run-evidence-path>`. Configure an additional `--skip-pattern` when the project does not
   use the built-in JVM, Python, or JavaScript skip controls. The manifest records its configuration;
   JVM path/package consistency is reported only for matching Kotlin and Java test trees.

Keep broad refactoring out of implementation. The Craft pass owns the single post-review
refactoring step.

### Bound implementation slices (fallback mechanism — see step 2)

Keep the semantic Chapter intact when it remains one coherent, reviewable change but its mechanical
execution is too wide for one agent context. Sequence fresh implementation slices from the Driver:

1. Partition remaining work into one bounded outcome before dispatch. Prefer a file/package group,
   one failing gate, or one mechanical transformation with an observable completion condition.
2. Give the implementer a validated `/agent-orchestration` handoff contract. Cap the slice at 40
   tool calls and two broad compile or test cycles. Require targeted searches and summarized command
   output; do not return repository-wide listings or full build logs when a bounded excerpt suffices.
3. Keep exactly one writer and one mutable-workspace process owner active on the Chapter branch.
   The Driver and reviewers do not run builds in that worktree while its lease is active; parallel
   verification uses isolated worktrees. End the slice at a named commit, or at a
   recorded RED checkpoint when a coherent partial commit cannot pass yet. Never hand off
   unexplained dirty state.
4. Before the cap, write and validate a checkpoint contract under the Chapter Run Record, including
   current commit, completed work, open work, gate state, evidence anchors, and one next action. Bind
   it with `ledger.sh collaborator bind chapter-<id>-implementer <agent-id> <checkpoint-path>` or
   advance it with `ledger.sh collaborator checkpoint chapter-<id>-implementer <checkpoint-path>`.
5. Return the checkpoint path and concise evidence to the Driver. When open work remains, the Driver
   starts a fresh replacement from that checkpoint; never paste the predecessor transcript or raw
   tool results into the replacement brief.

Split the Chapter instead when the remaining work cannot be expressed as bounded slices while
preserving one coherent RED→GREEN path and reviewable Chapter diff.

### Orchestrate implementation with a dynamic Workflow (default mechanism — see step 2)

Author a Chapter-specific workflow for the implementation phase. A workflow does not weaken the
one-writer rule — it *encodes* it: one writer per stage, consults around it.

Choose the shape per Chapter from the problem itself — sequential writer slices, a read-only scout
fan-out that assembles the implementer brief, in-loop advisory consults on the approach or the
in-progress diff, or competing candidates in isolated worktrees judged against the acceptance
criteria. Scouting inline before authoring is expected: discover the work-list first, then
orchestrate over it. A single scout does not need a workflow.

Put consults where the Chapter's **unresolved decisions and unverified claims** are, not around
every writer. A Chapter whose contract records its hard decision as resolved needs no consult on
that decision; one carrying an open question, or a brief resting on a scout's unverified claim,
does. Criticality alone does not imply a consult.

Journal each authored workflow, its shape rationale, and any orchestration failure.

Inside a workflow the Chapter invariants do not move:

- Default to one writer at a time. Parallel writers are allowed when each writes in an isolated
  worktree or the edited-file partition is demonstrably disjoint: give every writer its own
  workspace lease, name one merge owner, and run the gates on the merged result.
- Run gates through `test-gate.sh` with quoted output whether inside or outside the script.
  Ledger transitions, decisions, deviations, and human gates stay with the Driver, outside
  scripts.
- In-loop advisor- and reviewer-pattern agents advise the implementer only. They never replace,
  pre-empt, or count as board lenses, and persistent ledger-bound collaborators stay outside
  workflows, Driver-owned.
- Bound each workflow to one slice or consult round — resume is same-session only; never start
  one near context exhaustion. Copy every authored script and its workflow journal into
  `evidence/<chapter>/workflow/`.
- Journal the step-2 mechanism choice before the first implementer. Choosing the fallback is
  legitimate; leaving the choice unrecorded is not — an un-authored workflow leaves no artifact,
  no Ledger event, and no journal line, so nothing else can surface it.

## Run the risk-adaptive board

Run every reviewer isolated against the approved design, relevant Chapter, stable keys, project
conventions, and bounded Chapter diff. Never ask the author to be the only reviewer and never add a
generic reviewer that overlaps an existing lens.

Give the board the generated change-shape manifest. Reviewers may rely on its deterministic counts
and path lists, then spend independent judgment on behavioral, architectural, and convention risks;
they do not repeat repository-wide mechanical sweeps unless they challenge the manifest itself.

| Criticality | Blocking reviewers | Finding verification |
|---|---|---|
| `low` | one combined Correctness + Tests reviewer | one fresh batched Verifier per round |
| `standard` | Correctness vs Design + Test Adversary | one fresh batched Verifier per round |
| `critical` | Correctness + Test Adversary + Security, plus configured extra | one fresh Verifier per finding |

Fold Convention compliance into the Correctness brief. Run Security for every critical Chapter,
every configured security surface, and every change flagged as security-relevant. When uncertain,
run Security. Escalate to the full critical board when a confirmed finding raises criticality or
impact; never lower either.

Use [templates.md](templates.md) for the forced finding schema. Deduplicate the board’s findings,
then require a fresh adversarial Verifier to return a separate verdict with quoted evidence for each
finding. Reject verdicts without quoted evidence.

When a lens dies mid-review, the cause decides the remedy. A harness or process failure did not
corrupt its judgement: resume it from its transcript and journal the interruption. Context
exhaustion did: dispatch a fresh lens against the same brief and discard the partial verdict. A lens
that returns no verdict is not a clean lens.

Route each confirmed finding:

- `auto-fix`: group by file overlap, fix, commit, and re-run affected lenses;
- `no-op`: journal the evidence and expose it in the System Story evidence index;
- `decision`: use [modes.md](modes.md); freeze only for a material deviation.

Increment `ledger.sh chapter <id> review-round` after each completed board. Re-run only affected
lenses after fixes. The Ledger refuses a fourth round; record every unresolved finding in a high
review-non-convergence deviation and freeze the Run.

After a clean board, apply the project's own formatter and linter to the Chapter diff first — import
hygiene, dead imports, and mechanical style are a tool's job, and an agent spent on them is a
dispatch bought for nothing. Then run the Craft apply pass from
[craft-checklist.md](craft-checklist.md) exactly once over what the tool cannot see — naming,
altitude, shape, duplication — re-run focused tests, and mark the Chapter reviewed. When the project
has no configured linter, the Craft pass absorbs that work; say so in the journal. Skip the Craft
dispatch entirely when the linter leaves nothing a maintainer would trip over.

## Verification dials

Require the project’s mechanically blocking critical-evidence key for critical Chapters. Use
mutation evidence by default. When the project has no compatible mutation engine, require a named
compensating gate combining the strongest relevant negative cases, invariant checks, and
runtime/parity evidence. A skipped check is not passing evidence.

Impact controls System Story presentation, not whether code is reviewed. Record every impact
increase with evidence; never decrease impact.

## Integrate

Run:

```sh
<skill-dir>/scripts/delivery-preflight.sh chapter <id> \
  --default-branch <name> --target <integration> \
  --critical-evidence <configured-key> <optional explicit budget arguments>
```

Integrate only after preflight passes:

- Merge locally into the integration branch by default.
- Use a focused PR only for an approved independent merge, ownership, external-CI, risky rollout,
  or safe parallelization boundary. Target the integration branch and service automated feedback.

Mark the Chapter integrated only after the selected route completes. Re-run `scripts/next.sh` to
receive the next Chapter or gate.
