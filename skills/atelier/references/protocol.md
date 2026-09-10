# Protocol — the contract between the document, the kernel, the server, and the agent

Everything here is what `assets/atelier.mjs` and `assets/server.mjs` implement and `assets/poll.sh`
speaks. Extend beside it, not through it: `poll.sh`, `preflight.mjs` and future agents rely on these
shapes.

The division of labor never moves. **You author every visible element.** The kernel supplies
identity, durable state, and behavior, and confines its own chrome to `.atl-*` class names so your
content library cannot restyle the protocol and the protocol cannot restyle your content.

## Kernel elements

Load them with one module tag and one stylesheet; both are served by the server from its own
directory:

```html
<link rel="stylesheet" href="/atelier.css">
<script type="module" src="/atelier.mjs"></script>
```

### `<atelier-region>` — the unit of everything

```html
<atelier-region key="onboarding" label="Onboarding">
  <atelier-region key="provider" comments="side"> … </atelier-region>
</atelier-region>
```

| Attribute | Meaning |
|---|---|
| `key` | Local key. **Required, unique among its siblings.** The Region Key is the `/`-joined path of local keys from the root: `onboarding/provider`. Preflight fails a missing or duplicate key. |
| `comments` | Thread placement: `below` (default), `side`, `sheet`. See [composition.md](composition.md#place-the-thread). |
| `label` | Human name used in Attention and the Cockpit. Defaults to the Region's first heading. |

A Region mounts its own chrome — a comment button, an Attention marker, and hosts for Updates and
Proposals — and hosts a Thread according to its placement. Nesting is the hierarchy; there is no
separate card or section concept.

### `<atelier-comments>` — the Thread

Mounted automatically for `below` and `side` placements; `sheet` opens on demand. Place one
explicitly, anywhere, with `for="<region-key>"` to pin a Thread outside its Region — a fixed review
column, for example. Thread textareas use ⌘+Enter to send and Enter for a newline. Escape closes a
sheet Thread and returns focus to its Region's comment button. Existing quote anchors render with a
Thread, but the kernel has no browser path to create one.

### `<atelier-attention>` — one marker, four shapes

```html
<atelier-attention mode="dot"></atelier-attention>
<atelier-attention for="onboarding" mode="count" owner="human"></atelier-attention>
```

| Attribute | Meaning |
|---|---|
| `for` | Region Key. Defaults to the enclosing Region. |
| `mode` | `badge` (default) · `dot` · `count` · `label` |
| `owner` | Filter to `human` (waiting on the human) or `agent` (waiting on the agent). Empty = both. |

`badge` shows the most urgent kind plus `+N` for whatever waits behind it, and carries the ✓ that
clears a `changed` marker. `count` **rolls up every descendant Region**, so a root-level count is
the Surface's open-loop total. `label` shows its own slotted text when there is anything open.
Attention is derived from state on every change and is never stored.

Kinds and their owner: `changed`, `update`, `decision`, `verdict` wait on the human; `request`,
`rework`, `explanation` wait on the agent.

### `<atelier-proposal>` and `<atelier-update>`

Both auto-mount inside every Region and render nothing when empty, so an agent message can never be
invisible. Place one explicitly with `for="<region-key>"` only to move it somewhere else. A
Proposal renders its options, a per-option "ask about this" control, any explanation that came back,
and a multiline free-text answer. Rejection reasons and explanation questions also expand beside
the interaction instead of opening a browser prompt. Proposal drafts, focus, and caret survive
store refreshes; drafts also survive a browser reload in local storage.

### `<atelier-cockpit>` — every open loop

```html
<atelier-cockpit owner="human"></atelier-cockpit>
```

Lists Attention across the whole Surface, filtered by whose turn it is. Each row carries
`data-goto` (Region Key), `data-kind`, and the exact `data-interaction-id`: the Region Key for
`changed`, Update id for `update`, Proposal id for `decision`, `<proposal-id>:<option-index>` for
`explanation`, and comment id for `request`, `verdict`, or `rework`. Activating it reveals and
focuses the unresolved Update, Proposal, or Thread control instead of stopping at the Region; that
focus survives unrelated store events while the interaction remains unresolved. The Cockpit also
carries the desktop-notification switch, which fires only for an Update and a Ready. It is never
auto-mounted: a one-Region Surface does not need one, and the kernel never chooses Cockpit geometry.

A dynamic Surface registers one resolver for its own search, filters, selection, or conditional
Region mount. The kernel calls it before mounting Region chrome and finding the interaction:

```html
<script type="module">
  import { setRevealResolver } from '/atelier.mjs';

  setRevealResolver(async ({ region }) => {
    clearSearchHiding(region);     // Surface-owned filter update
    await selectAndMount(region); // Surface-owned selection and mount
  });
</script>
```

The resolver changes authored view state; it does not store Attention. It may return a Promise when
mounting is asynchronous. The latest `setRevealResolver` call replaces the prior resolver;
`setRevealResolver(null)` clears it. Cockpit rows call `reveal({ region, kind, id })`; the legacy
`reveal(regionKey)` shorthand targets the Region itself. Reveal returns a boolean or, for an
asynchronous resolver, a Promise of one; a failed exact return shows a kernel warning instead of
claiming success. Static Surfaces need no resolver. Keep the Cockpit
viewport-reachable as described in [composition.md](composition.md#place-attention).

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
  "threads":  { "<regionKey>": [ { "id":"k3-…", "text":"…" } ] },
  "sent":     { "<commentId>": "<iso>" },
  "replies":  { "<commentId>": [ { "ts":"<iso>", "msg":"…", "author":"agent|human" } ] },
  "commentState": { "<commentId>": { "value":"implemented", "ts":"<iso>" } },
  "proposals":{ "<propId>": { "id","region","threadId","question","options":[],
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
  Unsent drafts additionally live in that browser's `localStorage`, so a store update mid-sentence
  cannot overwrite what the human is typing.
- Normal UI actions do not delete Threads. A Thread whose Region left the document stays under its
  Region Key and keeps its replies and lifecycle; a later Ready that brings the Region back
  reattaches it. There is no view for orphaned Threads yet — they are preserved, not surfaced.
- **Attention is not in the store.** It is derived from `changed`, `updates`, `proposals` and
  `commentState` every time state changes.
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
| `POST /api/reply` | agent | `{region, id, msg, state?}` | Appends an agent message to the Thread; the optional `state` bumps the lifecycle in the same call |
| `POST /api/comment-reject` | UI | `{region, id, msg}` | Requires an implemented comment and a non-empty follow-up; stores the message, sets `rejected`, logs `comment-rejected` |
| `POST /api/comment-state` | both | `{region, id, state}` | Non-rejection lifecycle. Agent drives `acknowledged`/`in_progress`/`implemented`; the UI drives `accepted`. An optional improvement is accepted first, then sent as a new Thread |
| `POST /api/propose` | agent | `{region, question, options[], threadId?}` | Asks the human to decide beside the material. Returns `409` while that Region or Thread already has an open Proposal; leave it visible and use an Update if its context changed |
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
   Scroll position, open Threads, and half-typed drafts survive. Regions you did not name are not
   touched.

Two failure modes are handled explicitly, because both are silent otherwise:

- A named Region the page does not contain **and** the new document does not contain either is a
  typo. The page shows a warning banner naming it, and preflight fails on that banner.
- A named Region that exists in the new document but not in the open page is a structural change,
  not a content change. The page reloads rather than guessing where it belongs.

Attention **accumulates** across Readys until the human clears it with ✓, sends a comment, or
answers a Proposal in that Region, so publishing three times before they look does not lose the
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

- **`sent`** — a comment was dispatched, carried inline. Acknowledge → triage → fix → reply.
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

# ask the human to decide, recommended option FIRST
curl -s -X POST "$BASE_URL/api/propose" -H 'Content-Type: application/json' \
  -d '{"region":"onboarding/provider","question":"Which order?",
       "options":["Provider first (recommended)","Ingest first"]}'

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
