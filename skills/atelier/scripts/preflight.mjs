#!/usr/bin/env node
// Atelier preflight — the gate between "I wrote a Surface" and "the human is looking at it".
//
//   node <skill-dir>/scripts/preflight.mjs --url http://127.0.0.1:<port> \
//     --poller-identity /abs/path/to/tools/review-poll.sh [--evidence-dir .review/preflight]
//
// It fails silent handoff defects: store and poller reachability, kit drift, Region identity, the
// Activity element and hosts, open items without a reachable host, stored anchors that no longer
// resolve, browser errors and kernel warnings, overflow at three viewports, and diagram rendering.
// Prose that may describe the page instead of its subject is a warning; page height and first-screen
// Region coverage are evidence lines.
//
// --skip-poller / --skip-render exist for kernel tests. Neither is a human handoff.
//
// Passing these checks proves the page renders, not that a cold reader can use it. That judgment is
// a screenshot pass by a delegated subagent, recorded against the current content hash:
//
//   node <skill-dir>/scripts/preflight.mjs --url <surface-url> [--evidence-dir .review/preflight] \
//     --record-visual pass|fail|unverified --note "what was seen, or what is wrong, or what state is needed"
//
// The hash covers the served page and kit, so restarting an unchanged Surface keeps its verdict and
// any content change makes it pending again.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { metaFindings, REPAIR } from './prose.mjs';

const args = process.argv.slice(2);
let url = '', pollerIdentity = '', evidenceDir = '', skipPoller = false, skipRender = false, allowKitDrift = false;
let recordVisual = '';
const notesArg = [];
while (args.length){
  const arg = args.shift();
  if (arg === '--url') url = args.shift() || '';
  else if (arg === '--poller-identity') pollerIdentity = args.shift() || '';
  else if (arg === '--evidence-dir') evidenceDir = args.shift() || '';
  else if (arg === '--skip-poller') skipPoller = true;
  else if (arg === '--skip-render') skipRender = true;
  else if (arg === '--allow-kit-drift') allowKitDrift = true;
  else if (arg === '--record-visual') recordVisual = args.shift() || '';
  else if (arg === '--note') notesArg.push(args.shift() || '');
  else { console.error(`unknown argument: ${arg}`); process.exit(2); }
}

