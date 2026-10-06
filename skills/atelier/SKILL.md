---
name: atelier
description: >-
  Build and operate a live HTML Surface where the human reads, comments on, and decides the work
  instead of reading the session transcript. Use for workflows and pipelines, direction rounds and
  review queues, plans and designs, comparisons, code or media review, and other work where anchored
  feedback and durable decisions improve the result.
---

# Atelier

Atelier extends HTML the way htmx does. You write the page; attributes and a few elements give each
thing the human judges an address, a durable conversation at that address, and the event loop
between the human and you. **You own** layout, content and styling. **The kernel owns** addresses,
the store, Threads, Proposals with undo, Updates, Ready, drafts, and reveal.

Terms are defined in [CONTEXT.md](CONTEXT.md). `<skill-dir>` is the directory containing this file.

## Every page has three levels

| Level | Holds | How |
|---|---|---|
| 1 · Overview | What it's about in two everyday sentences, and the map of all units | First screen |
| 2 · Unit | One step, question, claim or option: what the human comments on and decides | One `atl-key` Region each |
| 3 · Detail | Evidence, conditions, files, receipts | `<details>` inside the unit — never deleted to shorten the page |

## Router

### Step 1 · How do the units relate?

Pick the structure, then copy its skeleton from `recipes/` and replace every `[bracket]`.

| Structure | The units are … | For example | Skeleton |
|---|---|---|---|
| **Workflow** | ordered steps, possibly nested | pipeline, process, migration | [`recipes/workflow.html`](recipes/workflow.html) — `<atelier-flow>` |
| **Set** | independent of each other | direction round, review queue, records | [`recipes/set.html`](recipes/set.html) — `<atelier-tabs>` |
| **Argument** | building on each other | plan, design, proposal | [`recipes/argument.html`](recipes/argument.html) — `<atelier-claims>` |
| **Comparison** | options judged on the same criteria | variants, tools | [`recipes/comparison.html`](recipes/comparison.html) — a table, one row per option |

Each skeleton's header says what goes on which level. When two structures fit and would change
how the human works, offer both and recommend one; otherwise choose.

### Step 2 · What goes in a unit or its detail?

| The material is … | Write | Syntax |
|---|---|---|
| What was liked, disliked, measured, missing | `<atelier-findings>` | [blocks](references/blocks.md) |
| A question with alternatives | `<atelier-decision>`, each option with its own reasons | [blocks](references/blocks.md) |
| One item's way through a workflow | `<atelier-timeline>`: steps, screenshots, reviewers' comments | [blocks](references/blocks.md) |
| A file, code, or a diff | `<atelier-file src=… / diff=…>` | [show files](references/blocks.md#show-files) |
| A video | `<atelier-video>` with `m:ss` marks; siblings show one at a time | [blocks](references/blocks.md) |
| Before and after | `<atelier-compare>` | [blocks](references/blocks.md) |
| A UI that does not exist yet | `<atelier-mock>` | [blocks](references/blocks.md) |
| Numbers | `<atelier-chart>` (Vega-Lite) | [blocks](references/blocks.md) |
| A small fixed sequence or state machine | `<atelier-mermaid>` | [blocks](references/blocks.md) |
| Anything no block covers | plain HTML, or [a renderer of your own](references/blocks.md#a-renderer-of-your-own) | — |

### Step 3 · What should the human be able to do?

| The human should … | Write | |
|---|---|---|
| comment on a unit | `atl-key="…"` on its element, `atl-label` for its name; nesting builds the key `s1/check-a` | one local key, no slash, unique path |
| comment on a point in an image | nothing on `<img>`/`<svg>`; `data-atl-point` on any other element | |
| see comments beside the content | `<atelier-host layout="anchored" collapsible>` beside `<main>` — also the one catch-all | folds away, reserves no width |
| see comments under each unit | `<atelier-host for="key">` inside the unit, plus one catch-all `<atelier-host>` | longest whole-path `for` wins |
| see everything open, and pick | `<atelier-activity>`, exactly one | |
| start a whole-unit Thread with a button | `<button atl-thread="key">` | |
| reach a unit the page hides | `setRevealResolver(async ({region}) => …)` selects it first | tabs and flow do this themselves |
| decide | `POST /api/propose` anchored to the question, with `suggested` | [loop](references/loop.md#work-through-the-surface) |
| just be informed | `POST /api/update` | [loop](references/loop.md#choose-the-message-shape) |
| see what changed | rewrite the file, `POST /api/ready` with the edited keys | [loop](references/loop.md#work-through-the-surface) |

Every open item must land in a host and be reachable; never reload the human's page — publish with
Ready. Full attribute, export and endpoint contract: [references/protocol.md](references/protocol.md).

## Build

1. **Read the sources.** From a transcript, extract current facts, recommendations, open questions,
   disagreements and source anchors; show the synthesized state, not the log. Trace every claim to
   the sources as they are now.
2. **Route.** Step 1 picks the skeleton, Step 2 the content of each unit, Step 3 the interaction.
3. **Copy the kit and the skeleton:**

   ```bash
   mkdir -p tools .review
   cp <skill-dir>/assets/{server.mjs,atelier.mjs,atelier.css,atelier-blocks.mjs,atelier-blocks.css} tools/
   cp <skill-dir>/assets/poll.sh tools/review-poll.sh && chmod +x tools/review-poll.sh
   mv tools/server.mjs tools/review-server.mjs
   cp <skill-dir>/recipes/<structure>.html tools/surface.html
   ```

   Keep `.review/` out of version control; re-copy the kit rather than patch it.
4. **Write it** by [references/writing.md](references/writing.md): plain words up front, every
   sentence about the subject, details folded not deleted, `<html lang>` set to the language you
   write natively.
5. **Lint:** `node <skill-dir>/scripts/preflight.mjs --lint-only tools/surface.html` until it passes;
   rewrite each sentence `WARN PROSE` names.
6. **Serve and hand over** by [references/loop.md](references/loop.md): server and poller under the
   monitor, full preflight, open the URL. No screenshots or browser walk stand between a passing
   preflight and the handoff.

## Changing Atelier itself

Read [the principles](docs/principles.md) and [the ADRs](docs/adr/) first. After changing `assets/`
or `scripts/`, run `node <skill-dir>/scripts/verify.mjs` and `bash <skill-dir>/scripts/test-atelier.sh`.
Whether a copied Atelier should become a Studio: [references/promotion.md](references/promotion.md).
