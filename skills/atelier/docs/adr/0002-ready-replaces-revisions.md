# Ready replaces Revisions

Attention used to come from per-Region Revision strings compared against an acknowledged Revision,
with a content-hash fallback, a server-side region registry, and sync/ack endpoints to maintain it.
The agent now names the changed Regions once, in the same call that says its work is at a coherent
point: `POST /api/ready {"changed":["onboarding/provider"]}`. It is its own endpoint rather than a
generic event because it is the one call that mutates what the human is looking at: it validates
the key list, accumulates `changed`, and is the only kind `poll.sh` must never wake the agent on.

## Consequences

- Deleted: the `revision` attribute, `/api/regions/sync`, `/api/regions/ack`, the region registry
  with its `previousRevision` / `acknowledgedRevision` / `firstSeenAt` bookkeeping, the content
  fingerprint fallback, and the "did the bytes or the meaning change?" ambiguity.
- Ready is the **only** trigger that changes what the human sees, so the surface never churns
  mid-thought while the agent iterates. Changed Regions are swapped in place; Threads are separate
  elements and survive untouched.
- Attention accumulates across Readys until cleared, so work that lands while the human is away is
  never silently unmarked. The human clears it with ✓ or by sending a comment or deciding a
  Proposal in that Region; a flush clears every Region where it dispatched comments.
- Preflight fails on the page's unknown-key warning, so a mistyped Ready cannot reach a handoff.
- The server keeps no Region registry, so it cannot validate that a named key exists. Only the page
  can tell, so it raises the warning banner.