// ---- visual verdict ------------------------------------------------------------------
const verdictFile = path.join(evidenceDir || '.review/preflight', 'visual-verdict.json');
const sameUrl = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };
// ponytail: hashes only the page and kit the server answers for; assets the page loads itself
// (data files, images, recipe scripts) can change without invalidating the verdict.
async function contentHash(){
  const hash = createHash('sha256');
  for (const route of ['/', '/atelier.mjs', '/atelier.css']){
    const response = await fetch(new URL(route, url), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`GET ${route} returned HTTP ${response.status}`);
    hash.update(route).update('\0').update(Buffer.from(await response.arrayBuffer())).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
if (recordVisual){
  const notes = notesArg.map(n => n.trim()).filter(Boolean);
  if (!url || !['pass', 'fail', 'unverified'].includes(recordVisual) || (recordVisual !== 'pass' && !notes.length)){
    console.error('usage: preflight.mjs --url <surface-url> [--evidence-dir <dir>] --record-visual pass|fail|unverified --note "…" (a note is required for fail and unverified)');
    process.exit(2);
  }
  let hash;
  try { hash = await contentHash(); }
  catch (error){ console.error(`cannot hash ${url}: ${error.message}`); process.exit(1); }
  const verdict = { url, contentHash: hash, verdict: recordVisual, viewports: ['1440x900', '390x844'], findings: notes,
    ...(recordVisual === 'unverified' ? { reason: notes.join('; ') } : {}), recordedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(verdictFile), { recursive: true });
  fs.writeFileSync(verdictFile, `${JSON.stringify(verdict, null, 2)}\n`);
  console.log(`VISUAL=${recordVisual} recorded for ${url} at content ${hash} in ${verdictFile}`);
  process.exit(0);
}

if (!url || (!skipPoller && !pollerIdentity)){
  console.error('usage: preflight.mjs --url <surface-url> --poller-identity <absolute-poller-path> [--evidence-dir <dir>] [--skip-render] [--skip-poller] [--allow-kit-drift]');
  process.exit(2);
}

const failures = [], passes = [];
const fail = (gate, correction) => failures.push(`FAIL ${gate}: ${correction}`);
const pass = (gate, evidence) => passes.push(`PASS ${gate}: ${evidence}`);

// ---- store ---------------------------------------------------------------------------
let state = null;
try {
  const response = await fetch(new URL('/api/state', url), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state = await response.json();
  if (!state?.name || !Array.isArray(state.log) || typeof state.threads !== 'object'){
    throw new Error('response does not match the Atelier store shape');
  }
  pass('STORE', `${new URL('/api/state', url)} returned store ${state.name} at seq ${state.seq}`);
} catch (error) {
  fail('STORE', `${new URL('/api/state', url)} is not a healthy Atelier store (${error.message}); start tools/review-server.mjs on this exact port`);
}

// ---- poller --------------------------------------------------------------------------
// A Surface whose poller is not armed looks perfect and answers nothing. It has to be exactly one
// process, matched on the absolute path, so a stale poller from an earlier round cannot pass.
if (!skipPoller){
  const ps = spawnSync('ps', ['-Ao', 'pid=,command='], { encoding:'utf8' });
  if (ps.status !== 0){
    fail('POLLER', `could not inspect processes (${(ps.stderr || '').trim() || `exit ${ps.status}`})`);
  } else {
    const expected = `bash ${pollerIdentity}`;
    const matches = ps.stdout.split('\n').filter(line => {
      const command = line.trim().replace(/^\d+\s+/, '');
      return command === expected || command.startsWith(`${expected} `);
    });
    if (matches.length === 1) pass('POLLER', `exactly one bash process matches ${pollerIdentity}`);
    else if (matches.length === 0 && ps.stdout.includes(path.basename(pollerIdentity)))
      fail('POLLER', `the poller is running under a different path; relaunch it with the absolute path ${pollerIdentity}`);
    else fail('POLLER', `expected exactly one bash process for "${pollerIdentity}", found ${matches.length}; stop duplicates or arm the missing poller`);
  }
}

// ---- kit drift -----------------------------------------------------------------------
// A copied kit never updates itself. Five checkouts on this machine each hand-fixed the same
// kernel bug, and one copy was too old to serve its own Surface. The poller path tells us where
// the copy lives, so the comparison costs nothing extra.
if (!skipPoller && pollerIdentity){
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
  const kit = path.dirname(pollerIdentity);
  const digest = file => { try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12); } catch { return null; } };
  const drift = [['atelier.mjs','atelier.mjs'], ['atelier.css','atelier.css'], ['server.mjs','review-server.mjs'], ['poll.sh','review-poll.sh']]
    .map(([source, copy]) => ({ copy, canonical: digest(path.join(assets, source)), local: digest(path.join(kit, copy)) }))
    .filter(file => file.canonical && file.canonical !== file.local);
  if (!drift.length) pass('KIT', `${kit} matches ${assets}`);
  else {
    const detail = drift.map(f => `${f.copy} (${f.local ? `is ${f.local}, canonical is ${f.canonical}` : 'missing'})`).join(', ');
    if (allowKitDrift) pass('KIT', `deliberate local kit: ${detail}`);
    else fail('KIT', `this Surface runs a kit that differs from ${assets}: ${detail}; re-copy the kit, or pass --allow-kit-drift if the local change is deliberate and recorded`);
  }
}

// ---- rendered Surface ----------------------------------------------------------------
// Region identity, hosts and reachability can only be judged after the kernel has drawn the page,
// so this runs in a real browser rather than over the HTML source.
const probe = `(async () => {
  const kernel = await import('/atelier.mjs').catch(() => null);
  for (let i = 0; i < 40 && kernel?.getState && !kernel.getState(); i++) await new Promise(r => setTimeout(r, 125));
  const keyOf = el => { const ks = []; for (let e = el; e; e = e.parentElement?.closest('[atl-key]')) ks.unshift(e.getAttribute('atl-key')); return ks.join('/'); };
  const describe = el => (el.querySelector('h1,h2,h3')?.textContent || el.textContent || '').trim().slice(0, 40) || '(empty Region)';
  const regions = [...document.querySelectorAll('[atl-key]')];
  const keys = regions.map(keyOf);
  const unnamed = regions.filter(r => !r.getAttribute('atl-key').trim()).map(describe);
  const slashed = regions.map(r => r.getAttribute('atl-key')).filter(k => k.includes('/'));
  const duplicates = [...new Set(keys.filter((k, i) => k && keys.indexOf(k) !== i))];
  // Every open question and every Thread waiting for a verdict needs a host the human can reach.
  const activities = document.querySelectorAll('atelier-activity').length;
  const hosts = [...document.querySelectorAll('atelier-host')];
  const fors = hosts.map(h => (h.getAttribute('for') || '').trim());
  const catchAlls = fors.filter(f => !f).length;
  const duplicateHosts = [...new Set(fors.filter((f, i) => f && fors.indexOf(f) !== i))];
  const unclaimed = catchAlls ? [] : keys.filter(k => !fors.some(f => f && (k === f || k.startsWith(f + '/'))));
  // Viewers and diagrams render after load; give their anchors up to 5 s to resolve before failing.
  let unresolved = kernel?.unresolvedAnchors ? kernel.unresolvedAnchors() : [];
  for (let i = 0; i < 20 && unresolved.length; i++) {
    await new Promise(r => setTimeout(r, 250)); unresolved = kernel.unresolvedAnchors();
  }

  // Diagrams are agent-authored: whatever renders one must mark it ready and keep prose behind it,
  // or a screenshot of a blank box is the only evidence anyone will ever have.
  const diagrams = [...document.querySelectorAll('[data-diagram]')];
  const diagramFailures = diagrams.flatMap(fig => {
    const key = fig.dataset.diagram || 'unnamed-diagram';
    if (fig.dataset.diagramReady !== 'true') return [{ key, reason: 'never set data-diagram-ready="true"' }];
    const svg = fig.querySelector('svg'), box = svg?.getBoundingClientRect();
    const drawn = !!svg && box.width >= 80 && box.height >= 40;
    const prose = (fig.querySelector('[data-diagram-fallback]')?.textContent || '').trim();
    if (!drawn) return [{ key, reason: 'no SVG of a readable size was rendered' }];
    if (prose.length < 10) return [{ key, reason: 'no [data-diagram-fallback] prose survives without the renderer' }];
    return [];
  });

  // The agent's own prose, one block at a time: quoted source, code, diffs, diagrams, kernel chrome,
  // and [data-subject-ui] (instructions for an interface that is itself under review) are not prose.
  const SKIP = 'pre,code,kbd,samp,blockquote,q,svg,script,style,template,[hidden],.file-view,.d2h-wrapper,.cm-editor,'
    + '[data-verbatim],[data-subject-ui],atelier-host,atelier-activity,[class^="atl-"],[class*=" atl-"]';
  const inline = el => /^inline|^contents$/.test(getComputedStyle(el).display);
  const own = el => [...el.childNodes].map(n => n.nodeType === 3 ? n.data
    : n.nodeType === 1 && !n.matches(SKIP) && inline(n) ? own(n) : ' ').join('');
  const prose = [...document.body.querySelectorAll('*')].filter(el => !el.closest(SKIP) && !inline(el))
    .map(el => ({ region: el.closest('[atl-key]') ? keyOf(el.closest('[atl-key]')) : '(outside Regions)', text: own(el) }))
    .filter(block => block.text.trim());

  const doc = document.documentElement;
  const overflow = doc.scrollWidth > doc.clientWidth + 1
    ? [{ selector:'document', width: doc.scrollWidth, viewport: doc.clientWidth }] : [];
  document.querySelectorAll('[atl-key], [atl-key] *, atelier-host *').forEach(el => {
    if (overflow.length >= 8) return;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement){
      const x = getComputedStyle(p).overflowX;
      if (x === 'auto' || x === 'scroll') return;   // inside its own scroller: fine
    }
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.right > doc.clientWidth + 1)
      overflow.push({ selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : ''),
        right: Math.round(rect.right), viewport: doc.clientWidth });
  });
  const warning = (document.querySelector('.atl-warnings')?.innerText || '').replace(/^×\\s*/, '').trim();
  const firstScreen = regions.filter(r => { const b = r.getBoundingClientRect(); return b.height > 0 && b.top < innerHeight && b.bottom > 0; }).length;

  const state = kernel?.getState?.();
  const open = (state?.items || []).filter(i => i.kind === 'proposal' ? i.status === 'open' || i.status === 'pending'
    : i.kind === 'thread' && i.status === 'implemented');
  const slotOf = id => [...document.querySelectorAll('atelier-host [data-slot]')].find(s => s.dataset.slot === id);
  const unhosted = open.filter(i => !slotOf(i.id)).map(i => i.id + ' in ' + i.region);
  const unreachable = [];
  for (const i of open) {
    if (!slotOf(i.id)) continue;
    const shown = await kernel.reveal(i.id);
    let inView = false;
    for (let t = 0; t < 20 && !inView; t++) {
      await new Promise(r => setTimeout(r, 100));
      const b = slotOf(i.id)?.getBoundingClientRect();
      inView = !!b && b.width > 0 && b.height > 0 && b.top < innerHeight && b.bottom > 0 && b.left < innerWidth && b.right > 0;
    }
    if (!shown || !inView) unreachable.push(i.id + ' in ' + i.region + (shown ? ' (outside the screen)' : ' (reveal failed)'));
  }

  return JSON.stringify({
    viewport: { width: innerWidth, height: innerHeight },
    title: document.title,
    kernel: !!customElements.get('atelier-host') && !!state,
    offline: doc.hasAttribute('data-atl-offline'),
    warning, visibleText: (document.body.innerText || '').trim().length,
    regionCount: regions.length, keys, unnamed, slashed, duplicates, activities, catchAlls, duplicateHosts, unclaimed,
    unhosted, unreachable, openItems: open.length, unresolved, diagramCount: diagrams.length, diagramFailures, overflow, prose,
    pageHeight: doc.scrollHeight, firstScreen,
  });
})()`;

const browser = (argv, input, timeout = 30000) => spawnSync('agent-browser', argv, { encoding:'utf8', input, timeout });
function decode(raw){
  let value = JSON.parse(raw.trim());
  if (value && typeof value === 'object' && Object.hasOwn(value, 'data')) value = value.data;
  if (typeof value === 'string') value = JSON.parse(value);
  return value;
}

// The owner reads on a laptop and on two phones; desktop is not evidence for either phone.
const VIEWS = [{ name:'desktop', width:1440, height:900 }, { name:'phone', width:390, height:844 }, { name:'phone-large', width:412, height:915 }];
const reports = [];
if (!skipRender && state){
  if (spawnSync('agent-browser', ['--version'], { encoding:'utf8' }).status !== 0){
    fail('BROWSER', 'agent-browser is unavailable; install its browser backend before claiming the Surface renders');
  } else {
    const session = `atelier-preflight-${process.pid}`;
    try {
      if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive:true });
      for (const view of VIEWS){
        const step = (argv, input, timeout) => {
          const r = browser(['--session', session, ...argv], input, timeout);
          if (r.status !== 0) throw new Error(`${view.name}: ${(r.stderr || r.stdout || 'agent-browser failed').trim().slice(0, 300)}`);
          return r.stdout;
        };
        step(['set', 'viewport', String(view.width), String(view.height)]);
        step(['console', '--clear']);
        step(['errors', '--clear']);
        step(['open', url]);
        step(['wait', '--fn', "document.readyState==='complete' && !!customElements.get('atelier-host')"], undefined, 30000);
        // Give diagrams their own bounded wait and never fail on it here: a renderer that never
        // finishes must be reported as that, not as an unexplained timeout.
        browser(['--session', session, 'wait', '--fn',
          "[...document.querySelectorAll('[data-diagram]')].every(f=>f.dataset.diagramReady==='true')"], undefined, 15000);
        if (evidenceDir) step(['screenshot', path.join(evidenceDir, `${view.name}.png`)]);
        const report = decode(step(['eval', '--stdin'], probe, 180000));
        const consoleMessages = decode(step(['console', '--json'])).messages || [];
        const pageErrors = decode(step(['errors', '--json'])).errors || [];
        report.consoleErrors = [...consoleMessages.filter(message => message.type === 'error').map(message => message.text),
          ...pageErrors.map(error => error.text)].filter(Boolean);
        reports.push({ name: view.name, ...report });
        if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, `${view.name}.json`), `${JSON.stringify(report, null, 2)}\n`);
      }
    } catch (error){
      fail('BROWSER', error.message);
    } finally {
      browser(['--session', session, 'close']);
    }
  }
}

