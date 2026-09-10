# Quality Loop Atelier Surfaces

Use two distinct Atelier Surfaces. The Design Surface owns intended architecture; the System Story
Surface owns comprehension of the resulting system. Keep their stores and Review Unit keys
distinct and record both in the Ledger.

## Design Atelier

### Purpose

Let the human verify and judge the system before implementation begins.

### Review Units

- **Problem and outcome:** user need, success condition, constraints, exclusions.
- **Domain concepts:** stable concept key, definition, relationships, invariants, examples.
- **System context:** actors, external systems, trust and ownership boundaries.
- **Architecture:** components, responsibilities, relationships, data/control flows.
- **Decisions:** tension, alternatives, evidence, recommendation, consequences.
- **Behavior:** user stories, failure behavior, compatibility, operational behavior.
- **Testing:** agreed behavioral seams, negative cases, runtime and parity evidence.
- **Impact:** critical surfaces and why their implementation needs focused presentation.
- **Build path:** semantic Chapters, dependency graph, proposed timeline, focused-PR boundaries.
- **Decision Inbox:** non-material decisions raised during execution, each a Review Unit carrying
  tension, evidence, impact, reversibility, alternatives, recommendation, and the blocked Chapters.
  In Supervised mode the human answers a batch and the affected Chapters resume; the advisor
  challenges every entry before it reaches the human. Independent Chapters keep running underneath.

Use Diagram Regions for context, component, flow, state, and dependency relationships. Keep the
readable Mermaid source beside every rendered diagram. Proposals carry actual decisions; facts are
presented as evidence and never asked back to the human. The Decision Inbox is a section of this
Surface, not a separate Surface.

### Sign-off

Provide one explicit sign-off action covering the current design revision. Approval freezes
`spec.md`, `design.md`, `concepts.md`, and the proposed timeline as the execution contract. The
action posts `/api/event` with `{"kind":"design-approve","item":"design","wake":true,"data":{"revision":"<exact-revision>"}}`
so the canonical `command` event wakes the Driver with the exact Revision.

### Return from AFK — ratification checkpoint

When the human returns from an AFK stretch, present the accumulated log of provisional ADRs and
envelope-decided items on this Surface, alongside the Decision Inbox: each ADR's context, the
conservative option taken, its reversibility, and the Chapter it touched. The human ratifies each
ADR (`ledger.sh adr ratify`) or revises it (`ledger.sh adr revise`, which reopens that Chapter as a
deviation), and answers any open decision. This checkpoint precedes the Story gate:
`ledger.sh story begin` refuses while any provisional ADR is unratified or any decision is open, so
the log is cleared here before the System Story Surface is built.

## System Story Atelier

### Purpose

Let the human understand and accept the system that was built without reading routine code.

### Comprehension layers

#### Map

Show the resulting component and concept map, important flows, chapter distribution, and impact
distribution. Prefer diagrams over file trees.

#### Story

Explain what the system now does, why it exists, its boundaries, and the important behavior a
maintainer or product owner must understand.

#### Chapters

Group changes by semantic purpose rather than file location. Each Chapter shows:

- goal and resulting capability;
- affected concepts and architecture elements;
- preserved or changed invariants;
- important design decisions and deviations;
- behavioral evidence and impact;
- commits and optional focused PR as traceability links.

#### Timeline

Show the dependency-ordered build path. Compare proposed and actual order, explain splits and
deviations, and state what each completed Chapter made possible for the next.

#### Evidence

Group tests by behavior, not test file. Link claims to RED/GREEN gates, configured critical
verification, runtime observations, parity evidence, and reviewer dispositions.

#### Raw

Keep every changed file and hunk reachable. Collapse routine code by default. This layer proves
completeness but is not the expected review path.

### Impact presentation

Use five impact levels: `low`, `contained`, `elevated`, `high`, `critical`. Determine impact from
configured rules and architecture reach, never LOC alone.

- `low|contained`: system explanation and evidence only;
- `elevated`: show affected API/type signatures or focused pseudocode when useful;
- `high|critical`: expand the smallest code excerpts that prove the architectural claim, plus the
  relevant tests and reviewer verdicts.

The review board may raise impact. Never lower an approved impact merely to hide code.

### Acceptance

Provide one explicit action confirming that the human understands and accepts the resulting
system. Comments and proposals refine the story or surface a semantic deviation; they do not turn
the Surface into a line-by-line code review tool. The action posts `/api/event` with
`{"kind":"story-accept","item":"story","wake":true,"data":{"revision":"<exact-revision>"}}`
so acceptance is an explicit waking command rather than passive status.
