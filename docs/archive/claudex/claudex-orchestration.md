> **Archived experiment.** Claudex support has been retired. Paths, commands, and runtime claims below are historical evidence, not supported instructions.

# Claudex Orchestration

> **Status:** Intended architecture under incubation. The implementation sequence and evidence
> gates are tracked in
> [claudex-orchestration-plan.md](claudex-orchestration-plan.md). Capabilities are supported only
> after their plan gate has recorded a passing runtime fixture.

Claudex combines Claude Code's native execution primitives with model routing across the Claude
and GPT families. Claude Code remains the orchestration runtime. Claudex supplies routing policy,
quality and authority constraints, and durable run state where work must cross session boundaries.

The design keeps four responsibilities separate:

1. The coordinator interprets human intent and remains accountable for the result.
2. A generated workflow organizes bounded work for the current task.
3. The model router selects a suitable model for each cognitive job.
4. A domain run record preserves decisions, evidence, and recovery state when required.

## Orchestration principles

- Choose the execution shape from the task, repository policy, risk, and available evidence.
- Keep one coordinator responsible for human-facing decisions and final synthesis.
- Delegate bounded outcomes with explicit inputs, permissions, and observable completion.
- Use independent scrutiny for material claims and consequential changes.
- Require primary evidence for completion, verification, and review findings.
- Keep model selection independent from workflow semantics.
- Persist decision-relevant state; allow replaceable mechanical chatter to remain ephemeral.
- Introduce concurrency control only when agents can collide over files, generated outputs, or
  processes.
- Use one agent when delegation would only fragment a serial chain of reasoning.

## Execution shapes

The coordinator selects the smallest execution shape that fits the task.

| Shape | Use when | Plan owner | Intermediate results |
|---|---|---|---|
| Direct work | The task is short or serial | Coordinator | Coordinator context |
| Subagent delegation | A few bounded tasks can be delegated | Coordinator, turn by turn | Coordinator context |
| Agent team | A handful of peers need sustained coordination | Lead agent | Shared team tasks |
| Dynamic workflow | Work requires scalable fan-out, loops, branching, or repeatability | Workflow script | Workflow variables |

Dynamic workflows are the default scalable execution primitive. They are JavaScript programs
generated for the task and executed by Claude Code in an isolated runtime. The script coordinates
agents; agents perform filesystem, shell, web, and MCP operations under the session's permission
policy.

Use a dynamic workflow when:

- the same operation applies to many files, components, or sources;
- independent candidates or findings need comparison and adjudication;
- work must repeat until a check passes or progress stops;
- intermediate results would overload the coordinator context;
- the orchestration itself should be inspected, rerun, or saved for reuse.

Do not generate a workflow merely because a task is substantive. A workflow consumes additional
tokens and creates coordination overhead. Start with a representative slice before approving a
large fan-out.

## Dynamic workflow contract

A generated workflow defines:

- its outcome and bounded input set;
- phases, dependencies, branches, loops, and stopping conditions;
- agent prompts and structured result schemas;
- concurrency and size limits;
- model selection for stages that require an explicit route;
- aggregation, verification, and adjudication behavior;
- the artifacts and evidence returned to the coordinator.

The workflow uses `agent()` for one bounded task and `pipeline()` for data-parallel work. It returns
one structured result to the coordinator instead of forwarding every intermediate result into the
conversation.

Workflow launch respects the resolved domain authority envelope. Before a workflow that requires
approval runs, the coordinator presents its phases, bounded inputs, model and size budget, mutable
scope, and raw script path so the human can inspect, revise, approve, or refuse it. Pre-authorized
work may launch without another prompt only inside the recorded envelope. Permissions, tool
allowlists, and sandboxing remain owned by Claude Code.

Claude Code workflows do not accept ordinary human input while running. A process that needs human
approval between stages uses a separate workflow for each autonomously executable stage.

## Model routing

Models are selected per cognitive job using runtime evidence rather than a permanent organization
chart. The router considers:

- reasoning and coding capability required by the task;
- breadth of context and volume of source material;
- need for continuity or a fresh independent perspective;
- provider-family independence from the author;
- latency, cost, quota, and current availability;
- tool, effort, and proxy compatibility.

The selected model and routing rationale are recorded with the dispatch. Routing presets may offer
useful defaults, but the coordinator may choose a different route when the task evidence supports
it.

Every workflow agent inherits the session model unless its stage selects another model. Claudex
sets `CLAUDE_CODE_SUBAGENT_MODEL=inherit`; a global subagent override would suppress stage-level
routing. A workflow captures one capability and quota snapshot at approval and freezes its model
bindings for that run. A later workflow receives a fresh snapshot. Exhausted capacity fails the
affected dispatch explicitly; a running workflow does not silently change model families.

The following are routing heuristics, not fixed bindings:

