# Composition — choosing the shape of a Surface

The kernel gives you identity, state, and behavior. It gives you no opinion about layout, and that
is the point: the material decides the shape. This is how to choose it.

## Establish four prerequisites first

1. **Human job** — what they must understand, compare, decide, annotate, or change.
2. **Content topology** — one connected argument, repeated independent items, competing
   alternatives, a sequence or dependency graph, a queue with detail, or spatial/temporal material.
3. **Visibility dependency** — which facts must stay visible together for a sound judgment, and
   which detail can be disclosed in place.
4. **Interaction granularity and scale** — what can be answered independently, how many targets
   exist, and whether the human scans, reads, or moves between them.

No composition is the default.

| Composition | Use when | Keep together |
|---|---|---|
| Fluent document | One argument builds in reading order | Prose, examples, evidence, and embedded actions |
| Worklist | Repeated items are independently understandable | One item, its state, actions, and Thread |
| Comparison | Alternatives must be judged against the same criteria | Options, criteria, differences, and consequences |
| List/detail | The human triages many records before inspecting one | Scannable list state and the selected record |
| Flow or timeline | Sequence, causality, or dependency is the judgment | Nodes, transitions, blockers, and local actions |
| Canvas or media | Position or time carries meaning | Artifact, anchors, playback or zoom, and feedback |
| Frontier | A grilling round: every open question at once | Each question with its evidence and its options |

When two compositions remain materially plausible **and would change the human's workflow**, offer
two or three concrete options before building: name the human path, what each keeps visible, and its
trade-off, and recommend one. Choose directly when the evidence favors one shape. Cosmetic variants
are presentation work, not composition options.

## Divide the material into Regions

A Region is one thing the human forms a judgment about. That is the whole test.

- **Too coarse** and a `changed` marker tells them a screen of material moved, so they re-read all
  of it; a Proposal about one item has no item to sit on.
- **Too fine** and every paragraph is its own Region; changed markers fragment across the page
  and the human stops reading them.
- Give each Region a key from the **task**, never from DOM position or visual container:
  `provider`, `step-3`, `risk-budget`. The path to it is its address forever, so renaming a parent
  renames every child's Thread address.
- Nest to mirror the material, not to make the markup tidy. Nesting exists so `count` can roll up
  and so a parent can be published in one Ready.
- Regions do not need visual containers. A Region can be an `<article>`, a table row, a `<figure>`,
  or a `<section>` with nothing around it.
- Make each item the human can answer on its own — a setting value, an option, a rollout step — its
  own small Region. A Thread can still anchor to a sentence anywhere, but a Ready, a changed marker,
  and a Proposal name a Region; a screen-sized Region makes the human re-read all of it.

## Lay out the frame

Every Surface authors the same three-part frame; the content inside it is free.

```html
<header class="top">            <!-- sticky; title, section links, and the one <atelier-activity> -->
  <b>Title</b><nav>…</nav><atelier-activity></atelier-activity>
</header>
<div class="page">              <!-- grid: minmax(0,1fr) clamp(340px,32vw,520px); one column below 1100px -->
  <main> …Regions… </main>
  <atelier-margin></atelier-margin>
</div>
```

- Keep the header and the margin **outside every Region**; a Ready replaces Regions and would take
  them along. Preflight fails when either is missing, doubled, or inside a Region.
- Put section navigation in the header, not in a side column: the right side belongs to Threads.
- Use the screen. Give the page no max-width below 1800px and let the margin grow with it
  (`clamp(340px, 32vw, 520px)`), so decisions and Threads have room. Cap only prose line length
  (about 75ch); diagrams, tables, and diffs take the full content width.
- Set `--atl-header-height` on `:root` and `scroll-margin-top` on Regions to the header's height so
  jumps land below it.
- Tabs, side-by-side panes, and toggles are ordinary authored HTML. They hold no interaction state,
  so the kernel supplies none. Keep an anchored element mounted while its Thread is open.

## Choose the form

The material decides what the human looks at. Before writing prose, ask what shows it best:

| Material | Form |
|---|---|
| A flow, pipeline, sequence, state machine, or timeline | Mermaid |
| Options judged on shared criteria | A table, one row per option |
| Numbers, or settings × values | A Vega-Lite chart or heatmap |
| A graph whose layout matters, or whose every node carries a Thread | Graphviz |
| Before and after | Two columns side by side, changes marked in both |
| A UI, interaction, or state change | A click-through prototype or embedded app |
| Media, layout, or a visual defect | The image or frame itself, with Threads on points |
| One argument that builds | Short prose with examples beside the claims |

### Draw with a library

Draw diagrams with a library rather than placing SVG shapes by hand; hand-written SVG is for
custom visuals such as an annotated screenshot. Each renderer marks its figure ready so preflight
can see it drew, keeps a `[data-diagram-fallback]` caption, and runs again after a Ready:

