#!/usr/bin/env node
// Atelier kernel verification — every claim in docs/rebuild-plan.md, checked in a real browser.
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
// Deliberately library-free: verification must not depend on a CDN being reachable.
const surface = (alpha = 'alpha body v1', extra = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>verify</title>
<link rel="stylesheet" href="/atelier.css">
<script type="module" src="/atelier.mjs"></script>
<style>
  body{font-family:system-ui;margin:0;padding:24px}
  #attention-host{position:fixed;right:8px;bottom:8px;z-index:10;width:min(340px,calc(100vw - 16px));max-height:28vh;overflow:auto;background:Canvas;padding:6px}
</style>
</head><body>
<aside id="attention-host"><atelier-cockpit></atelier-cockpit></aside>
<atelier-region key="v">
  <h1>Verify</h1>
  <p>human: <atelier-attention for="v" mode="count" owner="human"></atelier-attention>
     agent: <atelier-attention for="v" mode="count" owner="agent"></atelier-attention></p>
  <atelier-region key="alpha">
    <h2>Alpha <atelier-attention mode="dot"></atelier-attention>
    <atelier-attention mode="label">Alpha label</atelier-attention></h2>
    <p id="alpha-body">${alpha}</p>
    <div style="height:1400px"></div>
  </atelier-region>
  <atelier-region key="beta" comments="side"><h2>Beta</h2><p>beta body</p></atelier-region>
  <atelier-region key="gamma" comments="sheet"><h2>Gamma</h2><p>gamma body</p></atelier-region>
  <div id="dynamic-region" data-filter="open"></div>
  <atelier-comments id="pinned-beta" for="v/beta"></atelier-comments>
${extra}</atelier-region>
<script type="module">
  import { reveal, setRevealResolver } from '/atelier.mjs';
  window.fixtureReveal = reveal;
  window.setFixtureResolver = setRevealResolver;
  window.installFixtureResolver = () => setRevealResolver(({ region }) => {
    if (region !== 'v/hidden') return;
    const host = document.querySelector('#dynamic-region');
    host.dataset.filter = 'all';
    host.dataset.selected = region;
    host.innerHTML ||= '<atelier-region key="hidden"><h2>Hidden</h2><p>conditionally mounted body</p></atelier-region>';
  });
  window.installFixtureResolver();
</script>
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
    const keys = probe(`JSON.stringify([...document.querySelectorAll('atelier-region')].map(e=>e.regionKey))`);
    eq(keys, ['v','v/alpha','v/beta','v/gamma'], 'region keys');
  });

  await check('regions: chrome mounts exactly once per Region', async () => {
    const counts = probe(`JSON.stringify([...document.querySelectorAll('atelier-region')].map(e=>[
      e.querySelectorAll(':scope > .atl-bar').length,
      e.querySelectorAll(':scope > atelier-update').length,
      e.querySelectorAll(':scope > atelier-proposal').length]))`);
    for (const [bars, updates, proposals] of counts) eq([bars, updates, proposals], [1,1,1], 'bar/update/proposal per Region');
  });

  await check('regions: sheet placement mounts no inline thread', async () => {
    const mounted = probe(`JSON.stringify({
      alpha:!!document.querySelector('atelier-region[key=alpha] > atelier-comments'),
      beta:!!document.querySelector('atelier-region[key=beta] > atelier-comments'),
      gamma:!!document.querySelector('atelier-region[key=gamma] > atelier-comments')})`);
    eq(mounted, { alpha:true, beta:true, gamma:false }, 'inline thread mounts');
  });

  // ---- thread ----
  await check('thread: send enters the open lifecycle and counts on the icon', async () => {
    act(`const t=document.querySelector('atelier-region[key=alpha] atelier-comments');
         t.input.value='first comment'; t.send()`);
    await sleep(900);
    const store = await state();
    const [comment] = store.threads['v/alpha'] || [];
    assert(comment?.text === 'first comment', 'comment not stored');
    eq(store.commentState[comment.id]?.value, 'open', 'lifecycle');
    const count = probe(`JSON.stringify(document.querySelector('atelier-region[key=alpha] .atl-count').textContent)`);
    eq(count, '1', 'icon count');
  });

  await check('thread: ⌘+Enter sends and Enter inserts a newline', async () => {
    const before = (await state()).threads['v/beta']?.length || 0;
    act(`(()=>{const i=document.querySelector('atelier-region[key=beta] .atl-input');
         i.value='line one'; i.dispatchEvent(new Event('input')); i.focus()})()`);
    browser(['press', 'Enter']);
    await sleep(200);
    const newline = probe(`JSON.stringify(document.querySelector('atelier-region[key=beta] .atl-input').value)`);
    assert(newline.includes('\n'), 'Enter did not insert a newline');
    eq((await state()).threads['v/beta']?.length || 0, before, 'Enter sent the comment');
    act(`(()=>{const i=document.querySelector('atelier-region[key=beta] .atl-input');
      i.setRangeText('line two', i.selectionStart, i.selectionEnd, 'end'); i.dispatchEvent(new Event('input')); i.focus()})()`);
    browser(['press', 'Meta+Enter']);
    await sleep(900);
    const store = await state(), comments = store.threads['v/beta'] || [];
    eq(comments.length, before + 1, '⌘+Enter comment count');
    assert(comments.at(-1).text.includes('\n'), 'multiline comment was flattened');
  });

  await check('thread: an agent reply arrives with no reload', async () => {
    const store = await state();
    const id = store.threads['v/alpha'][0].id;
    await api('/api/reply', { region:'v/alpha', id, msg:'rewrote it', state:'implemented' });
    await sleep(1200);
    const seen = probe(`JSON.stringify({
      text:document.querySelector('atelier-region[key=alpha] .atl-reply')?.textContent||'',
      verdicts:document.querySelectorAll('atelier-region[key=alpha] [data-accept],atelier-region[key=alpha] [data-reject]').length})`);
    assert(seen.text.includes('rewrote it'), 'reply not rendered');
    eq(seen.verdicts, 2, 'verdict buttons');
  });

  await check('thread: rejection uses a multiline in-Surface editor', async () => {
    viewport(390, 844);
    try {
      act(`document.querySelector('atelier-region[key=alpha] [data-reject-open]').click()`);
      const editor = probe(`JSON.stringify((()=>{const i=document.querySelector('atelier-region[key=alpha] form[data-reject] textarea');
        return {tag:i?.tagName, focused:document.activeElement===i, visible:!i?.closest('form').hidden};})())`);
      eq(editor, { tag:'TEXTAREA', focused:true, visible:true }, 'rejection editor');
      act(`(()=>{const i=document.querySelector('atelier-region[key=alpha] form[data-reject] textarea');
        i.value='still\\nwrong'; i.dispatchEvent(new Event('input')); i.focus()})()`);
      browser(['press', 'Meta+Enter']);
      await sleep(900);
      const store = await state();
      const id = store.threads['v/alpha'][0].id;
      eq(store.commentState[id]?.value, 'rejected', 'state after reject');
      assert((store.replies[id] || []).some(r => r.msg === 'still\nwrong'), 'rejection reason not recorded');
    } finally { viewport(1440, 900); }
  });

  await check('thread: accept closes the loop', async () => {
    const store = await state();
    const id = store.threads['v/alpha'][0].id;
    await api('/api/reply', { region:'v/alpha', id, msg:'again', state:'implemented' });
    await sleep(900);
    act(`document.querySelector('atelier-region[key=alpha] [data-accept]').click()`);
    await sleep(900);
    eq((await state()).commentState[id]?.value, 'accepted', 'state after accept');
  });

  await check('thread: an unsent draft survives a reload', async () => {
    act(`const i=document.querySelector('atelier-region[key=beta] .atl-input');
         i.value='draft in progress'; i.dispatchEvent(new Event('input'))`);
    await sleep(300);
    open(base + '/');
    await sleep(1200);
    eq(probe(`JSON.stringify(document.querySelector('atelier-region[key=beta] .atl-input').value)`),
      'draft in progress', 'restored draft');
  });

  await check('thread: a store update mid-typing does not clobber the textarea', async () => {
    act(`const i=document.querySelector('atelier-region[key=beta] .atl-input');
         i.value='half a sentence'; i.dispatchEvent(new Event('input')); i.focus()`);
    await api('/api/update', { region:'v', title:'agent did something' });
    await sleep(1300);
    const after = probe(`JSON.stringify({value:document.querySelector('atelier-region[key=beta] .atl-input').value,
      focused:document.activeElement===document.querySelector('atelier-region[key=beta] .atl-input')})`);
    eq(after.value, 'half a sentence', 'textarea value');
    assert(after.focused, 'focus lost while the agent wrote to the store');
  });

  // ---- updates ----
  await check('update: appears in its Region and dismisses', async () => {
    const shown = probe(`JSON.stringify(document.querySelector('atelier-region[key=v] > atelier-update').textContent)`);
    assert(shown.includes('agent did something'), 'update not rendered');
    act(`document.querySelector('[data-dismiss]').click()`);
    await sleep(900);
    eq(probe(`JSON.stringify(document.querySelector('atelier-region[key=v] > atelier-update').textContent.trim())`), '', 'dismissed update still visible');
  });

  await check('update: stays dismissed across a reload', async () => {
    open(base + '/');
    await sleep(1200);
    eq(probe(`JSON.stringify(document.querySelector('atelier-region[key=v] > atelier-update').textContent.trim())`), '', 'dismissal did not persist');
  });

  // ---- attention ----
  await check('attention: changed marker, +N rollup, and count by owner', async () => {
    await api('/api/ready', { changed:['v/alpha','v/beta'] });
    await api('/api/update', { region:'v/alpha', title:'also this' });
    await sleep(1300);
    const seen = probe(`JSON.stringify({
      badges:[...document.querySelectorAll('atelier-region[key=alpha] > .atl-bar .atl-badge')].map(b=>b.textContent),
      dot:!!document.querySelector('atelier-region[key=alpha] .atl-dot'),
      label:document.querySelector('atelier-attention[mode=label]').textContent,
      human:document.querySelector('atelier-attention[owner=human]').textContent})`);
    eq(seen.badges[0], 'Changed', 'lead badge');
    assert(seen.badges[1]?.startsWith('+'), 'no +N badge for a second item');
    assert(seen.dot, 'dot mode did not render');
    eq(seen.label, 'Alpha label', 'label mode lost its slotted text');
    eq(seen.human, '3', 'human count rollup (2 changed + 1 update)');
  });

  // The marker's whole job is whose turn it is. Every agent-owned kind shares one label because the
  // store records an asserted state and a timestamp, never that work is under way.
  await check('attention: the marker names whose turn it is', async () => {
    const badge = (key) => probe(`JSON.stringify({
      text:document.querySelector('atelier-region[key=${key}] > .atl-bar .atl-badge')?.textContent||'',
      human:!!document.querySelector('atelier-region[key=${key}] > .atl-bar .atl-badge--human'),
      agent:!!document.querySelector('atelier-region[key=${key}] > .atl-bar .atl-badge--agent')})`);

    const proposal = await api('/api/propose', { region:'v/gamma', question:'Whose turn?', options:['A','B'] });
    await sleep(1300);
    const decide = badge('gamma');
    eq(decide.text, 'Decide', 'an open Proposal should read as the human\'s turn');
    assert(decide.human && !decide.agent, 'open Proposal is not marked human-owned');
    await api('/api/decide', { id:proposal.body.id, choiceIndex:0 });   // leave no open Proposal behind

    // The agent side is reached the way a human reaches it: their comment, then the agent's reply.
    // acknowledged and in_progress must read identically — the store never records live work.
    const id = 'c-whose-turn', before = await state();
    await api('/api/state', { threads:{ ...before.threads, 'v/gamma':[...(before.threads['v/gamma']||[]), { id, text:'whose turn' }] } });
    await api('/api/send', { region:'v/gamma', id });
    for (const value of ['acknowledged', 'in_progress']){
      await api('/api/reply', { region:'v/gamma', id, msg:`now ${value}`, state:value });
      await sleep(1300);
      const seen = badge('gamma');
      eq(seen.text, 'With agent', `${value} should read as the agent's turn`);
      assert(seen.agent && !seen.human, `${value} is not marked agent-owned`);
    }
    await api('/api/comment-state', { region:'v/gamma', id, state:'accepted' });   // clear it again
  });

  await check('attention: the checkmark clears the Region', async () => {
    act(`document.querySelector('atelier-region[key=beta] [data-ack]').click()`);
    await sleep(900);
    assert(!(await state()).changed['v/beta'], 'ack did not clear the changed marker');
    eq(probe(`JSON.stringify(!!document.querySelector('atelier-region[key=beta] .atl-badge--changed'))`), false, 'changed marker still on screen');
  });

  await check('attention: sending a comment acknowledges only its changed Region', async () => {
    await api('/api/ready', { changed:['v/beta','v/gamma'] });
    await sleep(1300);
    const cursor = (await state()).seq;
    act(`const t=document.querySelector('atelier-region[key=beta] atelier-comments');
         t.input.value='reviewed beta'; t.send()`);
    await sleep(900);
    const store = await state();
    assert(!store.changed['v/beta'], 'comment did not clear its Region marker');
    assert(store.changed['v/gamma'], 'comment cleared a different Region marker');
    assert(store.log.some(e => e.seq > cursor && e.kind === 'ack' && e.region === 'v/beta'), 'comment did not log ack');
    const badges = probe(`JSON.stringify({
      beta:!!document.querySelector('atelier-region[key=beta] .atl-badge--changed'),
      gamma:!!document.querySelector('atelier-region[key=gamma] .atl-badge--changed')})`);
    eq(badges, { beta:false, gamma:true }, 'changed badges after comment');
  });

  await check('attention: deciding a Proposal acknowledges only its changed Region', async () => {
    await api('/api/ready', { changed:['v/beta','v/gamma'] });
    const { body } = await api('/api/propose', { region:'v/gamma', question:'Reviewed Gamma?', options:['Yes'] });
    await sleep(1300);
    const cursor = (await state()).seq;
    act(`document.querySelector('atelier-region[key=gamma] [data-choose]').click()`);
    await sleep(900);
    const store = await state();
    assert(store.proposals[body.id]?.status === 'decided', 'Proposal was not decided');
    assert(!store.changed['v/gamma'], 'decision did not clear its Region marker');
    assert(store.changed['v/beta'], 'decision cleared a different Region marker');
    assert(store.log.some(e => e.seq > cursor && e.kind === 'ack' && e.region === 'v/gamma'), 'decision did not log ack');
    const badges = probe(`JSON.stringify({
      beta:!!document.querySelector('atelier-region[key=beta] .atl-badge--changed'),
      gamma:!!document.querySelector('atelier-region[key=gamma] .atl-badge--changed')})`);
    eq(badges, { beta:true, gamma:false }, 'changed badges after decision');
  });

  // ---- cockpit ----
  await check('cockpit: lists open loops, filters by owner, and activates the exact row', async () => {
    const { body } = await api('/api/update', { region:'v/alpha', title:'cockpit baseline' }); await sleep(1300);
    const rows = probe(`JSON.stringify({
      human:document.querySelectorAll('.atl-cockpit__row').length,
      all:(document.querySelector('[data-filter=""]').click(), document.querySelectorAll('.atl-cockpit__row').length)})`);
    assert(rows.human > 0, 'cockpit listed nothing for the human');
    assert(rows.all >= rows.human, 'the all filter showed fewer rows than the human filter');
    act(`document.querySelector('[data-interaction-id="${body.id}"]').click()`); await sleep(300);
    eq(probe(`JSON.stringify(document.activeElement===document.querySelector('[data-update="${body.id}"] [data-dismiss]'))`),
      true, 'clicking a Cockpit row did not focus its exact interaction');
    act(`document.querySelector('[data-interaction-id="${body.id}"]').focus()`);
    await api('/api/update', { region:'v/beta', title:'event while navigating Cockpit' }); await sleep(1300);
    eq(probe(`JSON.stringify(document.activeElement===document.querySelector('[data-interaction-id="${body.id}"]'))`),
      true, 'Cockpit row focus did not survive a store event');
  });

  await check('cockpit: an offscreen Update returns to its exact control', async () => {
    const { body } = await api('/api/update', { region:'v/alpha', title:'offscreen exact update' });
    await sleep(1300);
    act(`window.scrollTo(0, document.documentElement.scrollHeight)`); await sleep(300);
    const before = probe(`JSON.stringify((()=>{const update=document.querySelector('[data-update="${body.id}"]').getBoundingClientRect(),
      cockpit=document.querySelector('#attention-host').getBoundingClientRect();
      return {offscreen:update.bottom<0, cockpit:cockpit.top<innerHeight && cockpit.bottom>0};})())`);
    eq(before, { offscreen:true, cockpit:true }, 'persistent Cockpit with offscreen Update');
    const row = probe(`JSON.stringify((()=>{const r=document.querySelector('[data-interaction-id="${body.id}"]');
      return r && {region:r.dataset.goto, kind:r.dataset.kind, id:r.dataset.interactionId};})())`);
    eq(row, { region:'v/alpha', kind:'update', id:body.id }, 'Cockpit row identity');
    act(`document.querySelector('[data-interaction-id="${body.id}"]').click()`); await sleep(1000);
    const arrived = probe(`JSON.stringify((()=>{const u=document.querySelector('[data-update="${body.id}"]'), r=u.getBoundingClientRect();
      return {visible:r.top>=0 && r.bottom<=innerHeight, focused:document.activeElement===u.querySelector('[data-dismiss]'),
        flashed:u.classList.contains('atl-flash')};})())`);
    eq(arrived, { visible:true, focused:true, flashed:true }, 'exact Update return');
    await api('/api/update', { region:'v/beta', title:'unrelated after reveal' }); await sleep(1300);
    eq(probe(`JSON.stringify(document.activeElement===document.querySelector('[data-update="${body.id}"] [data-dismiss]'))`),
      true, 'exact focus did not survive an unrelated event');
  });

  await check('cockpit: changed, decision, explanation, and request rows focus exactly', async () => {
    const id = 'c-exact-request', store = await state();
    await api('/api/state', { threads:{ ...store.threads, 'v/beta':[...(store.threads['v/beta']||[]), { id, text:'exact request' }] } });
    await api('/api/send', { region:'v/beta', id });
    await api('/api/ready', { changed:['v/alpha'] });
    const { body } = await api('/api/propose', { region:'v/gamma', question:'Exact Proposal?', options:['First','Second'] });
    await api('/api/explain-request', { id:body.id, optionIndex:0, answer:'Explain first' });
    await sleep(1300);
    act(`document.querySelector('[data-kind="changed"][data-interaction-id="v/alpha"]').click()`); await sleep(100);
    eq(probe(`JSON.stringify(document.activeElement.matches('[data-ack]'))`), true, 'changed focus');
    act(`document.querySelector('[data-kind="decision"][data-interaction-id="${body.id}"]').click()`); await sleep(100);
    eq(probe(`JSON.stringify(document.activeElement.matches('[data-choose]'))`), true, 'decision focus');
    act(`document.querySelector('[data-kind="explanation"][data-interaction-id="${body.id}:0"]').click()`); await sleep(100);
    eq(probe(`JSON.stringify(document.activeElement===document.querySelector('[data-proposal="${body.id}"] .atl-option'))`), true, 'explanation focus');
    act(`document.querySelector('[data-kind="request"][data-interaction-id="${id}"]').click()`); await sleep(100);
    eq(probe(`JSON.stringify(document.activeElement.dataset.comment)`), id, 'request focus');
    eq(probe(`JSON.stringify(window.fixtureReveal('v/beta'))`), true, 'Region shorthand result');
    eq(probe(`JSON.stringify(document.activeElement.regionKey)`), 'v/beta', 'Region shorthand focus');
  });

  await check('cockpit: pinned Thread focus survives an unrelated event', async () => {
    const id = 'c-exact-request';
    await api('/api/reply', { region:'v/beta', id, msg:'implemented in pinned Thread', state:'implemented' }); await sleep(1300);
    act(`document.querySelector('#pinned-beta [data-comment="${id}"] [data-accept]').focus()`);
    await api('/api/update', { region:'v/gamma', title:'unrelated to pinned Thread' }); await sleep(1300);
    eq(probe(`JSON.stringify(document.activeElement===document.querySelector('#pinned-beta [data-comment="${id}"] [data-accept]'))`),
      true, 'pinned Thread focus');
  });

  await check('cockpit: a resolver mounts an implemented Thread and focuses its verdict', async () => {
    const id = 'c-conditionally-mounted';
    const store = await state();
    await api('/api/state', { threads:{ ...store.threads, 'v/hidden':[{ id, text:'review hidden work' }] } });
    await api('/api/send', { region:'v/hidden', id });
    await api('/api/reply', { region:'v/hidden', id, msg:'implemented while unmounted', state:'implemented' });
    await sleep(1300);
    eq(probe(`JSON.stringify(!!document.querySelector('atelier-region[key=hidden]'))`), false, 'hidden Region mounted before reveal');
    const row = probe(`JSON.stringify((()=>{const r=document.querySelector('[data-interaction-id="${id}"]');
      return r && {region:r.dataset.goto, kind:r.dataset.kind, id:r.dataset.interactionId};})())`);
    eq(row, { region:'v/hidden', kind:'verdict', id }, 'implemented Thread row identity');
    act(`document.querySelector('[data-interaction-id="${id}"]').click()`); await sleep(500);
    const arrived = probe(`JSON.stringify((()=>{const host=document.querySelector('#dynamic-region'), c=document.querySelector('[data-comment="${id}"]');
      return {filter:host.dataset.filter, selected:host.dataset.selected, region:!!document.querySelector('atelier-region[key=hidden]'),
        exact:!!c, focused:document.activeElement===c?.querySelector('[data-accept]'), flashed:c?.classList.contains('atl-flash')||false};})())`);
    eq(arrived, { filter:'all', selected:'v/hidden', region:true, exact:true, focused:true, flashed:true }, 'resolved Thread return');
  });

  await check('cockpit: a sheet Thread opens at its exact verdict', async () => {
    const id = 'c-sheet-verdict', store = await state();
    await api('/api/state', { threads:{ ...store.threads, 'v/gamma':[...(store.threads['v/gamma']||[]), { id, text:'review sheet work' }] } });
    await api('/api/send', { region:'v/gamma', id });
    await api('/api/reply', { region:'v/gamma', id, msg:'sheet work implemented', state:'implemented' });
    await sleep(1300);
    act(`document.querySelector('[data-interaction-id="${id}"]').click()`); await sleep(400);
    const arrived = probe(`JSON.stringify((()=>{const c=document.querySelector('.atl-sheet [data-comment="${id}"]');
      return {region:document.querySelector('.atl-sheet atelier-comments')?.region, exact:!!c,
        focused:document.activeElement===c?.querySelector('[data-accept]'), flashed:c?.classList.contains('atl-flash')||false};})())`);
    eq(arrived, { region:'v/gamma', exact:true, focused:true, flashed:true }, 'sheet verdict return');
    browser(['press', 'Escape']); await sleep(200);
  });

  await check('cockpit: a failed resolver or missing interaction fails visibly', async () => {
    const missing = probe(`JSON.stringify(window.fixtureReveal({region:'v/alpha',kind:'update',id:'missing-update'}))`);
    eq(missing, false, 'missing exact interaction result');
    let failure = probe(`JSON.stringify({warning:document.querySelector('.atl-warn')?.textContent||'',
      tabindex:document.querySelector('atelier-region[key=alpha]').hasAttribute('tabindex')})`);
    assert(failure.warning.includes('missing-update'), 'missing interaction did not warn');
    eq(failure.tabindex, false, 'failed reveal mutated the authored Region');
    const { body } = await api('/api/update', { region:'v/alpha', title:'hidden exact target' }); await sleep(1300);
    act(`document.querySelector('[data-update="${body.id}"]').style.display='none'`);
    eq(probe(`JSON.stringify(window.fixtureReveal({region:'v/alpha',kind:'update',id:'${body.id}'}))`),
      false, 'hidden interaction result');
    assert(probe(`JSON.stringify(document.querySelector('.atl-warn[data-warning="reveal"]')?.textContent||'')`).includes(body.id),
      'hidden interaction did not warn');
    act(`document.querySelector('[data-update="${body.id}"]').style.display=''`);
    eq(probe(`JSON.stringify(window.fixtureReveal({region:'v/alpha',kind:'update',id:'${body.id}'}))`), true, 'recovered reveal');
    eq(probe(`JSON.stringify(!!document.querySelector('.atl-warn[data-warning="reveal"]'))`), false, 'stale reveal warning');
    act(`window.setFixtureResolver(()=>{throw new Error('resolver sentinel')})`);
    const rejected = probe(`JSON.stringify(window.fixtureReveal({region:'v/alpha',kind:'update',id:'missing-update'}))`);
    eq(rejected, false, 'throwing resolver result');
    failure = probe(`JSON.stringify(document.querySelector('.atl-warn')?.textContent||'')`);
    assert(failure.includes('resolver sentinel'), 'resolver error did not warn');
    act(`window.installFixtureResolver()`);
    eq(probe(`JSON.stringify(window.fixtureReveal({region:'v/alpha',kind:'update',id:'${body.id}'}))`), true, 'resolver recovery');
  });

  // ---- proposals ----
  await check('proposal: renders in its Region and records a chosen option', async () => {
    const { body } = await api('/api/propose', { region:'v/alpha', question:'Which order?', options:['Provider first','Ingest first'] });
    await sleep(1300);
    const q = probe(`JSON.stringify(document.querySelector('atelier-region[key=alpha] .atl-proposal__q')?.textContent||'')`);
    eq(q, 'Which order?', 'proposal question');
    act(`[...document.querySelectorAll('atelier-region[key=alpha] [data-choose]')][1].click()`);
    await sleep(900);
    const pr = (await state()).proposals[body.id];
    eq([pr.status, pr.choiceIndex], ['decided', 1], 'decision');
  });

  await check('proposal: a multiline custom draft survives reload and submits by keyboard', async () => {
    const { body } = await api('/api/propose', { region:'v/alpha', question:'Cut the step?', options:['Keep','Cut'] });
    await sleep(1300);
    viewport(390, 844);
    act(`(()=>{const i=document.querySelector('[data-proposal="${body.id}"] .atl-custom textarea');
         i.value='Split it\\nin two'; i.dispatchEvent(new Event('input')); i.focus()})()`);
    open(base + '/'); await sleep(1200);
    const restored = probe(`JSON.stringify(document.querySelector('[data-proposal="${body.id}"] .atl-custom textarea').value)`);
    eq(restored, 'Split it\nin two', 'custom draft after reload');
    act(`document.querySelector('[data-proposal="${body.id}"] .atl-custom textarea').focus()`);
    browser(['press', 'Meta+Enter']); await sleep(900);
    const pr = (await state()).proposals[body.id];
    eq([pr.status, pr.custom], ['decided', 'Split it\nin two'], 'custom decision');
    viewport(1440, 900);
  });

  await check('proposal: explanation draft, focus, and caret survive an unrelated event', async () => {
    const long = 'Strict — reject incomplete records and explain every consequence before continuing';
    const { body } = await api('/api/propose', { region:'v/alpha', question:'Which default?', options:[long,'Lenient'] });
    await sleep(1300);
    viewport(390, 844);
    act(`(()=>{document.querySelector('[data-proposal="${body.id}"] [data-why]').click();
         const i=document.querySelector('[data-proposal="${body.id}"] form[data-explain] textarea');
         i.value='what\\nbreaks if I pick this?'; i.dispatchEvent(new Event('input')); i.focus(); i.setSelectionRange(4,4)})()`);
    await api('/api/update', { region:'v', title:'unrelated event' }); await sleep(1300);
    const draft = probe(`JSON.stringify((()=>{const i=document.querySelector('[data-proposal="${body.id}"] form[data-explain] textarea');
      return {value:i.value, focused:document.activeElement===i, caret:i.selectionStart, visible:!i.closest('form').hidden};})())`);
    eq(draft, { value:'what\nbreaks if I pick this?', focused:true, caret:4, visible:true }, 'explanation draft');
    browser(['press', 'Meta+Enter']); await sleep(900);
    let pr = (await state()).proposals[body.id];
    eq(pr.explanationRequests['0']?.status, 'requested', 'request not recorded');
    const waiting = probe(`JSON.stringify(document.querySelector('[data-proposal="${body.id}"] .atl-explain--waiting')?.textContent||'')`);
    assert(waiting.includes('what'), 'the pending question is not visible on the option');
    await api('/api/explain', { id: body.id, optionIndex:0, text:'nothing breaks, it only warns' });
    await sleep(1300);
    const answered = probe(`JSON.stringify(document.querySelector('[data-proposal="${body.id}"] .atl-explain')?.textContent||'')`);
    assert(answered.includes('nothing breaks'), 'the answer never reached the option');
    viewport(1440, 900);
  });

  await check('proposal: long options stay left-aligned with their explanation control', async () => {
    const openProposal = Object.values((await state()).proposals).find(pr => pr.region === 'v/alpha' && pr.status === 'open');
    assert(openProposal?.options[0].length > 60, 'no long open option to inspect');
    for (const [width, height] of [[1440,900],[390,844]]){
      viewport(width, height); await sleep(300);
      const layout = probe(`JSON.stringify((()=>{const option=document.querySelector('[data-proposal="${openProposal.id}"] .atl-option'),
        choose=option.querySelector('[data-choose]'), why=option.querySelector('[data-why]'), a=choose.getBoundingClientRect(), b=why.getBoundingClientRect();
        return {align:getComputedStyle(choose).textAlign, sameRow:Math.abs(a.top-b.top)<2, right:Math.round(b.right), viewport:innerWidth,
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};})())`);
      eq(layout.align, 'left', `${width}px option alignment`);
      assert(layout.sameRow, `${width}px explanation control detached`);
      assert(layout.right <= layout.viewport && layout.overflow === 0, `${width}px option overflow`);
    }
    viewport(1440, 900);
  });

  await check('proposal: a second question cannot displace an open Proposal', async () => {
    const before = await state();
    const openProposal = Object.values(before.proposals).find(pr => pr.region === 'v/alpha' && pr.status === 'open');
    assert(openProposal, 'no open Proposal to protect');
    const replacement = await api('/api/propose', { region:'v/alpha', question:'Replacement?', options:['Replace'] });
    eq(replacement.status, 409, 'duplicate Proposal status');
    await sleep(400);
    const after = await state();
    eq(after.proposals[openProposal.id]?.status, 'open', 'original Proposal status');
    assert(!Object.values(after.proposals).some(pr => pr.question === 'Replacement?'), 'replacement Proposal was stored');
    const visible = probe(`JSON.stringify(document.querySelector('[data-proposal="${openProposal.id}"] .atl-proposal__q')?.textContent||'')`);
    eq(visible, openProposal.question, 'visible Proposal');
  });

  // ---- placements ----
  await check('placement: the side gutter sits beside the content at 1440', async () => {
    const side = probe(`JSON.stringify((()=>{const t=document.querySelector('atelier-region[key=beta] atelier-comments'),
      s=getComputedStyle(t); return {position:s.position,width:s.width};})())`);
    eq([side.position, side.width], ['absolute', '320px'], 'side gutter at 1440');
  });

  await check('placement: the side gutter stacks at 820 with no horizontal overflow', async () => {
    viewport(820, 1000);
    await sleep(500);
    const narrow = probe(`JSON.stringify({
      position:getComputedStyle(document.querySelector('atelier-region[key=beta] atelier-comments')).position,
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth})`);
    eq([narrow.position, narrow.overflow], ['static', 0], 'stacked gutter at 820');
    viewport(1440, 900);
    await sleep(400);
  });

  await check('placement: the sheet pins to the viewport and Escape restores focus', async () => {
    act(`document.querySelector('atelier-region[key=gamma] .atl-comment-btn').click()`);
    await sleep(600);
    const opened = probe(`JSON.stringify((()=>{const s=document.querySelector('.atl-sheet'), r=s?.getBoundingClientRect();
      return {open:!!s, region:s?.querySelector('atelier-comments').getAttribute('for'),
        pinned:!!r && Math.abs(r.bottom-innerHeight)<2, focused:document.activeElement===s?.querySelector('.atl-compose textarea')};})())`);
    eq(opened, { open:true, region:'v/gamma', pinned:true, focused:true }, 'sheet');
    browser(['press', 'Escape']); await sleep(300);
    const closed = probe(`JSON.stringify({sheet:!!document.querySelector('.atl-sheet'), space:!!document.querySelector('.atl-sheet-space'),
      focus:document.activeElement===document.querySelector('atelier-region[key=gamma] .atl-comment-btn')})`);
    eq(closed, { sheet:false, space:false, focus:true }, 'Escape close');
  });

  await check('placement: a growing sheet reserves bottom clearance at desktop and narrow widths', async () => {
    for (const [width, height] of [[1440,900],[390,844]]){
      viewport(width, height);
      act(`document.querySelector('atelier-region[key=gamma] .atl-comment-btn').click()`); await sleep(300);
      const before = probe(`JSON.stringify(document.querySelector('.atl-sheet-space').getBoundingClientRect().height)`);
      act(`(()=>{const i=document.querySelector('.atl-sheet .atl-compose textarea'); i.style.height='180px'; i.dispatchEvent(new Event('input'))})()`);
      await sleep(400);
      const clearance = probe(`JSON.stringify((()=>{const s=document.querySelector('.atl-sheet'), space=document.querySelector('.atl-sheet-space');
        window.scrollTo(0,document.documentElement.scrollHeight);
        return {sheet:Math.round(s.getBoundingClientRect().height), space:Math.round(space.getBoundingClientRect().height),
          target:Math.round(document.querySelector('atelier-region[key=gamma]').getBoundingClientRect().bottom),
          available:Math.round(innerHeight-s.getBoundingClientRect().height)};})())`);
      assert(clearance.space >= clearance.sheet - 1, `${width}px spacer is shorter than the sheet`);
      assert(clearance.space > before, `${width}px spacer did not follow textarea growth`);
      assert(clearance.target <= clearance.available + 2, `${width}px last Region remains under the sheet`);
      act(`document.querySelector('.atl-sheet [data-close]').click()`); await sleep(200);
    }
    viewport(1440, 900);
  });

  // ---- ready ----
  await check('ready: swaps only the named Region and holds scroll, focus, and Threads', async () => {
    let store = await state();
    if (!(store.threads['v/alpha']||[]).some(comment => comment.text === 'first comment')){
      const id = 'c-ready-thread';
      await api('/api/state', { threads:{ ...store.threads, 'v/alpha':[...(store.threads['v/alpha']||[]), { id, text:'first comment' }] } });
      await api('/api/send', { region:'v/alpha', id }); await sleep(900); store = await state();
    }
    let openUpdate = Object.values(store.updates).find(update => update.region === 'v/alpha' && !update.dismissedAt);
    if (!openUpdate){ await api('/api/update', { region:'v/alpha', title:'Ready focus' }); await sleep(1300);
      openUpdate = Object.values((await state()).updates).find(update => update.region === 'v/alpha' && !update.dismissedAt); }
    assert(openUpdate, 'no open Update for Ready focus');
    act(`document.querySelector('[data-interaction-id="${openUpdate.id}"]').click()`); await sleep(200);
    act(`window.scrollTo(0,700)`);
    await sleep(300);
    // What must not move is the material under the human's eyes, not the scroll number. A Ready can
    // legitimately grow chrome above the fold — a new Cockpit row, for instance — and the browser
    // then adjusts scrollY to hold the view still. Asserting scrollY would fail on correct behavior
    // and, worse, pass when content really did jump.
    const anchor = probe(`JSON.stringify(Math.round(document.querySelector('#alpha-body').getBoundingClientRect().top))`);
    writeSurface('alpha body v2');
    await api('/api/ready', { changed:['v/alpha'] });
    await sleep(1600);
    const after = probe(`JSON.stringify({
      alpha:document.querySelector('#alpha-body').textContent,
      beta:document.querySelector('atelier-region[key=beta] p').textContent,
      anchor:Math.round(document.querySelector('#alpha-body').getBoundingClientRect().top),
      thread:document.querySelector('atelier-region[key=alpha] .atl-comment')?.textContent.includes('first comment')||false,
      focused:document.activeElement===document.querySelector('[data-update="${openUpdate.id}"] [data-dismiss]'),
      bars:document.querySelectorAll('atelier-region[key=alpha] > .atl-bar').length})`);
    eq(after.alpha, 'alpha body v2', 'named Region did not swap');
    eq(after.beta, 'beta body', 'an unnamed Region changed');
    assert(Math.abs(after.anchor - anchor) <= 2, `the swapped content jumped ${after.anchor - anchor}px under the human`);
    assert(after.thread, 'the existing Thread was lost in the swap');
    assert(after.focused, 'the exact focused interaction was lost in the swap');
    eq(after.bars, 1, 'chrome was mounted twice after the swap');
  });

  await check('ready: an unknown Region key warns on the page', async () => {
    writeSurface('alpha body v3');
    await api('/api/ready', { changed:['v/alpha','v/ghost'] });
    await sleep(1600);
    const warn = probe(`JSON.stringify(document.querySelector('.atl-warn')?.textContent||'')`);
    assert(warn.includes('v/ghost'), `no warning for an unknown key (saw ${JSON.stringify(warn)})`);
  });

  await check('ready: a Region new to the page triggers a reload', async () => {
    writeSurface('alpha body v3', `<atelier-region key="delta"><h2>Delta</h2><p>delta body</p></atelier-region>`);
    await api('/api/ready', { changed:['v/delta'] });
    await sleep(2200);
    const keys = probe(`JSON.stringify([...document.querySelectorAll('atelier-region')].map(e=>e.regionKey))`);
    assert(keys.includes('v/delta'), 'the new Region never appeared');
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

} finally {
  try { browser(['close']); } catch {}
  await stopServer();
  await fsp.rm(dir, { recursive:true, force:true });
}

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
