#!/usr/bin/env node
// Self-check of faceoff.mjs's pure functions on in-memory inputs: node faceoff-selfcheck.mjs
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { adjudicationStopBelow, appReadings, blockStopAfter, capStop, caseFingerprint, livePr, LOCK_BUSY, lockedArgv, readCasesFile, registerCase, trialCap, codexbarReading, floorSkip, isComplete, liveCaseId, mergeReadings, needsRelabel, resolveCampaign, materialCount, pairStats, pct, quotaFinal, quotaStop, recallDefects, recallPossible } from "./faceoff.mjs";

const at = Date.parse("2026-11-09T13:00:00Z");
const fresh = "2026-11-09T12:50:00Z", stale = "2026-11-09T10:00:00Z";
const ok = (name) => console.log(`ok  ${name}`);

// 1. A stale app reading does not block a fresh CLI reading.
let q = mergeReadings("claude", [
  codexbarReading("codexbar-app", { updatedAt: stale, secondary: { usedPercent: 12 } }),
  codexbarReading("codexbar-cli", { updatedAt: fresh, primary: { usedPercent: 95 }, secondary: { usedPercent: 13 } }),
], at);
assert.equal(q.state, "fresh");
assert.equal(q.windows.find((w) => w.id === "codexbar:secondary").source, "codexbar-cli", "freshest reading wins per window");
assert.match(quotaStop(q), /codexbar:primary quota at 5%/);
assert.equal(quotaStop(mergeReadings("claude", [codexbarReading("codexbar-app", { updatedAt: stale, primary: { usedPercent: 95 } })], at)), null, "stale only never stops");
ok("stale app + fresh CLI primary 5% => stop");

// 2. The app's windows are a display subset: a CLI-only window still stops.
q = mergeReadings("claude", [
  codexbarReading("codexbar-app", { updatedAt: fresh, secondary: { usedPercent: 12 } }),
  codexbarReading("codexbar-cli", { updatedAt: "2026-11-09T12:40:00Z", primary: { usedPercent: 95 } }),
], at);
assert.deepEqual(q.windows.map((w) => [w.id, w.percentRemaining]).sort(), [["codexbar:primary", 5], ["codexbar:secondary", 88]]);
assert.match(quotaStop(q), /codexbar:primary/);
ok("fresh app weekly 88% + CLI primary 5% => stop");

// 3. agy reads Antigravity only, never the Gemini plan.
const snapshot = { entries: [{ provider: "gemini", updatedAt: fresh, primary: { usedPercent: 99 } }] };
assert.deepEqual(appReadings(["antigravity"], snapshot), []);
assert.equal(appReadings(["gemini"], snapshot).length, 1);
ok("agy ignores the Gemini entry");

// 4. A changed answer key (or a file without a fingerprint) relabels.
const c = { id: "x", defects: [{ id: "d1", description: "a" }] };
assert.equal(needsRelabel({ fingerprint: caseFingerprint(c) }, c), false);
assert.equal(needsRelabel({ fingerprint: caseFingerprint(c) }, { ...c, defects: [{ id: "d2", description: "b" }] }), true);
assert.equal(needsRelabel({ items: [] }, c), true);
assert.equal(needsRelabel(null, c), false);
ok("fingerprint mismatch => relabel");

// 5 and 6. Blind-only pairs render "-"; exploratory cases stay out of recall.
const cases = [
  { id: "blind", defects: [] },
  { id: "expl", exploratory: true, defects: [{ id: "e1" }] },
  { id: "real", defects: [{ id: "r1" }, { id: "r2" }] },
];
const row = (cs, arm, defects) => ({ key: `${cs}|${arm}|0`, case: cs, arm, adjudicated: true, defects, validClusters: ["v"], tokens: 1 });
let rows = [row("blind", "a", []), row("blind", "b", [])];
let p = pairStats(rows, cases, "a", "b", 1);
assert.equal(p.possible, 0);
assert.equal(pct(p.found, p.possible), "-");
ok("blind-only pair => -");

