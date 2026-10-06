// atelier building blocks — content elements, so the agent writes a short declarative body instead
// of markup and renderer code. Vendored from the atelier skill with the kernel: copy it, never patch it.
//
//   <atelier-claims>   a numbered, collapsible tree of claims; each claim is an atl-key Region
//   <atelier-mermaid>  a flow, sequence or state diagram (Mermaid, loaded on first use)
//   <atelier-chart>    a Vega-Lite chart from a JSON spec
//   <atelier-file>     Markdown, highlighted code, or a diff — from src=/diff= or inline source
//   <atelier-video>    a large video with time-stamped marks; sibling videos show one at a time
//   <atelier-compare>  before and after, side by side
//   <atelier-mock>     a UI mockup from a <template>, isolated in a shadow root and scaled to fit
//   <atelier-findings> liked / disliked / fact / gap lines, each label inline
//   <atelier-decision> a question whose options each carry their own context, all visible
//   <atelier-flow>     child Regions as steps, with a zoomable map (overview → step → sub-step) beside them
//   <atelier-timeline> steps with screenshots and reviewer comments, scrolled sideways
//   <atelier-tabs>     child Regions as tabs (or a foldable side nav) instead of one long page
//
// Every block reads its source from a first-child <script type="text/plain">, so <, > and & need no
// escaping. Each one keeps text a reader without the renderer can use, renders again when a Ready
// swaps its Region in (a new element is a new connect), sets data-rendered="true" (or "error", with
// the error and the source shown in place), and dispatches atelier:rendered so the kernel resolves
// anchors inside it. A block is content: it lives inside Regions and holds no interaction state.
//
// Provenance: the source-in-<script type="text/plain"> convention, the claim tree and the mockup
// frame are adapted from html-plan (github.com/anthropics/claude-plugins-community, commit f60f045,
// html-plan/skills/html-plan, MIT). No html-plan code is copied.

const PIN = {
  mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs',
  vegaEmbed: 'https://cdn.jsdelivr.net/npm/vega-embed@7.3.0/+esm',
  markdownIt: 'https://esm.sh/markdown-it@14.1.0?bundle',
  hljs: 'https://esm.sh/highlight.js@11.11.1',
  diff2html: 'https://esm.sh/diff2html@3.4.52',
  css: ['https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-light.min.css',
    'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css',
    'https://cdn.jsdelivr.net/npm/diff2html@3.4.52/bundles/css/diff2html.min.css'],
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const modules = new Map();
const load = url => { if (!modules.has(url)) modules.set(url, import(url)); return modules.get(url); };
const stylesheet = href => { if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href })); };
// Labels a block draws itself follow <html lang>, as the kernel's do.
const de = () => /^de\b/i.test(document.documentElement.lang);
const say = (en, german) => de() ? german : en;
// Body text: plain, except [label](url) links.
const inline = t => esc(t).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => /^\s*javascript:/i.test(url) ? label : `<a href="${url}">${label}</a>`);
// Region Keys as the kernel builds them: nested atl-key attributes joined with "/".
const regionKey = el => { const ks = []; for (let e = el; e; e = e.parentElement?.closest('[atl-key]')) ks.unshift(e.getAttribute('atl-key')); return ks.join('/'); };
const labelOf = el => el.getAttribute('atl-label') || el.querySelector('h1,h2,h3,h4')?.textContent.trim() || el.getAttribute('atl-key');
const keyOf = el => { const r = el.closest('[atl-key]'); return (r ? regionKey(r) : '') + '#' + [...document.querySelectorAll(el.localName)].filter(e => e.closest('[atl-key]') === r).indexOf(el); };
const make = (tag, cls, html) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, html != null ? { innerHTML: html } : {});

