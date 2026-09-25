#!/usr/bin/env node
// Atelier kernel verification — every kernel behavior, checked in a real browser.
//
//   node scripts/verify.mjs            all checks
//   node scripts/verify.mjs ready      only checks whose name contains "ready"
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

// ---- fixture -------------------------------------------------------------------------
// Deliberately library-free: verification must not depend on a CDN being reachable. The layout
// is the contract every Surface follows: a header holding <atelier-activity>, the content, and one
// <atelier-margin> outside every Region.
const surface = (alpha = 'the quick brown fox jumps over the lazy dog', extra = '', flow = ['draft-0', 'high-1']) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>verify</title>
<link rel="stylesheet" href="/atelier.css">
<script type="module" src="/atelier.mjs"></script>
<style>
  body{font-family:system-ui;margin:0}
  header{position:sticky;top:0;z-index:20;display:flex;gap:12px;align-items:center;padding:8px 16px;background:#fff;border-bottom:1px solid #ccc}
  .page{display:grid;grid-template-columns:minmax(0,1fr) clamp(340px,32vw,520px);gap:24px;padding:16px 24px}
  @media (max-width:1100px){.page{grid-template-columns:minmax(0,1fr)}}
</style>
</head><body>
<header><b>Verify</b><atelier-activity></atelier-activity></header>
<div class="page"><main>
<atelier-region key="v">
  <h1>Verify</h1>
  <atelier-region key="alpha" label="Alpha"><h2>Alpha</h2><p id="alpha-body">${alpha}</p><div style="height:900px"></div></atelier-region>
  <atelier-region key="list" label="List"><ul><li>first item</li><li>second item</li><li>third item</li></ul><div style="height:600px"></div></atelier-region>
  <atelier-region key="fig" label="Figure"><svg id="fig-svg" width="400" height="200" viewBox="0 0 400 200" style="max-width:100%"><rect width="400" height="200" fill="#eee"/></svg>
    <svg id="flow-svg" width="400" height="60" viewBox="0 0 400 60" style="max-width:100%">${flow.map((n, i) => `<g class="node" id="mermaid-${Date.now()}-flowchart-${n}" transform="translate(${10 + i * 130},10)"><rect width="110" height="40" fill="#ddd"/><text x="10" y="25">${n.split('-')[0]}</text></g>`).join('')}</svg><div style="height:600px"></div></atelier-region>
  <atelier-region key="beta" label="Beta"><h2>Beta</h2><p>beta body</p><div style="height:600px"></div></atelier-region>
  <atelier-region key="late" label="Late"><details id="late-box"><summary>file</summary><div id="late-view"></div></details></atelier-region>
${extra}</atelier-region>
</main><atelier-margin></atelier-margin></div>
<script>setTimeout(() => { document.querySelector('#late-view').textContent = 'rendered late by a viewer';
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
    env: { ...process.env, PORT:String(port), HOST:'127.0.0.1', UI:'surface.html', ROOT:'.', STORE:'verify' },
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
const writeSurface = (...args) => fs.writeFileSync(path.join(dir, 'surface.html'), surface(...args));
const state = async () => (await fetch(base + '/api/state')).json();
const threadOf = async (region, text) => ((await state()).threads[region] || []).find(c => c.text === text);
// Top of a margin card and of its anchor, in page coordinates.
const tops = (id, anchorJs) => probe(`JSON.stringify({ card: Math.round(document.querySelector('[data-slot="${id}"]').getBoundingClientRect().top),
  anchor: Math.round((${anchorJs}).getBoundingClientRect().top) })`);
const level = (t, what) => assert(Math.abs(t.card - t.anchor) <= 2, `${what}: card at ${t.card}, anchor at ${t.anchor}`);
const typeNewAndSend = async (text) => {
  act(`(()=>{const t=document.querySelector('atelier-margin [data-new]'); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('atelier-margin [data-send]').click()})()`);
  await sleep(700);
};
const altClick = (js, fx = 0.5, fy = 0.5) => act(`(()=>{const el=${js}; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,altKey:true,clientX:r.left+r.width*${fx},clientY:r.top+r.height*${fy}}))})()`);

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
  await check('regions: path keys come from ancestors', async () => {
    eq(probe(`JSON.stringify([...document.querySelectorAll('atelier-region')].map(e=>e.regionKey))`),
      ['v','v/alpha','v/list','v/fig','v/beta','v/late'], 'region keys');
  });

  await check('regions: the kernel inserts nothing into authored content', async () => {
    const injected = probe(`JSON.stringify([...document.querySelectorAll('atelier-region *')]
      .filter(e => /^ATELIER-(?!REGION)/.test(e.tagName) || [...e.classList].some(c => /^atl-(bar|card|slot|compose|input|float)/.test(c)))
      .map(e => e.tagName + '.' + e.className))`);
    eq(injected, [], 'kernel nodes inside Regions');
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

  await check('anchor: the margin card sits level with its text', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    const t = probe(`JSON.stringify((()=>{const r=[...CSS.highlights.get('atl-anchor'), ...CSS.highlights.get('atl-active')].find(r=>r.toString()==='brown fox');
      return { card: Math.round(document.querySelector('[data-slot="${c.id}"]').getBoundingClientRect().top), anchor: Math.round(r.getBoundingClientRect().top) }})())`);
    level(t, 'selection card');
  });

  await check('anchor: Alt+click anchors an element', async () => {
    altClick(`document.querySelectorAll('atelier-region[key=list] li')[1]`);
    await sleep(200);
    await typeNewAndSend('element thread');
    const c = await threadOf('v/list', 'element thread');
    assert(c?.anchor?.selector, 'no selector stored');
    eq(probe(`JSON.stringify(document.querySelector('atelier-region[key=list]').querySelector(${JSON.stringify(c.anchor.selector)}).textContent)`), 'second item', 'selector target');
    level(tops(c.id, `document.querySelectorAll('atelier-region[key=list] li')[1]`), 'element card');
  });

  await check('anchor: Pick mode anchors without Alt, and Escape leaves it', async () => {
    act(`document.querySelector('atelier-activity [data-pick]').click()`);
    eq(probe(`JSON.stringify(document.documentElement.classList.contains('atl-picking'))`), true, 'pick mode on');
    act(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    eq(probe(`JSON.stringify(document.documentElement.classList.contains('atl-picking'))`), false, 'Escape left pick mode');
    act(`document.querySelector('atelier-activity [data-pick]').click()`);
    act(`document.querySelectorAll('atelier-region[key=list] li')[2].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    await sleep(200);
    eq(probe(`JSON.stringify(!!document.querySelector('atelier-margin [data-new]'))`), true, 'composer opened');
    act(`document.querySelector('atelier-margin [data-discard]').click()`);
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
    writeSurface(undefined, undefined, ['concept-0', 'draft-1', 'high-2']);
    await api('/api/ready', { changed:['v/fig'] });
    await sleep(1500);
    eq(probe(`JSON.stringify(document.querySelector('#flow-svg .atl-el-anchor, #flow-svg .atl-el-active')?.textContent)`), 'high', 'anchored box after Ready');
    writeSurface();
    await api('/api/ready', { changed:['v/fig'] });
    await sleep(1200);
  });

  await check('anchor: text a viewer renders late resolves, and revealing it opens its details', async () => {
    await api('/api/state', { threads: { ...(await state()).threads, 'v/late': [{ id: 'c-late', text: 'late thread', anchor: { region: 'v/late', quote: 'rendered late' } }] } });
    await api('/api/send', { region: 'v/late', id: 'c-late' });
    browser(['reload']); await sleep(1800);
    const hl = probe(`JSON.stringify([...CSS.highlights.get('atl-anchor')].map(r => r.toString()))`);
    assert(hl.includes('rendered late'), `highlights: ${JSON.stringify(hl)}`);
    eq(probe(`JSON.stringify(document.querySelector('#late-box').open)`), false, 'details open before reveal');
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('c-late')).then(() => 'ok')`]);
    await sleep(500);
    eq(probe(`JSON.stringify(document.querySelector('#late-box').open)`), true, 'details open after reveal');
  });

  await check('anchor: ⌘+Enter sends a new Thread', async () => {
    altClick(`document.querySelector('atelier-region[key=beta] p')`);
    await sleep(300);
    act(`(()=>{const t=document.querySelector('atelier-margin [data-new]'); t.value='keyboard thread'; t.focus()})()`);
    browser(['press', 'Meta+Enter']);
    await sleep(800);
    assert(await threadOf('v/beta', 'keyboard thread'), 'not sent by ⌘+Enter');
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

  await check('thread: an unsent new Thread survives a reload', async () => {
    altClick(`document.querySelector('atelier-region[key=beta] h2')`);
    await sleep(200);
    act(`(()=>{const t=document.querySelector('atelier-margin [data-new]'); t.value='draft kept'; t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    browser(['reload']); await sleep(1300);
    assert(probe(`JSON.stringify(document.querySelector('atelier-margin').innerText)`).includes('✎ draft kept'), 'unsent Thread not listed after reload');
    act(`[...document.querySelectorAll('atelier-margin [data-open]')].find(b=>b.innerText.includes('draft kept')).click()`);
    eq(probe(`JSON.stringify(document.querySelector('atelier-margin [data-new]')?.value)`), 'draft kept', 'draft after reload');
    act(`document.querySelector('atelier-margin [data-discard]').click()`);
  });

  await check('margin: ×, Escape and a click outside close a card and keep its draft', async () => {
    const c = await threadOf('v/beta', 'keyboard thread');
    const isOpen = () => probe(`JSON.stringify(!!document.querySelector('[data-card="${c.id}"].is-open'))`);
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    act(`(()=>{const t=document.querySelector('[data-reply-text="${c.id}"]'); t.value='kept draft'; t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    act(`document.querySelector('[data-card="${c.id}"] [data-close]').click()`);
    eq(isOpen(), false, 'open after ×');
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    eq(probe(`JSON.stringify(document.querySelector('[data-reply-text="${c.id}"]').value)`), 'kept draft', 'draft after reopening');
    act(`document.querySelector('[data-reply-text="${c.id}"]').focus({preventScroll:true})`);
    browser(['press', 'Escape']);
    eq(isOpen(), false, 'open after Escape');
    act(`document.querySelector('[data-open="${c.id}"]').click()`);
    act(`document.querySelector('atelier-region[key=beta] h2').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    eq(isOpen(), false, 'open after clicking the page');
    act(`(()=>{document.querySelector('[data-open="${c.id}"]').click(); document.querySelector('[data-reply-text="${c.id}"]').value='';
      document.querySelector('[data-reply-text="${c.id}"]').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-close]').click()})()`);
  });

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const pasteInto = sel => act(`(()=>{const b=Uint8Array.from(atob('${PNG}'),c=>c.charCodeAt(0)); const dt=new DataTransfer();
    dt.items.add(new File([b],'shot.png',{type:'image/png'})); document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}))})()`);

  await check('thread: a pasted image uploads, shows, and goes out with a new Thread', async () => {
    altClick(`document.querySelector('atelier-region[key=beta] p')`);
    await sleep(200);
    pasteInto('atelier-margin [data-new]');
    await sleep(800);
    eq(probe(`JSON.stringify(document.querySelectorAll('atelier-margin .atl-att img').length)`), 1, 'thumbnails before sending');
    await typeNewAndSend('image thread');
    const c = await threadOf('v/beta', 'image thread');
    assert(/^\/\.review\/attachments\/[\w.-]+\.png$/.test(c?.attachments?.[0] || ''), `attachments ${JSON.stringify(c?.attachments)}`);
    const r = await fetch(base + c.attachments[0]);
    eq([r.status, r.headers.get('content-type')], [200, 'image/png'], 'served image');
    const ev = (await state()).log.filter(e => e.kind === 'sent').at(-1);
    eq(ev.comment.attachments, c.attachments, 'image in the wake event');
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

  // ---- proposals ----
  await check('proposal: sits in the margin at its Region and records a choice', async () => {
    const { body } = await api('/api/propose', { region:'v/fig', question:'Which figure?', options:['Keep it', 'Drop it'] });
    await sleep(900);
    level(tops(body.id, `document.querySelector('atelier-region[key=fig]')`), 'proposal card');
    assert(probe(`JSON.stringify(document.querySelector('[data-slot="${body.id}"]').innerText)`).startsWith('Decide:'), 'open Proposal is not collapsed');
    act(`document.querySelector('[data-open="${body.id}"]').click()`);
    eq(probe(`JSON.stringify(document.querySelector('[data-decide="${body.id}"]').disabled)`), true, 'Decide enabled before a choice');
    act(`document.querySelector('[data-choose="${body.id}"][value="0"]').closest('label').click()`);
    await sleep(200);
    eq((await state()).proposals[body.id].status, 'open', 'picking an option decided it');
    act(`document.querySelector('[data-decide="${body.id}"]').click()`);
    await sleep(600);
    eq((await state()).proposals[body.id].choiceIndex, 0, 'choice');
    assert(probe(`JSON.stringify(document.querySelector('[data-slot="${body.id}"]').innerText)`).startsWith('✓'), 'decided card did not collapse');
  });

  await check('proposal: an anchor places it beside the exact text', async () => {
    const { body } = await api('/api/propose', { region:'v/alpha', question:'Lazy?', options:['Yes', 'No'], anchor:{ region:'v/alpha', quote:'lazy dog' } });
    await sleep(900);
    eq((await state()).proposals[body.id].anchor.quote, 'lazy dog', 'stored anchor');
    // It shares a line with the selection Thread, so it is pushed below it until it becomes active.
    browser(['eval', `import('/atelier.mjs').then(k => k.reveal('${body.id}')).then(() => 'ok')`]);
    await sleep(700);
    const t = probe(`JSON.stringify((()=>{const r=[...CSS.highlights.get('atl-active')].find(r=>r.toString()==='lazy dog');
      return { card: Math.round(document.querySelector('[data-slot="${body.id}"]').getBoundingClientRect().top), anchor: Math.round(r.getBoundingClientRect().top) }})())`);
    level(t, 'anchored proposal');
  });

  await check('proposal: a custom answer is recorded and a decision can be changed', async () => {
    const { body } = await api('/api/propose', { region:'v/beta', question:'Name?', options:['A', 'B'] });
    await sleep(900);
    act(`document.querySelector('[data-open="${body.id}"]').click()`);
    act(`document.querySelector('[data-choose="${body.id}"][value="custom"]').closest('label').click()`);
    await sleep(200);
    act(`(()=>{const t=document.querySelector('[data-custom="${body.id}"]'); t.value='my own'; t.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('[data-decide="${body.id}"]').click()})()`);
    await sleep(600);
    const p = (await state()).proposals[body.id];
    eq([p.status, p.custom], ['decided', 'my own'], 'custom decision');
    act(`document.querySelector('[data-open="${body.id}"]').click()`);
    act(`document.querySelector('[data-choose="${body.id}"][value="1"]').closest('label').click()`);
    await sleep(200);
    act(`document.querySelector('[data-decide="${body.id}"]').click()`);
    await sleep(600);
    const q = (await state()).proposals[body.id];
    eq([q.choiceIndex, q.custom], [1, null], 'changed decision');
  });

  await check('proposal: an option explanation is asked and answered in place', async () => {
    const { body } = await api('/api/propose', { region:'v/list', question:'Order?', options:['Alphabetical', 'By date'] });
    await sleep(900);
    act(`document.querySelector('[data-open="${body.id}"]').click()`);
    act(`(()=>{document.querySelector('[data-explain-text="${body.id}:1"]').value='why date?'; document.querySelector('[data-explain="${body.id}"][data-i="1"]').click()})()`);
    await sleep(600);
    eq((await state()).proposals[body.id].explanationRequests['1'].answer, 'why date?', 'request');
    await api('/api/explain', { id:body.id, optionIndex:1, text:'dates match the audit' });
    await sleep(900);
    assert(probe(`JSON.stringify(document.querySelector('[data-card="${body.id}"]').innerText)`).includes('dates match the audit'), 'explanation not shown');
  });

  await check('proposal: a second question cannot displace an open Proposal', async () => {
    eq((await api('/api/propose', { region:'v/list', question:'Replace?', options:['x'] })).status, 409, 'status');
  });

  // ---- activity drawer ----
  await check('activity: the drawer groups what waits, what changed, and Updates', async () => {
    await api('/api/update', { region:'v/beta', title:'Batch finished', body:'six Regions re-rendered' });
    await api('/api/ready', { changed:['v/beta'] });
    await sleep(1200);
    const tools = probe(`JSON.stringify(document.querySelector('atelier-activity .atl-tools').innerText)`);
    assert(/2 waiting for you/.test(tools), `tools: ${tools}`);
    act(`document.querySelector('[popovertarget=atl-drawer]').click()`);
    const d = probe(`JSON.stringify({ open: document.querySelector('#atl-drawer').matches(':popover-open'), text: document.querySelector('#atl-drawer').innerText })`);
    eq(d.open, true, 'drawer open');
    for (const want of ['waiting for you', 'decide: lazy?', 'changed since you looked', 'beta', 'updates', 'batch finished']) assert(d.text.toLowerCase().includes(want), `drawer lacks "${want}"`);
    eq(probe(`JSON.stringify(document.querySelector('atelier-region[key=beta]').classList.contains('atl-changed'))`), true, 'changed marker');
  });

  await check('activity: a waiting item reveals and opens its exact card', async () => {
    const id = Object.values((await state()).proposals).find(p => p.question === 'Lazy?').id;
    act(`document.querySelector('#atl-drawer [data-reveal="${id}"]').click()`);
    await sleep(700);
    eq(probe(`JSON.stringify({ open: document.querySelector('#atl-drawer').matches(':popover-open'), active: !!document.querySelector('[data-card="${id}"].is-open') })`),
      { open:false, active:true }, 'after reveal');
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
    browser(['reload']); await sleep(1200);
    act(`(()=>{window.__asked=0; Object.defineProperty(Notification,'permission',{get:()=>'default',configurable:true});
      Notification.requestPermission=()=>{window.__asked++; return Promise.resolve('default')}})()`);
    browser(['click', 'h1']);
    await sleep(300);
    eq(probe(`JSON.stringify(window.__asked)`), 1, 'permission requests');
  });

  // ---- ready ----
  await check('ready: swaps only the named Region and keeps draft, caret, focus, scroll and anchors', async () => {
    const c = await threadOf('v/alpha', 'selection thread');
    act(`(()=>{document.querySelector('[data-open="${c.id}"]')?.click(); scrollTo(0, 400); window.__noReload=true;
      const t=document.querySelector('[data-reply-text="${c.id}"]'); t.focus({preventScroll:true}); t.value='half typed'; t.setSelectionRange(4,4)})()`);
    const before = probe(`JSON.stringify({ y: scrollY, beta: document.querySelector('atelier-region[key=beta]').innerHTML })`);
    writeSurface('the quick brown fox jumps over the lazy dog, edited');
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1500);
    const after = probe(`JSON.stringify({ reload: !window.__noReload, y: scrollY, text: document.querySelector('#alpha-body').textContent,
      beta: document.querySelector('atelier-region[key=beta]').innerHTML, focused: document.activeElement.dataset.replyText,
      draft: document.activeElement.value, caret: document.activeElement.selectionStart,
      anchored: [...CSS.highlights.get('atl-active')].concat([...CSS.highlights.get('atl-anchor')]).some(r=>r.toString()==='brown fox'),
      changed: document.querySelector('atelier-region[key=alpha]').classList.contains('atl-changed') })`);
    eq(after.reload, false, 'page reloaded');
    assert(after.text.endsWith('edited'), 'Region not swapped');
    eq(after.beta, before.beta, 'unnamed Region changed');
    assert(Math.abs(after.y - before.y) <= 2, `scroll moved ${before.y} → ${after.y}`);
    eq([after.focused, after.draft, after.caret, after.anchored, after.changed], [c.id, 'half typed', 4, true, true], 'preserved state');
  });

  await check('ready: an anchor whose text is gone says so and fails preflight', async () => {
    writeSurface('a sentence without the fox');
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1500);
    const c = await threadOf('v/alpha', 'selection thread');
    act(`document.querySelector('[data-open="${c.id}"]')?.click()`);
    assert(probe(`JSON.stringify(document.querySelector('[data-card="${c.id}"]').innerText)`).includes('has changed'), 'no detached note');
    const result = spawnSync(process.execPath, [path.join(HERE, 'preflight.mjs'), '--url', base, '--skip-poller'], { encoding:'utf8', timeout:120000 });
    assert(result.status === 1 && /no longer find their target/.test(result.stderr), `preflight: ${result.status} ${result.stderr.slice(0, 300)}`);
    writeSurface();
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1200);
  });

  await check('ready: an unknown Region key warns on the page', async () => {
    await api('/api/ready', { changed:['v/nope'] });
    await sleep(1200);
    assert(probe(`JSON.stringify(document.querySelector('.atl-warnings')?.textContent || '')`).includes('v/nope'), 'no warning');
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1200);
    eq(probe(`JSON.stringify(!!document.querySelector('.atl-warnings'))`), false, 'warning did not clear');
  });

  await check('ready: a Region new to the page reloads and keeps unsent Threads', async () => {
    altClick(`document.querySelector('atelier-region[key=beta] h2')`);
    await sleep(200);
    act(`(()=>{const t=document.querySelector('atelier-margin [data-new]'); t.value='survives reload'; t.dispatchEvent(new Event('input',{bubbles:true})); window.__noReload=true})()`);
    writeSurface(undefined, '<atelier-region key="gamma"><h2>Gamma</h2><p>new</p></atelier-region>');
    await api('/api/ready', { changed:['v/gamma'] });
    await sleep(2200);
    eq(probe(`JSON.stringify({ reload: !window.__noReload, gamma: !!document.querySelector('atelier-region[key=gamma]'), draft: document.querySelector('atelier-margin [data-new]')?.value })`),
      { reload:true, gamma:true, draft:'survives reload' }, 'after structural Ready');
    act(`document.querySelector('atelier-margin [data-discard]').click()`);
  });

  await check('preflight: the fixture passes the render gates', async () => {
    const result = spawnSync(process.execPath, [path.join(HERE, 'preflight.mjs'), '--url', base, '--skip-poller'], { encoding:'utf8', timeout:120000 });
    assert(result.status === 0, `preflight exited ${result.status}: ${result.stderr.slice(0, 400)}`);
  });

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
    await stopServer();
    await sleep(4200);                                  // the poll loop backs off for 3s before retrying
    eq(probe(`JSON.stringify(document.documentElement.hasAttribute('data-atl-offline'))`), true, 'no offline state while the server was down');
    startServer(port, dir);
    await waitForServer(base);
    await sleep(4200);
    eq(probe(`JSON.stringify(document.documentElement.hasAttribute('data-atl-offline'))`), false, 'offline state stuck after the server returned');
  });

  await check('preflight: browser errors fail the handoff gate', async () => {
    try {
      writeSurface('alpha body v3', `<script>setTimeout(()=>{throw new Error('preflight sentinel')},0)</script>`);
      const result = spawnSync(process.execPath, [path.join(HERE, 'preflight.mjs'), '--url', base, '--skip-poller'],
        { encoding:'utf8', timeout:120000 });
      assert(result.status === 1, `preflight exited ${result.status}`);
      assert(`${result.stdout}\n${result.stderr}`.includes('preflight sentinel'), 'preflight did not report the browser error');
    } finally {
      writeSurface('alpha body v3');
    }
  });

  await check('preflight: a sentence about the page fails the prose gate; subject-UI steps do not', async () => {
    try {
      writeSurface('alpha body v3', `<atelier-region key="intro" label="Intro"><p>Six decisions, most dangerous first. Reads switch region by region.</p>
        <p data-subject-ui>Select any sentence, then press Thread.</p></atelier-region>`);
      const result = spawnSync(process.execPath, [path.join(HERE, 'preflight.mjs'), '--url', base, '--skip-poller'],
        { encoding:'utf8', timeout:120000 });
      const out = `${result.stdout}\n${result.stderr}`;
      assert(result.status === 1 && out.includes('FAIL PROSE: 1 sentence'), `preflight: ${result.status} ${out.slice(0, 400)}`);
      assert(out.includes('"Six decisions, most dangerous first." (Region intro;'), 'the offending sentence and its Region are not listed');
      assert(out.includes('Repair:') && !out.includes('Reads switch') && !out.includes('Select any'), 'wrong sentences listed or no repair text');
    } finally {
      writeSurface('alpha body v3');
    }
  });

} finally {
  try { browser(['close']); } catch {}
  await stopServer();
  await fsp.rm(dir, { recursive:true, force:true });
}

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
