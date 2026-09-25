# Protocol — the contract between the document, the kernel, the server, and the agent

Everything here is what `assets/atelier.mjs` and `assets/server.mjs` implement and `assets/poll.sh`
speaks. Extend beside it, not through it: `poll.sh`, `preflight.mjs` and future agents rely on these
shapes.

The division of labor never moves. **You author the content and the layout.** The kernel supplies
identity, durable state, and interaction — anchors, Threads, Proposals, Activity, Ready — and
confines its own chrome to its elements and `.atl-*` class names, so your content library cannot
restyle the protocol and the protocol cannot restyle your content.

## Kernel elements

Load them with one module tag and one stylesheet; both are served by the server from its own
directory:

```html
<link rel="stylesheet" href="/atelier.css">
<script type="module" src="/atelier.mjs"></script>
```

The kernel inserts nothing into authored content. It styles only its own three elements, its
floating "💬 Thread" button, and state classes it toggles on your elements (`atl-el-anchor`,
`atl-el-active`, `atl-el-hover`, `atl-pick-hover`, `atl-changed`).

### `<atelier-region>` — identity and address

```html
<atelier-region key="rollout" label="Rollout">
  <atelier-region key="cutover" label="Step 3 · Cutover"> … </atelier-region>
</atelier-region>
```

| Attribute | Meaning |
|---|---|
| `key` | Local key. **Required, unique among its siblings.** The Region Key is the `/`-joined path of local keys from the root: `rollout/cutover`. Preflight fails a missing or duplicate key. |
| `label` | Human name used in the margin and the Activity drawer. Defaults to the Region's first heading. |

A Region is the unit a Ready replaces, a Thread belongs to, and a changed marker names. Nesting is
the hierarchy.

### Anchors — what a Thread or Proposal points at

```jsonc
{ "region": "rollout/cutover",            // required: the owning Region Key
  "quote": "flag flip", "prefix": "is a ", // text: the quoted passage and up to 32 chars before it
  "selector": ":scope > div > p:nth-of-type(2)", // element, relative to the Region
  "point": { "x": 0.25, "y": 0.5 } }       // a point on an IMG or SVG, relative to its box
```

Only `region` means the whole Region. The human creates anchors three ways: select text and click
the floating "💬 Thread" button; Alt+click any element; or press "💬 Comment on…" in the Activity
tools and click. Text anchors resolve again by `quote` + `prefix` after every Ready, so rewording
around a quote keeps it; removing the quoted words detaches it. A detached anchor falls back to its
Region and its card says so. Preflight fails while any stored anchor is detached or its Region is
gone.

### `<atelier-margin>` — Threads and Proposals, level with their anchors

```html
<div class="page"><main> …Regions… </main><atelier-margin></atelier-margin></div>
```

Place exactly one, **outside every Region** — a Ready would otherwise replace it with the human's
half-typed Thread. Give it its own column; 320px suits most Surfaces. Each card sits at its anchor's
height and is pushed down to avoid overlap; the expanded card sits exactly at its anchor. Collapsed
Threads show one line; decided Proposals collapse to "✓ Decided · …". Hovering a card highlights its
anchor; clicking anchored text or an anchored element opens its card. Text anchors render through
the CSS Custom Highlight API, element anchors as an outline.

A Thread card is the whole conversation: the human's first message, every reply from either side,
the lifecycle label, and a reply box (⌘+Enter sends, Enter inserts a newline). On `implemented` it
offers Accept and Reopen; Reopen needs the reply box to say what is still wrong. A Proposal card
shows the question, options with the recommended one first, a per-option "Explain this option"
request, any explanation that came back, and a free-text answer. Unsent new Threads survive a
reload in `localStorage`; every textarea keeps its value, focus, and caret across store updates.

Below 1100px the margin becomes a fixed bottom list without anchoring.

### `<atelier-activity>` — header tools and the drawer

```html
<header class="top"><b>Title</b><nav>…</nav><atelier-activity></atelier-activity></header>
```

