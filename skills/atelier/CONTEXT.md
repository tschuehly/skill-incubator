# Atelier

A task-shaped HTML workspace where a human and an agent interact through structured, addressable
content instead of a chat log. Atelier extends HTML the way htmx does: the agent authors any page
the task needs, and the kernel adds addresses, durable interaction, and the event loop.

## Language

**Surface**:
One HTML document, backed by one durable store, served on one port. A Surface holds exactly one
Region tree.
_Avoid_: page, review page, artifact, UI

**Region**:
An element of the Surface that carries `atl-key` — a record, a table row, a step, a diagram box.
Regions nest freely; the document tree is the hierarchy. A Region is the unit a Ready replaces and
owns every Anchor inside it; the kernel inserts nothing into it except the Hosts the author places
there.
_Avoid_: Card, Section, item, block

**Region Key**:
The identity of a Region: the path of local keys from the outermost Region down to it, such as
`rollout/provider`. Moving or renaming a Region produces a different Region.

**Ready**:
The agent's declaration that the Surface is at a coherent point, naming the Regions whose meaning
changed. Ready is the only thing that updates what the human sees.
_Avoid_: publish, done, refresh, revision

**Anchor**:
What a Thread or Proposal points at inside a Region: a quoted passage, an element, a point on an
image, or the whole Region. A text Anchor survives rewording around its quote; one whose target
is gone is detached and says so.
_Avoid_: pin, highlight, selection

**Host**:
An author-placed `<atelier-host>` where the kernel shows the Threads and Proposals of one Region Key
and the Regions below it, unless a Host for a longer key claims them. The one Host without a key is
the catch-all: it takes what no other Host claims, Threads whose Region left the Surface, and items
a reveal could not show. An anchored Host keeps each card level with its Anchor; a collapsible Host
folds away and reserves no width until one of its cards opens.
_Avoid_: margin, sidebar, comment panel

**Attention**:
A derived, unresolved item that belongs to the human: an open Proposal, a Thread waiting for their
verdict, a changed Region, or an undismissed Update. Attention is never stored directly — it is
computed from state. A changed Region accumulates across Readys until the human clears it, either
explicitly or by acting on the Region.
_Avoid_: notification, alert, todo, task

**Thread**:
A human-started conversation on an Anchor. Both sides write into it until the human accepts the
result. A Thread whose Region disappears is kept, never deleted.
_Avoid_: comment (the individual message), note, annotation

**Proposal**:
An agent-raised question with named options, shown in the Host of its Region, answered by the human
with one click on an option or with their own words. The answer is **pending** for the undo window
(30 seconds), during which the human can take it back and the agent hears nothing; then it is
**decided** and the agent is told. Every question the agent has takes this form.
_Avoid_: decision request, poll, prompt

**Update**:
A durable, informational message from the agent that needs no answer, about a Region, shown in
Activity and dismissed by the human. Anything needing an answer is a Proposal instead.
_Avoid_: notification, status, message

**Building block**:
An optional kit element that renders a short text body — a claim tree, diagram, chart, file, video,
before/after pair, mockup, findings list, decision, zoomable flow, timeline, or tabs — inside a
Region. It is content, not protocol: it holds no server state, only view state such as an open tab.
_Avoid_: widget, component, snippet

**Content shape**:
The arrangement of a Surface chosen for the problem: a claim tree for a plan, an evidence and
decision board for a review queue, a flow with drill-down for a pipeline, a comparison, a timeline,
a list/detail workspace. None is the default.
_Avoid_: template, layout, frame

**Opened**:
A Proposal whose options have been on the human's screen, recorded once. A Proposal decided, opened
but undecided, and never opened are different readings; a default that was never opened is not
agreement.

**Activity**:
The one widget the Surface places wherever it fits: Pick-to-comment, a drawer listing Attention and
pending answers with their Undo, and desktop notifications. Each row returns to its exact card.
_Avoid_: inbox, dashboard, Cockpit
