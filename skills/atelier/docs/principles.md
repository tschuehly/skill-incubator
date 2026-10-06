# Atelier principles

Status: owner-approved product principles. They govern future Atelier changes; the current public
workflow remains authoritative until each mismatch is deliberately repaired.

Atelier is a temporary human–agent communication tool. Keep browser-driven evaluation, repair-loop
analysis, and compounding outside normal Atelier use.

## 1. The human's job shapes the Surface

Organize the Surface around what the human must understand, compare, decide, or correct—not around
the transcript, implementation ledger, agent topology, protocol, or work scheduler.

- Give each judgment an address and the context needed to make it.
- Match the interaction to the job: visual inspection, interaction, state transition, source
  evidence, or an automated check are different review methods.
- Keep agent coordination invisible unless the human's task requires it.

## 2. The first handoff stands on its own

Normal Atelier produces one complete, self-contained first Surface from the current evidence. Later
authoring responds to a failed bounded gate or a human event, not a private browser repair loop.

- Every offered action must be understandable and exercisable in the human's actual environment.
- Mark unavailable evidence or scenarios as unavailable; never present them as confirmable.
- Keep source fidelity, static structure, Region references, store health, and poller identity in
  the normal gate. Evaluate visual and runtime quality through a separate workflow.

## 3. Protect the human's place and unfinished work

Agent activity preserves drafts, open questions, decisions, reading position, selection, queue
position, and rework state.

- Ready, refresh, reconnect, replacement, and unrelated events must not silently erase or displace
  unfinished work.
- Human-owned open loops and next actions remain reachable until resolved.
- Navigation returns to the exact item, including when the Surface must first reveal, select, or
  mount it.
- Destructive actions require explicit human intent and fail closed.

## 4. Use HTML until observed use forces shared machinery

Authored HTML, CSS, and native browser behavior own content, layout, and ordinary controls. Keep a
task-specific fix with its Surface before adding shared kernel behavior.

Add shared machinery only when an observed recurring failure—or demonstrated risk of data loss—
cannot be solved locally, and the smallest shared solution removes more work than it adds. One
mechanism serves one need. Workbench infrastructure and speculative extensibility stay out.

## 5. State only what the evidence proves

Documentation, labels, controls, statuses, and receipts report supported behavior and current
evidence exactly. Intended behavior is not presented as current behavior.

Keep these facts distinct:

1. target located;
2. scenario ready;
3. check performed;
4. evidence available; and
5. human verdict recorded.

When the contract and runtime disagree, correct the contract first. Implement the intended behavior
only when Principle 4 admits it.

## 6. Hold the direction

*Proposed 2026-10-06, awaiting the owner's approval.*

A direction the owner decided stays decided until the owner decides otherwise. Atelier went in circles when
it did not: an 18-commit rewrite to the margin model on 09-25 was later reversed; the 10-01 kernel
stayed unmerged for five days, so the next day's work landed on the old base; agent rankings stood
in for the owner's judgment; sessions re-derived the direction from summaries.

- An owner decision becomes an ADR in the same change, and every Atelier change starts by reading
  these principles and the ADRs.
- A decided direction lands on master promptly. Experiments branch from the current decided base
  and are merged or deleted at the end of their round.
- New work starts from master only after confirming master contains the latest accepted ADR.
- Reversing an ADR takes the owner's explicit decision and a superseding ADR.
- Agent or reviewer rankings inform the owner's verdict on real pages; they never replace it.
- Prefer small steps the owner has validated over rewrites.

## Admission check

Before changing Atelier, answer:

- Which observed human action becomes easier?
- Which session steps are added and removed?
- Why are HTML, native behavior, or a local Surface fix insufficient?
- What bounded check will prove the change without overstating its result?
- Which ADR does this follow or supersede? *(Proposed 2026-10-06 with Principle 6, awaiting
  the owner's approval.)*

A missing answer means the change does not belong in Atelier.

## Evidence

The reports and plans behind these principles name real repositories, ports, stores, Workstreams,
and product decisions, so they are kept outside this public repository in a private sibling
checkout: `skill-incubator-private/atelier/docs/`.
