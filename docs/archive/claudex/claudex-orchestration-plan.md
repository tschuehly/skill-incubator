> **Archived experiment.** Claudex support has been retired. Paths, commands, and runtime claims below are historical evidence, not supported instructions.

# Claudex Orchestration Plan

## Outcome

Claudex uses Claude Code as its native execution runtime and adds five focused modules for adaptive
execution-shape selection, cross-family model routing, domain quality requirements, and durable
state at real recovery or authority boundaries.

The implementation proves orchestration policies in live Claudex runs. Validated policies and
observations inform the Pi Workbench, whose worker runtime remains Pi. Pi does not launch Claude
Code, Codex, Claudex, or another coding-agent harness.

Success means:

- a coordinator chooses direct work, subagents, an agent team, or a dynamic workflow from task
  evidence;
- generated workflows own scalable loops, branching, fan-out, aggregation, and same-session
  progress;
- model bindings are resolved from cognitive requirements and runtime capacity;
- domain skills declare quality and authority requirements without prescribing a universal agent
  organization;
- durable state exists only when work must survive a session, human gate, or coordinator
  replacement;
- orchestration decisions and outcomes produce evidence that can improve routing and workflow
  policy.

This plan is gated, not speculative sequencing: a failed runtime proof selects a documented
adapter or stops dependent work. No later phase may assume an unverified Claude Code or proxy
behavior.

## Relationship to the Pi Workbench

Claudex and Pi Workbench share concepts but have different runtime seams.

| Concern | Claudex incubation runtime | Pi Workbench product runtime |
|---|---|---|
| Coordinator | Interactive Claude Code session | Owner-facing Pi session |
| Execution graph | Generated dynamic workflow script | Versioned graph proposed by a Pi coordinator |
| Bounded execution | Claude Code subagent or workflow agent | Pi worker or Pi subagent |
| Parallel mapping | `pipeline()` | Controller-mediated parallel dispatch |
| Intermediate results | Workflow variables | Ledger node results and artifact references |
| Runtime progress | Claude Code workflow view | Workbench event stream |
| Same-run recovery | Claude Code workflow resumption | Controller snapshot and event tail |
| Cross-session state | Domain run record | Durable Pi run ledger |
| Permissions | Claude Code permissions and sandbox | Pi controller policy and workspace leases |
| Model selection | Claudex proxy and stage binding | Pi provider and role binding |

The shared asset is the policy and evidence model: execution-shape criteria, role requirements,
quality envelopes, routing rationale, stopping conditions, verification patterns, and run-analysis
findings. Runtime-specific scripts and agent definitions remain adapters at their respective seams.

A GPT-family model leading Claude Code through the Claudex proxy is a supported Claudex
coordinator. The plain Codex CLI is a separate runtime. It does not execute
`claudex-orchestration` or claim Claude Code dynamic workflow support; Codex-facing skills use
Codex-native delegation through their own adapters.

## Module design

The implementation consists of five deep modules. Each exposes a small interface and keeps its
runtime-specific implementation local.

### 1. Claudex orchestration

**Purpose:** select and supervise the execution shape for one bounded objective.

**Interface:**

```text
orchestrate(objective, repositoryContext, domainEnvelope, runtimeSnapshot)
  -> executionDecision
```

`executionDecision` contains bounded fields:

- selected shape: `direct`, `subagent`, `team`, or `workflow`;
- semantic work units and dependencies;
- authority gates and stopping conditions;
- evidence and result requirements;
- size, cost, and concurrency guidance;
- the rejected next-smallest and next-largest shapes;
- pre-execution estimates for agent count, mutable scope, token class, and expected evidence;
- the reason the selected shape is preferred.

The module hides prompt guidance, workflow-authoring conventions, native tool selection, and the
rules for returning results to the coordinator.

### 2. Model routing

**Purpose:** bind a cognitive job to an available model without embedding model names in domain
workflow semantics.

**Interface:**

```text
route(roleRequirements, runtimeCapabilitySnapshot, independenceContext)
  -> modelBinding
```

