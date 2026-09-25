// atelier kernel — the browser half. Vendored from the atelier skill: copy it, never patch it.
//
// The kernel supplies interaction, never layout. It never inserts anything into authored content.
//   <atelier-region key label>  identity and address only
//   <atelier-margin>            Threads and Proposals, each level with its anchor (the Surface places it)
//   <atelier-activity>          Pick-to-comment + one drawer: waiting for you, changed, Updates
// A Thread opens on an anchor: selected text, any element (Alt+click or Pick), a point on an image
// or SVG, or a whole Region. Ready swaps only the named Regions into the open page.
// ponytail: iframe picking is not built; a Surface that embeds a cooperating app posts its own
// anchors (see references/protocol.md#extending). Narrow screens get a bottom list, not anchoring.

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(r => r.json().catch(() => ({ ok: r.ok })));
let S = { threads: {}, sent: {}, replies: {}, commentState: {}, proposals: {}, updates: {}, changed: {}, seq: 0 };
let active = null;                       // id of the expanded Thread or Proposal
const pending = new Map();               // unsent new Threads: id -> { id, region, anchor, text, attachments }
const kept = new Map();                  // '<card>|<field>' -> half-typed text, kept while a card is closed
const atts = new Map();                  // '<card>|new' or '<card>|reply' -> pasted image URLs not yet sent
const DRAFTS = 'atelier:drafts';

// ===== Regions: identity only ======================================================
class AtelierRegion extends HTMLElement {
  get regionKey() {
    const parent = this.parentElement?.closest('atelier-region');
    return (parent ? parent.regionKey + '/' : '') + (this.getAttribute('key') || 'unnamed');
  }
  get label() { return this.getAttribute('label') || this.querySelector('h1,h2,h3,h4')?.textContent.trim() || this.getAttribute('key'); }
}
customElements.define('atelier-region', AtelierRegion);
const regionEls = () => [...document.querySelectorAll('atelier-region')];
const regionEl = key => regionEls().find(r => r.regionKey === key);
const labelOf = key => regionEl(key)?.label || key;

// ===== anchors ======================================================================
// { region, quote?, prefix?, selector?, point?:{x,y} }. Only `region` means the whole Region.
// Text is found again by quote + prefix, so it survives a Ready that re-renders the Region.
const CHROME = 'atelier-margin,atelier-activity,.atl-float,.atl-warnings';
function textIndex(root) {
  const nodes = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest(`${CHROME},script,style,textarea,[hidden]`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  let text = '', n;
  while ((n = w.nextNode())) { nodes.push({ n, at: text.length }); text += n.data; }
  return { text, nodes };
}
function rangeAt(idx, start, end) {
  const find = pos => { let k = idx.nodes.length - 1; while (k > 0 && idx.nodes[k].at > pos) k--; return idx.nodes[k]; };
  const a = find(start), b = find(end - 1), r = document.createRange();
  r.setStart(a.n, start - a.at); r.setEnd(b.n, end - b.at); return r;
}
function selectorFor(el, root) {
  const parts = [];
  for (let e = el; e && e !== root; e = e.parentElement) {
    const same = [...e.parentElement.children].filter(c => c.tagName === e.tagName);
    parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''));
  }
  return parts.length ? ':scope > ' + parts.join(' > ') : null;
}
// -> { range } | { el, point? } | { el, detached:true } | null (Region gone)
function resolve(anchor, fallbackRegion) {
  const root = regionEl(anchor?.region || fallbackRegion);
  if (!root) return null;
  if (anchor?.quote) {
    const idx = textIndex(root);
    let at = -1, from = 0;
    while ((from = idx.text.indexOf(anchor.quote, from)) !== -1) {       // prefer the occurrence with its context
      if (at === -1) at = from;
      if (anchor.prefix && idx.text.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix) { at = from; break; }
      from += 1;
    }
    return at === -1 ? { el: root, root, detached: true } : { range: rangeAt(idx, at, at + anchor.quote.length), root };
  }
  if (anchor?.selector) {
    let el = null; try { el = root.querySelector(anchor.selector); } catch {}
    return el ? { el, root, point: anchor.point } : { el: root, root, detached: true };
  }
  return { el: root, root };
}
const topOf = res => (res.range ? res.range.getBoundingClientRect() : res.el.getBoundingClientRect()).top +
  (res.point ? res.el.getBoundingClientRect().height * res.point.y : 0);

