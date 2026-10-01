---
name: atelier
description: >-
  Build and operate a live HTML Surface where the human reads, comments on, and decides the work
  instead of reading the session transcript. Use for reviewing many records, plans and documents,
  grilling sessions, comparisons, code or media review, and other work where anchored feedback and
  durable decisions improve the result.
---

# Atelier

Atelier extends HTML the way htmx does. You build whatever page the task needs — a list/detail
workspace, a document, a table, a prototype, media. The kernel adds what a page cannot have: an
address for each thing the human judges, a durable conversation at each address, and the event
loop between the human and you.

**You own** layout, navigation, selection, counts, styling, and the phone layout. **The kernel
owns** addresses, the store, polling, Threads, Proposals, Updates, Ready, safe submission
(validation, retries, undo), drafts, the cards inside hosts, and reveal. It inserts nothing into
your content uninvited and imposes no frame.

Capitalized terms are defined in [CONTEXT.md](CONTEXT.md). When changing Atelier itself, apply
[the principles](docs/principles.md). `<skill-dir>` is the directory containing this file.

## The interface

| You write | The kernel does |
|---|---|
| `atl-key="provider"` on any element (`<tr>`, `<li>`, `<article>`, `<g>`), optional `atl-label` | Makes it a Region. Nesting builds the Region Key `rollout/provider`, the address in every API call. One local key, no slash, unique path. |
| `<atelier-host for="rollout">` | Shows the Threads and Proposals of that key and below. The longest whole-path `for` wins (`c6` never claims `c64`). |
| `<atelier-host>` without `for` | The one catch-all: unclaimed items, Threads whose Region left, failed reveals. |
| `layout="anchored"` on a host | Cards level with their anchors while the host sits beside its content; normal flow otherwise. |
| `<atelier-activity>`, exactly one, anywhere | Pick-to-comment, the "N waiting" drawer, desktop notifications. |
| `atl-thread` on a button (value: a key, or empty for the closest Region) | Opens a whole-Region Thread in that Region's host. |
| `setRevealResolver(async ({region,id,kind}) => …)` | Awaited before every reveal, so your page can select the record or tab first. |
| a listener for `atelier:state` (or `getState()`) | Gets `{state, items:[{kind,id,region,status,waiting}]}` after every change, for your counts and badges. |
| a listener for `atelier:ready` | Fires after a Ready swap; re-apply your own view state there. |

The human starts a Thread by selecting text, Alt+clicking an element or a point on an image, or
using Pick in Activity. Exports, endpoints, store, and events:
[references/protocol.md](references/protocol.md).

Three rules hold on every Surface:

1. **Build the UI the job needs** — a workspace, a document, a table — not a prettier session log.
2. **Every open item has a host and is reachable**: each open Proposal and each Thread waiting for
   the human shows in a host that `reveal()` can bring on screen.
3. **Publish with Ready**, never by reloading the human's page.

## Build the first Surface

1. **Read the sources first.** From a transcript, extract current facts, recommendations, open
   questions, disagreements, and source anchors; show the synthesized state, not the log.
2. **Build the UI the job needs.** Choose the composition with
   [references/composition.md](references/composition.md); never ask the human to invent it. For
   many records, start from `recipes/list-detail.html`; for one argument, `recipes/document.html`;
   for a grilling round, `recipes/frontier.html`; for diagrams or files,
   `recipes/diagram-and-files.md`. Serve the recipe and click it before writing your own (its
   header comment has the commands).
3. **Copy the kit.** The four files travel together; the server serves `/atelier.mjs` and
   `/atelier.css` from its own directory:

   ```bash
   mkdir -p tools .review
   cp <skill-dir>/assets/{server.mjs,atelier.mjs,atelier.css} tools/
   cp <skill-dir>/assets/poll.sh tools/review-poll.sh
   mv tools/server.mjs tools/review-server.mjs
   chmod +x tools/review-poll.sh
   ```

   Keep `.review/` out of version control; re-copy rather than patch.
4. **Write the page.** Load `<link rel="stylesheet" href="/atelier.css">` and
   `<script type="module" src="/atelier.mjs">`. Put `atl-key` on each thing the human judges on
   its own — a record, a check row, a setting value, a step. Place a host where its conversation
   helps: inside each record, under each questioned passage, or beside a document with
   `layout="anchored"`. Add one catch-all. A page that hides records registers a reveal
   resolver (rule 2).
