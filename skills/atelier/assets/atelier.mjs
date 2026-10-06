// atelier kernel — the browser half. Vendored from the atelier skill: copy it, never patch it.
//
// Atelier extends HTML the way htmx does. The Surface is whatever HTML the task needs; the kernel
// adds what a page cannot have on its own: addresses, a durable conversation per address, and the
// event loop to the agent. It never inserts into authored content and imposes no layout.
//   atl-key="local" [atl-label]       a Region on any element; nested keys form "a/b"
//   atl-thread="a/b" on a button       opens a whole-Region Thread draft (empty: the closest Region)
//   <atelier-host for="a">             Threads and Proposals for "a" and below; the longest `for` wins
//   <atelier-host>                     catch-all: unclaimed items, Regions gone, failed reveals
//   <atelier-host layout="anchored">   cards level with their anchors while the host sits beside them
//   <atelier-host collapsible>         folds away (Activity's ⇥ icon) and reserves no width
//   <atelier-activity>                 Pick-to-comment, the "N waiting" drawer, notifications
// On author elements the kernel sets attributes only: atl-changed, atl-anchor, atl-active, atl-hover,
// atl-pick. Exports: getState, reveal, setRevealResolver, refresh, unresolvedAnchors.
// Events: atelier:state, atelier:ready and atelier:reveal (out), atelier:rendered (in).
// Chrome labels follow <html lang> (German or English); actions are icons whose label is the
// tooltip and the accessible name. A Proposal whose options reach the screen is reported opened.
// ponytail: iframe picking is not built; a Surface that embeds a cooperating app posts its own
// anchors (see references/protocol.md#extending).

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A non-2xx answer is a failure: the caller keeps the human's text and says what went wrong.
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `${url} answered ${r.status}`);
  return j;
}
const ok = r => { if (!r.ok) throw new Error(`the server answered ${r.status}`); return r; };
const load = () => fetch('/api/state', { cache: 'no-store' }).then(ok).then(r => r.json());
let S = { threads: {}, sent: {}, replies: {}, commentState: {}, proposals: {}, updates: {}, changed: {}, seq: 0 };
let booted = false, snapshot = null;
let active = null;                       // id of the expanded Thread or Proposal
const pending = new Map();               // unsent new Threads: id -> { id, region, anchor, text, attachments }
const kept = new Map();                  // '<card>|<field>' -> half-typed text, cleared only after a 2xx
const atts = new Map();                  // '<card>|new' or '<card>|reply' -> pasted image URLs not yet sent
const opened = new Set();                // '<card>|<field>' of <details> the human opened in a card
const errs = new Map();                  // card id -> why its last action failed
const strays = new Set();                // ids whose reveal failed; shown in the catch-all host
const DRAFTS = 'atelier:drafts', KEPT = 'atelier:kept', ATTS = 'atelier:atts';
const saveKept = () => { try { sessionStorage.setItem(KEPT, JSON.stringify([...kept].filter(([, v]) => v)));
  sessionStorage.setItem(ATTS, JSON.stringify([...atts].filter(([, v]) => v.length))); } catch {} };
try { for (const [k, v] of JSON.parse(sessionStorage.getItem(KEPT) || '[]')) kept.set(k, v);
  for (const [k, v] of JSON.parse(sessionStorage.getItem(ATTS) || '[]')) atts.set(k, v); } catch {}

