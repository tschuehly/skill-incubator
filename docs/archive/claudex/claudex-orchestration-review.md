> **Archived experiment.** Claudex support has been retired. Paths, commands, and runtime claims below are historical evidence, not supported instructions.

# Adversarial Review: Claudex Orchestration Plan

Review of `docs/claudex-orchestration-plan.md`, cross-checked against
`docs/claudex-orchestration.md`, `claudex.sh`, `link.sh`, and the existing skills
(`agent-orchestration`, `model-orchestration`, `quota-axi`, `quality-loop`,
`claudex-quality-loop`). Findings are ordered by severity. Each states what the plan claims,
why that is doubtful, and what would resolve it.

## High severity

### H1. The whole plan serially depends on unverified runtime assumptions, with no failure branch

Phase 1 correctly puts runtime proof first, but Phases 2–9 assume Phase 1 succeeds, and the plan
contains no contingency if it does not. Three Phase 1 items are genuine bets, not checks:

- **GPT-family stage routing inside native workflows.** The plan's central promise — "bind a
  cognitive job to an available model without embedding model names" resolved *at dispatch* —
  requires that a workflow `agent()` call can name a GPT-family model and have it resolve through
  CLIProxyAPI. The Claude Code `Agent` tool's `model` parameter is an enumerated set of Claude
  tiers (`sonnet`, `opus`, `haiku`, `fable`); nothing establishes that workflow stage overrides
  accept arbitrary proxy model names. If they don't, cross-family routing is only reachable through
  static custom-agent frontmatter — exactly the mechanism Phases 3 and 7 are designed to remove.
- **`CLAUDE_CODE_SUBAGENT_MODEL=inherit` being "effective."** If a global subagent override wins,
  stage-level routing collapses to launcher-time binding and Phases 3 and 7 lose their premise.
- **"Unavailable models fail explicitly rather than silently inheriting another model."** This is
  written as an acceptance criterion, but it is a property of Claude Code and the proxy, not of
  anything Claudex builds. If the runtime silently substitutes, Claudex cannot make it fail
  explicitly without wrapping dispatch — a significant design change the plan doesn't budget for.

