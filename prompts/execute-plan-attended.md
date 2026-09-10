---
description: Execute a plan one phase at a time; present evidence and wait for explicit approval between phases
argument-hint: "<plan-path> [scope or constraints]"
---
Execute the plan with the human, one approved phase at a time.

Invocation arguments: `$ARGUMENTS`

The plan governs work and acceptance; this prompt governs phase transitions and compaction cadence. Existing repository authority remains in force.

## Prepare

1. Resolve the first existing Markdown plan in the arguments, accepting an optional leading `@` or verb such as `Execute`. Treat the rest as constraints. Ask for the path when resolution is ambiguous.
2. Read the plan, repository instructions, and authority they reference. Confirm the requested outcome still applies to current repository state.
3. Divide the plan into phases. A phase is done when one reviewable outcome is committed and its acceptance evidence passes. Split independent outcomes before implementation.
4. State the first phase and its acceptance evidence. The invocation authorizes that phase only.

## Execute one phase

1. Work only on the authorized phase, making routine, reversible decisions within its scope.
2. When the phase grows into independent outcomes, stop at the next coherent boundary and propose revised phases.
3. Run the relevant acceptance checks and fix failures within the phase's authority.
4. After the checks pass, commit the outcome and any plan-status update together. At `FAIL` or `BLOCKED`, preserve safe work without marking the phase done.

Pause earlier when continuation requires new authority, an irreversible or destructive action, unavailable credentials, or resolution of material ambiguity.

## Judgment gate

Present:

- **Outcome:** phase goal and `PASS`, `FAIL`, or `BLOCKED`.
- **Commit:** SHA and changed files, or `none` with the current working-tree state.
- **Inspect:** one to three useful paths, URLs, or commands.
- **Verification:** exact checks and results, including anything unverified.
- **Judgment:** material deviations, limitations, risks, and discarded alternatives.
- **Decision:** name the next phase and request one response:
  - `approve and proceed` accepts this phase and authorizes that phase;
  - `approve and stop` accepts this phase without authorizing more work;
  - corrections, plan revision, or rejection.

Then wait. A bare `approve` accepts the completed phase without authorizing the next one. Record scope changes in the plan before revised work begins.

## Continue

After `approve and proceed`, recheck repository state and the approved commit, execute only the named phase, and return to the judgment gate.

Use `compact_and_continue` only after `approve and proceed`, at an approved boundary where substantial old context can be discarded or context pressure warrants it. After continuation, recheck repository state and direct evidence because the summary is lossy.

When the plan ends, report the final outcome, phase commits and approvals, unverified areas, and any compaction or recovery work.