// ===== opening a Thread =============================================================
const regionFor = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('atelier-region');
function anchorFromSelection() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0), container = range.commonAncestorContainer;
  const region = regionFor(container);
  if (!region || (container.nodeType === 1 ? container : container.parentElement).closest(CHROME)) return null;
  const quote = sel.toString().trim();
  if (quote.length < 2) return null;
  const idx = textIndex(region), pre = document.createRange();
  pre.setStart(region, 0); pre.setEnd(range.startContainer, range.startOffset);
  const offset = idx.text.indexOf(quote, Math.max(0, pre.toString().length - 40));
  return { region: region.regionKey, quote, prefix: offset > 0 ? idx.text.slice(Math.max(0, offset - 32), offset) : '' };
}
function anchorFromElement(el, event) {
  const region = el.closest('atelier-region');
  if (!region) return null;
  if (el === region) return { region: region.regionKey };
  // Inside a diagram, anchor the box that was clicked (Mermaid and Graphviz draw each as g.node, or
  // mark your own with data-anchor); anywhere else on an SVG or image, a relative point.
  const box = el.closest('svg g.node, svg [data-anchor]');
  if (box && region.contains(box)) return { region: region.regionKey, selector: boxSelector(box, region) };
  const target = el.closest('svg') || el, a = { region: region.regionKey, selector: selectorFor(target, region) };
  if (target.tagName === 'IMG' || target.tagName.toLowerCase() === 'svg') {
    const r = target.getBoundingClientRect();
    a.point = { x: +((event.clientX - r.left) / r.width).toFixed(3), y: +((event.clientY - r.top) / r.height).toFixed(3) };
  }
  return a;
}
// A diagram box is found again by its name, not its position: Mermaid ids are
// mermaid-<render>-<name>-<counter>, and both parts that change are left out.
function boxSelector(box, region) {
  const own = box.getAttribute('data-anchor');
  if (own) return `:scope [data-anchor="${CSS.escape(own)}"]`;
  const m = /^mermaid-\d+-(.+)-\d+$/.exec(box.id);
  if (m) return `:scope g.node[id*="-${CSS.escape(m[1])}-"]`;
  if (box.id && !/^node\d+$/.test(box.id)) return `:scope #${CSS.escape(box.id)}`;
  return selectorFor(box, region);
}
function openNew(anchor) {
  const id = 'c-' + Math.random().toString(36).slice(2, 10);
  pending.set(id, { id, region: anchor.region, anchor, text: '' });
  saveDrafts(); active = id; getSelection().removeAllRanges(); float.hidden = true; render();
  requestAnimationFrame(() => $(`[data-card="${id}"] textarea`)?.focus({ preventScroll: true }));
}
function saveDrafts() {
  const out = {};
  for (const [id, p] of pending) {
    p.text = $(`[data-card="${id}"] [data-new]`)?.value ?? kept.get(id + '|new') ?? p.text ?? '';
    p.attachments = atts.get(id + '|new') || [];
    out[id] = p;
  }
  try { localStorage.setItem(DRAFTS, JSON.stringify(out)); } catch {}
}
try { for (const [id, p] of Object.entries(JSON.parse(localStorage.getItem(DRAFTS) || '{}'))) {
  pending.set(id, p); kept.set(id + '|new', p.text || ''); if (p.attachments?.length) atts.set(id + '|new', p.attachments);
} } catch {}

const float = document.createElement('button');
float.className = 'atl-float'; float.type = 'button'; float.textContent = '💬 Thread'; float.hidden = true;
float.addEventListener('mousedown', e => e.preventDefault());
float.addEventListener('click', () => float._anchor && openNew(float._anchor));
document.addEventListener('mouseup', e => {
  if (e.target.closest?.(CHROME)) return;
  setTimeout(() => {
    const a = anchorFromSelection();
    if (!a) { float.hidden = true; return; }
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    float._anchor = a; float.hidden = false;
    float.style.top = `${scrollY + r.bottom + 6}px`; float.style.left = `${scrollX + Math.min(r.right, innerWidth - 120)}px`;
  });
});