**Fix:** for each Phase 1 check, state the fallback design if it fails (e.g. "if dispatch-time GPT
routing is impossible, cross-family roles remain static frontmatter adapters and Phase 7's
'removal of fixed bindings' deliverable is dropped"). Right now a single negative result
invalidates five later phases with no recorded decision path.

### H2. The plan is silent about the Codex-spine coordinator and the Codex runtime, which the repo actively supports

`claudex.sh` offers a `codex-spine` profile (a GPT lead model driving the session), and `link.sh`
links every skill and agent into **both** `~/.claude/skills` and `~/.codex/skills`, including
`.toml` agent definitions for the actual Codex CLI. Two unaddressed consequences:

- A GPT-family coordinator (codex-spine under Claude Code via proxy) must *author and launch*
  dynamic workflow JavaScript. Phase 1 tests Claude- and GPT-family models as workflow *stages*,
  but never tests a GPT-family model as the workflow *author/launcher*, which is the
  codex-spine case Phase 5 requires (`claudex-quality-loop` "invokes `claudex-orchestration` for
  each bounded autonomous scope" — under either spine).
- Under the plain Codex CLI, the Workflow tool, `agent()`, `pipeline()`, agent teams, and
  workflow resumption do not exist at all. The plan makes `claudex-orchestration` "the single
  entry point for selecting native Claude Code execution primitives" but never says what a skill
  that is symlinked into `.codex/skills` does when those primitives are absent. Either declare
  the new skills Claude-Code-only (and change `link.sh` semantics), or specify degraded behavior.

**Fix:** add a Phase 1 fixture with a GPT-family coordinator authoring a workflow, and add an
explicit statement of Codex-runtime behavior (unsupported, or degraded to subagent shapes) to
Phase 2 and the change map.

### H3. Concurrency-control ownership contradicts itself, and the enforcement story is fictional

Phase 4 opens with "Keep workspace collision control with the runtime or domain module that owns
mutable execution," then lists "workspace ownership validation for concurrent mutation" as a
deliverable of the new `skills/run-continuity/` — the module that supposedly doesn't own it. The
acceptance criterion "two writers cannot acquire overlapping mutable ownership" restates the
existing `agent-orchestration` lease store (`workspace-lease.mjs`), which is **advisory**: it
rejects conflicting *registrations*, but nothing stops an agent that never calls it from writing
files. The companion doc's claim that "the controller rejects conflicting dispatches" imports Pi
vocabulary — Claude Code has no controller; there is no dispatch interception point. The plan's
tests would pass (the script refuses overlapping leases) while the property they name ("two
writers cannot…") remains false at the filesystem level.

**Fix:** state plainly that leases are honor-system in the Claudex runtime, put lease ownership
in exactly one module, and word the acceptance criteria as what is actually enforceable
(e.g. "the lease store rejects overlapping claims; workflow-generated mutation stages must use
disjoint output paths or worktree isolation, verified by the workflow author checklist").

### H4. The fate of existing modules is undefined, so "remove superseded modules" is unactionable

The repository change map omits `skills/agent-orchestration/` and `skills/quota-axi/` entirely,
yet both exist, both are installed by the `claudex-quality-loop` composition in `link.sh`, and
both overlap the plan heavily: `agent-orchestration` owns handoff contracts, continuity, leases,
and persistent-collaborator policy (overlapping modules 1 and 4); `quota-axi` owns quota-aware
routing (overlapping module 2). Delivery gate 9 says "remove superseded modules only after their
callers and tests have moved," but the plan never names which modules are superseded, which are
absorbed, and which survive. This is where the migration will actually hurt — two sources of
truth for orchestration policy during every intermediate phase — and the plan has no line about
it.

**Fix:** add every existing skill to the change map with a disposition: absorbed into X at phase
N, kept as-is, or deleted. Include the `link.sh` composition table, which currently hard-codes the
old organization.

## Medium severity

### M1. Most acceptance criteria test LLM judgment but are written as if deterministic

"A short edit selects direct work," "a serial debugging fixture rejects fan-out," "every decision
records why the selected shape is smaller and safer" — these are behaviors of a model reading
prose guidance, not of code. The delivery gates require "executable tests for deterministic
rules," but almost none of the Phase 2/5 rules are deterministic. A fixture that passed once can
fail on the next model version or even the next run. The plan nowhere states how many trials
constitute a pass, what variance is acceptable, or how criteria are re-validated when the
underlying model changes (this repo's model bindings change with quota daily, by design).

**Fix:** classify each acceptance criterion as deterministic (script-checkable) or behavioral,
and give behavioral criteria a sampling rule (e.g. N of M trials on the current spine profile)
plus a re-validation trigger on model changes.

### M2. Self-assessment conflict of interest in the evidence loop

The same coordinator that selects the execution shape writes the rationale for why it was
"smaller and safer than the alternatives," and module 5 analyzes decision logs authored by that
coordinator. Phase 8 asks whether "the orchestration reduced or introduced work" — evaluated
against no baseline, by the party that chose it. The one guard ("no candidate becomes standing
policy solely because one run succeeded") has no stated mechanism, owner, or veto. The predictable
failure mode is a rationalization treadmill: every shape choice arrives pre-justified, analysis
confirms it, and policy drifts toward whatever the coordinator likes doing.

**Fix:** require the shape rationale to name the rejected alternative and its estimated cost
*before* execution, and route improvement candidates through a reviewer that did not author the
run (the existing `quality-run-observer` is the obvious owner — the plan should say so).

### M3. Mid-run routing staleness is unhandled

Routing binds models from a "runtime capability snapshot" at dispatch, but a generated workflow
runs many agents over a long wall-clock span. Quota windows (the scarce resource, per
`quota-axi`) can exhaust mid-workflow; a static generated script has no re-route hook. The
acceptance criterion "quota changes affect eligible bulk work" is asserted without a mechanism:
does a running workflow re-consult the router per stage, or is the snapshot frozen at authoring
time? Either answer is defensible; choosing neither means Phase 3 tests will be written against
an unspecified behavior.

**Fix:** specify snapshot lifetime — e.g. "routing is resolved per `agent()` dispatch where the
runtime allows, otherwise frozen at workflow launch and recorded as such."

### M4. The plan version-pins a moving, non-contractual runtime feature and lists no risk for it

The supported runtime is "Claude Code 2.1.154 or later" (installed today: 2.1.212). Dynamic
workflows, agent teams, `CLAUDE_CODE_SUBAGENT_MODEL`, and effort overrides are harness features
with no stability contract, accessed additionally through a third-party proxy (CLIProxyAPI). The
Risks section covers seven internal risks but not the most likely external one: an upstream
Claude Code or proxy release changes workflow semantics, permission behavior, or model-name
resolution and silently invalidates Phase 1's recorded evidence. There is preflight *detection*,
but no policy for what a version drift means for previously validated policies.

**Fix:** add a risk entry with a control: pin the tested version range in the preflight, re-run
the Phase 1 fixture suite on version change, and treat routing evidence as versioned by
(claude-code, proxy) pair.

### M5. Human-gated continuity is required, but the state between same-session workflows is unowned

The companion doc states workflows accept no human input mid-run, so Phase 5 splits runs into
"separate native workflows around human approval boundaries." Between workflow N and N+1, the
aggregate results live only in coordinator context — the same context whose overload was a stated
reason to use workflows, and which is subject to compaction. Run continuity is "optional" and
explicitly not crossed by "same-session workflow runs," yet a multi-workflow Quality Run within
one session has exactly the inter-workflow state that neither workflow variables (dead with the
script) nor the durable record (not required same-session) holds.

**Fix:** state that any run composed of more than one workflow crosses the continuity seam
regardless of session boundaries, or name the artifact files that carry inter-workflow state.

### M6. Phase 9's transfer claim has no method for separating policy evidence from runtime behavior

The acceptance criterion "pilot results distinguish policy evidence from runtime-specific
behavior" is the hard part of the whole Pi transfer, and it appears only as an assertion.
Every Claudex observation is confounded with Claude Code specifics: `pipeline()` scheduling,
permission prompts, resumption semantics, proxy latency, and cross-family routing through
subscriptions Pi won't have. A shape policy that wins under Claudex ("workflow beats subagents
for repository-wide audit") may be an artifact of Claude Code's concurrency caps or context
economics.

**Fix:** define the discriminator up front: for each transferable claim, record which runtime
mechanisms it depends on, and mark claims "portable" only when the causal story survives with
those mechanisms replaced by Pi equivalents. Otherwise Phase 9 becomes vibes with a schema.

## Low severity

### L1. Unfalsifiable adjectives in success and completion criteria

"Small policy layer," "concise rationale," "smaller and safer," "coordination cost exceeds its
benefit," "actionable orchestration analysis" — none is operationalized, yet several appear
inside acceptance criteria. Phase 8 collects token counts and elapsed time but sets no thresholds
and defines no comparison baseline, so "whether the orchestration reduced or introduced work" can
never be answered from the recorded evidence alone.

### L2. Workflow launch as an authority boundary is claimed in the architecture doc but never tested

`docs/claudex-orchestration.md` says "the human can inspect the proposed phases and raw script
before execution," but no phase's acceptance criteria exercise human inspection or rejection of a
generated workflow, and the generated script itself is an unreviewed code artifact assembled
partly from repository content (a prompt-injection surface for the agents it spawns). At minimum,
Phase 2 should test that a workflow proposal is presentable and refusable before launch.

### L3. Installation simplification (Phase 7) lands before pilot evidence (Phase 8) exists

Delivery order removes domain-wide fixed bindings and reshapes `link.sh` one step before
representative pilots run. If pilots show adaptive routing underperforms the old fixed profiles,
the baseline configuration has already been dismantled. Cheap fix: keep the fixed profiles
installable (deprecated, not deleted) until Phase 8 evidence clears them — consistent with gate 9,
which the Phase 7 deliverable "removal of ... fixed worker and reviewer bindings" currently
contradicts in spirit.

### L4. Intended-state documentation risks describing an unbuilt system for the entire migration

`docs/claudex-orchestration.md` is already written in present tense ("Claudex supplies routing
policy...") while nothing in the plan exists yet, and each phase only requires "updated
intended-state documentation." Over a nine-phase migration this guarantees long windows where the
"supported architecture" document describes capabilities that don't work. Add a status marker or
a per-phase "implemented through phase N" note so a reader (or an agent loading the doc as
context) can tell aspiration from reality.

### L5. Phase 1's "recorded maximum safe test size" is machine- and moment-specific

Concurrency caps derive from local CPU cores and quota state; a number recorded on one laptop is
not a reusable policy input. Record the formula and the observed variables, not the constant.

## What the plan gets right

Worth preserving through revisions: runtime proof before skill restructuring; workflows
explicitly not the default shape, with direct/serial cases as first-class tests; independence
treated as distinct from correctness; continuity narrowed to real seams instead of universal
ceremony; and the Pi runtime boundary stated as a hard non-goal in both directions. The module
decomposition itself is sound — the findings above are mostly about unstated fates of existing
code, untested runtime bets, and acceptance criteria written more crisply than they can be
measured.