`roleRequirements` describes capability, context breadth, continuity, latency sensitivity,
independence, tools, and effort. `modelBinding` contains the selected provider, model, effort,
rationale, and explicit fallback behavior.

The module owns current model metadata, quota interpretation, proxy compatibility, and empirical
routing observations. Domain skills may request capabilities such as broad comprehension or fresh
cross-family review; they do not name permanent model owners.

Each native workflow freezes one capability and quota snapshot at approval. Its stage bindings do
not change mid-run. A later workflow resolves from a fresh snapshot. Capacity exhaustion fails the
affected dispatch and is recorded; it never causes an unrecorded family substitution.

### 3. Domain envelope

**Purpose:** resolve repository policy, task intent, risk, evidence requirements, and human
authority into constraints for one run.

**Interface:**

```text
resolveEnvelope(repositoryPolicy, taskIntent, riskAssessment, ownerOverrides)
  -> qualityAndAuthorityEnvelope
```

The envelope states required outcomes and invariants. It may require approval, independent
verification, particular project evidence, or publication controls. It does not determine whether
the run uses Chapters, a review board, a prototype, or a particular sequence of agents.

### 4. Run continuity

**Purpose:** preserve the minimum state necessary to resume a domain run safely.

**Interface:**

```text
checkpoint(runId, graphRevision, decisions, artifacts, evidence, ownership, nextAction)
resume(runId) -> recoverableRunState
```

This module is optional. It is used for cross-session execution, human gates, material deviations,
coordinator replacement, and every domain run composed of more than one native workflow. It owns
versioning and validation of durable state. Ordinary subagent calls and a single same-session
workflow do not cross this seam. Results consumed by a later workflow are persisted as referenced
artifacts before the earlier workflow completes.

### 5. Orchestration analysis

**Purpose:** turn run evidence into testable workflow and routing improvements.

**Interface:**

```text
analyze(runDecisionLog, runtimeEvents, artifacts, verificationOutcome)
  -> improvementCandidates
```

Candidates include provenance, supporting evidence, applicability, expected benefit, validation
method, and invalidation conditions. A fresh `quality-run-observer` reviewer that did not author
the execution decision owns this analysis. No candidate becomes standing routing policy solely
because one run succeeded.

## Work plan

### Phase 1: Prove the native runtime seam

Establish that the Claudex proxy and installed Claude Code version support the intended workflow
interface before restructuring skills.

Deliverables:

- a runtime preflight command that verifies an explicitly validated Claude Code and CLIProxyAPI
  version pair whose Claude Code version is 2.1.154 or later;
- detection of whether dynamic workflows are enabled;
- verification that `CLAUDE_CODE_SUBAGENT_MODEL=inherit` is effective;
- a bounded workflow fixture using `agent()`, `pipeline()`, and a structured result schema;
- a stage-routing fixture that resolves one Claude-family and one GPT-family model through the
  proxy;
- a GPT-family coordinator fixture that authors, presents, launches, and synthesizes a native
  workflow through Claude Code;
- evidence for permission behavior, progress visibility, pause/resume, failure reporting, and
  fresh-session restart behavior;
- a safe-size formula derived from detected CPU capacity, configured concurrency guidance, task
  cardinality, per-agent token estimate, and current quota, with the observed inputs recorded for
  each fixture run.

Acceptance criteria:

- **Integration:** the fixture completes through Claudex and returns one structured aggregate;
- **Integration:** stage-level model selection is visible in run evidence;
- **Integration:** unavailable models fail explicitly rather than silently inheriting another
  model, or the pre-dispatch adapter refuses launch;
- **Integration:** completed work is reused after a same-session pause;
- **Integration:** a fresh session is correctly treated as a new workflow execution;
- **Behavioral:** both a Claude-family and GPT-family coordinator can author a valid workflow,
  present it for approval, launch it, and synthesize its structured result.

Runtime proof uses these failure branches:

