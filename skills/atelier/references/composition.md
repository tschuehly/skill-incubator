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
| Proof that a change works | An [evidence review](#evidence-review) |
| One argument that builds | Short prose with examples beside the claims |

### Evidence review

When a worker shows that a change works, the human accepts or sends back each claim on its own.

- **One Region per claim** — one behavior a check can prove, such as "Escape closes an open card",
  not one per fix or per file.
- **Each claim carries its proof in place, open:** the human's words it answers, quoted; its own
  diff hunk in the [file viewer](#show-files); the check that covers it with the command and the
  exact output line; and before/after images. Where an image or a check does not exist, show the
  empty slot labelled with what is missing.
- **A gap belongs to the claim it weakens.** A scripted check of a human action (a synthetic paste,
  a dispatched click), a behavior no check exercises, and a change no human has used yet are gaps.
- **One Proposal per claim, anchored to the claim:** Accept or Rework. A claim with a gap
  recommends checking it first, and no option calls it proven.

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

### Show files

Render a file the human must judge — Markdown, source code, or a patch — with the file viewer, in a
block of its own rather than inside a sentence. It keeps the text as real DOM, so Threads anchor to
any line, and it tells the kernel when it finishes so those anchors resolve:

```html
<div class="file-view" data-file="/docs/plan.md"></div>       <!-- GitHub-styled Markdown -->
<div class="file-view" data-file="/src/server.mjs"></div>      <!-- highlighted, numbered code -->
<div class="file-view" data-diff="/review/fix.patch"></div>    <!-- side-by-side diff -->

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html@3.4.52/bundles/css/diff2html.min.css">
<style>
  .file-view { position: relative; border: 1px solid #d0d7de; border-radius: 6px; background: #fff; overflow: auto; max-height: 70vh; }
  .file-view > .file-name { position: sticky; top: 0; z-index: 1; padding: 6px 12px; background: #f6f8fa; border-bottom: 1px solid #d0d7de; font: 600 12px ui-monospace, monospace; }
  .file-view .markdown-body { padding: 16px 24px; font-size: 14px; }
  .file-view pre.code { margin: 0; padding: 8px 0; font: 12.5px/1.5 ui-monospace, Menlo, monospace; counter-reset: line; }
  .file-view pre.code .line { display: block; padding: 0 12px 0 56px; position: relative; white-space: pre-wrap; overflow-wrap: anywhere; }
  .file-view .d2h-code-line-ctn { white-space: pre-wrap; overflow-wrap: anywhere; }
  .file-view pre.code .line::before { counter-increment: line; content: counter(line); position: absolute; left: 0; width: 44px; text-align: right; color: #8c959f; }
</style>
<script type="module">
  import MarkdownIt from 'https://esm.sh/markdown-it@14.1.0?bundle';
  import hljs from 'https://esm.sh/highlight.js@11.11.1';
  import { html as diffHtml } from 'https://esm.sh/diff2html@3.4.52';
  const md = new MarkdownIt({ linkify: true, highlight: (s, lang) => lang === 'mermaid'
    ? `<pre class="mermaid">${md.utils.escapeHtml(s)}</pre>`
    : hljs.getLanguage(lang) ? `<pre class="hljs"><code>${hljs.highlight(s, { language: lang }).value}</code></pre>` : '' });
  // One element per source line; a highlight span that runs across lines is closed and reopened.
  const lines = html => { let open = []; return html.split('\n').map(l => {
    const out = `<span class="line">${open.join('')}${l}${'</span>'.repeat(open.length + (l.match(/<span[^>]*>/g) || []).length - (l.match(/<\/span>/g) || []).length)}</span>`;
    for (const t of l.match(/<span[^>]*>|<\/span>/g) || []) t === '</span>' ? open.pop() : open.push(t);
    return out; }).join(''); };
  async function renderFiles() {
    for (const el of document.querySelectorAll('[data-file]:not([data-rendered]), [data-diff]:not([data-rendered])')) {
      const src = el.dataset.file || el.dataset.diff, text = await (await fetch(src)).text(), ext = src.split('.').pop();
      const body = el.dataset.diff ? diffHtml(text, { outputFormat: el.clientWidth >= 1100 ? 'side-by-side' : 'line-by-line', drawFileList: false, matching: 'lines' })
        : ext === 'md' ? `<div class="markdown-body">${md.render(text)}</div>`
        : `<pre class="code hljs">${lines(hljs.getLanguage(ext) ? hljs.highlight(text, { language: ext }).value : hljs.highlightAuto(text).value)}</pre>`;
      el.innerHTML = `<div class="file-name"><a href="${src}" target="_blank" rel="noopener">${src.split('/').pop()}</a></div>${body}`;
      el.dataset.rendered = 'true';
    }
    document.dispatchEvent(new CustomEvent('atelier:rendered'));
  }
  renderFiles(); document.addEventListener('atelier:ready', renderFiles);
</script>
```

- Paths are served by the Surface server from `ROOT`, so a file outside it must be copied in first.
- A Markdown file with ` ```mermaid ` fences draws them once the diagram renderer above runs.
- Long lines wrap, so nothing hides past the box edge. A diff shows side by side when its box is at
  least 1100px wide and unified below that; give a diff the full content width.
- For one hunk beside a claim, cut that hunk into its own `.patch` file rather than showing the
  whole diff.

### Write the finding

Every sentence is about the subject. Write the finding, not the process: current facts, the
recommendation, and what the human must judge.

- **Open on the subject.** The first screen names what the human is judging and where to start, in
  about 60 words; the material follows directly.
- **Every sentence stays true with the layout removed.** Read each sentence as plain text in a
  chat and keep only sentences about the subject. Carry the meaning in the material itself: label
  the box "Gate: lint", title the list "Gaps, most dangerous first", name the rule you mean. A
  sentence that only makes sense on this page — a legend, a reading direction, a pointer, a note
  about the page's status — is meta commentary; delete it.
- **Show the source being judged.** Quote the passage, clause, rule, or diff hunk verbatim and
  anchor the Thread or Proposal to that quote, so the question sits on its evidence. Your analysis
  sits beside it, shorter than it.
- **Every reference opens.** Make each file, commit, issue, pull request, and URL the page names a
  link to it — a commit or issue to its page on the forge, a local file to its path on the Surface
  server. Show a file the human must judge inline with [the file viewer](#show-files), beside the
  claim that cites it.
- **Each fact appears once.** Put a real gap — something missing, unproven, or not yet active — in
  one sentence on the one item where it changes the human's judgment.

## Choose the message shape

Three channels, and picking the wrong one is what makes a Surface feel like chat again.

- **Reply in the Thread** when the human asked. Always the answer to their comment, never a new
  topic.
- **Update** when they need to know something and no answer is required: a batch finished, a source
  changed, six Regions were re-rendered. It waits in the Activity drawer, never in the content; it
  never asks.
- **Proposal** when work cannot continue without their judgment, anchored as in
  [Show the source being judged](#write-the-finding). Name real options, put the recommendation first, and state what each one
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