export function sourceOf(el) {
  const s = el.querySelector(':scope > script[type="text/plain"]');
  const lines = (s ? s.textContent : '').replace(/^\s*\n|\s+$/g, '').split('\n');
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
  return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

// The shared life cycle: draw once per connect, then report.
class Block extends HTMLElement {
  connectedCallback() {
    if (this._drawn) return;                       // moved inside the page (a claim folding), not new
    this._drawn = true;
    const caption = this.getAttribute('caption');
    if (caption) this.append(make('figcaption', 'atl-b-caption', esc(caption)));
    Promise.resolve().then(() => this.draw()).then(
      () => this.done('true'),
      error => { this.prepend(make('pre', 'atl-b-error', esc(`${this.localName}: ${error?.message || error}\n\n${sourceOf(this)}`))); this.done('error'); });
  }
  done(state) { this.dataset.rendered = state; document.dispatchEvent(new CustomEvent('atelier:rendered')); }
  // Text for a reader without the renderer: shown until the drawing exists, kept for screen readers after.
  fallback() { const alt = this.getAttribute('alt'); if (alt) this.prepend(make('p', 'atl-b-alt', esc(alt))); }
  place(node) { const alt = this.querySelector(':scope > .atl-b-alt'); alt ? alt.after(node) : this.prepend(node); }
}

// ===== <atelier-mermaid alt="…"> ======================================================
let mermaidReady = null;
customElements.define('atelier-mermaid', class extends Block {
  async draw() {
    this.fallback();
    mermaidReady ||= load(PIN.mermaid).then(({ default: m }) => { m.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { useMaxWidth: false } }); return m; });
    const mermaid = await mermaidReady, box = make('div', 'atl-b-scroll'), pre = make('pre', 'mermaid');
    pre.textContent = sourceOf(this);
    box.append(pre); this.place(box);
    await mermaid.run({ nodes: [pre] });             // nodes keep Mermaid's ids, so a Thread on a box survives edits
    this.dataset.diagramReady = 'true';
  }
});

// ===== <atelier-chart alt="…"> — a Vega-Lite spec as JSON ===============================
customElements.define('atelier-chart', class extends Block {
  async draw() {
    this.fallback();
    const spec = JSON.parse(sourceOf(this)), { default: embed } = await load(PIN.vegaEmbed), box = make('div', 'atl-b-scroll');
    this.place(box);
    await embed(box, spec, { renderer: 'svg', actions: false });
    this.dataset.diagramReady = 'true';
  }
});

// ===== <atelier-file src|diff|lang name> ================================================
// Text stays real DOM, one element per source line, so a Thread anchors to any line. Each line keeps
// its newline, so a selection over several lines is found again in the page text.
const lines = html => { const open = [], all = html.split('\n'); return all.map((l, i) => {
  const out = `<span class="line">${open.join('')}${l}${'</span>'.repeat(open.length + (l.match(/<span[^>]*>/g) || []).length - (l.match(/<\/span>/g) || []).length)}${i < all.length - 1 ? '\n' : ''}</span>`;
  for (const t of l.match(/<span[^>]*>|<\/span>/g) || []) t === '</span>' ? open.pop() : open.push(t);
  return out; }).join(''); };
customElements.define('atelier-file', class extends Block {
  async draw() {
    PIN.css.forEach(stylesheet);
    const path = this.getAttribute('src') || this.getAttribute('diff');
    const text = path ? await fetch(path).then(r => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.text(); }) : sourceOf(this);
    const lang = this.getAttribute('lang') || (path || '').split('.').pop();
    const name = this.getAttribute('name') || (path || '').split('/').pop();
    let body;
    if (this.hasAttribute('diff') || lang === 'diff' || lang === 'patch') {
      const { html } = await load(PIN.diff2html);
      body = html(text, { outputFormat: this.clientWidth >= 1100 ? 'side-by-side' : 'line-by-line', drawFileList: false, matching: 'lines' });
    } else {
      const { default: hljs } = await load(PIN.hljs);
      if (lang === 'md' || lang === 'markdown') {
        const { default: MarkdownIt } = await load(PIN.markdownIt);
        const md = new MarkdownIt({ linkify: true, highlight: (s, l) => l === 'mermaid'
          ? `<pre class="mermaid">${md.utils.escapeHtml(s)}</pre>`
          : hljs.getLanguage(l) ? `<pre class="hljs"><code>${hljs.highlight(s, { language: l }).value}</code></pre>` : '' });
        body = `<div class="markdown-body">${md.render(text)}</div>`;
      } else body = `<pre class="atl-b-code hljs">${lines(hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang }).value : esc(text))}</pre>`;
    }
    const head = name ? `<div class="atl-b-file-name">${path ? `<a href="${esc(path)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)}</div>` : '';
    const view = make('div', 'atl-b-file', head + body);
    for (const pre of view.querySelectorAll('pre.mermaid')) {        // ```mermaid fences draw as diagrams
      const block = document.createElement('atelier-mermaid'), src = make('script');
      src.type = 'text/plain'; src.textContent = pre.textContent; block.append(src); pre.replaceWith(block);
    }
    this.prepend(view);
  }
});