rows = [row("expl", "a", ["e1"]), row("expl", "b", ["e1"]), row("real", "a", ["r1"]), row("real", "b", [])];
assert.deepEqual(recallDefects(rows[0], cases), []);
assert.equal(recallPossible("expl", cases), 0);
p = pairStats(rows, cases, "a", "b", 1);
assert.deepEqual([p.n, p.found, p.possible, p.extras], [2, 1, 2, 2], "exploratory counts extras, not recall");
assert.equal(pct(p.found, p.possible), "50%");
ok("exploratory excluded from recall");

// 7. An exploratory defect hit is in both lists after scoring; it counts as one real problem.
assert.equal(materialCount({ defects: ["e1"], validClusters: ["e1", "v1"] }), 2);
ok("exploratory hit counted once");
// 8. A quota message as the final text is rate-limited and stops the block; a review mentioning rate limits is not.
const limit = "Usage Limit Reached. Your limit will reset in 6 days";
assert.ok(quotaFinal(limit));
assert.match(blockStopAfter({ key: "k", status: "rate-limited", rateLimited: true, reason: quotaFinal(limit) }, {}, true), /rate limit on k/);
const review = 'Looks fine.\n```json\n[{"file": "a.ts", "line": 3, "problem": "no rate limit on the retry loop"}]\n```';
assert.equal(quotaFinal(review), null);
assert.equal(blockStopAfter({ key: "k", status: "done", rateLimited: false }, { stopOnFirstFailure: true }, false), null);
ok("quota final => rate-limited, block stops; findings mentioning rate limit => done");
// 9. Pi failing to start (no tokens, no turns) stops the block; an API error after work follows the old rules.
const warn = "Warning: Could not read /h/.pi/agent/AGENTS.md: Error: EPERM: operation not permitted\n";
const startup = warn + 'Error: Failed to load extension "/x/ext": Extension path does not exist: /x/ext\nHint: Start without extensions using "pi -ne".\n';
assert.match(blockStopAfter({ key: "k", status: "error", rateLimited: false, tokens: null, turns: 0, reason: startup }, {}, true), /pi failed to start on k: Failed to load extension/);
assert.match(blockStopAfter({ key: "k", status: "error", rateLimited: false, tokens: null, turns: 0, reason: "Error: ENOENT: no such file or directory, lstat '/x'" }, {}, true), /pi failed to start/);
assert.equal(blockStopAfter({ key: "k", status: "error", rateLimited: false, tokens: null, turns: 0, reason: warn + "something else" }, {}, true), null, "startup EPERM warning alone is not a failure");
assert.equal(blockStopAfter({ key: "k", status: "error", rateLimited: false, tokens: 7655, turns: 2, reason: "xAI API error: Responses failed. No API key" }, {}, true), null, "spent tokens => existing rules");
assert.equal(blockStopAfter({ key: "k", status: "error", rateLimited: false, tokens: null, turns: 1, reason: "Error: Failed to load extension" }, {}, true), null, "took turns => existing rules");
assert.ok(blockStopAfter({ key: "m", status: "error", rateLimited: false, tokens: null, turns: 0, reason: 'Error: Model "openai-codex/nope" not found' }, {}, true), "pi's quoted model-not-found diagnostic stops the block");
ok("startup failure without tokens => block stops; API error after tokens => unchanged");
// 10. Eval campaign: a floor skip writes a skipped-quota record that is not complete; above the floor or stale, no skip.
const t = { key: "live|sol-low|0", case: "live", arm: "sol-low", rep: 0, provider: "codex" };
const low = { provider: "codex", state: "fresh", windows: [{ id: "weekly", percentRemaining: 45 }] };
const skip = floorSkip(t, low, 50);
assert.deepEqual([skip.status, skip.key, skip.provider, skip.window, skip.percent], ["skipped-quota", t.key, "codex", "weekly", 45]);
assert.equal(isComplete(skip), false, "a skipped trial is retried later");
assert.equal(floorSkip(t, low, 40), null);
assert.equal(floorSkip(t, { ...low, state: "stale" }, 50), null);
assert.equal(floorSkip(t, low, undefined), null, "a provider without a floor never skips");
ok("floor skip => skipped-quota record, not complete");
// 11. Two lockf-wrapped runners started at once: exactly one runs, the other exits 75.
const tmp = mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "faceoff-lock-"));
const lock = path.join(tmp, "runner.lock");
const lockf = (script, onSpawn) => new Promise((resolve) => {
  const child = spawn("/usr/bin/lockf", lockedArgv(lock, [process.execPath, "-e", script]), { stdio: "ignore" });
  onSpawn?.(child);
  child.on("close", (code, signal) => resolve(code ?? signal));
});
const ran = path.join(tmp, "ran");
const hold = `require("fs").appendFileSync(${JSON.stringify(ran)}, "x"); setTimeout(() => {}, 1500)`;
assert.deepEqual((await Promise.all([lockf(hold), lockf(hold)])).sort(), [0, LOCK_BUSY]);
assert.equal(readFileSync(ran, "utf8"), "x", "exactly one runner ran");
ok("two lockf runners at once: one runs, the other exits 75");
// 11b. A runner killed with SIGKILL leaves the lock free: the next runner takes it with no cleanup.
const pidFile = path.join(tmp, "pid");
const killed = lockf(`require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000)`);
const waitFor = (f) => new Promise((resolve) => { const t = setInterval(() => existsSync(f) && readFileSync(f, "utf8") && (clearInterval(t), resolve()), 20); });
await waitFor(pidFile);
assert.equal(await lockf(""), LOCK_BUSY, "held while the runner lives");
process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
await killed;
assert.equal(await lockf(""), 0, "free after SIGKILL");
ok("SIGKILLed runner leaves the lock free");
// 12. Case id from repo, PR and sha; a campaign selects its own dirs.
assert.equal(liveCaseId("embabel-agent-experimental", "50", "0123456789abcdef"), "live-embabel-agent-experimental-50-01234567");
const cfg = JSON.parse(readFileSync(new URL("./faceoff.json", import.meta.url), "utf8"));
const ev = resolveCampaign(cfg, "eval");
assert.match(ev.results, /\/\.pi-workbench\/evals\/results\/prr-eval$/);
assert.ok(!ev.casesDir.endsWith("/evals/cases") && ev.casesFile.startsWith(ev.results), "own cases dir and file");
assert.deepEqual([ev.arms.length, ev.repetitions, ev.floors, ev.minFreeDiskGB], [8, 1, { codex: 50, xai: 40, meta: 35, claude: 40 }, 50]);
assert.ok(ev.arms.every((a) => cfg.arms[a] && !cfg.arms[a].retired));
assert.equal(resolveCampaign(cfg, undefined), null, "no campaign => face-off defaults");
const file = path.join(tmp, "c.json");
writeFileSync(file, JSON.stringify({ ...cfg.campaigns.eval, results: path.join(tmp, "r"), casesDir: path.join(tmp, "r/cases"), casesFile: path.join(tmp, "r/cases.json"), reports: path.join(tmp, "rep") }));
assert.equal(resolveCampaign(cfg, file).results, path.join(tmp, "r"));
assert.throws(() => resolveCampaign(cfg, "nope"), /unknown campaign/);
ok("case id from repo/pr/sha; campaign selects its own dirs");
// 13. Caps: the face-off caps all recorded trials (unchanged); an eval campaign caps only one pass.
assert.deepEqual(trialCap("meta", null), { cap: 80, perPass: false });
assert.deepEqual(trialCap("codex", null), { cap: null, perPass: false });
assert.equal(capStop(trialCap("meta", null), 0, 80), "trial cap 80 reached");
assert.equal(capStop(trialCap("meta", null), 0, 79), null);
assert.deepEqual([trialCap("xai", ev).cap, trialCap("meta", ev).cap, trialCap("codex", ev).cap], [60, 60, null]);
assert.equal(capStop(trialCap("meta", ev), 0, 500), null, "eval keeps running after 60 recorded trials");
assert.equal(capStop(trialCap("meta", ev), 60, 500), "trial cap 60 per pass reached");
ok("trial caps: face-off total, eval per pass");
// 14. Judging floor: eval adjudication stops below claude 40%, the face-off below 35%.
const claude38 = { provider: "claude", state: "fresh", windows: [{ id: "weekly", percentRemaining: 38 }] };
assert.deepEqual([adjudicationStopBelow(ev), adjudicationStopBelow(null)], [40, 35]);
assert.match(quotaStop(claude38, adjudicationStopBelow(ev)), /38% \(< 40%\)/);
assert.equal(quotaStop(claude38, adjudicationStopBelow(null)), null);
assert.equal(quotaStop(claude38), null, "face-off default threshold unchanged");
ok("adjudication floor: eval 40, face-off 35");
// 15. Concurrent case registrations all land.
const casesFile = path.join(tmp, "reg/cases.json");
const mod = new URL("./faceoff.mjs", import.meta.url).href;
const ids = Array.from({ length: 12 }, (_, i) => `c${i}`);
await Promise.all(ids.map((id) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(mod)}); m.registerCase(${JSON.stringify(casesFile)}, { id: ${JSON.stringify(id)} });`], { stdio: "inherit" });
  child.on("close", (code) => (code ? reject(new Error(`registrar ${id} exited ${code}`)) : resolve()));
})));
assert.deepEqual(readCasesFile(casesFile).map((x) => x.id).sort(), [...ids].sort());
assert.equal(registerCase(casesFile, { id: "c0" }), false, "a registered case is not added twice");
writeFileSync(casesFile, JSON.stringify([{ id: "old" }, { id: "c1" }]));
assert.equal(registerCase(casesFile, { id: "old" }), false, "a case in cases.json is not added twice");
assert.deepEqual(readCasesFile(casesFile).map((x) => x.id), ["old", "c1", ...ids.filter((id) => id !== "c1").sort()], "union of cases.json and cases.d");
ok("12 concurrent registrations, none lost; cases.json ∪ cases.d");
// 16. A hostile PR branch name reaches git as an argument, never a shell.
const pwned = path.join(tmp, "pwned");
const g = (cwd, ...a) => { const r = spawnSync("git", a, { cwd, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const origin = path.join(tmp, "origin"), clone = path.join(tmp, "clone"), bin = path.join(tmp, "bin");
mkdirSync(origin); g(origin, "init", "-q", "-b", "main");
g(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base");
g(origin, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "head");
const head = g(origin, "rev-parse", "HEAD"), base = g(origin, "rev-parse", "HEAD~1");
g(origin, "update-ref", "refs/pull/7/head", head);
g(origin, "reset", "-q", "--hard", base);
g(tmp, "clone", "-q", origin, clone);
mkdirSync(bin);
const headRefName = `$(touch ${pwned})`;
writeFileSync(path.join(bin, "gh"), `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify({ headRefOid: head, headRefName, baseRefName: "main", url: "https://github.com/o/r/pull/7" })}\nEOF\n`);
chmodSync(path.join(bin, "gh"), 0o755);
const savedPath = process.env.PATH;
process.env.PATH = `${bin}:${savedPath}`;
try {
  const live = livePr(clone, 7);
  assert.deepEqual([live.info.headRefOid, live.base], [head, base], "fork-head fallback fetched the PR head");
} finally { process.env.PATH = savedPath; }
assert.ok(!existsSync(pwned), "branch name ran as a command");
ok("hostile branch name is never run");
console.log("faceoff self-check passed");
