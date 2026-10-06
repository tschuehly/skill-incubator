---
name: atelier
description: >-
  Add comments, decisions with undo, and live updates to an HTML page you build for the human, so
  they read, annotate and decide the work there instead of in the session transcript. Use when a
  page explains work — a workflow, a review queue, a plan, a comparison, code or media — and the
  human's anchored feedback and durable decisions should flow back to you.
---

# Atelier

Atelier extends HTML the way htmx does. **You write the page** — whatever shows the work best;
Atelier ships no layouts, components or content rules. **The kernel adds** an address for each
thing the human judges, a durable conversation at that address, decisions with a 30-second undo,
and the event loop between the human and you.

Terms are defined in [CONTEXT.md](CONTEXT.md). `<skill-dir>` is the directory containing this file.

## The interface

| You write | The kernel does |
|---|---|
| `<link rel="stylesheet" href="/atelier.css">` and `<script type="module" src="/atelier.mjs">` | Loads the kernel. |
| `atl-key="cutover"` on any element (`<section>`, `<tr>`, `<li>`, `<g>`), optional `atl-label` | Makes it a Region the human can comment on. Nesting builds the key `rollout/cutover`, the address in every API call. One local key, no slash, unique path. |
| `<atelier-host for="rollout">` | Shows the Threads and Proposals of that key and below. The longest whole-path `for` wins. |
| `<atelier-host>` without `for` | The one catch-all: everything no other host claims. |
| `layout="anchored"` / `collapsible` on a host | Cards level with their anchors beside the content / the human folds the host away, reserving no width. |
| `<atelier-activity>`, exactly one | Pick-to-comment, the "N waiting" drawer, notifications. |
| `<button atl-thread="key">` | Opens a whole-Region Thread. |
| `data-atl-point` on an element | A click anchors a point on it (`<img>` and `<svg>` need nothing). |
| `setRevealResolver(async ({region}) => …)` | Awaited before every reveal, so a page that hides content (tabs, a selected record) shows it first. |
| `<html lang="de">` | German kernel labels; anything else gets English. |

The human starts a Thread by selecting text, Alt+clicking an element or a point, or Pick. Every
open item must land in a host and be reachable. Exports, events, store and endpoints:
[references/protocol.md](references/protocol.md).

## Build

1. **Read the sources** and show the current state of the work, not the session log.
2. **Write the page** the work needs, in plain HTML and CSS. Put `atl-key` on each thing the human
   would answer on its own, place hosts where the conversation helps, add one catch-all and one
   `<atelier-activity>`.
3. **Copy the kit** next to it:

   ```bash
   mkdir -p tools .review
   cp <skill-dir>/assets/{server.mjs,atelier.mjs,atelier.css} tools/
   cp <skill-dir>/assets/poll.sh tools/review-poll.sh && chmod +x tools/review-poll.sh
   mv tools/server.mjs tools/review-server.mjs
   ```

   Keep `.review/` out of version control; re-copy the kit rather than patch it.
4. **Lint:** `node <skill-dir>/scripts/preflight.mjs --lint-only tools/surface.html`. It checks
   only structure — kernel loaded, Regions, hosts, anchors — never content.
5. **Serve, ask, hand over** by [references/loop.md](references/loop.md): server and poller under
   the monitor, full preflight, open the URL. Ask every question as a Proposal with `suggested`;
   publish changes with Ready, never by reloading the human's page.

## Changing Atelier itself

Read [the principles](docs/principles.md) and [the ADRs](docs/adr/) first. Content patterns are
added only from repeated real use (ADR 0008). After changing `assets/` or `scripts/`, run
`node <skill-dir>/scripts/verify.mjs` and `bash <skill-dir>/scripts/test-atelier.sh`. Whether a
copied Atelier should become a Studio: [references/promotion.md](references/promotion.md).
