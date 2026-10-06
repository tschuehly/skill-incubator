// Static Surface lint — reads the HTML source the server would serve, with no browser.
//
// Structural only (owner decisions 2026-10-06, ADR 0007 and ADR 0008): the kit loads, Region keys
// (atl-key), hosts and Activity, Proposals, which host each open item lands in, and stored Anchors.
// It judges no content. It does NOT run the page, so it cannot see browser errors, kernel warnings,
// horizontal overflow, layout, or whether reveal() reaches an item.

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
const KERNEL = new Set(['atelier-host', 'atelier-activity']);

// ---- the lint ---------------------------------------------------------------------------
// state: GET /api/state (optional), for the Proposal, reach and anchor gates.
export async function lintSurface(html, { state = null } = {}) {
  const failures = [], passes = [], unmeasured = [], warnings = [];
  const fail = (gate, message) => failures.push({ gate, message });
  const pass = (gate, message) => passes.push({ gate, message });
  const doc = parseHTML(html), all = elements(doc);

  // Kit: the kernel loads. A classic <script> cannot load an ES module, and a <link> without
  // rel=stylesheet applies no CSS. An atelier-* element the kernel does not define is a typo.
  const loads = src => all.some(e => src.endsWith('.mjs')
    ? e.tag === 'script' && e.attrs.src === src && e.attrs.type?.trim().toLowerCase() === 'module'
    : e.tag === 'link' && e.attrs.href === src && /(^|\s)stylesheet(\s|$)/i.test(e.attrs.rel || ''));
  const kit = [];
  if (!loads('/atelier.mjs')) kit.push('<script type="module" src="/atelier.mjs"> is missing');
  if (!loads('/atelier.css')) kit.push('<link rel="stylesheet" href="/atelier.css"> is missing');
  const unknownTags = [...new Set(all.filter(e => e.tag.startsWith('atelier-') && !KERNEL.has(e.tag)).map(e => `<${e.tag}> (line ${e.line})`))];
  if (unknownTags.length) kit.push(`${unknownTags.join(', ')}: not a kernel element; the kernel defines only <atelier-host> and <atelier-activity>`);
  if (kit.length) fail('KIT_TAGS', kit.join('; '));
  else pass('KIT_TAGS', 'kernel loaded');

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

  // Anchors: every stored Thread and Proposal finds its Region, and its quote is still in the
  // Region's source text. Text a script draws at runtime cannot be read here, so a missing quote in
  // a Region that runs or embeds a renderer is UNMEASURED, not gone.
  const byKey = new Map(regions.map(r => [regionKey(r), r]));
  const project = (el, unknown) => {
    if (el.tag === '#text') return el.text;
    if (el.tag === 'script') return (el.attrs.type || '') === 'text/plain' ? el.children[0]?.text || '' : (unknown.push('a script draws part of it'), ' ');
    if (['style', 'template'].includes(el.tag)) return ' ';
    if (['canvas', 'iframe', 'object', 'embed'].includes(el.tag) || el.tag.includes('-') && !KERNEL.has(el.tag)) unknown.push(`<${el.tag}> draws its own content`);
    return (el.children || []).map(c => project(c, unknown)).join('');
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
    const unknown = [], text = norm(project(r, unknown)), quote = `quote "${it.anchor.quote.slice(0, 40)}"`;
    if (text.includes(norm(it.anchor.quote))) continue;
    if (unknown.length) unsure.push(`${it.id} in ${key} (${quote} not in the source text; ${[...new Set(unknown)].join('; ')})`);
    else lost.push(`${it.id} in ${key} (${quote} is gone)`);
  }
  if (lost.length) fail('ANCHORS', `${lost.length} stored Thread/Proposal anchor(s) no longer find their target: ${lost.join(', ')}; restore the text or tell the human in that Thread`);
  else pass('ANCHORS', `${anchored.length - unsure.length} stored anchor(s) find their Region and quote (element selectors are not checked)`);
  if (unsure.length) unmeasured.push({ gate: 'ANCHORS', message: `${unsure.length} anchor(s) could not be checked without a browser: ${unsure.join(', ')}` });
  return { failures, passes, unmeasured, warnings };
}

export const NOT_CHECKED = 'NOT CHECKED (no browser): browser errors, kernel warnings, horizontal overflow, layout, whether reveal() reaches each item, '
  + 'text a script draws, and element-selector anchors.';
