# Quality Loop artifact templates

## Contents

1. GitHub Issue
2. Semantic Chapter
3. Finding schema
4. Decision Inbox entry
5. Provisional ADR
6. Journal entries
7. Focused PR
8. Final integration PR
9. External review replies

Artifacts 1, 7, and 8 are **generated views** of the authoritative Run Record — regenerate them
from `state.json`, the Chapters, and evidence; never hand-maintain a second copy of a fact. The
Ledger owns gate state, so no artifact carries its own gate list.

## 1. GitHub Issue

```md
# <Outcome-oriented Run title>

## Outcome
<What system capability should exist when this Issue is complete?>

## Constraints and boundaries
- <binding constraint>
- Out of scope: <explicit exclusion>

## Human review surfaces
- Design Atelier: <pending|URL + approved revision>
- System Story Atelier: <pending|URL + accepted revision>

## Delivery
- Integration branch: `<branch>`
- Chapters: <progress summary linked by semantic title>
- Focused PRs: <only genuine boundaries>
- Final integration PR: <pending|link>
```

Keep the Issue concise. Link the Run Record artifacts and surfaces; do not paste the journal. Gate
and phase state live in the Ledger — do not mirror them here.

## 2. Semantic Chapter

```md
# <NN> — <Semantic capability, verb-first>

**Purpose:** <What coherent part of the system story this Chapter delivers>

**Blocked by:** <Chapter keys or None>

**Criticality:** critical | standard | low — <verification rationale>

**Impact:** critical | high | elevated | contained | low — <architecture/human-attention rationale>

## Concept and architecture links
- Concepts: `<stable-concept-key>` — <preserved or changed invariant>
- Architecture: `<stable-element-key>` — <responsibility or relationship affected>

## Acceptance criteria
- [ ] <observable criterion>

## Test matrix
<behavioral seam, negative cases, runtime/parity checks, baseline key/comparison policy when used,
configured critical-verification obligation>

## Build-path role
<What this Chapter makes possible, what it intentionally defers, proposed dependencies>

## Delivery boundary
Local integration | Focused PR — <configured reason when focused>
```

Chapters are semantic and independently testable. They are not file groups and do not imply a PR.

## 3. Finding schema

Reviewer:

```json
{ "findings": [ {
  "file": "path", "line": 42,
  "summary": "one-sentence defect",
  "failure_scenario": "concrete input/state -> wrong behavior",
  "severity": "critical|high|medium|low",
  "classification": "auto-fix|no-op|decision",
  "lens": "correctness|security|tests",
  "conceptKeys": ["concept.key"],
  "architectureKeys": ["component.key"],
  "raisesImpactTo": "critical|high|elevated|contained|low|null"
} ] }
```

Convention findings ride under `correctness`. A `decision` classification routes through the
decision matrix — it is not automatically a Run freeze.

Verifier (per finding, even in a batched round):

```json
{ "verdict": "confirmed|refuted",
  "evidence": "quoted code/spec/design/doc line(s)",
  "corrected_classification": "auto-fix|no-op|decision",
  "semantic_deviation": false,
  "impact": "critical|high|elevated|contained|low" }
```

A verdict without quoted evidence is invalid. A batched Verifier returns one such object per
finding, each with its own quoted evidence.

## 4. Decision Inbox entry

A non-material choice that Supervised mode holds for the human. Record with
`ledger.sh decision add <id> <impact> <reversibility> <affected-csv> <summary>`; only the affected
Chapters block. The advisor challenges each entry before it reaches the human.

```md
# DECISION <id> — <one-line tension>

**Impact:** elevated | contained | low   **Reversibility:** reversible | one-way
**Affected Chapters:** <keys — these block until answered>

## Tension
<the genuine choice; why a fact could not settle it>

## Evidence
<quoted spec/design/code/doc lines that frame the choice>

## Alternatives
- A — <consequence>
- B — <consequence>

## Recommendation
<preferred option and why>

## Answer
<human decision, recorded via `ledger.sh decision answer <id>`>
```

## 5. Provisional ADR

An AFK decision taken inside the envelope. Record with
`ledger.sh adr add <id> <impact> <chapter> <summary>` plus the ADR file; it stays provisional until
the human ratifies (`adr ratify`) or revises it (`adr revise`, which opens a deviation).

```md
# ADR <id> — <decision title> (PROVISIONAL)

**Status:** provisional — awaiting ratification
**Impact:** <= envelope ceiling   **Chapter:** <key>   **Envelope digest:** <digest>

## Context
<the choice, why it fell inside the approved envelope>

## Decision
<the conservative, reversible option taken>

## Reversibility
<how this is undone if the human revises it>

## Consequences
<what this commits and what stays open until ratification>
```

## 6. Journal entries

```md
## <ISO timestamp> — <phase> — <chapter|run>
- DISPATCH <role>: <bounded artifact and purpose>
- GATE <name>: <quoted result or evidence reference>
- FINDING <lens/id>: <summary> -> confirmed|refuted -> disposition
- FIXED <id>: <commit>
- IMPACT <chapter>: <old> -> <new> (<evidence>)
- DEVIATION <id>: <affected concept/architecture keys and decision needed>
- DECISION <id>: <Inbox tension -> human answer, or Design revision for a material deviation>
- ADR <id>: provisional -> ratified|revised (<envelope digest, deviation if revised>)
- MODE <supervised|afk>: <actor and reason>
- NOTIFY <kind>: <batched items in this notification>
- INTEGRATED <chapter>: <commit or focused PR>
- SKIP <gate/lens>: <configured reason>
```

## 7. Focused PR

```md
## Capability
<Chapter outcome and why this needs an independent merge/review boundary>

Closes part of <Issue link>. Targets the Run integration branch.

## Architecture
- Concepts: <keys>
- Elements: <keys>
- Invariants: <preserved/changed>

## Evidence
- RED/GREEN: <quoted gate lines>
- Verification: <results>
- Review board: <rounds and verdict>
- Impact: <level and rationale>

## Not changed
<important exclusions and no-op findings>
```

## 8. Final integration PR

```md
## System outcome
<System Story summary in plain language>

Closes <Issue link>.

- Design Atelier: <URL + approved revision>
- System Story Atelier: <URL + accepted revision>

## Architecture and chapters
<Resulting component/flow summary and semantic Chapter list>

## Evidence
- Acceptance criteria: <behavior-linked summary>
- Review board: <all Chapters and rounds>
- Runtime/parity/critical verification: <material results>
- Deviations: <resolved list or None>

## Human attention
<High/critical Chapters and focused excerpts available in the System Story>

The complete diff is attached for traceability; the accepted System Story is the human review
surface.
```

## 9. External review replies

End every automated reply with `<!-- quality-loop -->` so the poller ignores its own output.
Accepted comments receive a fix and verification evidence. Rejected comments receive quoted
refutation evidence. Semantic comments reopen a recorded deviation rather than being patched over.
