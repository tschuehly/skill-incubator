# Anchored Threads replace Region-mounted Threads

The kernel mounted a comment box, an Attention badge, and Update and Proposal hosts into every
Region, and offered `below`, `side`, and `sheet` Thread placements. On three real Surfaces the owner
could not use it: Update and Proposal cards stacked above the content, disconnected from it; the
comment box sat at the end of screen-sized Regions, far from the sentence it discussed; nothing
smaller than a Region could be commented on; empty "Comment on this Region…" boxes piled up where
several Regions ended; the Cockpit listed raw Region keys; the left navigation and Cockpit column
felt out of place; wide screens gave a third of the width to comments; desktop notifications were
off. The kernel was deciding layout, which [ADR 0003](0003-protocol-kernel-with-agent-chosen-styling.md)
had given to the agent.

Atelier is a reusable API, kernel, and set of components that extend HTML for human–agent
interaction. The agent chooses the content's form — a document, a diagram, images, a click-through
prototype. The kernel supplies interaction only, and a component exists only where it holds durable
interaction state or must return to an exact place.

## Decision

- `<atelier-region>` is identity and address only. The kernel inserts nothing into it.
- A Thread opens on an **Anchor**: selected text, an element (Alt+click or Pick mode), a point on an
  image or SVG, or the whole Region. It is a conversation: the human writes again through
  `/api/thread-message`, which wakes the agent as a `sent` event with `followUp`.
- Threads and Proposals appear in one Surface-placed `<atelier-margin>`, level with their Anchors,
  like comments in a shared document. A Proposal takes an optional `anchor`; a decided one
  collapses to one line.
- Updates, changed Regions, and what waits for the human live in one `<atelier-activity>` drawer in
  a Surface-authored fixed header. Desktop notifications are requested on the first gesture.
- Ready swaps only the named Regions, as before; the margin and header sit outside Regions, so
  drafts, focus, caret, scroll, and Anchors survive.
- Removed: `<atelier-comments>`, `<atelier-attention>`, `<atelier-proposal>`, `<atelier-update>`,
  `<atelier-cockpit>`, Thread placements, the sheet, and the reveal resolver.

## Admission check (docs/principles.md)

- **Human action made easier:** commenting on the exact sentence, item, or diagram point, and
  finding the answer beside it; deciding where the question is asked.
- **Session steps:** the agent authors a three-part frame once and stops choosing per-Region
  placements, Cockpit geometry, and resolvers.
- **Why not local:** the Region-mounted chrome was kernel behavior every Surface inherited, and
  the same failure recurred on three Surfaces (working-mode review, PhotoQuest review explainer,
  Workstream Atlas). The Worlds Console Surface had to build its own element picker.
- **Bounded check:** `scripts/verify.mjs` drives each behavior in a real browser; preflight fails a
  missing or misplaced margin or Activity and every Anchor that no longer resolves.

## Consequences

- Existing Surfaces keep working on their copied kit; preflight reports that kit as drifted until
  it is re-copied, and re-copying requires adding the header and margin.
- Stores stay compatible: Threads without an `anchor` attach to their Region.
- Narrow screens get a plain bottom list, and iframe picking is a documented extension point; both
  wait for observed need.
