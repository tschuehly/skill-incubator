// Static Surface lint — reads the HTML source the server would serve, with no browser.
//
// It replaces preflight's browser render pass (owner decision, 2026-10-06; ADR 0007). It checks only
// what the source and the store can prove: Region keys (atl-key), hosts and Activity, building
// blocks, page-describing prose, the verdict rules, Proposals, which host each open item lands in,
// and stored Anchors. It does NOT run the page, so it cannot see browser errors, kernel warnings,
// horizontal overflow, layout, whether a renderer really drew, or whether reveal() reaches an item.
import { metaFindings, REPAIR } from './prose.mjs';

// ---- a small HTML tree builder: enough of the parsing rules for Surfaces, not a full parser ----
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const CLOSES_P = new Set('address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul'.split(' '));
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', middot: '·', rarr: '→', larr: '←', times: '×' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITY[e.toLowerCase()] ?? m);
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseHTML(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, line: 1 };
  const lineAt = i => html.slice(0, i).split('\n').length;
  const TAG = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let cur = root, at = 0, m;
  const text = s => { if (s) cur.children.push({ tag: '#text', text: decode(s), parent: cur }); };
  const open = tag => { for (let e = cur; e; e = e.parent) if (e.tag === tag) return e; return null; };
  const closeTo = el => { cur = el.parent; };
  while ((m = TAG.exec(html))) {
    text(html.slice(at, m.index)); at = TAG.lastIndex;
    if (m[1]) { const el = open(m[1].toLowerCase()); if (el) closeTo(el); continue; }
    if (!m[2]) continue;                                           // comment or doctype
    const tag = m[2].toLowerCase(), attrs = {};
    for (const a of m[3].matchAll(ATTR)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    if (CLOSES_P.has(tag) && cur.tag === 'p') closeTo(cur);
    if (tag === 'li') { const li = open('li'); if (li && !['ul', 'ol'].some(t => { for (let e = cur; e !== li; e = e.parent) if (e.tag === t) return true; return false; })) closeTo(li); }
    if ((tag === 'td' || tag === 'th') && (cur.tag === 'td' || cur.tag === 'th')) closeTo(cur);
    if (tag === 'tr') { if (cur.tag === 'td' || cur.tag === 'th') closeTo(cur); if (cur.tag === 'tr') closeTo(cur); }
    const el = { tag, attrs, children: [], parent: cur, line: lineAt(m.index) };
    cur.children.push(el);
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, at);
      const body = html.slice(at, end === -1 ? html.length : end);
      el.children.push({ tag: '#text', text: tag === 'script' || tag === 'style' ? body : decode(body), parent: el });
      at = end === -1 ? html.length : html.indexOf('>', end) + 1;
      TAG.lastIndex = at;
    } else if (!VOID.has(tag)) cur = el;
  }
  text(html.slice(at));
  return root;
}