Place exactly one, outside every Region, in a Surface-authored sticky header. It renders two
buttons — "💬 Comment on…" (Pick mode; Escape leaves it) and one that reads "N waiting for you" or
"Activity" — and a native `popover` drawer from the right, grouped:

- **Waiting for you** — open Proposals and `implemented` Threads; a row reveals its exact card.
- **Changed since you looked** — Regions named by Ready; the label scrolls there, ✓ Seen clears it.
  A changed Region also gets a left-edge marker.
- **Updates** — title, body, Dismiss.

The drawer also holds the desktop-notification switch. Notifications are on by default: the kernel
asks for permission on the human's first click, and notifies of replies, Proposals, Updates, and
Readys while the tab is hidden. Set `--atl-header-height` on `:root` to your header's height so the
drawer opens below it.

### Module exports

`reveal(id)` scrolls to a Thread's or Proposal's anchor and expands its card. `refresh()` rereads
the store. `unresolvedAnchors()` lists stored anchors that no longer resolve; preflight uses it.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4747` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; keep loopback unless remote access is explicitly intended |
| `ROOT` | `<server-dir>/..` | Directory served statically (usually the project root) |
| `UI` | `<server-dir>/surface.html` | HTML file served at `/` |
| `STORE` | `atelier` | Store name → `.review/<STORE>.json` (use a batch id or date for parallel loops) |

## Durable store (`.review/<STORE>.json` — gitignore it)

```jsonc
{
  "name": "2026-07-11",
  "threads":  { "<regionKey>": [ { "id":"c-…", "text":"…", "anchor":{ "region":"…", "quote":"…" } } ] },
  "sent":     { "<commentId>": "<iso>" },
  "replies":  { "<commentId>": [ { "ts":"<iso>", "msg":"…", "author":"agent|human" } ] },
  "commentState": { "<commentId>": { "value":"implemented", "ts":"<iso>" } },
  "proposals":{ "<propId>": { "id","region","threadId","anchor","question","options":[],
                              "explanationRequests":{}, "explanations":{},
                              "status":"open|decided","choiceIndex","custom","ts" } },
  "updates":  { "<updId>": { "id","region","title","body","ts","dismissedAt" } },
  "changed":  { "<regionKey>": { "ts":"<iso>" } },
  "log":      [ { "seq":1, "kind":"sent", "region":"…", "id":"…", "ts":"…" } ],
  "seq": 1
}
```

- Every address is a **Region Key**. There is no second addressing scheme.
- **Ownership**: one active browser owns `threads`; its `POST /api/state` autosave replaces that
  collection wholesale. Two active browsers can overwrite each other's Thread changes. The server
  owns everything else. `commentState` is server-owned so autosave cannot clobber a lifecycle.
  Unsent new Threads live in that browser's `localStorage` until sent, so a store update
  mid-sentence cannot overwrite what the human is typing.
- Normal UI actions do not delete Threads. A Thread whose Region left the document stays under its
  Region Key and keeps its replies and lifecycle; a later Ready that brings the Region back
  reattaches it. Meanwhile its card stays at the end of the margin, saying its section is gone.
- **Attention is not in the store.** The Activity drawer derives it from `changed`, `updates`,
  `proposals` and `commentState` every time state changes.
- The `log` is a **bounded monotonic event stream** (`seq` strictly increases). It keeps at most
  5,000 recent entries, trimming to the newest 4,000 when full. The agent and page consume it
  through the same long-poll with independent cursors; it is observation history, not a backup.

## Endpoints

| Endpoint | Caller | Body | Effect |
|---|---|---|---|
| `GET /api/state` | both | — | Full store (also the health check) |
| `POST /api/state` | UI | `{threads}` | Keystroke autosave — replaces `threads` wholesale |
| `POST /api/ready` | agent | `{changed:[regionKey]}` | **Publish.** Marks those Regions changed and logs `ready`; the open page refetches the document and swaps exactly those Regions in place |
| `POST /api/ack` | UI | `{region}` | Clears an existing changed marker and logs `ack` |
| `POST /api/update` | agent | `{region, title, body?}` | Durable agent message that asks for nothing |
| `POST /api/update-dismiss` | UI | `{id}` | The human dismissed it |
| `POST /api/send` | UI | `{region, id}` | Dispatches ONE comment → logs `sent` **with the comment inline**; clears that Region's existing changed marker |
| `POST /api/thread-message` | UI | `{region, id, msg}` | The human writes into a sent Thread → stores the message with `author:"human"` and logs `sent` with `followUp:<msg>`, waking the agent |
| `POST /api/reply` | agent | `{region, id, msg, state?}` | Appends an agent message to the Thread; the optional `state` bumps the lifecycle in the same call |
| `POST /api/comment-reject` | UI | `{region, id, msg}` | Requires an implemented comment and a non-empty follow-up; stores the message, sets `rejected`, logs `comment-rejected` |
| `POST /api/comment-state` | both | `{region, id, state}` | Non-rejection lifecycle. Agent drives `acknowledged`/`in_progress`/`implemented`; the UI drives `accepted`. An optional improvement is accepted first, then sent as a new Thread |
| `POST /api/propose` | agent | `{region, question, options[], threadId?, anchor?}` | Asks the human to decide beside the material. Placement: `anchor`, else the Thread's anchor, else the Region. Returns `409` while that Region or Thread already has an open Proposal; leave it visible and use an Update if its context changed |
| `POST /api/decide` | UI | `{id, choiceIndex?, custom?}` | Resolves it → logs `decision`; clears the Proposal Region's existing changed marker; `custom` is the human's own wording |
| `POST /api/explain-request` | UI | `{id, optionIndex, answer}` | The human asks what an option means → logs `explain-request`, waking the agent |
| `POST /api/explain` | agent | `{id, optionIndex, text}` | The answer, stored on that option → page-facing `explanation` |
| `POST /api/event` | both | `{kind, region?, data?, wake?}` | Custom event. With `wake:true` logs canonical `command` carrying `action:kind` — use it for bespoke human buttons such as sign-off. Without it, logs `kind` as page-facing state |
| `GET /api/poll?cursor=N` | both | — | Long-poll (~25 s): `{cursor, events}` with `seq > N`, or the same cursor and no events on timeout |
| `GET /<path>` | browser | — | Static from `ROOT`, HTTP Range for video/audio; `/` serves `UI`; `/atelier.mjs` and `/atelier.css` come from the server's own directory |

## Ready — how content changes reach the human

The first browser load reads the HTML directly; it needs no Ready. Use Ready only after the human
could have seen an earlier version.

1. Rewrite the HTML file on disk.
2. `POST /api/ready {"changed":["onboarding/provider","onboarding/step-3"]}` with only the edited
   leaf Regions—never unchanged ancestors or unrelated keys.
3. Every open page refetches its own URL, parses it, and replaces **only those Regions** in place.
   The margin and header sit outside Regions, so scroll position, open cards, half-typed drafts,
   focus, and caret survive; anchors resolve again against the new content. Regions you did not
   name are not touched.

Two failure modes are handled explicitly, because both are silent otherwise:

- A named Region the new document does not contain is a typo. The page shows a warning naming
  it, and preflight fails on that warning.
- A named Region that exists in the new document but not in the open page is a structural change,
  not a content change. The page saves unsent Threads and reloads rather than guessing where it
  belongs.

A changed marker **accumulates** across Readys until the human clears it with ✓ Seen, sends a
comment, or answers a Proposal in that Region, so publishing three times before they look does not lose the
first two. Each cleared marker logs `ack`; no marker means no stray `ack`.

## Poll semantics

- Start at `cursor=0` (or your persisted cursor), advance to the returned `.cursor` on every
  response, re-poll immediately. Empty `events` on timeout is normal.
- A cursor can replay only the retained bounded log. Read `GET /api/state` for current durable
  state; neither source is a recovery journal.
- The agent runs **one** singleton `poll.sh`; the page runs its own loop. Independent cursors, no
  conflict.

### How the poll wakes the agent

**Primary — `--stream` under the Workbench monitor.** One `spawn` watcher for
`BASE_URL=<exact-url> bash <absolute-poller-path> --stream`, `recoveryPolicy:"never"`, a
URL-specific reuse key, and `notifyOn` for `SENT`, `DECISION`, `EXPLAIN-REQUEST`,
`COMMENT-REJECTED`, `COMMAND`, `SERVER-DOWN`, `SERVER-UP`. It prints one compact line per waking
event and never exits on events. Stop it with `monitor_kill` when the review ends.

**Fallback — `--once` exit-to-wake.** Harnesses without a monitor re-invoke the agent when a
background task *exits*, not when it prints. `--once` long-polls until a human-origin event arrives,
prints it, persists the cursor, and exits `0`; act, then re-arm from the persisted cursor. `--tail`
prints every kind forever and is only for a human watching a terminal.

**Wake kinds** (`WAKE_KINDS`, csv): `sent`, `decision`, `explain-request`,
`comment-rejected`, `command`. Everything else is filtered, and two exclusions are load-bearing:

- **`ready` must never wake the agent.** It is the agent's own announcement to the page; waking on
  it would make the agent answer itself forever.
- **`update` and `explanation` must never wake the agent.** They are agent → human messages. The
  page consumes them; the poller drops them.

## Event kinds to react to

- **`sent`** — a comment was dispatched, carried inline with its `anchor`. Acknowledge → triage →
  fix → reply. With `followUp`, the human wrote again in an existing Thread; answer that message.
  The poller prints it as `SENT · <region> … — (follow-up) <text>`.
- **`decision`** — the human resolved a Proposal. `choiceIndex` identifies the option; `custom`
  carries their own wording and is authoritative when present. Act, then reply in the Thread.
- **`explain-request`** — the human asked what an option means. Use `proposalId`, `optionIndex` and
  `answer`, and post a decision-relevant explanation to `/api/explain`.
- **`comment-rejected`** — an implemented comment was judged incomplete; `msg` carries the required
  follow-up. Re-work it through `in_progress → implemented`.
- **`command`** — a human action posted with `wake:true`; `action` carries the bespoke kind.
- Ignore your own echoes (`reply`, `proposal`, `update`, `explanation`, `ready`) and the human's
  bookkeeping (`ack`, `update-dismissed`, `comment-state`).

## Agent-side snippets

```bash
BASE_URL=http://127.0.0.1:<port>

