# Diagrams and file viewers

Snippets for a Surface that draws diagrams or shows files. Each renderer runs again after a Ready
(`atelier:ready`) and tells the kernel when it has drawn, so Threads anchored inside resolve.

## Draw with a library

Draw diagrams with a library rather than placing SVG shapes by hand; hand-written SVG is for
custom visuals such as an annotated screenshot. Each renderer marks its figure ready so preflight
can see it drew, keeps a `[data-diagram-fallback]` caption for readers without the renderer, and
runs again after a Ready. Once the diagram is drawn, the caption stays in the DOM and off the screen,
so the diagram is the only visible telling of the flow:

```html
<style>
  [data-diagram-ready="true"] [data-diagram-fallback] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
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

## Show files

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

