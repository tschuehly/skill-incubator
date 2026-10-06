#!/usr/bin/env node
// Atelier preflight — the gate between "I wrote a Surface" and "the human is looking at it".
//
//   node <skill-dir>/scripts/preflight.mjs --url http://127.0.0.1:<port> \
//     --poller-identity /abs/path/to/tools/review-poll.sh [--evidence-dir .review/preflight]
//   node <skill-dir>/scripts/preflight.mjs --lint-only surface.html [--state store.json | --url <surface-url>] [--root <dir>]
//
// It checks silent handoff defects without a browser: store and poller reachability, kit drift, and
// a static lint of the Surface source (scripts/lint.mjs) — atl-key Regions, hosts and Activity,
// building-block sources, page-describing prose, the verdict rules, suggested options, which host
// each open item lands in, and stored anchor quotes. It does not run the page: browser errors,
// overflow, layout, real rendering and reveal() are not checked (owner decision 2026-10-06, ADR 0007).
// A pass sends the human to the page; no screenshot or browser walk is required before handoff.
//
// --skip-poller exists for kernel tests. It is not a human handoff.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lintSurface, NOT_CHECKED } from './lint.mjs';

const args = process.argv.slice(2);
let url = '', pollerIdentity = '', evidenceDir = '', skipPoller = false, allowKitDrift = false, lintOnly = '', stateFile = '', root = '';
while (args.length){
  const arg = args.shift();
  if (arg === '--url') url = args.shift() || '';
  else if (arg === '--poller-identity') pollerIdentity = args.shift() || '';
  else if (arg === '--evidence-dir') evidenceDir = args.shift() || '';
  else if (arg === '--skip-poller') skipPoller = true;
  else if (arg === '--allow-kit-drift') allowKitDrift = true;
  else if (arg === '--lint-only') lintOnly = args.shift() || '';
  else if (arg === '--state') stateFile = args.shift() || '';
  else if (arg === '--root') root = args.shift() || '';
  else { console.error(`unknown argument: ${arg}`); process.exit(2); }
}
if (!lintOnly && (!url || (!skipPoller && !pollerIdentity))){
  console.error('usage: preflight.mjs --url <surface-url> --poller-identity <absolute-poller-path> [--evidence-dir <dir>] [--skip-poller] [--allow-kit-drift]\n'
    + '       preflight.mjs --lint-only <surface.html> [--state <store.json> | --url <surface-url>] [--root <dir>]');
  process.exit(2);
}

const failures = [], passes = [];
const fail = (gate, correction) => failures.push(`FAIL ${gate}: ${correction}`);
const pass = (gate, evidence) => passes.push(`PASS ${gate}: ${evidence}`);
async function runLint(html, options){
  const report = await lintSurface(html, options);
  report.passes.forEach(p => pass(p.gate, p.message));
  report.failures.forEach(f => fail(f.gate, f.message));
  (report.unmeasured || []).forEach(u => passes.push(`UNMEASURED ${u.gate}: ${u.message}`));
  (report.warnings || []).forEach(w => passes.push(`WARN ${w.gate}: ${w.message}`));
  if (evidenceDir){ fs.mkdirSync(evidenceDir, { recursive:true }); fs.writeFileSync(path.join(evidenceDir, 'lint.json'), `${JSON.stringify(report, null, 2)}\n`); }
}
function finish(next){
  passes.forEach(message => console.log(message));
  console.log(NOT_CHECKED);
  failures.forEach(message => console.error(message));
  if (failures.length){
    console.error('PREFLIGHT=FAIL');
    console.error('NEXT=Fix every FAIL line and rerun preflight before involving the human.');
    process.exit(1);
  }
  console.log('PREFLIGHT=PASS');
  console.log(`NEXT=${next}`);
  process.exit(0);
}

// ---- lint only: one file, optionally against a store ---------------------------------
if (lintOnly){
  let html = '';
  try { html = fs.readFileSync(lintOnly, 'utf8'); } catch (error){ console.error(`cannot read ${lintOnly}: ${error.message}`); process.exit(2); }
  let state = null;
  if (stateFile) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  else if (url) state = await fetch(new URL('/api/state', url)).then(r => r.json());
  const base = path.resolve(root || path.dirname(lintOnly));
  const readFile = async p => { try { return fs.readFileSync(path.join(base, p.split('?')[0]), 'utf8'); } catch { return null; } };
  await runLint(html, { state, readFile });
  finish(`${lintOnly} lints clean${state ? ' against its store' : ''}.`);
}

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
  const drift = [['atelier.mjs','atelier.mjs'], ['atelier.css','atelier.css'], ['atelier-blocks.mjs','atelier-blocks.mjs'],
    ['atelier-blocks.css','atelier-blocks.css'], ['server.mjs','review-server.mjs'], ['poll.sh','review-poll.sh']]
    .map(([source, copy]) => ({ copy, canonical: digest(path.join(assets, source)), local: digest(path.join(kit, copy)) }))
    .filter(file => file.canonical && file.canonical !== file.local);
  if (!drift.length) pass('KIT', `${kit} matches ${assets}`);
  else {
    const detail = drift.map(f => `${f.copy} (${f.local ? `is ${f.local}, canonical is ${f.canonical}` : 'missing'})`).join(', ');
    if (allowKitDrift) pass('KIT', `deliberate local kit: ${detail}`);
    else fail('KIT', `this Surface runs a kit that differs from ${assets}: ${detail}; re-copy the kit, or pass --allow-kit-drift if the local change is deliberate and recorded`);
  }
}

// ---- static lint ---------------------------------------------------------------------
// The Surface's own HTML source, as the server serves it, checked without a browser.
if (state){
  try {
    const page = await fetch(new URL('/', url), { signal: AbortSignal.timeout(5000) });
    if (!page.ok) throw new Error(`GET / returned HTTP ${page.status}`);
    const readFile = async p => { try { const r = await fetch(new URL(p, url), { signal: AbortSignal.timeout(5000) }); return r.ok ? await r.text() : null; } catch { return null; } };
    await runLint(await page.text(), { state, readFile });
  } catch (error){ fail('LINT', `could not read the Surface source (${error.message})`); }
}

finish(`Open ${url} for the human and keep the poller armed.`);