# acknowledge within seconds, before fixing — piggyback the lifecycle bump
curl -s -X POST "$BASE_URL/api/reply" -H 'Content-Type: application/json' \
  -d '{"region":"onboarding/provider","id":"<commentId>","msg":"Picked up: <plan>","state":"acknowledged"}'

# ask the human to decide beside the exact evidence, recommended option FIRST
curl -s -X POST "$BASE_URL/api/propose" -H 'Content-Type: application/json' \
  -d '{"region":"onboarding/provider","question":"Which order?",
       "options":["Provider first (recommended)","Ingest first"],
       "anchor":{"region":"onboarding/provider","quote":"provider must exist"}}'

# answer an explanation request (proposal id + optionIndex come from the event)
curl -s -X POST "$BASE_URL/api/explain" -H 'Content-Type: application/json' \
  -d '{"id":"prop-12","optionIndex":0,"text":"This option … Tradeoff: … Choose it when …"}'

# tell the human something without asking for anything
curl -s -X POST "$BASE_URL/api/update" -H 'Content-Type: application/json' \
  -d '{"region":"onboarding","title":"All six drafts re-rendered","body":"Steps 2 and 5 changed."}'

# publish rewritten content into the open page
curl -s -X POST "$BASE_URL/api/ready" -H 'Content-Type: application/json' \
  -d '{"changed":["onboarding/provider","onboarding/step-3"]}'
```

## Extending

Add task endpoints in the marked section of the copied `tools/review-server.mjs` (artifact
discovery, computed views, task actions), and call them from your own HTML. Never repurpose a
protocol endpoint's shape.

The kernel cannot pick inside an iframe. A Surface that embeds a cooperating app — one that reports
clicked elements over `postMessage` — records the human's note with `POST /api/event` and
`wake:true`, carrying the route, selector, and text in `data`. Promote that into the kernel only when
a second Surface needs it.
