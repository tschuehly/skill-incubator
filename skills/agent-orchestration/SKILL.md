---
name: agent-orchestration
description: >-
  Coordinate a lead agent, a persistent specialist or adapter, and a durable shared-state
  surface while keeping the lead thread thin. Use when work spans multiple feedback rounds,
  must survive compaction or session boundaries, or combines an agent-owned task with a
  delegated surface, reviewer, researcher, or advisor. Defines agent interaction and
  continuity; pair with the active runtime's model-orchestration capability for model selection and atelier for review surfaces.
---

# Agent Orchestration

Separate semantic ownership, delegated execution, and durable state. Keep one lead agent
responsible for the user's task. Give every collaborator a bounded, non-overlapping role and an
explicit lifecycle: persistent, fresh per artifact, or disposable.

## Interaction protocol

1. **Assign ownership.** The lead owns the user's intent, decisions, and final synthesis. Give
   each collaborator one bounded responsibility such as surface construction, research,
   implementation, or adversarial advice. Ownership is complete when every intended collaborator
   has one non-overlapping responsibility and the lead retains final synthesis.
2. **Route every role.** Use the composing skill's validated fixed binding contract when it owns
   one; otherwise use the active runtime's model-orchestration capability with each collaborator's
   cognitive role, task risk, bounded scope, and artifact author family where review independence
   matters. Continue only after every collaborator has a complete binding and quota evidence.
   Preserve them unchanged. Pi Workbench owns the supported dynamic model-orchestration skill;
   this incubator does not provide a second copy.
3. **Hand off a validated minimal contract.** Generate a `handoff` template with
   `<skill-dir>/scripts/contract.mjs template handoff`, fill it, and run
   `<skill-dir>/scripts/contract.mjs validate <contract.json>`. Spawn or continue the
   collaborator only after `CONTRACT=PASS`. Let the collaborator inspect task-local sources.
   Supply the bounded contract and task-local sources rather than the full conversation or details
   the collaborator owns.
4. **Apply the declared lifecycle.** Use `persistent` for a comprehension auditor or a decision
   challenger that owns opening and closing checkpoints of the same decision. Use
   `fresh-per-artifact` for an independent reviewer and set its key to the artifact revision. Use
   `disposable` for one-shot exploration or execution unless follow-up fixes remain inside the same
   implementation brief. Continue persistent instances with compact semantic deltas; never reuse a
   reviewer merely because the process is still available.
5. **Persist shared state.** Record proposals, decisions, work state, evidence anchors, and an
   ordered event history on the durable surface or task store. Treat that record as the source
   of truth; chat and agent memory are working context only.
6. **Keep the lead thread thin.** Push bulk reads, construction, and repeated verification to
   the role that owns them. Bring back manifests, decisions, blockers, and concise evidence,
   then synthesize them in the lead thread.
7. **Present one human-facing voice.** Advisors and specialists feed the lead. The lead resolves
   conflicts and presents one coherent question or recommendation stream to the human.
8. **Close the loop.** Let the lead interpret human feedback and own the resulting decisions.
   Send only the bounded execution or presentation delta to the responsible collaborator,
   update durable state, verify the result, and return it to the same feedback surface.

## Workspace and process leases

Every handoff and checkpoint carries a validated `workspaceLease`:

- `none` for roles with no filesystem access, `shared-read` for read-only collaborators, and
  `exclusive` for any role that writes files or mutable build/generated outputs;
- `path`, `owner`, and `mutableOutputs` identify the exact collision boundary; outputs may be
  relative to the workspace or explicit absolute paths for shared external caches;
- `activeProcess` is `null` or records the PID, command, output path, and owner of one running
  process.

Acquire the validated handoff before dispatch:

```sh
<skill-dir>/scripts/workspace-lease.mjs acquire <durable-lease-store.json> <handoff.json>
```

The atomic store rejects overlapping shared/exclusive claims and duplicate lease ids. Record a
running command with `workspace-lease.mjs checkpoint <store> <checkpoint.json>`. Release with
`workspace-lease.mjs release <store> <lease-id> <owner>` only after `activeProcess` is null.

An exclusive lease covers processes as well as source edits. The lead and other collaborators do
not run commands that touch its mutable outputs. Use an isolated worktree for parallel verification.
Before transferring a workspace, wait for its active process to finish or checkpoint it and keep the
successor out of that workspace until the process is reconciled. Never create a second watcher for
the same process.

## Continuity

Agent processes are persistent only within the active task. After every feedback wave, and
before a known context or session boundary, ensure the durable record contains the current
brief, open work, decisions, stable keys, evidence anchors, event cursor, lifecycle, model binding,
raw-quota snapshot, and workspace lease.

Write that boundary as a `checkpoint` contract generated by
`<skill-dir>/scripts/contract.mjs template checkpoint`. Validation must emit `CONTRACT=PASS`
before claiming the task can resume from durable state. An empty `openWork` array is valid;
missing artifact paths, cursor, revision, or next action is not.

Resume by reconnecting, not rebuilding:

1. Read the durable record and health-check the shared surface.
2. Verify the current files and the selected durable surface's connection contract.
3. Continue an exposed collaborator only when its lifecycle is `persistent`. Otherwise spawn the
   required fresh or replacement instance with the same role contract and durable-state pointer.
4. Reconcile open work from the event cursor before accepting new changes.

Never claim that an agent process survives a session boundary. Durable state provides
continuity; a replacement agent may provide the role.

When a durable surface uses a singleton poller, give each active surface a distinct poller
identity. A singleton guard keyed only by script path can terminate a different surface's
poller even when ports and stores differ. Follow the surface skill's supported poller and
cursor mechanics; never improvise an untracked background process. With multiple surfaces,
assign each decision or work unit one authoritative record and persist the surface-to-record
mapping.

## Composition boundaries

- Use `/atelier` when the human needs a task-shaped HTML interaction surface. Follow its copied
  kernel, stable-key, protocol, and supported poller contracts; do not duplicate its API or
  client mechanics here.
- Keep domain semantics in the composing skill. Interview cadence, review criteria,
  ratification rules, and completion gates do not belong in this base protocol.
