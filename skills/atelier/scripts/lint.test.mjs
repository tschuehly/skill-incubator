#!/usr/bin/env node
// The static lint against one clean Surface and one bad fixture per defect class, plus every
// shipped example. Run: node scripts/lint.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSurface, regionKey, parseHTML } from './lint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const page = (main, { head = '', frame = true } = {}) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="/atelier.css"><link rel="stylesheet" href="/atelier-blocks.css">
<script type="module" src="/atelier.mjs"></script><script type="module" src="/atelier-blocks.mjs"></script>${head}</head>
<body>${frame ? '<header><b>T</b><atelier-activity></atelier-activity></header>' : ''}
<div class="page"><main>${main}</main>${frame ? '<atelier-host layout="anchored" collapsible></atelier-host>' : ''}</div></body></html>`;

const CLEAN = page(`<section atl-key="plan">
  <p>Writes go to both indexes for two weeks.</p>
  <section atl-key="a"><p>Every write lands in both indexes.</p></section>
  <section atl-key="b"><section atl-key="a"><p>Reads switch region by region.</p></section></section>
  <section atl-key="flow">
    <atelier-mermaid alt="The API writes to the old and the new index."><script type="text/plain">
      flowchart LR
        api[API writes] --> old[Old index]
        api --> new["New index (v2)"]
        api --> flag>Feature flag]
    </script></atelier-mermaid>
    <atelier-mermaid alt="An index has a name and a size."><script type="text/plain">
      classDiagram
        class Index {
          +String name
          +size() int
        }
    </script></atelier-mermaid>
    <atelier-chart alt="Mismatch falls from 2% to 0.3% over seven days."><script type="text/plain">
      {"data":{"values":[{"d":1,"m":2},{"d":7,"m":0.3}]},"mark":"line","encoding":{"x":{"field":"d"},"y":{"field":"m"}}}
    </script></atelier-chart>
    <atelier-file lang="js" name="limit.js"><script type="text/plain">if (n >= 50) throw new LimitError(50);</script></atelier-file>
    <atelier-video src="/media/cut.mp4"><script type="text/plain">
      0:00 Hook: twenty-five cards fan out
      0:03.5 The guest scans the QR code
      1:02:10 Credits
    </script></atelier-video>
    <atelier-compare before="/a.png" after="/b.png"></atelier-compare>
    <atelier-mock frame="browser" w="440" alt="The composer with a Send later button."><template><button>Send later</button></template></atelier-mock>
  </section>
  <section atl-key="doc">
    <atelier-file src="/docs/plan.md"></atelier-file>
    <atelier-file lang="md" caption="Budget agreed on Monday." alt="The plan in short."><script type="text/plain">The **rollback window** is _two_ days; see [the runbook](/run.md). Keep snake_case.</script></atelier-file>
  </section>
  <section atl-key="judge">
    <atelier-findings><script type="text/plain">
      liked: Annotating the real thing in place ([08-28](/ev.txt)).
      disliked: Kernel cards stacked away from the content.
      fact: 14 evaluation rounds never reached Done.
      gap: One Proposal per item is untested at 93 items.
    </script></atelier-findings>
    <atelier-decision><script type="text/plain">
      ? Who places the interaction cards?
      * A · The author places every card
        + keeps undo and drafts in one place
        - every Surface lays itself out
      - B · The kernel owns a frame
        − repeats the P4 stacking
        It was tried twice.
    </script></atelier-decision>
    <p>Writes stay dual for two weeks.</p>
    <atelier-flow>
      <section atl-key="s0" atl-label="S0 Backlog"><p>Concepts come from the variety matrix.</p></section>
      <section atl-key="s5" atl-label="S5 Verify"><p>The final checks run on the master.</p>
        <section atl-key="sound" atl-label="Sound"><p>Sound runs to the end: 101 pass.</p></section>
        <section atl-key="freeze" atl-label="Freeze" parallel><p>Freeze: 87 pass, 14 fail.</p>
          <details><summary>Receipts</summary><p>The 14 failures are all on real photos.</p></details></section>
      </section>
    </atelier-flow>
    <atelier-timeline><script type="text/plain">
      Round 0 · first master
        ![The hook frame at 0:03](/frames/r0.png)
        > Judge: The hook frame is too dark.
        The lead regraded the hook.
      Round 1 · accepted
    </script></atelier-timeline>
    <atelier-tabs>
      <section atl-key="t1" atl-label="Kernel"><p>The kernel owns state.</p></section>
      <section atl-key="t2" atl-label="Blocks"><p>Blocks are content.</p></section>
    </atelier-tabs>
    <atelier-video src="/a.mp4"></atelier-video><atelier-video src="/b.mp4"></atelier-video>
    <div><video src="/c.mp4" compare></video><video src="/d.mp4" compare></video></div>
  </section>
  <atelier-claims>
    <section atl-key="kernel"><p>The kernel owns state and protocol.</p>
      <section atl-key="why"><p>Kernel placement failed twice.</p></section>
    </section>
  </atelier-claims>
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
    p1: { id: 'p1', region: 'plan/flow', options: ['A', 'B'], suggested: 1, anchor: { region: 'plan/flow', quote: 'Old index' } },
    p2: { id: 'p2', region: 'plan/doc', options: ['A'], anchor: { region: 'plan/doc', quote: 'merge budget is 2 ms' } },          // quote in the viewed file, as rendered
    p3: { id: 'p3', region: 'plan/kernel/why', options: ['Keep', 'Drop'], suggested: 0, anchor: { region: 'plan/kernel/why', quote: 'failed twice' } },
    p4: { id: 'p4', region: 'plan', options: ['A'], anchor: { region: 'plan', quote: '18% p95 latency & doubles' } },
    p5: { id: 'p5', region: 'plan/doc', options: ['A'], suggested: 0, anchor: { region: 'plan/doc', quote: 'rollback window is two days; see the runbook' } },   // Markdown as rendered
    p6: { id: 'p6', region: 'plan/doc', options: ['A'], anchor: { region: 'plan/doc', quote: 'Budget agreed on Monday' } },                        // a generated caption
    p7: { id: 'p7', region: 'plan/doc', options: ['A'], anchor: { region: 'plan/doc', quote: 'The plan in short' } },                              // generated alt text
    p11: { id: 'p11', region: 'plan/judge', options: ['A'], anchor: { region: 'plan/judge', quote: 'Disliked Kernel cards stacked' } },              // a finding's drawn label
    p12: { id: 'p12', region: 'plan/judge', options: ['A'], anchor: { region: 'plan/judge', quote: 'keeps undo and drafts in one place' } },        // an option's context
    p13: { id: 'p13', region: 'plan/judge', options: ['A'], anchor: { region: 'plan/judge', quote: 'Judge The hook frame is too dark' } },          // a timeline comment
    p10: { id: 'p10', region: 'plan/doc', options: ['A'], anchor: { region: 'plan/doc', quote: 'Keep snake_case.' } },                              // intraword _ is not emphasis
  },
};
const readFile = async p => p === '/docs/plan.md' ? '# Plan\n\nThe **merge budget** is 2 ms.' : null;

