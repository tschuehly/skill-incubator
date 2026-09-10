# Decisions and operating modes

Use this reference for `decision` and `ratification` actions from `scripts/next.sh`, and whenever a
Chapter review discovers a genuine unresolved choice.

## Decision matrix

Resolve checkable facts from evidence. Classify unknown blast radius or scope upward, never down.
Impact is monotonic.

| Route | Impact | Reversibility | Scope | Envelope fit |
|---|---|---|---|---|
| Resolve as a fact | any | — | — | — |
| Advisor consult, then proceed | low–contained | reversible | one Chapter | inside |
| Provisional ADR, AFK only | at or below ceiling | reversible option exists | listed Chapters | inside |
| Decision Inbox, Supervised | at or below elevated | any | bounded, listed Chapters | not applicable |
| Material deviation, freeze Run | high/critical or semantic scope change | irreversible or unknown | cross-cutting or unknown | outside |

The Ledger enforces the hard edges: high/critical decisions must be deviations, decisions block
only listed Chapters and their dependents, and provisional ADRs cannot exceed the approved impact
ceiling or ADR budget.

## Supervised mode

Use Supervised mode by default.

- Record a non-material choice with `ledger.sh decision add` using the schema in
  [templates.md](templates.md).
- Keep only the listed Chapters and their dependents blocked. Continue independent Chapters.
- Batch human-facing decisions and record one notification per batch, never one per item.
- Let the human answer the Decision Inbox. Never infer an answer from silence.
- Freeze the whole Run only for a material deviation or review non-convergence.

If the frontier is empty while decisions remain open, notify once and wait.

## AFK mode

Let only the human enter AFK mode. Require approval of a decision envelope for the current Design
revision before running `ledger.sh mode set afk <actor>`. Record:

- invariants and allowed scope;
- impact ceiling and ADR budget;
- reversibility requirement;
- stop conditions.

Inside the envelope, select the conservative reversible option, write the provisional ADR from
[templates.md](templates.md), and continue. Outside the envelope, decide nothing: block the affected
Chapter and continue only independent work.

Do not begin the System Story, open the final PR, or deliver while a provisional ADR is unratified.
When the human returns, present the ratification queue in the Design Atelier. Let the human:

- ratify with `ledger.sh adr ratify <id>`; or
- revise through a recorded deviation with `ledger.sh adr revise <id> <deviation-id>`.

Any approved Design revision invalidates the previous envelope and returns the Run to Supervised
mode until the human approves a new envelope.

The Ledger mechanically checks the ceiling, budget, and ratification gates. Treat “conservative”
and “reversible” as fallible agent judgments and expose their evidence for human audit.
