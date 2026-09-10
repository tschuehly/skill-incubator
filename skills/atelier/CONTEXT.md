# Atelier

A task-shaped HTML workspace where a human and an agent interact through structured, addressable
content instead of a chat log. Atelier supplies identity, durable state, and interaction behavior;
the agent authors the content and its layout.

## Language

**Surface**:
One HTML document, backed by one durable store, served on one port. A Surface holds exactly one
Region tree.
_Avoid_: page, review page, artifact, UI

**Region**:
An addressable, nestable part of a Surface with a stable key. Regions nest freely; the document
tree is the hierarchy. A Region is the target of every Thread, Proposal, Update, and Attention
item.
_Avoid_: Card, Section, item, block

**Region Key**:
The identity of a Region: the path of local keys from the root Region down to it. Moving or
renaming a Region produces a different Region.

**Ready**:
The agent's declaration that the Surface is at a coherent point, naming the Regions whose meaning
changed. Ready is the only thing that updates what the human sees.
_Avoid_: publish, done, refresh, revision

**Attention**:
A derived, unresolved item that points at a Region and belongs to either the human or the agent.
Attention is never stored directly — it is computed from the Regions named by Ready, Proposals,
Thread state, and Updates. It accumulates across Readys until the human clears it, either
explicitly or by acting on the Region.
_Avoid_: notification, alert, todo, task

**Thread**:
A human-started conversation attached to a Region, optionally anchored to a quoted passage inside
it. A Thread whose Region disappears is archived, never deleted.
_Avoid_: comment (the individual message), note, annotation

**Proposal**:
An agent-raised question with named options, attached to a Region, answered by the human choosing
one or writing a custom answer. Every question the agent has takes this form.
_Avoid_: decision request, poll, prompt

**Update**:
A durable, informational message from the agent that needs no answer, anchored to a Region and
dismissed by the human. Anything needing an answer is a Proposal instead.
_Avoid_: notification, status, message

**Cockpit**:
A view listing current Attention, filterable by owner. It is placed by the agent, not fixed by the
kernel, and returns each row to its exact unresolved interaction. Attention anchored to the root
Region appears here.
_Avoid_: inbox, dashboard, sidebar