// Each bad fixture must fail exactly the named gate, with the named words in its message.
const BAD = [
  ['empty Region key', 'REGIONS', 'empty atl-key', page('<section atl-key="r"><section atl-key=""><p>x</p></section></section>')],
  ['duplicate nested key', 'REGIONS', 'duplicate Region keys silently merge their Threads: r/a', page('<section atl-key="r"><section atl-key="a"></section><section atl-key="a"></section></section>')],
  ['a slash inside one atl-key', 'REGIONS', 'atl-key="a/b"', page('<section atl-key="a/b"><p>x</p></section>')],
  ['no Region at all', 'REGIONS', 'no element carries atl-key', page('<p>Nothing addressable.</p>')],
  ['no host and no Activity', 'HOSTS', 'found 0 <atelier-activity>, need exactly one; no <atelier-host>', page('<section atl-key="r"><p>x</p></section>', { frame: false })],
  ['two catch-all hosts', 'HOSTS', 'found 2 catch-all', page('<section atl-key="r"><p>x</p><atelier-host></atelier-host></section>')],
  ['two hosts for one address', 'HOSTS', 'for="r" has several', page('<section atl-key="r"><p>x</p><atelier-host for="r"></atelier-host><atelier-host for="r"></atelier-host></section>')],
  ['a host for a Region that is not there', 'HOSTS', '<atelier-host for="c6"> names no Region', page('<section atl-key="c64"><p>x</p><atelier-host for="c6"></atelier-host></section>')],
  ['activity doubled', 'HOSTS', 'found 2 <atelier-activity>', page('<section atl-key="r"><p>x</p></section><atelier-activity></atelier-activity>')],
  ['Mermaid with no diagram type', 'BLOCKS', 'not a Mermaid diagram type', page('<section atl-key="r"><atelier-mermaid alt="a"><script type="text/plain">a --> b</script></atelier-mermaid></section>')],
  ['Mermaid without fallback text', 'BLOCKS', 'needs alt', page('<section atl-key="r"><atelier-mermaid><script type="text/plain">flowchart LR\n a --> b</script></atelier-mermaid></section>')],
  ['chart spec that is not JSON', 'BLOCKS', 'not JSON', page('<section atl-key="r"><atelier-chart alt="a"><script type="text/plain">{mark: line}</script></atelier-chart></section>')],
  ['video mark without a time', 'BLOCKS', 'a mark is "m:ss what happens"', page('<section atl-key="r"><atelier-video src="/v.mp4"><script type="text/plain">0:01 ok\nthe end</script></atelier-video></section>')],
  ['mockup without a template', 'BLOCKS', 'needs a <template>', page('<section atl-key="r"><atelier-mock alt="a"><div>x</div></atelier-mock></section>')],
  ['file with nothing to show', 'BLOCKS', 'needs src=, diff=, or inline source', page('<section atl-key="r"><atelier-file></atelier-file></section>')],
  ['compare with one side', 'BLOCKS', 'needs before= and after=', page('<section atl-key="r"><atelier-compare before="/a.png"></atelier-compare></section>')],
  ['misspelt block', 'BLOCKS', '<atelier-diagram>: unknown element', page('<section atl-key="r"><atelier-diagram></atelier-diagram></section>')],
  ['claim without its sentence', 'BLOCKS', 'first child must be a <p>', page('<atelier-claims><section atl-key="c"><h3>Kernel</h3></section></atelier-claims>')],
  ['kernel loaded as a classic script', 'KIT_TAGS', '<script type="module" src="/atelier.mjs"> is missing',
    page('<section atl-key="r"><p>x</p></section>').replace('<script type="module" src="/atelier.mjs">', '<script src="/atelier.mjs">')],
  ['kernel CSS linked without rel=stylesheet', 'KIT_TAGS', '<link rel="stylesheet" href="/atelier.css"> is missing',
    page('<section atl-key="r"><p>x</p></section>').replace('<link rel="stylesheet" href="/atelier.css">', '<link rel="preload" href="/atelier.css">')],
  ['the only Region sits in an inert <template>', 'REGIONS', 'no element carries atl-key', page('<template><section atl-key="r"><p>x</p></section></template><p>Nothing addressable.</p>')],
  ['finding of an unknown kind', 'BLOCKS', 'a finding is "liked|disliked|fact|gap: text"', page('<section atl-key="r"><atelier-findings><script type="text/plain">liked: x\nmaybe: y</script></atelier-findings></section>')],
  ['decision with one option', 'BLOCKS', 'needs at least two options', page('<section atl-key="r"><atelier-decision><script type="text/plain">? Go?\n* Yes</script></atelier-decision></section>')],
  ['flow step in parallel with nothing', 'BLOCKS', 'runs in parallel with nothing', page('<section atl-key="r"><atelier-flow><section atl-key="a" parallel><p>A runs.</p></section></atelier-flow></section>')],
  ['flow holding a step that is not a Region', 'BLOCKS', 'holds <div> outside a step', page('<section atl-key="r"><atelier-flow><section atl-key="a"><p>A runs.</p></section><div>B runs.</div></atelier-flow></section>')],
  ['tabs with one tab', 'BLOCKS', 'needs at least two child atl-key Regions as tabs', page('<section atl-key="r"><atelier-tabs><section atl-key="a"><p>x</p></section></atelier-tabs></section>')],
  ['German page under lang="en"', 'LANG', 'the page reads German',
    page('<section atl-key="r"><p>Die Karte zeigt nicht nur die Stufen, sondern auch die Prüfungen, und wir sehen, dass die meisten Durchfälle bei den echten Fotos liegen. Das ist für die nächste Runde wichtig, weil es auch im Schnitt noch zu lange dauert.</p></section>')],
  ['English page under lang="de"', 'LANG', 'the page reads English',
    page('<section atl-key="r"><p>The map shows the stages and the gates, and most of the failures come from the real photos. That is the reason we want to change it, because it is also slow on the phone and it has been for weeks.</p></section>').replace('<html>', '<html lang="de">')],
  ['two videos side by side, not a comparison', 'VIDEO', 'videos visible at once without a comparison: 2 in r',
    page('<section atl-key="r"><div class="grid"><div><atelier-video src="/a.mp4"></atelier-video></div><div><video src="/b.mp4" controls></video></div></div></section>')],
  ['blocks without the blocks module', 'KIT_TAGS', 'without <script type="module" src="/atelier-blocks.mjs">',
    page('<section atl-key="r"><atelier-compare before="/a.png" after="/b.png"></atelier-compare></section>').replace('<script type="module" src="/atelier-blocks.mjs"></script>', '')],
];
// Heuristics warn, never fail: page-describing prose (ADR 0006), material after a decision.
const WARN = [
  ['option context in a table below the decision', 'DECISION_CONTEXT', '<table> right after the decision',
    page('<section atl-key="r"><atelier-decision><script type="text/plain">? Go?\n* A · yes\n- B · no</script></atelier-decision><table><tr><th>A</th><td>keeps undo</td></tr></table></section>')],
  ['page-describing prose', 'PROSE', '"Six decisions, most dangerous first." (Region r/intro;', page('<section atl-key="r"><section atl-key="intro"><p>Six decisions, most dangerous first. Reads switch region by region.</p><p data-subject-ui>Select any sentence, then press Thread.</p></section></section>')],
  ['meta sentence in a block caption', 'PROSE', 'Green boxes are gates', page('<section atl-key="r"><atelier-mock caption="Green boxes are gates." alt="A form."><template>x</template></atelier-mock></section>')],
];
// Markup inside an inert <template> is not on the page: a second catch-all host there is not a second host.
const CLEAN_TEMPLATE = page('<section atl-key="r"><p>x</p><template><atelier-host></atelier-host><section atl-key=""><p>row</p></section></template></section>');
// A German page under lang="de" is clean, and draws its findings' labels in German.
const CLEAN_DE = page(`<section atl-key="r"><p>Die Karte zeigt nicht nur die Stufen, sondern auch die Prüfungen, und wir sehen, dass die meisten Durchfälle bei den echten Fotos liegen.</p>
  <atelier-findings><script type="text/plain">disliked: Das Video ist viel zu klein, und es läuft neben einem zweiten, das niemand vergleicht.</script></atelier-findings></section>`).replace('<html>', '<html lang="de">');