| Failed capability | Supported adapter decision |
|---|---|
| GPT-family stage names cannot resolve dynamically | Keep model-specific custom-agent frontmatter for cross-family stages and drop removal of those static adapters |
| `CLAUDE_CODE_SUBAGENT_MODEL=inherit` does not preserve stage routing | Treat the coordinator launch model as the workflow-wide binding and use explicit custom-agent adapters for exceptions |
| The runtime silently substitutes an unavailable model | Add a pre-dispatch resolution check against the capability snapshot; do not launch when the requested binding cannot be proven |
| A GPT-family coordinator cannot author or launch a valid workflow | Exclude GPT-led Claudex from workflow-authoring scopes and retain a Claude-family coordinator profile for those scopes |
| Dynamic workflows are disabled or incompatible with the proxy | Use direct work, ordinary subagents, or teams; stop phases that depend on workflow execution |
| Permission or mutation behavior cannot satisfy the domain envelope | Refuse the workflow shape for mutable work and use a more controllable execution shape |

Every branch is written into the Phase 1 evidence before Phase 2 begins. Later deliverables are
resolved against that evidence rather than the optimistic path.

### Phase 2: Introduce the Claudex orchestration skill

Create `skills/claudex-orchestration/` as the single entry point for selecting native Claude Code
execution primitives.

The skill contains:

- task-shape selection guidance;
- the execution decision schema;
- workflow-authoring requirements;
- size and concurrency policy;
- evidence and result conventions;
- human-gate handling;
- a runtime preflight script;
- focused fixtures and tests.

The interface remains small: decide the execution shape, author the bounded workflow when chosen,
launch it through Claude Code, and return its structured result. Native workflow implementation
details stay in this module rather than being repeated in domain skills.

This skill is Claude-Code-only. It supports Claude- and GPT-led Claudex sessions running inside
Claude Code. `link.sh` does not install it as a plain Codex skill, and Codex-native compositions do
not invoke it.

Acceptance criteria:

- **Behavioral:** a short edit selects direct work;
- **Behavioral:** a serial debugging fixture rejects fan-out;
- **Behavioral:** a broad independent audit selects a workflow;
- **Behavioral:** a small number of sustained peers can select a team without forcing a workflow;
- **Deterministic:** every decision contains the selected shape, rejected adjacent shapes,
  pre-execution estimates, and preference reason;
- **Deterministic:** workflow generation includes stopping conditions and a bounded size
  recommendation;
- **Integration:** an approval-required mutation workflow is presented with phases, bounds,
  models, mutable scope, and raw script path, and can be refused without launching an agent.

### Phase 3: Deepen model orchestration into adaptive routing

Make `model-orchestration` the implementation of the model-routing interface.

Deliverables:

- a capability schema independent of exact model names;
- a runtime snapshot populated from configured models, proxy compatibility, quota, and
  availability;
- role-requirement vocabulary for judgment, comprehension, implementation, exploration,
  verification, and synthesis;
- independence rules based on authorship and provider family;
- explicit fallback and refusal behavior;
- a routing-decision record suitable for run analysis;
- presets expressed as optional input profiles rather than mandatory role tables.

Custom agent definitions remain only where they provide stable role behavior or restricted tools.
Their model binding is resolved at dispatch whenever the runtime supports it. A model-specific
adapter is justified only when the underlying runtime requires a static binding.

Acceptance criteria:

- **Deterministic:** domain skills can request a capability without naming a model;
- **Deterministic:** two different runtime snapshots can resolve the same role to different valid
  models;
- **Deterministic:** an independence requirement cannot resolve to the authoring model family
  unless explicitly waived and recorded;
- **Deterministic:** quota changes affect a later workflow's eligible bulk work without weakening
  required judgment or review; an active workflow retains its approved snapshot;
- **Deterministic:** routing output always contains a rationale and explicit unavailable state;
- **Integration:** the resolved stage binding in runtime evidence matches the approved frozen
  snapshot.

### Phase 4: Narrow continuity to the durable cases

Extract durable recovery behavior and cooperative workspace claim storage into
`skills/run-continuity/`. Claudex has no dispatch interceptor or filesystem enforcement hook. The
module validates registered claims and records ownership; the orchestration module must author
mutation workflows that honor those claims through one writer, disjoint output paths, or isolated
worktrees.