const notes = [];
for (const report of reports){
  const gate = `RENDER_${report.name.toUpperCase().replace('-', '_')}`;
  if (!report.kernel) fail(gate, 'the kernel never loaded or never reached its server; check the <script type="module" src="/atelier.mjs"> tag and the server console');
  if (report.offline) fail(gate, 'the page cannot reach its server; nothing the human writes would be delivered');
  if (report.warning) fail(gate, `the Surface is showing a kernel warning: ${report.warning}`);
  if (report.consoleErrors.length) fail(gate, `uncaught browser error(s): ${report.consoleErrors.join(' | ')}`);
  if (!report.title || report.visibleText < 40) fail(gate, 'the rendered page has no meaningful title or content');
  if (!report.regionCount) fail(gate, 'no element carries atl-key; the human would have nothing to comment on');
  if (report.activities !== 1) fail(gate, `found ${report.activities} <atelier-activity>; a Surface needs exactly one, or waiting decisions and Updates are unreachable`);
  if (report.catchAlls > 1) fail(gate, `found ${report.catchAlls} catch-all <atelier-host> elements without for=; keep at most one`);
  if (report.duplicateHosts.length) fail(gate, `two hosts share for="${report.duplicateHosts.join('", "')}"; each address needs exactly one host`);
  if (report.unhosted.length) fail(gate, `open item(s) have no host on the page: ${report.unhosted.join(', ')}; add an <atelier-host for="…"> for that Region or one catch-all <atelier-host>`);
  if (report.unreachable.length) fail(gate, `open item(s) cannot be brought on screen with reveal(): ${report.unreachable.join(', ')}; make the host visible, or register setRevealResolver to select its record`);
  if (report.unresolved.length) fail(gate, `${report.unresolved.length} stored Thread/Proposal anchor(s) no longer find their target: ${report.unresolved.map(u => `${u.id} in ${u.region} (${u.reason})`).join(', ')}; restore the text or tell the human in that Thread`);
  if (report.unnamed.length) fail(gate, `Region(s) with an empty atl-key: ${report.unnamed.join(' | ')}`);
  if (report.slashed.length) fail(gate, `atl-key holds one local key; nesting builds the path, so remove the slash from: ${report.slashed.join(', ')}`);
  if (report.duplicates.length) fail(gate, `duplicate Region keys silently merge their Threads: ${report.duplicates.join(', ')}`);
  if (report.diagramFailures.length) fail(gate, `diagram(s) are not reviewable: ${report.diagramFailures.map(d => `${d.key} — ${d.reason}`).join('; ')}`);
  if (report.overflow.length) fail(gate, `horizontal overflow: ${JSON.stringify(report.overflow)}`);
  notes.push(`INFO LAYOUT_${report.name.toUpperCase().replace('-', '_')}: ${report.viewport.width}x${report.viewport.height}, page height ${report.pageHeight}px, `
    + `${report.firstScreen} of ${report.regionCount} Region(s) on the first screen`
    + (report.unclaimed.length ? `, ${report.unclaimed.length} Region(s) where a new Thread has no host: ${report.unclaimed.slice(0, 6).join(', ')}` : ''));
  if (report.name === 'desktop'){
    // Update cards are the agent's prose too, even though the kernel renders them in the drawer.
    const updates = Object.values(state.updates || {}).filter(u => !u.dismissedAt)
      .map(u => ({ region: `${u.region} Update`, text: `${u.title || ''}. ${u.body || ''}` }));
    const meta = metaFindings(report.prose.concat(updates));
    if (meta.length) notes.push(`WARN PROSE: ${meta.length} sentence(s) may describe the page instead of its subject:\n`
      + meta.map(f => `  - "${f.sentence}" (Region ${f.region}; ${f.rule})`).join('\n') + `\n  Repair: ${REPAIR}`);
    else pass('PROSE', `${report.prose.length} prose block(s), no sentence matches a known page-describing pattern`);
  }
  if (!failures.some(message => message.startsWith(`FAIL ${gate}:`))){
    pass(gate, `${report.viewport.width}x${report.viewport.height}: ${report.regionCount} Region(s) with unique keys, one Activity, `
      + `${report.openItems} open item(s) hosted and reachable, 0 unresolved anchors, ${report.diagramCount} diagram(s), no overflow`);
  }
}
if (!skipRender && state && !failures.some(m => m.startsWith('FAIL BROWSER:'))
    && !VIEWS.every(view => reports.some(r => r.name === view.name))){
  fail('BROWSER', `expected ${VIEWS.map(v => v.name).join(', ')} reports, found ${reports.map(r => r.name).join(', ') || 'none'}`);
}

