#!/usr/bin/env node
// The structural lint against one clean Surface and one bad fixture per defect class.
// Run: node scripts/lint.test.mjs
import { lintSurface, regionKey, parseHTML } from './lint.mjs';

const page = (main, { frame = true } = {}) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="/atelier.css"><script type="module" src="/atelier.mjs"></script></head>
<body>${frame ? '<header><b>T</b><atelier-activity></atelier-activity></header>' : ''}
<div class="page"><main>${main}</main>${frame ? '<atelier-host layout="anchored" collapsible></atelier-host>' : ''}</div></body></html>`;

const CLEAN = page(`<section atl-key="plan">
  <p>Writes go to both indexes for two weeks.</p>
  <section atl-key="a"><p>Every write lands in both indexes.</p></section>
  <section atl-key="b"><section atl-key="a"><p>Reads switch region by region.</p></section></section>
  <section atl-key="kernel"><section atl-key="why"><p>Kernel placement failed twice.</p>
    <details><summary>Detail</summary><p>P4 stacked cards above the content.</p></details></section></section>
  <section atl-key="flow"><div id="map"></div><script type="text/plain" id="src">api --> Old index</script>
    <script type="module">document.querySelector('#map').textContent = 'Feature flag drawn';</script></section>
  <ul><li>Unclosed item one<li>Unclosed item two</ul>
  <p>An unclosed paragraph
  <div>Dual write costs 18% p95 latency &amp; doubles indexing cost.</div>