Deliverables:

- one versioned checkpoint interface for cross-session domain state;
- adapter hooks for Quality Run records and Atelier records;
- cooperative workspace claim validation for concurrent mutation;
- recovery checks for stale revisions, active processes, and unresolved external effects;
- tests for replacement coordinators and interrupted mutable work.

No checkpoint is generated for an ephemeral read-only agent or one same-session workflow solely to
satisfy orchestration ceremony. A domain run containing multiple workflows persists the aggregate
artifacts and graph state between them. Workspace leases are attached only to mutable or
process-owning dispatches.

Acceptance criteria:

- **Deterministic:** one same-session research workflow needs no additional durable record;
- **Deterministic:** a multi-workflow domain run persists every downstream input as an artifact;
- **Integration:** a human-gated run resumes from artifacts and decisions without conversation
  history;
- **Deterministic:** the cooperative lease store rejects overlapping registered claims;
- **Integration:** mutation workflow evidence identifies one writer, disjoint outputs, or isolated
  worktrees; this is protocol verification, not filesystem enforcement;
- **Deterministic:** read-only workers can register concurrent shared claims;
- **Integration:** a replacement coordinator receives one validated recovery snapshot and concrete
  next action.

### Phase 5: Express Quality Loop as a domain envelope

Keep Quality Loop's safety and quality properties while allowing the coordinator to construct a
run-specific graph.

The Quality Loop envelope requires:

- an approved authority and impact envelope before autonomous mutation;
- recorded material decisions and deviations;
- one authorized writer for each mutable workspace;
- repository-native verification evidence;
- independent scrutiny for material completion claims;
- human acceptance before external publication or deployment;
- analysis, compounding, retention, and cleanup at run completion.

The coordinator may select the appropriate planning artifact, decomposition, workflow phases,
review lenses, parallelism, and fresh-context points. Each selection and graph revision is recorded
with its rationale.

`claudex-quality-loop` becomes the Claude Code adapter for this envelope. It:

- resolves the lead binding for the fresh coordinator session;
- invokes `claudex-orchestration` for each bounded autonomous scope;
- invokes `model-orchestration` for stage bindings;
- records durable decisions and results in the Quality Run record;
- creates separate native workflows around human approval boundaries;
- exposes workflow scripts and result evidence to run analysis.

Acceptance criteria:

- **Behavioral:** a contained change selects one direct implementation and one independent
  verifier when that satisfies its envelope;
- **Behavioral:** a separable multi-part change generates a workflow with explicit single-writer
  stages;
- **Behavioral:** a high-risk change adds the specialist scrutiny required by its envelope;
- **Behavioral:** a task whose workflow estimate adds agents without increasing evidence coverage,
  isolation, or repeatability selects a smaller shape;
- **Deterministic:** the final completion claim references required primary evidence regardless of
  execution shape.

### Phase 6: Adapt the other Claudex compositions

Apply the same module interfaces without forcing the Quality Loop topology onto other skills.

For `claudex-grill-with-docs`:

- keep the coordinator-led, one-question-at-a-time human interaction;
- use a bounded advisor subagent or team when sustained deliberation is useful;
- use a workflow only for independent evidence gathering or a final bounded audit;
- persist accepted decisions in the domain documentation, not a generic agent transcript.

For research and audit compositions:

- prefer native workflow fan-out and structured claim verification;
- keep synthesis with one accountable coordinator;
- distinguish unverified claims from refuted claims;
- save workflows only after a run demonstrates repeatable value.

For routine implementation:

- default to direct work or one bounded implementer;
- introduce cross-family review according to risk and independence needs;
- avoid persistent collaborators when a fresh result is sufficient.

### Phase 7: Simplify installation and launch configuration

Update the repository installation interface so users install capabilities rather than a fixed
organization chart.

Deliverables:

- `link.sh` composition entries for `claudex-orchestration`, adaptive model routing, optional run
  continuity, and domain skills;