- Use a broad-context model for large source inventories and system comprehension.
- Use a capable, cost-effective coding model for well-specified implementation.
- Use a strong judgment model for unresolved architecture and consequential synthesis.
- Prefer a different model family for independent review when the expected benefit justifies the
  added cost.
- Give bounded specialists distilled evidence rather than unfiltered repository context.

## Coordinator and worker lifecycle

The coordinator owns:

- the user's outcome and approved authority envelope;
- selection of the execution shape;
- workflow approval and launch;
- material decisions and human questions;
- interpretation of worker results;
- final synthesis and delivery status.

A worker or workflow agent owns one semantic outcome. Its dispatch identifies:

- role and purpose;
- inputs and evidence anchors;
- permissions and workspace scope;
- expected structured result;
- completion conditions;
- model and routing rationale;
- lifecycle: ephemeral, resumable, or persistent.

Ephemeral agents are preferred for bounded investigation, review, and verification. Continuity is
used only when a role must accumulate context across multiple exchanges. A replacement agent can
reconstruct a role from durable artifacts; agent process identity is not durable state.

## Durable state and recovery

Native workflow progress is resumable within the active Claude Code session. Completed agent
results can be reused when a paused workflow resumes. A new Claude Code session starts the workflow
again.

A domain workflow therefore keeps a durable run record when it must survive session boundaries,
human gates, coordinator replacement, or more than one native workflow. Results required by a
later workflow are written as referenced artifacts before the earlier workflow is considered
complete. The record contains only state needed to understand and continue the run:

- approved outcome and authority envelope;
- current execution-graph revision and node states;
- decisions, assumptions, deviations, and pending authority;
- artifact and primary-evidence references;
- validation and review results;
- active workspace ownership where mutation is in progress;
- the next recoverable action.

The domain workflow owns this schema. A short research workflow does not need a Quality Run ledger,
and a Quality Run does not rely on chat history as its source of truth.

## Workspace safety

Read-only agents can share a workspace. Mutating agents receive non-overlapping ownership through
one of these mechanisms:

- one writer at a time in the active workspace;
- disjoint explicit output paths;
- isolated worktrees or copies for parallel mutations.

A cooperative lease is required only when mutable work or processes can overlap. It identifies the
owner, workspace, mutable outputs, and any active process that prevents transfer. The Claudex lease
store rejects conflicting registered claims, but it cannot intercept an agent that ignores the
protocol. Workflow mutation stages must therefore use one writer, disjoint output paths, or
isolated worktrees, and the returned evidence must show which mechanism was used. The Pi runtime
enforces its own dispatch and workspace policy through the Pi controller.

## Domain workflow composition

Domain skills define quality and authority envelopes rather than universal agent sequences. They
may require:

- approval before a specified impact level;
- particular evidence for repository-specific behavior;
- independent verification of material completion claims;
- security review when relevant risk is detected;
- durable decisions and deviations;
- acceptance before publication or deployment.

For each run, the coordinator translates that envelope into a task-specific execution graph. The
Claudex coordinator applies deterministic helper checks for graph shape, registered workspace
claims, budgets, and output schemas; Claude Code enforces its permissions and sandbox. These checks
do not decide the semantic work sequence and do not claim Pi-style dispatch interception.

A long-running domain process alternates between coordinator decisions and bounded native
workflows:

```text
human intent or feedback
        |
        v
coordinator proposes the next bounded graph
        |
        v
human approval when authority is required
        |
        v
native workflow executes autonomous work
        |
        v
artifacts and evidence update the durable run record
        |
        v
coordinator synthesizes status and selects the next action
```

## Claudex capability boundaries

Claudex provides:

- access to models from multiple provider families;
- a capability and availability view used for routing;
- routing guidance and optional presets;
- skills that define domain quality and authority envelopes;
- durable domain records for cross-session processes;
- analysis of execution and routing outcomes.

Claude Code provides:

- coordinator sessions and subagents;
- agent teams and dynamic workflow execution;
- workflow progress, pause, restart, and same-session resumption;
- permissions, tool allowlists, and sandboxing;
- workflow inspection and reusable saved commands.

The supported workflow runtime requires Claude Code 2.1.154 or later. Models selected for workflow
stages must resolve through the configured Claudex proxy. Support is recorded for a tested Claude
Code and proxy version pair and revalidated when either version changes.

`claudex-orchestration` applies only to Claudex sessions running through Claude Code. A GPT-family
model may lead such a session and must be able to author and launch the same native workflows. The
plain Codex CLI is a separate runtime adapter: it uses Codex-native delegation and does not claim
support for Claude Code's Workflow tool, `agent()`, `pipeline()`, or workflow resumption. See the
[Claude Code dynamic workflow documentation](https://code.claude.com/docs/en/workflows) for the
runtime API, controls, permissions, and limits.
