---
name: atelier
description: >-
  Create and operate a task-shaped HTML workspace when the human should understand, annotate,
  answer, or review through a live surface instead of reading the session transcript. Use for
  screening and grilling sessions, plans, comparisons, reports, code or media review, and other
  work where anchored feedback and durable interaction improve the result.
---

# Atelier

Give the human a good interface to the work, not a prettier session log.

A **Surface** is an ordinary HTML document you write, wrapped around a kernel that supplies the
parts a document cannot have on its own: durable identity, shared state, and an event loop between
you and the human. You own every pixel of the content. The kernel owns the protocol.

The capitalized terms — Surface, Region, Region Key, Ready, Attention, Thread, Proposal, Update,
Cockpit — are defined in [CONTEXT.md](CONTEXT.md). Read it once; everything below assumes it.
When changing Atelier itself, apply [the Atelier principles](docs/principles.md).
`<skill-dir>` is the directory containing this file.

## Build the first useful Surface

1. **Read the source material before writing HTML.** When a session transcript is supplied, extract
   its current facts, recommendations, unresolved questions, disagreements, and source anchors.
   Present the synthesized current state; keep the raw transcript available only as evidence.

2. **Choose the composition** with [references/composition.md](references/composition.md): what job
   the human is doing, how the material divides into Regions, and where each Thread belongs. Never
   ask the human to invent the interface. Ask once, without blocking, when the choice would change
   their workflow; if no answer arrives in the same turn, build the recommendation and label the
   assumption on the Surface.

3. **Copy the kit into the project.** All four files travel together — the server serves
   `/atelier.mjs` and `/atelier.css` from its own directory:

   ```bash
   mkdir -p tools .review
   cp <skill-dir>/assets/{server.mjs,atelier.mjs,atelier.css} tools/
   cp <skill-dir>/assets/poll.sh tools/review-poll.sh
   mv tools/server.mjs tools/review-server.mjs
   chmod +x tools/review-poll.sh
   ```

   Keep `.review/` out of version control. A copied kit never updates itself: fixes to the canonical
   kit reach this Surface only when you copy them again, which preflight's kit gate detects.