// ===== chrome labels follow <html lang>: German, or English for anything else ==========
// Written for each language, not translated word by word. Warnings about authoring defects (a
// missing or doubled host) stay English: they are for the author, and the lint reports them too.
const EN = {
  thread: 'Thread', close: 'Close (Esc)', pasted: 'Pasted image', unattach: 'Remove image',
  state: { open: 'Sent', acknowledged: 'Seen by agent', in_progress: 'Agent working', implemented: 'Done — check it', accepted: 'Accepted', rejected: 'Reopened' },
  gone: 'Its section is no longer on this page.', changed: 'The part this pointed at has changed.',
  notSentErr: e => `Not sent: ${e}. Your text is kept.`, decided: 'Decided', chosen: 'Chosen:', undo: 'Undo',
  recommended: 'Recommended', requested: 'Explanation requested', why: 'Why this option? Ask for an explanation', unclear: 'What is unclear?',
  ask: 'Ask', other: 'Something else — answer in your own words', yourAnswer: 'Your answer…', sendAnswer: 'Send answer', sends: '(⌘+Enter sends)',
  unsent: 'Unsent Thread', notSent: 'Not sent', failed: 'failed', draft: '✎ draft', compose: 'Start a Thread…  (⌘+Enter sends; paste images)',
  send: 'Send', discard: 'Discard', replies: n => `${n} ${n > 1 ? 'replies' : 'reply'}`, you: 'You', agent: 'Agent', reply: 'Reply',
  replyHint: 'Reply…  (⌘+Enter sends)', replyDone: 'Reply, or say what is still wrong…  (⌘+Enter sends)',
  accept: 'Accept — it is done', reopen: 'Reopen — say above what is still wrong', sayWrong: 'Say what is still wrong, then Reopen',
  notAttached: e => `Image not attached: ${e}`, couldNot: (what, where, why) => `Could not show ${what}${where ? ' in ' + where : ''}: ${why}.`,
  question: 'the question', theThread: 'the Thread', section: 'the section',
  pick: 'Comment on… (or hold Alt and click)', picking: 'Click anything… (Esc)', waiting: n => `${n} waiting for you`, activity: 'Activity',
  fresh: n => `${n} new`, waitingHead: 'Waiting for you', decideLine: 'Decide:', check: 'Check:', chosenHead: 'Just chosen',
  changedHead: 'Changed since you looked', seen: '✓ Seen', updates: 'Updates', goTo: l => `Go to ${l}`, dismiss: 'Dismiss', nothing: 'Nothing new.',
  notifyOn: '🔔 Desktop notifications on', notifyOff: '🔕 Desktop notifications off',
  unknownRegions: (n, keys) => `Ready named ${n} Region(s) this page does not contain: ${keys}`,
  pageUpdated: 'Page updated', agentReplied: 'Agent replied', needed: 'Decision needed', update: 'Update',
  hide: 'Hide Threads', show: n => `Show Threads${n ? ` (${n})` : ''}`,
};
const DE = {
  thread: 'Thread', close: 'Schließen (Esc)', pasted: 'Eingefügtes Bild', unattach: 'Bild entfernen',
  state: { open: 'Gesendet', acknowledged: 'Agent hat es gelesen', in_progress: 'Agent ist dran', implemented: 'Erledigt – bitte prüfen', accepted: 'Angenommen', rejected: 'Wieder offen' },
  gone: 'Diesen Abschnitt gibt es auf der Seite nicht mehr.', changed: 'Die markierte Stelle hat sich geändert.',
  notSentErr: e => `Nicht gesendet: ${e}. Dein Text bleibt erhalten.`, decided: 'Entschieden', chosen: 'Gewählt:', undo: 'Rückgängig',
  recommended: 'Empfohlen', requested: 'Erklärung angefordert', why: 'Warum diese Option? Erklärung anfordern', unclear: 'Was ist dir unklar?',
  ask: 'Fragen', other: 'Etwas anderes – in eigenen Worten antworten', yourAnswer: 'Deine Antwort …', sendAnswer: 'Antwort senden', sends: '(⌘+Enter sendet)',
  unsent: 'Noch nicht gesendet', notSent: 'Entwurf', failed: 'fehlgeschlagen', draft: '✎ Entwurf', compose: 'Was fällt dir auf? (⌘+Enter sendet, Bilder einfach einfügen)',
  send: 'Senden', discard: 'Verwerfen', replies: n => `${n} ${n > 1 ? 'Antworten' : 'Antwort'}`, you: 'Du', agent: 'Agent', reply: 'Antworten',
  replyHint: 'Antworten …  (⌘+Enter sendet)', replyDone: 'Antworten oder sagen, was noch nicht passt …  (⌘+Enter sendet)',
  accept: 'Annehmen – passt so', reopen: 'Wieder öffnen – schreib oben, was fehlt', sayWrong: 'Schreib, was noch nicht passt, dann wieder öffnen',
  notAttached: e => `Bild nicht angehängt: ${e}`, couldNot: (what, where, why) => `${what}${where ? ' in ' + where : ''} lässt sich nicht zeigen: ${why}.`,
  question: 'Die Frage', theThread: 'Der Thread', section: 'Der Abschnitt',
  pick: 'Etwas kommentieren (oder Alt gedrückt halten und klicken)', picking: 'Klick auf die Stelle … (Esc)', waiting: n => `${n} warten auf dich`, activity: 'Aktivität',
  fresh: n => `${n} neu`, waitingHead: 'Wartet auf dich', decideLine: 'Offen:', check: 'Prüfen:', chosenHead: 'Gerade gewählt',
  changedHead: 'Seit deinem letzten Blick geändert', seen: '✓ Gesehen', updates: 'Neuigkeiten', goTo: l => `Zu ${l}`, dismiss: 'Ausblenden', nothing: 'Nichts Neues.',
  notifyOn: '🔔 Desktop-Hinweise an', notifyOff: '🔕 Desktop-Hinweise aus',
  unknownRegions: (n, keys) => `Ready nennt ${n} Region(en), die es auf dieser Seite nicht gibt: ${keys}`,
  pageUpdated: 'Seite aktualisiert', agentReplied: 'Neue Antwort vom Agent', needed: 'Deine Entscheidung', update: 'Neuigkeit',
  hide: 'Threads ausblenden', show: n => `Threads einblenden${n ? ` (${n})` : ''}`,
};
const T = /^de\b/i.test(document.documentElement.lang) ? DE : EN;
// An action is a compact icon; its label is the tooltip and the accessible name.
const icon = (glyph, label, attrs = '', cls = '') => `<button type="button" class="atl-icon ${cls}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">${glyph}</button>`;

// ===== Regions: atl-key on any element =============================================
const regionKey = el => { const ks = []; for (let e = el; e; e = e.parentElement?.closest('[atl-key]')) ks.unshift(e.getAttribute('atl-key')); return ks.join('/'); };
const regionEls = () => [...document.querySelectorAll('[atl-key]')];
const regionEl = key => regionEls().find(r => regionKey(r) === key);
const labelOf = key => { const el = regionEl(key);
  return el?.getAttribute('atl-label') || el?.querySelector('h1,h2,h3,h4')?.textContent.trim() || key; };

