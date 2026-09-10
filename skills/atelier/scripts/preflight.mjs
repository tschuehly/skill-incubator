#!/usr/bin/env node
// Atelier preflight — the gate between "I wrote a Surface" and "the human is looking at it".
//
//   node <skill-dir>/scripts/preflight.mjs --url http://127.0.0.1:<port> \
//     --poller-identity /abs/path/to/tools/review-poll.sh [--evidence-dir .review/preflight]
//
// It checks silent handoff defects: store and poller reachability, kit drift, Region identity and
// references, browser errors and kernel warnings, overflow, and diagram rendering.
//
// --skip-poller / --skip-render exist for kernel tests. Neither is a human handoff.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
let url = '', pollerIdentity = '', evidenceDir = '', skipPoller = false, skipRender = false, allowKitDrift = false;
while (args.length){
  const arg = args.shift();
  if (arg === '--url') url = args.shift() || '';
  else if (arg === '--poller-identity') pollerIdentity = args.shift() || '';
  else if (arg === '--evidence-dir') evidenceDir = args.shift() || '';
  else if (arg === '--skip-poller') skipPoller = true;
  else if (arg === '--skip-render') skipRender = true;
  else if (arg === '--allow-kit-drift') allowKitDrift = true;
  else { console.error(`unknown argument: ${arg}`); process.exit(2); }
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
// Region identity and cross-references can only be judged after the kernel has upgraded the
// document, so this runs in a real browser rather than over the HTML source.
const probe = `(() => {
  const regions = [...document.querySelectorAll('atelier-region')];
  const keys = regions.map(r => r.regionKey || '');
  const unnamed = regions.filter(r => !(r.getAttribute('key') || '').trim())
    .map(r => (r.querySelector('h1,h2,h3')?.textContent || r.textContent || '').trim().slice(0, 40) || '(empty Region)');
  const duplicates = [...new Set(keys.filter((k, i) => k && keys.indexOf(k) !== i))];
  const known = new Set(keys);
  const dangling = [...document.querySelectorAll('atelier-attention[for],atelier-comments[for],atelier-proposal[for],atelier-update[for]')]
    .map(el => ({ tag: el.tagName.toLowerCase(), target: el.getAttribute('for') }))
    .filter(ref => !known.has(ref.target));
  const mounted = regions.filter(r => r.querySelector(':scope > .atl-bar')).length;
  // Evidence, never a gate. A sheet Thread mounts no composer until the human clicks, so an
  // all-sheet Surface has nowhere visible to write. The mix makes that choice observable later.
  const placements = regions.reduce((mix, r) => {
    const value = r.getAttribute('comments') || 'below';
    return { ...mix, [value]: (mix[value] || 0) + 1 };
  }, {});

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

  const doc = document.documentElement;
  const overflow = doc.scrollWidth > doc.clientWidth + 1
    ? [{ selector:'document', width: doc.scrollWidth, viewport: doc.clientWidth }] : [];
  document.querySelectorAll('atelier-region *').forEach(el => {
    if (overflow.length >= 8) return;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement){
      const x = getComputedStyle(p).overflowX;
      if (x === 'auto' || x === 'scroll') return;               // inside its own scroller: fine
    }
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.right > doc.clientWidth + 1)
      overflow.push({ selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : ''),
        right: Math.round(rect.right), viewport: doc.clientWidth });
  });

  return JSON.stringify({
    viewport: { width: innerWidth, height: innerHeight },
    title: document.title,
    kernel: !!customElements.get('atelier-region'),
    offline: doc.hasAttribute('data-atl-offline'),
    warning: (document.querySelector('.atl-warn')?.textContent || '').trim(),
    visibleText: (document.body.innerText || '').trim().length,
    regionCount: regions.length, mounted, keys, unnamed, duplicates, dangling, placements,
    diagramCount: diagrams.length, diagramFailures, overflow,
  });
})()`;

const browser = (argv, input, timeout = 30000) => spawnSync('agent-browser', argv, { encoding:'utf8', input, timeout });
function decode(raw){
  let value = JSON.parse(raw.trim());
  if (value && typeof value === 'object' && Object.hasOwn(value, 'data')) value = value.data;
  if (typeof value === 'string') value = JSON.parse(value);
  return value;
}

const reports = [];
if (!skipRender && state){
  if (spawnSync('agent-browser', ['--version'], { encoding:'utf8' }).status !== 0){
    fail('BROWSER', 'agent-browser is unavailable; install its browser backend before claiming the Surface renders');
  } else {
    const session = `atelier-preflight-${process.pid}`;
    try {
      if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive:true });
      for (const view of [{ name:'desktop', width:1440, height:900 }, { name:'narrow', width:390, height:844 }]){
        const step = (argv, input, timeout) => {
          const r = browser(['--session', session, ...argv], input, timeout);
          if (r.status !== 0) throw new Error(`${view.name}: ${(r.stderr || r.stdout || 'agent-browser failed').trim().slice(0, 300)}`);
          return r.stdout;
        };
        step(['set', 'viewport', String(view.width), String(view.height)]);
        step(['console', '--clear']);
        step(['errors', '--clear']);
        step(['open', url]);
        // Wait for the kernel to upgrade the document, not merely for the network to go quiet.
        step(['wait', '--fn', "document.readyState==='complete' && !!customElements.get('atelier-region')"
          + " && [...document.querySelectorAll('atelier-region')].every(r=>r.querySelector(':scope > .atl-bar'))"], undefined, 30000);
        // Give diagrams their own bounded wait and never fail on it here: a renderer that never
        // finishes must be reported as that, not as an unexplained timeout.
        browser(['--session', session, 'wait', '--fn',
          "[...document.querySelectorAll('[data-diagram]')].every(f=>f.dataset.diagramReady==='true')"], undefined, 15000);
        const report = decode(step(['eval', '--stdin'], probe));
        const consoleMessages = decode(step(['console', '--json'])).messages || [];
        const pageErrors = decode(step(['errors', '--json'])).errors || [];
        report.consoleErrors = [...consoleMessages.filter(message => message.type === 'error').map(message => message.text),
          ...pageErrors.map(error => error.text)].filter(Boolean);
        reports.push({ name: view.name, ...report });
        if (evidenceDir){
          fs.writeFileSync(path.join(evidenceDir, `${view.name}.json`), `${JSON.stringify(report, null, 2)}\n`);
          step(['screenshot', path.join(evidenceDir, `${view.name}.png`)]);
        }
      }
    } catch (error){
      fail('BROWSER', error.message);
    } finally {
      browser(['--session', session, 'close']);
    }
  }
}