- launcher preflight for workflow support and effort-override compatibility;
- launch selection based on coordinator requirements and available capacity;
- capability-oriented bindings where stage routing is supported, while fixed baseline profiles
  remain installable through the pilot evidence gate;
- concise documentation for direct, subagent, team, and workflow operation.

The launcher chooses the coordinator model and effort for the immediate session. It does not bind
every later worker role. Domain run state records resolved bindings at dispatch time.

Acceptance criteria:

- installation reports every missing required capability;
- a launch never claims a model family participated without runtime evidence;
- changing available quota does not require rewriting domain skills;
- a saved workflow resolves its eligible stage models under the active runtime snapshot;
- the launcher remains usable for tasks that do not need a Quality Run.

Fixed baseline profiles are removed only after Phase 8 paired pilots show that adaptive routing
meets their quality and safety results. If the evidence does not clear that gate, they remain
supported adapters and the plan records the unresolved routing question.

### Phase 8: Add observability and compounding

Record enough evidence to evaluate orchestration without turning transcripts into permanent state.

Each evaluated run records:

- task and repository characteristics;
- selected execution shape and alternatives considered;
- generated workflow revision when applicable;
- model bindings and routing rationale;
- agent count, token use, elapsed time, retries, and failures;
- evidence completeness and verification outcome;
- human corrections and material deviations;
- the pre-execution estimate and rejected adjacent shapes;
- comparable baseline results when the run is part of a paired pilot.

A fresh `quality-run-observer` that did not author the execution decision compares the record with
its predicted alternatives and, for policy promotion, a paired representative slice. It emits
candidates such as:

- a task-shape selector adjustment;
- a model capability update;
- a reusable workflow candidate;
- a repository-specific evidence requirement;
- a concurrency or stopping-condition improvement.

Acceptance criteria:

- **Deterministic:** every policy change cites run artifacts, a baseline, an independent reviewer,
  and a validation method;
- **Deterministic:** one successful run cannot become a universal preset;
- **Evaluation:** routing and execution-shape quality are assessed separately from product
  correctness using agent count, tokens, wall time, retries, human corrections, evidence coverage,
  and verification outcome;
- **Evaluation:** a candidate advances only when it improves its declared primary metric without a
  safety or evidence regression on the paired slice;
- **Deterministic:** retained evidence excludes credentials and unnecessary raw conversation
  history.

### Phase 9: Transfer validated concepts into Pi Workbench

Use Claudex observations to refine the Pi workflow contract while preserving the Pi-only runtime
decision.

Transferable outputs include:

- execution-decision and role-requirement schemas;
- graph validation rules;
- stopping and saturation patterns;
- independence and adjudication rules;
- repository envelope examples;
- run-analysis metrics and improvement-candidate schemas;
- evidence about which workflow shapes succeed for different repository objectives.

Claude Code workflow JavaScript, custom-agent frontmatter, workflow progress storage, and launcher
environment variables remain Claudex adapters. Pi implements equivalent behavior through Pi
sessions, controller-mediated dispatch, the durable ledger, and its event stream.

Acceptance criteria:

- the Pi specification refers to capability and policy semantics rather than Claude Code tools;
- no Pi worker launches Claude Code, Codex, Claudex, or CLIProxyAPI;
- the same domain envelope can be represented in both runtimes through different adapters;
- every proposed transfer includes a portability record with the claim, causal runtime mechanisms,
  required assumptions, Pi equivalents, counterfactual risks, and validation method;
- a claim is marked `runtime-specific`, `portable-candidate`, or `portable-validated`;
- only `portable-validated` claims enter the supported Pi contract.

## Repository change map