// ===== anchors ======================================================================
// { region, quote?, prefix?, selector?, point?:{x,y} }. Only `region` means the whole Region.
// Text is found again by quote + prefix, so it survives a Ready that re-renders the Region.
const CHROME = 'atelier-host,atelier-activity,.atl-float,.atl-warnings';
function textIndex(root) {
  const nodes = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement.closest(`${CHROME},script,style,textarea`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
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
function resolve(anchor, fallbackRegion, map) {
  const root = map.get(anchor?.region || fallbackRegion);
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
const anchorEl = res => res?.range ? res.range.startContainer.parentElement : res?.el;
const marksElement = it => it.res?.el && !it.res.range && !it.res.detached && it.anchor && it.res.el !== it.res.root;

// ===== opening a Thread =============================================================
const regionFor = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('[atl-key]');
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
  return { region: regionKey(region), quote, prefix: offset > 0 ? idx.text.slice(Math.max(0, offset - 32), offset) : '' };
}
function anchorFromElement(el, event) {
  const region = el.closest('[atl-key]');
  if (!region) return null;
  const key = regionKey(region);
  if (el === region) return { region: key };
  // Inside a diagram, anchor the box that was clicked (Mermaid and Graphviz draw each as g.node, or
  // mark your own with data-anchor); anywhere else on an SVG or image, a relative point.
  const box = el.closest('svg g.node, svg [data-anchor]');
  if (box === region) return { region: key };            // the box is the Region itself
  if (box && region.contains(box)) return { region: key, selector: boxSelector(box, region) };
  // a Region may be a <g> inside the SVG; data-atl-point marks any other element that takes points
  const svg = el.closest('svg'), pt = el.closest('[data-atl-point]');
  const target = svg && region.contains(svg) ? svg : pt && region.contains(pt) ? pt : el;
  const a = { region: key, selector: selectorFor(target, region) };
  if (target.tagName === 'IMG' || target.tagName.toLowerCase() === 'svg' || target.hasAttribute('data-atl-point')) {
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
  if (!route({ region: anchor.region, res: {} }, hostIndex()))
    return warn(`No <atelier-host> shows Threads for ${labelOf(anchor.region)}.`, 'host');
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
float.className = 'atl-float'; float.type = 'button'; float.textContent = `💬 ${T.thread}`; float.hidden = true;
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
function setPicking(on) { picking = on; document.documentElement.toggleAttribute('atl-picking', on); renderActivity(); }
document.addEventListener('mouseover', e => {
  document.querySelectorAll('[atl-pick]').forEach(x => x.removeAttribute('atl-pick'));
  if ((picking || e.altKey) && !e.target.closest?.(CHROME)) e.target.closest?.('[atl-key] *, [atl-key]')?.setAttribute('atl-pick', '');
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
  const opener = e.target.closest?.('[atl-thread]');
  if (opener) {
    const key = opener.getAttribute('atl-thread').trim() || (opener.closest('[atl-key]') ? regionKey(opener.closest('[atl-key]')) : '');
    return key ? openNew({ region: key }) : warn('This button names no Region to start a Thread on.', 'host');
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

// ===== hosts: where Threads and Proposals appear =====================================
// The author places hosts; the kernel never creates one. An item goes to the host whose `for` is the
// longest whole-path prefix of its Region Key (c6 never claims c64), else to the one catch-all.
function hostIndex() {
  const byFor = new Map(), dup = []; let all = null;
  for (const h of document.querySelectorAll('atelier-host')) {
    const f = (h.getAttribute('for') || '').trim();
    if (!f) { if (all) dup.push('a second catch-all <atelier-host>'); else all = h; }
    else if (byFor.has(f)) dup.push(`a second <atelier-host for="${f}">`); else byFor.set(f, h);
  }
  return { byFor, all, dup };
}
function route(it, idx) {
  let own = null;
  for (let k = it.region || ''; k && !own; k = k.slice(0, Math.max(0, k.lastIndexOf('/')))) own = idx.byFor.get(k) || null;
  return strays.has(it.id) || !it.res ? idx.all || own : own || idx.all;
}
let queued = false;
const queueRender = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; render(); }); } };
// A host draws itself when it enters the page, so hosts a Ready swaps in need no setup.
customElements.define('atelier-host', class extends HTMLElement { connectedCallback() { queueRender(); } });

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
  const map = new Map(regionEls().map(r => [regionKey(r), r]));
  // A question still waiting for the human comes first in its host.
  const first = it => it.kind === 'proposal' && it.pr.status !== 'decided' ? 0 : 1;
  return out.map(it => ({ ...it, res: resolve(it.anchor, it.region, map) })).sort((a, b) => first(a) - first(b));
}

const STATE = T.state;
function where(it) {
  if (!it.res) return `<div class="atl-detached">${T.gone}</div>`;
  return it.res.detached ? `<div class="atl-detached">${T.changed}</div>` : '';
}
const CLOSE = `<button type="button" class="atl-close" data-close aria-label="${T.close}" title="${T.close}">×</button>`;
const errHTML = id => errs.has(id) ? `<div class="atl-error" role="alert">${esc(T.notSentErr(errs.get(id)))}</div>` : '';
const imgs = urls => urls?.length ? `<div class="atl-atts">${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${T.pasted}"></a>`).join('')}</div>` : '';
const pendingImgs = key => { const u = atts.get(key) || [];
  return u.length ? `<div class="atl-atts">${u.map((x, i) => `<span class="atl-att"><img src="${esc(x)}" alt="${T.pasted}"><button type="button" class="atl-att-x" data-unattach="${esc(key)}" data-i="${i}" aria-label="${T.unattach}" title="${T.unattach}">×</button></span>`).join('')}</div>` : ''; };
const clean = o => String(o).replace(/\s*\((recommended|empfohlen)\)\s*$/i, '');
const secs = until => `${Math.max(0, Math.ceil((until - Date.now()) / 1000))} s`;
// A folded request form: its summary is an icon, its body a text box and a send icon.
const ask = (key, glyph, label, field, placeholder, send) => `<details class="atl-ask" data-keep="${esc(key)}"><summary class="atl-icon" title="${esc(label)}" aria-label="${esc(label)}">${glyph}</summary>
  <textarea ${field} placeholder="${esc(placeholder)}  ${T.sends}"></textarea>${send}</details>`;
// An open question shows its options as buttons: one click chooses, and Undo stays beside the
// choice until the server's window closes. Only then does the agent hear of it. Each option holds
// its own context: the explanation request, its form, and the answer sit inside the option.
function proposalHTML(it) {
  const pr = it.pr, id = it.id, chosen = pr.custom || clean(pr.options?.[pr.choiceIndex] ?? '');
  if (pr.status === 'decided' && id !== active)
    return `<button type="button" class="atl-card atl-card--line atl-card--decided" data-open="${id}">✓ <b>${T.decided}</b> · ${esc(chosen.split(/[.:;(]/)[0])}</button>`;
  const head = `<div class="atl-card atl-card--decision${pr.status === 'pending' ? ' is-pending' : ''}" data-card="${id}">${pr.status === 'decided' ? CLOSE : ''}${where(it)}
    <p class="atl-q">${esc(pr.question)}</p>`;
  if (pr.status === 'decided') return `${head}<div class="atl-state">${T.decided}: ${esc(chosen)}</div></div>`;
  const undo = `<button type="button" class="atl-btn" data-undo="${id}">${T.undo} (<span data-until="${pr.undoUntil}">${secs(pr.undoUntil)}</span>)</button>`;
  if (pr.status === 'pending') return `${head}<div class="atl-pending" role="status">${T.chosen} <b>${esc(chosen)}</b> · ${undo}</div>${errHTML(id)}</div>`;
  const suggested = Number.isInteger(pr.suggested) ? pr.suggested : 0;
  const opt = (o, i) => {
    const req = pr.explanationRequests?.[i], ex = pr.explanations?.[i];
    return `<div class="atl-option"><button type="button" class="atl-btn atl-choice" data-choose="${id}" data-i="${i}">${esc(clean(o))}${i === suggested ? ` <span class="atl-rec">${T.recommended}</span>` : ''}</button>
      ${ex ? `<div class="atl-explain">${esc(ex.text)}</div>` : req ? `<div class="atl-explain atl-meta">${T.requested}</div>`
        : ask(`${id}|explain:${i}`, '?', T.why, `data-explain-text="${id}:${i}"`, T.unclear, icon('➤', T.ask, `data-explain="${id}" data-i="${i}"`, 'atl-icon--primary'))}</div>`;
  };
  return `${head}<div class="atl-options">${(pr.options || []).map(opt).join('')}</div>
    ${ask(`${id}|custom`, '✎', T.other, `data-custom="${id}"`, T.yourAnswer, icon('➤', T.sendAnswer, `data-answer="${id}"`, 'atl-icon--primary'))}${errHTML(id)}</div>`;
}
function cardHTML(it) {
  const open = it.id === active;
  if (it.kind === 'proposal') return proposalHTML(it);
  const c = it.c, st = S.commentState[c.id]?.value, replies = S.replies[c.id] || [];
  const quote = it.anchor?.quote ? `<blockquote>${esc(it.anchor.quote.slice(0, 140))}</blockquote>` : '';
  if (it.kind === 'new' && !open) return `<button type="button" class="atl-card atl-card--line" data-open="${it.id}">
      <span class="atl-first">✎ ${esc(kept.get(it.id + '|new') || c.text || T.unsent)}</span><span class="atl-meta">${T.notSent}${errs.has(it.id) ? ` · ${T.failed}` : ''}</span></button>`;
  if (it.kind === 'new') return `<div class="atl-card is-open" data-card="${it.id}">${CLOSE}${quote}${it.anchor?.quote ? '' : `<div class="atl-meta">${esc(labelOf(it.region))}</div>`}
      <textarea data-new placeholder="${T.compose}">${esc(c.text || '')}</textarea>${pendingImgs(it.id + '|new')}
      <div class="atl-row">${icon('➤', T.send, `data-send="${it.id}"`, 'atl-icon--primary')}${icon('🗑', T.discard, `data-discard="${it.id}"`)}</div>${errHTML(it.id)}</div>`;
  if (!open) return `<button type="button" class="atl-card atl-card--line ${st === 'implemented' ? 'is-yours' : ''}" data-open="${it.id}">
      <span class="atl-first">${esc(c.text)}</span><span class="atl-meta">${replies.length ? T.replies(replies.length) + ' · ' : ''}${STATE[st] || ''}${kept.get(it.id + '|reply') ? ` · ${T.draft}` : ''}</span></button>`;
  return `<div class="atl-card is-open" data-card="${it.id}">${CLOSE}${quote}${where(it)}
      <div class="atl-msg atl-msg--you">${esc(c.text)}${imgs(c.attachments)}</div>
      ${replies.map(r => `<div class="atl-msg ${r.author === 'human' ? 'atl-msg--you' : ''}"><span class="atl-who">${r.author === 'human' ? T.you : T.agent}</span>${esc(r.msg)}${imgs(r.attachments)}</div>`).join('')}
      <textarea data-reply-text="${it.id}" placeholder="${st === 'implemented' ? T.replyDone : T.replyHint}"></textarea>${pendingImgs(it.id + '|reply')}
      <div class="atl-row">${icon('➤', T.reply, `data-reply="${it.id}"`, st === 'implemented' ? '' : 'atl-icon--primary')}
      ${st === 'implemented' ? icon('✓', T.accept, `data-accept="${it.id}"`, 'atl-icon--primary') + icon('↺', T.reopen, `data-reject="${it.id}"`) : ''}<span class="atl-state">${STATE[st] || ''}</span></div>${errHTML(it.id)}</div>`;
}
const textareaKind = t => t.dataset.replyText ? 'reply' : t.dataset.custom ? 'custom' : t.dataset.explainText ? 'explain:' + t.dataset.explainText.split(':').pop() : 'new';
const fieldKey = t => t.closest('[data-card]')?.dataset.card + '|' + textareaKind(t);
const syncKept = () => { for (const t of document.querySelectorAll('atelier-host textarea')) kept.set(fieldKey(t), t.value); };
// A focused control in a card — a text box, or a button a reveal focused — keeps focus when the
// card is redrawn (a store change, an opened report coming back).
const CONTROLS = 'button, summary';
function captureFocus() {
  const t = document.activeElement;
  if (t?.matches?.('atelier-host textarea')) return { key: fieldKey(t), start: t.selectionStart, end: t.selectionEnd };
  const card = t?.matches?.(CONTROLS) && t.closest('atelier-host [data-card]');
  return card ? { card: card.dataset.card, i: [...card.querySelectorAll(CONTROLS)].indexOf(t) } : null;
}
function restoreFocus(f) {
  if (f?.card) return $(`atelier-host [data-card="${CSS.escape(f.card)}"]`)?.querySelectorAll(CONTROLS)[f.i]?.focus({ preventScroll: true });
  const t = f && [...document.querySelectorAll('atelier-host textarea')].find(x => fieldKey(x) === f.key);
  // preventScroll: an anchored card is placed after this, and focusing it unplaced scrolls the page
  if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(f.start, f.end); }
}

// Collapsible hosts (<atelier-host collapsible>) fold away together from Activity's ⇥ icon and
// reserve no width; their cards, drafts and focus stay in the DOM. Showing any of their cards
// unfolds them, so nothing waiting is ever out of reach behind a fold.
const FOLD = 'atelier:hosts';
let folded = false;
try { folded = localStorage.getItem(FOLD) === 'folded'; } catch {}
document.documentElement.toggleAttribute('atl-hosts-folded', folded);
function setFolded(on) {
  folded = on; document.documentElement.toggleAttribute('atl-hosts-folded', on);
  try { localStorage.setItem(FOLD, on ? 'folded' : ''); } catch {}
}

// A Proposal counts as opened when its options are on the human's screen — at least half its card
// visible (or half the viewport, for a tall card) in a shown host, with the tab in front — because
// only the card shows its options and recommendation. A report stays pending until the server
// answers 2xx, and every render retries what is pending, so an opening survives a failed request
// and is sent once the server is back.
const unreported = new Set(), sending = new Set(), reported = new Set();
const onScreen = e => e.isIntersecting && e.intersectionRect.height >= Math.min(e.boundingClientRect.height, innerHeight) / 2;
const watcher = typeof IntersectionObserver !== 'undefined' && new IntersectionObserver(es => {
  for (const e of es) if (onScreen(e) && !document.hidden && !reported.has(e.target.dataset.card)) unreported.add(e.target.dataset.card);
  reportOpened();
}, { threshold: [0, .25, .5, .75, 1] });
function reportOpened() {
  for (const id of unreported) {
    if (!S.proposals?.[id] || S.proposals[id].openedAt) { unreported.delete(id); continue; }
    if (sending.has(id)) continue;
    sending.add(id);
    fetch('/api/proposal-opened', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      .then(r => { if (r.ok) { unreported.delete(id); reported.add(id); } }, () => {})
      .finally(() => sending.delete(id));
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

const highlights = typeof Highlight !== 'undefined' && CSS.highlights;
function render(focus = captureFocus()) {
  syncKept();
  cache = items();
  const idx = hostIndex();
  for (const it of cache) it.host = route(it, idx);
  if (folded && active && cache.find(i => i.id === active)?.host?.hasAttribute('collapsible')) setFolded(false);
  warn(idx.dup.length ? `Each address needs exactly one host, but this page has ${idx.dup.join(' and ')}.` : '', 'hosts');
  document.querySelectorAll('[atl-anchor],[atl-active]').forEach(e => { e.removeAttribute('atl-anchor'); e.removeAttribute('atl-active'); });
  if (highlights) {
    CSS.highlights.set('atl-anchor', new Highlight(...cache.filter(i => i.res?.range && i.id !== active).map(i => i.res.range)));
    CSS.highlights.set('atl-active', new Highlight(...cache.filter(i => i.res?.range && i.id === active).map(i => i.res.range)));
  }
  for (const it of cache) if (marksElement(it)) it.res.el.setAttribute(it.id === active ? 'atl-active' : 'atl-anchor', '');
  for (const h of document.querySelectorAll('atelier-host'))
    h.innerHTML = cache.filter(it => it.host === h).map(it => `<div class="atl-slot" data-slot="${it.id}">${cardHTML(it)}</div>`).join('');
  for (const t of document.querySelectorAll('atelier-host textarea')) { const v = kept.get(fieldKey(t)); if (v) t.value = v; }
  for (const d of document.querySelectorAll('atelier-host details[data-keep]'))
    d.open = opened.has(d.dataset.keep) || !!d.querySelector('textarea')?.value;
  restoreFocus(focus);
  layout();
  renderActivity();
  if (watcher) { watcher.disconnect();
    for (const c of document.querySelectorAll('atelier-host .atl-card--decision[data-card]')) if (!S.proposals?.[c.dataset.card]?.openedAt) watcher.observe(c); }
  reportOpened();
  if (booted) {
    const list = cache.filter(i => i.kind === 'thread' || i.kind === 'proposal').map(i => i.kind === 'thread'
      ? { kind: 'thread', id: i.id, region: i.region, status: S.commentState[i.id]?.value || 'open', waiting: S.commentState[i.id]?.value === 'implemented' }
      : { kind: 'proposal', id: i.id, region: i.region, status: i.pr.status, waiting: i.pr.status === 'open' });
    for (const u of Object.values(S.updates || {})) list.push({ kind: 'update', id: u.id, region: u.region, status: u.dismissedAt ? 'dismissed' : 'open', waiting: false });
    snapshot = { state: S, items: list };
    document.dispatchEvent(new CustomEvent('atelier:state', { detail: snapshot }));
  }
}
// The store and every Thread, Proposal and Update with whether it waits for the human; null
// before the first state arrives. Read-only: change state through the protocol endpoints.
export const getState = () => snapshot;

// layout="anchored": each card sits level with its anchor, pushed down to avoid overlap, while the
// host sits beside its content. Fixed, or stacked under its content, the host is plain block flow.
function aligned(h) {
  if (getComputedStyle(h).position === 'fixed') return false;
  const f = (h.getAttribute('for') || '').trim(), col = (f && regionEl(f)) || cache.find(it => it.host === h && it.res)?.res.root;
  if (!col) return false;
  const r = h.getBoundingClientRect(), c = col.getBoundingClientRect();
  return r.left >= c.right - 1 || r.right <= c.left + 1;
}
function layout() {
  for (const h of document.querySelectorAll('atelier-host[layout="anchored"]')) {
    const on = aligned(h), slots = [...h.querySelectorAll(':scope > [data-slot]')];
    h.toggleAttribute('atl-aligned', on);
    if (!on) { slots.forEach(s => { s.style.top = ''; }); h.style.minHeight = ''; continue; }
    const base = h.getBoundingClientRect().top;
    const placed = slots.map(el => { const it = itemOf(el.dataset.slot); return { it, el, want: it?.res ? topOf(it.res) - base : null }; })
      .sort((a, b) => (a.want ?? Infinity) - (b.want ?? Infinity));
    // The active card is exact; any other card that would overlap it moves below it.
    const act = placed.find(s => s.it?.id === active && s.want != null);
    const A = act ? Math.max(0, act.want) : null, AEnd = act ? A + act.el.offsetHeight + 8 : null;
    if (act) act.el.style.top = A + 'px';
    let y = 0;
    for (const s of placed) {
      if (s === act) continue;
      if (s.want != null) y = Math.max(y, s.want);
      const height = s.el.offsetHeight + 8;
      if (act && y < AEnd && y + height > A) y = AEnd;
      s.el.style.top = y + 'px'; y += height;
    }
    h.style.minHeight = Math.max(y, AEnd ?? 0) + 'px';
  }
}
let raf = 0;
const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
addEventListener('resize', schedule);
document.addEventListener('scroll', e => { if (e.target !== document) schedule(); }, true);   // inner scrollers
new ResizeObserver(schedule).observe(document.documentElement);
// Diagram and file viewers draw after load and after every Ready; anchors inside them resolve once
// they say so — a diagram by setting data-diagram-ready, any renderer by dispatching atelier:rendered.
new MutationObserver(ms => { if (ms.some(m => m.target.dataset?.diagramReady === 'true')) render(); })
  .observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-diagram-ready'] });
document.addEventListener('atelier:rendered', () => render());
// A choice's undo countdown ticks in place; the server, not this timer, closes the window.
setInterval(() => { for (const el of document.querySelectorAll('[data-until]')) el.textContent = secs(+el.dataset.until); }, 250);

// ===== card and drawer actions ======================================================
const itemOf = id => cache.find(i => i.id === id);
const token = () => Math.random().toString(36).slice(2, 12);
const busy = new Set();
// Nothing the human wrote is cleared before the server answers 2xx; a failure stays on the card.
async function act(id, fn, lock = id) {
  if (busy.has(lock)) return;
  busy.add(lock);
  try { await fn(); errs.delete(id); } catch (e) { errs.set(id, e.message); }
  finally { busy.delete(lock); }
  await refresh().catch(() => render());
}
// After a 2xx a field is cleared only if it still holds what was sent, and only the sent images
// leave it: whatever the human added while the request ran stays. No `sent` discards everything.
const forget = (key, sent) => {
  const t = [...document.querySelectorAll('atelier-host textarea')].find(x => fieldKey(x) === key);
  if (!sent || (t?.value ?? kept.get(key) ?? '').trim() === sent.text) { if (t) t.value = ''; kept.delete(key); opened.delete(key); }
  const left = sent ? (atts.get(key) || []).filter(u => !sent.images?.includes(u)) : [];
  left.length ? atts.set(key, left) : atts.delete(key);
  saveKept();
};
const fieldText = (sel, key) => ($(sel)?.value ?? kept.get(key) ?? '').trim();
let saving = Promise.resolve();         // the chain of new-Thread saves
async function sendNew(id) {
  const p = pending.get(id), text = fieldText(`[data-card="${id}"] [data-new]`, id + '|new'), images = [...atts.get(id + '|new') || []];
  if (!p || (!text && !images.length)) return;
  const thread = { id, text, anchor: p.anchor, ...(images.length ? { attachments: images } : {}) };
  // One save at a time, each merged into the threads the server holds now: two Threads sent before
  // a refresh must not overwrite each other.
  const save = saving.then(async () => { const { threads = {} } = await load();
    await post('/api/state', { threads: { ...threads, [p.region]: [...(threads[p.region] || []).filter(c => c.id !== id), thread] } }); });
  saving = save.catch(() => {});
  await save;
  await post('/api/send', { region: p.region, id });
  const now = fieldText(`[data-card="${id}"] [data-new]`, id + '|new'), later = (atts.get(id + '|new') || []).filter(u => !images.includes(u));
  pending.delete(id); forget(id + '|new'); saveDrafts();
  // Typed or pasted while it was sending: a reply draft.
  if (now !== text) kept.set(id + '|reply', now);
  if (later.length) atts.set(id + '|reply', [...atts.get(id + '|reply') || [], ...later]);
  saveKept();
}
// Undo never queues behind the click it takes back, whose request may still be in flight.
async function undo(id) {
  const pr = S.proposals[id];
  if (pr?.attempt) await act(id, () => post('/api/undo-decision', { id, attempt: pr.attempt }), id + '|undo');
}
document.addEventListener('click', async e => {
  const b = e.target.closest?.('atelier-host button, atelier-activity button, .atl-warnings button'); if (!b) return;
  const d = b.dataset, drawer = $('#atl-drawer');
  if ('open' in d) {
    active = d.open || null;
    const it = active && itemOf(active); unfold(anchorEl(it?.res));
    render();
    const r = active && $(`[data-card="${active}"]`)?.getBoundingClientRect();
    if (r && r.bottom > innerHeight - 12) scrollBy({ top: Math.min(r.bottom - innerHeight + 24, r.top - 80), behavior: 'smooth' });
    return;
  }
  if ('close' in d) { active = null; return render(); }
  if ('unwarn' in d) return warn();
  if (d.unattach) { atts.get(d.unattach)?.splice(+d.i, 1); saveKept(); if (d.unattach.endsWith('|new')) saveDrafts(); return render(); }
  if (d.send) return act(d.send, () => sendNew(d.send));
  if (d.discard) { pending.delete(d.discard); forget(d.discard + '|new'); saveDrafts(); active = null; return render(); }
  if (d.reply) { const msg = fieldText(`[data-reply-text="${d.reply}"]`, d.reply + '|reply'), images = [...atts.get(d.reply + '|reply') || []];
    if (!msg && !images.length) return;
    return act(d.reply, async () => { await post('/api/thread-message', { region: itemOf(d.reply).region, id: d.reply, msg, attachments: images }); forget(d.reply + '|reply', { text: msg, images }); }); }
  if (d.accept) return act(d.accept, () => post('/api/comment-state', { region: itemOf(d.accept).region, id: d.accept, state: 'accepted' }));
  if (d.reject) { const ta = $(`[data-reply-text="${d.reject}"]`), msg = ta.value.trim();
    if (!msg) { ta.placeholder = T.sayWrong; return ta.focus({ preventScroll: true }); }
    return act(d.reject, async () => { await post('/api/comment-reject', { region: itemOf(d.reject).region, id: d.reject, msg }); forget(d.reject + '|reply', { text: msg }); }); }
  // A choice and its Undo countdown never sit under the open drawer.
  if ((d.choose || d.answer) && drawer?.matches(':popover-open')) drawer.hidePopover();
  if (d.choose) { if (active === d.choose) active = null;
    return act(d.choose, () => post('/api/decide', { id: d.choose, choiceIndex: +d.i, attempt: token() })); }
  if (d.answer) { const custom = fieldText(`[data-custom="${d.answer}"]`, d.answer + '|custom');
    if (!custom) return $(`[data-custom="${d.answer}"]`)?.focus({ preventScroll: true });
    if (active === d.answer) active = null;
    return act(d.answer, async () => { await post('/api/decide', { id: d.answer, custom, attempt: token() }); forget(d.answer + '|custom', { text: custom }); }); }
  if (d.explain) { const key = `${d.explain}|explain:${d.i}`, answer = fieldText(`[data-explain-text="${d.explain}:${d.i}"]`, key); if (!answer) return;
    return act(d.explain, async () => { await post('/api/explain-request', { id: d.explain, optionIndex: +d.i, answer }); forget(key, { text: answer }); }); }
  if (d.undo) return undo(d.undo);
  if ('pick' in d) return setPicking(!picking);
  if ('fold' in d) { if (!folded && itemOf(active)?.host?.hasAttribute('collapsible')) active = null; setFolded(!folded); return render(); }
  if ('notify' in d) { localStorage.setItem(NOTIFY, notifyOn() ? 'off' : 'on');
    if (hasNotify && Notification.permission === 'default') await Notification.requestPermission(); return renderActivity(); }
  if (d.dismiss) return act(d.dismiss, () => post('/api/update-dismiss', { id: d.dismiss }));
  if (d.ack) return act(d.ack, () => post('/api/ack', { region: d.ack }));
  if (d.go) { drawer?.hidePopover(); return reveal({ region: d.go }); }
  if (d.reveal) { drawer?.hidePopover(); return reveal(d.reveal); }
});
document.addEventListener('toggle', e => {
  const k = e.target.dataset?.keep; if (k) e.target.open ? opened.add(k) : opened.delete(k);
}, true);
document.addEventListener('mouseover', e => {
  const card = e.target.closest?.('atelier-host [data-slot]');
  document.querySelectorAll('[atl-hover]').forEach(x => x.removeAttribute('atl-hover'));
  if (highlights) CSS.highlights.delete('atl-hover');
  const it = card && itemOf(card.dataset.slot);
  if (it?.res?.range && highlights) CSS.highlights.set('atl-hover', new Highlight(it.res.range));
  else if (it && marksElement(it)) it.res.el.setAttribute('atl-hover', '');
});
document.addEventListener('keydown', e => {
  const ta = e.target.closest?.('atelier-host textarea'); if (!ta || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
  e.preventDefault();
  (ta.closest('details') || ta.closest('[data-card]')).querySelector('[data-send],[data-reply],[data-answer],[data-explain]')?.click();
});
document.addEventListener('input', e => {
  const t = e.target.closest?.('atelier-host textarea'); if (!t) return;
  kept.set(fieldKey(t), t.value); saveKept();
  if (t.matches('[data-new]')) saveDrafts();
});

// Pasting or dropping an image into a new Thread or a reply uploads it and attaches it there. Each
// finished upload joins the field's images as they are now, never a copy taken before the await,
// and leaves the text alone: the human may have typed, re-rendered or sent since. A new Thread
// sent meanwhile takes the image into its reply draft.
const IMAGE = /^image\/(png|jpeg|gif|webp)$/;
async function attachFiles(ta, files) {
  const key = fieldKey(ta), card = key.split('|')[0];
  for (const f of files) {
    const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
    let url;
    try { url = (await post('/api/attach', { name: f.name || 'pasted', type: f.type, data })).url; }
    catch (e) { warn(T.notAttached(e.message), 'attach'); continue; }
    const to = key.endsWith('|new') && !pending.has(card) ? card + '|reply' : key;
    atts.set(to, [...atts.get(to) || [], url]); saveKept();
    if (to.endsWith('|new')) saveDrafts();
    render();
  }
}
const imageTarget = e => { const ta = e.target.closest?.('atelier-host [data-new], atelier-host [data-reply-text]');
  const files = [...(e.clipboardData || e.dataTransfer)?.files || []].filter(f => IMAGE.test(f.type));
  return ta && files.length ? [ta, files] : null; };
document.addEventListener('paste', e => { const hit = imageTarget(e); if (hit) { e.preventDefault(); attachFiles(...hit); } });
document.addEventListener('dragover', e => { if (e.target.closest?.('atelier-host textarea')) e.preventDefault(); });
document.addEventListener('drop', e => { const hit = imageTarget(e); if (hit) { e.preventDefault(); attachFiles(...hit); } });

// ===== notifications: on by default, asked for on the first gesture ==================
const NOTIFY = 'atelier:notify';
const hasNotify = typeof Notification !== 'undefined';
const notifyOn = () => { try { return localStorage.getItem(NOTIFY) !== 'off' && hasNotify && Notification.permission === 'granted'; } catch { return false; } };
document.addEventListener('pointerdown', () => {
  if (hasNotify && Notification.permission === 'default' && localStorage.getItem(NOTIFY) !== 'off') Notification.requestPermission().then(renderActivity);
}, { once: true });
const notify = (title, body) => { if (notifyOn() && document.hidden) new Notification(title, { body }); };

// ===== reveal: make an item reachable, then show and focus its card ===================
// The page owns selection, tabs and filters; one resolver lets it show the target first.
let resolver = null;
export function setRevealResolver(fn) { resolver = typeof fn === 'function' ? fn : null; }
// Content that hides its parts another way (a tab, a zoomed map) listens for atelier:reveal, whose
// detail.target is the element about to be shown, and shows it before the kernel scrolls there.
const unfold = el => {
  if (!el) return;
  document.dispatchEvent(new CustomEvent('atelier:reveal', { detail: { target: el } }));
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
};
const visible = el => !!el?.getClientRects().length;
function showCard(id) {
  const card = $(`[data-card="${id}"]`) || $(`[data-slot="${id}"]`);
  unfold(card);
  if (!visible(card)) return false;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const control = card.querySelector('button:not(.atl-close), textarea');
  if (control) control.focus({ preventScroll: true }); else { card.tabIndex = -1; card.focus({ preventScroll: true }); }
  return true;
}
// reveal(id) or reveal({ region, id?, kind? }) -> Promise<boolean>. On failure the page says so and
// the item moves to the catch-all host, so it is never out of reach.
export async function reveal(target) {
  const id = typeof target === 'string' ? target : target?.id, it = id && itemOf(id);
  const t = { ...(typeof target === 'object' ? target : {}), id, region: target?.region || it?.region, kind: target?.kind || it?.kind };
  const fail = why => {
    const what = it ? (it.kind === 'proposal' ? T.question : T.theThread) : T.section;
    warn(T.couldNot(what, t.region && labelOf(t.region), why), 'reveal');
    if (it) { strays.add(id); active = id; render(); showCard(id); }
    return false;
  };
  if (!t.region) return fail('it is not on this page');
  try {
    if (resolver) await Promise.race([resolver(t), new Promise((_, no) => setTimeout(() => no(new Error('the page did not show it within 2 s')), 2000))]);
  } catch (e) { return fail(e.message || String(e)); }
  if (it) {
    strays.delete(id); active = id; render();
    unfold(anchorEl(itemOf(id)?.res));
    if (!showCard(id)) return fail('its host is hidden');
  } else {
    const el = regionEl(t.region);
    unfold(el);
    if (!visible(el)) return fail('it is hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  warn('', 'reveal');
  return true;
}

// ===== <atelier-activity>: Pick, the drawer, notifications ===========================
customElements.define('atelier-activity', class extends HTMLElement {
  connectedCallback() {
    if (this._built) return; this._built = true;
    this.innerHTML = `<div class="atl-tools"></div><div class="atl-drawer" id="atl-drawer" popover></div>`;
    renderActivity();
  }
});
function renderActivity() {
  const el = $('atelier-activity'); if (!el?._built) return;
  const ups = Object.values(S.updates || {}).filter(u => !u.dismissedAt);
  const changed = Object.keys(S.changed || {}).filter(k => regionEl(k));
  const waiting = cache.filter(i => i.kind === 'proposal' && i.pr.status === 'open' || i.kind === 'thread' && S.commentState[i.id]?.value === 'implemented');
  const chosen = cache.filter(i => i.kind === 'proposal' && i.pr.status === 'pending');
  const news = ups.length + changed.length;
  const foldable = cache.filter(i => i.host?.hasAttribute('collapsible')).length;
  el.querySelector('.atl-tools').innerHTML = `
    ${picking ? `<button type="button" class="atl-btn atl-btn--primary" data-pick>${T.picking}</button>` : icon('💬', T.pick, 'data-pick')}
    <button type="button" class="atl-btn ${waiting.length ? 'atl-btn--warn' : ''}" popovertarget="atl-drawer">${waiting.length ? T.waiting(waiting.length) : T.activity}${news ? ` · ${T.fresh(news)}` : ''}</button>
    ${$('atelier-host[collapsible]') ? icon(folded ? `⇤<small>${foldable || ''}</small>` : '⇥', folded ? T.show(foldable) : T.hide, `data-fold aria-pressed="${!folded}"`) : ''}`;
  el.querySelector('.atl-drawer').innerHTML = `
    <div class="atl-drawer-head"><b>${T.activity}</b>${icon('×', T.close, 'popovertarget="atl-drawer" popovertargetaction="hide"')}</div>
    ${waiting.length ? `<h4>${T.waitingHead}</h4>${waiting.map(i => `<button type="button" class="atl-feed-item atl-feed-btn" data-reveal="${i.id}">${i.kind === 'proposal' ? `<b>${T.decideLine}</b> ` + esc(i.pr.question) : `<b>${T.check}</b> ` + esc(i.c.text)}<span>${esc(labelOf(i.region))}</span></button>`).join('')}` : ''}
    ${chosen.length ? `<h4>${T.chosenHead}</h4>${chosen.map(i => `<div class="atl-feed-item"><button type="button" class="atl-link" data-reveal="${i.id}">${esc(i.pr.question)}</button><p>${T.chosen} ${esc(i.pr.custom || clean(i.pr.options[i.pr.choiceIndex]))}</p><button type="button" class="atl-btn" data-undo="${i.id}">${T.undo} (<span data-until="${i.pr.undoUntil}">${secs(i.pr.undoUntil)}</span>)</button></div>`).join('')}` : ''}
    ${changed.length ? `<h4>${T.changedHead}</h4>${changed.map(k => `<div class="atl-feed-item"><button type="button" class="atl-link" data-go="${esc(k)}">${esc(labelOf(k))}</button> <button type="button" class="atl-link" data-ack="${esc(k)}">${T.seen}</button></div>`).join('')}` : ''}
    ${ups.length ? `<h4>${T.updates}</h4>${ups.map(u => `<div class="atl-feed-item"><b>${esc(u.title)}</b>${u.body ? `<p>${esc(u.body)}</p>` : ''}<button type="button" class="atl-link" data-go="${esc(u.region)}">${esc(T.goTo(labelOf(u.region)))}</button> <button type="button" class="atl-link" data-dismiss="${u.id}">${T.dismiss}</button></div>`).join('')}` : ''}
    ${waiting.length || chosen.length || news ? '' : `<p class="atl-hint">${T.nothing}</p>`}
    <button type="button" class="atl-link" data-notify>${notifyOn() ? T.notifyOn : T.notifyOff}</button>`;
  document.querySelectorAll('[atl-changed]').forEach(r => r.removeAttribute('atl-changed'));
  changed.forEach(k => regionEl(k)?.setAttribute('atl-changed', ''));
}

// ===== warnings =====================================================================
// The server keeps no Region registry, so a mistyped key in a Ready can only be caught here.
const warnings = new Map();
function warn(message, key) {
  if (key === undefined) warnings.clear(); else if (message) warnings.set(key, message); else warnings.delete(key);
  let stack = $('.atl-warnings');
  if (!warnings.size) { stack?.remove(); return; }
  if (!stack) { stack = document.createElement('div'); stack.className = 'atl-warnings'; stack.setAttribute('role', 'alert'); document.body.append(stack); }
  stack.innerHTML = `<button type="button" class="atl-close" data-unwarn aria-label="Close">×</button>${[...warnings.values()].map(m => `<div>${esc(m)}</div>`).join('')}`;
}

// ===== Ready: swap only the named Regions into the open page ========================
// Hosts inside a swapped Region draw themselves again; drafts, focus and caret come back from the
// kernel's own record, and the browser's scroll anchoring keeps the reading place.
async function onReady(named) {
  if (!named?.length) return;
  // A failed fetch throws, so the loop keeps its cursor and applies this Ready on its next try.
  const doc = new DOMParser().parseFromString(await (await fetch(location.pathname, { cache: 'no-store' }).then(ok)).text(), 'text/html');
  const incoming = new Map([...doc.querySelectorAll('[atl-key]')].map(el => [regionKey(el), el]));
  syncKept(); saveKept();
  // ponytail: a Region new to the page reloads rather than being inserted; insert it if Readys add Regions often
  if (named.some(k => incoming.has(k) && !regionEl(k))) {
    saveDrafts(); try { sessionStorage.setItem('atelier:active', active || ''); } catch {}
    return location.reload();
  }
  const focus = captureFocus();
  for (const key of named) { const cur = regionEl(key), next = incoming.get(key); if (cur && next) cur.replaceWith(document.importNode(next, true)); }
  const unknown = named.filter(k => !incoming.has(k));
  warn(unknown.length ? T.unknownRegions(unknown.length, unknown.join(', ')) : '', 'ready');
  render(null);
  // The page re-applies its own view state (selected record, open tab) before focus returns.
  document.dispatchEvent(new CustomEvent('atelier:ready', { detail: { changed: named, unknown } }));
  restoreFocus(focus);
  layout();
}

// ===== state + live loop ============================================================
export async function refresh() { S = await load(); booted = true; render(); }
// The page's own cursor advances only past events it has handled; a refresh never moves it.
let cursor = null;
async function loop() {
  for (;;) {
    try {
      if (cursor === null) { await refresh(); cursor = S.seq; }
      const r = await fetch('/api/poll?cursor=' + cursor).then(ok).then(x => x.json());
      document.documentElement.removeAttribute('data-atl-offline');
      if (!r.events?.length) continue;
      for (const ev of r.events) {
        if (ev.kind === 'ready') { await onReady(ev.changed); notify(T.pageUpdated, (ev.changed || []).map(labelOf).join(', ')); }
        if (ev.kind === 'reply') notify(T.agentReplied, labelOf(ev.region));
        if (ev.kind === 'proposal') notify(T.needed, labelOf(ev.region));
        if (ev.kind === 'update') notify(ev.title || T.update, labelOf(ev.region));
        cursor = ev.seq;                                 // handled; a later failure retries from here
      }
      cursor = r.cursor;
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
  loop();
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();

// For preflight: every stored Thread or Proposal whose anchor no longer finds its target.
export function unresolvedAnchors() {
  return items().filter(i => i.kind !== 'new' && (!i.res || i.res.detached))
    .map(i => ({ id: i.id, region: i.anchor?.region || i.region, reason: i.res ? 'target changed' : 'Region missing' }));
}
