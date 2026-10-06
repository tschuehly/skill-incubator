# The live loop — serve, wake, answer, publish

How the agent runs a Surface once its page lints clean. Endpoints, store and poll internals are in
[protocol.md](protocol.md); this file is what the agent does. `<skill-dir>` is the skill directory.

## Start the loop

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

   It fails silent handoff defects without a browser — store, poller, kit drift, and a static lint
   of the page source: `atl-key` Regions, Activity and hosts, building-block bodies,
   page-describing prose, the verdict rules (`<html lang>` matching the text, one video at a
   time), suggested options, open items no host would show, and
   anchors whose quote is gone. Rewrite or delete each sentence `WARN PROSE` names; steps for an
   interface under review go in an element marked `data-subject-ui`. `WARN DECISION_CONTEXT` flags
   material right after a decision: move each option's reasons into the option. `UNMEASURED` means the lint could not
   see (a drawn diagram, a diff) — not a pass. `--lint-only <file>` lints a page with no server.
   `--skip-poller` and `--allow-kit-drift` are never a handoff.

   Preflight no longer checks browser errors, kernel warnings, overflow, layout, real rendering, or
   whether `reveal()` reaches each item (owner decision 2026-10-06,
   [ADR 0007](docs/adr/0007-static-lint-blocks-and-content-shapes.md)). Keep quoted text in the
   source, a block's `<script type="text/plain">`, or a file an `<atelier-file>` shows, so the lint
   can read it. A block that fails to render shows its error and source in place.
4. When preflight passes, open the URL for the human. Nothing else stands between a passing
   preflight and the handoff: no screenshots, no browser walk, no second reader.

**Ready when:** preflight passes, the exact-URL poller is armed, and the browser is open.

## Work through the Surface

While the review is live, chat carries only the URL, failures, and the final handback.

- **Threads.** On every `sent` event, follow-ups included, reply in that Thread with what you picked
  up and set `acknowledged` within seconds; read its `anchor` and any `attachments`. Move it
  through `in_progress` to `implemented`; the human accepts or reopens it in place.
- **Decisions.** Ask every question as a Proposal at the Region it would change, with `suggested`
  naming the recommended option and each option's consequence stated. The host shows the options as buttons; one click
  chooses and Undo stays beside the choice for 30 seconds. You receive `decision` only when that
  window closes — never act on a choice before it. `custom` is the human's own wording and wins.
  Before acting on a batch, run `poll.sh --decisions`: each Proposal reads kept as proposed,
  changed, opened but undecided, or not opened — and a default that was never opened is not
  agreement.
- **Updates.** Anything that needs no answer is an Update; it waits in Activity.
- **Ready.** Rewrite the HTML file, then post only the edited leaf Region Keys to `/api/ready`.
  The kernel swaps exactly those Regions; drafts, focus, and scroll survive. Never reload the
  page yourself. Publish at coherent points; for a grilling round, rewrite the decided Regions,
  add the next frontier, and post one Ready.
- When the human ends the review, stop the watchers and leave the store as the record.

Run one active browser per Surface; a second can overwrite Thread changes. While a Region has an
open or pending Proposal, a new one answers 409: post an Update instead and ask after it resolves.
When a Ready removes the text an Anchor quoted, restore it or say in that Thread where it went.

## Choose the message shape

Three channels; picking the wrong one is what makes a Surface feel like chat again.

- **Reply in the Thread** when the human asked. Always the answer to their comment, never a new
  topic.
- **Update** when they need to know something and no answer is required: a batch finished, a source
  changed, six Regions were re-rendered. It waits in Activity, never in the content; it never asks.
- **Proposal** when work cannot continue without their judgment, anchored at its subject. Name real
  options, put the recommendation first, and state what each one costs. A Proposal with one option
  is an Update; a Proposal whose answer you could have discovered yourself is a research failure,
  not a question. A list of open choices in the content is a set of Proposals written as prose:
  post each as a Proposal instead.

Nothing else is a channel. If a message fits none of these, it is prose looking for a chat window.

## Event kinds to react to

- **`sent`** — a Thread was dispatched, its `anchor` inline. Acknowledge → triage → fix → reply.
  With `followUp`, the human wrote again in an existing Thread. Images arrive as `attachments`
  URLs; read the file at `<ROOT><url>`.
- **`decision`** — final, after the undo window. `proposalId` names the Proposal; `choiceIndex`
  the option; `custom`, when present, is the human's own wording and wins; `verdict` says `kept as
  proposed` or `changed from the suggestion`. Act, then reply. Before acting on a batch, read
  `poll.sh --decisions`: a Proposal `not opened; default stands` was never seen.
- **`explain-request`** — the human asked what an option means; answer through `/api/explain`.
- **`comment-rejected`** — an implemented Thread was judged incomplete; `msg` says why.
- **`command`** — a human action posted with `wake:true`; `action` carries the bespoke kind.

## Agent-side snippets

```bash
BASE_URL=http://127.0.0.1:<port>

# acknowledge within seconds, before fixing — piggyback the lifecycle bump
curl -s -X POST "$BASE_URL/api/reply" -H 'Content-Type: application/json' \
  -d '{"region":"v03","id":"<commentId>","msg":"Picked up: <plan>","state":"acknowledged"}'

# ask beside the exact evidence; `suggested` marks the recommended option
curl -s -X POST "$BASE_URL/api/propose" -H 'Content-Type: application/json' \
  -d '{"region":"v03","question":"Release v03 with its caption inside the button row?",
       "options":["Move the caption up 40 px, then release","Release as is"],"suggested":0,
       "anchor":{"region":"v03/safe-zone","selector":":scope > td:nth-of-type(1)"}}'

# answer an explanation request (proposal id + optionIndex come from the event)
curl -s -X POST "$BASE_URL/api/explain" -H 'Content-Type: application/json' \
  -d '{"id":"prop-12","optionIndex":0,"text":"This option … Tradeoff: … Choose it when …"}'

# tell the human something without asking for anything
curl -s -X POST "$BASE_URL/api/update" -H 'Content-Type: application/json' \
  -d '{"region":"v01","title":"All eight renders finished","body":"Three fail a check."}'

# publish rewritten content into the open page
curl -s -X POST "$BASE_URL/api/ready" -H 'Content-Type: application/json' \
  -d '{"changed":["v03/safe-zone","v04"]}'
```