| Area | Intended responsibility |
|---|---|
| `skills/claudex-orchestration/` | Execution-shape selection and native workflow policy |
| `skills/model-orchestration/` | Capability-based model routing and routing evidence |
| `skills/run-continuity/` | Optional cross-session checkpoint and recovery interface |
| `skills/agent-orchestration/` | Its continuity and cooperative lease behavior is absorbed by `run-continuity`; its execution guidance is absorbed by `claudex-orchestration`; remove after all callers move |
| `skills/quota-axi/` | Remains the quota-data adapter consumed by model routing; it does not own role selection |
| `skills/quality-loop/` | Quality and authority envelope plus durable Quality Run semantics |
| `skills/claudex-quality-loop/` | Claude Code adapter for the Quality Loop envelope |
| `skills/claudex-grill-with-docs/` | Claude Code adapter for interactive documented deliberation |
| `skills/quality-run-observer/` | Runtime and orchestration evidence collection |
| Claude custom-agent `.md` files | Stable role and tool adapters; static model adapters remain only when Phase 1 proves dispatch-time routing unavailable |
| Codex custom-agent `.toml` files | Codex-native adapters, outside Claude Code workflow execution |
| `claudex.sh` | Coordinator launch and runtime preflight |
| `link.sh` | Capability-oriented installation with runtime-specific skill and agent targets |
| `docs/claudex-orchestration.md` | Supported Claudex architecture |
| `docs/pi-workbench/` | Pi-only product contract and decisions |

The `claudex-quality-loop` installation resolves runtime targets explicitly:

| Capability | Claude Code / Claudex target | Plain Codex target |
|---|---|---|
| Claudex orchestration | Install | Do not install |
| Model routing | Install Claude Code adapter and eligible role agents | Install Codex routing adapter and TOML agents |
| Quota data | Install when automatic capacity routing is enabled | Install only when consumed by the Codex adapter |
| Run continuity | Install for durable domain compositions | Install the runtime-neutral checkpoint interface when used |
| Quality Loop envelope | Install | Install for Codex-native compositions |
| Claudex Quality Loop adapter | Install | Do not install |
| Atelier | Install when the domain composition exposes Atelier surfaces | Install only when its Codex interaction path is supported |

Once every caller uses the new module interfaces, remove superseded role tables, universal
handoff requirements, and fixed profile bindings whose evidence gates have cleared. Replace tests
at those shallow interfaces with tests through orchestration, routing, continuity, and
domain-envelope interfaces.

## Validation protocol

Acceptance criteria use four evidence classes:

- **Deterministic:** schema, script, state-transition, installation, or static documentation checks.
  Every run must pass.
- **Integration:** observed behavior of Claude Code, CLIProxyAPI, tools, permissions, or recovery.
  Every validated runtime-version pair must pass the fixture suite.
- **Behavioral:** model judgment such as execution-shape selection or workflow authorship. Run
  three independent trials for each fixture and coordinator family. At least two must make the
  expected decision, all three must satisfy safety and authority invariants, and disagreements are
  retained for independent analysis.
- **Evaluation:** a comparative claim from paired representative slices. Declare the primary
  metric and safety floors before execution; do not promote the claim when evidence or correctness
  regresses.

Re-run affected integration and behavioral fixtures when any of these changes:

- Claude Code version;
- CLIProxyAPI version or model mapping;
- coordinator or routed model version;
- workflow authoring instructions;
- routing capability schema or quota adapter;
- permission, sandbox, or concurrency configuration.

Validation evidence is keyed by repository revision, runtime-version pair, model bindings, and
fixture revision. A passing result under one tuple does not validate another.

## Validation matrix

The implementation is complete only after these scenarios pass with retained evidence.

| Scenario | Expected shape | Required proof |
|---|---|---|
| One-file reversible edit | Direct or one subagent | Targeted test and bounded diff |
| Serial intermittent bug | Direct coordinator work | Reproduction chain and verified fix |
| Repository-wide read-only audit | Dynamic workflow | Bounded fan-out, deduplication, independent claim verification |
| Multi-file mechanical migration | Dynamic workflow with isolated mutation | Collision-free outputs and aggregate verification |
| Architecture decision with several viable options | Team or bounded workflow | Independent options, evidence-linked trade-offs, accountable synthesis |
| Human-led design grill | Coordinator plus bounded advisor | One coherent question stream and durable accepted decisions |
| Low-risk Quality Run | Minimal adaptive graph | Authority envelope, repository evidence, independent completion check |
| High-risk Quality Run | Risk-expanded adaptive graph | Material approval, relevant specialist scrutiny, verified findings |
| Same-session workflow interruption | Workflow resume | Completed results reused and interrupted work restarted safely |
| Coordinator replacement | Run continuity | Recovery from durable state without transcript reconstruction |
| Provider capacity change | Alternate valid model route | Recorded capability match and unchanged quality requirement |
| Missing required model capability | Explicit refusal or approved route change | No silent model substitution |