for (const report of reports){
  const gate = `RENDER_${report.name.toUpperCase()}`;
  if (!report.kernel) fail(gate, 'the kernel never loaded; check the <script type="module" src="/atelier.mjs"> tag and the server console');
  if (report.offline) fail(gate, 'the page cannot reach its server; nothing the human writes would be delivered');
  if (report.warning) fail(gate, `the Surface is showing a kernel warning: ${report.warning}`);
  if (report.consoleErrors.length) fail(gate, `uncaught browser error(s): ${report.consoleErrors.join(' | ')}`);
  if (!report.title || report.visibleText < 40) fail(gate, 'the rendered page has no meaningful title or content');
  if (!report.regionCount) fail(gate, 'no <atelier-region> was rendered; the human would have nothing to comment on');
  if (report.regionCount !== report.mounted) fail(gate, `${report.regionCount - report.mounted} Region(s) never mounted their chrome`);
  if (report.unnamed.length) fail(gate, `Region(s) without a key attribute collide under "unnamed": ${report.unnamed.join(' | ')}`);
  if (report.duplicates.length) fail(gate, `duplicate Region keys silently merge their Threads: ${report.duplicates.join(', ')}`);
  if (report.dangling.length) fail(gate, `element(s) point at a Region that does not exist: ${report.dangling.map(d => `${d.tag} for="${d.target}"`).join(', ')}`);
  if (report.diagramFailures.length) fail(gate, `diagram(s) are not reviewable: ${report.diagramFailures.map(d => `${d.key} — ${d.reason}`).join('; ')}`);
  if (report.overflow.length) fail(gate, `horizontal overflow: ${JSON.stringify(report.overflow)}`);
  if (!failures.some(message => message.startsWith(`FAIL ${gate}:`))){
    pass(gate, `${report.viewport.width}x${report.viewport.height}: ${report.regionCount} Region(s) with unique keys and mounted chrome, ${report.diagramCount} diagram(s), no overflow`
      + `; Thread placement ${Object.entries(report.placements).map(([k,n]) => `${k}=${n}`).join(' ') || 'none'}`);
  }
}
if (!skipRender && state && !failures.some(m => m.startsWith('FAIL BROWSER:'))
    && !['desktop','narrow'].every(name => reports.some(r => r.name === name))){
  fail('BROWSER', `expected a desktop and a narrow report, found ${reports.map(r => r.name).join(', ') || 'none'}`);
}

passes.forEach(message => console.log(message));
failures.forEach(message => console.error(message));
if (failures.length){
  console.error('PREFLIGHT=FAIL');
  console.error('NEXT=Fix every FAIL line and rerun preflight before involving the human.');
  process.exit(1);
}
console.log('PREFLIGHT=PASS');
console.log(`NEXT=Open ${url} for the human and keep the poller armed.`);
