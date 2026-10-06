#!/usr/bin/env node
// Atelier kernel verification — every kernel behavior, checked in a real browser.
//
//   node scripts/verify.mjs            all checks
//   node scripts/verify.mjs proposal   only checks whose name contains "proposal"
//
// Starts its own kernel on a free port against a throwaway fixture in a temp directory, so the
// Ready checks can rewrite the document without touching anything in the repo.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const SESSION = 'atelier-verify';
const FILTER = process.argv[2] || '';
const UNDO_MS = 8000;           // shorter than the 30 s default, longer than a few agent-browser round trips

// ---- fixture -------------------------------------------------------------------------
// The late viewer renders from source it holds in <script type="text/plain">, as the building blocks
// do, so the static lint can see the text a Thread quotes before any script runs.
// Deliberately library-free and frame-free: a document with an anchored host beside it, a table
// with keyed rows, a list/detail pair of records with a host each and a reveal resolver, a Region
// no host claims, and a catch-all. `tail` replaces the catch-all to build broken variants.
const surface = ({ alpha = 'the quick brown fox jumps over the lazy dog', beta = 'beta body', c64 = 'c64 body', extra = '',
  flow = ['draft-0', 'high-1'], tail = '<atelier-host></atelier-host>' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>verify</title>
<link rel="stylesheet" href="/atelier.css">
<script type="module" src="/atelier.mjs"></script>
<style>
  body{font-family:system-ui;margin:0;padding:8px 16px}
  .doc{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px}
  @media (max-width:900px){.doc{display:block}}
</style>
</head><body>
<div><b>Verify</b> <atelier-activity></atelier-activity></div>
<div class="doc"><main atl-key="v">
  <h1>Verify</h1>
  <section atl-key="alpha" atl-label="Alpha"><h2>Alpha</h2><p id="alpha-body">${alpha}</p><div style="height:900px"></div></section>
  <section atl-key="list" atl-label="List"><ul><li>first item</li><li>second item</li><li>third item</li></ul><div style="height:600px"></div></section>
  <section atl-key="fig" atl-label="Figure"><svg id="fig-svg" width="400" height="200" viewBox="0 0 400 200" style="max-width:100%"><rect width="400" height="200" fill="#eee"/></svg>
    <svg id="flow-svg" width="400" height="60" viewBox="0 0 400 60" style="max-width:100%">${flow.map((n, i) => `<g class="node" id="mermaid-${Date.now()}-flowchart-${n}" transform="translate(${10 + i * 130},10)"><rect width="110" height="40" fill="#ddd"/><text x="10" y="25">${n.split('-')[0]}</text></g>`).join('')}</svg>
    <svg width="200" height="60" viewBox="0 0 200 60"><g atl-key="dot" atl-label="Dot"><circle id="dot" cx="30" cy="30" r="20" fill="#c33"/></g>
      <g atl-key="box" atl-label="Box" data-anchor="box"><rect id="box-rect" x="80" y="10" width="60" height="40" fill="#9c9"/></g></svg><div style="height:600px"></div></section>
  <section atl-key="beta" atl-label="Beta"><h2>Beta</h2><p>${beta}</p><div style="height:600px"></div></section>
  <section atl-key="late" atl-label="Late"><details id="late-box"><summary>file</summary><div id="late-view"><script type="text/plain">rendered late by a viewer</script></div></details></section>
  <section atl-key="tbl" atl-label="Table"><table><tbody><tr atl-key="r1"><td>row one</td><td>12 ms</td></tr><tr atl-key="r2"><td>row two</td><td>40 ms</td></tr></tbody></table></section>
${extra}</main>
<atelier-host for="v" layout="anchored"></atelier-host></div>
<section id="records"><nav><button data-show="c64">c64</button> <button data-show="c65">c65</button> waiting on c65: <span id="count"></span></nav>
  <article atl-key="c64"><h2>Record c64</h2><p>${c64}</p><button atl-thread>Comment on c64</button><atelier-host for="c64"></atelier-host></article>
  <article atl-key="c65" hidden><h2>Record c65</h2><p>c65 body</p><atelier-host for="c65"></atelier-host></article>
</section>
<section atl-key="loose" atl-label="Loose"><p>a Region no host claims</p></section>
${tail}
<script type="module">
  import { setRevealResolver } from '/atelier.mjs';
  const show = id => { for (const a of document.querySelectorAll('#records > article')) a.hidden = a.getAttribute('atl-key') !== id; window.__shown = id; };
  document.addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (b) show(b.dataset.show); });
  setRevealResolver(async ({ region }) => { const r = region.split('/')[0]; if (r === 'c64' || r === 'c65') show(r); });
  document.addEventListener('atelier:ready', () => show(window.__shown || 'c64'));
  document.addEventListener('atelier:state', e => {
    document.querySelector('#count').textContent = e.detail.items.filter(i => i.region === 'c65' && i.waiting).length; });
</script>
<script>setTimeout(() => { const v = document.querySelector('#late-view'); v.textContent = v.textContent.trim();
  document.dispatchEvent(new CustomEvent('atelier:rendered')); }, 600);</script>
</body></html>`;

// ---- harness -------------------------------------------------------------------------
const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function check(name, fn){
  if (FILTER && !name.toLowerCase().includes(FILTER.toLowerCase())) return;
  try { await fn(); results.push([true, name]); console.log(`  \x1b[32mok\x1b[0m    ${name}`); }
  catch (error){ results.push([false, name]); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${error.message}`); }
}
function assert(condition, message){ if (!condition) throw new Error(message); }
const eq = (actual, expected, what) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

function browser(args, input){
  const r = spawnSync('agent-browser', ['--session', SESSION, ...args], { encoding:'utf8', input, timeout:60000 });
  if (r.error) throw new Error(`agent-browser: ${r.error.message}`);
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'agent-browser failed').trim().slice(0, 300));
  return (r.stdout || '').trim();
}
// Page code must end in a JSON.stringify(...) expression; agent-browser prints it JSON-quoted.
const probe = (js) => JSON.parse(JSON.parse(browser(['eval', '--stdin'], js)));
const act = (js) => browser(['eval', '--stdin'], js + ";'ok'");
const open = (url) => browser(['open', url]);
const viewport = (w, h) => browser(['set', 'viewport', String(w), String(h)]);

const freePort = () => new Promise(resolve => {
  const probeServer = net.createServer();
  probeServer.listen(0, '127.0.0.1', () => {
    const { port } = probeServer.address();
    probeServer.close(() => resolve(port));
  });
});

