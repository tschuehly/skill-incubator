# A static lint, building blocks, opened decisions and content shapes, on the ADR 0006 kernel

Status: proposed 2026-10-06, awaiting the owner's approval of this record. The decisions it records are
the owner's; the wording is the agent's.

Builds on [ADR 0006](0006-html-extension-kernel.md), which remains the base: `atl-key` Regions,
author-placed hosts, `<atelier-activity>`, one-click decisions with a server-held undo window.
Supersedes only the part of the 0006 workflow that handed over after a recorded screenshot verdict
(commit 564abd4): preflight's browser render pass and the visual verdict.

## Context

On 2026-10-06 the work of the day (static lint, building blocks, opened-decision readings, review
fixes, the variant verdict) had landed on master's old margin kernel, because ADR 0006's kernel was
left unmerged for five days. This ADR records the owner decisions of that day so they are ported
onto the 0006 kernel rather than re-derived. Private evidence: `atelier/docs/variant-verdict-20261006.md`
and `atelier/docs/judging-2026-10-06-verdicts.json`.

## Decisions

| Date | Owner decision | Owner's words | Here |
|---|---|---|---|
| 2026-10-06 | A static Node lint replaces the browser check before handoff. No normal handoff step requires screenshots, a browser walk, or a cold-reader pass. | Decision relayed by the lead session; no verbatim quote recorded. | `scripts/lint.mjs`; `preflight.mjs` runs STORE, POLLER, KIT and the lint; `test-atelier.sh` fails if the docs or preflight ask for a visual step again. |
| 2026-10-06 | Content patterns and standard renderers ship as building blocks in the kit — components, not copyable snippets — so the agent writes a short body instead of markup and renderer code (token efficiency), despite a bigger kit. | Decision relayed by the lead session; no verbatim quote recorded. | `assets/atelier-blocks.{mjs,css}`: claims, mermaid, chart, file, video, compare, mock, findings, decision, flow, timeline, tabs. Content, not protocol. |
| 2026-10-06 | A decision records whether its options were seen: kept as proposed, changed, opened but undecided, or not opened. A default nobody opened is not agreement. | Decision relayed by the lead session. | `suggested`, `openedAt`, `/api/proposal-opened`, `GET /api/state` `decisions`, `poll.sh --decisions`. Opened means the options reached the screen; a failed report is retried until acknowledged. |
| 2026-10-06 | Offer a catalog of content shapes, chosen per problem; none is mandatory or the default for every Surface. | "we should offer different content shapes depending on the problem" | `references/composition.md#content-shapes`. |
| 2026-10-06 | No variant wins alone; traits are combined (B's look, tabs and a foldable side nav, inline labels, icons, German copy under `lang="de"`, large videos one at a time, decision context inside the option, a Thread panel that folds and reserves no width). | Marks on the live variants, e.g. "Die tabs statt alles als langer text" (B), "Viel zu viel Text" (C); the owner confirmed the consolidated verdict as the spec. | Kit defaults in `atelier.css`, `atelier.mjs`, the blocks; lint gates DECISION_CONTEXT, LANG, VIDEO, WORDS (warning). |
| 2026-10-01 | Atelier is a kernel plus interaction interfaces that extend HTML; ADR 0006 stays the base. | "Atelier should just provide the kernel and interaction interfaces … like htmx extends HTML" | Every item above is expressed in 0006's terms: hosts instead of a margin, `collapsible` instead of a margin fold, HOSTS instead of a frame gate. |

## Admission check (docs/principles.md)

- **Human action made easier:** deciding with the options' reasons inside each option; folding the
  Thread panel away to read; reading German labels on a German page; watching one large video at a
  time; trusting that an unseen default is not reported as agreement.
- **Session steps:** removed — the screenshot subagent, the visual verdict record, hand-written
  renderer code for diagrams, files, findings and decisions. Added — choosing a content shape and
  writing block bodies.
- **Why not local:** the screenshot gate lives in the kit's preflight; the verdict spec the owner
  confirmed names the panel fold, icon buttons, inline labels, German labels and video sizing as
  kit-level, not one page's; the opened reading needs the server, which only the kit owns.
- **Bounded check:** `scripts/lint.test.mjs` (one fixture per defect class, every recipe clean),
  `scripts/test-atelier.sh` (suggested options, readings across the undo window, `--decisions`, no
  visual step), `scripts/verify.mjs` (opened on screen, retry after failure, blocks, German chrome,
  collapsible host, tabs, flow, videos, and the review-blocker regressions).

## Consequences

- Preflight no longer sees browser errors, kernel warnings, overflow, layout, real rendering, or
  whether `reveal()` reaches an item. The lint reports what it could not see as `UNMEASURED`, never as
  a pass. The kernel's in-page warnings still show the human a doubled host or an unknown Ready key.
- PROSE stays a warning, as ADR 0006 decided; WORDS is a warning; the other verdict rules fail.
- Kernel chrome is no longer English-only: labels follow `<html lang>` (German or English).
  Warnings about authoring defects stay English.
- A copied kit has four browser files; KIT drift covers all of them.
