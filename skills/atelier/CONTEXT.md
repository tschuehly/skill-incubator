# Atelier

A task-shaped HTML workspace where a human and an agent interact through structured, addressable
content instead of a chat log. Atelier extends HTML with a reusable API, kernel, and components for
that interaction; the agent authors the content, its form, and its layout.

## Language

**Surface**:
One HTML document, backed by one durable store, served on one port. A Surface holds exactly one
Region tree.
_Avoid_: page, review page, artifact, UI

**Region**:
An addressable, nestable part of a Surface with a stable key. Regions nest freely; the document
tree is the hierarchy. A Region is the unit a Ready replaces and owns every Anchor inside it; the
kernel inserts nothing into it.
_Avoid_: Card, Section, item, block

**Region Key**:
The identity of a Region: the path of local keys from the root Region down to it. Moving or
renaming a Region produces a different Region.

**Ready**:
The agent's declaration that the Surface is at a coherent point, naming the Regions whose meaning
changed. Ready is the only thing that updates what the human sees.
_Avoid_: publish, done, refresh, revision

**Anchor**:
What a Thread or Proposal points at inside a Region: a quoted passage, an element, a point on an
image, or the whole Region. A text Anchor survives rewording around its quote; one whose target
is gone is detached and says so.
_Avoid_: pin, highlight, selection

**Margin**:
The column where every Thread and Proposal appears, level with its Anchor. The Surface places one,
outside every Region.
_Avoid_: sidebar, gutter, comment panel

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
An agent-raised question with named options, shown in the Margin at its Anchor, answered by the
human choosing one or writing a custom answer. Every question the agent has takes this form.
_Avoid_: decision request, poll, prompt

**Update**:
A durable, informational message from the agent that needs no answer, about a Region, shown in
Activity and dismissed by the human. Anything needing an answer is a Proposal instead.
_Avoid_: notification, status, message

**Activity**:
The header tools and drawer that list current Attention and return each row to its exact card.
The Surface places it in its own fixed header.
_Avoid_: inbox, dashboard, Cockpit