let server = null;
function startServer(port, dir){
  server = spawn(process.execPath, [path.join(SKILL, 'assets', 'server.mjs')], {
    cwd: dir,
    env: { ...process.env, PORT:String(port), HOST:'127.0.0.1', UI:'surface.html', ROOT:'.', STORE:'verify', UNDO_MS:String(UNDO_MS) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => process.env.ATL_DEBUG && process.stderr.write(String(d)));
  return server;
}
async function waitForServer(base, ms = 8000){
  const deadline = Date.now() + ms;
  for (;;){
    try { if ((await fetch(base + '/api/state')).ok) return; } catch {}
    if (Date.now() > deadline) throw new Error('server did not start');
    await sleep(120);
  }
}
async function stopServer(){
  if (!server) return;
  const dead = new Promise(r => server.once('exit', r));
  server.kill('SIGTERM');
  server = null;
  await dead;
}

// ---- run -----------------------------------------------------------------------------
const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'atelier-verify-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const api = async (route, body) => {
  const r = await fetch(base + route, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  return { status:r.status, body: await r.json().catch(()=>({})) };
};
const writeSurface = (options) => fs.writeFileSync(path.join(dir, 'surface.html'), surface(options));
const state = async () => (await fetch(base + '/api/state')).json();
const threadOf = async (region, text) => ((await state()).threads[region] || []).find(c => c.text === text);
const proposalOf = async (question) => Object.values((await state()).proposals).find(p => p.question === question);
const decisionsOf = async (id) => (await state()).log.filter(e => e.kind === 'decision' && e.proposalId === id).length;
const reload = async (ms = 1300) => { browser(['reload']); await sleep(ms); };
const preflight = () => {
  const r = spawnSync(process.execPath, [path.join(HERE, 'preflight.mjs'), '--url', base, '--skip-poller'], { encoding:'utf8', timeout:300000, cwd: dir });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};
// Top of a host card and of its anchor, in page coordinates.
const tops = (id, anchorJs) => probe(`JSON.stringify({ card: Math.round(document.querySelector('[data-slot="${id}"]').getBoundingClientRect().top),
  anchor: Math.round((${anchorJs}).getBoundingClientRect().top) })`);
const level = (t, what) => assert(Math.abs(t.card - t.anchor) <= 2, `${what}: card at ${t.card}, anchor at ${t.anchor}`);
const typeNewAndSend = async (text) => {
  act(`(()=>{const t=document.querySelector('atelier-host [data-new]'); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('atelier-host [data-send]').click()})()`);
  await sleep(700);
};
const typeInto = (sel, text) => act(`(()=>{const t=document.querySelector(${JSON.stringify(sel)}); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const altClick = (js, fx = 0.5, fy = 0.5) => act(`(()=>{const el=${js}; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,altKey:true,clientX:r.left+r.width*${fx},clientY:r.top+r.height*${fy}}))})()`);
// Holds the page's matching requests until release(); every other request passes.
const hold = (match) => act(`(()=>{const f=window.fetch, held=[]; window.__fetch=f; window.__release=()=>held.splice(0).forEach(go=>go());
  window.fetch=(u,o)=>(${match})(String(u),o) ? new Promise(go=>held.push(go)).then(()=>f(u,o)) : f(u,o)})()`);
const release = () => act(`(()=>{window.fetch=window.__fetch; window.__release()})()`);
const unattachAll = (id) => act(`(()=>{let b; while ((b = document.querySelector('[data-card="${id}"] [data-unattach]'))) b.click()})()`);
const cardText = (id) => probe(`JSON.stringify(document.querySelector('[data-slot="${id}"]')?.innerText || '')`);
const hostOf = (id) => probe(`JSON.stringify(document.querySelector('[data-slot="${id}"]')?.closest('atelier-host')?.getAttribute('for') ?? null)`);

writeSurface();
startServer(port, dir);
await waitForServer(base);
console.log(`\natelier verify — ${base}  (fixture: ${dir})\n`);

try {
  viewport(1440, 900);
  browser(['console', '--clear']);
  browser(['errors', '--clear']);
  open(base + '/');
  await sleep(1200);

  await check('resilience: boot has no browser errors', async () => {
    const consoleData = JSON.parse(browser(['console', '--json'])).data || {};
    const errorData = JSON.parse(browser(['errors', '--json'])).data || {};
    const consoleErrors = (consoleData.messages || []).filter(message => message.type === 'error');
    eq([consoleErrors.length, (errorData.errors || []).length], [0, 0], 'browser errors');
  });

  // ---- regions ----
  await check('regions: atl-key on any element, a table row included, builds the path', async () => {
    eq(probe(`JSON.stringify({ row: document.querySelector('[atl-key=r1]').parentElement.tagName,
      unknown: [...document.querySelectorAll('atelier-region, atelier-margin')].length })`), { row:'TBODY', unknown:0 }, 'markup');
    altClick(`document.querySelector('[atl-key=r2] td')`);
    await sleep(200);
    await typeNewAndSend('row thread');
    const c = await threadOf('v/tbl/r2', 'row thread');
    assert(c?.anchor?.selector, `no Thread on v/tbl/r2: ${JSON.stringify((await state()).threads)}`);
    eq([await hostOf(c.id), probe(`JSON.stringify((td => td.hasAttribute('atl-anchor') || td.hasAttribute('atl-active'))(document.querySelector('[atl-key=r2] td')))`)], ['v', true], 'host and mark');
  });

  // ---- anchors ----
  await check('anchor: a text selection opens a Thread on that exact text', async () => {
    act(`(()=>{const t=document.querySelector('#alpha-body').firstChild, i=t.data.indexOf('brown fox'), r=document.createRange();
      r.setStart(t,i); r.setEnd(t,i+9); getSelection().removeAllRanges(); getSelection().addRange(r);
      document.querySelector('#alpha-body').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})()`);
    await sleep(150);
    eq(probe(`JSON.stringify(document.querySelector('.atl-float').hidden)`), false, 'Thread button hidden after selecting');
    act(`document.querySelector('.atl-float').click()`);
    await sleep(200);
    await typeNewAndSend('selection thread');
    const c = await threadOf('v/alpha', 'selection thread');
    assert(c && (await state()).sent[c.id], 'thread not sent');
    eq([c.anchor.region, c.anchor.quote], ['v/alpha', 'brown fox'], 'anchor');
  });

  await check('anchor: an anchored host places the card level with its text', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    eq(probe(`JSON.stringify(document.querySelector('atelier-host[for=v]').hasAttribute('atl-aligned'))`), true, 'host aligned beside its content');
    const t = probe(`JSON.stringify((()=>{const r=[...CSS.highlights.get('atl-anchor'), ...CSS.highlights.get('atl-active')].find(r=>r.toString()==='brown fox');
      return { card: Math.round(document.querySelector('[data-slot="${c.id}"]').getBoundingClientRect().top), anchor: Math.round(r.getBoundingClientRect().top) }})())`);
    level(t, 'selection card');
  });

  await check('anchor: Alt+click anchors an element', async () => {
    altClick(`document.querySelectorAll('[atl-key=list] li')[1]`);
    await sleep(200);
    await typeNewAndSend('element thread');
    const c = await threadOf('v/list', 'element thread');
    assert(c?.anchor?.selector, 'no selector stored');
    eq(probe(`JSON.stringify(document.querySelector('[atl-key=list]').querySelector(${JSON.stringify(c.anchor.selector)}).textContent)`), 'second item', 'selector target');
    level(tops(c.id, `document.querySelectorAll('[atl-key=list] li')[1]`), 'element card');
  });

  await check('anchor: Pick mode anchors without Alt, and Escape leaves it', async () => {
    act(`document.querySelector('atelier-activity [data-pick]').click()`);
    eq(probe(`JSON.stringify(document.documentElement.hasAttribute('atl-picking'))`), true, 'pick mode on');
    act(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    eq(probe(`JSON.stringify(document.documentElement.hasAttribute('atl-picking'))`), false, 'Escape left pick mode');
    act(`document.querySelector('atelier-activity [data-pick]').click()`);
    act(`document.querySelectorAll('[atl-key=list] li')[2].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    await sleep(200);
    eq(probe(`JSON.stringify(!!document.querySelector('atelier-host [data-new]'))`), true, 'composer opened');
    act(`document.querySelector('atelier-host [data-discard]').click()`);
  });

  await check('anchor: a point on an image or SVG is stored relative to it', async () => {
    altClick(`document.querySelector('#fig-svg')`, 0.25, 0.5);
    await sleep(200);
    await typeNewAndSend('point thread');
    const c = await threadOf('v/fig', 'point thread');
    assert(c?.anchor?.point, 'no point stored');
    assert(Math.abs(c.anchor.point.x - 0.25) < 0.02 && Math.abs(c.anchor.point.y - 0.5) < 0.02, `point ${JSON.stringify(c.anchor.point)}`);
    level(tops(c.id, `({getBoundingClientRect(){const r=document.querySelector('#fig-svg').getBoundingClientRect();return {top:r.top+r.height*0.5}}})`), 'point card');
  });

  await check('anchor: a diagram box is found by its name after the diagram changes', async () => {
    altClick(`document.querySelector('#flow-svg g.node:nth-of-type(2) rect')`);
    await sleep(200);
    await typeNewAndSend('box thread');
    const c = await threadOf('v/fig', 'box thread');
    eq(c?.anchor?.selector, ':scope g.node[id*="-flowchart-high-"]', 'box selector');
    writeSurface({ flow:['concept-0', 'draft-1', 'high-2'] });
    await api('/api/ready', { changed:['v/fig'] });
    await sleep(1500);
    eq(probe(`JSON.stringify(document.querySelector('#flow-svg [atl-anchor], #flow-svg [atl-active]')?.textContent)`), 'high', 'anchored box after Ready');
    writeSurface();
    await api('/api/ready', { changed:['v/fig'] });
    await sleep(1200);
  });

  await check('anchor: Alt+click inside an SVG <g> Region anchors the shape, not the SVG around it', async () => {
    altClick(`document.querySelector('#dot')`);
    await sleep(200);
    await typeNewAndSend('dot thread');
    const c = await threadOf('v/fig/dot', 'dot thread');
    assert(c?.anchor?.selector, `no Thread on v/fig/dot: ${JSON.stringify(Object.keys((await state()).threads))}`);
    eq(probe(`JSON.stringify(document.querySelector('[atl-key=dot]').querySelector(${JSON.stringify(c.anchor.selector)})?.id)`), 'dot', 'selector target');
  });

  await check('anchor: Alt+click inside a <g> Region that is its own data-anchor box anchors the whole Region', async () => {
    altClick(`document.querySelector('#box-rect')`);
    await sleep(200);
    await typeNewAndSend('own box thread');
    const c = await threadOf('v/fig/box', 'own box thread');
    eq(c?.anchor, { region:'v/fig/box' }, 'anchor');
    const lost = JSON.parse(JSON.parse(browser(['eval', `import('/atelier.mjs').then(k => JSON.stringify(k.unresolvedAnchors()))`])));
    eq(lost.filter(u => u.id === c.id), [], 'unresolved');
  });

  await check('anchor: text a viewer renders late resolves, and revealing it opens its details', async () => {
    await api('/api/state', { threads: { ...(await state()).threads, 'v/late': [{ id: 'c-late', text: 'late thread', anchor: { region: 'v/late', quote: 'rendered late' } }] } });
    await api('/api/send', { region: 'v/late', id: 'c-late' });
    await reload(1800);
    const hl = probe(`JSON.stringify([...CSS.highlights.get('atl-anchor')].map(r => r.toString()))`);
    assert(hl.includes('rendered late'), `highlights: ${JSON.stringify(hl)}`);
    eq(probe(`JSON.stringify(document.querySelector('#late-box').open)`), false, 'details open before reveal');
    eq(JSON.parse(browser(['eval', `import('/atelier.mjs').then(k => k.reveal('c-late'))`])), true, 'reveal result');
    await sleep(500);
    eq(probe(`JSON.stringify(document.querySelector('#late-box').open)`), true, 'details open after reveal');
  });

  await check('anchor: ⌘+Enter sends a new Thread', async () => {
    altClick(`document.querySelector('[atl-key=beta] p')`);
    await sleep(300);
    act(`(()=>{const t=document.querySelector('atelier-host [data-new]'); t.value='keyboard thread'; t.focus()})()`);
    browser(['press', 'Meta+Enter']);
    await sleep(800);
    assert(await threadOf('v/beta', 'keyboard thread'), 'not sent by ⌘+Enter');
  });

  await check('anchor: an atl-thread button opens a whole-Region Thread in that Region\'s host', async () => {
    act(`document.querySelector('[atl-key=c64] [atl-thread]').click()`);
    await sleep(300);
    eq(probe(`JSON.stringify(!!document.querySelector('atelier-host[for=c64] [data-new]'))`), true, 'draft in the c64 host');
    await typeNewAndSend('record thread');
    const c = await threadOf('c64', 'record thread');
    eq([c?.anchor, await hostOf(c?.id)], [{ region:'c64' }, 'c64'], 'whole-Region anchor in its host');
  });

  await check('state: the kernel marks authored elements with attributes, never classes or nodes', async () => {
    const r = probe(`JSON.stringify({ classes: [...document.querySelectorAll('[class*="atl-"]')].filter(e => !e.closest('atelier-host,atelier-activity,.atl-float,.atl-warnings') && !e.matches('.atl-float,.atl-warnings')).map(e => e.tagName + '.' + e.className),
      nodes: [...document.querySelectorAll('[atl-key] *')].filter(e => !e.closest('atelier-host') && /^ATELIER-(?!HOST)/.test(e.tagName)).length,
      marked: document.querySelectorAll('[atl-anchor],[atl-active]').length })`);
    eq([r.classes, r.nodes], [[], 0], 'kernel classes or nodes in authored content');
    assert(r.marked >= 2, `anchored elements marked: ${r.marked}`);
  });

  // ---- thread conversation ----
  await check('thread: an agent reply arrives with no reload', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    act(`window.__noReload = true`);
    await api('/api/reply', { region:'v/alpha', id:c.id, msg:'agent answer one', state:'acknowledged' });
    await sleep(900);
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    const card = probe(`JSON.stringify({ reload: !window.__noReload, text: document.querySelector('[data-card="${c.id}"]').innerText })`);
    eq(card.reload, false, 'page reloaded');
    assert(card.text.includes('agent answer one') && card.text.includes('Seen by agent'), `card: ${card.text}`);
  });

  await check('thread: the human follows up and the agent is woken', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    act(`(()=>{document.querySelector('[data-reply-text="${c.id}"]').value='human follow-up'; document.querySelector('[data-reply="${c.id}"]').click()})()`);
    await sleep(700);
    const s = await state();
    eq(s.replies[c.id].at(-1), { ...s.replies[c.id].at(-1), msg:'human follow-up', author:'human' }, 'stored follow-up');
    const ev = s.log.at(-1);
    eq([ev.kind, ev.id, ev.followUp], ['sent', c.id, 'human follow-up'], 'wake event');
    eq(probe(`JSON.stringify(document.querySelector('[data-reply-text="${c.id}"]')?.value ?? '')`), '', 'sent reply left in the box');
  });

  await check('thread: text typed while a reply is sending stays in the box', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    act(`(()=>{const f=window.fetch; window.__fetch=f; window.fetch=(u,o)=>String(u)==='/api/thread-message'
      ? new Promise(r=>setTimeout(r,700)).then(()=>f(u,o)) : f(u,o)})()`);
    typeInto(`[data-reply-text="${c.id}"]`, 'sent part');
    act(`document.querySelector('[data-reply="${c.id}"]').click()`);
    await sleep(200);
    typeInto(`[data-reply-text="${c.id}"]`, 'typed while sending');
    await sleep(1300);
    act(`window.fetch = window.__fetch`);
    eq([(await state()).replies[c.id].at(-1).msg, probe(`JSON.stringify(document.querySelector('[data-reply-text="${c.id}"]')?.value ?? null)`)],
      ['sent part', 'typed while sending'], 'stored reply and the box');
    typeInto(`[data-reply-text="${c.id}"]`, '');
  });

  await check('thread: Accept closes an implemented Thread', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    await api('/api/reply', { region:'v/alpha', id:c.id, msg:'done', state:'implemented' });
    await sleep(900);
    act(`document.querySelector('[data-card="${c.id}"] [data-accept]').click()`);
    await sleep(500);
    eq((await state()).commentState[c.id].value, 'accepted', 'state');
  });

  await check('thread: Reopen requires what is still wrong, then rejects', async () => {
    const c = await threadOf('v/list', 'element thread');
    await api('/api/comment-state', { region:'v/list', id:c.id, state:'implemented' });
    await sleep(900);
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    act(`document.querySelector('[data-card="${c.id}"] [data-reject]').click()`);
    await sleep(400);
    eq((await state()).commentState[c.id].value, 'implemented', 'empty Reopen changed state');
    act(`(()=>{document.querySelector('[data-reply-text="${c.id}"]').value='still wrong'; document.querySelector('[data-card="${c.id}"] [data-reject]').click()})()`);
    await sleep(600);
    const s = await state();
    eq([s.commentState[c.id].value, s.replies[c.id].at(-1).msg], ['rejected', 'still wrong'], 'rejection');
  });

  await check('thread: two new Threads sent before a refresh are both kept', async () => {
    act(`(()=>{const f=window.fetch; window.__fetch=f; window.fetch=(u,o)=>String(u)==='/api/state' && o?.method==='POST'
      ? new Promise(r=>setTimeout(r,600)).then(()=>f(u,o)) : f(u,o)})()`);
    altClick(`document.querySelectorAll('[atl-key=list] li')[0]`);
    await sleep(200);
    typeInto('atelier-host [data-new]', 'race one');
    act(`document.querySelector('atelier-host [data-send]').click()`);
    altClick(`document.querySelectorAll('[atl-key=list] li')[2]`);
    await sleep(200);
    typeInto('atelier-host [data-new]', 'race two');
    act(`document.querySelector('atelier-host [data-send]').click()`);
    await sleep(2500);
    act(`window.fetch = window.__fetch`);
    const s = await state(), one = await threadOf('v/list', 'race one'), two = await threadOf('v/list', 'race two');
    assert(one && two, `stored: ${JSON.stringify((s.threads['v/list'] || []).map(c => c.text))}`);
    eq([!!s.sent[one.id], !!s.sent[two.id], probe(`JSON.stringify(document.querySelectorAll('atelier-host [data-new]').length)`)], [true, true, 0], 'both sent, no draft left');
  });

  await check('thread: an unsent new Thread survives a reload', async () => {
    altClick(`document.querySelector('[atl-key=beta] h2')`);
    await sleep(200);
    typeInto('atelier-host [data-new]', 'draft kept');
    await reload();
    assert(probe(`JSON.stringify(document.querySelector('atelier-host[for=v]').innerText)`).includes('✎ draft kept'), 'unsent Thread not listed after reload');
    act(`[...document.querySelectorAll('atelier-host [data-open]')].find(b=>b.innerText.includes('draft kept')).click()`);
    eq(probe(`JSON.stringify(document.querySelector('atelier-host [data-new]')?.value)`), 'draft kept', 'draft after reload');
    act(`document.querySelector('atelier-host [data-discard]').click()`);
  });

  await check('thread: ×, Escape and a click outside close a card and keep its draft', async () => {
    const c = await threadOf('v/beta', 'keyboard thread');
    const isOpen = () => probe(`JSON.stringify(!!document.querySelector('[data-card="${c.id}"].is-open'))`);
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    typeInto(`[data-reply-text="${c.id}"]`, 'kept draft');
    act(`document.querySelector('[data-card="${c.id}"] [data-close]').click()`);
    eq(isOpen(), false, 'open after ×');
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    eq(probe(`JSON.stringify(document.querySelector('[data-reply-text="${c.id}"]').value)`), 'kept draft', 'draft after reopening');
    act(`document.querySelector('[data-reply-text="${c.id}"]').focus({preventScroll:true})`);
    browser(['press', 'Escape']);
    eq(isOpen(), false, 'open after Escape');
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    act(`document.querySelector('[atl-key=beta] h2').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    eq(isOpen(), false, 'open after clicking the page');
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    typeInto(`[data-reply-text="${c.id}"]`, '');
    act(`document.querySelector('[data-card="${c.id}"] [data-close]').click()`);
  });

  await check('thread: a reply draft survives a failed send, a Ready of its Region and a reload', async () => {
    const c = await threadOf('c64', 'record thread');
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    typeInto(`[data-reply-text="${c.id}"]`, 'draft that must survive');
    act(`(()=>{const f=window.fetch; window.__fetch=f; window.fetch=(u,o)=>String(u)==='/api/thread-message'
      ? Promise.resolve(new Response('{"ok":false,"error":"store unavailable"}',{status:500,headers:{'Content-Type':'application/json'}})) : f(u,o)})()`);
    act(`document.querySelector('[data-reply="${c.id}"]').click()`);
    await sleep(700);
    const failed = probe(`JSON.stringify({ text: document.querySelector('[data-card="${c.id}"]').innerText, draft: document.querySelector('[data-reply-text="${c.id}"]').value })`);
    assert(failed.text.includes('Not sent: store unavailable'), `no failure shown: ${failed.text}`);
    eq(failed.draft, 'draft that must survive', 'draft after a failed send');
    eq(((await state()).replies[c.id] || []).length, 0, 'replies stored');
    act(`window.fetch = window.__fetch`);
    writeSurface({ c64:'c64 body, edited' });
    await api('/api/ready', { changed:['c64'] });
    await sleep(1500);
    eq(probe(`JSON.stringify({ body: document.querySelector('[atl-key=c64] p').textContent, draft: document.querySelector('[data-reply-text="${c.id}"]')?.value })`),
      { body:'c64 body, edited', draft:'draft that must survive' }, 'after a Ready swapped the Region and its host');
    await reload();
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    eq(probe(`JSON.stringify(document.querySelector('[data-reply-text="${c.id}"]')?.value)`), 'draft that must survive', 'draft after reload');
    act(`document.querySelector('[data-reply="${c.id}"]').click()`);
    await sleep(700);
    eq([((await state()).replies[c.id] || []).at(-1)?.msg, probe(`JSON.stringify(document.querySelector('[data-reply-text="${c.id}"]')?.value ?? '')`)],
      ['draft that must survive', ''], 'sent once the server answered 2xx');
  });

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const pasteInto = sel => act(`(()=>{const b=Uint8Array.from(atob('${PNG}'),c=>c.charCodeAt(0)); const dt=new DataTransfer();
    dt.items.add(new File([b],'shot.png',{type:'image/png'})); document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))})()`);

  await check('thread: a pasted image uploads, shows, and goes out with a new Thread', async () => {
    altClick(`document.querySelector('[atl-key=beta] p')`);
    await sleep(200);
    pasteInto('atelier-host [data-new]');
    await sleep(800);
    eq(probe(`JSON.stringify(document.querySelectorAll('atelier-host .atl-att img').length)`), 1, 'thumbnails before sending');
    await typeNewAndSend('image thread');
    const c = await threadOf('v/beta', 'image thread');
    assert(/^\/\.review\/attachments\/[\w.-]+\.png$/.test(c?.attachments?.[0] || ''), `attachments ${JSON.stringify(c?.attachments)}`);
    const r = await fetch(base + c.attachments[0]);
    eq([r.status, r.headers.get('content-type')], [200, 'image/png'], 'served image');
    const ev = (await state()).log.filter(e => e.kind === 'sent').at(-1);
    eq(ev.comment.attachments, c.attachments, 'image in the wake event');
  });

  await check('thread: an image pasted into a reply survives a reload', async () => {
    const c = await threadOf('v/beta', 'image thread');
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    pasteInto(`[data-reply-text="${c.id}"]`);
    await sleep(800);
    await reload();
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    eq(probe(`JSON.stringify(document.querySelectorAll('[data-card="${c.id}"] .atl-att img').length)`), 1, 'unsent images after reload');
    act(`document.querySelector('[data-card="${c.id}"] [data-unattach]').click()`);
  });

  await check('thread: an image pasted into a reply goes out as a follow-up', async () => {
    const c = await threadOf('v/beta', 'image thread');
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    pasteInto(`[data-reply-text="${c.id}"]`);
    await sleep(800);
    act(`document.querySelector('[data-reply="${c.id}"]').click()`);
    await sleep(700);
    const s = await state(), last = s.replies[c.id].at(-1), ev = s.log.at(-1);
    assert(last.author === 'human' && last.attachments?.length === 1, `reply ${JSON.stringify(last)}`);
    eq([ev.followUp, ev.attachments], ['(image)', last.attachments], 'follow-up event');
    eq(probe(`JSON.stringify(document.querySelectorAll('[data-card="${c.id}"] .atl-msg img').length)`), 2, 'images shown in the Thread');
  });

  await check('thread: an image pasted while a new Thread is sending stays, in its reply draft', async () => {
    altClick(`document.querySelector('[atl-key=beta] h2')`);
    await sleep(200);
    typeInto('atelier-host [data-new]', 'sent while pasting');
    hold(`(u, o) => u === '/api/state' && o?.method === 'POST'`);
    act(`document.querySelector('atelier-host [data-send]').click()`);
    await sleep(300);
    pasteInto('atelier-host [data-new]');
    await sleep(800);
    eq(probe(`JSON.stringify(document.querySelector('atelier-host [data-new]').closest('[data-card]').querySelectorAll('.atl-att img').length)`), 1, 'uploaded while sending');
    release();
    await sleep(1000);
    const c = await threadOf('v/beta', 'sent while pasting');
    assert(c && (await state()).sent[c.id], 'Thread not sent');
    try {
      eq([c.attachments ?? null, probe(`JSON.stringify(document.querySelectorAll('[data-card="${c.id}"] .atl-att img').length)`),
        probe(`JSON.stringify(JSON.parse(sessionStorage.getItem('atelier:atts')).filter(([k]) => k === '${c.id}|reply').map(([, v]) => v.length))`)],
        [null, 1, [1]], 'sent Thread, its reply draft, and sessionStorage');
    } finally { unattachAll(c.id); }
  });

  await check('thread: two images uploading at once into a reply are both kept', async () => {
    const c = await threadOf('v/beta', 'sent while pasting');
    await reload();
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    hold(`u => u === '/api/attach'`);
    pasteInto(`[data-reply-text="${c.id}"]`);
    pasteInto(`[data-reply-text="${c.id}"]`);
    await sleep(300);
    release();
    await sleep(800);
    try { eq(probe(`JSON.stringify(document.querySelectorAll('[data-card="${c.id}"] .atl-att img').length)`), 2, 'images'); }
    finally { unattachAll(c.id); }
  });

  await check('thread: an upload that finishes after its card was redrawn keeps the newer text', async () => {
    const c = await threadOf('v/beta', 'sent while pasting');
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    typeInto(`[data-reply-text="${c.id}"]`, 'older text');
    hold(`u => u === '/api/attach'`);
    pasteInto(`[data-reply-text="${c.id}"]`);
    await sleep(300);
    act(`document.querySelector('[data-card="${c.id}"] [data-close]').click()`);
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    typeInto(`[data-reply-text="${c.id}"]`, 'newer text');
    act(`document.querySelector('[data-card="${c.id}"] [data-close]').click()`);
    release();
    await sleep(800);
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    try {
      eq(probe(`JSON.stringify({ text: document.querySelector('[data-reply-text="${c.id}"]').value, images: document.querySelectorAll('[data-card="${c.id}"] .atl-att img').length })`),
        { text:'newer text', images:1 }, 'reopened card');
    } finally {
      typeInto(`[data-reply-text="${c.id}"]`, '');
      unattachAll(c.id);
      act(`document.querySelector('[data-card="${c.id}"] [data-close]').click()`);
    }
  });

  // ---- proposals ----
  await check('proposal: one posted after load appears open, with its options, in a hidden record\'s host', async () => {
    const { body } = await api('/api/propose', { region:'c65', question:'Ship c65 as is?', options:['Ship it (recommended)', 'Hold it back'] });
    await sleep(900);
    const r = probe(`JSON.stringify((()=>{const h=document.querySelector('atelier-host[for=c65]'), card=h.querySelector('[data-card="${body.id}"]');
      return { hidden: !!h.closest('[hidden]'), options: card ? [...card.querySelectorAll('[data-choose]')].map(b=>b.innerText.trim()) : null,
        twoStep: !!card?.querySelector('[data-decide],input[type=radio]'), count: document.querySelector('#count').textContent }})())`);
    eq(r, { hidden:true, options:['Ship it Recommended', 'Hold it back'], twoStep:false, count:'1' }, 'hidden record host');
  });

  await check('proposal: a drawer row reveals it through the resolver and focuses its card', async () => {
    const pr = await proposalOf('Ship c65 as is?');
    act(`document.querySelector('[popovertarget=atl-drawer]').click()`);
    act(`document.querySelector('#atl-drawer [data-reveal="${pr.id}"]').click()`);
    await sleep(900);
    eq(probe(`JSON.stringify((()=>{const card=document.querySelector('[data-card="${pr.id}"]'), b=card.getBoundingClientRect();
      return { shown: !document.querySelector('[atl-key=c65]').hidden, drawer: document.querySelector('#atl-drawer').matches(':popover-open'),
        focus: document.activeElement.closest('[data-card]')?.dataset.card, option: document.activeElement.matches('[data-choose]'),
        inView: b.top >= 0 && b.bottom <= innerHeight, uncovered: card.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) }})())`),
      { shown:true, drawer:false, focus:pr.id, option:true, inView:true, uncovered:true }, 'after reveal');
  });

  await check('proposal: one click makes the choice pending, with an undo countdown at the click', async () => {
    const pr = await proposalOf('Ship c65 as is?');
    act(`document.querySelector('[data-choose="${pr.id}"][data-i="1"]').click()`);
    await sleep(500);
    const p = await proposalOf('Ship c65 as is?');
    eq([p.status, p.choiceIndex, typeof p.attempt, await decisionsOf(pr.id)], ['pending', 1, 'string', 0], 'after one click');
    const text = await cardText(pr.id);
    assert(/Chosen: Hold it back/.test(text) && /Undo \(\d s\)/.test(text), `card: ${text}`);
  });

  await check('proposal: Undo reopens it and the agent hears nothing', async () => {
    const pr = await proposalOf('Ship c65 as is?');
    act(`document.querySelector('[data-undo="${pr.id}"]').click()`);
    await sleep(600);
    const p = await proposalOf('Ship c65 as is?');
    eq([p.status, p.choiceIndex, await decisionsOf(pr.id)], ['open', null, 0], 'after Undo');
    eq(probe(`JSON.stringify(document.querySelectorAll('[data-card="${pr.id}"] [data-choose]').length)`), 2, 'options back');
    await sleep(UNDO_MS + 500);
    eq(await decisionsOf(pr.id), 0, 'decision events after the window');
  });

  await check('proposal: when the undo window closes, exactly one decision event is logged', async () => {
    const pr = await proposalOf('Ship c65 as is?');
    act(`document.querySelector('[data-choose="${pr.id}"][data-i="0"]').click()`);
    await sleep(UNDO_MS + 1500);
    const p = await proposalOf('Ship c65 as is?');
    eq([p.status, p.choiceIndex, await decisionsOf(pr.id)], ['decided', 0, 1], 'after the window');
    assert((await cardText(pr.id)).startsWith('✓ Decided'), 'decided card did not collapse');
  });

  await check('proposal: the server rejects an invalid choice and a second click, and repeats a retried one', async () => {
    const { body } = await api('/api/propose', { region:'c64', question:'Crop c64?', options:['Crop', 'Keep'] });
    const decide = b => api('/api/decide', { id: body.id, ...b });
    eq([(await decide({ choiceIndex:7, attempt:'t1' })).status, (await decide({ attempt:'t1' })).status,
      (await decide({ choiceIndex:0, custom:'both', attempt:'t1' })).status, (await decide({ choiceIndex:0 })).status,
      (await api('/api/decide', { id:'prop-none', choiceIndex:0, attempt:'t1' })).status], [400, 400, 400, 400, 404], 'invalid requests');
    eq((await decide({ choiceIndex:0, attempt:'t1' })).status, 200, 'first click');
    const again = await decide({ choiceIndex:0, attempt:'t1' });
    eq([again.status, again.body.repeated], [200, true], 'the same click retried');
    eq([(await decide({ choiceIndex:1, attempt:'t2' })).status, (await api('/api/propose', { region:'c64', question:'Other?', options:['x'] })).status,
      (await api('/api/undo-decision', { id: body.id, attempt:'t2' })).status], [409, 409, 409], 'second click, replacement, stale undo');
    eq((await api('/api/undo-decision', { id: body.id, attempt:'t1' })).status, 200, 'undo');
    eq((await decide({ choiceIndex:0, attempt:'t1' })).status, 409, 'an undone click retried');
  });

  await check('proposal: an anchor places it beside the exact text', async () => {
    const { body } = await api('/api/propose', { region:'v/alpha', question:'Lazy?', options:['Yes', 'No'], anchor:{ region:'v/alpha', quote:'lazy dog' } });
    await sleep(900);
    eq((await state()).proposals[body.id].anchor.quote, 'lazy dog', 'stored anchor');
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('${body.id}')).then(() => 'ok')`]);
    await sleep(700);
    const t = probe(`JSON.stringify((()=>{const r=[...CSS.highlights.get('atl-active')].find(r=>r.toString()==='lazy dog');
      return { card: Math.round(document.querySelector('[data-slot="${body.id}"]').getBoundingClientRect().top), anchor: Math.round(r.getBoundingClientRect().top) }})())`);
    level(t, 'anchored proposal');
  });

  await check('proposal: Something else sends the human\'s own answer, which Undo takes back', async () => {
    const { body } = await api('/api/propose', { region:'v/beta', question:'Name?', options:['A', 'B'] });
    await sleep(900);
    act(`document.querySelector('[data-card="${body.id}"] [data-keep$="|custom"] summary').click()`);
    typeInto(`[data-custom="${body.id}"]`, 'my own');
    act(`document.querySelector('[data-answer="${body.id}"]').click()`);
    await sleep(600);
    const p = (await state()).proposals[body.id];
    eq([p.status, p.custom, p.choiceIndex], ['pending', 'my own', null], 'custom answer');
    assert((await cardText(body.id)).includes('Chosen: my own'), 'custom answer not shown');
    act(`document.querySelector('[data-undo="${body.id}"]').click()`);
    await sleep(600);
    eq((await state()).proposals[body.id].status, 'open', 'after Undo');
  });

  await check('proposal: Undo works while the click\'s own request is still in flight', async () => {
    const { body } = await api('/api/propose', { region:'v/tbl', question:'Slow answer?', options:['A', 'B'] });
    await sleep(900);
    // The server took the choice and the page heard of it, but the click's own answer is late.
    act(`(()=>{const f=window.fetch; window.__fetch=f; window.fetch=(u,o)=>String(u)==='/api/decide'
      ? f(u,o).then(r=>new Promise(res=>setTimeout(()=>res(r),2500))) : f(u,o)})()`);
    act(`document.querySelector('[data-choose="${body.id}"][data-i="0"]').click()`);
    await sleep(900);
    eq((await state()).proposals[body.id].status, 'pending', 'before Undo');
    act(`document.querySelector('[data-card="${body.id}"] [data-undo]').click()`);
    await sleep(600);
    eq((await state()).proposals[body.id].status, 'open', 'after Undo');
    await sleep(2000);
    act(`window.fetch = window.__fetch`);
  });

  await check('proposal: an option explanation is asked and answered in place', async () => {
    const { body } = await api('/api/propose', { region:'v/list', question:'Order?', options:['Alphabetical', 'By date'] });
    await sleep(900);
    act(`document.querySelector('[data-keep="${body.id}|explain:1"] summary').click()`);
    typeInto(`[data-explain-text="${body.id}:1"]`, 'why date?');
    act(`document.querySelector('[data-explain="${body.id}"][data-i="1"]').click()`);
    await sleep(600);
    eq((await state()).proposals[body.id].explanationRequests['1'].answer, 'why date?', 'request');
    await api('/api/explain', { id:body.id, optionIndex:1, text:'dates match the audit' });
    await sleep(900);
    assert((await cardText(body.id)).includes('dates match the audit'), 'explanation not shown');
  });

  // A Proposal is opened when its options reach the screen: here, when the resolver shows the
  // hidden record whose host holds it. Never seen, its default is not agreement.
  await check('proposal: options that never reached the screen read not opened; showing them records it once', async () => {
    act(`document.querySelector('[data-show="c64"]').click()`);
    const { body } = await api('/api/propose', { region:'c65', question:'Seen?', options:['Yes', 'No'], suggested:1 });
    await sleep(1200);
    const reading = async () => (await state()).decisions.find(d => d.id === body.id);
    eq([(await reading()).reading, (await reading()).suggested, (await state()).proposals[body.id].openedAt], ['not-opened-default-stands', 'No', null], 'in a hidden record');
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('${body.id}')).then(() => 'ok')`]);
    await sleep(900);
    const first = (await state()).proposals[body.id].openedAt;
    assert(first, 'showing the card did not record it');
    eq((await reading()).reading, 'opened-undecided', 'after showing');
    eq(probe(`JSON.stringify([...document.querySelectorAll('[data-card="${body.id}"] .atl-choice')].findIndex(b => b.querySelector('.atl-rec')))`), 1, 'Recommended on the suggested option');
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('${body.id}')).then(() => 'ok')`]);
    await sleep(600);
    eq((await state()).proposals[body.id].openedAt, first, 'a second showing moved openedAt');
    act(`document.querySelector('[data-choose="${body.id}"][data-i="1"]').click()`);
    await sleep(UNDO_MS + 1500);
    eq([(await reading()).reading, (await state()).log.filter(e => e.kind === 'decision' && e.proposalId === body.id).at(-1)?.verdict], ['kept-as-proposed', 'kept as proposed'], 'after the window');
  });

  await check('proposal: an opening report that fails is kept and retried after recovery, whatever is on screen then', async () => {
    // The first report gets HTTP 500, the next ones a network error; neither may count as recorded.
    act(`(()=>{window.__fetch=window.fetch; window.__opened=0; window.fetch=(u,o)=>String(u).includes('/api/proposal-opened')
      ? (window.__opened++ ? Promise.reject(new TypeError('offline')) : Promise.resolve(new Response('{"ok":false}',{status:500}))) : window.__fetch(u,o)})()`);
    act(`document.querySelector('[data-show="c64"]').click()`);
    const { body } = await api('/api/propose', { region:'c65', question:'Retry?', options:['Yes', 'No'] });
    await sleep(1200);
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('${body.id}')).then(() => 'ok')`]);
    await sleep(500);
    browser(['eval', `import('/atelier.mjs').then(k => k.refresh()).then(() => 'ok')`]);
    await sleep(500);
    assert(probe(`JSON.stringify(window.__opened)`) >= 2, 'no retry while the report kept failing');
    eq((await state()).proposals[body.id].openedAt, null, 'openedAt while every report failed');
    act(`document.querySelector('[data-show="c64"]').click()`);      // the card is off screen when the server is back
    act(`window.fetch = window.__fetch`);
    browser(['eval', `import('/atelier.mjs').then(k => k.refresh()).then(() => 'ok')`]);
    await sleep(800);
    assert((await state()).proposals[body.id].openedAt, 'the failed opening was never recorded after recovery');
    eq((await api('/api/decide', { id: body.id, choiceIndex: 0, attempt: 'retry-1' })).status, 200, 'decide');
    await sleep(UNDO_MS + 1500);
  });

  await check('proposal: a second question cannot displace an open Proposal', async () => {
    eq((await api('/api/propose', { region:'v/list', question:'Replace?', options:['x'] })).status, 409, 'status');
  });

  // ---- hosts ----
  await check('host: an item no host claims lands in the catch-all', async () => {
    const { body } = await api('/api/propose', { region:'loose', question:'Keep the loose Region?', options:['Keep', 'Drop'] });
    await sleep(900);
    eq(probe(`JSON.stringify(!!document.querySelector('atelier-host:not([for]) [data-card="${body.id}"]'))`), true, 'card in the catch-all');
  });

  await check('host: c6 never claims c64, and the longest whole-path prefix wins', async () => {
    writeSurface({ tail:'<atelier-host for="c6"></atelier-host><atelier-host for="v/tbl"></atelier-host><atelier-host></atelier-host>' });
    await reload();
    const row = await threadOf('v/tbl/r2', 'row thread'), rec = await threadOf('c64', 'record thread');
    eq([await hostOf(row.id), await hostOf(rec.id)], ['v/tbl', 'c64'], 'hosts');
    writeSurface();
    await reload();
  });

  await check('host: kernel buttons inside an author <form> never submit it', async () => {
    try {
      writeSurface();
      const html = fs.readFileSync(path.join(dir, 'surface.html'), 'utf8');
      fs.writeFileSync(path.join(dir, 'surface.html'), html.replace('<atelier-host for="c64"></atelier-host>', '<form action="/submitted"><atelier-host for="c64"></atelier-host></form>'));
      await reload();
      act(`(()=>{window.__submits=0; document.addEventListener('submit', e => { window.__submits++; e.preventDefault() })})()`);
      const rec = await threadOf('c64', 'record thread'), crop = await proposalOf('Crop c64?');
      act(`document.querySelector('[data-open="${rec.id}"]').click()`);
      typeInto(`[data-reply-text="${rec.id}"]`, 'reply inside a form');
      act(`document.querySelector('[data-reply="${rec.id}"]').click()`);
      await sleep(700);
      act(`document.querySelector('[data-choose="${crop.id}"][data-i="1"]').click()`);
      await sleep(700);
      act(`document.querySelector('[data-undo="${crop.id}"]').click()`);
      await sleep(700);
      eq(probe(`JSON.stringify({ submits: window.__submits, untyped: [...document.querySelectorAll('atelier-host button, atelier-activity button, .atl-warnings button, .atl-float')]
        .filter(b => b.getAttribute('type') !== 'button').map(b => b.outerHTML.slice(0, 60)).slice(0, 3) })`), { submits:0, untyped:[] }, 'form submissions, and kernel buttons without type="button"');
      eq([(await state()).replies[rec.id]?.at(-1)?.msg, (await proposalOf('Crop c64?')).status], ['reply inside a form', 'open'], 'reply sent, choice undone');
    } finally { writeSurface(); await reload(); }
  });

  // ---- activity ----
  await check('activity: the drawer groups what waits, what was just chosen, what changed, and Updates', async () => {
    await api('/api/update', { region:'v/beta', title:'Batch finished', body:'six Regions re-rendered' });
    await api('/api/ready', { changed:['v/beta'] });
    await sleep(1200);
    const loose = await proposalOf('Keep the loose Region?');
    act(`document.querySelector('[data-choose="${loose.id}"][data-i="0"]').click()`);
    await sleep(600);
    const s = await state();
    const waiting = Object.values(s.proposals).filter(p => p.status === 'open').length
      + Object.values(s.commentState).filter(c => c.value === 'implemented').length;
    const tools = probe(`JSON.stringify(document.querySelector('atelier-activity .atl-tools').innerText)`);
    assert(tools.includes(`${waiting} waiting for you`), `tools: ${tools}, expected ${waiting}`);
    act(`document.querySelector('[popovertarget=atl-drawer]').click()`);
    const d = probe(`JSON.stringify({ open: document.querySelector('#atl-drawer').matches(':popover-open'), text: document.querySelector('#atl-drawer').innerText })`);
    eq(d.open, true, 'drawer open');
    for (const want of ['waiting for you', 'decide: lazy?', 'just chosen', 'chosen: keep', 'changed since you looked', 'beta', 'updates', 'batch finished'])
      assert(d.text.toLowerCase().includes(want), `drawer lacks "${want}"`);
    eq(probe(`JSON.stringify(document.querySelector('[atl-key=beta]').hasAttribute('atl-changed'))`), true, 'changed marker');
    act(`document.querySelector('#atl-drawer [data-undo="${loose.id}"]').click()`);
    await sleep(600);
    eq((await proposalOf('Keep the loose Region?')).status, 'open', 'Undo from the drawer');
  });

  await check('activity: a waiting item reveals and opens its exact card', async () => {
    const id = (await proposalOf('Lazy?')).id;
    if (!probe(`JSON.stringify(document.querySelector('#atl-drawer').matches(':popover-open'))`)) act(`document.querySelector('[popovertarget=atl-drawer]').click()`);
    act(`document.querySelector('#atl-drawer [data-reveal="${id}"]').click()`);
    await sleep(700);
    eq(probe(`JSON.stringify((()=>{const card=document.querySelector('[data-card="${id}"]'), b=card.getBoundingClientRect();
      return { open: document.querySelector('#atl-drawer').matches(':popover-open'), focus: document.activeElement.closest('[data-card]')?.dataset.card,
        uncovered: card.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) }})())`),
      { open:false, focus:id, uncovered:true }, 'after reveal');
  });

  // A keyboard choice behind the open drawer, or any click the drawer does not light-dismiss on.
  await check('activity: a choice made while the drawer is open shows its Undo, not the drawer', async () => {
    const { body } = await api('/api/propose', { region:'v/fig', question:'Under the drawer?', options:['A', 'B'] });
    await sleep(900);
    act(`document.querySelector('[popovertarget=atl-drawer]').click()`);
    act(`document.querySelector('[data-choose="${body.id}"][data-i="0"]').click()`);
    await sleep(600);
    eq(probe(`JSON.stringify((()=>{const u=document.querySelector('[data-card="${body.id}"] [data-undo]'); u.scrollIntoView({block:'center'}); const b=u.getBoundingClientRect();
      return { open: document.querySelector('#atl-drawer').matches(':popover-open'), uncovered: u.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) }})())`),
      { open:false, uncovered:true }, 'after choosing');
    act(`document.querySelector('[data-card="${body.id}"] [data-undo]').click()`);
    await sleep(600);
  });

  await check('activity: ✓ Seen and Dismiss clear their rows', async () => {
    act(`document.querySelector('[popovertarget=atl-drawer]').click()`);
    act(`document.querySelector('#atl-drawer [data-ack="v/beta"]').click()`);
    await sleep(500);
    act(`document.querySelector('#atl-drawer [data-dismiss]').click()`);
    await sleep(500);
    const s = await state();
    assert(!s.changed['v/beta'], 'ack not stored');
    assert(Object.values(s.updates).every(u => u.dismissedAt), 'update not dismissed');
    act(`document.querySelector('#atl-drawer').hidePopover()`);
  });

  await check('activity: desktop notifications are requested on the first gesture', async () => {
    await reload(1200);
    act(`(()=>{window.__asked=0; Object.defineProperty(Notification,'permission',{get:()=>'default',configurable:true});
      Notification.requestPermission=()=>{window.__asked++; return Promise.resolve('default')}})()`);
    browser(['click', 'h1']);
    await sleep(300);
    eq(probe(`JSON.stringify(window.__asked)`), 1, 'permission requests');
  });

  await check('state: getState and atelier:state list every item and whether it waits', async () => {
    const s = await state(), lazy = await proposalOf('Lazy?'), rec = await threadOf('c64', 'record thread');
    const items = JSON.parse(JSON.parse(browser(['eval', `import('/atelier.mjs').then(k => JSON.stringify(k.getState().items))`])));
    const of = id => items.find(i => i.id === id);
    eq(of(lazy.id), { kind:'proposal', id:lazy.id, region:'v/alpha', status:'open', waiting:true }, 'open Proposal');
    eq(of(rec.id), { kind:'thread', id:rec.id, region:'c64', status:'open', waiting:false }, 'Thread');
    eq(items.filter(i => i.kind === 'update').length, Object.keys(s.updates).length, 'Updates');
  });

  // ---- ready ----
  await check('ready: swaps only the named Region and keeps draft, caret, focus, scroll and anchors', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    act(`(()=>{document.querySelector('[data-open="${c.id}"]')?.click(); scrollTo(0, 400); window.__noReload=true;
      const t=document.querySelector('[data-reply-text="${c.id}"]'); t.focus({preventScroll:true}); t.value='half typed'; t.setSelectionRange(4,4)})()`);
    const before = probe(`JSON.stringify({ y: scrollY, beta: document.querySelector('[atl-key=beta]').innerHTML })`);
    writeSurface({ alpha:'the quick brown fox jumps over the lazy dog, edited' });
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1500);
    const after = probe(`JSON.stringify({ reload: !window.__noReload, y: scrollY, text: document.querySelector('#alpha-body').textContent,
      beta: document.querySelector('[atl-key=beta]').innerHTML, focused: document.activeElement.dataset.replyText,
      draft: document.activeElement.value, caret: document.activeElement.selectionStart,
      anchored: [...CSS.highlights.get('atl-active')].concat([...CSS.highlights.get('atl-anchor')]).some(r=>r.toString()==='brown fox'),
      changed: document.querySelector('[atl-key=alpha]').hasAttribute('atl-changed') })`);
    eq(after.reload, false, 'page reloaded');
    assert(after.text.endsWith('edited'), 'Region not swapped');
    eq(after.beta, before.beta, 'unnamed Region changed');
    assert(Math.abs(after.y - before.y) <= 2, `scroll moved ${before.y} → ${after.y}`);
    eq([after.focused, after.draft, after.caret, after.anchored, after.changed], [c.id, 'half typed', 4, true, true], 'preserved state');
  });

  await check('ready: a swapped record redraws its host, and the page keeps its selection', async () => {
    act(`document.querySelector('[data-show=c65]').click()`);
    writeSurface({ alpha:'the quick brown fox jumps over the lazy dog, edited', extra:'' });
    const html = fs.readFileSync(path.join(dir, 'surface.html'), 'utf8').replace('c65 body', 'c65 body, edited');
    fs.writeFileSync(path.join(dir, 'surface.html'), html);
    await api('/api/ready', { changed:['c65'] });
    await sleep(1500);
    const pr = await proposalOf('Ship c65 as is?');
    eq(probe(`JSON.stringify({ body: document.querySelector('[atl-key=c65] p').textContent, shown: !document.querySelector('[atl-key=c65]').hidden,
      card: !!document.querySelector('atelier-host[for=c65] [data-slot="${pr.id}"]') })`), { body:'c65 body, edited', shown:true, card:true }, 'after Ready');
    act(`document.querySelector('[data-show=c64]').click()`);
  });

  await check('ready: an event that arrives while the page refreshes is not skipped', async () => {
    act(`(()=>{const f=window.fetch; window.__fetch=f; window.fetch=(u,o)=>String(u).startsWith('/api/state') && !o?.method
      ? new Promise(r=>setTimeout(r,800)).then(()=>f(u,o)) : f(u,o)})()`);
    writeSurface({ alpha:'alpha after the first Ready', beta:'beta after the second Ready' });
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(250);
    await api('/api/ready', { changed:['v/beta'] });
    await sleep(2500);
    act(`window.fetch = window.__fetch`);
    eq(probe(`JSON.stringify([document.querySelector('#alpha-body').textContent, document.querySelector('[atl-key=beta] p').textContent])`),
      ['alpha after the first Ready', 'beta after the second Ready'], 'both Readys applied');
    writeSurface();
    await api('/api/ready', { changed:['v/alpha', 'v/beta'] });
    await sleep(1200);
  });

  await check('ready: a Ready whose page fetch fails is applied on a later try, not dropped', async () => {
    act(`(()=>{const f=window.fetch; window.__fetch=f; let n=0; window.fetch=(u,o)=>String(u)!==location.pathname || n>1 ? f(u,o)
      : n++ ? Promise.resolve(new Response('busy',{status:503})) : Promise.reject(new TypeError('Failed to fetch'))})()`);
    writeSurface({ beta:'beta after two failed fetches' });
    await api('/api/ready', { changed:['v/beta'] });
    await sleep(7500);
    act(`window.fetch = window.__fetch`);
    eq(probe(`JSON.stringify(document.querySelector('[atl-key=beta] p').textContent)`), 'beta after two failed fetches', 'Region after the retries');
    writeSurface();
    await api('/api/ready', { changed:['v/beta'] });
    await sleep(1200);
  });

  await check('ready: an anchor whose text is gone says so and fails preflight', async () => {
    writeSurface({ alpha:'a sentence without the fox' });
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1500);
    const c = await threadOf('v/alpha', 'selection thread');
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    assert((await cardText(c.id)).includes('has changed'), 'no detached note');
    const result = preflight();
    assert(result.status === 1 && /no longer find their target/.test(result.out), `preflight: ${result.status} ${result.out.slice(0, 400)}`);
    writeSurface();
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1200);
  });

  await check('ready: an unknown Region key warns on the page until a good Ready', async () => {
    await api('/api/ready', { changed:['v/nope'] });
    await sleep(1200);
    assert(probe(`JSON.stringify(document.querySelector('.atl-warnings')?.textContent || '')`).includes('v/nope'), 'no warning');
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1200);
    eq(probe(`JSON.stringify(!!document.querySelector('.atl-warnings'))`), false, 'warning did not clear');
  });

  await check('ready: a Region new to the page reloads and keeps unsent Threads', async () => {
    altClick(`document.querySelector('[atl-key=beta] h2')`);
    await sleep(200);
    act(`(()=>{const t=document.querySelector('atelier-host [data-new]'); t.value='survives reload'; t.dispatchEvent(new Event('input',{bubbles:true})); window.__noReload=true})()`);
    writeSurface({ extra:'<section atl-key="gamma"><h2>Gamma</h2><p>new</p></section>' });
    await api('/api/ready', { changed:['v/gamma'] });
    await sleep(2200);
    eq(probe(`JSON.stringify({ reload: !window.__noReload, gamma: !!document.querySelector('[atl-key=gamma]'), draft: document.querySelector('atelier-host [data-new]')?.value })`),
      { reload:true, gamma:true, draft:'survives reload' }, 'after structural Ready');
    act(`document.querySelector('atelier-host [data-discard]').click()`);
    writeSurface();
    await reload();
  });

  // ---- phones ----
  await check('phone: 390×844 has no horizontal overflow, and the anchored host flows under its content', async () => {
    viewport(390, 844);
    await reload();
    eq(probe(`JSON.stringify({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      aligned: document.querySelector('atelier-host[for=v]').hasAttribute('atl-aligned') })`), { overflow:false, aligned:false }, 'at 390');
    viewport(1440, 900);
    await reload();
  });

  // ---- preflight: Node only, no browser (ADR 0007) ----
  await check('preflight: the fixture lints clean and the human is sent to the page, with no screenshot step', async () => {
    const result = preflight();
    assert(result.status === 0, `preflight exited ${result.status}: ${result.out.slice(0, 900)}`);
    for (const line of ['PASS KIT_TAGS', 'PASS REGIONS', 'PASS HOSTS', 'PASS REACH', 'PASS ANCHORS', 'NOT CHECKED (no browser)', 'PREFLIGHT=PASS', `NEXT=Open ${base} for the human`])
      assert(result.out.includes(line), `missing "${line}"`);
    assert(!/visual|screenshot/i.test(result.out.replace(/NOT CHECKED[^\n]*/, '')), 'preflight still asks for a visual step');
  });

  // The kernel still warns on the page; the lint catches the same defects from the source.
  await check('preflight: duplicate hosts, two catch-alls and two Activities fail the lint; the page warns too', async () => {
    try {
      writeSurface({ tail:'<atelier-host for="c64"></atelier-host><atelier-host></atelier-host><atelier-host></atelier-host><atelier-activity></atelier-activity>' });
      await reload();
      assert(probe(`JSON.stringify(document.querySelector('.atl-warnings')?.textContent || '')`).includes('<atelier-host for="c64">'), 'no duplicate-host warning');
      const { status, out } = preflight();
      assert(status === 1, `preflight exited ${status}`);
      for (const want of ['found 2 <atelier-activity>', 'found 2 catch-all', 'for="c64" has several'])
        assert(out.includes(want), `missing "${want}": ${out.slice(0, 500)}`);
    } finally { writeSurface(); await reload(); }
  });

  await check('preflight: an open item no host would show fails', async () => {
    try {
      writeSurface({ tail:'' });
      const unhosted = preflight();
      assert(unhosted.status === 1 && /no host shows prop-\d+ in loose/.test(unhosted.out), `no host: ${unhosted.out.slice(0, 500)}`);
    } finally { writeSurface(); await reload(); }
  });

  await check('preflight: a sentence about the page is a warning naming its Region; subject-UI steps are not', async () => {
    try {
      writeSurface({ extra:`<section atl-key="intro" atl-label="Intro"><p>Six decisions, most dangerous first. Reads switch region by region.</p>
        <p data-subject-ui>Select any sentence, then press Thread.</p></section>` });
      const { status, out } = preflight();
      assert(status === 0 && out.includes('WARN PROSE: 1 sentence') && !out.includes('FAIL PROSE'), `preflight: ${status} ${out.slice(0, 400)}`);
      assert(out.includes('"Six decisions, most dangerous first." (Region v/intro;'), 'the offending sentence and its Region are not listed');
      assert(out.includes('Repair:') && !out.includes('Reads switch') && !out.includes('Select any'), 'wrong sentences listed or no repair text');
    } finally {
      writeSurface();
    }
  });

  // ---- resilience ----
  await check('resilience: a malformed request body is rejected without killing the server', async () => {
    const bad = await api('/api/propose', { region:'', question:'', options:[] });
    eq(bad.status, 400, 'status for a malformed body');
    assert((await fetch(base + '/api/state')).ok, 'server died on a bad request');
  });

  await check('resilience: a deleted store directory does not kill the server', async () => {
    await fsp.rm(path.join(dir, '.review'), { recursive:true, force:true });
    await api('/api/ack', { region:'v/alpha' });
    await sleep(400);
    assert((await fetch(base + '/api/state')).ok, 'server died after its store directory vanished');
    assert(fs.existsSync(path.join(dir, '.review', 'verify.json')), 'store was not recreated');
  });

  await check('resilience: an aborted long-poll does not kill the server', async () => {
    await Promise.all([1,2,3].map(async () => {
      const controller = new AbortController();
      const request = fetch(`${base}/api/poll?cursor=999999`, { signal:controller.signal }).catch(()=>{});
      setTimeout(()=>controller.abort(), 150);
      await request;
    }));
    await sleep(300);
    assert((await fetch(base + '/api/state')).ok, 'server died on aborted polls');
  });

  await check('resilience: the page says so when the server goes away, and recovers', async () => {
    await reload(1200);
    await stopServer();
    await sleep(4200);                                  // the poll loop backs off for 3s before retrying
    eq(probe(`JSON.stringify(document.documentElement.hasAttribute('data-atl-offline'))`), true, 'no offline state while the server was down');
    startServer(port, dir);
    await waitForServer(base);
    await sleep(4200);
    eq(probe(`JSON.stringify(document.documentElement.hasAttribute('data-atl-offline'))`), false, 'offline state stuck after the server returned');
  });

  // ---- building blocks (assets/atelier-blocks.mjs) ----
  // On their own page in the same fixture directory, after every preflight check: Threads made here
  // would otherwise be stored anchors that surface.html cannot resolve. A collapsible catch-all host
  // beside the content stands in for a side panel of Threads.
  const blocksPage = (claim = 'Kernel placement failed twice.', open = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>blocks</title>
<link rel="stylesheet" href="/atelier.css"><link rel="stylesheet" href="/atelier-blocks.css">
<script type="module" src="/atelier.mjs"></script><script type="module" src="/atelier-blocks.mjs"></script>
<style>body{font-family:system-ui;margin:0}.page{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px;padding:16px}</style></head><body>
<header><b>Blocks</b><atelier-activity></atelier-activity></header>
<div class="page"><main><section atl-key="b">
  <atelier-claims${open ? ` open="${open}"` : ''}>
    <section atl-key="kernel"><p>The kernel owns state and protocol.</p>
      <section atl-key="why"><p>${claim}</p><p>P4 stacked cards above the content.</p></section>
      <section atl-key="cost"><p>Every Surface lays itself out.</p></section>
    </section>
    <section atl-key="eval"><p>Real-task trials decide the next version.</p></section>
  </atelier-claims>
  <section atl-key="media">
    <atelier-video src="/missing.mp4"><script type="text/plain">
      0:00 Hook: twenty-five cards fan out
      0:03.5 The guest scans the QR code
    </script></atelier-video>
    <atelier-compare caption="The draft gains a headline."><div id="before-side">Draft without headline</div><div>Draft with headline</div></atelier-compare>
    <atelier-mock frame="browser" w="600" url="app.test" alt="The composer with a Send later button."><template><style>button{padding:8px}</style><button id="later">Send later</button></template></atelier-mock>
  </section>
  <section atl-key="cdn">
    <atelier-mermaid alt="Draft build, then HIGH build."><script type="text/plain">
      flowchart LR
        draft[Draft build] --> high[HIGH build]
    </script></atelier-mermaid>
    <atelier-chart alt="Two points."><script type="text/plain">{"data":{"values":[{"x":1,"y":2},{"x":2,"y":3}]},"mark":"line","encoding":{"x":{"field":"x","type":"quantitative"},"y":{"field":"y","type":"quantitative"}}}</script></atelier-chart>
    <atelier-file lang="js" name="limit.js"><script type="text/plain">
      export function limit(n) {
        if (n >= 50) throw new LimitError(50);
      }
    </script></atelier-file>
    <atelier-chart alt="Broken."><script type="text/plain">{"mark": "line", "encoding": {"x": {"field": "x"}}, "data": {"url": "/nope.json"}, "transform": [{"calculate": "(", "as": "z"}]}</script></atelier-chart>
  </section>
</section></main><atelier-host layout="anchored" collapsible></atelier-host></div></body></html>`;
  const writeBlocks = (...a) => fs.writeFileSync(path.join(dir, 'surface.html'), blocksPage(...a));
  const until = async (js, what, ms = 6000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (probe(`JSON.stringify(${js})`)) return;
    throw new Error(`timed out waiting for ${what}`);
  };

  await check('blocks: claims are numbered and folded, and the closed tree is the list of top claims', async () => {
    writeBlocks();
    browser(['reload']); await sleep(1500);
    const t = probe(`JSON.stringify({ rendered: document.querySelector('atelier-claims').dataset.rendered,
      numbers: [...document.querySelectorAll('atelier-claims [atl-key]')].map(r => { const ks = []; for (let e = r; e; e = e.parentElement?.closest('[atl-key]')) ks.unshift(e.getAttribute('atl-key')); return r.dataset.claim + ' ' + ks.join('/'); }),
      open: [...document.querySelectorAll('details.atl-claim')].filter(d => d.open).length,
      visible: [...document.querySelectorAll('.atl-claim-head')].filter(h => h.checkVisibility()).map(h => h.innerText.replace(/\\s+/g, ' ').trim()) })`);
    eq(t.rendered, 'true', 'tree marked rendered');
    eq(t.numbers, ['1 b/kernel', '1.1 b/kernel/why', '1.2 b/kernel/cost', '2 b/eval'], 'claim numbers and Region Keys');
    eq(t.open, 0, 'claims open at start');
    eq(t.visible, ['1 The kernel owns state and protocol.', '2 Real-task trials decide the next version.'], 'closed tree');
  });

  await check('blocks: a Thread inside a folded claim is revealed, and a Ready keeps the claim open and numbered', async () => {
    await api('/api/state', { threads: { ...(await state()).threads, 'b/kernel/why': [{ id: 'c-claim', text: 'claim thread', anchor: { region: 'b/kernel/why', quote: 'stacked cards' } }] } });
    await api('/api/send', { region: 'b/kernel/why', id: 'c-claim' });
    await until(`!!document.querySelector('[data-slot="c-claim"]')`, 'the Thread card');
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('c-claim')).then(() => 'ok')`]);
    await sleep(600);
    eq(probe(`JSON.stringify([...document.querySelectorAll('[atl-key=kernel] > details, [atl-key=why] > details')].map(d => d.open))`), [true, true], 'path to the anchor opened');
    act(`window.__noReload = true`);
    writeBlocks('Kernel placement failed twice, in P4 and P7.');
    await api('/api/ready', { changed: ['b/kernel/why'] });
    await until(`document.querySelector('[atl-key=why] .atl-claim-head')?.innerText.includes('P4 and P7')`, 'the swapped claim');
    await sleep(300);
    const t = probe(`JSON.stringify({ reload: !window.__noReload, no: document.querySelector('[atl-key=why]').dataset.claim,
      open: document.querySelector('[atl-key=why] > details').open, head: document.querySelector('[atl-key=why] .atl-claim-head').innerText,
      anchored: [...CSS.highlights.get('atl-anchor'), ...CSS.highlights.get('atl-active')].some(r => r.toString() === 'stacked cards') })`);
    eq([t.reload, t.no, t.open, t.anchored], [false, '1.1', true, true], 'after Ready');
    assert(t.head.includes('P4 and P7'), `new claim text: ${t.head}`);
  });

  await check('blocks: video marks seek, compare and mock render, and a Thread anchors a point on a mockup', async () => {
    const t = probe(`JSON.stringify({ states: [...document.querySelectorAll('atelier-video, atelier-compare, atelier-mock')].map(e => e.localName + ':' + e.dataset.rendered),
      marks: [...document.querySelectorAll('.atl-b-marks li')].map(l => l.dataset.t + ' ' + l.innerText.trim()),
      sides: [...document.querySelectorAll('.atl-b-side')].map(f => f.innerText.replace(/\\s+/g, ' ').trim()),
      shadow: !!document.querySelector('atelier-mock .atl-b-stage').shadowRoot.querySelector('#later'),
      stage: Math.round(document.querySelector('atelier-mock .atl-b-stage').getBoundingClientRect().height) })`);
    eq(t.states, ['atelier-video:true', 'atelier-compare:true', 'atelier-mock:true'], 'rendered');
    eq(t.marks, ['0 0:00 Hook: twenty-five cards fan out', '3.5 0:03.5 The guest scans the QR code'], 'marks');
    eq(t.sides, ['BEFORE Draft without headline', 'AFTER Draft with headline'], 'compare sides');
    assert(t.shadow && t.stage > 20, `mock: ${JSON.stringify(t)}`);
    act(`document.querySelectorAll('.atl-b-seek')[1].click()`);
    eq(probe(`JSON.stringify(document.querySelector('atelier-video video').currentTime)`), 3.5, 'seek');
    altClick(`document.querySelector('atelier-mock .atl-b-stage')`, 0.25, 0.5);
    await sleep(200);
    await typeNewAndSend('mock thread');
    const c = await threadOf('b/media', 'mock thread');
    assert(c?.anchor?.point && Math.abs(c.anchor.point.x - 0.25) < 0.02, `mock anchor ${JSON.stringify(c?.anchor)}`);
  });

  await check('blocks-cdn: Mermaid, Vega-Lite and the file viewer draw from pinned versions; a broken spec shows its error', async () => {
    let t;
    for (let i = 0; i < 40; i++) {
      t = probe(`JSON.stringify({ states: [...document.querySelectorAll('atelier-mermaid, atelier-chart, atelier-file')].map(e => e.localName + ':' + (e.dataset.rendered || '')),
        node: !!document.querySelector('atelier-mermaid svg g.node'), chart: !!document.querySelector('atelier-chart svg'),
        lines: document.querySelectorAll('atelier-file .line').length, error: document.querySelector('.atl-b-error')?.textContent.slice(0, 40) || '' })`);
      if (t.states.every(s => !s.endsWith(':'))) break;
      await sleep(500);
    }
    eq(t.states, ['atelier-mermaid:true', 'atelier-chart:true', 'atelier-file:true', 'atelier-chart:error'], 'block states');
    assert(t.node && t.chart && t.lines === 3 && t.error.startsWith('atelier-chart'), JSON.stringify(t));
    altClick(`document.querySelectorAll('atelier-mermaid svg g.node')[1]`);
    await sleep(200);
    await typeNewAndSend('mermaid box thread');
    eq((await threadOf('b/cdn', 'mermaid box thread'))?.anchor?.selector, ':scope g.node[id*="-flowchart-high-"]', 'Mermaid box anchored by name');
  });

  await check('blocks-cdn: a Thread on two lines of a file view stays resolved across a Ready', async () => {
    act(`(()=>{const pre=document.querySelector('atelier-file pre'), w=document.createTreeWalker(pre, NodeFilter.SHOW_TEXT), r=document.createRange(); let n, a, b;
      while ((n = w.nextNode())) { if (!a && n.data.includes('limit')) a = n; if (n.data.includes('throw')) { b = n; break; } }
      r.setStart(a, a.data.indexOf('limit')); r.setEnd(b, b.data.indexOf('throw') + 5);
      getSelection().removeAllRanges(); getSelection().addRange(r); pre.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})()`);
    await sleep(150);
    act(`document.querySelector('.atl-float').click()`);
    await sleep(200);
    await typeNewAndSend('two-line thread');
    const c = await threadOf('b/cdn', 'two-line thread');
    assert(c?.anchor?.quote?.includes('\n') && c.anchor.quote.includes('throw'), `quote ${JSON.stringify(c?.anchor?.quote)}`);
    const resolved = () => probe(`JSON.stringify([...CSS.highlights.get('atl-anchor'), ...CSS.highlights.get('atl-active')].some(r => r.toString() === ${JSON.stringify(c.anchor.quote)}))`);
    eq(resolved(), true, 'resolved before the Ready');
    writeBlocks();
    await api('/api/ready', { changed: ['b/cdn'] });
    await until(`document.querySelector('atelier-file')?.dataset.rendered === 'true'`, 'the file view after the Ready');
    await sleep(500);
    eq(resolved(), true, 'resolved after the Ready');
    eq(probe(`JSON.stringify([...document.querySelectorAll('atelier-file .line')].map(l => Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight))))`), [1, 1, 1], 'rows per line (a kept newline must not add a blank row)');
  });

  await check('blocks: a claim the human closed stays closed across a Ready, even within the open depth', async () => {
    writeBlocks(undefined, '2');
    browser(['reload']); await sleep(1500);
    const isOpen = () => probe(`JSON.stringify(document.querySelector('[atl-key=why] > details').open)`);
    eq(isOpen(), true, 'claim within open="2" at start');
    act(`document.querySelector('[atl-key=why] > details > summary').click()`);
    await sleep(200);
    eq(isOpen(), false, 'claim after the human closed it');
    writeBlocks('Kernel placement failed three times.', '2');
    await api('/api/ready', { changed: ['b/kernel/why'] });
    await until(`document.querySelector('[atl-key=why] .atl-claim-head')?.innerText.includes('three times')`, 'the swapped claim');
    await sleep(300);
    eq(isOpen(), false, 'closed claim after a Ready');
    eq(probe(`JSON.stringify(document.querySelector('[atl-key=cost] > details').open)`), true, 'an unseen claim still opens to the initial depth');
  });

  // ---- the 2026-10-06 verdict: German chrome, folding margin, tabs, and the new blocks ----
  const kitPage = () => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>kit</title>
<link rel="stylesheet" href="/atelier.css"><link rel="stylesheet" href="/atelier-blocks.css">
<script type="module" src="/atelier.mjs"></script><script type="module" src="/atelier-blocks.mjs"></script></head><body>
<header class="atl-top"><span>Kit</span><atelier-activity></atelier-activity></header>
<div class="atl-page"><main><section atl-key="k">
  <atelier-tabs>
    <section atl-key="one" atl-label="Eins">
      <atelier-findings><script type="text/plain">
        disliked: Das Video ist viel zu klein.
        gap: Die Reihenfolge der Prüfungen fehlt.
      </script></atelier-findings>
      <atelier-decision><script type="text/plain">
        ? Wie groß soll das Video sein?
        * A · Groß, mit Umschalter
          + man sieht die Details
        - B · Klein
          - man erkennt nichts
      </script></atelier-decision>
    </section>
    <section atl-key="two" atl-label="Zwei">
      <atelier-flow><script type="text/plain">
        S0 Backlog: Konzepte kommen aus der Matrix.
        S5 Prüfung: Die Endprüfung läuft auf dem Master.
          Ton: läuft bis zum Ende.
          Standbild: 87 bestanden.
          || Gefühltes Standbild: 50 bestanden.
      </script></atelier-flow>
      <atelier-video src="/a.mp4" label="Erster Schnitt"><script type="text/plain">0:00 Haken</script></atelier-video>
      <atelier-video src="/b.mp4" label="Zweiter Schnitt"><script type="text/plain">0:00 Haken</script></atelier-video>
      <atelier-timeline><script type="text/plain">
        Runde 0 · erster Master
          > Judge: Der Haken ist zu dunkel.
        Runde 1 · abgenommen
      </script></atelier-timeline>
    </section>
  </atelier-tabs>
</section></main><atelier-host layout="anchored" collapsible></atelier-host></div></body></html>`;

  await check('kit: German chrome, findings and decision under lang="de"; every option shows its own context', async () => {
    fs.writeFileSync(path.join(dir, 'surface.html'), kitPage());
    browser(['eval', `localStorage.removeItem('atelier:hosts'); 'ok'`]);
    browser(['reload']); await sleep(1500);
    const t = probe(`JSON.stringify({ pick: document.querySelector('atelier-activity [data-pick]').getAttribute('aria-label'),
      fold: document.querySelector('atelier-activity [data-fold]').getAttribute('aria-label'),
      tags: [...document.querySelectorAll('.atl-b-tag')].map(e => e.textContent + ':' + getComputedStyle(e).display),
      options: [...document.querySelectorAll('.atl-b-opt')].map(o => o.innerText.replace(/\\s+/g, ' ').trim()) })`);
    eq([t.pick, t.fold], ['Etwas kommentieren (oder Alt gedrückt halten und klicken)', 'Threads ausblenden'], 'German chrome');
    eq(t.tags, ['Stört:inline-block', 'Lücke:inline-block'], 'inline German finding labels');
    eq(t.options, ['A · Groß, mit Umschalter Empfohlen man sieht die Details', 'B · Klein man erkennt nichts'], 'options with their context inside');
  });

  await check('kit: a collapsible host folds and reserves no width, and opening a card unfolds it', async () => {
    const width = () => probe(`JSON.stringify(Math.round(document.querySelector('.atl-page > main').getBoundingClientRect().width))`);
    const before = width();
    act(`document.querySelector('atelier-activity [data-fold]').click()`);
    await sleep(200);
    const folded = probe(`JSON.stringify({ shown: getComputedStyle(document.querySelector('atelier-host[collapsible]')).display, page: Math.round(document.querySelector('.atl-page').getBoundingClientRect().width) })`);
    eq(folded.shown, 'none', 'host display when folded');
    assert(width() >= folded.page - 60, `main is ${width()} of ${folded.page} px when folded (was ${before})`);
    altClick(`document.querySelector('.atl-b-q')`);
    await sleep(300);
    eq(probe(`JSON.stringify(getComputedStyle(document.querySelector('atelier-host[collapsible]')).display)`), 'block', 'host after opening a new Thread');
    act(`document.querySelector('atelier-host [data-discard]').click()`);
  });

  await check('kit: tabs show one Region, and revealing a Thread in a hidden tab switches to it', async () => {
    const shown = () => probe(`JSON.stringify([...document.querySelectorAll('atelier-tabs > [atl-key]')].filter(r => r.checkVisibility()).map(r => 'k/' + r.getAttribute('atl-key')))`);
    eq(shown(), ['k/one'], 'visible tab at start');
    await api('/api/state', { threads: { ...(await state()).threads, 'k/two': [{ id: 'c-tab', text: 'tab thread', anchor: { region: 'k/two', quote: '87 bestanden' } }] } });
    await api('/api/send', { region: 'k/two', id: 'c-tab' });
    await until(`!!document.querySelector('[data-slot="c-tab"]')`, 'the Thread card');
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('c-tab')).then(() => 'ok')`]);
    await sleep(600);
    eq(shown(), ['k/two'], 'visible tab after reveal');
    eq(probe(`JSON.stringify({ sel: document.querySelector('.atl-b-node.is-sel')?.textContent, open: document.querySelector('.atl-b-fnode.is-sel')?.open })`),
      { sel: 'Standbild', open: true }, 'the flow selected the revealed node');
  });

  await check('kit: the flow zooms by level and marks parallel steps; sibling videos show one at a time', async () => {
    act(`document.querySelector('.atl-b-crumbs [data-zoom=""]').click()`);
    const lane = () => probe(`JSON.stringify([...document.querySelectorAll('.atl-b-step')].map(s => (s.classList.contains('is-parallel') ? '‖ ' : '') + [...s.querySelectorAll('.atl-b-node')].map(n => n.textContent).join(' + ')))`);
    eq(lane(), ['S0 Backlog', 'S5 Prüfung 3 ›'], 'overview');
    act(`[...document.querySelectorAll('.atl-b-node')].find(n => n.textContent.startsWith('S5')).click()`);
    eq(lane(), ['Ton', '‖ Standbild + Gefühltes Standbild'], 'stage level');
    const v = probe(`JSON.stringify({ open: [...document.querySelectorAll('.atl-b-vgroup')].map(d => d.open), big: Math.round(document.querySelector('.atl-b-video').getBoundingClientRect().width) })`);
    eq(v.open, [true, false], 'video group');
    act(`document.querySelectorAll('.atl-b-vgroup > summary')[1].click()`);
    await sleep(200);
    eq(probe(`JSON.stringify([...document.querySelectorAll('.atl-b-vgroup')].map(d => d.open))`), [false, true], 'video group after opening the second');
    act(`document.querySelectorAll('.atl-b-size')[1].click()`);
    const small = probe(`JSON.stringify(Math.round(document.querySelectorAll('.atl-b-video')[1].getBoundingClientRect().width))`);
    assert(small <= 360 && v.big > 400, `video widths: large ${v.big}, small ${small}`);
    eq(probe(`JSON.stringify(document.querySelector('.atl-b-said').innerText.replace(/\\s+/g, ' '))`), 'JUDGE Der Haken ist zu dunkel.', 'timeline comment');
  });

} finally {
  try { browser(['close']); } catch {}
  await stopServer();
  await fsp.rm(dir, { recursive:true, force:true });
}

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