</section>`);
const STATE = {
  name: 't', log: [], seq: 3, updates: {},
  threads: { 'plan/a': [{ id: 'c1', text: 'x', anchor: { region: 'plan/a', quote: 'lands in  both\nindexes' } }],
    'plan/b/a': [{ id: 'c2', text: 'y', anchor: { region: 'plan/b/a' } }],
    'plan/gone': [{ id: 'c3', text: 'unsent draft', anchor: { region: 'plan/gone' } }] },
  sent: { c1: 'ts', c2: 'ts' },
  proposals: {
    p1: { id: 'p1', region: 'plan/flow', options: ['A', 'B'], suggested: 1, anchor: { region: 'plan/flow', quote: 'Old index' } },    // text/plain source
    p3: { id: 'p3', region: 'plan/kernel/why', options: ['Keep', 'Drop'], suggested: 0, anchor: { region: 'plan/kernel/why', quote: 'stacked cards above' } }, // folded detail
    p4: { id: 'p4', region: 'plan', options: ['A'], anchor: { region: 'plan', quote: '18% p95 latency & doubles' } },                // entity decoded
  },
};

// Each bad fixture must fail exactly the named gate, with the named words in its message.
const BAD = [
  ['empty Region key', 'REGIONS', 'empty atl-key', page('<section atl-key="r"><section atl-key=""><p>x</p></section></section>')],
  ['duplicate nested key', 'REGIONS', 'duplicate Region keys silently merge their Threads: r/a', page('<section atl-key="r"><section atl-key="a"></section><section atl-key="a"></section></section>')],
  ['a slash inside one atl-key', 'REGIONS', 'atl-key="a/b"', page('<section atl-key="a/b"><p>x</p></section>')],
  ['no Region at all', 'REGIONS', 'no element carries atl-key', page('<p>Nothing addressable.</p>')],
  ['the only Region sits in an inert <template>', 'REGIONS', 'no element carries atl-key', page('<template><section atl-key="r"><p>x</p></section></template><p>Nothing addressable.</p>')],
  ['no host and no Activity', 'HOSTS', 'found 0 <atelier-activity>, need exactly one; no <atelier-host>', page('<section atl-key="r"><p>x</p></section>', { frame: false })],
  ['two catch-all hosts', 'HOSTS', 'found 2 catch-all', page('<section atl-key="r"><p>x</p><atelier-host></atelier-host></section>')],
  ['two hosts for one address', 'HOSTS', 'for="r" has several', page('<section atl-key="r"><p>x</p><atelier-host for="r"></atelier-host><atelier-host for="r"></atelier-host></section>')],
  ['a host for a Region that is not there', 'HOSTS', '<atelier-host for="c6"> names no Region', page('<section atl-key="c64"><p>x</p><atelier-host for="c6"></atelier-host></section>')],
  ['activity doubled', 'HOSTS', 'found 2 <atelier-activity>', page('<section atl-key="r"><p>x</p></section><atelier-activity></atelier-activity>')],
  ['kernel loaded as a classic script', 'KIT_TAGS', '<script type="module" src="/atelier.mjs"> is missing',
    page('<section atl-key="r"><p>x</p></section>').replace('<script type="module" src="/atelier.mjs">', '<script src="/atelier.mjs">')],
  ['kernel CSS linked without rel=stylesheet', 'KIT_TAGS', '<link rel="stylesheet" href="/atelier.css"> is missing',
    page('<section atl-key="r"><p>x</p></section>').replace('<link rel="stylesheet" href="/atelier.css">', '<link rel="preload" href="/atelier.css">')],
  ['an atelier element the kernel does not define', 'KIT_TAGS', '<atelier-hots> (line', page('<section atl-key="r"><p>x</p><atelier-hots for="r"></atelier-hots></section>')],
];
const BAD_STATE = [
  ['Proposal without a suggested option', 'PROPOSALS', 'p9 in plan/a', { ...STATE, proposals: { ...STATE.proposals, p9: { id: 'p9', region: 'plan/a', options: ['A', 'B'], suggested: 2 } } }],
  ['anchor quote no longer in the source', 'ANCHORS', 'quote "brown fox" is gone', { ...STATE, threads: { ...STATE.threads, 'plan/a': [{ id: 'c1', text: 'x', anchor: { region: 'plan/a', quote: 'brown fox' } }] } }],
  ['anchor Region removed', 'ANCHORS', 'c4 in plan/old (Region missing)', { ...STATE, threads: { ...STATE.threads, 'plan/old': [{ id: 'c4', text: 'z' }] }, sent: { ...STATE.sent, c4: 'ts' } }],
];

let failed = 0;
const gates = r => r.failures.map(f => f.gate);
{
  const r = await lintSurface(CLEAN, { state: STATE });
  if (r.failures.length) { failed++; console.log(`CLEAN FAILED  ${JSON.stringify(r.failures, null, 1)}`); }
  const want = ['KIT_TAGS', 'REGIONS', 'HOSTS', 'PROPOSALS', 'REACH', 'ANCHORS'];
  if (want.some(g => !r.passes.some(p => p.gate === g))) { failed++; console.log(`CLEAN MISSING A PASS  ${r.passes.map(p => p.gate)}`); }
  if (r.warnings.length) { failed++; console.log(`CLEAN WARNED  ${JSON.stringify(r.warnings)}`); }
}
// Content is never judged: a page full of page-describing prose, two videos and a German page under lang="en" is clean.
{
  const r = await lintSurface(page('<section atl-key="r"><p>Six decisions, most dangerous first. Die Karte zeigt nicht nur die Stufen, sondern auch die Prüfungen, und wir sehen, dass es noch zu lange dauert.</p><video src="/a.mp4"></video><video src="/b.mp4"></video></section>'));
  if (r.failures.length || r.warnings.length) { failed++; console.log(`CONTENT JUDGED  ${JSON.stringify(r)}`); }
}
// Markup inside an inert <template> is not on the page: a second catch-all host there is not a second host.
{
  const r = await lintSurface(page('<section atl-key="r"><p>x</p><template><atelier-host></atelier-host><section atl-key=""><p>row</p></section></template></section>'));
  if (r.failures.length) { failed++; console.log(`TEMPLATE PAYLOAD COUNTED  ${JSON.stringify(r.failures)}`); }
}
// A quote in text a script draws at runtime is UNMEASURED, not gone.
{
  const state = { ...STATE, proposals: { ...STATE.proposals, p8: { id: 'p8', region: 'plan/flow', options: ['A'], suggested: 0, anchor: { region: 'plan/flow', quote: 'Feature flag on' } } } };
  const r = await lintSurface(CLEAN, { state }), u = (r.unmeasured || []).find(f => f.gate === 'ANCHORS');
  if (r.failures.length || !u?.message.includes('p8 in plan/flow')) { failed++; console.log(`UNMEASURED ANCHOR  ${JSON.stringify(r)}`); }
}
// An open item no host claims is out of reach; with a catch-all, everything lands somewhere.
{
  const html = page('<section atl-key="r"><p>Writes stay dual.</p><atelier-host for="r"></atelier-host></section><section atl-key="s"><p>Reads move.</p></section>', { frame: false })
    .replace('<div class="page">', '<header><atelier-activity></atelier-activity></header><div class="page">');
  const state = { proposals: { q1: { id: 'q1', region: 's', options: ['A', 'B'], suggested: 0, status: 'open' }, q2: { id: 'q2', region: 'r', options: ['A'], suggested: 0, status: 'open' } } };
  const r = await lintSurface(html, { state });
  if (gates(r).join() !== 'REACH' || !r.failures[0].message.includes('no host shows q1 in s')) { failed++; console.log(`REACH MISSED  ${JSON.stringify(r.failures)}`); }
  const ok = await lintSurface(html.replace('</main>', '</main><atelier-host></atelier-host>'), { state });
  if (ok.failures.length) { failed++; console.log(`REACH WITH CATCH-ALL  ${JSON.stringify(ok.failures)}`); }
}
for (const [name, gate, words, html] of BAD) {
  const r = await lintSurface(html), hit = r.failures.find(f => f.gate === gate);
  if (!hit || !hit.message.includes(words) || gates(r).some(g => g !== gate)) { failed++; console.log(`MISSED  ${name}: ${JSON.stringify(r.failures)}`); }
}
for (const [name, gate, words, state] of BAD_STATE) {
  const r = await lintSurface(CLEAN, { state }), hit = r.failures.find(f => f.gate === gate);
  if (!hit || !hit.message.includes(words) || gates(r).some(g => g !== gate)) { failed++; console.log(`MISSED  ${name}: ${JSON.stringify(r.failures)}`); }
}
// Region Keys come from ancestors, as the kernel computes them.
const keys = [];
(function walk(n) { for (const c of n.children || []) { if (c.attrs && 'atl-key' in c.attrs) keys.push(regionKey(c)); walk(c); } })(parseHTML(CLEAN));
if (!keys.includes('plan/b/a') || !keys.includes('plan/kernel/why')) { failed++; console.log(`KEYS  ${keys}`); }
console.log(failed ? `lint: ${failed} failure(s)` : `lint: clean Surface passes, ${BAD.length + BAD_STATE.length} defect fixtures caught, content never judged, 0 failures`);
process.exit(failed ? 1 : 0);