// ===== <atelier-video src> — lines of "m:ss what happens" ===============================
export const parseMarks = text => text.split('\n').filter(l => l.trim()).map(l => {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)\s+(.+)$/.exec(l);
  if (!m) throw new Error(`a mark is "m:ss what happens", got "${l.trim()}"`);
  return { t: (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3], stamp: l.trim().split(/\s+/)[0], text: m[4] };
});
// Large by default, with a small/large toggle. Sibling <atelier-video>s are alternatives, not a
// comparison: they share one exclusive <details> group (one open at a time) unless one is marked
// `compare`. The group is native, so the kernel's reveal opens the video a Thread points into.
const videoSize = new Map(), videoGroups = new WeakMap(), videoOpen = new Map();
let groupCount = 0;
customElements.define('atelier-video', class extends Block {
  draw() {
    const marks = parseMarks(sourceOf(this)), key = this.getAttribute('src');
    const video = make('video', 'atl-b-video');
    const size = make('button', 'atl-b-size');
    const sized = small => { this.classList.toggle('is-small', small); size.textContent = small ? '⤢' : '⤡';
      size.title = size.ariaLabel = small ? say('Show larger', 'Größer zeigen') : say('Show smaller', 'Kleiner zeigen'); };
    size.type = 'button'; sized(videoSize.get(key) ?? this.hasAttribute('small'));
    size.addEventListener('click', () => { videoSize.set(key, !this.classList.contains('is-small')); sized(videoSize.get(key)); });
    Object.assign(video, { controls: true, preload: 'metadata', src: this.getAttribute('src') });
    if (this.getAttribute('poster')) video.poster = this.getAttribute('poster');
    video.setAttribute('data-atl-point', '');
    const list = make('ol', 'atl-b-marks', marks.map(m => `<li data-t="${m.t}"><button type="button" class="atl-b-seek" data-t="${m.t}">${esc(m.stamp)}</button> ${esc(m.text)}</li>`).join(''));
    list.addEventListener('click', e => { const b = e.target.closest('.atl-b-seek'); if (b) { video.currentTime = +b.dataset.t; video.pause(); } });
    video.addEventListener('timeupdate', () => {
      const now = [...list.children].filter(li => +li.dataset.t <= video.currentTime + 0.05).pop();
      list.querySelectorAll('.is-now').forEach(li => li !== now && li.classList.remove('is-now'));
      now?.classList.add('is-now');
    });
    const parent = this.parentElement, peers = [...parent.children].filter(e => e.localName === 'atelier-video');
    if (peers.length > 1 && !peers.some(e => e.hasAttribute('compare'))) {
      if (!videoGroups.has(parent)) videoGroups.set(parent, `atl-vg-${++groupCount}`);
      const box = make('details', 'atl-b-vgroup'), label = this.getAttribute('label') || this.getAttribute('caption') || (key || '').split('/').pop();
      const sig = peers.map(e => e.getAttribute('src')).join('|');
      box.name = videoGroups.get(parent); box.open = (videoOpen.get(sig) ?? peers[0].getAttribute('src')) === key;
      box.addEventListener('toggle', () => { if (box.open) videoOpen.set(sig, key); });
      box.append(make('summary', '', esc(label)), size, video, list);
      this.prepend(box);
    } else this.prepend(size, video, list);
  }
});