```html
<figure data-diagram="pipeline">
  <pre class="mermaid">flowchart LR
  draft[Draft build] --> high[HIGH build] --> review{Review}</pre>
  <figcaption data-diagram-fallback>Draft build, then HIGH build, then review.</figcaption>
</figure>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs';
  import vegaEmbed from 'https://cdn.jsdelivr.net/npm/vega-embed@7/+esm';
  mermaid.initialize({ startOnLoad: false, flowchart: { useMaxWidth: false } });
  const ready = el => el.closest('[data-diagram]').dataset.diagramReady = 'true';
  async function draw() {
    for (const el of document.querySelectorAll('pre.mermaid:not([data-processed])')) { await mermaid.run({ nodes: [el] }); ready(el); }
    for (const el of document.querySelectorAll('[data-vega]:not(:has(svg))')) { await vegaEmbed(el, JSON.parse(el.dataset.vega), { renderer: 'svg', actions: false }); ready(el); }
  }
  draw(); document.addEventListener('atelier:ready', draw);
</script>
```

- **Mermaid:** give every node a short, stable name (`high[HIGH build]`). A Thread on a box finds
  it again by that name after the diagram changes. Draw at full size (`useMaxWidth: false`) inside a
  figure with `overflow-x: auto`: a diagram shrunk to fit its column shows half-size labels that
  page zoom does not enlarge. Lay a chain of more than five steps out top to bottom
  (`flowchart TB`) so it rarely needs to scroll.
- **Vega-Lite:** render as SVG. A Thread anchors to a point on the chart, not to one mark.
- **Graphviz** (`import { instance } from 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3/+esm'`, then
  `el.append((await instance()).renderSVGElement(dot))`): give every node an `id` attribute.
- A syntax error leaves the figure unready, so preflight fails and names it; fix the source rather
  than falling back to prose.

### Write the finding

Every sentence is about the subject. Write the finding, not the process: current facts, the
recommendation, and what the human must judge.

- **Open on the subject.** The first screen names what the human is judging and where to start, in
  about 60 words; the material follows directly.
- **Every sentence stays true with the layout removed.** Read each sentence as if the page were
  plain text in a chat: if it no longer makes sense, it is meta commentary; delete it. That catches
  all its forms — legends ("green hexagons are gates"), reading directions ("start with…", "see
  gap 1", "ranked by…"), pointers ("the question beside this value", "under Global", "below"),
  descriptions of the page, its controls, or how to comment, and status notes ("nothing here is
  active yet"). Put the meaning into the material itself instead: label the box "Gate: lint",
  title the list "Gaps, most dangerous first", name the rule you mean.
- **Show the source being judged.** Quote the passage, clause, rule, or line verbatim, and anchor
  the Thread or Proposal to that quote. Your analysis sits beside it, shorter than it.
- **Ask beside the evidence.** Anchor each Proposal to the source text it decides. A collected
  "open questions" section is a list of Proposals with their evidence removed.
- **Each fact appears once.** A real gap — something missing, unproven, or not yet active — is one
  sentence beside the one claim it affects, stated once for the whole Surface.

## Choose the message shape

Three channels, and picking the wrong one is what makes a Surface feel like chat again.

- **Reply in the Thread** when the human asked. Always the answer to their comment, never a new
  topic.
- **Update** when they need to know something and no answer is required: a batch finished, a source
  changed, six Regions were re-rendered. It waits in the Activity drawer, never in the content; it
  never asks.
- **Proposal** when work cannot continue without their judgment. Anchor it to the sentence, row, or
  element it decides. Name real options, put the recommendation first, and state what each one
  costs. A Proposal with one option is an Update; a Proposal whose answer you could have discovered
  yourself is a research failure, not a question. A list of open choices in the content is a set of
  Proposals written as prose: post each as a Proposal instead.

Nothing else is a channel. If a message fits none of these, it is prose looking for a chat window.

## Reading path and decision context

Treat every control as a cold entry point.

- Define terms, symbols, option names, and prerequisite facts before first use. State shared context
  once in the reading flow, then project the relevant parts beside each affected control.
- Keep a question, its recommendation, its alternatives, their consequences, and its controls in one
  visible unit.
- Progressive disclosure moves **inward** from that complete unit — summary, then example, then
  expandable evidence — never sideways into another tab or back into the transcript.
- Read the Surface twice: once from the top, once by jumping straight to each control. Needing the
  session transcript or an unexplained label to act is a defect.
- Apply the `write-for-humans` skill to all visible copy.

## Styling

- The content library is your choice; daisyUI 5 over the Tailwind browser build is the default and
  is what `examples/` use. Tailwind's browser build watches the document, so Regions swapped in by a
  Ready are styled correctly with no extra work.
- Kernel chrome lives in `<atelier-margin>`, `<atelier-activity>`, and `.atl-*`, and is
  deliberately plain so it reads as protocol rather than content. Leave its styling alone; it is
  supposed to look like the frame, not the picture.
- Theme choice stays in authored HTML/CSS. Load daisyUI's `themes.css`, set a fixed choice with
  `<html data-theme="…">`, or author a system/light/dark control when the human's task needs one.
  The kernel stores no theme preference.
- Preflight fails horizontal overflow at 1440 and 390. Anything that must scroll sideways — a wide
  table, a diagram — needs its own scroll container.
- A rendered diagram must mark itself `data-diagram-ready="true"`, keep prose behind
  `[data-diagram-fallback]`, and draw an SVG of a readable size. Preflight checks all three, so a
  blank box cannot reach the human.
