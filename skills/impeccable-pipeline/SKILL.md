---
name: impeccable-pipeline
description: Run the verified seven-command Impeccable improvement sequence on one target.
disable-model-invocation: true
---

# Impeccable Pipeline

Run seven actual Impeccable command playbooks, one after another:

```text
critique → distill → clarify → adapt → harden → polish → audit
```

The pipeline is the command sequence. Delegation, browser checks, screenshots, and reports support
the commands; they never replace them.

## Prepare

1. Resolve the Impeccable skill root: prefer the target repository's
   `.agents/skills/impeccable/`, then `~/.agents/skills/impeccable/`, then
   `~/.claude/skills/impeccable/`.
2. Read its `SKILL.md` completely.
3. Run its context script once for the exact target. Keep the working directory at the target
   repository and follow the resulting directives.
4. Pin the target path or URL, repository state, baseline, permitted side effects, and required
   checks. Preserve one candidate through the entire sequence.
5. Inspect the incumbent design authority and representative live state before the first command.

Preparation is complete when the target, baseline, candidate, design authority, and verification
route are explicit.

## Execute

Treat every stage as a separate `/impeccable <command> <target>` execution:

1. Read only the current command's `reference/<command>.md` from the resolved Impeccable skill.
2. Give the stage a fresh bounded owner when delegation is available. Its assignment names the
   command, target, current candidate, prior-stage evidence, repository constraints, and checks.
   Keep later commands out of that assignment.
3. Follow the command reference completely. Merely mentioning the command or approximating its
   intent does not complete the stage.
4. Reconcile the result into the single candidate. Keep one writer at a time.
5. Run the smallest checks that prove the stage's changes and record the exact diff or SHA.
6. Advance only when the stage's completion criterion below is met.

Do not commit, publish, mutate production data, or cross a human approval boundary unless the
invocation grants that authority.

### 1. Critique

Run `critique` as a read-only evaluation. Follow its independent assessment structure, detector
rules, browser inspection, scoring, and critique-storage requirements.

Complete when the persisted critique reconciles the required assessments into prioritized,
evidence-backed findings. Product-direction questions that change the accepted concept stop here
for a human decision; ordinary findings continue into Distill.

### 2. Distill

Run `distill` against the critique and current candidate. Remove redundancy, interaction
complexity, duplicate status, and unnecessary chrome while preserving required capability,
truthful warnings, and recovery actions.

Complete when the accepted simplifications are implemented and behavior checks prove no required
information or action was lost.

### 3. Clarify

Run `clarify` on all changed visible states. Improve labels, instructions, confirmations, errors,
status language, and action naming without changing product truth.

Complete when each affected state says what happened and what the user can do next, with focused
copy or behavior checks passing.

### 4. Adapt

Run `adapt` for the target devices and usage contexts. Verify responsive reflow, touch targets,
long content, short viewports, input sizing, scroll ownership, and containment using measured
browser evidence.

Complete when the agreed viewport matrix has no unreachable controls, unintended horizontal
overflow, or content outside its owning surface.

### 5. Harden

Run `harden` against realistic failure and edge conditions: invalid or extreme input, empty and
error states, keyboard and focus behavior, stale or concurrent actions, permissions, network
failures, and internationalized content where applicable.

Complete when consequential branches have runnable regression checks and the interface remains
truthful and recoverable under the tested adverse states.

### 6. Polish

Run `polish` only after the target is functionally complete. Align it with the incumbent design
system and inspect hierarchy, spacing, typography, contrast, focus, interaction states, motion,
and visual balance in the real interface.

Complete when the bounded visual inspection and confirmation pass find no material regression and
all polish changes have matching checks.

### 7. Audit

Run `audit` read-only on the exact final candidate. Perform the command's technical checks and
produce its scored report. Screenshots support visual claims; DOM, source, traces, and tests prove
behavioral claims.

Complete when the audit report names its candidate identity, evidence, score, findings, and scope
limits.

If Audit finds a material pipeline-introduced defect, return only to the command that owns the
defect, correct it, and rerun Audit once. Record unresolved baseline or out-of-scope findings
honestly instead of expanding scope. End blocked if a material defect remains.

## Whole-surface targets

For a multi-page product, Critique or Audit may fan out one read-only inspection per surface plus
one shell/navigation inspection. The command owner reconciles every result before the pipeline
continues. Missing or degraded inspections remain visible.

Implementation commands remain sequential on one candidate. Parallel proposals may inform a
stage; parallel writers may not edit shared files.

## Finish

Return a compact stage ledger containing:

- target and baseline;
- each command's owner, result, evidence path, checks, and candidate identity;
- final Audit score and material findings;
- unresolved product or platform limits;
- the next authorized action.

The pipeline is complete only when all seven command references were executed in order and Audit
passes the agreed materiality threshold on the recorded final candidate.