let picking = false;
function setPicking(on) { picking = on; document.documentElement.classList.toggle('atl-picking', on); renderActivity(); }
document.addEventListener('mouseover', e => {
  document.querySelectorAll('.atl-pick-hover').forEach(x => x.classList.remove('atl-pick-hover'));
  if ((picking || e.altKey) && !e.target.closest?.(CHROME)) e.target.closest?.('atelier-region *, atelier-region')?.classList.add('atl-pick-hover');
});
const caretAt = (x, y) => {
  const p = document.caretPositionFromPoint?.(x, y);
  if (p) return [p.offsetNode, p.offset];
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? [r.startContainer, r.startOffset] : null;
};
document.addEventListener('click', e => {
  if (e.target.closest?.(CHROME)) return;
  if (picking || e.altKey) {
    const a = anchorFromElement(e.target, e);
    if (a) { e.preventDefault(); e.stopPropagation(); setPicking(false); openNew(a); }
    return;
  }
  if (getSelection().toString()) return;
  const hit = cache.find(it => {                     // clicking anchored text or an anchored element opens its card
    const res = it.res;
    if (!res || res.detached || !it.anchor || (!res.range && res.el === res.root)) return false;
    if (res.range) { const c = caretAt(e.clientX, e.clientY); return c && res.range.isPointInRange(...c); }
    return res.el.contains(e.target);
  });
  if (hit) { active = hit.id; render(); }
  else if (active) { active = null; render(); }      // a click elsewhere on the page closes the open card
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (picking) return setPicking(false);
  if (active && !$('#atl-drawer:popover-open')) { active = null; render(); }   // the draft stays in `kept`
});

// ===== what the margin shows ========================================================
let cache = [];
function items() {
  const out = [], all = Object.values(S.threads || {}).flat();
  for (const [region, list] of Object.entries(S.threads || {}))
    for (const c of list) if (S.sent[c.id]) out.push({ kind: 'thread', id: c.id, region, anchor: c.anchor, c });
  for (const p of pending.values()) out.push({ kind: 'new', id: p.id, region: p.region, anchor: p.anchor, c: p });
  for (const pr of Object.values(S.proposals || {})) {
    const owner = pr.threadId && all.find(c => c.id === pr.threadId);
    out.push({ kind: 'proposal', id: pr.id, region: pr.region, anchor: pr.anchor || owner?.anchor, pr });
  }
  return out.map(it => ({ ...it, res: resolve(it.anchor, it.region) }));
}

