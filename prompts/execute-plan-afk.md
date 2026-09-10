---
description: Execute a plan end-to-end without routine check-ins; stop at authority, safety, credential, or material-ambiguity blockers
argument-hint: "<plan-path> [scope or constraints]"
---
Execute the plan end-to-end in one ordinary Pi session.

Invocation arguments: `$ARGUMENTS`

The plan establishes the intended outcome, acceptance basis, constraints, and initial strategy; this prompt governs adaptive execution and compaction cadence. Treat the strategy and phase sequence as hypotheses, not authority to persist after evidence disproves them. Existing repository authority remains in force.

## Prepare

1. Resolve the first existing Markdown plan in the arguments, accepting an optional leading `@` or verb such as `Execute`. Treat the rest as constraints. Ask for the path when resolution is ambiguous.
2. Read the plan, repository instructions, and authority they reference. Confirm the requested outcome still applies to current repository state.
3. Identify consequential assumptions and the cheapest evidence that could falsify the proposed direction before expensive implementation.
4. Divide the plan into phases. A phase is done when one reviewable outcome is committed and its acceptance evidence passes. Split independent outcomes before implementation.

## Execute

For each phase:

1. Run the cheapest useful probe before expensive implementation when it can falsify the current direction.
2. Compare direct evidence with the plan's assumptions and expected outcome. When evidence invalidates the route, stop investing in it and replan the remaining phases while preserving the intended outcome, acceptance basis, constraints, and authority.
3. Work through routine, reversible decisions inside that boundary without human check-ins.
4. When the phase grows into independent outcomes, finish the next coherent unit and revise the remaining phases.
5. Run the relevant acceptance checks and fix failures until they pass or become a human blocker.
6. After the checks pass, commit the outcome, evidence, and any plan revision or status update together.
7. Choose review depth from the actual risk:
    - A reversible local phase with deterministic acceptance checks may checkpoint without a fresh reviewer.
    - Consequential architecture, authentication/security, data or catalog migration, materially weak or judgment-only acceptance, and irreversible high-impact external effects require one fresh Independent Phase Judge (`reviewer`, `independent-review`). Final success uses this review only when the completed outcome contains one of those risks or the plan requires it.
    - Add a Direction Judge (`reviewer`, `design`) only when the plan explicitly requires two reviews, the first judge exposes material uncertainty, reviewers disagree, or critical impact needs challenge.
8. Give each required reviewer the stable commit, acceptance basis, direct checks, deviations, proposed next phase, and Primary Evidence. Reconcile `continue | replan | stop | escalate` conservatively. Probe disagreements before adding more work; `stop` or `escalate` requires Human Attention.
9. Reviewer unavailability is not a verdict. Record it and continue reversible local work. Before an external/irreversible action or final success, preserve the phase and recover the missing review:
    - Any adapter `launch_failed` is certified pre-prompt and may retry once. Preserve an unchanged successful peer result and retry only the missing review.
    - A confirmed `timed_out` read-only reviewer may retry once only after exact HEAD, worktree, and authority-bound external evidence are unchanged. Never auto-retry `outcome_unknown`.
    - On repeated recoverable failure, call `goal_wait` alone with the exact Goal id and an explicit `resume_after_ms` at the next meaningful recovery or deadline wake. Use minutes rather than polling; never omit `resume_after_ms` in an unattended run, and do not invent a cutoff absent from the plan.
    - If evidence changes while waiting, discard retained review and repeat the required review set.
    - At the terminal cutoff, finalize `attention` with committed evidence. Use `goal_blocked` only when direct evidence proves human-only action is required; telemetry warnings alone are insufficient.

Pause for the human when replanning would change the intended outcome, acceptance basis, approved impact, authority, or material risk, or when continuation requires an irreversible or destructive action, unavailable credentials, or resolution of material ambiguity. State the evidence, required review, proposed pivot, and decision needed.

## Compact

After each phase is committed, verified, and reviewed when its risk requires it, call `compact_and_continue` alone at the boundary with one next phase; do not start that phase in the same turn. After continuation, recheck repository state and direct evidence because the summary is lossy.

## Finish

Audit every requirement against current files and direct checks, then report the outcome, phase commits, acceptance evidence, unverified areas, material deviations and risks, exact blockers, and any compaction or recovery work. Call `goal_complete` with the exact current Goal id only after that audit passes.

There is no managed run, terminal receipt, or checkpoint gate behind this prompt. Pausing is an explicit human `/goal pause`.
