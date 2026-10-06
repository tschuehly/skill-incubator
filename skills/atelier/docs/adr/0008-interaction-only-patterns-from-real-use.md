# Atelier provides interaction only; content patterns come from real use

Status: accepted by the owner 2026-10-06.

Supersedes the content parts of [ADR 0007](0007-static-lint-blocks-and-content-shapes.md): the
building blocks, the content-shape catalog and router, the skeletons, and the lint's content
gates. Keeps ADR 0007's static lint (structural gates only) and opened-vs-default decision
readings, and [ADR 0006](0006-html-extension-kernel.md)'s kernel.

## Context

On 2026-10-06 one problem (explain the marketing-video pipeline and its gates) was built by a fresh
agent from the skill alone, four times, and compared by the owner against the page the old skill
built on 2026-09-25. Each round of content guidance made the page worse:

- a word budget cut 44% of the content, including what each gate proves;
- folding rules and a router with skeletons brought the words back, and the router made the agent
  use the flow block — the owner judged that page "much worse".

The interaction layer (Regions, hosts, Threads, Proposals with undo, Ready) passed its tests
throughout. Content guidance failed; it was also the part re-derived most often (Principle 6).

## Decision

| Date | Owner decision | Owner's words |
|---|---|---|
| 2026-10-06 | Atelier keeps only the kernel and its interaction interfaces; the agent writes the page freely. | Chose "keep only the kernel, no content rules, no router" |
| 2026-10-06 | Remove the building blocks; create patterns from real usage. | "I think we should start from scratch and create patterns from real usage" |
| 2026-10-06 | Remove every content check from the lint (PROSE, DECISION_CONTEXT, LANG, VIDEO, BLOCKS). | "remove all" |
| 2026-10-06 | Remove the writing guidance. | Chose "remove" |
| 2026-10-06 | Prove it on the next real task, not a trial. | Chose "straight to a real task" |

Removed: `assets/atelier-blocks.{mjs,css}`, `recipes/`, `references/{composition,blocks,writing}.md`,
`scripts/prose{,.test}.mjs`, the router in `SKILL.md`. Kept: the kernel, the server, the poller,
preflight's STORE, POLLER, KIT and the structural lint (KIT_TAGS, REGIONS, HOSTS, PROPOSALS, REACH,
ANCHORS), the loop, the protocol.

## Consequences

- A content pattern enters the kit only after it recurs in real Surfaces the owner used, with the
  Surfaces named as evidence (Principle 4's admission check, Principle 6).
- The lint judges no content; an unknown `atelier-*` element fails as a typo.
- The 2026-10-06 verdict traits that live in the kernel stay: the collapsible host, icon actions,
  German labels under `lang="de"`, the default theme.