customElements.define('atelier-margin', class extends HTMLElement {
  connectedCallback() { this.setAttribute('role', 'complementary'); if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Threads'); }
});

const STATE = { open: 'Sent', acknowledged: 'Seen by agent', in_progress: 'Agent working', implemented: 'Done — check it', accepted: 'Accepted', rejected: 'Reopened' };
function where(it) {
  if (!it.res) return '<div class="atl-detached">Its section is no longer on this page.</div>';
  return it.res.detached ? '<div class="atl-detached">The part this pointed at has changed.</div>' : '';
}
const CLOSE = '<button class="atl-close" data-close aria-label="Close" title="Close (Esc)">×</button>';
const imgs = urls => urls?.length ? `<div class="atl-atts">${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Pasted image"></a>`).join('')}</div>` : '';
const pendingImgs = key => { const u = atts.get(key) || [];
  return u.length ? `<div class="atl-atts">${u.map((x, i) => `<span class="atl-att"><img src="${esc(x)}" alt="Pasted image"><button class="atl-att-x" data-unattach="${esc(key)}" data-i="${i}" aria-label="Remove image">×</button></span>`).join('')}</div>` : ''; };
// A decision is two steps: pick an option, then Decide. One stray click never commits, and a
// decided Proposal can be reopened and changed.
function proposalHTML(it, open) {
  const pr = it.pr, decided = pr.status === 'decided';
  const choice = pr.custom || pr.options?.[pr.choiceIndex] || '';
  if (decided && !open) return `<button class="atl-card atl-card--line atl-card--decided" data-open="${it.id}">✓ <b>Decided</b> · ${esc(clean(String(choice)).split(/[.:;(]/)[0])}</button>`;
  if (!open) return `<button class="atl-card atl-card--line atl-card--ask" data-open="${it.id}"><span class="atl-first"><b>Decide:</b> ${esc(pr.question)}</span><span class="atl-meta">${(pr.options || []).length} options</span></button>`;
  const picked = kept.get(it.id + '|choice') ?? (decided ? (pr.custom ? 'custom' : String(pr.choiceIndex)) : '');
  const opt = (o, i) => {
    const req = pr.explanationRequests?.[i], ex = pr.explanations?.[i];
    return `<label class="atl-choice ${picked === String(i) ? 'is-picked' : ''}"><input type="radio" name="atl-${it.id}" data-choose="${it.id}" value="${i}" ${picked === String(i) ? 'checked' : ''}>
      <span>${esc(clean(o))}${i === 0 ? ' <span class="atl-rec">Recommended</span>' : ''}</span></label>
      ${ex ? `<div class="atl-explain">${esc(ex.text)}</div>` : req ? '<div class="atl-explain atl-meta">Explanation requested</div>'
        : `<details class="atl-ask"><summary>Why?</summary><textarea data-explain-text="${it.id}:${i}" placeholder="What is unclear?"></textarea><button class="atl-btn" data-explain="${it.id}" data-i="${i}">Ask</button></details>`}`;
  };
  return `<div class="atl-card atl-card--decision is-open" data-card="${it.id}">${CLOSE}${where(it)}
    <div class="atl-kicker">${decided ? 'Decided' : 'Decision needed'}</div>
    <p class="atl-q">${esc(pr.question)}</p>
    <div class="atl-choices" role="radiogroup">${(pr.options || []).map(opt).join('')}
      <label class="atl-choice ${picked === 'custom' ? 'is-picked' : ''}"><input type="radio" name="atl-${it.id}" data-choose="${it.id}" value="custom" ${picked === 'custom' ? 'checked' : ''}><span>Something else</span></label>
      ${picked === 'custom' ? `<textarea data-custom="${it.id}" placeholder="Your answer…">${esc(pr.custom || '')}</textarea>` : ''}</div>
    <div class="atl-row"><button class="atl-btn atl-btn--primary" data-decide="${it.id}" ${picked ? '' : 'disabled'}>${decided ? 'Change decision' : 'Decide'}</button></div>
  </div>`;
}
const clean = o => o.replace(/\s*\((recommended|empfohlen)\)\s*$/i, '');
function cardHTML(it) {
  const open = it.id === active;
  if (it.kind === 'proposal') return proposalHTML(it, open);
  const c = it.c, st = S.commentState[c.id]?.value, replies = S.replies[c.id] || [];
  const quote = it.anchor?.quote ? `<blockquote>${esc(it.anchor.quote.slice(0, 140))}</blockquote>` : '';
  if (it.kind === 'new' && !open) return `<button class="atl-card atl-card--line" data-open="${it.id}">
      <span class="atl-first">✎ ${esc(kept.get(it.id + '|new') || c.text || 'Unsent Thread')}</span><span class="atl-meta">Not sent</span></button>`;
  if (it.kind === 'new') return `<div class="atl-card is-open" data-card="${it.id}">${CLOSE}${quote}
      <textarea data-new placeholder="Start a Thread…  (⌘+Enter sends; paste images)">${esc(c.text || '')}</textarea>${pendingImgs(it.id + '|new')}
      <div class="atl-row"><button class="atl-btn atl-btn--primary" data-send="${it.id}">Send</button><button class="atl-link" data-discard="${it.id}">Discard</button></div></div>`;
  if (!open) return `<button class="atl-card atl-card--line ${st === 'implemented' ? 'is-yours' : ''}" data-open="${it.id}">
      <span class="atl-first">${esc(c.text)}</span><span class="atl-meta">${replies.length ? replies.length + (replies.length > 1 ? ' replies' : ' reply') + ' · ' : ''}${STATE[st] || ''}</span></button>`;
  return `<div class="atl-card is-open" data-card="${it.id}">${CLOSE}${quote}${where(it)}
      <div class="atl-msg atl-msg--you">${esc(c.text)}${imgs(c.attachments)}</div>
      ${replies.map(r => `<div class="atl-msg ${r.author === 'human' ? 'atl-msg--you' : ''}"><span class="atl-who">${r.author === 'human' ? 'You' : 'Agent'}</span>${esc(r.msg)}${imgs(r.attachments)}</div>`).join('')}
      <div class="atl-state">${STATE[st] || ''}</div>
      <textarea data-reply-text="${it.id}" placeholder="${st === 'implemented' ? 'Reply, or say what is still wrong…' : 'Reply…'}  (⌘+Enter sends)"></textarea>${pendingImgs(it.id + '|reply')}
      <div class="atl-row"><button class="atl-btn ${st === 'implemented' ? '' : 'atl-btn--primary'}" data-reply="${it.id}">Reply</button>
      ${st === 'implemented' ? `<button class="atl-btn atl-btn--primary" data-accept="${it.id}">Accept</button><button class="atl-btn" data-reject="${it.id}" title="Needs the text above">Reopen</button>` : ''}</div></div>`;
}

const highlights = typeof Highlight !== 'undefined' && CSS.highlights;
function render() {
  const margin = $('atelier-margin');
  cache = items();
  document.querySelectorAll('.atl-el-anchor,.atl-el-active').forEach(e => e.classList.remove('atl-el-anchor', 'atl-el-active'));
  if (highlights) {
    CSS.highlights.set('atl-anchor', new Highlight(...cache.filter(i => i.res?.range && i.id !== active).map(i => i.res.range)));
    CSS.highlights.set('atl-active', new Highlight(...cache.filter(i => i.res?.range && i.id === active).map(i => i.res.range)));
  }
  for (const it of cache) if (it.res?.el && !it.res.range && !it.res.detached && it.anchor && it.res.el !== it.res.root)
    it.res.el.classList.add(it.id === active ? 'atl-el-active' : 'atl-el-anchor');
  if (margin) {
    const focused = margin.querySelector('textarea:focus');
    for (const t of margin.querySelectorAll('textarea')) kept.set(keyOf(t), t.value);
    margin.innerHTML = `<div class="atl-margin-head">Threads</div>` +
      cache.map(it => `<div class="atl-slot" data-slot="${it.id}">${cardHTML(it)}</div>`).join('');
    for (const t of margin.querySelectorAll('textarea')) { const v = kept.get(keyOf(t)); if (v) t.value = v; }
    const ta = focused && findTextarea(margin, focused.closest('[data-card]')?.dataset.card, textareaKind(focused));
    // preventScroll: the card is not placed yet, and focusing it at its unplaced spot scrolls the page
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(focused.selectionStart, focused.selectionEnd); }
    layout();
  }
  renderActivity();
}
const textareaKind = t => t.dataset.replyText ? 'reply' : t.dataset.custom ? 'custom' : t.dataset.explainText ? 'explain:' + t.dataset.explainText : 'new';
const keyOf = t => t.closest('[data-card]')?.dataset.card + '|' + textareaKind(t);
const findTextarea = (m, id, kind) => [...m.querySelectorAll(`[data-card="${id}"] textarea`)].find(t => textareaKind(t) === kind);

// Each card sits level with its anchor, pushed down to avoid overlap; the active card is exact.
function layout() {
  const margin = $('atelier-margin');
  if (!margin || getComputedStyle(margin).position === 'fixed') return;
  const base = margin.getBoundingClientRect().top;
  const slots = cache.map(it => ({ it, el: margin.querySelector(`[data-slot="${it.id}"]`), want: it.res ? topOf(it.res) - base : null }))
    .filter(s => s.el).sort((a, b) => (a.want ?? Infinity) - (b.want ?? Infinity));
  // The active card is exact; any other card that would overlap it moves below it.
  const act = slots.find(s => s.it.id === active && s.want != null);
  const A = act ? Math.max(36, act.want) : null, AEnd = act ? A + act.el.offsetHeight + 8 : null;
  if (act) act.el.style.top = A + 'px';
  let y = 36;
  for (const s of slots) {
    if (s === act) continue;
    if (s.want != null) y = Math.max(y, s.want);
    const h = s.el.offsetHeight + 8;
    if (act && y < AEnd && y + h > A) y = AEnd;
    s.el.style.top = y + 'px'; y += h;
  }
  y = Math.max(y, AEnd ?? 0);
  margin.style.minHeight = y + 'px';
}
let raf = 0;
const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
addEventListener('resize', schedule);
document.addEventListener('scroll', e => { if (e.target !== document) schedule(); }, true);   // inner scrollers
new ResizeObserver(schedule).observe(document.documentElement);
// A diagram library draws after load and after every Ready; anchors inside it resolve once it says so.
new MutationObserver(ms => { if (ms.some(m => m.target.dataset?.diagramReady === 'true')) render(); })
  .observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-diagram-ready'] });

// ===== margin actions ===============================================================
const itemOf = id => cache.find(i => i.id === id);
async function sendNew(id) {
  const p = pending.get(id), text = $(`[data-card="${id}"] textarea`)?.value.trim(), images = atts.get(id + '|new') || [];
  if (!p || (!text && !images.length)) return;
  (S.threads[p.region] ||= []).push({ id, text, anchor: p.anchor, ...(images.length ? { attachments: images } : {}) });
  await post('/api/state', { threads: S.threads });
  await post('/api/send', { region: p.region, id });
  pending.delete(id); kept.delete(id + '|new'); atts.delete(id + '|new'); saveDrafts(); await refresh();
}
document.addEventListener('click', async e => {
  const b = e.target.closest?.('atelier-margin button'); if (!b) return;
  const d = b.dataset, value = sel => $(sel)?.value.trim();
  if ('open' in d) {
    active = d.open || null; render();
    const r = active && $(`[data-card="${active}"]`)?.getBoundingClientRect();
    if (r && r.bottom > innerHeight - 12) scrollBy({ top: Math.min(r.bottom - innerHeight + 24, r.top - 80), behavior: 'smooth' });
    return;
  }
  if ('close' in d) { active = null; return render(); }
  if (d.unattach) { atts.get(d.unattach)?.splice(+d.i, 1); if (d.unattach.endsWith('|new')) saveDrafts(); return render(); }
  if (d.send) return sendNew(d.send);
  if (d.discard) { pending.delete(d.discard); saveDrafts(); active = null; return render(); }
  if (d.reply) { const msg = value(`[data-reply-text="${d.reply}"]`), images = atts.get(d.reply + '|reply') || [];
    if (!msg && !images.length) return;
    await post('/api/thread-message', { region: itemOf(d.reply).region, id: d.reply, msg, attachments: images });
    $(`[data-reply-text="${d.reply}"]`).value = ''; atts.delete(d.reply + '|reply'); return refresh(); }
  if (d.accept) { await post('/api/comment-state', { region: itemOf(d.accept).region, id: d.accept, state: 'accepted' }); return refresh(); }
  if (d.reject) { const ta = $(`[data-reply-text="${d.reject}"]`), msg = ta.value.trim();
    if (!msg) { ta.placeholder = 'Say what is still wrong, then Reopen'; return ta.focus({ preventScroll: true }); }
    await post('/api/comment-reject', { region: itemOf(d.reject).region, id: d.reject, msg }); ta.value = ''; return refresh(); }
  if (d.decide) {
    const picked = kept.get(d.decide + '|choice'); if (!picked) return;
    if (picked === 'custom') { const custom = value(`[data-custom="${d.decide}"]`); if (!custom) return $(`[data-custom="${d.decide}"]`)?.focus({ preventScroll: true });
      await post('/api/decide', { id: d.decide, choiceIndex: null, custom }); }
    else await post('/api/decide', { id: d.decide, choiceIndex: +picked });
    kept.delete(d.decide + '|choice'); kept.delete(d.decide + '|custom'); active = null; return refresh();
  }
  if (d.explain) { const answer = value(`[data-explain-text="${d.explain}:${d.i}"]`); if (!answer) return;
    await post('/api/explain-request', { id: d.explain, optionIndex: +d.i, answer }); return refresh(); }
});
document.addEventListener('mouseover', e => {
  const card = e.target.closest?.('atelier-margin [data-slot]');
  document.querySelectorAll('.atl-el-hover').forEach(x => x.classList.remove('atl-el-hover'));
  if (highlights) CSS.highlights.delete('atl-hover');
  const it = card && itemOf(card.dataset.slot);
  if (it?.res?.range && highlights) CSS.highlights.set('atl-hover', new Highlight(it.res.range));
  else if (it?.res?.el && it.anchor && it.res.el !== it.res.root) it.res.el.classList.add('atl-el-hover');
});
document.addEventListener('keydown', e => {
  const ta = e.target.closest?.('atelier-margin textarea'); if (!ta || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  (ta.closest('details') || ta.closest('[data-card]')).querySelector('[data-send],[data-reply],[data-decide],[data-explain]')?.click();
});
document.addEventListener('change', e => {
  const r = e.target.closest?.('atelier-margin [data-choose]'); if (!r) return;
  kept.set(r.dataset.choose + '|choice', r.value); render();
});
document.addEventListener('input', e => {
  const t = e.target.closest?.('atelier-margin textarea'); if (!t) return;
  kept.set(keyOf(t), t.value);
  if (t.matches('[data-new]')) saveDrafts();
});

// Pasting or dropping an image into a new Thread or a reply uploads it and attaches it there.
const IMAGE = /^image\/(png|jpeg|gif|webp)$/;
async function attachFiles(ta, files) {
  const key = keyOf(ta), list = atts.get(key) || [];
  for (const f of files) {
    const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
    const res = await post('/api/attach', { name: f.name || 'pasted', type: f.type, data });
    if (res.url) list.push(res.url); else warn(`Image not attached: ${res.error || 'upload failed'}`);
  }
  atts.set(key, list); kept.set(key, ta.value);
  if (key.endsWith('|new')) saveDrafts();
  render();
}
const imageTarget = e => { const ta = e.target.closest?.('atelier-margin [data-new], atelier-margin [data-reply-text]');
  const files = [...(e.clipboardData || e.dataTransfer)?.files || []].filter(f => IMAGE.test(f.type));
  return ta && files.length ? [ta, files] : null; };
document.addEventListener('paste', e => { const hit = imageTarget(e); if (hit) { e.preventDefault(); attachFiles(...hit); } });
document.addEventListener('dragover', e => { if (e.target.closest?.('atelier-margin textarea')) e.preventDefault(); });
document.addEventListener('drop', e => { const hit = imageTarget(e); if (hit) { e.preventDefault(); attachFiles(...hit); } });

// ===== notifications: on by default, asked for on the first gesture ==================
const NOTIFY = 'atelier:notify';
const hasNotify = typeof Notification !== 'undefined';
const notifyOn = () => { try { return localStorage.getItem(NOTIFY) !== 'off' && hasNotify && Notification.permission === 'granted'; } catch { return false; } };
document.addEventListener('pointerdown', () => {
  if (hasNotify && Notification.permission === 'default' && localStorage.getItem(NOTIFY) !== 'off') Notification.requestPermission().then(renderActivity);
}, { once: true });
const notify = (title, body) => { if (notifyOn() && document.hidden) new Notification(title, { body }); };

// ===== <atelier-activity>: header tools + one drawer ================================
customElements.define('atelier-activity', class extends HTMLElement {
  connectedCallback() {
    if (this._built) return; this._built = true;
    this.innerHTML = `<div class="atl-tools"></div><div class="atl-drawer" id="atl-drawer" popover></div>`;
    this.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const d = b.dataset, drawer = $('#atl-drawer');
      if ('pick' in d) return setPicking(!picking);
      if ('notify' in d) { localStorage.setItem(NOTIFY, notifyOn() ? 'off' : 'on');
        if (hasNotify && Notification.permission === 'default') await Notification.requestPermission(); return renderActivity(); }
      if (d.dismiss) { await post('/api/update-dismiss', { id: d.dismiss }); return refresh(); }
      if (d.ack) { await post('/api/ack', { region: d.ack }); return refresh(); }
      if (d.go) { drawer.hidePopover(); regionEl(d.go)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (d.reveal) { drawer.hidePopover(); reveal(d.reveal); }
    });
  }
});
// Scroll to an interaction's anchor and expand its card.
export function reveal(id) {
  const it = itemOf(id); if (!it) return;
  const target = it.res?.range ? it.res.range.startContainer.parentElement : it.res?.el;
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  active = id; render();
}
function renderActivity() {
  const el = $('atelier-activity'); if (!el?._built) return;
  const ups = Object.values(S.updates || {}).filter(u => !u.dismissedAt);
  const changed = Object.keys(S.changed || {}).filter(k => regionEl(k));
  const waiting = cache.filter(i => i.kind === 'proposal' && i.pr.status === 'open' || i.kind === 'thread' && S.commentState[i.id]?.value === 'implemented');
  const news = ups.length + changed.length;
  el.querySelector('.atl-tools').innerHTML = `
    <button class="atl-btn ${picking ? 'atl-btn--primary' : ''}" data-pick title="Or hold Alt and click">${picking ? 'Click anything… (Esc)' : '💬 Comment on…'}</button>
    <button class="atl-btn ${waiting.length ? 'atl-btn--warn' : ''}" popovertarget="atl-drawer">${waiting.length ? `${waiting.length} waiting for you` : 'Activity'}${news ? ` · ${news} new` : ''}</button>`;
  el.querySelector('.atl-drawer').innerHTML = `
    <div class="atl-drawer-head"><b>Activity</b><button class="atl-link" popovertarget="atl-drawer" popovertargetaction="hide">Close</button></div>
    ${waiting.length ? `<h4>Waiting for you</h4>${waiting.map(i => `<button class="atl-feed-item atl-feed-btn" data-reveal="${i.id}">${i.kind === 'proposal' ? '<b>Decide:</b> ' + esc(i.pr.question) : '<b>Check:</b> ' + esc(i.c.text)}<span>${esc(labelOf(i.anchor?.region || i.region))}</span></button>`).join('')}` : ''}
    ${changed.length ? `<h4>Changed since you looked</h4>${changed.map(k => `<div class="atl-feed-item"><button class="atl-link" data-go="${esc(k)}">${esc(labelOf(k))}</button> <button class="atl-link" data-ack="${esc(k)}">✓ Seen</button></div>`).join('')}` : ''}
    ${ups.length ? `<h4>Updates</h4>${ups.map(u => `<div class="atl-feed-item"><b>${esc(u.title)}</b>${u.body ? `<p>${esc(u.body)}</p>` : ''}<button class="atl-link" data-dismiss="${u.id}">Dismiss</button></div>`).join('')}` : ''}
    ${waiting.length || news ? '' : '<p class="atl-hint">Nothing new.</p>'}
    <button class="atl-link" data-notify>${notifyOn() ? '🔔 Desktop notifications on' : '🔕 Desktop notifications off'}</button>`;
  document.querySelectorAll('atelier-region.atl-changed').forEach(r => r.classList.remove('atl-changed'));
  changed.forEach(k => regionEl(k)?.classList.add('atl-changed'));
}

// ===== warnings =====================================================================
// The server keeps no Region registry, so a mistyped key in a Ready can only be caught here.
function warn(message) {
  let stack = $('.atl-warnings');
  if (!message) { stack?.remove(); return; }
  if (!stack) { stack = document.createElement('div'); stack.className = 'atl-warnings'; stack.setAttribute('role', 'alert'); document.body.append(stack); }
  stack.textContent = message;
}

// ===== Ready: swap only the named Regions into the open page ========================
// The margin, header and drawer sit outside every Region, so drafts, open cards and focus survive;
// the browser's scroll anchoring keeps the reading place.
async function onReady(named) {
  if (!named?.length) return;
  let doc;
  try { doc = new DOMParser().parseFromString(await (await fetch(location.pathname, { cache: 'no-store' })).text(), 'text/html'); }
  catch { return; }
  const path = el => { const ks = []; for (let e = el; e; e = e.parentElement?.closest('atelier-region')) ks.unshift(e.getAttribute('key')); return ks.join('/'); };
  const incoming = new Map([...doc.querySelectorAll('atelier-region')].map(el => [path(el), el]));
  // ponytail: a Region new to the page reloads rather than being inserted; insert it if Readys add Regions often
  if (named.some(k => incoming.has(k) && !regionEl(k))) {
    saveDrafts(); try { sessionStorage.setItem('atelier:active', active || ''); } catch {}
    return location.reload();
  }
  for (const key of named) { const cur = regionEl(key), next = incoming.get(key); if (cur && next) cur.replaceWith(document.importNode(next, true)); }
  const unknown = named.filter(k => !incoming.has(k));
  warn(unknown.length ? `Ready named ${unknown.length} Region(s) this page does not contain: ${unknown.join(', ')}` : '');
  document.dispatchEvent(new CustomEvent('atelier:ready', { detail: { changed: named, unknown } }));
}

// ===== state + live loop ============================================================
export async function refresh() { S = await fetch('/api/state', { cache: 'no-store' }).then(r => r.json()); render(); }
async function loop() {
  for (;;) {
    try {
      const r = await fetch('/api/poll?cursor=' + S.seq).then(x => x.json());
      document.documentElement.removeAttribute('data-atl-offline');
      if (!r.events?.length) continue;
      for (const ev of r.events) {
        if (ev.kind === 'ready') { await onReady(ev.changed); notify('Page updated', (ev.changed || []).map(labelOf).join(', ')); }
        if (ev.kind === 'reply') notify('Agent replied', labelOf(ev.region));
        if (ev.kind === 'proposal') notify('Decision needed', labelOf(ev.region));
        if (ev.kind === 'update') notify(ev.title || 'Update', labelOf(ev.region));
      }
      await refresh();
    } catch {
      document.documentElement.setAttribute('data-atl-offline', '');
      await new Promise(res => setTimeout(res, 3000));
      // A long-poll answers only when something happens; probe with a cheap read so a recovered
      // server does not look dead for 25 seconds. The cursor stays, so nothing missed is lost.
      try { await refresh(); document.documentElement.removeAttribute('data-atl-offline'); } catch {}
    }
  }
}
async function boot() {
  document.body.append(float);
  try { active = sessionStorage.getItem('atelier:active') || null; sessionStorage.removeItem('atelier:active'); } catch {}
  try { await refresh(); } catch { document.documentElement.setAttribute('data-atl-offline', ''); }
  loop();
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

// For preflight: every stored Thread or Proposal whose anchor no longer finds its target.
export function unresolvedAnchors() {
  return items().filter(i => i.kind !== 'new' && (!i.res || i.res.detached))
    .map(i => ({ id: i.id, region: i.anchor?.region || i.region, reason: i.res ? 'target changed' : 'Region missing' }));
}
