---
name: quality-loop
description: >-
  Turn an outcome, optional discovery brief, or existing GitHub Issue into an approved system
  design, autonomously implemented and adversarially reviewed semantic Chapters, and a
  human-readable System Story. Use when the user wants agents to build a substantial change while
  the human reviews architecture and behavior rather than every code diff, invokes /quality-loop,
  or resumes an active Quality Run.
---

# Quality Loop

Build one understandable system per **Quality Run**. Let the human approve intent in a Design
Atelier, let agents implement and review the approved semantic Chapters, then let the human accept
the resulting system in a System Story Atelier.

`<skill-dir>` is the directory containing this file.

## Start or resume a Run

1. Run `<skill-dir>/scripts/next.sh [<run-dir>]`; omit the argument to select the most recently
   modified Run. Dispatch is resolved when stdout contains `ACTION`, `REFERENCE`, `RUN_DIR`, and
   `NEXT`. Scoped work also prints `EXPECTED_SCOPE`, `SESSION_BOUNDARY`, and a concise `RESUME`
   command when a fresh session is required.
2. Bind the active session before scoped work with the runtime-provided identity:
   `QL_SESSION_ID=<runtime-id> <skill-dir>/scripts/ledger.sh session bind <expected-scope> <actor>`.
   Re-run `next.sh` until `SESSION_BOUNDARY=continue`.
3. Treat stdout as the dispatch contract. Export the printed `RUN_DIR`, read only the printed
   `REFERENCE`, and perform the printed `NEXT` action. When it prints `CHAPTER`, operate only on
   that Chapter.
4. Re-run `next.sh` after every Ledger transition, human gate, completed review board, integration,
   or resumed session. A transition is complete only when stdout reflects the newly recorded state;
   never choose a later phase from memory.
5. Before starting a long-lived human Atelier loop, inspect runtime context telemetry when the
   harness exposes it. At 60% or more, record the current collaborator checkpoint, re-run `next.sh`,
   and resume the printed action in a fresh session. Do not infer a percentage when telemetry is
   unavailable; the durable Run Record remains the resumption source.

For a new Run, `next.sh` prints the initialization action without requiring an existing record.
For an existing Run, the record is authoritative; never reconstruct state from chat.

## Composition

- Compose `/atelier` for the two human review surfaces. Operate each ready Surface through its
  documented protocol and its monitor-owned poller or `--once` fallback; never edit the protocol
  store directly.
- Compose `/agent-orchestration` for collaborator ownership, bounded handoffs, durable checkpoints,
  and reconnect-based resumption.

## Prime rules

1. Route every unresolved choice through the decision matrix. Freeze the Run for a material
   deviation; batch a non-material choice into the Decision Inbox or, in AFK mode, a provisional ADR.
2. Quote script output for every mechanical gate. Never replace an executable transition with prose
   confidence.
3. Keep the Driver out of product code. The Driver owns the Issue, semantic context, dispatch,
   decisions, Ledger, and Atelier loops. Implementers and fixers edit and commit.
4. Exchange approved designs, Chapters, bounded diffs, stable keys, evidence, and structured
   findings—not transcripts.
5. Record every gate, review round, deviation, disposition, skip, and decision when it occurs. If it
   is absent from the Run Record, treat it as not done.

## Routed references

Read only the reference selected by `next.sh`:

| Action | Expert reference |
|---|---|
| `initialize`, `design` | [references/design.md](references/design.md) |
| `chapter`, `blocked` | [references/chapter.md](references/chapter.md) |
| `decision`, `ratification` | [references/modes.md](references/modes.md) |
| `story`, `delivery`, `done` | [references/delivery.md](references/delivery.md) |

Load these supporting references only when the active expert requires them:

- [references/templates.md](references/templates.md) for Issue, Chapter, finding, decision, ADR,
  journal, and PR schemas;
- [references/surfaces.md](references/surfaces.md) for Design and System Story Atelier contents;
- [references/craft-checklist.md](references/craft-checklist.md) for the one post-review Craft pass.

## Durable Run Record

Keep authoritative state under `.scratch/quality-loop/<run-slug>/`:

```text
state.json                 # <skill-dir>/scripts/ledger.sh is the sole writer
journal.md                 # append-only decisions, findings, deviations, and skips
spec.md                    # approved behavior and acceptance criteria
design.md                  # approved architecture, boundaries, decisions, and risks
concepts.md                # stable concept keys, definitions, invariants, and relationships
timeline.md                # generated proposed and actual build path
chapters/<NN>-<slug>.md    # one semantic implementation Chapter
story.md                   # generated system narrative and evidence index
evidence/<chapter>/        # immutable gate logs, manifests, and deterministic review evidence
```

Author each fact once. Treat the Issue, timeline, Story, PR bodies, and Atelier content as generated
views of the authoritative record. Treat a PR as a merge/review boundary, never as a workflow
heartbeat.

## Default role bindings

| Role | Default | Continuity |
|---|---|---|
| Driver and Design Coordinator | session model | persistent within the dispatched scope; fresh at required boundaries and the 60% Atelier gate |
| Planner | strongest judgment model | fresh |
| Implementer | strongest coding model | fresh per bounded Chapter slice; one writer at a time |
| Correctness / Test / Security reviewers | strongest judgment model | fresh per board, risk-scaled |
| Craft apply pass and bounded fixers | cheaper capable model | fresh, once after a clean board |
| Verifiers | strongest judgment model | fresh; batched per round, per finding on critical |
| Atelier presentation | Driver using `/atelier` | copied once per Surface; interaction persists in its store |

## Hard guardrails

- Implement nothing before approval of the exact Design revision.
- Open no final PR before acceptance of the exact System Story revision.
- Never force-push, bypass hooks, hand-edit `state.json`, or leave unexplained dirty state.
- Split a Chapter that cannot complete RED→GREEN coherently or remain reviewable as one change.
- Keep complete diffs accessible even when the human-facing default is system comprehension.
- Let the human own mode changes, Design and Story gates, ADR ratification, and the final merge.