// ===== <atelier-compare before after before-label after-label> ===========================
// Images from attributes, or the first two child elements.
customElements.define('atelier-compare', class extends Block {
  draw() {
    const [b, a] = ['before', 'after'].map(side => {
      const fig = make('figure', `atl-b-side atl-b-${side}`), src = this.getAttribute(side), label = this.getAttribute(`${side}-label`) || side[0].toUpperCase() + side.slice(1);
      return { fig, src, label };
    });
    const kids = [...this.children].filter(c => !/^(SCRIPT|FIGCAPTION)$/.test(c.tagName));
    if (!b.src && kids.length < 2) throw new Error('needs before= and after= images, or two child elements');
    [b, a].forEach((s, i) => {
      if (s.src) s.fig.append(Object.assign(make('img'), { src: s.src, alt: s.label, loading: 'lazy' })); else s.fig.append(kids[i]);
      s.fig.prepend(make('div', 'atl-b-label', esc(s.label)));
    });
    this.prepend(make('div', 'atl-b-pair'));
    this.firstChild.append(b.fig, a.fig);
  }
});

// ===== <atelier-mock frame="browser|phone|none" w url alt> with a <template> ============
// The mockup's own CSS cannot leak into the Surface, nor the Surface's into it. The kernel cannot
// see inside a shadow root, so a Thread on a mockup anchors a point on it (data-atl-point).
customElements.define('atelier-mock', class extends Block {
  draw() {
    const tpl = this.querySelector(':scope > template');
    if (!tpl) throw new Error('needs a <template> holding the mockup');
    const w = +this.getAttribute('w') || 480, frame = this.getAttribute('frame') || 'none', url = this.getAttribute('url') || '';
    this.fallback();
    const stage = make('div', 'atl-b-stage'), root = stage.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:block;overflow:hidden}.f{width:${w}px;transform-origin:0 0;box-sizing:border-box;background:#fff;color:#111;font:14px system-ui,sans-serif}
      .browser{border:1px solid #cfd3d8;border-radius:8px;overflow:hidden}.bar{display:flex;gap:6px;align-items:center;padding:6px 10px;background:#eef0f3;border-bottom:1px solid #cfd3d8;font:12px system-ui;color:#555}
      .bar i{width:10px;height:10px;border-radius:50%;background:#d0d4da;display:inline-block}.bar span{margin-left:8px;flex:1;background:#fff;border-radius:4px;padding:2px 8px}
      .phone{border:10px solid #1d232a;border-radius:28px;overflow:hidden}</style>
      <div class="f ${frame}">${frame === 'browser' ? `<div class="bar"><i></i><i></i><i></i><span>${esc(url)}</span></div>` : ''}<div class="body"></div></div>`;
    root.querySelector('.body').append(tpl.content.cloneNode(true));
    stage.setAttribute('data-atl-point', '');
    stage.setAttribute('role', 'img');
    stage.setAttribute('aria-label', this.getAttribute('alt') || 'UI mockup');
    const f = root.querySelector('.f');
    new ResizeObserver(() => {
      const s = Math.min(1, (this.clientWidth || w) / w);
      f.style.transform = `scale(${s})`; stage.style.height = `${Math.ceil(f.offsetHeight * s)}px`;
    }).observe(this);
    this.place(stage);
  }
});

// ===== <atelier-claims open="0"> — a tree of claims ======================================
// Each claim is an atl-key Region whose first child is a <p> holding one sentence that can be
// true or false. The tree numbers the claims (1, 1.2, 1.2.1) and folds each one into a <details>,
// so the closed tree reads as the summary and the kernel's reveal() opens the way to any anchor.
// Open claims stay open, and closed ones closed, across a Ready that swaps a claim in.
// What the human did to a claim — opened or closed — wins over the tree's initial depth.
const claimOpen = new Map();
const claimsOf = el => [...el.querySelectorAll('[atl-key]')].filter(r => r.parentElement.closest('[atl-key], atelier-claims') === el);
function foldClaim(region, number, depth, openTo) {
  region.dataset.claim = number;
  let details = region.querySelector(':scope > details.atl-claim');
  if (!details) {
    const sentence = region.querySelector(':scope > p');
    details = make('details', 'atl-claim');
    const summary = make('summary', 'atl-claim-head');
    summary.append(make('span', 'atl-claim-no'));
    if (sentence) summary.append(sentence);
    details.append(summary, ...region.childNodes);
    region.append(details);
    details.open = claimOpen.get(regionKey(region)) ?? depth < openTo;
    details.addEventListener('toggle', () => claimOpen.set(regionKey(region), details.open));
    // Selecting a claim's words to comment on them must not fold it.
    summary.addEventListener('click', e => { if (String(getSelection())) e.preventDefault(); });
  }
  details.querySelector(':scope > summary > .atl-claim-no').textContent = number;
  claimsOf(region).forEach((child, i) => foldClaim(child, `${number}.${i + 1}`, depth + 1, openTo));
}
function foldAll() {
  for (const tree of document.querySelectorAll('atelier-claims')) {
    const openTo = +tree.getAttribute('open') || 0;
    claimsOf(tree).forEach((claim, i) => foldClaim(claim, String(i + 1), 0, openTo));
  }
  document.dispatchEvent(new CustomEvent('atelier:rendered'));
}
customElements.define('atelier-claims', class extends HTMLElement {
  connectedCallback() { queueMicrotask(() => { foldAll(); this.dataset.rendered = 'true'; }); }
});
document.addEventListener('atelier:ready', foldAll);

// ===== <atelier-findings> — "liked|disliked|fact|gap: text", one per line ==================
const KINDS = { liked: ['Liked', 'Gefällt'], disliked: ['Disliked', 'Stört'], fact: ['Fact', 'Fakt'], gap: ['Gap', 'Lücke'] };
export const parseFindings = text => text.split('\n').filter(l => l.trim()).map(l => {
  const m = /^\s*(liked|disliked|fact|gap)\s*:\s*(.+)$/i.exec(l);
  if (!m) throw new Error(`a finding is "liked|disliked|fact|gap: text", got "${l.trim()}"`);
  return { kind: m[1].toLowerCase(), text: m[2] };
});
export const findingLabel = (kind, german) => KINDS[kind][german ? 1 : 0];
customElements.define('atelier-findings', class extends Block {
  draw() {
    this.prepend(make('ul', 'atl-b-findings', parseFindings(sourceOf(this)).map(f =>
      `<li class="atl-b-f atl-b-f--${f.kind}"><span class="atl-b-tag">${findingLabel(f.kind, de())}</span> ${inline(f.text)}</li>`).join('')));
  }
});

// ===== <atelier-decision> — "? question", options as "* recommended" / "- alternative",
// each followed by its own indented context lines ("+ for", "- against", or plain text) =========
export function parseDecision(text) {
  const d = { question: '', options: [] };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const t = line.trim();
    if (!/^\s/.test(line) && t.startsWith('?')) d.question = t.slice(1).trim();
    else if (!/^\s/.test(line) && /^[*-]\s/.test(t)) d.options.push({ label: t.slice(2).trim(), rec: t[0] === '*', context: [] });
    else if (/^\s/.test(line) && d.options.length) {
      const m = /^([+\-−])\s+(.*)$/.exec(t);
      d.options.at(-1).context.push(m ? { kind: m[1] === '+' ? 'pro' : 'con', text: m[2] } : { kind: 'note', text: t });
    } else throw new Error(`"${t.slice(0, 40)}" is neither "? question", "* option", "- option", nor an indented context line under an option`);
  }
  if (!d.question) throw new Error('needs a "? question" line');
  if (d.options.length < 2) throw new Error('needs at least two options; one option is a statement, not a decision');
  if (d.options.filter(o => o.rec).length > 1) throw new Error('recommends more than one option ("*")');
  return d;
}
customElements.define('atelier-decision', class extends Block {
  draw() {
    const d = parseDecision(sourceOf(this)), rec = say('Recommended', 'Empfohlen');
    const ctx = c => `<li class="atl-b-${c.kind}">${inline(c.text)}</li>`;
    this.prepend(make('div', 'atl-b-decision', `<p class="atl-b-q">${inline(d.question)}</p><ol class="atl-b-options">${d.options.map(o =>
      `<li class="atl-b-opt${o.rec ? ' is-rec' : ''}"><p class="atl-b-opt-head"><b>${inline(o.label)}</b>${o.rec ? ` <span class="atl-b-rec">${rec}</span>` : ''}</p>`
      + (o.context.length ? `<ul class="atl-b-ctx">${o.context.map(ctx).join('')}</ul>` : '') + '</li>').join('')}</ol>`));
  }
});

// ===== <atelier-flow> — its child atl-key Regions are the steps; a step's own child Regions are its
// sub-steps; `parallel` on a step runs it beside the sibling before. A map beside the steps shows one
// level at a time (overview → step → sub-step); choosing a node scrolls to its Region. Every unit is a
// Region, so the human comments on and decides about any step, and its detail stays in it. ==========
const flowKids = (el, root) => [...el.querySelectorAll('[atl-key]')].filter(r => r.parentElement.closest('[atl-key], atelier-flow') === el && r.closest('atelier-flow') === root);
const flowState = new Map();
customElements.define('atelier-flow', class extends HTMLElement {
  connectedCallback() {
    if (this._built) return; this._built = true;
    queueMicrotask(() => {
      const kids = el => flowKids(el, this), byKey = k => k ? [...this.querySelectorAll('[atl-key]')].find(r => regionKey(r) === k) : null;
      const st = flowState.get(keyOf(this)) || { zoom: '', sel: '' }; flowState.set(keyOf(this), st);
      const map = make('nav', 'atl-b-flow-map'); map.setAttribute('aria-label', say('Map', 'Karte'));
      const steps = list => list.reduce((out, r) => { r.hasAttribute('parallel') && out.length ? out.at(-1).push(r) : out.push([r]); return out; }, []);
      const draw = () => {
        const at = byKey(st.zoom) || this, crumbs = [];
        for (let r = at; r && r !== this; r = r.parentElement.closest('[atl-key], atelier-flow')) crumbs.unshift(r);
        map.innerHTML = `<p class="atl-b-crumbs"><button type="button" data-zoom="">${say('Overview', 'Überblick')}</button>${crumbs.map(r => ` › <button type="button" data-zoom="${esc(regionKey(r))}">${esc(labelOf(r))}</button>`).join('')}</p>
          <ol class="atl-b-lane">${steps(kids(at)).map(g => `<li class="atl-b-step${g.length > 1 ? ' is-parallel' : ''}">${g.length > 1 ? `<span class="atl-b-par">${say('parallel', 'parallel')}</span>` : ''}${g.map(r => {
            const k = regionKey(r), n = kids(r).length;
            return `<button type="button" class="atl-b-node${k === st.sel ? ' is-sel' : ''}" data-node="${esc(k)}" aria-pressed="${k === st.sel}">${esc(labelOf(r))}${n ? ` <small>${n} ›</small>` : ''}</button>`; }).join('')}</li>`).join('')}</ol>`;
      };
      const select = (k, scroll) => {
        const r = byKey(k); if (!r) return;
        const parent = r.parentElement.closest('[atl-key], atelier-flow');
        st.sel = k; st.zoom = kids(r).length ? k : parent === this ? '' : regionKey(parent);
        this.querySelectorAll('.atl-b-sel').forEach(e => e.classList.remove('atl-b-sel')); r.classList.add('atl-b-sel');
        if (scroll) r.scrollIntoView({ block: 'start', behavior: 'smooth' });
        draw();
      };
      map.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if ('zoom' in b.dataset) { st.zoom = b.dataset.zoom; draw(); } else select(b.dataset.node, true);
      });
      document.addEventListener('atelier:reveal', e => {
        if (!this.isConnected || !this.contains(e.detail.target)) return;
        let r = e.detail.target.closest?.('[atl-key]'); while (r && r.closest('atelier-flow') !== this) r = r.parentElement?.closest('[atl-key]');
        if (r && this.contains(r) && r !== this) select(regionKey(r), false);
      });
      document.addEventListener('atelier:ready', () => { if (this.isConnected) { if (!this.contains(map)) this.prepend(map); st.sel ? select(st.sel, false) : draw(); } });
      this.prepend(map);
      st.sel ? select(st.sel, false) : draw();
      this.dataset.rendered = 'true'; document.dispatchEvent(new CustomEvent('atelier:rendered'));
    });
  }
});

// ===== <atelier-timeline> — a step per unindented line; under it, indented:
// "![alt](src)" a screenshot, "> who: text" a reviewer's comment, anything else a note ==========
export function parseTimeline(text) {
  const steps = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const t = line.trim();
    if (!/^\s/.test(line)) { steps.push({ title: t, items: [] }); continue; }
    if (!steps.length) throw new Error(`"${t.slice(0, 40)}" is indented before any step`);
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t), said = /^>\s*([^:]+):\s*(.+)$/.exec(t);
    steps.at(-1).items.push(img ? { kind: 'shot', alt: img[1], src: img[2] } : said ? { kind: 'said', who: said[1], text: said[2] } : { kind: 'note', text: t });
  }
  if (!steps.length) throw new Error('has no steps');
  return steps;
}
customElements.define('atelier-timeline', class extends Block {
  draw() {
    const item = i => i.kind === 'shot' ? `<a class="atl-b-shot" href="${esc(i.src)}" target="_blank" rel="noopener"><img src="${esc(i.src)}" alt="${esc(i.alt)}" loading="lazy"></a>`
      : i.kind === 'said' ? `<blockquote class="atl-b-said"><b class="atl-b-who">${esc(i.who)}</b> ${inline(i.text)}</blockquote>` : `<p>${inline(i.text)}</p>`;
    this.prepend(make('ol', 'atl-b-timeline', parseTimeline(sourceOf(this)).map(s => `<li class="atl-b-tstep"><h4>${inline(s.title)}</h4>${s.items.map(item).join('')}</li>`).join('')));
  }
});

// ===== <atelier-tabs side> — each child atl-key Region is a tab, named by atl-label or its heading ===========================
// Hidden panels stay in the DOM (display: none, never [hidden]), so a Thread inside one still
// resolves; revealing it switches to its tab. The chosen tab survives a Ready and a reload.
customElements.define('atelier-tabs', class extends HTMLElement {
  connectedCallback() {
    if (this._built) return; this._built = true;
    queueMicrotask(() => {
      const panels = () => [...this.children].filter(e => e.hasAttribute('atl-key'));
      const store = `atelier:tab:${panels().map(regionKey).join('|')}`;
      const nav = make('div', 'atl-b-tablist'); nav.setAttribute('role', 'tablist');
      const show = key => {
        const all = panels(), pick = all.find(p => regionKey(p) === key) || all[0];
        try { sessionStorage.setItem(store, regionKey(pick)); } catch {}
        all.forEach(p => { p.classList.toggle('atl-b-off', p !== pick); p.setAttribute('role', 'tabpanel'); });
        nav.innerHTML = all.map(p => `<button type="button" role="tab" aria-selected="${p === pick}" data-tab="${esc(regionKey(p))}">${esc(labelOf(p))}</button>`).join('');
        if (this.hasAttribute('side')) nav.insertAdjacentHTML('beforeend', `<button type="button" class="atl-b-fold" data-fold aria-label="${say('Fold navigation', 'Navigation einklappen')}" title="${say('Fold navigation', 'Navigation einklappen')}">⇤</button>`);
      };
      nav.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if ('fold' in b.dataset) { this.toggleAttribute('data-folded'); try { localStorage.setItem('atelier:sidenav', this.hasAttribute('data-folded') ? '1' : ''); } catch {} }
        else show(b.dataset.tab);
      });
      try { if (localStorage.getItem('atelier:sidenav')) this.setAttribute('data-folded', ''); } catch {}
      this.prepend(nav);
      let saved = null; try { saved = sessionStorage.getItem(store); } catch {}
      show(saved);
      document.addEventListener('atelier:reveal', e => { const p = this.isConnected && panels().find(p => p.contains(e.detail.target)); if (p) show(regionKey(p)); });
      document.addEventListener('atelier:ready', () => this.isConnected && show(nav.querySelector('[aria-selected="true"]')?.dataset.tab));
      this.dataset.rendered = 'true'; document.dispatchEvent(new CustomEvent('atelier:rendered'));
    });
  }
});