5. **Write the finding.** Every sentence stays true with the layout removed: no text about the
   page, its sections, its controls, or its status. Quote the source being judged verbatim and
   anchor each Proposal to it. The rest is in
   [Write the finding](references/composition.md#write-the-finding).
6. **Build once from the evidence.** Trace every claim, recommendation, and Proposal to the
   sources as they are now; a located target proves only its location, not that a check ran.
   Offer only actions the human can exercise in their browser.

**Ready when:** current sources support every visible claim, the first screen orients in about 60
words, and a cold reader can reach every control and understand each option without the
transcript. The first browser load needs no Ready.

## Start the live loop

1. Choose a free `PORT`; use the exact `http://127.0.0.1:<port>` everywhere. Call `monitor_status`,
   then start the server with the Workbench `monitor`: `source.type="spawn"`, the command
   `env PORT=<port> UI=tools/my-surface.html node tools/review-server.mjs`, the project directory
   in `options.cwd`, `recoveryPolicy:"never"`, the port in the reuse key. Never hide `cd`, pipes,
   or backgrounding inside the command.
2. Health-check `GET /api/state`, then start exactly one more `spawn` watcher for
   `BASE_URL=<exact-url> bash <absolute-poller-path> --stream` with a URL-specific reuse key and
   `notifyOn` for `SENT`, `DECISION`, `EXPLAIN-REQUEST`, `COMMENT-REJECTED`, `COMMAND`,
   `SERVER-DOWN`, `SERVER-UP`. Confirm with `monitor_inspect` that it holds the exact URL.
   Without the monitor, run `--once` under the harness's tracked background tasks and re-arm it
   after each wake; never an untracked `&`.
3. Run the gate:

   ```bash
   node <skill-dir>/scripts/preflight.mjs --url http://127.0.0.1:<port> \
     --poller-identity <absolute-poller-path> --evidence-dir .review/preflight
   ```

   It fails silent handoff defects — store, poller, kit drift, keys, Activity, hosts, open items
   `reveal()` cannot bring on screen, detached anchors, browser errors, kernel warnings, overflow
   at 1440×900, 390×844 and 412×915, undrawn diagrams. Rewrite or delete each `WARN PROSE`
   sentence; steps for an interface under review go in an element marked `data-subject-ui`.
   `--skip-render`, `--skip-poller` and `--allow-kit-drift` are never a handoff.
4. Walk the primary path and every control yourself, then open the URL for the human. Restarting
   a used Surface repeats steps 1–3 and skips this one unless the content changed.

**Ready when:** preflight passes, the exact-URL poller is armed, and the browser is open.

## Work through the Surface

While the review is live, chat carries only the URL, failures, and the final handback.

- **Threads.** On every `sent` event, follow-ups included, reply in that Thread with what you picked
  up and set `acknowledged` within seconds; read its `anchor` and any `attachments`. Move it
  through `in_progress` to `implemented`; the human accepts or reopens it in place.
- **Decisions.** Ask every question as a Proposal at the Region it would change, recommended option
  first, each option's consequence stated. The host shows the options as buttons; one click
  chooses and Undo stays beside the choice for 30 seconds. You receive `decision` only when that
  window closes — never act on a choice before it. `custom` is the human's own wording and wins.
- **Updates.** Anything that needs no answer is an Update; it waits in Activity.
- **Ready.** Rewrite the HTML file, then post only the edited leaf Region Keys to `/api/ready`.
  The kernel swaps exactly those Regions; drafts, focus, and scroll survive. Never reload the
  page yourself. Publish at coherent points; for a grilling round, rewrite the decided Regions,
  add the next frontier, and post one Ready.
- When the human ends the review, stop the watchers and leave the store as the record.

Run one active browser per Surface; a second can overwrite Thread changes. While a Region has an
open or pending Proposal, a new one answers 409: post an Update instead and ask after it resolves.
When a Ready removes the text an Anchor quoted, restore it or say in that Thread where it went.

## Kernel changes and promotion

After changing `assets/`, run `node <skill-dir>/scripts/verify.mjs` and
`bash <skill-dir>/scripts/test-atelier.sh`. When repeated use of a copied Atelier reveals a stable
domain model, decide with [references/promotion.md](references/promotion.md) whether to build a Studio.
