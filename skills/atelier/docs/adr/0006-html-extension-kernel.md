# Atelier extends HTML; author-placed hosts replace the margin and the frame

Supersedes the frame and the margin of [ADR 0005](0005-anchored-threads-replace-region-threads.md):
`<atelier-margin>`, the mandatory three-part frame (header with `<atelier-activity>`, content,
margin), the narrow-screen bottom list, and the removal of the reveal resolver. ADR 0005's anchors,
Threads as conversations, Activity drawer, and Ready swaps stand. `<atelier-region>` from
[ADR 0001](0001-one-region-replaces-card-and-section.md) becomes the `atl-key` attribute; the
Region itself is unchanged.

## Context

The owner, 2026-10-01: the skill is too focused on documents, the previous Atelier was better, and
Atelier should provide the kernel and interaction interfaces the way htmx extends HTML.

The history of the skill and of every Surface built from it (2026-08 to 2026-10) shows:

- **The frame made every Surface a document.** The old PhotoQuest review was a list/detail
  workspace of 27 records; both rebuilds on the current skill became 3,400–3,800 px of stacked
  prose, because the frame left one content column and one margin. The margin took 461 px at
  1440 px and was about 1.5% filled.
- **Decisions hid their options.** Open Proposals collapsed to one line and took two steps
  (pick, then Decide). Both rebuilds built workarounds. The owner asked for visible one-click
  decisions and, separately, complained about accidental ones; the old kit answered both with one
  click and a 30-second undo, patched locally (PhotoQuest-studio 71998f9). That patch logged
  `decision` immediately, so the agent was woken inside the window the owner's rule forbids.
- **Liked:** annotating the real thing in place; Threads level with their anchor; workspaces with
  side-by-side panes over long documents; visible, specific attention that jumps to the item.
- **Disliked:** kernel-placed chrome stacked away from its content; "comment on this region"
  boxes everywhere; coarse Regions; accidental decisions; lost human input.
- **Local kit patches are missing kernel features:** server-side undo, identity decoupled from
  layout position (`data-thread-key` in the fotoaufgaben kit), hand-rolled pickers and poll
  loops, and focus repair around kernel re-renders.
- **Kernel bugs:** the page's poll cursor read `S.seq`, which a refresh overwrites, so an event
  logged during the refresh was skipped; `post()` treated a non-2xx as success and drafts were
  cleared; `/api/decide` validated nothing and logged a duplicate decision on every click;
  preflight looked for `.atl-warn` while the kernel renders `.atl-warnings`, so no kernel warning
  ever failed a handoff; `<atelier-region>` cannot be a table row, because the HTML parser moves
  it out of the table.

## Decision

The author builds whatever HTML the task needs. The kernel adds addresses, a durable conversation
per address, and the event loop to the agent, and inserts nothing into authored content uninvited.

| Interface | Contract |
|---|---|
| `atl-key="local"`, `atl-label` | A Region on any element, a `<tr>` included. Nested keys form `a/b`. |
| `atl-thread="a/b"` on a button | Opens a whole-Region Thread draft; an empty value means the closest Region. |
| `<atelier-host for="a/b">` | Renders Threads and Proposals for that key and below; the longest whole-path `for` wins (`c6` never claims `c64`). Opt-in: the kernel never creates one. Two with one `for` warn and fail preflight. |
| `<atelier-host>` | The one catch-all: unclaimed items, Threads whose Region left the page, failed reveals. |
| `layout="anchored"` | Cards level with their anchors while the host sits beside its content; plain flow when it is fixed or stacked under it. |
| `<atelier-activity>` | Exactly one, anywhere: Pick, the "N waiting" drawer with Undo for just-chosen options, notifications. |
| `atl-changed`, `atl-anchor`, `atl-active`, `atl-hover`, `atl-pick` | State the kernel sets on authored elements, as attributes only. |
| `atelier:state`, `getState()` | The store and every Thread, Proposal and Update with whether it waits for the human. |
| `setRevealResolver(fn)`, `reveal()` | One awaited resolver (2 s) makes the target reachable; the kernel then opens `<details>`, scrolls, and focuses the card. A failure warns and moves the item to the catch-all. |

Decisions are one click with a visible undo. `/api/decide` validates the Proposal, the option or
custom answer, and an attempt token, then stores `pending` with `undoUntil` before it answers.
`/api/undo-decision` returns it to `open`. The server logs `decision`, the only event that wakes
the agent, once `undoUntil` passes — exactly once, re-armed from the store on boot. `UNDO_MS`
(default 30000) sets the window.

Drafts — new Threads, replies, custom answers, explanation requests — live in kernel memory and
session storage, come back after any host re-render, Ready, or reload, and are cleared only after
the server answers 2xx. The page polls with its own cursor.

Preflight checks hosts instead of the frame: exactly one Activity, at most one catch-all, no
duplicate `for`, every open Proposal and implemented Thread hosted and brought on screen by
`reveal()`, at 1440×900, 390×844 and 412×915. The prose check becomes a warning; the one-sentence
rule stays inline in SKILL.md.

## Admission check (docs/principles.md)

- **Human action made easier:** deciding with one click where the evidence is, taking it back
  within 30 seconds, finding a record's conversation inside that record, and keeping a half-typed
  reply through a failed send or a Ready.
- **Session steps:** removed — authoring the frame, measuring header height, building fake
  decision buttons, patching undo into the copied server. Added — placing hosts, and three lines
  of reveal resolver on a page that hides records.
- **Why not local:** the frame and the margin are kernel requirements every Surface inherited;
  the undo window must hold back the wake event, which only the server can do; draft loss and the
  skipped poll event are kernel bugs. Each recurred on two or more Surfaces (see Context).
- **Bounded check:** `scripts/verify.mjs` drives the fixture in a real browser (keyed table rows, a
  Proposal arriving in a hidden record, reveal through the resolver, one click, Undo, exactly one
  delayed `decision`, draft survival, duplicate and missing hosts, 390 px);
  `scripts/test-atelier.sh` covers validation, undo, the delayed event across a crash, and the
  poller filter. Each new gate was run against its defect.

## Consequences

- No compatibility layer. A copied kit keeps working with its own markup; adopting this kernel
  means re-copying the kit and replacing `<atelier-region key>` with `atl-key`, `<atelier-margin>`
  with a host. Preflight's kit gate reports the drift. Stores keep loading: Region Keys and Thread
  shapes did not change, and old Proposals are `open` or `decided`.
- An item can be out of reach when a Surface places no host for it and no catch-all; preflight
  fails that, and the kernel warns when a Thread is started there.
- The kernel's chrome strings stay English.

## Deferred under Principle 4

Each waits for an observed failure that a local fix cannot solve.

- Morphing Ready (idiomorph) and `atl-keep` — when a Ready loses an open `<details>`, a playing
  video, or an authored input the human was using.
- `atl-count`, `atl-ignore`, per-action DOM events — when a second Surface copies the same count
  snippet, a pick misfires inside an embedded widget, or `atelier:state` is not enough.
- A MutationObserver for author markup — never needed while hosts are custom elements and Regions
  are looked up lazily.
- Inserting new Regions without a reload — when Readys add Regions in normal use.
- An Alpine recipe — when a Surface uses Alpine.
- iframe picking, multi-browser Thread merge, batch decisions — when a second Surface needs them.
- Localized kernel chrome — a candidate: the plan4 Surface rewrote kernel strings with a
  MutationObserver.
- The list/detail eval problem — a separate follow-up in the private eval suite.