passes.forEach(message => console.log(message));
notes.forEach(message => console.log(message));
failures.forEach(message => console.error(message));
if (failures.length){
  console.error('PREFLIGHT=FAIL');
  console.error('NEXT=Fix every FAIL line and rerun preflight before involving the human.');
  process.exit(1);
}
console.log('PREFLIGHT=PASS (render checks)');
// Only a screenshot verdict for this exact content may send the human to the page.
let hash = null, verdict = null;
try { hash = await contentHash(); } catch (error){ console.log(`INFO VISUAL: cannot hash the served content (${error.message})`); }
try { verdict = JSON.parse(fs.readFileSync(verdictFile, 'utf8')); } catch {}
const record = `node ${fileURLToPath(import.meta.url)} --url ${url}${evidenceDir ? ` --evidence-dir ${evidenceDir}` : ''} --record-visual pass|fail|unverified --note "…"`;
if (!hash || !verdict || !sameUrl(verdict.url, url) || verdict.contentHash !== hash){
  if (verdict) console.log(`INFO VISUAL: ${verdictFile} judged ${verdict.url} at content ${verdict.contentHash}; the page is now ${hash}`);
  console.log(`NEXT=visual judgment pending — delegate a read-only screenshot pass at 1440x900 and 390x844 to a background subagent, which records: ${record}`);
} else if (verdict.verdict === 'pass'){
  console.log(`NEXT=Open ${url} for the human and keep the poller armed.`);
} else if (verdict.verdict === 'fail'){
  console.log(`NEXT=fix: ${(verdict.findings || []).join('; ') || 'the screenshot pass failed without findings'} — then rerun preflight and a new screenshot pass.`);
} else {
  console.log(`NEXT=Hand over labelled UNVERIFIED: ${verdict.reason || (verdict.findings || []).join('; ') || 'no reason recorded'}; tell the human what state they need to see it (${url}).`);
}