const BAD_STATE = [
  ['Proposal without a suggested option', 'PROPOSALS', 'p9 in plan/a', { ...STATE, proposals: { ...STATE.proposals, p9: { id: 'p9', region: 'plan/a', options: ['A', 'B'], suggested: 2 } } }],
  ['anchor quote no longer in the source', 'ANCHORS', 'quote "brown fox" is gone', { ...STATE, threads: { ...STATE.threads, 'plan/a': [{ id: 'c1', text: 'x', anchor: { region: 'plan/a', quote: 'brown fox' } }] } }],
  ['anchor Region removed', 'ANCHORS', 'c4 in plan/old (Region missing)', { ...STATE, threads: { ...STATE.threads, 'plan/old': [{ id: 'c4', text: 'z' }] }, sent: { ...STATE.sent, c4: 'ts' } }],
  ['quote removed from rendered Markdown', 'ANCHORS', 'quote "rollback window is three days" is gone',
    { ...STATE, proposals: { ...STATE.proposals, p5: { ...STATE.proposals.p5, anchor: { region: 'plan/doc', quote: 'rollback window is three days' } } } }],
];

let failed = 0;
const gates = r => r.failures.map(f => f.gate);
{
  const r = await lintSurface(CLEAN, { state: STATE, readFile });
  if (r.failures.length) { failed++; console.log(`CLEAN FAILED  ${JSON.stringify(r.failures, null, 1)}`); }
  const want = ['KIT_TAGS', 'REGIONS', 'HOSTS', 'BLOCKS', 'PROSE', 'DECISION_CONTEXT', 'LANG', 'VIDEO', 'PROPOSALS', 'REACH', 'ANCHORS'];
  if (want.some(g => !r.passes.some(p => p.gate === g))) { failed++; console.log(`CLEAN MISSING A PASS  ${r.passes.map(p => p.gate)}`); }
}
{
  const r = await lintSurface(CLEAN_TEMPLATE);
  if (r.failures.length) { failed++; console.log(`TEMPLATE PAYLOAD COUNTED  ${JSON.stringify(r.failures)}`); }
}
// A wide or deep claim tree is content, not a defect: no limit makes the author cut claims.
{
  const deep = '<section atl-key="a"><p>A holds.</p><section atl-key="b"><p>B holds.</p><section atl-key="c"><p>C holds.</p><section atl-key="d"><p>D holds.</p></section></section></section></section>';
  const r = await lintSurface(page(`<atelier-claims>${deep}${[1, 2, 3, 4, 5].map(i => `<section atl-key="w${i}"><p>Claim ${i} holds.</p></section>`).join('')}</atelier-claims>`));
  if (r.failures.length) { failed++; console.log(`CLAIM LIMIT STILL ENFORCED  ${JSON.stringify(r.failures)}`); }
}
// A quote that may sit in text no static reader can project (a drawn diagram) is UNMEASURED, not gone.
{
  const state = { ...STATE, proposals: { ...STATE.proposals, p8: { id: 'p8', region: 'plan/flow', options: ['A'], suggested: 0, anchor: { region: 'plan/flow', quote: 'Feature flag drawn' } } } };
  const r = await lintSurface(CLEAN, { state, readFile }), u = (r.unmeasured || []).find(f => f.gate === 'ANCHORS');
  if (r.failures.length || !u?.message.includes('p8 in plan/flow')) { failed++; console.log(`UNMEASURED ANCHOR  ${JSON.stringify(r)}`); }
  const r2 = await lintSurface(CLEAN, { state: STATE, readFile: async () => null }), u2 = (r2.unmeasured || []).find(f => f.gate === 'ANCHORS');
  if (r2.failures.length || !u2?.message.includes('could not read /docs/plan.md')) { failed++; console.log(`UNREADABLE FILE  ${JSON.stringify(r2)}`); }
}
{
  const r = await lintSurface(CLEAN_DE, { state: { proposals: {}, threads: { r: [{ id: 'g1', text: 'x', anchor: { region: 'r', quote: 'Stört Das Video' } }] }, sent: { g1: 'ts' } } });
  if (r.failures.length) { failed++; console.log(`CLEAN GERMAN FAILED  ${JSON.stringify(r.failures)}`); }
  const cleanWarn = (await lintSurface(CLEAN)).warnings;
  if (cleanWarn.length) { failed++; console.log(`CLEAN WARNED  ${JSON.stringify(cleanWarn)}`); }
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
for (const [name, gate, words, html] of WARN) {
  const r = await lintSurface(html), hit = r.warnings.find(f => f.gate === gate);
  if (!hit || !hit.message.includes(words) || r.failures.length) { failed++; console.log(`NOT WARNED  ${name}: ${JSON.stringify(r)}`); }
}
for (const [name, gate, words, html] of BAD) {
  const r = await lintSurface(html), hit = r.failures.find(f => f.gate === gate);
  if (!hit || !hit.message.includes(words) || gates(r).some(g => g !== gate)) { failed++; console.log(`MISSED  ${name}: ${JSON.stringify(r.failures)}`); }
}
for (const [name, gate, words, state, read = readFile] of BAD_STATE) {
  const r = await lintSurface(CLEAN, { state, readFile: read }), hit = r.failures.find(f => f.gate === gate);
  if (!hit || !hit.message.includes(words) || gates(r).some(g => g !== gate)) { failed++; console.log(`MISSED  ${name}: ${JSON.stringify(r.failures)}`); }
}
// Region Keys come from ancestors, as the kernel computes them.
const keys = [];
(function walk(n) { for (const c of n.children || []) { if (c.attrs && 'atl-key' in c.attrs) keys.push(regionKey(c)); walk(c); } })(parseHTML(CLEAN));
if (!keys.includes('plan/b/a') || !keys.includes('plan/kernel/why')) { failed++; console.log(`KEYS  ${keys}`); }
// Every shipped example lints clean.
const examples = fs.readdirSync(path.join(HERE, '..', 'recipes')).filter(f => f.endsWith('.html'));
for (const f of examples) {
  const r = await lintSurface(fs.readFileSync(path.join(HERE, '..', 'recipes', f), 'utf8'));
  if (r.failures.length) { failed++; console.log(`EXAMPLE ${f}: ${JSON.stringify(r.failures)}`); }
}
console.log(failed ? `lint: ${failed} failure(s)` : `lint: clean Surface passes, ${BAD.length + BAD_STATE.length + WARN.length} defect fixtures caught, ${examples.length} recipes clean, 0 failures`);
process.exit(failed ? 1 : 0);