## Delivery order and gates

Implementation follows this dependency order:

1. Prove native workflow and proxy behavior.
2. Establish the orchestration and routing interfaces.
3. Validate those interfaces on standalone fixtures.
4. Introduce optional run continuity.
5. Adapt Quality Loop and grilling compositions.
6. Simplify installation, launch configuration, and documentation.
7. Run representative Claudex pilots and analyze their outcomes.
8. Promote validated policy semantics into the Pi Workbench contract.
9. Remove superseded modules only after their callers and tests have moved to the intended
   interfaces.

Each phase requires:

- executable tests for deterministic rules;
- a bounded live run for model and workflow behavior;
- retained primary evidence;
- updated intended-state documentation;
- explicit disposition of observed failures before the next dependent phase.

## Risks and controls

### Workflows become the default for everything

Control: require an execution-shape decision with a cost and context rationale. Test direct and
serial cases explicitly.

### Dynamic scripts create unsafe fan-out

Control: apply size guidance, concurrency caps, bounded inputs, stopping conditions, and a pilot
slice before large execution.

### Claude Code or proxy behavior changes

Control: validate and record the Claude Code and CLIProxyAPI version pair, rerun Phase 1 and every
affected behavioral fixture on version or model-mapping changes, and refuse capabilities whose
runtime tuple has not passed its required fixture. Routing observations are scoped to that tuple.

### Model routing remains fixed under new terminology

Control: test the same role against multiple runtime snapshots and require dispatch-time rationale.

### Cross-family review is treated as proof by itself

Control: require primary evidence and finding verification. Provider diversity supplies
independence, not correctness.

### The coordinator validates its own orchestration choice

Control: record adjacent alternatives and predicted costs before execution. A fresh
`quality-run-observer` reviews paired pilot evidence and owns improvement candidates.

### Domain skills lose necessary safety while becoming adaptive

Control: express safety, authority, and evidence as graph invariants validated independently from
the chosen sequence.

### Durable state duplicates native workflow storage

Control: cross the continuity seam only for session boundaries, human gates, coordinator
replacement, multi-workflow domain runs, or unreconciled mutable effects.

### Cooperative leases are mistaken for filesystem enforcement

Control: describe Claudex claims as cooperative, verify claim-store conflicts deterministically,
and require mutation workflows to prove one-writer sequencing, disjoint outputs, or worktree
isolation. Reserve controller-enforced dispatch claims for Pi.

### Claudex implementation leaks into Pi Workbench

Control: transfer schemas, policies, and evidence only. Keep runtime adapters and environment
configuration out of the Pi contract.

## Non-goals

- Reimplementing Claude Code's workflow scheduler or progress interface.
- Guaranteeing Claude Code workflow recovery after the Claude Code session exits.
- Making every task multi-agent.
- Pinning a universally strongest model to each role.
- Treating a provider-family difference as sufficient verification.
- Making Quality Loop the universal Claudex workflow.
- Making Pi Workbench execute Claude Code or Claudex workflows.
- Persisting complete agent transcripts as authoritative run state.

## Completion criteria

The plan is complete when:

- Claudex has one documented and tested execution-shape interface;
- model selection is capability-based and observable at dispatch;
- native workflows handle scalable execution without duplicative orchestration machinery;
- domain skills constrain outcomes, evidence, safety, and authority rather than universal topology;
- durable continuity is optional and tested at its actual seam;
- Quality Loop and grilling demonstrate different valid compositions;
- representative runs produce independently reviewed improvement candidates with baselines,
  evidence, validation methods, and invalidation conditions;
- Pi Workbench incorporates validated semantics without depending on the Claudex runtime;
- repository documentation describes one coherent supported Claudex architecture.
