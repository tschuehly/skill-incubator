# Protocol — the contract between the page, the kernel, the server, and the agent

Everything here is what `assets/atelier.mjs` and `assets/server.mjs` implement and `assets/poll.sh`
speaks. Extend beside it, not through it: `poll.sh`, `preflight.mjs`, `lint.mjs` and future agents
rely on these shapes. Building blocks (`assets/atelier-blocks.mjs`) are content, not protocol; their
syntax is in [composition.md](composition.md#building-blocks).

The division of labor never moves. **You author the page:** layout, navigation, selection, counts,
styling, phone layout. **The kernel supplies** addresses, durable state, the event loop, and the
cards inside hosts. Its chrome lives in its two elements and under `.atl-*` class names; on your
elements it sets only `atl-*` attributes, so your CSS cannot restyle the protocol and the protocol
cannot restyle your content.

## The author interface

```html
<link rel="stylesheet" href="/atelier.css">
<script type="module" src="/atelier.mjs"></script>
<!-- only when the page uses a building block: -->
<link rel="stylesheet" href="/atelier-blocks.css">
<script type="module" src="/atelier-blocks.mjs"></script>
```

All four are served by the Surface server from its own directory. `atelier.css` also ships a
default theme (tokens `--atl-*`, zero-specificity `:where()` content defaults) that any authored
rule overrides, and two optional helpers, `.atl-top` (sticky header) and `.atl-page` (content plus a
host column, `--atl-host-width`). The kernel requires neither.

### `atl-key` — Regions on any element

```html
<article atl-key="v03" atl-label="v03 · Before/after">
  <table><tbody><tr atl-key="safe-zone">…</tr></tbody></table>
</article>
```

| Attribute | Meaning |
|---|---|
| `atl-key` | One local key, no slash. Nested `atl-key` elements build the Region Key: `v03/safe-zone`. The full path must be unique; the lint fails an empty, slashed, or duplicate key. |
| `atl-label` | Human name used in cards and the Activity drawer. Defaults to the Region's first heading, else its key. |

Any element can be a Region — a table row, a list item, an SVG `<g>` — because it is an attribute,
not a wrapper. Wrappers without `atl-key` do not change the path.

### `<atelier-host>` — where Threads and Proposals appear

```html
<atelier-host for="v03"></atelier-host>                    <!-- v03 and everything below it -->
<atelier-host for="migration" layout="anchored"></atelier-host>
<atelier-host></atelier-host>                              <!-- the one catch-all -->
```

- An item goes to the host whose `for` is the **longest whole-path prefix** of its Region Key:
  `v03/safe-zone` goes to `for="v03/safe-zone"`, else `for="v03"`; `for="v0"` never claims `v03`.
- With no claiming host it goes to the catch-all, as do Threads whose Region left the page and any
  item a reveal could not show. Without a catch-all it has no host: the lint fails a stored
  Thread or undecided Proposal no host would show, and the kernel warns when the human starts a
  Thread there.
- The kernel never creates a host. Two hosts with the same `for`, or two catch-alls, raise a
  kernel warning and fail the lint, as does a `for` that names no Region on the page. A host draws itself when it enters the page, so hosts a Ready
  swaps in need no setup. A host with nothing to show is empty.
- `layout="anchored"` positions each card level with its anchor, pushed down to avoid overlap,
  the open card exact. It applies while the host sits beside its `for` Region; when the host is
  `position: fixed` or stacked under that Region, the cards flow normally. The author sizes and
  places the host.
- `collapsible` lets the human fold the host away with the ⇥ icon in `<atelier-activity>` (all
  collapsible hosts fold together, remembered in `localStorage`). A folded host is `display: none`
  and reserves no width — a grid holding it directly drops to one column — while its cards and
  drafts stay in the DOM. It unfolds by itself whenever one of its cards opens: a reveal, an
  Activity row, a click on anchored text, a new Thread. Use it for a side panel of Threads beside
  content; a host inside each record needs no fold.

**Thread cards** are one line until opened: the first message and the lifecycle label. Opened, a
card is the whole conversation, a reply box (⌘+Enter sends, Enter inserts a newline), and on
`implemented` Accept and Reopen; Reopen needs the reply box to say what is still wrong. Pasting or
dropping a PNG, JPEG, GIF, or WebP into a new Thread or a reply uploads it through `/api/attach`.
An open card closes with ×, Escape, or a click elsewhere.

**Proposal cards** are always open while undecided: the question, one button per option (the
`suggested` one labelled Recommended), a ? icon inside each option that asks for an explanation —
the request form and any answer sit inside that option — and a ✎ icon for the human's own answer.
Actions in cards are compact icons; each label is the icon's tooltip and accessible name. One click on an option is the answer; the card then reads "Chosen: … · Undo (29 s)".
Undo returns it to open. When the window closes it collapses to "✓ Decided · …".

**Opened.** A Proposal counts as opened the first time its options are on the human's screen —
at least half its card (or half the viewport, for a tall card) visible in a shown host while the tab
is in front — or when one of its options is chosen. The page posts `/api/proposal-opened` once; a
report that fails (network or non-2xx) stays pending and is retried on every render until the
server acknowledges it. A card in a folded host or a hidden tab is not opened.

**Labels** follow `<html lang>`: `de…` gets the German set, written as German, anything else
English. Warnings about authoring defects (a missing or doubled host) stay English.

**Drafts** — a new Thread, a reply, a custom answer, an explanation request — are kept by card and
field in kernel memory and session storage (new Threads also in local storage), restored after any
re-render, Ready, or reload, and cleared only after the server answers 2xx. A failed request shows
"Not sent: …" in the card and keeps the text.

### `<atelier-activity>` — Pick, the drawer, notifications

Exactly one, anywhere on the page. It renders a 💬 icon (Pick mode; Escape leaves it), a button
reading "N waiting for you" or "Activity", the ⇥ fold icon when the page has a collapsible host, and
a native `popover` drawer:

- **Waiting for you** — open Proposals and `implemented` Threads; a row reveals its card.
- **Just chosen** — pending answers, each with its Undo countdown.
- **Changed since you looked** — Regions named by Ready; the label reveals the Region, ✓ Seen clears
  it. A changed Region also carries the `atl-changed` attribute.
- **Updates** — title, body, a link to its Region, Dismiss.

Desktop notifications are on by default: the kernel asks for permission on the first click and
notifies of replies, Proposals, Updates, and Readys while the tab is hidden.

### `atl-thread` — a visible way to start a Thread

`<button atl-thread="v03">` opens a whole-Region Thread draft in that Region's host; an empty value
means the closest Region. Selection, Alt+click, Pick, and image points need no markup.

### State attributes on your elements

`atl-changed` on a changed Region; `atl-anchor` on an element a Thread or Proposal points at,
`atl-active` while its card is open, `atl-hover` while its card is hovered; `atl-pick` under the
pointer in Pick mode; `atl-picking` on `<html>` during Pick. Text anchors render through the CSS
Custom Highlight API (`::highlight(atl-anchor)`, `atl-active`, `atl-hover`).

### Module exports and events

| Name | Contract |
|---|---|
| `getState()` | `{ state, items }` after the first load, else `null`. `items`: `[{ kind:'thread'|'proposal'|'update', id, region, status, waiting }]`; `waiting` is true for an open Proposal and an `implemented` Thread. Read-only. |
| `atelier:state` on `document` | Same `detail` after every reconciliation. Use it for counts and badges. |
| `setRevealResolver(fn)` | One `async ({ region, id, kind }) => void` that makes the target reachable — select the record, switch the tab. Awaited for up to 2 s. |
| `reveal(id | { region, id?, kind? })` | Runs the resolver, opens `<details>` around the anchor and the card, unfolds a folded host, scrolls the card into view, focuses its first control. Resolves `true`, or `false` after a visible warning, with the item moved to the catch-all. |
| `atelier:reveal` on `document` | Fired before the kernel opens `<details>` around an element it is about to show; `detail.target` is that element. Building blocks that hide parts another way (`<atelier-tabs>`, `<atelier-flow>`) show it here. |
| `atelier:ready` on `document` | After a Ready swap: `detail = { changed, unknown }`. Re-apply your own view state here; it must be idempotent. |
| `atelier:rendered` (you dispatch) | A renderer that adds text after load — a diagram, a file viewer — dispatches it so anchors inside resolve. Setting `data-diagram-ready="true"` does the same. |
| `refresh()`, `unresolvedAnchors()` | Re-read the store; list stored anchors that no longer resolve in the live page. |

### Anchors — what a Thread or Proposal points at

```jsonc
{ "region": "rollout/cutover",            // required: the owning Region Key
  "quote": "flag flip", "prefix": "is a ", // text: the quoted passage and up to 32 chars before it
  "selector": ":scope > div > p:nth-of-type(2)", // element, relative to the Region
  "point": { "x": 0.25, "y": 0.5 } }       // a point on an IMG, SVG or [data-atl-point] element, relative to its box
```

Only `region` means the whole Region. Inside a diagram, a click anchors the box it hit — a Mermaid
or Graphviz `g.node`, or any SVG element with `data-anchor="<name>"` — found again by name; a box
that is itself the Region anchors the whole Region. Text
anchors resolve again by `quote` + `prefix` after every Ready; removing the quoted words detaches
the anchor, its card says so, and the lint fails until it is restored or explained. Blocks mark a
video and a mockup `data-atl-point`, so a Thread on them anchors a point.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4747` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; keep loopback unless remote access is explicitly intended |
| `ROOT` | `<server-dir>/..` | Directory served statically (usually the project root) |
| `UI` | `<server-dir>/surface.html` | HTML file served at `/` |
| `STORE` | `atelier` | Store name → `.review/<STORE>.json` (use a batch id or date for parallel loops) |
| `UNDO_MS` | `30000` | How long an answer stays pending and can be undone |

## Durable store (`.review/<STORE>.json` — gitignore it)

```jsonc
{
  "name": "2026-07-11",
  "threads":  { "<regionKey>": [ { "id":"c-…", "text":"…", "anchor":{ "region":"…", "quote":"…" },
                                  "attachments":["/.review/attachments/<file>"] } ] },
  "sent":     { "<commentId>": "<iso>" },
  "replies":  { "<commentId>": [ { "ts":"<iso>", "msg":"…", "author":"agent|human" } ] },
  "commentState": { "<commentId>": { "value":"implemented", "ts":"<iso>" } },
  "proposals":{ "<propId>": { "id","region","threadId","anchor","question","options":[],"suggested":0,
                              "explanationRequests":{}, "explanations":{},
                              "status":"open|pending|decided","choiceIndex","custom",
                              "attempt","undoUntil","cancelledAttempts":[],"ts","openedAt","decidedAt" } },
  "updates":  { "<updId>": { "id","region","title","body","ts","dismissedAt" } },
  "changed":  { "<regionKey>": { "ts":"<iso>" } },
  "log":      [ { "seq":1, "kind":"sent", "region":"…", "id":"…", "ts":"…" } ],
  "seq": 1
}
```

- Every address is a **Region Key**. There is no second addressing scheme.
- **Writes**: every change is on disk before the server answers or any poller hears of it. A
  write that fails answers `500` and leaves the store as it was; a decision whose window closes
  while writes fail stays `pending` and is retried every second.
- **Ownership**: one active browser owns `threads`; its `POST /api/state` autosave replaces that
  collection wholesale, so two active browsers can overwrite each other's Thread changes. The
  server owns everything else.
- **Proposal states**: `open → pending → decided`; Undo is `pending → open`. `attempt` names the
  click that made the choice, `undoUntil` (epoch ms) closes its window, `cancelledAttempts` keeps
  undone clicks from coming back. The server writes `pending` to disk before it answers, and logs
  `decision` once, when `undoUntil` passes — re-armed from the store after a restart.
- **Opened vs default**: `openedAt` is set once, by `/api/proposal-opened` or the first choice.
  `GET /api/state` adds a derived `decisions` list, one entry per Proposal: `{id, region, question,
  suggested, reading, answer, openedAt, decidedAt}`, where `reading` is `kept-as-proposed`,
  `changed`, `opened-undecided` (a choice still inside its undo window reads so too), or
  `not-opened-default-stands`. **Not opened is never agreement:** the human did not see the
  options. `poll.sh --decisions` prints one line per Proposal from it.
- Normal UI actions do not delete Threads. A Thread whose Region left the document stays under its
  Region Key; a later Ready that brings the Region back reattaches it.
- **Attention is not in the store.** The page derives it from `changed`, `updates`, `proposals`
  and `commentState`.
- The `log` is a **bounded monotonic event stream** (`seq` strictly increases), at most 5,000
  entries, trimmed to the newest 4,000. It is observation history, not a backup.

## Endpoints

| Endpoint | Caller | Body | Effect |
|---|---|---|---|
| `GET /api/state` | both | — | Full store plus the derived `decisions` (also the health check) |
| `POST /api/state` | UI | `{threads}` | Thread autosave — replaces `threads` wholesale |
| `POST /api/ready` | agent | `{changed:[regionKey]}` | **Publish.** Marks those Regions changed and logs `ready`; open pages swap exactly those Regions |
| `POST /api/ack` | UI | `{region}` | Clears an existing changed marker and logs `ack` |
| `POST /api/update` | agent | `{region, title, body?}` | Durable agent message that asks for nothing |
| `POST /api/update-dismiss` | UI | `{id}` | The human dismissed it |
| `POST /api/send` | UI | `{region, id}` | Dispatches one Thread → logs `sent` **with the comment inline**; clears that Region's changed marker |
| `POST /api/thread-message` | UI | `{region, id, msg?, attachments?}` | The human writes into a sent Thread → logs `sent` with `followUp` (`"(image)"` when only images) and `attachments` |
| `POST /api/attach` | UI | `{type, data}` | A pasted image, base64, at most 10 MB → `{url:"/.review/attachments/<file>"}` |
| `POST /api/reply` | agent | `{region, id, msg, state?}` | Appends an agent message; `state` bumps the lifecycle in the same call |
| `POST /api/comment-reject` | UI | `{region, id, msg}` | Needs an implemented Thread and a non-empty message; sets `rejected`, logs `comment-rejected` |
| `POST /api/comment-state` | both | `{region, id, state}` | Non-rejection lifecycle: the agent drives `acknowledged`/`in_progress`/`implemented`, the UI `accepted` |
| `POST /api/propose` | agent | `{region, question, options[], suggested?, threadId?, anchor?}` | Asks the human. `suggested` (default `0`) is the index of the recommended option; `400` outside the options. `409` while that Region or Thread has an `open` or `pending` Proposal |
| `POST /api/decide` | UI | `{id, attempt, choiceIndex}` or `{id, attempt, custom}` | `404` unknown; `400` without an attempt, with both or neither of `choiceIndex`/`custom`, or an index outside the options; `409` when not open or the attempt was undone. Sets `pending` with `undoUntil`, logs `decision-pending`. The same attempt again answers `200` with `repeated:true` |
| `POST /api/proposal-opened` | UI | `{id}` | The Proposal's options reached the screen: sets `openedAt` the first time and logs `proposal-opened` (never wakes the agent). `404` unknown |
| `POST /api/undo-decision` | UI | `{id, attempt}` | Before `undoUntil`: back to `open`, logs `decision-undone`. `409` after the window or for another attempt's token |
| `POST /api/explain-request` | UI | `{id, optionIndex, answer}` | The human asks what an option means → logs `explain-request` |
| `POST /api/explain` | agent | `{id, optionIndex, text}` | The answer, shown under that option |
| `POST /api/event` | both | `{kind, region?, data?, wake?}` | Custom event. With `wake:true` logs `command` with `action:kind`, for bespoke human buttons such as sign-off |
| `GET /api/poll?cursor=N` | both | — | Long-poll (~25 s): `{cursor, events}` with `seq > N`, or no events on timeout |
| `GET /<path>` | browser | — | Static from `ROOT`, HTTP Range for video/audio; `/` serves `UI` |

## Ready — how content changes reach the human

The first browser load reads the HTML directly; it needs no Ready.

1. Rewrite the HTML file on disk.
2. `POST /api/ready {"changed":["v03/safe-zone","v04"]}` with only the edited leaf Regions.
3. Every open page refetches its URL and replaces **only those Regions**. Hosts inside them draw
   again with their drafts; focus and caret return to the kernel field the human was in; scroll
   stays. Then `atelier:ready` fires, so the page re-applies its own selection and tabs.

A named Region missing from the new file is a typo: the page shows a warning naming it. A named
Region new to the page is a structural change: the page saves drafts and reloads. A changed marker
**accumulates** across Readys until the human clears it with ✓ Seen, sends a Thread in that Region,
or a decision there is final.

## Poll semantics

- Start at `cursor=0` (or your persisted cursor), advance to the returned `.cursor`, re-poll
  immediately. Empty `events` on timeout is normal. The log replays only what it retains; read
  `GET /api/state` for current durable state.
- The agent runs **one** `poll.sh`; each page runs its own loop with its own cursor, advanced only
  past events it has handled.

### How the poll wakes the agent

**Primary — `--stream` under the Workbench monitor.** One `spawn` watcher for
`BASE_URL=<exact-url> bash <absolute-poller-path> --stream`, `recoveryPolicy:"never"`, a
URL-specific reuse key, and `notifyOn` for `SENT`, `DECISION`, `EXPLAIN-REQUEST`,
`COMMENT-REJECTED`, `COMMAND`, `SERVER-DOWN`, `SERVER-UP`. It prints one line per waking event and
never exits on events.

**Fallback — `--once` exit-to-wake.** For harnesses that re-invoke the agent when a background task
exits: it polls until a human-origin event arrives, prints it, persists the cursor, and exits `0`.
Act, then re-arm. `--tail` prints every kind for a human watching a terminal. `--decisions` prints one
`DECISION-STATE` line per Proposal (kept as proposed, changed, opened but undecided, or not opened —
default stands, NOT agreement) and exits.

**Wake kinds** (`WAKE_KINDS`, csv): `sent`, `decision`, `explain-request`, `comment-rejected`,
`command`. Everything else is filtered, and three exclusions are load-bearing:

- **`ready`** is the agent's own announcement; waking on it would make the agent answer itself.
- **`update` and `explanation`** are agent → human messages.
- **`decision-pending` and `decision-undone`** are an answer still inside its undo window. The
  agent must not act on it; `decision` follows when the window closes.

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

## Extending

Add task endpoints in the marked section of the copied `tools/review-server.mjs` and call them
from your own HTML. Never repurpose a protocol endpoint's shape.

The kernel cannot pick inside an iframe. A Surface that embeds a cooperating app — one that reports
clicked elements over `postMessage` — records the human's note with `POST /api/event` and
`wake:true`, carrying the route, selector, and text in `data`. Promote that into the kernel only when
a second Surface needs it.