4. **Write the document.** One `<script type="module" src="/atelier.mjs">`, one
   `<link rel="stylesheet" href="/atelier.css">`, and a content library of your choice — daisyUI 5
   over the Tailwind browser build is the default:

   ```html
   <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet">
   <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet">
   <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
   ```

   Then wrap each thing the human reasons about in a Region with a stable key:

   ```html
   <atelier-region key="onboarding">
     <h1>Appliance onboarding</h1>
     <atelier-region key="provider" comments="side">
       <h2>Provider step <atelier-attention mode="dot"></atelier-attention></h2>
       <p>…the material the human is judging…</p>
     </atelier-region>
   </atelier-region>
   ```

   Nesting builds the Region Key: that inner Region is `onboarding/provider`, and that is the
   address you use in every API call about it. Make each Region one task-shaped judgment; if one
   part can change while several other judgments stay stable, split that part into a nested Region.
   Choose `below`, `side`, or `sheet` separately for every Region so its Thread remains usable with
   the evidence it discusses. Follow [the Cockpit placement rule](references/composition.md#place-attention)
   whenever the reading path is long or dynamic. Everything else the kernel offers —
   `<atelier-comments>`, `<atelier-attention>`, `<atelier-proposal>`, `<atelier-update>`,
   `<atelier-cockpit>` — is in [references/protocol.md](references/protocol.md).

5. **Build once from the evidence.** Do not run speculative presentation rounds. Re-open the
   authoritative sources as they exist now and trace every factual claim, recommendation, and
   Proposal back to them; correct stale copy before the human sees it. A located target proves only
   location—not that a scenario is ready, a check ran, evidence exists, or a human verdict was
   recorded. Embedded-product Surfaces offer only actions and claims the human can exercise in
   their browser. Source fidelity and cold-reader comprehension are separate checks; neither
   replaces the other.

`examples/` holds runnable Surfaces: `compare-review.html` (many Regions, side Threads),
`grill-session.html` (Proposal-driven, a composer visible under every question), `placements.html` (the three Thread
placements side by side). Serve one and click it before writing your own.

The first browser load needs no Ready. Ready begins only after the human could have seen the
Surface.

**Ready when:** one composition is chosen and any offered option is resolved or recorded as an
assumption on the Surface. Current sources support every visible claim. A cold reader can follow
the material, reach every control, and understand each term and option from its visible or
expandable context — without the session transcript.

## Start the live loop

1. Choose a free `PORT` and use the same exact `http://127.0.0.1:<port>` everywhere. Call
   `monitor_status`, then start the server with the Workbench `monitor` using `source.type="spawn"`,
   the explicit command `env PORT=<port> UI=tools/my-surface.html node tools/review-server.mjs`, the
   project directory in `options.cwd`, and `recoveryPolicy:"never"`. Keep the port in the reuse key.
   Never hide `cd`, pipes, or backgrounding inside the command.
2. Health-check `GET /api/state`, then start exactly one more `spawn` watcher for
   `BASE_URL=<exact-url> bash <absolute-poller-path> --stream`, with a URL-specific reuse key and
   `notifyOn` patterns for `SENT`, `DECISION`, `EXPLAIN-REQUEST`, `COMMENT-REJECTED`,
   `COMMAND`, `SERVER-DOWN`, and `SERVER-UP`. Confirm with `monitor_inspect` that the recorded
   command contains the exact URL. Do not also poll with Bash.
3. Without the Workbench monitor, use the harness's tracked background-task facility and run
   `BASE_URL=<exact-url> bash <poller> --once`. Each human event exits the poller; act, then re-arm
   it from its persisted cursor. Never use an untracked shell `&` process.
4. Run the gate:

   ```bash
   node <skill-dir>/scripts/preflight.mjs \
     --url http://127.0.0.1:<port> \
     --poller-identity <absolute-poller-path> \
     --evidence-dir .review/preflight
   ```

   It fails silent handoff defects: the store is unreachable, the poller is missing or duplicated,
   this Surface's copied kit differs from the canonical one, Region identity or references are
   invalid, the page throws a browser error or kernel warning, content overflows horizontally, or a
   diagram did not render. Re-copy a drifted kit rather than patching it in place; pass
   `--allow-kit-drift` only when the local change is deliberate and written down. `--skip-render`
   and `--skip-poller` are for kernel tests, never a human handoff.
5. After preflight passes, run one cold-reader pass yourself: follow the primary reading path, jump
   to every control, and follow its disclosures in order. Move missing definitions beside the control
   that needs them. Rerun preflight, then open the URL for the human. This pass is a short lead-owned
   walk, not an independent review and not a delegated inspection; handing it to a subagent turns a
   one-minute check into a blocking wait and reintroduces the browser repair loop that
   [the principles](docs/principles.md) keep out of normal Atelier.

**Restarting a Surface the human has already used is not a first handoff.** Its content was read
once and its store already holds their work, so steps 1–4 apply unchanged — a restart is exactly
when the port, store name, poller identity, and copied kit go wrong — and step 5 does not. Skip the
cold-reader pass unless the content changed since they last saw it, and tell them the Surface is
back rather than re-reviewing what they already accepted.

**Ready when:** preflight passes, the exact-URL poll path is armed, and the browser is open. On a
first handoff, the cold-reader pass also has no actionable finding.

## Work through the Surface

Treat the Surface as the primary channel while the review is live. Chat carries the URL, a failure,
and the final handback — not questions the Surface already represents.

- **Answer a comment where it was written.** On every `sent` event, reply in its Thread with what
  you picked up and set `acknowledged` within seconds, then work. Move it through `in_progress` and
  `implemented`; the human accepts or rejects it in place. A non-blocking follow-up is Accept, then
  a new Thread—not a third verdict state.
- **Ask with a Proposal, never with prose.** A genuine choice goes beside the material it changes,
  recommendation first, with the consequence of each option stated. Facts you can discover yourself
  are evidence, not questions. Anything that needs no answer is an Update.
- **Publish changes with Ready, not by reloading.** Rewrite the HTML file, then post only the
  edited leaf Region Keys to `/api/ready`; omit unchanged ancestors and unrelated Regions. The
  kernel swaps exactly those Regions into the open page, keeps scroll position, and leaves Threads
  and half-typed drafts untouched. Never reload the page
  yourself; a reload during a human's sentence loses the sentence.
- **Publish at coherent points.** Attention accumulates across Readys, so a half-finished thought
  posted early costs the human a second pass over the same Region.
- **For a grilling round, publish the whole current frontier together.** A decision unlocks its
  dependents: update the affected Regions, add the next frontier, and post one Ready.
- Comments and decisions send immediately. In multiline fields, ⌘+Enter sends and Enter inserts a
  newline. Treat several events that arrive together as one work wave.
- When the human ends the review, stop the watchers and leave the store as the record.

## Current operating limits

Run one active browser per Surface. Browser autosave replaces the complete Thread collection, so a
second active browser can overwrite Thread changes. The event log is bounded observation history,
not a backup. Quote anchors already present in state render, but the browser cannot create them.

When a Region or Thread already has an open Proposal, keep it visible. If its context changed, post
an Update; ask the next Proposal only after the first resolves.

## Shared interaction state

Use the kernel's small state model rather than inventing one per Surface:

- comment: `draft → sent/open → acknowledged → in_progress → implemented → accepted|rejected`
- proposal: `open → decided`
- Region: `changed → acknowledged` (Ready sets it, the human's ✓ clears it)

Task-specific state stays in the task's data and visible copy. It does not extend the protocol
unless repeated real use proves a shared interaction is missing.

## Verifying the kernel itself

`node <skill-dir>/scripts/verify.mjs [filter]` drives a real browser through the whole protocol on
a throwaway fixture and prints pass/fail per check. Run it after changing anything in `assets/`.
`scripts/test-atelier.sh` covers the server and the poller wake filter without a browser.

## Promotion

A copied Atelier is owned by its task. When repeated use reveals a stable domain model, recurring
actions, and valuable automation, use [references/promotion.md](references/promotion.md) to decide
whether to build a durable Studio. Promotion is a judgment, not a usage count.