// A <template>'s payload is inert: it is not on the page until a script stamps it, so no gate counts it.
const elements = (node, out = []) => { for (const c of node.children || []) if (c.tag !== '#text') { out.push(c); if (c.tag !== 'template') elements(c, out); } return out; };
const closest = (el, pred) => { for (let e = el.parent; e; e = e.parent) if (e.tag !== '#root' && pred(e)) return e; return null; };
const isRegion = e => e.attrs && 'atl-key' in e.attrs;
const norm = s => s.replace(/\s+/g, ' ').trim();
export const regionKey = el => { const keys = []; for (let e = el; e; e = closest(e, isRegion)) keys.unshift(e.attrs['atl-key']?.trim() || 'unnamed'); return keys.join('/'); };
// A block's source, dedented as atelier-blocks.mjs dedents it, so indentation means what it means there.
const sourceOf = el => {
  const s = el.children.find(c => c.tag === 'script' && (c.attrs.type || '') === 'text/plain');
  if (!s) return null;
  const ls = (s.children[0]?.text || '').replace(/^\s*\n|\s+$/g, '').split('\n');
  const indent = Math.min(...ls.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
  return ls.map(l => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
};

// ---- building blocks: each one's own source must parse ----------------------------------
const MERMAID_TYPES = /^(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|classDiagram|erDiagram|gantt|journey|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|C4\w+|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|architecture(-beta)?|kanban|radar(-beta)?|treemap(-beta)?)\b/;
// The text bodies of the newer blocks, read as the blocks read them (atelier-blocks.mjs parses
// them in the browser; the rules are repeated here because that module needs a DOM).
const lines = src => (src || '').split('\n').filter(l => l.trim());
const FINDING = /^\s*(liked|disliked|fact|gap)\s*:\s*(.+)$/i;
const FINDING_LABEL = { liked: ['Liked', 'Gefällt'], disliked: ['Disliked', 'Stört'], fact: ['Fact', 'Fakt'], gap: ['Gap', 'Lücke'] };
const linkText = t => t.replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, '$1');
function decisionOf(src) {
  const d = { question: '', options: [], bad: null };
  for (const l of lines(src)) {
    const t = l.trim(), top = !/^\s/.test(l);
    if (top && t.startsWith('?')) d.question = t.slice(1).trim();
    else if (top && /^[*-]\s/.test(t)) d.options.push({ label: t.slice(2).trim(), rec: t[0] === '*', context: [] });
    else if (!top && d.options.length) d.options.at(-1).context.push(t.replace(/^[+\-−]\s+/, ''));
    else d.bad ||= t;
  }
  return d;
}
const flowLines = src => lines(src).map(l => ({ indent: l.match(/^\s*/)[0].length, t: l.trim() }));
const timelineLines = src => lines(src).map(l => ({ top: !/^\s/.test(l), t: l.trim() }));
// The words each new block puts on the page, in reading order, for the prose and anchor gates.
const BODY_TEXT = {
  'atelier-findings': (src, de) => lines(src).map(l => { const m = FINDING.exec(l); return m ? `${FINDING_LABEL[m[1].toLowerCase()][de ? 1 : 0]} ${linkText(m[2])}` : l; }),
  'atelier-decision': (src, de) => { const d = decisionOf(src); return [d.question, ...d.options.flatMap(o => [o.label + (o.rec ? (de ? ' Empfohlen' : ' Recommended') : ''), ...o.context])].map(linkText); },
  'atelier-flow': src => flowLines(src).map(({ t }) => t.replace(/^\|\|\s*/, '').replace(/^([^:]+?)\s*:\s*/, '$1. ')).map(linkText),
  'atelier-timeline': src => timelineLines(src).filter(({ t }) => !/^!\[/.test(t)).map(({ t }) => linkText(t.replace(/^>\s*([^:]+):\s*/, '$1 '))),
};
const BLOCKS = {
  'atelier-mermaid': (el, src) => {
    const lines = (src || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'));
    if (!lines.length) return 'has no <script type="text/plain"> source';
    // Only the header is checked: Mermaid's shapes (a>text], multi-line class bodies) defeat any
    // bracket count short of Mermaid's own parser, which a static lint does not run.
    if (!MERMAID_TYPES.test(lines[0])) return `starts with "${lines[0].slice(0, 30)}", not a Mermaid diagram type`;
    if (!el.attrs.alt) return 'needs alt="…": the text a reader without the renderer gets';
  },
  'atelier-chart': (el, src) => {
    if (!src) return 'has no <script type="text/plain"> Vega-Lite JSON';
    let spec; try { spec = JSON.parse(src); } catch (e) { return `spec is not JSON (${e.message})`; }
    if (!['mark', 'layer', 'concat', 'hconcat', 'vconcat', 'facet', 'repeat', 'spec'].some(k => k in spec)) return 'spec has no mark, layer, concat, facet or repeat';
    if (!el.attrs.alt) return 'needs alt="…": the text a reader without the renderer gets';
  },
  'atelier-file': (el, src) => { if (!el.attrs.src && !('diff' in el.attrs && el.attrs.diff) && !src?.trim()) return 'needs src=, diff=, or inline source'; },
  'atelier-video': (el, src) => {
    if (!el.attrs.src) return 'needs src=';
    const bad = (src || '').split('\n').filter(l => l.trim()).find(l => !/^\s*(?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?\s+\S/.test(l));
    if (bad) return `a mark is "m:ss what happens", got "${bad.trim().slice(0, 60)}"`;
  },
  'atelier-compare': el => {
    const kids = el.children.filter(c => c.tag !== '#text' && c.tag !== 'script');
    if (!(el.attrs.before && el.attrs.after) && kids.length < 2) return 'needs before= and after=, or two child elements';
  },
  'atelier-mock': el => { if (!el.children.some(c => c.tag === 'template')) return 'needs a <template> holding the mockup'; },
  'atelier-claims': () => {},
  'atelier-findings': (el, src) => {
    if (!lines(src).length) return 'has no findings';
    const bad = lines(src).find(l => !FINDING.test(l));
    if (bad) return `a finding is "liked|disliked|fact|gap: text", got "${bad.trim().slice(0, 60)}"`;
  },
  'atelier-decision': (el, src) => {
    const d = decisionOf(src);
    if (d.bad) return `"${d.bad.slice(0, 40)}" is neither "? question", "* option", "- option", nor an indented context line under an option`;
    if (!d.question) return 'needs a "? question" line';
    if (d.options.length < 2) return 'needs at least two options; one option is a statement, not a decision';
    if (d.options.filter(o => o.rec).length > 1) return 'recommends more than one option ("*")';
  },
  'atelier-flow': (el, src) => {
    const ls = flowLines(src);
    if (!ls.length) return 'has no nodes';
    const orphan = ls.find((l, i) => l.t.startsWith('||') && !ls.slice(0, i).some(p => p.indent === l.indent));
    if (orphan) return `"${orphan.t.slice(0, 40)}" runs in parallel with nothing: "||" needs a sibling before it`;
  },
  'atelier-timeline': (el, src) => {
    const ls = timelineLines(src);
    if (!ls.length) return 'has no steps';
    if (!ls[0].top) return `"${ls[0].t.slice(0, 40)}" is indented before any step`;
  },
  'atelier-tabs': el => {
    const panels = el.children.filter(isRegion);
    if (panels.length < 2) return 'needs at least two child atl-key Regions as tabs';
    const stray = el.children.filter(c => c.tag !== '#text' && !isRegion(c));
    if (stray.length) return `holds <${stray[0].tag}> outside a tab; every child is an atl-key Region`;
  },
};
const KERNEL = new Set(['atelier-host', 'atelier-activity']);

// ---- prose: the agent's own sentences, one block element at a time -----------------------
const INLINE = new Set('a abbr b bdi bdo br button cite data dfn em i img input label mark s select small span strong sub sup time u var wbr'.split(' '));
const VERBATIM = new Set('pre code kbd samp blockquote q svg script style template textarea head'.split(' '));
const NO_PROSE = new Set(['atelier-host', 'atelier-activity', 'atelier-file', 'atelier-mermaid', 'atelier-chart', 'atelier-mock', 'atelier-video']);
const skipProse = el => VERBATIM.has(el.tag) || NO_PROSE.has(el.tag) || 'hidden' in el.attrs || 'data-verbatim' in el.attrs
  || 'data-subject-ui' in el.attrs || /(^|\s)(atl-|file-view|d2h-wrapper|cm-editor)/.test(el.attrs.class || '');
const inline = el => INLINE.has(el.tag);
function proseBlocks(body, de = false) {
  const own = el => el.children.map(c => c.tag === '#text' ? c.text : !skipProse(c) && inline(c) ? own(c) : ' ').join('');
  const blocks = [];
  for (const el of elements(body)) {
    if (inline(el) || skipProse(el) || closest(el, skipProse)) continue;
    const region = isRegion(el) ? regionKey(el) : closest(el, isRegion) ? regionKey(closest(el, isRegion)) : '(outside Regions)';
    const text = own(el);
    if (text.trim()) blocks.push({ region, text });
  }
  // A block's caption and text alternative are the agent's prose too.
  for (const el of elements(body)) if (el.tag.startsWith('atelier-') && !KERNEL.has(el.tag)) for (const a of ['caption', 'alt'])
    if (el.attrs[a]) blocks.push({ region: closest(el, isRegion) ? regionKey(closest(el, isRegion)) : '(outside Regions)', text: el.attrs[a] });
  // So are the text bodies of findings, decisions, flows and timelines, line by line.
  for (const el of elements(body)) if (BODY_TEXT[el.tag]) for (const text of BODY_TEXT[el.tag](sourceOf(el), de))
    blocks.push({ region: closest(el, isRegion) ? regionKey(closest(el, isRegion)) : '(outside Regions)', text: /[.!?:]$/.test(text) ? text : text + '.' });
  return blocks;
}

// ---- the lint ---------------------------------------------------------------------------
// state: GET /api/state (optional). readFile(path) -> text|null resolves an <atelier-file src>
// so a stored quote inside a viewed file can be found.
export async function lintSurface(html, { state = null, readFile = async () => null } = {}) {
  const failures = [], passes = [], unmeasured = [], warnings = [];
  const fail = (gate, message) => failures.push({ gate, message });
  const warning = (gate, message) => warnings.push({ gate, message });
  const pass = (gate, message) => passes.push({ gate, message });
  const doc = parseHTML(html), all = elements(doc);
  const body = all.find(e => e.tag === 'body') || doc;
  const lang = (all.find(e => e.tag === 'html')?.attrs.lang || '').trim(), de = /^de\b/i.test(lang);

  // Kit: the kernel, and the blocks module wherever a block is used.
  // A classic <script> cannot load an ES module, and a <link> without rel=stylesheet applies no CSS.
  const loads = src => all.some(e => src.endsWith('.mjs')
    ? e.tag === 'script' && e.attrs.src === src && e.attrs.type?.trim().toLowerCase() === 'module'
    : e.tag === 'link' && e.attrs.href === src && /(^|\s)stylesheet(\s|$)/i.test(e.attrs.rel || ''));
  const used = [...new Set(all.map(e => e.tag).filter(t => t.startsWith('atelier-') && !KERNEL.has(t)))];
  const kit = [];
  if (!loads('/atelier.mjs')) kit.push('<script type="module" src="/atelier.mjs"> is missing');
  if (!loads('/atelier.css')) kit.push('<link rel="stylesheet" href="/atelier.css"> is missing');
  if (used.length && !loads('/atelier-blocks.mjs')) kit.push(`${used.join(', ')} used without <script type="module" src="/atelier-blocks.mjs">`);
  if (used.length && !loads('/atelier-blocks.css')) kit.push(`${used.join(', ')} used without <link rel="stylesheet" href="/atelier-blocks.css">`);
  if (kit.length) fail('KIT_TAGS', kit.join('; '));
  else pass('KIT_TAGS', `kernel${used.length ? ' and blocks module' : ''} loaded`);

  // Regions: every key present and every full key unique.
  const regions = all.filter(isRegion), keys = regions.map(regionKey);
  const unnamed = regions.filter(r => !r.attrs['atl-key']?.trim()).map(r => `line ${r.line}`);
  const slashed = regions.filter(r => r.attrs['atl-key']?.includes('/')).map(r => `line ${r.line} atl-key="${r.attrs['atl-key']}"`);
  const duplicates = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (!regions.length) fail('REGIONS', 'no element carries atl-key; the human would have nothing to comment on');
  if (unnamed.length) fail('REGIONS', `Region(s) with an empty atl-key collide under "unnamed": ${unnamed.join(', ')}`);
  if (slashed.length) fail('REGIONS', `an atl-key is one local key; nesting builds the path, so a "/" in it breaks addressing: ${slashed.join(', ')}`);
  if (duplicates.length) fail('REGIONS', `duplicate Region keys silently merge their Threads: ${duplicates.join(', ')}`);
  if (regions.length && !unnamed.length && !slashed.length && !duplicates.length) pass('REGIONS', `${regions.length} Region(s), keys present and unique`);

  // Hosts and Activity (ADR 0006): exactly one Activity anywhere; at least one host; at most one
  // catch-all; one host per `for`; every `for` names a Region on the page (a typo claims nothing).
  const hosts = all.filter(e => e.tag === 'atelier-host'), forOf = h => (h.attrs.for || '').trim();
  const activities = all.filter(e => e.tag === 'atelier-activity'), catchAlls = hosts.filter(h => !forOf(h));
  const fors = hosts.map(forOf).filter(Boolean), keySet = new Set(keys);
  const hostErrors = [];
  if (activities.length !== 1) hostErrors.push(`found ${activities.length} <atelier-activity>, need exactly one`);
  if (!hosts.length) hostErrors.push('no <atelier-host>; no Thread or Proposal could be shown');
  if (catchAlls.length > 1) hostErrors.push(`found ${catchAlls.length} catch-all <atelier-host> (no for), need at most one`);
  const dupFor = [...new Set(fors.filter((f, i) => fors.indexOf(f) !== i))];
  if (dupFor.length) hostErrors.push(`each address needs exactly one host, but for="${dupFor.join('", "')}" has several`);
  const strayFor = [...new Set(fors.filter(f => !keySet.has(f)))];
  if (strayFor.length) hostErrors.push(`<atelier-host for="${strayFor.join('", "')}"> names no Region on this page`);
  if (hostErrors.length) fail('HOSTS', hostErrors.join('; '));
  else pass('HOSTS', `one Activity, ${hosts.length} host(s)${catchAlls.length ? ', one catch-all' : ''}`);

  // Blocks: unknown atelier-* tags are typos; every known block's source must parse.
  const blockErrors = [];
  for (const el of all.filter(e => e.tag.startsWith('atelier-') && !KERNEL.has(e.tag))) {
    const where = `line ${el.line} <${el.tag}>`;
    if (!BLOCKS[el.tag]) { blockErrors.push(`${where}: unknown element; blocks are ${Object.keys(BLOCKS).join(', ')}`); continue; }
    const err = BLOCKS[el.tag](el, sourceOf(el));
    if (err) blockErrors.push(`${where}: ${err}`);
  }
  // A claim tree: each claim opens with its sentence. No count or depth limit: a limit makes the
  // author cut content (2026-10-06 trial: length limits deleted information instead of folding it).
  for (const tree of all.filter(e => e.tag === 'atelier-claims')) {
    const kids = el => elements(el).filter(r => isRegion(r) && closest(r, e => isRegion(e) || e.tag === 'atelier-claims') === el);
    const walk = el => {
      const children = kids(el);
      for (const c of children) {
        const first = c.children.find(n => n.tag !== '#text' || n.text.trim());
        if (first?.tag !== 'p') blockErrors.push(`line ${c.line} claim ${regionKey(c)}: its first child must be a <p> holding the claim`);
        walk(c);
      }
    };
    if (!kids(tree).length) blockErrors.push(`line ${tree.line} <atelier-claims>: holds no atl-key claims`);
    walk(tree);
  }
  const blockCount = all.filter(e => BLOCKS[e.tag]).length;
  if (blockErrors.length) fail('BLOCKS', blockErrors.join('\n  '));
  else pass('BLOCKS', `${blockCount} building block(s) parse`);

  // Prose that describes the page instead of its subject. Updates are the agent's prose too.
  const updates = Object.values(state?.updates || {}).filter(u => !u.dismissedAt)
    .map(u => ({ region: `${u.region} Update`, text: `${u.title || ''}. ${u.body || ''}` }));
  const prose = proseBlocks(body, de), meta = metaFindings(prose.concat(updates));
  // A warning, not a failure (ADR 0006): the patterns are heuristics, and the author rewrites or keeps each.
  if (meta.length) warning('PROSE', `${meta.length} sentence(s) describe the page instead of its subject:\n`
    + meta.map(f => `  - "${f.sentence}" (Region ${f.region}; ${f.rule})`).join('\n') + `\n  Repair: ${REPAIR}`);
  else pass('PROSE', `${prose.length} prose block(s), no sentence matches a known page-describing pattern`);

  // Decision context belongs inside each option (2026-10-06, variant D: the options' table sat in a
  // separate element below the question, so the human compared answers without their reasons).
  // A warning: a table after a decision is often legitimate material of its own.
  const after = [];
  for (const d of all.filter(e => e.tag === 'atelier-decision')) {
    const sibs = d.parent.children.filter(c => c.tag !== '#text' && c.tag !== 'script'), next = sibs[sibs.indexOf(d) + 1];
    if (next && ['table', 'dl', 'details', 'ul', 'ol'].includes(next.tag)) after.push(`line ${next.line} <${next.tag}> right after the decision at line ${d.line}`);
  }
  if (after.length) warning('DECISION_CONTEXT', `${after.join('; ')}: an option's reasons go in its own indented lines inside <atelier-decision>, not in an element below it`);
  else pass('DECISION_CONTEXT', `${all.filter(e => e.tag === 'atelier-decision').length} decision(s), none followed by a separate context element`);

  // Kernel labels follow <html lang> (2026-10-06: German pages carried English chrome and read
  // translated). The page's own words say which language it is in.
  const words = prose.map(p => p.text).join(' ').toLowerCase().match(/\p{L}+/gu) || [];
  const count = set => words.filter(w => set.has(w)).length;
  const deHits = count(DE_WORDS), enHits = count(EN_WORDS);
  const reads = deHits >= 8 && deHits > 2 * enHits ? 'de' : enHits >= 8 && enHits > 2 * deHits ? 'en' : null;
  if (reads && reads !== (de ? 'de' : 'en'))
    fail('LANG', `the page reads ${reads === 'de' ? 'German' : 'English'} (${deHits} German, ${enHits} English function words) but <html lang="${lang}"> gives the kernel ${de ? 'German' : 'English'} labels; set lang="${reads}"`);
  else pass('LANG', reads ? `the page reads ${reads === 'de' ? 'German' : 'English'}, and lang="${lang || '(none: English)'}" matches` : 'too little prose to tell the language');

  // Videos: more than one visible at once is a comparison, and only a marked one is (2026-10-06,
  // variant D: two videos side by side that nobody compared). Sibling <atelier-video>s share one
  // group that shows one at a time, so a group counts once.
  const crowded = [];
  for (const r of [doc, ...regions]) {
    const vids = elements(r).filter(e => (e.tag === 'video' || e.tag === 'atelier-video') && (closest(e, isRegion) || doc) === r
      && !closest(e, a => a.tag === 'atelier-compare' || 'compare' in a.attrs) && !('compare' in e.attrs));
    const seen = new Set(vids.map(v => v.tag === 'atelier-video' && v.parent.children.filter(c => c.tag === 'atelier-video').length > 1 ? v.parent : v));
    if (seen.size > 1) crowded.push(`${seen.size} in ${r === doc ? '(outside Regions)' : regionKey(r)}`);
  }
  if (crowded.length) fail('VIDEO', `videos visible at once without a comparison: ${crowded.join(', ')}; make them sibling <atelier-video>s (one at a time) or mark a real comparison with compare`);
  else pass('VIDEO', 'no Region shows several videos at once unless marked compare');


  if (!state) return { failures, passes, unmeasured, warnings };

  // Proposals: every one names a suggested option among its options.
  const unsuggested = Object.values(state.proposals || {}).filter(p => {
    const s = p.suggested ?? 0;
    return !Array.isArray(p.options) || !p.options.length || !Number.isInteger(s) || s < 0 || s >= p.options.length;
  });
  if (unsuggested.length) fail('PROPOSALS', `Proposal(s) without a suggested option among their options: ${unsuggested.map(p => `${p.id} in ${p.region}`).join(', ')}; ask again with "suggested"`);
  else pass('PROPOSALS', `${Object.keys(state.proposals || {}).length} Proposal(s), each with a suggested option`);

  // Reach: every item waiting for the human lands in a host, by the kernel's routing — the longest
  // whole-path `for`, else the catch-all; an item whose Region left goes to the catch-all. Whether
  // reveal() can bring that host on screen needs a browser and is not checked.
  const route = region => { if (!keySet.has(region)) return catchAlls[0] || null;
    for (let k = region; k; k = k.slice(0, Math.max(0, k.lastIndexOf('/')))) if (fors.includes(k)) return k; return catchAlls[0] || null; };
  const waiting = [
    ...Object.values(state.proposals || {}).filter(p => p.status !== 'decided').map(p => ({ id: p.id, region: p.region })),
    ...Object.entries(state.threads || {}).flatMap(([region, list]) => (list || []).filter(c => state.sent?.[c.id]).map(c => ({ id: c.id, region }))),
  ];
  const unhosted = waiting.filter(it => !route(it.region));
  if (unhosted.length) fail('REACH', `no host shows ${unhosted.map(it => `${it.id} in ${it.region}`).join(', ')}; add <atelier-host for="…"> where its conversation helps, or a catch-all <atelier-host>`);
  else pass('REACH', `${waiting.length} stored Thread(s)/Proposal(s) each land in a host (reveal() not checked without a browser)`);

  // Anchors: every stored Thread and Proposal finds its Region, and its quote is still in the text
  // the human sees — blocks projected as they render. Text no static reader can project (a drawn
  // diagram, a chart, a diff, an unreadable file) makes a missing quote UNMEASURED, not gone.
  const byKey = new Map(regions.map(r => [regionKey(r), r]));
  const files = new Map();
  const regionText = async r => { const unknown = []; return { text: norm(await project(r, unknown)), unknown }; };
  const project = async (el, unknown) => {
    if (el.tag === '#text') return el.text;
    // A text/plain source outside a known block is drawn by the Surface's own viewer, as written.
    if (el.tag === 'script') return (el.attrs.type || '') === 'text/plain' && !BLOCKS[el.parent?.tag] ? el.children[0]?.text || '' : ' ';
    if (el.tag === 'style' || el.tag === 'template') return ' ';
    let own = '';
    if (BODY_TEXT[el.tag]) return BODY_TEXT[el.tag](sourceOf(el), de).join(' ') + ' ' + (el.attrs.caption || '') + ' '
      + (await Promise.all(el.children.filter(c => c.tag !== 'script').map(c => project(c, unknown)))).join('');
    if (BLOCKS[el.tag] && el.tag !== 'atelier-claims' && el.tag !== 'atelier-tabs') {
      const src = sourceOf(el), path = el.attrs.src || el.attrs.diff;
      own = [el.attrs.alt, el.attrs.caption].filter(Boolean).join(' ') + ' ';
      if (el.tag === 'atelier-file') {
        let text = src;
        if (path) { if (!files.has(path)) files.set(path, await readFile(path)); text = files.get(path); }
        const lang = el.attrs.lang || (path || '').split('.').pop();
        if (text == null) unknown.push(`could not read ${path}`);
        else if ('diff' in el.attrs || lang === 'diff' || lang === 'patch') { unknown.push(`a diff in ${path || 'inline source'} is drawn by diff2html`); own += text; }
        else if (lang === 'md' || lang === 'markdown') { const t = mdText(text); if (t == null) { unknown.push(`Markdown in ${path || 'inline source'} uses HTML, tables, escapes or diagrams`); own += text; } else own += t; }
        else own += text;
      } else if (el.tag === 'atelier-mermaid' || el.tag === 'atelier-chart') { unknown.push(`<${el.tag}> text is drawn by its renderer`); own += src || ''; }
      else if (el.tag === 'atelier-video') own += src || '';
      else if (el.tag === 'atelier-compare') own += `${el.attrs['before-label'] || 'Before'} ${el.attrs['after-label'] || 'After'} `;
    }
    const kids = [];
    for (const c of el.children || []) kids.push(await project(c, unknown));
    return own + kids.join('');
  };
  const anchored = [
    ...Object.entries(state.threads || {}).flatMap(([region, list]) => (list || []).filter(c => state.sent?.[c.id]).map(c => ({ id: c.id, region, anchor: c.anchor }))),
    ...Object.values(state.proposals || {}).map(p => ({ id: p.id, region: p.region,
      anchor: p.anchor || Object.values(state.threads || {}).flat().find(c => c.id === p.threadId)?.anchor })),
  ];
  const lost = [], unsure = [];
  for (const it of anchored) {
    const key = it.anchor?.region || it.region, r = byKey.get(key);
    if (!r) { lost.push(`${it.id} in ${key} (Region missing)`); continue; }
    if (!it.anchor?.quote) continue;
    const { text, unknown } = await regionText(r), quote = `quote "${it.anchor.quote.slice(0, 40)}"`;
    if (text.includes(norm(it.anchor.quote))) continue;
    if (unknown.length) unsure.push(`${it.id} in ${key} (${quote} not in the projected text; ${[...new Set(unknown)].join('; ')})`);
    else lost.push(`${it.id} in ${key} (${quote} is gone)`);
  }
  if (lost.length) fail('ANCHORS', `${lost.length} stored Thread/Proposal anchor(s) no longer find their target: ${lost.join(', ')}; restore the text or tell the human in that Thread`);
  else pass('ANCHORS', `${anchored.length - unsure.length} stored anchor(s) find their Region and quote (element selectors are not checked)`);
  if (unsure.length) unmeasured.push({ gate: 'ANCHORS', message: `${unsure.length} anchor(s) could not be checked without a browser: ${unsure.join(', ')}` });
  return { failures, passes, unmeasured, warnings };
}

const DE_WORDS = new Set('der die das und ist nicht mit für auf ein eine einen dem den des zu von wir ich du sie es auch noch nur aber oder wenn weil dass wird werden sind hat haben im ins zum zur bei nach über schon'.split(' '));
const EN_WORDS = new Set('the and is not with for on a to of we you it this that are were be has have at by from but or if because only also which'.split(' '));

// Markdown as markdown-it renders it to text, or null when that cannot be told without rendering.
export function mdText(md) {
  if (/<[a-z!\/]|&#?\w+;|\\[^\w\s]|^\s*\||^\s*(```|~~~)\s*mermaid/im.test(md)) return null;
  return md.replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(`+)([^`]*?)\1/g, '$2')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|\W)_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2');
}

export const NOT_CHECKED = 'NOT CHECKED (no browser): browser errors, kernel warnings, horizontal overflow, layout, whether reveal() reaches each item, '
  + 'whether a renderer really drew, and element-selector anchors.';
