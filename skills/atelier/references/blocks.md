# Building blocks — syntax and behavior

Which block fits which use is decided by the router in [SKILL.md](../SKILL.md#router). This file is
the syntax. Load the module only when the page uses a block:

```html
<link rel="stylesheet" href="/atelier-blocks.css">
<script type="module" src="/atelier-blocks.mjs"></script>
```


`assets/atelier-blocks.mjs` ships content elements so you write a short text body, not renderer
markup or code. Each takes its source in a first-child `<script type="text/plain">` (so `<`, `>` and
`&` need no escaping), loads its library on first use from a pinned version, keeps text for a reader
without the renderer, draws again when a Ready swaps its Region in, and sets `data-rendered="true"` —
or `"error"`, showing the error and its source in place. A block is content: put it inside a Region,
anywhere a Thread can reach it. Every block takes an optional `caption="…"`, one sentence on what to
notice; the lint reads captions and `alt` as prose.

| Block | Body | Attributes |
|---|---|---|
| `<atelier-claims>` | child `atl-key` claims, each opening with a `<p>` | `open="0…3"` |
| `<atelier-mermaid>` | Mermaid source (mermaid 12.1.0) | `alt` (required) |
| `<atelier-chart>` | Vega-Lite JSON (vega-embed 7.3.0, SVG) | `alt` (required) |
| `<atelier-file>` | inline source, or none with `src=`/`diff=` | `src`, `diff`, `lang`, `name` |
| `<atelier-video>` | one mark per line: `m:ss what happens` | `src`, `poster`, `label`, `small`, `compare` |
| `<atelier-compare>` | two child elements, or none with images | `before`, `after`, `before-label`, `after-label` |
| `<atelier-mock>` | a `<template>` holding the mockup | `frame="none|browser|phone"`, `w`, `url`, `alt` |
| `<atelier-findings>` | one per line: `liked|disliked|fact|gap: text` | — |
| `<atelier-decision>` | `? question`, then `* recommended` / `- alternative` options, each with indented `+ for`, `- against`, or plain context lines | — |
| `<atelier-flow>` | child `atl-key` Regions as steps; a step's child Regions are its sub-steps | `parallel` on a step |
| `<atelier-timeline>` | a step per unindented line; indented under it `![alt](src)`, `> who: comment`, or a note | — |
| `<atelier-tabs>` | child `atl-key` Regions, one per tab, named by `atl-label` or their heading | `side` |

Text in findings, decisions and timelines is plain; `[label](url)` makes a link. Labels a
block draws (Liked, Recommended, Overview) follow `<html lang>`, as the kernel's do.

```html
<atelier-mermaid alt="Draft build, then HIGH build, then review.">
  <script type="text/plain">
  flowchart LR
    draft[Draft build] --> high[HIGH build] --> review{Review}
  </script>
</atelier-mermaid>

<atelier-video src="/media/24-final.mp4">
  <script type="text/plain">
  0:00 Hook: 25 cards fan out
  0:03.5 The guest scans the QR code
  </script>
</atelier-video>

<atelier-compare before="/shots/old.png" after="/shots/new.png" caption="The headline moves above the fold."></atelier-compare>

<atelier-mock frame="browser" w="600" url="app.test/compose" alt="Composer with a Send later button">
  <template><style>button { padding: 8px }</style><button>Send later ▾</button></template>
</atelier-mock>
```

- **Mermaid:** give every node a short, stable name (`high[HIGH build]`); a Thread on a box finds it
  again by that name after the diagram changes. It draws at full size inside its own horizontal
  scroller: a diagram shrunk to fit shows half-size labels that page zoom does not enlarge. Lay a
  chain of more than five steps out top to bottom (`flowchart TB`).
- **Chart:** a Thread anchors to a point on the chart, not to one mark.
- **Video:** each mark is a line of text with a seek button, so a Thread anchors to a moment by
  quoting its mark; the mark playing now is highlighted. A video is large by default; the human
  toggles it small (`small` starts it small). Sibling `<atelier-video>`s are alternatives shown one
  at a time; mark `compare` on them only when the human compares them side by side.
- **Decision:** the block shows the options and their reasons; the human answers in the Proposal
  you anchor to the question's words. Options are all visible — never fold the alternatives away.
- **Flow:** the map beside the steps shows one level; a node with children zooms in, a breadcrumb
  zooms out, and choosing a node scrolls to its Region. Each step is an ordinary Region, so it takes
  Threads, Proposals, Readys, and its own `<details>`.
- **Mockup:** it renders at `w` pixels in a shadow root — its CSS and the page's cannot touch each
  other — and scales down to the column. The kernel cannot see inside it, so a Thread on a mockup
  anchors a point on it. Draw the smallest region that makes the point.
- The lint checks each body statically: Mermaid's diagram-type header (not its shapes — only
  Mermaid's own parser can), the chart's JSON, each video mark's time, the findings, decision and
  timeline syntax, and that a flow holds only step Regions. It does not run a renderer; a Mermaid error the lint cannot see shows in
  place as the block's error.

## A renderer of your own

For a library no block covers — Graphviz
(`import { instance } from 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3/+esm'`, then
`el.append((await instance()).renderSVGElement(dot))`, every node with an `id`) — keep the source in
a `<script type="text/plain">` so the lint sees text a Thread may quote, keep a fallback caption, run
again on `atelier:ready`, and dispatch `atelier:rendered` on `document` when done so anchors inside it
resolve.

## Show files

Render a file the human must judge — Markdown, source code, or a patch — with `<atelier-file>`, in a
block of its own rather than inside a sentence. It keeps the text as real DOM, one element per source
line, so Threads anchor to any line; Markdown gets GitHub styling and its ` ```mermaid ` fences draw:

```html
<atelier-file src="/docs/plan.md"></atelier-file>        <!-- GitHub-styled Markdown -->
<atelier-file src="/src/server.mjs"></atelier-file>      <!-- highlighted, numbered code -->
<atelier-file diff="/review/fix.patch"></atelier-file>   <!-- side-by-side diff -->
<atelier-file lang="ts" name="limits.ts · sketch"><script type="text/plain">
export const LIMIT = 50;
</script></atelier-file>
```

- Paths are served by the Surface server from `ROOT`, so a file outside it must be copied in first.
  The lint reads each `src=` file through the server so a Thread quoting a line in it still resolves.
- Long lines wrap, so nothing hides past the box edge. A diff shows side by side when its box is at
  least 1100px wide and unified below that; give a diff the full content width.
- For one hunk beside a claim, cut that hunk into its own `.patch` file rather than showing the
  whole diff.

## Styling

- `atelier.css` ships a default theme modeled on the 2026-10-06 variant B: paper `#f7f4ec`, ink
  `#242c2a`, a deep green accent `#305b45`, Georgia headings over a system sans body, as `--atl-*`
  tokens. Content defaults use zero-specificity `:where()` rules, so any authored rule or library
  overrides them without `!important`.
- Kernel chrome lives in `<atelier-host>`, `<atelier-activity>`, and `.atl-*`; its labels follow
  `<html lang>` (German or English). Leave its styling alone; it reads as protocol, not content.
- Theme choice stays in authored HTML/CSS; the kernel stores no theme preference.
