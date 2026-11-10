#!/usr/bin/env node
// Overnight reviewer face-off for production-ready-pr. Wraps pi-workbench's installed pi-eval.mjs, one
// pi-eval run per trial, and adds what pi-eval lacks: provider blocks in parallel, quota/429/cap/disk
// stops, a deadline with resume, pooled blinded adjudication per case, and the report.
//
//   node faceoff.mjs build-cases
//   node faceoff.mjs setup-check
//   node faceoff.mjs probe            (GitHub-credential probe of the trial environment)
//   node faceoff.mjs run [--dry-run] [--deadline HH:MM] [--out DIR] [--cases a,b] [--arms x,y] [--reps N] [--no-adjudicate] [--ledger] [--report FILE]
//   node faceoff.mjs adjudicate [--out DIR] [--cases a,b]
//   node faceoff.mjs report [--out DIR] [--report FILE] [--ledger]
//   node faceoff.mjs repair-quota-trials [--dry-run] [--out DIR]
//   node faceoff.mjs --campaign eval eval <repo> <pr> [--sha SHA] [--arms x,y]   (blind case from a live PR, panel in the background)
//   node faceoff.mjs --campaign eval runner | nightly
//
// --campaign NAME selects faceoff.json `campaigns.NAME` (or a JSON file of that shape): its own results,
// cases and reports dirs, arms, repetitions, per-provider quota floors and disk floor.
//
// Stages share one campaign directory (default results/prr-faceoff): a later stage skips every completed
// trial, adds its own, re-adjudicates only new findings, and rewrites the same report over everything run.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const CFG = JSON.parse(readFileSync(path.join(HERE, "faceoff.json"), "utf8"));
const EVAL_HOME = path.join(HOME, ".pi-workbench/evals");

// A campaign has its own dirs, arms, repetitions and quota floors; without one, the face-off defaults hold.
export function resolveCampaign(cfg, name) {
  if (!name) return null;
  const c = name.endsWith(".json") ? JSON.parse(readFileSync(name, "utf8")) : cfg.campaigns?.[name];
  if (!c) throw new Error(`unknown campaign ${name} (known: ${Object.keys(cfg.campaigns ?? {}).join(", ")})`);
  const p = (x) => path.resolve(x.replace(/^~/, HOME));
  return { ...c, name, results: p(c.results), casesDir: p(c.casesDir), casesFile: p(c.casesFile), reports: p(c.reports) };
}
const argv = process.argv.slice(2);
const campaignAt = argv.indexOf("--campaign");
const CAMPAIGN_ARG = campaignAt >= 0 ? argv.splice(campaignAt, 2)[1]?.replace(/^(.*\.json)$/, (f) => path.resolve(f)) : undefined;
const CAMP = resolveCampaign(CFG, CAMPAIGN_ARG);
const readCases = () => readCasesFile(CAMP.casesFile);
if (CAMP) Object.assign(CFG, { id: CAMP.id ?? CFG.id, cases: readCases(), repetitions: CAMP.repetitions, minFreeDiskGB: CAMP.minFreeDiskGB });
const CASES_DIR = CAMP?.casesDir ?? path.join(EVAL_HOME, "cases");
const PROJECTS = path.join(HOME, "IdeaProjects");
const PI_EVAL = process.env.PI_EVAL_SCRIPT ?? path.join(PROJECTS, "pi-workbench.installed/scripts/pi-eval.mjs");
const LEDGER = process.env.PRR_FACEOFF_LEDGER ?? path.join(HOME, ".pi-workbench/scratch/production-ready-pr-trial/ledger.jsonl");
const RATE_LIMIT = /\b429\b|rate.?limit|too many requests|resource.?exhausted|usage limit|quota exceeded|insufficient.?quota/i;
// A provider out of quota may answer with a normal final message instead of an API error.
const QUOTA_FINAL = /usage limit reached|quota (?:exceeded|exhausted)|rate.?limit|limit will reset|\bresets at\b/i;
// Pi failing to start: every later trial fails the same way. EPERM/ENOENT count only as a line-leading
// error, not the "Warning: Could not read …: Error: EPERM" a normal start prints.
const STARTUP_FAILURE = /failed to load extension|extension path does not exist|no api key|unknown model|model (?:"[^"\n]*" )?not found|^Error: (?:EPERM|ENOENT)\b/im;

const repoPath = (name) => CFG.repos[name].replace(/^~/, HOME);
const sh = (cmd, opts = {}) => spawnSync("bash", ["-c", cmd], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
// No shell: for values that come from outside (PR branch names, revisions).
const exec = (bin, args, opts = {}) => spawnSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
// A temp name no other process writes, renamed over the target.
const uniqueTmp = (file) => `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
const q = JSON.stringify;
const now = () => Date.now();
const iso = (ms = now()) => new Date(ms).toISOString();
const local = (ms) => new Date(ms).toLocaleString("sv-SE", { hour12: false }).slice(0, 16);
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const fullSha = (repo, rev) => exec("git", ["-C", repoPath(repo), "rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]).stdout.trim();

// ---------- arguments ----------
const [cmd, ...rest] = argv;
const flag = (name) => rest.includes(`--${name}`);
const opt = (name) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : undefined);
const list = (name) => opt(name)?.split(",").filter(Boolean);

function deadlineMs(hhmm = CFG.deadline) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
// ponytail: an eval runner starts at any hour, so its pass gets 12 hours instead of the face-off's 07:00.
const DEADLINE = CAMP && !opt("deadline") ? now() + 12 * 3_600_000 : deadlineMs(opt("deadline"));
const OUT = path.resolve(opt("out") ?? CAMP?.results ?? path.join(EVAL_HOME, "results", CFG.id));
const LOCK = path.join(OUT, "runner.lock");
// The campaign's date is fixed by its first stage, so every stage rewrites the same report.
const META = path.join(OUT, "campaign.json");
const DATE = existsSync(META) ? JSON.parse(readFileSync(META, "utf8")).date : new Date().toLocaleDateString("sv-SE");
// A custom --out keeps its report beside its results, so a test run cannot overwrite the campaign report.
const REPORT = path.resolve(opt("report") ?? (opt("out") ? path.join(OUT, "report.md") : CAMP ? path.join(CAMP.reports, "report.md") : path.join(EVAL_HOME, "reports", `${CFG.id}-${DATE}.md`)));
const pick = (name, all) => {
  const want = list(name) ?? (name === "cases" ? list("case") : undefined);
  const unknown = want?.filter((x) => !all.includes(x)) ?? [];
  if (unknown.length) { console.error(`unknown --${name}: ${unknown.join(", ")} (known: ${all.join(", ")})`); process.exit(2); }
  return all.filter((x) => !want || want.includes(x));
};
const pickCases = () => pick("cases", CFG.cases.map((c) => c.id)).map((id) => CFG.cases.find((c) => c.id === id));
let CASES = pickCases();
// A campaign's cases grow while it runs (eval registers them): re-read before adjudicating or reporting.
export function refreshCases() {
  if (CAMP) { CFG.cases = readCases(); CASES = pickCases(); }
  return CASES.map((c) => c.id);
}
const ARMS = pick("arms", CAMP?.arms ?? Object.keys(CFG.arms).filter((a) => !CFG.arms[a].retired));
const REPS = Number(opt("reps") ?? CFG.repetitions);
const TRIALS = path.join(OUT, "trials.jsonl");
const BLOCKS = path.join(OUT, "blocks.jsonl");
const STAGES = path.join(OUT, "stages.jsonl");

// ---------- environment ----------
// Trials must not reach GitHub with Thomas's identity: drop gh/git credentials and agent sockets, point gh
// at an empty config, give git no global or system config (the Xcode system config sets osxkeychain), and
// make git's ssh transport fail. pi-eval's sandbox denies the login keychain and the tools that hand out
// stored credentials (gh, security, git's keychain helper). Pi's model auth (~/.pi/agent/auth.json,
// provider extensions) is untouched.
// A `pi` shim on PATH starts Pi with discovery off and only the extensions a trial needs (the provider
// extensions, telemetry and pi-claude-code-use), so every arm runs with the same small harness.
function piShim() {
  const dir = path.join(HOME, ".pi-workbench/run/prr-faceoff-bin");
  const real = sh("command -v pi", { env: { ...process.env, PATH: process.env.PATH.split(":").filter((p) => p !== dir).join(":") } }).stdout.trim();
  if (!real) throw new Error("pi not found on PATH");
  const exts = CFG.piExtensions.map((e) => `-e ${q(realpathSync(e.replace(/^~/, HOME)))}`).join(" ");
  mkdirSync(dir, { recursive: true });
  // Rewrite only on change: another campaign may be starting Pi through this shim right now.
  const shim = `#!/bin/sh\n# Written by faceoff.mjs: Pi for sandboxed face-off trials.\nexec ${q(real)} --no-extensions ${exts} "$@"\n`;
  const file = path.join(dir, "pi");
  if (!existsSync(file) || readFileSync(file, "utf8") !== shim) { const tmp = uniqueTmp(file); writeFileSync(tmp, shim, { mode: 0o755 }); renameSync(tmp, file); }
  return dir;
}

function trialEnv() {
  const env = { ...process.env, PATH: `${piShim()}:${process.env.PATH}` };
  for (const k of Object.keys(env)) if (/^(GH_|GITHUB|GIT_ASKPASS|SSH_ASKPASS|SSH_AUTH_SOCK|GCM_)|_GH_TOKEN$|GITHUB_TOKEN|COPILOT.*TOKEN/i.test(k)) delete env[k];
  delete env.PI_WORKBENCH_ROUTING_OVERLAY;
  return {
    ...env,
    GH_PROMPT_DISABLED: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "false",
    ...Object.fromEntries(Object.keys(CFG.repos).map((r) => [`PI_EVAL_REPO_${r.toUpperCase()}`, repoPath(r)])),
  };
}

// Evidence that a trial, inside pi-eval's sandbox, holds no GitHub credential. ls-remote of a private repo
// is a read-only, unauthenticated request: it must fail.
function credentialProbe(env) {
  const dir = path.join(OUT, "env", "probe");
  mkdirSync(dir, { recursive: true });
  const script = `names=$(env | cut -d= -f1 | grep -E -i '^(GH_|GITHUB|GIT_ASKPASS|SSH_AUTH_SOCK|GCM_)|TOKEN' | grep -v -x -E 'GH_PROMPT_DISABLED' | tr '\\n' ' ')
gh auth token >/dev/null 2>&1 || security find-generic-password -s gh:github.com -w >/dev/null 2>&1; dummy=$?
gh api user >/dev/null 2>&1; api=$?
helper=$(git config --get-all credential.helper | tr '\\n' ' ')
git ls-remote https://github.com/embabel/me HEAD >/dev/null 2>&1; ls=$?
printf '%s\\n%s\\n%s\\n%s\\n%s\\n' "$names" "$dummy" "$api" "$helper" "$ls"`;
  const r = spawnSync("sandbox-exec", ["-p", sandboxProfile(dir), "bash", "-c", script], { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
  const [names, dummy, api, helper, ls] = r.stdout.split("\n");
  const probe = { credentialEnvVars: names.trim().split(" ").filter(Boolean), ghTokenReadable: dummy === "0", ghApiUserExit: Number(api), gitCredentialHelper: helper.trim() || null, privateRepoLsRemoteExit: Number(ls) };
  probe.clean = !probe.credentialEnvVars.length && !probe.ghTokenReadable && probe.ghApiUserExit !== 0 && !probe.gitCredentialHelper && probe.privateRepoLsRemoteExit !== 0;
  return probe;
}

function quota() {
  try { return JSON.parse(sh("quota-axi --json", { timeout: 60_000 }).stdout).providers; } catch { return null; }
}
// Windows of one quota-axi provider, model-specific windows only for the model in use.
function quotaFor(provider, model = "", snapshot = quota()) {
  const p = snapshot?.find((x) => x.provider === provider);
  const own = p ? { provider, state: p.state?.status ?? "unknown", windows: (p.windows ?? []).filter((w) => !w.id.startsWith("model:") || model.includes(w.id.slice(6))).map((w) => ({ id: w.id, percentRemaining: w.percentRemaining })) } : { provider, state: "absent", windows: [] };
  return own.state === "fresh" ? own : (codexbarQuota(provider) ?? own);
}
// CodexBar reads plans quota-axi cannot (Grok and Gemini through browser sessions; Claude when its quota
// endpoint is rate limited). The app's widget snapshot carries what the app shows, including providers
// its CLI cannot reach without the app's keychain and cookie permissions; the CLI is the fallback.
// A reading counts as fresh when it is under an hour old. agy maps to Antigravity only: CodexBar's Gemini
// plan is a different pool, and its Antigravity CLI reading needs the Antigravity app running.
const CODEXBAR = { grok: ["grok"], claude: ["claude"], codex: ["codex"], agy: ["antigravity"], meta: ["muse", "museai"] };
const CODEXBAR_SNAPSHOT = path.join(HOME, "Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/widget-snapshot.json");
const WINDOW_KEYS = ["primary", "secondary", "tertiary"];
// App snapshot entries and CLI usage both carry primary/secondary/tertiary windows; that key is the window
// identity. The app's usageRows are only what it displays, so they are not used.
export function codexbarReading(source, u) {
  const windows = WINDOW_KEYS.filter((k) => typeof u?.[k]?.usedPercent === "number").map((k) => ({ id: `codexbar:${k}`, percentRemaining: Math.round(100 - u[k].usedPercent) }));
  return windows.length ? { source, updatedAt: u.updatedAt, windows } : null;
}
export const appReadings = (ids, snapshot) => (snapshot?.entries ?? []).filter((e) => ids.includes(e.provider)).map((e) => codexbarReading("codexbar-app", e)).filter(Boolean);
// Per window, the freshest reading wins; the result is fresh when any window is, and each window keeps its own freshness.
export function mergeReadings(provider, readings, at = Date.now()) {
  const best = new Map();
  for (const r of readings) for (const w of r.windows) {
    const t = Date.parse(r.updatedAt ?? 0) || 0;
    if (!best.has(w.id) || t > best.get(w.id).t) best.set(w.id, { t, w: { ...w, source: r.source, fresh: at - t < 3_600_000 } });
  }
  if (!best.size) return null;
  const windows = [...best.values()].map((x) => x.w);
  return { provider, source: [...new Set(windows.map((w) => w.source))].join("+"), state: windows.some((w) => w.fresh) ? "fresh" : "stale", windows };
}
function codexbarQuota(provider) {
  const ids = CODEXBAR[provider];
  if (!ids) return null;
  const readings = [];
  try { readings.push(...appReadings(ids, JSON.parse(readFileSync(CODEXBAR_SNAPSHOT, "utf8")))); } catch {}
  for (const id of ids) {
    try { readings.push(codexbarReading("codexbar-cli", JSON.parse(sh(`codexbar usage --provider ${id} --json --no-color`, { timeout: 60_000 }).stdout)[0]?.usage)); } catch {}
  }
  return mergeReadings(provider, readings.filter(Boolean));
}
// Stale or missing telemetry never stops a block; the provider's trial cap does. Any fresh window below
// the threshold stops it.
export function quotaStop(qf, below = CFG.stopBelowPercent) {
  if (qf.state !== "fresh") return null;
  const low = qf.windows.find((w) => w.fresh !== false && typeof w.percentRemaining === "number" && w.percentRemaining < below);
  return low ? `${qf.provider} ${low.id} quota at ${low.percentRemaining}% (< ${below}%)` : null;
}
// Adjudication stops below the campaign's floor for the adjudicator's quota, else the face-off's threshold.
export const adjudicationStopBelow = (camp) => camp?.floors?.[CFG.adjudicator.quota] ?? CFG.stopBelowPercent;
// The face-off caps a provider's trials over the whole campaign; an eval campaign runs for good, so its
// caps (campaign `maxTrialsPerPass`) count only the trials one pass launches.
export const trialCap = (prov, camp) => (camp ? { cap: camp.maxTrialsPerPass?.[prov] ?? null, perPass: true } : { cap: CFG.providers[prov].maxTrials ?? null, perPass: false });
export const capStop = ({ cap, perPass }, ranThisPass, launchedTotal) => (cap != null && (perPass ? ranThisPass : launchedTotal) >= cap ? `trial cap ${cap}${perPass ? " per pass" : ""} reached` : null);
// An eval campaign skips (not stops at) a trial whose provider has a fresh window below the provider's floor.
// The record is not "done", so a later run retries the trial.
export function floorSkip(t, qf, floor) {
  if (floor == null || qf.state !== "fresh") return null;
  const low = qf.windows.find((w) => w.fresh !== false && typeof w.percentRemaining === "number" && w.percentRemaining < floor);
  return low ? { key: t.key, case: t.case, arm: t.arm, rep: t.rep, provider: t.provider, status: "skipped-quota", window: low.id, percent: low.percentRemaining, floor, startedAt: iso(), endedAt: iso() } : null;
}
const freeGB = () => { const s = statfsSync(HOME); return (s.bavail * s.bsize) / 2 ** 30; };

// ---------- processes ----------
const children = new Set();
function descendants(pid) {
  const rows = sh("ps -A -o pid=,ppid=").stdout.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const out = [pid];
  for (let i = 0; i < out.length; i++) for (const [p, pp] of rows) if (pp === out[i]) out.push(p);
  return out;
}
function killTree(pid) { for (const p of descendants(pid)) try { process.kill(p, "SIGTERM"); } catch {} }
function runChild(command, args, { cwd, env, logFile, timeoutMs }) {
  return new Promise((resolve) => {
    const fd = openSync(logFile, "a");
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", fd, fd], detached: true });
    children.add(child.pid);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); children.delete(child.pid); resolve({ code, timedOut }); });
  });
}
let deadlineHit = false;
function killAll() { for (const pid of children) killTree(pid); }

// ---------- workspaces ----------
// The same snapshot pi-eval builds: archive of the proposed commit, then the case's setup.sh.
function buildWorkspace(c, dir, env) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const caseDir = path.join(CASES_DIR, c.id);
  const commit = JSON.parse(readFileSync(path.join(caseDir, "case.json"), "utf8")).commit;
  let r = sh(`git -C ${q(repoPath(c.repo))} archive ${commit} | tar -x -C ${q(dir)}`);
  if (r.status !== 0) throw new Error(`snapshot failed: ${r.stderr}`);
  r = sh(`bash ${q(path.join(caseDir, "setup.sh"))}`, { cwd: dir, env: { ...env, CASE_DIR: caseDir, SOURCE_REPO: repoPath(c.repo) } });
  if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}${r.stderr}`);
}

// ---------- findings ----------
function parseFindings(text) {
  const blocks = [...(text ?? "").matchAll(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/g)].map((m) => m[1]).reverse();
  for (const b of blocks) { try { const v = JSON.parse(b); if (Array.isArray(v)) return v.filter((f) => f && typeof f === "object"); } catch {} }
  return null;
}
// The quota message in a final text, or null. Only a final without a findings block counts, so a review
// that mentions rate limiting in the code is not misread.
export function quotaFinal(text) {
  if (parseFindings(text)) return null;
  return (text ?? "").match(QUOTA_FINAL) ? (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300) : null;
}
// Why a provider block stops after trial r, or null to go on.
export function blockStopAfter(r, pcfg, providerHasDone) {
  if (r.rateLimited) return `rate limit on ${r.key}: ${String(r.reason).slice(0, 200)}`;
  // A trial that spent no tokens and took no turns never reached the model; a startup error stops the block.
  if (r.status !== "done" && !r.tokens && !r.turns && STARTUP_FAILURE.test(r.reason ?? "")) return `pi failed to start on ${r.key}: ${String(r.reason).match(STARTUP_FAILURE)[0]} (${String(r.reason).replace(/\s+/g, " ").slice(-200)})`;
  // A new provider (stopOnFirstFailure) that fails its first trial is skipped for the rest of the campaign.
  if (pcfg.stopOnFirstFailure && r.status !== "done" && !providerHasDone) return `first trial failed (${r.status}): ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 200)}`;
  return null;
}
const norm = (f) => `${path.basename(String(f.file ?? ""))}|${String(f.line ?? "")}|${String(f.problem ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;

// ---------- build-cases ----------
function buildCases() { for (const c of CFG.cases) buildCase(c); }
function buildCase(c) {
  const dir = path.join(CASES_DIR, c.id);
  mkdirSync(dir, { recursive: true });
  // A blind case (an unreviewed PR) has no fix commit and no known defects; it scores valid findings only.
  const [base, proposed, fix] = [c.base, c.proposed, c.fix].map((r) => r && fullSha(c.repo, r));
  if (!base || !proposed || (c.fix && !fix)) throw new Error(`${c.id}: unknown commit`);
  writeFileSync(path.join(dir, "case.json"), JSON.stringify({
    id: c.id, role: "review", profile: "reviewer", repo: c.repo, commit: proposed, setup: "setup.sh",
    source: c.fix ? `${c.pr} replay: proposed ${c.proposed} (parent of review fix ${c.fix}) against merge-base ${c.base}` : `${c.pr} blind: head ${c.proposed} against merge-base ${c.base}`,
    timeoutMinutes: CFG.trialTimeoutMinutes, prompt: CFG.prompt,
    check: { type: "script", script: "check.sh", timeoutMinutes: 2 },
  }, null, 2) + "\n");
  writeFileSync(path.join(dir, "setup.sh"), `#!/usr/bin/env bash\n# Full merge-base diff (SCOPE=.), neutral subject.\nBASE=${base} PROPOSED=${proposed} SUBJECT="Proposed change" SCOPE=. exec bash ${q(path.join(HERE, "prr-setup.sh"))}\n`);
  writeFileSync(path.join(dir, "check.sh"), `#!/usr/bin/env bash\nexec python3 ${q(path.join(HERE, "prr-check.py"))}\n`);
  writeFileSync(path.join(dir, "defects.json"), JSON.stringify({ pr: c.pr, base, proposed, fix, provenance: c.provenance, defects: c.defects }, null, 2) + "\n");
  console.log(`wrote ${dir}`);
}

// ---------- setup-check ----------
function setupCheck() {
  const env = trialEnv();
  let ok = true;
  console.log("| case | files changed (source) | files in workspace commit | patch identical | defect present in proposed | fix touches it | subject | snapshot MB |\n|---|---|---|---|---|---|---|---|");
  for (const c of CASES) {
    const repo = repoPath(c.repo);
    const present = c.defects.map((d) => new RegExp(d.present[1], "m").test(sh(`git -C ${q(repo)} show ${c.proposed}:${q(d.present[0])}`).stdout));
    const touched = c.defects.map((d) => sh(`git -C ${q(repo)} diff --quiet ${c.proposed} ${c.fix} -- ${q(d.present[0])}`).status === 1);
    const ws = path.join(OUT, "setup-check", c.id);
    let row;
    try {
      buildWorkspace(c, ws, env);
      const expected = sh(`git -C ${q(repo)} diff --no-renames --name-only ${c.base} ${c.proposed}`).stdout.trim().split("\n").filter(Boolean);
      const got = sh("git diff --no-renames --name-only HEAD~1 HEAD", { cwd: ws }).stdout.trim().split("\n").filter(Boolean);
      const same = sh(`git -C ${q(repo)} diff --no-renames --full-index ${c.base} ${c.proposed}`).stdout === sh("git diff --no-renames --full-index HEAD~1 HEAD", { cwd: ws }).stdout;
      const subject = sh("git log -1 --format=%s", { cwd: ws }).stdout.trim();
      const mb = Math.round(Number(sh(`du -sk ${q(ws)}`).stdout.split(/\s/)[0]) / 1024);
      const good = got.length > 0 && got.length === expected.length && same && present.every(Boolean) && touched.every(Boolean);
      ok &&= good;
      row = `| ${c.id} | ${expected.length} | ${got.length} | ${same} | ${present.join("/")} | ${touched.join("/")} | ${subject} | ${mb} |${good ? "" : " ✗"}`;
    } catch (e) { ok = false; row = `| ${c.id} | setup failed: ${String(e.message).slice(0, 200)} |`; }
    rmSync(ws, { recursive: true, force: true });
    console.log(row);
  }
  console.log(ok ? "setup-check: all cases OK" : "setup-check: FAILURES");
  process.exitCode = ok ? 0 : 1;
}

// ---------- schedule ----------
function schedule() {
  const byProvider = {};
  for (let rep = 0; rep < REPS; rep++) CASES.forEach((c, ci) => {
    for (const prov of Object.keys(CFG.providers)) {
      const arms = ARMS.filter((a) => CFG.arms[a].provider === prov);
      // Alternate which arm goes first, so no arm always meets the fresher cache or quota.
      for (const arm of (ci + rep) % 2 ? [...arms].reverse() : arms) (byProvider[prov] ??= []).push({ key: `${c.id}|${arm}|${rep}`, case: c.id, arm, rep, provider: prov });
    }
  });
  return byProvider;
}
function latestTrials() { const m = new Map(); for (const r of readJsonl(TRIALS)) m.set(r.key, r); return m; }
export const isComplete = (r) => !!r && r.status === "done";
function armMinutes(arm, trials) {
  const done = [...trials.values()].filter((r) => r.arm === arm && r.wallMs);
  // Never below the configured estimate: the smoke case is the smallest diff.
  return Math.max(CFG.arms[arm].estimateMinutes, done.length ? done.reduce((a, r) => a + r.wallMs, 0) / done.length / 60_000 : 0);
}

// ---------- run ----------
async function runTrial(t, env) {
  const c = CFG.cases.find((x) => x.id === t.case);
  const arm = CFG.arms[t.arm];
  const safe = t.key.replace(/\|/g, "__");
  const campaignFile = path.join(OUT, "pe", "campaigns", `${safe}.json`);
  // pi-eval resolves cases at <campaign dir>/../cases; the trial's working path names neither case nor arm.
  writeFileSync(campaignFile, JSON.stringify({ id: "review", repetitions: 1, cases: [{ case: t.case, arms: [t.arm] }], arms: { [t.arm]: { model: arm.model, effort: arm.effort } } }, null, 2));
  const qp = CFG.providers[t.provider].quota;
  const record = { key: t.key, case: t.case, pr: c.pr, arm: t.arm, rep: t.rep, provider: t.provider, model: arm.model, effort: arm.effort, startedAt: iso() };
  record.credentialProbe = credentialProbe(env);
  record.quotaBefore = quotaFor(qp, arm.model);
  const logFile = path.join(OUT, "logs", `${safe}.log`);
  writeFileSync(logFile, "");
  const started = now();
  const res = await runChild("node", [PI_EVAL, "run", campaignFile], { cwd: OUT, env: { ...env, ...admissionEnv(t.arm) }, logFile, timeoutMs: (CFG.trialTimeoutMinutes + 15) * 60_000 });
  record.wallMs = now() - started;
  record.quotaAfter = quotaFor(qp, arm.model);
  const log = readFileSync(logFile, "utf8");
  const resultsFile = log.match(/→ (\S+results\.jsonl)/)?.[1];
  const pe = resultsFile && existsSync(resultsFile) ? readJsonl(resultsFile).at(-1) : null;
  record.piEvalResults = resultsFile ?? null;
  if (!pe) {
    Object.assign(record, { status: deadlineHit ? "killed-deadline" : res.timedOut ? "timeout" : "harness-error", reason: log.slice(-600) });
  } else {
    const run0 = pe.runs?.[0];
    const u = run0?.usage;
    const total = u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0;
    // pi-eval turns missing usage into 0; a review cannot use zero tokens, so 0 means unknown.
    Object.assign(record, {
      status: deadlineHit && pe.status !== "done" ? "killed-deadline" : pe.status, reason: pe.reason ?? run0?.error ?? null,
      binding: pe.bindings?.[0] ?? null, check: pe.check ?? null,
      usage: total > 0 ? u : null, tokens: total > 0 ? total : null, outputTokens: total > 0 ? u.output : null,
      modelMs: run0?.elapsedMs ?? null, turns: run0?.turns ?? null, toolCalls: run0?.toolCalls ?? null,
      trialDir: path.join(path.dirname(resultsFile), pe.trialDir ?? "t000"),
    });
    const finalTxt = path.join(record.trialDir, "final.txt");
    if (existsSync(finalTxt)) {
      copyFileSync(finalTxt, path.join(OUT, "finals", `${safe}.txt`));
      const text = readFileSync(finalTxt, "utf8");
      record.findings = parseFindings(text);
      const quotaMsg = quotaFinal(text);
      if (quotaMsg) Object.assign(record, { status: "rate-limited", reason: quotaMsg, rateLimited: true });
    }
  }
  const errText = [record.reason, ...(pe?.runs ?? []).map((r) => r.error)].filter(Boolean).join(" ");
  record.rateLimited = record.status === "rate-limited" || (record.status !== "done" && RATE_LIMIT.test(errText));
  record.endedAt = iso();
  appendFileSync(TRIALS, JSON.stringify(record) + "\n");
  console.log(`${local(now())} ${t.key}: ${record.status}${record.findings ? ` findings=${record.findings.length}` : ""} tokens=${record.tokens ?? "unknown"} ${(record.wallMs / 60000).toFixed(1)}m creds=${record.credentialProbe.clean ? "clean" : "PRESENT"}${record.reason && record.status !== "done" ? ` (${String(record.reason).slice(0, 160)})` : ""}`);
  return record;
}

// The routing policy has no quota mapping for a provider added after it (meta), so pi-eval's admission
// blocks it. A run-scoped routing overlay (the resolver's own mechanism) maps the arm's role to it; pi-eval
// removes the overlay variable before it starts Pi, so only admission sees it.
function admissionEnv(armId) {
  const arm = CFG.arms[armId];
  const quotaProvider = CFG.providers[arm.provider].admissionQuotaProvider;
  if (!quotaProvider) return {};
  const [provider, model] = [arm.model.slice(0, arm.model.indexOf("/")), arm.model.slice(arm.model.indexOf("/") + 1)];
  const file = path.join(OUT, "env", `overlay-${armId}.json`);
  writeFileSync(file, JSON.stringify({
    version: 1,
    allowedModels: [{ provider, model }, { provider: "openai-codex", model: "gpt-6.1-sol" }],
    roles: { implementation: { provider, model, effort: arm.effort, quotaProvider } },
    independentReview: { [arm.model]: { provider: "openai-codex", model: "gpt-6.1-sol", effort: "medium", quotaProvider: "codex" } },
  }, null, 2));
  return { PI_WORKBENCH_ROUTING_OVERLAY: file };
}

async function providerBlock(prov, trials, env, cutoff) {
  const pcfg = CFG.providers[prov];
  const model = CFG.arms[trials[0].arm].model;
  const block = { provider: prov, startedAt: iso(), quotaStart: quotaFor(pcfg.quota, model), ran: 0, stop: null };
  const launched = () => [...latestTrials().values()].filter((r) => r.provider === prov && !["skipped", "skipped-quota"].includes(r.status)).length;
  for (const t of trials) {
    if (isComplete(latestTrials().get(t.key))) continue;
    if (block.stop) break;
    const qf = quotaFor(pcfg.quota, model);
    const skip = CAMP && !deadlineHit && floorSkip(t, qf, CAMP.floors?.[prov]);
    if (skip) { appendFileSync(TRIALS, JSON.stringify(skip) + "\n"); console.log(`${local(now())} ${t.key}: skipped-quota (${skip.window} ${skip.percent}% < ${skip.floor}%)`); continue; }
    block.stop ??= deadlineHit || now() >= cutoff ? `launch cutoff ${local(cutoff)} reached`
      : freeGB() < CFG.minFreeDiskGB ? `free disk ${freeGB().toFixed(1)} GB < ${CFG.minFreeDiskGB} GB`
      : capStop(trialCap(prov, CAMP), block.ran, launched())
      ?? (CAMP ? null : quotaStop(qf));
    if (block.stop) break;
    const r = await runTrial(t, env);
    block.ran++;
    block.stop = blockStopAfter(r, pcfg, [...latestTrials().values()].some((x) => x.provider === prov && x.status === "done"));
  }
  Object.assign(block, { endedAt: iso(), quotaEnd: quotaFor(pcfg.quota, model) });
  appendFileSync(BLOCKS, JSON.stringify(block) + "\n");
  console.log(`${local(now())} block ${prov} ended: ran ${block.ran}${block.stop ? `, stopped: ${block.stop}` : ""}`);
}

async function run() {
  const missing = CFG.piExtensions.filter((e) => !existsSync(e.replace(/^~/, HOME)));
  if (missing.length) { console.error(`piExtensions path(s) missing, refusing to run: ${missing.join(", ")}`); process.exit(3); }
  const plan = schedule();
  const cutoff = DEADLINE - CFG.adjudicationReserveMinutes * 60_000;
  const trials = latestTrials();
  console.log(`face-off ${CFG.id}: ${CASES.length} cases × ${ARMS.length} arms × ${REPS} reps → ${OUT}`);
  console.log(`now ${local(now())}; launch cutoff ${local(cutoff)}; deadline ${local(DEADLINE)}; report ${REPORT}`);
  let finish = now();
  for (const [prov, ts] of Object.entries(plan)) {
    const todo = ts.filter((t) => !isComplete(trials.get(t.key)));
    const { cap, perPass } = trialCap(prov, CAMP);
    const mins = todo.reduce((a, t) => a + armMinutes(t.arm, trials), 0);
    const end = now() + mins * 60_000;
    finish = Math.max(finish, end);
    const qf = quotaFor(CFG.providers[prov].quota, CFG.arms[ts[0].arm].model);
    console.log(`\n[${prov}] ${todo.length}/${ts.length} trials to run, cap ${cap ?? "none"}${perPass && cap != null ? " per pass" : ""}, ~${Math.round(mins)} min → ${local(end)}${end > cutoff ? "  ⚠ past launch cutoff" : ""}; quota ${qf.state} ${qf.windows.map((w) => `${w.id} ${w.percentRemaining}%`).join(", ") || "no telemetry"}`);
    console.log(`  per trial: ${[...new Set(ts.map((t) => t.arm))].map((a) => `${a} ~${armMinutes(a, trials).toFixed(1)} min`).join(", ")}`);
    if (flag("dry-run")) for (const t of ts) console.log(`  ${isComplete(trials.get(t.key)) ? "done " : "     "}${t.key}`);
  }
  const adjMin = Math.ceil(CASES.length / CFG.adjudicator.concurrency) * CFG.adjudicator.estimateMinutes;
  const expected = finish + (flag("no-adjudicate") ? 0 : adjMin * 60_000);
  console.log(`\nadjudication: ${CASES.length} cases, ${CFG.adjudicator.concurrency} at a time, ~${adjMin} min (${CFG.adjudicator.model} ${CFG.adjudicator.effort})`);
  console.log(`expected finish ${local(expected)} (deadline ${local(DEADLINE)})${expected > DEADLINE ? "  ⚠ AFTER DEADLINE: trials past the cutoff will be skipped" : "  ✓ before deadline"}`);
  console.log(`free disk ${freeGB().toFixed(1)} GB (stop below ${CFG.minFreeDiskGB})`);
  if (flag("dry-run")) return;

  for (const d of ["pe/campaigns", "logs", "finals", "adjudications"]) mkdirSync(path.join(OUT, d), { recursive: true });
  if (!existsSync(path.join(OUT, "pe/cases"))) symlinkSync(CASES_DIR, path.join(OUT, "pe/cases"));
  const env = trialEnv();
  const probe = credentialProbe(env);
  console.log(`credential probe: ${JSON.stringify(probe)}`);
  if (!probe.clean) { console.error("trial environment still carries a GitHub credential; refusing to run"); process.exit(3); }
  if (!existsSync(META)) writeFileSync(META, JSON.stringify({ id: CFG.id, date: DATE, createdAt: iso() }, null, 2));
  appendFileSync(STAGES, JSON.stringify({ startedAt: iso(), args: rest, cases: CASES.map((c) => c.id), arms: ARMS, reps: REPS, trials: Object.values(plan).flat() }) + "\n");

  const finalize = () => { writeReport(); if (flag("ledger")) writeLedger(); };
  const hard = setTimeout(() => { deadlineHit = true; console.log(`${local(now())} deadline: stopping trials and adjudication`); killAll(); }, DEADLINE - now());
  const force = setTimeout(() => { console.log("deadline + 3 min: writing the partial report and exiting"); finalize(); process.exit(0); }, DEADLINE - now() + 180_000);
  if (!run.signals) for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { deadlineHit = true; killAll(); finalize(); process.exit(1); });
  run.signals = true;

  await Promise.all(Object.entries(plan).map(([prov, ts]) => providerBlock(prov, ts, env, cutoff)));
  if (!flag("no-adjudicate") && !deadlineHit) await adjudicateAll(env);
  clearTimeout(hard); clearTimeout(force);
  finalize();
}

// ---------- adjudication ----------
// pi-eval's trial sandbox, readable only at allowDir among the denied folders.
function sandboxProfile(allowDir) {
  const r = spawnSync("node", [PI_EVAL, "sandbox-profile", allowDir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`pi-eval sandbox-profile failed: ${r.stderr}`);
  return r.stdout.trim();
}

function pooled(caseId, latest = latestTrials()) {
  const map = new Map();
  for (const r of latest.values()) {
    if (r.case !== caseId || !r.findings) continue;
    for (const f of r.findings) {
      const k = norm(f);
      if (!map.has(k)) map.set(k, { file: f.file, line: f.line, problem: f.problem, sources: [] });
      if (!map.get(k).sources.includes(r.key)) map.get(k).sources.push(r.key);
    }
  }
  // Order by a hash of the text, so neither arm nor schedule order shows through.
  const h = (k) => createHash("sha1").update(k).digest("hex");
  return [...map.entries()].sort(([a], [b]) => h(a).localeCompare(h(b))).map(([key, v]) => ({ key, ...v }));
}

function adjPrompt(c, clusters, diff, fresh) {
  const ids = c.defects.map((d) => d.id);
  return `You are adjudicating anonymous code-review findings on one proposed change. The working directory holds the proposed version; the change is below. You may read any file; do not modify files.

For every finding decide one label:
- a known-defect id from the list below, only when the finding describes that same failure (same broken rule and consequence), not merely the same file or line;
- "valid": a different real problem a careful maintainer would want fixed before merging; check it against the code;
- "noise": wrong, speculative, style or naming only, or about behaviour the change does not affect.
Also give every finding a "cluster": a short kebab-case slug for its underlying problem. Findings about the same problem get the same slug; a known-defect finding uses the defect id as its cluster.${clusters.length ? " Reuse a slug from the existing clusters below when a finding is about that problem." : ""}

Reply with only JSON: {"labels": [{"index": <n>, "label": "<${ids.join("|")}|valid|noise>", "cluster": "<slug>", "reason": "<one sentence>"}]} with one entry per finding.

## Known defects
${c.defects.length ? "" : "none: no answer key; label every finding valid or noise"}${c.defects.map((d) => `- ${d.id}: ${d.description} (around ${d.ranges.map(([f, a, b]) => `${f}:${a}-${b}`).join(", ")})`).join("\n")}
${clusters.length ? `\n## Existing clusters\n${clusters.map((l) => `- ${l.cluster} (${l.label}): ${l.reason}`).join("\n")}\n` : ""}
## Change under review
\`\`\`diff
${diff}
\`\`\`

## Findings
${fresh.map((i) => `${i.index}. ${i.file}:${i.line} — ${i.problem}`).join("\n")}`;
}
// Labels depend on the case's answer key and the prompt contract; a change to either relabels the case.
// A file without a fingerprint (written before fingerprints) is relabeled on the next adjudication.
export const caseFingerprint = (c) => createHash("sha256").update(JSON.stringify([c.id, c.defects, adjPrompt.toString()])).digest("hex");
export const needsRelabel = (prev, c) => !!prev && prev.fingerprint !== caseFingerprint(c);

// Labels every pooled finding of a case once. A later stage sends only findings not labeled before,
// with the clusters already in use, so earlier labels stay fixed and Claude usage grows with new findings.
async function adjudicateCase(c, env) {
  const file = path.join(OUT, "adjudications", `${c.id}.json`);
  const fingerprint = caseFingerprint(c);
  let prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  // Runs are kept for the token total and log numbering; items and labels start over.
  if (needsRelabel(prev, c)) { console.log(`${c.id}: answer key or prompt changed since labeling; relabeling ${prev.items.length} findings`); prev = { ...prev, items: [], labels: [] }; }
  prev = { case: c.id, items: [], labels: [], runs: [], ...prev, fingerprint };
  const known = new Map(prev.items.map((i) => [norm(i), i]));
  let next = prev.items.length ? Math.max(...prev.items.map((i) => i.index)) + 1 : 0;
  const merged = pooled(c.id).map(({ key, ...i }) => (known.has(key) ? { ...known.get(key), sources: i.sources } : { ...i, index: next++, fresh: true }));
  const fresh = merged.filter((i) => i.fresh);
  const save = (a) => writeFileSync(file, JSON.stringify(a, null, 2));
  const strip = (items) => items.map(({ fresh: _f, ...i }) => i);
  if (!fresh.length) { const a = { ...prev, items: strip(merged) }; save(a); return a; }
  const adj = CFG.adjudicator;
  const qf = quotaFor(adj.quota, adj.model);
  const stop = quotaStop(qf, adjudicationStopBelow(CAMP));
  if (stop) { console.log(`${c.id}: adjudication skipped (${stop})`); return { ...prev, skipped: stop }; }
  const dir = path.join(OUT, "adj", c.id);
  const ws = path.join(dir, "ws");
  buildWorkspace(c, ws, env);
  let diff = sh("git show --stat --patch HEAD", { cwd: ws }).stdout;
  if (diff.length > 200_000) diff = `${diff.slice(0, 200_000)}\n[diff truncated; read the files in the working directory]`;
  const ids = c.defects.map((d) => d.id);
  const clusters = [...new Map(prev.labels.filter((l) => l.label !== "noise").map((l) => [l.cluster, l])).values()];
  const prompt = adjPrompt(c, clusters, diff, fresh);
  const logFile = path.join(dir, `pi-${prev.runs.length}.jsonl`);
  writeFileSync(logFile, "");
  const started = now();
  const res = await runChild("sandbox-exec", ["-p", sandboxProfile(dir), "pi", "-p", "--mode", "json", "--model", adj.model, "--thinking", adj.effort, "--session-dir", path.join(dir, "session"), "--tools", "read,grep,find,ls", prompt], { cwd: ws, env, logFile, timeoutMs: adj.timeoutMinutes * 60_000 });
  const events = readFileSync(logFile, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const messages = events.findLast((e) => e.type === "agent_end")?.messages ?? events.filter((e) => e.type === "message_end").map((e) => e.message);
  const assistant = messages.filter((m) => m?.role === "assistant");
  const sum = (k) => assistant.reduce((a, m) => a + (m.usage?.[k] ?? 0), 0);
  const text = (assistant.at(-1)?.content ?? []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
  let labels = null;
  try { labels = JSON.parse(text.match(/\{[\s\S]*\}/)[0]).labels; } catch {}
  const allowed = new Set([...ids, "valid", "noise"]);
  const freshIdx = new Set(fresh.map((i) => i.index));
  labels = labels?.filter((l) => freshIdx.has(l.index) && allowed.has(l.label)) ?? null;
  const total = sum("input") + sum("output") + sum("cacheRead") + sum("cacheWrite");
  const runRec = { at: iso(), model: adj.model, effort: adj.effort, newFindings: fresh.length, labeled: labels?.length ?? 0, tokens: total > 0 ? total : null, elapsedMs: now() - started, timedOut: res.timedOut, quotaBefore: qf, quotaAfter: quotaFor(adj.quota, adj.model), error: labels ? null : (assistant.at(-1)?.errorMessage ?? text.slice(0, 500)) || "no output" };
  rmSync(ws, { recursive: true, force: true });
  // Unlabeled fresh findings stay out of items, so the next adjudication run asks about them again.
  const labeledIdx = new Set((labels ?? []).map((l) => l.index));
  const a = { case: c.id, fingerprint, items: strip(merged.filter((i) => !i.fresh || labeledIdx.has(i.index))), labels: [...prev.labels, ...(labels ?? [])], runs: [...prev.runs, runRec] };
  a.tokens = a.runs.every((r) => r.tokens != null) ? a.runs.reduce((s, r) => s + r.tokens, 0) : null;
  save(a);
  console.log(`${local(now())} adjudicated ${c.id}: ${fresh.length} new findings, ${runRec.labeled} labeled, tokens=${runRec.tokens ?? "unknown"}${runRec.error ? ` (${String(runRec.error).slice(0, 160)})` : ""}`);
  return a;
}

async function adjudicateAll(env) {
  const queue = [...CASES];
  const worker = async () => { while (queue.length && !deadlineHit) { const c = queue.shift(); try { await adjudicateCase(c, env); } catch (e) { console.log(`${c.id}: adjudication failed: ${e.message}`); } } };
  await Promise.all(Array.from({ length: CFG.adjudicator.concurrency }, worker));
}

// Completion gate: every expected (case, arm, rep 0) key has a terminal record (last record per key wins), and every
// case's adjudication is current and labels every pooled finding. Returns one line per gap; empty means complete.
export function gateGaps(latest, adjudications, cases, arms) {
  const gaps = [];
  for (const c of cases) {
    for (const arm of arms) if (!latest.get(`${c.id}|${arm}|0`)?.status) gaps.push(`trial ${c.id}|${arm}|0: no terminal record`);
    const a = adjudications[c.id];
    if (!a) { gaps.push(`adjudication ${c.id}: missing`); continue; }
    if (needsRelabel(a, c)) gaps.push(`adjudication ${c.id}: stale (answer key or prompt changed)`);
    const items = new Map(a.items.map((i) => [norm(i), i.index]));
    const labeled = new Set(a.labels.map((l) => l.index));
    for (const f of pooled(c.id, latest)) {
      if (!items.has(f.key)) gaps.push(`adjudication ${c.id}: finding not adjudicated (${f.sources.join(", ")}: ${f.file}:${f.line})`);
      else if (!labeled.has(items.get(f.key))) gaps.push(`adjudication ${c.id}: item ${items.get(f.key)} has no label`);
    }
  }
  return gaps;
}

function gate() {
  const latest = latestTrials();
  const adjudications = Object.fromEntries(CASES.map((c) => [c.id, path.join(OUT, "adjudications", `${c.id}.json`)]).filter(([, f]) => existsSync(f)).map(([id, f]) => [id, JSON.parse(readFileSync(f, "utf8"))]));
  const gaps = gateGaps(latest, adjudications, CASES, ARMS);
  for (const g of gaps) console.log(g);
  console.log(`gate: ${CASES.length} cases x ${ARMS.length} arms (rep 0): ${gaps.length ? `${gaps.length} gaps` : "complete"}`);
  process.exit(gaps.length ? 1 : 0);
}

// ---------- report ----------
// Distinct real problems in one trial; an exploratory defect hit sits in both lists and counts once.
export const materialCount = (r) => new Set([...r.defects, ...r.validClusters]).size;
function scored() {
  const trials = latestTrials();
  const adjs = Object.fromEntries(CFG.cases.map((c) => {
    const f = path.join(OUT, "adjudications", `${c.id}.json`);
    const a = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
    // Labels made against a different answer key or prompt, or without a fingerprint, do not score until relabeled.
    return [c.id, a && needsRelabel(a, c) ? null : a];
  }));
  const rows = [...trials.values()].map((r) => {
    const a = adjs[r.case];
    if (r.status !== "done" || !r.findings) return { ...r, adjudicated: false };
    const byKey = new Map((a?.items ?? []).map((i) => [norm(i), a.labels.find((l) => l.index === i.index)]));
    const seen = new Set(), defects = new Set(), clusters = new Set();
    let noise = 0, unlabeled = 0;
    for (const f of r.findings) {
      const k = norm(f);
      if (seen.has(k)) continue;
      seen.add(k);
      const l = byKey.get(k);
      if (!l) unlabeled++;
      else if (l.label === "noise") noise++;
      else if (l.label === "valid") clusters.add(l.cluster);
      else defects.add(l.label);
    }
    // An exploratory case's defect hit counts as a valid finding, not towards recall.
    for (const d of defects) if (CFG.cases.find((c) => c.id === r.case)?.exploratory) clusters.add(d); else clusters.delete(d);
    // A trial counts only once every one of its findings is labeled; otherwise its recall is unknown.
    return { ...r, adjudicated: unlabeled === 0, defects: [...defects], validClusters: [...clusters], noise, unlabeled };
  });
  return { rows, adjs, trials };
}

// Everything any stage has scheduled so far: the report and ledger cover the whole campaign, not one stage.
function campaignScope() {
  const plan = [...new Map(readJsonl(STAGES).flatMap((s) => s.trials).map((t) => [t.key, t])).values()];
  return {
    plan,
    cases: CFG.cases.filter((c) => plan.some((t) => t.case === c.id)),
    arms: Object.keys(CFG.arms).filter((a) => plan.some((t) => t.arm === a)),
    reps: Math.max(0, ...plan.map((t) => t.rep + 1)),
  };
}

// An exploratory case's answer key was chosen after seeing arm outputs, so it is no independent oracle:
// its findings count as valid or noise, but never towards recall.
const caseOf = (id, cases = CFG.cases) => cases.find((c) => c.id === id);
export const recallDefects = (r, cases = CFG.cases) => (caseOf(r.case, cases)?.exploratory ? [] : r.defects);
export const recallPossible = (id, cases = CFG.cases) => { const c = caseOf(id, cases); return c?.exploratory ? 0 : c?.defects.length ?? 0; };
export const pct = (found, possible) => (possible ? `${Math.round((100 * found) / possible)}%` : "-");
// Pairs from solo results: union per case and repetition where both arms have an adjudicated trial.
export function pairStats(rows, cases, armA, armB, reps) {
  let n = 0, found = 0, possible = 0, extras = 0, tok = 0, unknown = false;
  for (const c of cases) for (let rep = 0; rep < reps; rep++) {
    const a = rows.find((r) => r.key === `${c.id}|${armA}|${rep}` && r.adjudicated);
    const b = rows.find((r) => r.key === `${c.id}|${armB}|${rep}` && r.adjudicated);
    if (!a || !b) continue;
    n++; possible += recallPossible(c.id, cases);
    found += new Set([...recallDefects(a, cases), ...recallDefects(b, cases)]).size;
    extras += new Set([...a.validClusters, ...b.validClusters]).size;
    if (a.tokens == null || b.tokens == null) unknown = true; else tok += a.tokens + b.tokens;
  }
  return { n, found, possible, extras, tok: unknown ? null : tok };
}

function writeReport() {
  const { rows, adjs } = scored();
  const { plan, cases: CASES, arms: ARMS, reps: REPS } = campaignScope();
  const stages = readJsonl(STAGES);
  const blocks = readJsonl(BLOCKS);
  const fmt = (n) => (n == null ? "unknown" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const L = [];
  L.push(`# production-ready-pr reviewer face-off — ${DATE}`, "");
  L.push(`Written ${local(now())}${deadlineHit ? " (deadline reached: partial)" : ""}. Cases: ${CASES.length} replayed review fixes; arms: ${ARMS.length}; repetitions: ${REPS}. Raw data: \`${OUT}\`.`, "");
  L.push("Scoring: one blinded adjudication per case (" + CFG.adjudicator.model + " " + CFG.adjudicator.effort + ") labels each pooled, deduplicated finding as a known defect (semantic match), a valid extra, or noise. Recall = known defects found / known defects in the adjudicated trials, excluding exploratory cases. Tokens = input + output + cache read + cache write as Pi reports them; `unknown` when the provider reports none.", "");

  const exploratory = CASES.filter((c) => c.exploratory);
  if (exploratory.length) L.push("Exploratory cases (answer key not an independent oracle; shown per case and counted for valid extras and noise, excluded from recall, the ranking and pair recall):", ...exploratory.map((c) => `- ${c.id}: ${c.provenance}`), "");
  const legacy = CASES.filter((c) => adjs[c.id] && !adjs[c.id].fingerprint).map((c) => c.id);
  if (legacy.length) L.push(`Labels without an answer-key fingerprint (scored as is; relabeled on the next adjudication): ${legacy.join(", ")}.`, "");
  const arms = ARMS.map((arm) => {
    const all = rows.filter((r) => r.arm === arm);
    const done = all.filter((r) => r.status === "done");
    const adj = done.filter((r) => r.adjudicated);
    const found = adj.reduce((a, r) => a + recallDefects(r).length, 0);
    const possible = adj.reduce((a, r) => a + recallPossible(r.case), 0);
    const extras = adj.reduce((a, r) => a + r.validClusters.length, 0);
    const noise = adj.reduce((a, r) => a + r.noise, 0);
    const known = adj.filter((r) => r.tokens != null);
    const tok = known.reduce((a, r) => a + r.tokens, 0);
    const validOnKnown = known.reduce((a, r) => a + materialCount(r), 0);
    const wall = done.length ? done.reduce((a, r) => a + r.wallMs, 0) / done.length / 60_000 : null;
    const cost = done.reduce((a, r) => a + (r.usage?.cost ?? 0), 0);
    return { arm, cfg: CFG.arms[arm], scheduled: plan.filter((t) => t.arm === arm).length, done: done.length, adj: adj.length, found, possible, extras, noise, tok: known.length ? tok : null, unknownTok: adj.length - known.length, perValid: known.length && validOnKnown ? tok / validOnKnown : null, zeroValid: known.length > 0 && validOnKnown === 0, wall, cost };
  });
  L.push("## Per arm", "", "| arm | model | effort | trials done/scheduled | adjudicated | known defects found | recall | valid extras | noise | tokens | tokens per valid finding | mean wall | cost $ |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of arms) L.push(`| ${a.arm} | ${a.cfg.model} | ${a.cfg.effort} | ${a.done}/${a.scheduled} | ${a.adj} | ${a.found}/${a.possible} | ${pct(a.found, a.possible)} | ${a.extras} | ${a.noise} | ${fmt(a.tok)}${a.unknownTok ? ` (+${a.unknownTok} unknown)` : ""} | ${a.zeroValid ? "n/a (0 valid)" : a.perValid == null ? "unknown" : fmt(Math.round(a.perValid))} | ${a.wall == null ? "-" : `${a.wall.toFixed(1)} min`} | ${a.cost ? a.cost.toFixed(2) : "-"} |`);
  L.push("");

  const ranked = [...arms].filter((a) => a.adj).sort((x, y) => y.found - x.found);
  if (ranked.length) {
    L.push("## Ranking by known defects found (a difference of 1–2 defects is a tie)", "");
    for (const a of ranked) {
      const ties = ranked.filter((b) => b !== a && Math.abs(b.found - a.found) <= 2).map((b) => b.arm);
      L.push(`- ${a.arm}: ${a.found} found, ${a.extras} valid extras, ${a.noise} noise${ties.length ? `; tie with ${ties.join(", ")}` : ""}`);
    }
    if (new Set(ranked.map((a) => a.adj)).size > 1) L.push("- Arms have different numbers of adjudicated trials; compare recall, not raw counts.");
    L.push("");
  }

  L.push("## Pair coverage (computed from solo results)", "", "| pair | aligned trials | combined defects found | combined recall | combined valid extras | combined tokens |", "|---|---|---|---|---|---|");
  for (let i = 0; i < ARMS.length; i++) for (let j = i + 1; j < ARMS.length; j++) {
    const p = pairStats(rows, CASES, ARMS[i], ARMS[j], REPS);
    if (p.n) L.push(`| ${ARMS[i]} + ${ARMS[j]} | ${p.n} | ${p.found}/${p.possible} | ${pct(p.found, p.possible)} | ${p.extras} | ${p.tok == null ? "unknown" : fmt(p.tok)} |`);
  }
  L.push("");

  L.push("## Per case: who found each known defect", "", "| case | defect | provenance | found by (trials) |", "|---|---|---|---|");
  for (const c of CASES) for (const d of c.defects) {
    const by = rows.filter((r) => r.case === c.id && r.adjudicated && r.defects.includes(d.id)).map((r) => `${r.arm}#${r.rep}`);
    L.push(`| ${c.id}${c.exploratory ? " (exploratory)" : ""} | ${d.id} | ${c.provenance} | ${by.join(", ") || (rows.some((r) => r.case === c.id && r.adjudicated) ? "none" : "not adjudicated")} |`);
  }
  L.push("");

  L.push("## Quota per provider block", "", "| provider | started | ended | trials run | quota at start | quota at end | stop reason |", "|---|---|---|---|---|---|---|");
  const qs = (x) => (x?.windows?.length ? `${x.state}: ${x.windows.map((w) => `${w.id} ${w.percentRemaining}%`).join(", ")}` : `no telemetry (${x?.state ?? "?"})`);
  for (const b of blocks) L.push(`| ${b.provider} | ${local(Date.parse(b.startedAt))} | ${local(Date.parse(b.endedAt))} | ${b.ran} | ${qs(b.quotaStart)} | ${qs(b.quotaEnd)} | ${b.stop ?? "completed"} |`);
  const adjRuns = Object.values(adjs).flatMap((a) => a?.runs ?? []).sort((x, y) => x.at.localeCompare(y.at));
  if (adjRuns.length) L.push(`| claude (adjudication) | ${local(Date.parse(adjRuns[0].at))} | ${local(Date.parse(adjRuns.at(-1).at))} | ${adjRuns.length} adjudication runs | ${qs(adjRuns[0].quotaBefore)} | ${qs(adjRuns.at(-1).quotaAfter)} | tokens ${fmt(adjRuns.every((a) => a.tokens != null) ? adjRuns.reduce((s, a) => s + a.tokens, 0) : null)} |`);
  L.push("");

  L.push("## Stages run", "");
  for (const [i, s] of stages.entries()) L.push(`- ${i}: ${local(Date.parse(s.startedAt))} \`${s.args.join(" ")}\` → ${s.cases.length} cases × ${s.arms.length} arms × ${s.reps} reps (${s.trials.length} trials scheduled, completed ones skipped)`);
  L.push("");

  L.push("## Failed, skipped or not adjudicated", "");
  const lastStop = Object.fromEntries(blocks.map((b) => [b.provider, b.stop]));
  let any = false;
  for (const t of plan) {
    const r = rows.find((x) => x.key === t.key);
    if (r?.adjudicated) continue;
    any = true;
    const why = !r ? `not run: ${lastStop[t.provider] ?? "not reached"}` : r.status !== "done" ? `${r.status}: ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 200)}` : !r.findings ? "no parseable findings block" : `${r.unlabeled} findings not yet adjudicated`;
    L.push(`- ${t.key}: ${why}`);
  }
  if (!any) L.push("- none");
  L.push("", "## Credential isolation", "");
  const probes = rows.filter((r) => r.credentialProbe);
  L.push(`${probes.filter((r) => r.credentialProbe.clean).length}/${probes.length} trial environments had no GitHub credential (inside pi-eval's sandbox: no GH_/GITHUB/token env vars, \`gh auth token\` and \`security\` find no GitHub token, \`gh api user\` fails, no git credential helper, \`git ls-remote\` of private embabel/me fails).`);
  mkdirSync(path.dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, L.join("\n") + "\n");
  console.log(`report: ${REPORT}`);
}

function writeLedger() {
  const { rows } = scored();
  const { cases: CASES, arms: ARMS } = campaignScope();
  const markerFile = path.join(OUT, "ledger-written.json");
  const written = new Set(existsSync(markerFile) ? JSON.parse(readFileSync(markerFile, "utf8")) : []);
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  for (const c of CASES) {
    if (written.has(c.id)) continue;
    const caseRows = rows.filter((r) => r.case === c.id && r.adjudicated);
    if (!caseRows.length) continue;
    const classesOf = (rs) => new Set(rs.flatMap((r) => [...r.defects, ...r.validClusters]));
    const allClasses = classesOf(caseRows);
    const slots = ARMS.map((arm) => {
      const rs = caseRows.filter((r) => r.arm === arm);
      if (!rs.length) return null;
      const mine = classesOf(rs);
      return {
        arm, model: CFG.arms[arm].model, effort: CFG.arms[arm].effort, trials: rs.length,
        materialFindings: rs.reduce((a, r) => a + materialCount(r), 0),
        uniqueDefectClasses: mine.size, knownDefectsFound: [...new Set(rs.flatMap((r) => r.defects))],
        noiseFindings: rs.reduce((a, r) => a + r.noise, 0),
        missedCaughtByOther: [...allClasses].filter((k) => !mine.has(k)).length,
        wallMinutes: +(rs.reduce((a, r) => a + r.wallMs, 0) / rs.length / 60_000).toFixed(1),
        tokens: rs.every((r) => r.tokens != null) ? rs.reduce((a, r) => a + r.tokens, 0) : null,
      };
    }).filter(Boolean);
    const [owner, num] = c.pr.split("#");
    appendFileSync(LEDGER, JSON.stringify({ date: DATE, faceoff: true, repository: owner, pr: Number(num), level: c.fix ? "replay" : "blind", case: c.id, proposed: c.proposed, fix: c.fix, knownDefects: c.defects.map((d) => d.id), slots }) + "\n");
    written.add(c.id);
  }
  writeFileSync(markerFile, JSON.stringify([...written]));
}

// ---------- repair-quota-trials ----------
// Appends a rate-limited record for each done trial whose final is a quota message, so the last record
// wins and a later run retries it. trials.jsonl is never rewritten.
function repairQuotaTrials() {
  const fixes = [];
  for (const r of latestTrials().values()) {
    if (r.status !== "done" || r.findings) continue;
    const f = path.join(OUT, "finals", `${r.key.replace(/\|/g, "__")}.txt`);
    const msg = existsSync(f) && quotaFinal(readFileSync(f, "utf8"));
    if (msg) fixes.push({ ...r, status: "rate-limited", rateLimited: true, reason: msg, repairedAt: iso() });
  }
  for (const r of fixes) {
    console.log(`${flag("dry-run") ? "would append" : "append"} ${r.key}: ${r.reason.slice(0, 120)}`);
    if (!flag("dry-run")) appendFileSync(TRIALS, JSON.stringify(r) + "\n");
  }
  console.log(`${fixes.length} quota trial(s)${flag("dry-run") ? " (dry run, nothing written)" : ""}`);
}

// ---------- eval campaign ----------
export const liveCaseId = (repo, pr, sha) => `live-${repo}-${pr}-${String(sha).slice(0, 8)}`;

// One runner per campaign: a kernel flock on `runner.lock`. python3 takes it, then execs the node runner
// on the same descriptor, so node itself holds the lock and the kernel releases it when node dies; nothing
// is ever stale. The file is never unlinked: that would let a waiter lock the old inode and a newcomer a new one.
// ponytail: relies on Node's spawn not passing the lock fd to children (true on macOS, where libuv spawns
// with POSIX_SPAWN_CLOEXEC_DEFAULT; the self-check proves it). On Linux, verify again before running there.
export const LOCK_BUSY = 75;
const LOCK_EXEC = [
  "import fcntl, os, sys",
  "fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o644)",
  "try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)",
  `except BlockingIOError: sys.exit(${LOCK_BUSY})`,
  "os.set_inheritable(fd, True)",
  "os.execvp(sys.argv[2], sys.argv[2:])",
].join("\n");
// Arguments for `python3`: no shell, the command runs as the lock holder.
export const lockedArgv = (lock, argv) => ["-c", LOCK_EXEC, lock, ...argv];
// Returns 0 or LOCK_BUSY; a launch failure or any other exit throws, so a broken pass is never read as "done".
export function locked(args, run = spawnSync) {
  const r = run("python3", lockedArgv(LOCK, [process.execPath, fileURLToPath(import.meta.url), "--campaign", CAMPAIGN_ARG, ...args]), { stdio: "inherit" });
  if (r.status === 0 || r.status === LOCK_BUSY) return r.status;
  throw new Error(`locked pass failed: ${r.error?.message ?? `exit ${r.status ?? r.signal}`}`);
}

// A campaign's cases: its cases file plus one `cases.d/<id>.json` per registered case. Registering writes
// only its own file (temp file, then rename), so concurrent evals never read-modify-write a shared file.
function casesDirOf(file) { return path.join(path.dirname(file), "cases.d"); }
export function readCasesFile(file) {
  const cases = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const dir = casesDirOf(file), ids = new Set(cases.map((c) => c.id));
  const extra = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"))) : [];
  extra.sort((a, b) => String(a.registeredAt ?? "").localeCompare(String(b.registeredAt ?? "")) || a.id.localeCompare(b.id));
  return [...cases, ...extra.filter((c) => !ids.has(c.id))];
}
export function registerCase(file, c) {
  const dest = path.join(casesDirOf(file), `${c.id}.json`);
  if (existsSync(dest) || readCasesFile(file).some((x) => x.id === c.id)) return false;
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = uniqueTmp(dest);
  writeFileSync(tmp, JSON.stringify(c, null, 2) + "\n");
  renameSync(tmp, dest);
  return true;
}

// A PR's head and merge-base from `gh pr view` and git, every value passed as an argument (no shell).
// The fetch updates remote-tracking refs, never the working tree.
export function livePr(dir, pr) {
  const err = (what, r) => new Error(`${what} failed: ${String(r.error?.message || r.stderr || r.stdout).trim().slice(0, 400)}`);
  const gh = exec("gh", ["pr", "view", String(pr), "--json", "headRefOid,headRefName,baseRefName,url"], { cwd: dir });
  if (gh.status) throw err("gh pr view", gh);
  const info = JSON.parse(gh.stdout);
  if (!/^[0-9a-f]{40}$/.test(info.headRefOid ?? "")) throw new Error(`gh pr view: bad head sha ${JSON.stringify(info.headRefOid)}`);
  const git = (...args) => exec("git", ["-C", dir, ...args]);
  const has = () => git("cat-file", "-e", `${info.headRefOid}^{commit}`).status === 0;
  let f = git("fetch", "--quiet", "origin", "--end-of-options", info.baseRefName, info.headRefName);
  if (!has()) f = git("fetch", "--quiet", "origin", "--end-of-options", info.baseRefName, `pull/${pr}/head`); // a fork's head
  if (!has()) throw err("git fetch", f);
  const mb = git("merge-base", "--end-of-options", `origin/${info.baseRefName}`, info.headRefOid);
  if (mb.status) throw err("merge-base", mb);
  return { info, base: mb.stdout.trim() };
}

function evalCase() {
  const [repo, pr] = rest;
  const sha = opt("sha");
  if (!CAMP) { console.error("eval needs --campaign"); process.exit(2); }
  if (!repo || !/^\d+$/.test(pr ?? "") || (sha != null && !/^[0-9a-f]{7,40}$/i.test(sha))) { console.error("usage: faceoff.mjs --campaign NAME eval <repo> <pr-number> [--sha <reviewed head sha>]"); process.exit(2); }
  if (!CFG.repos[repo]) { console.error(`eval: repo ${repo} is not in faceoff.json repos; skipped`); process.exit(2); }
  let live;
  try { live = livePr(repoPath(repo), pr); } catch (e) { console.error(`eval: ${e.message}`); process.exit(1); }
  const { info } = live;
  // The panel must review the revision the review saw, not a head pushed since or not yet pushed.
  if (sha && !info.headRefOid.startsWith(sha.toLowerCase())) { console.error(`eval: PR head ${info.headRefOid} is not the reviewed sha ${sha}; refusing`); process.exit(1); }
  const ownerRepo = info.url.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1] ?? repo;
  const c = {
    id: liveCaseId(repo, pr, info.headRefOid), repo, pr: `${ownerRepo}#${pr}`, base: live.base, proposed: info.headRefOid,
    head: info.headRefName, baseRef: info.baseRefName, registeredAt: iso(),
    provenance: `Eval (${new Date().toLocaleDateString("sv-SE")}): live PR head ${info.headRefName} against its merge-base with origin/${info.baseRefName}. No answer key; scores valid findings only.`,
    defects: [],
  };
  buildCase(c);
  registerCase(CAMP.casesFile, c);
  console.log(`case ${c.id}`);
  // Always launch: a runner that finds the lock held logs "runner already active" and exits; the holder's
  // runner looks for pending cases again after its pass releases the lock.
  mkdirSync(path.join(OUT, "logs"), { recursive: true });
  const log = path.join(OUT, "logs", `runner-${iso().replace(/[:.]/g, "-")}.log`);
  const fd = openSync(log, "a");
  const child = spawn("nice", ["-n", "10", process.execPath, fileURLToPath(import.meta.url), "--campaign", CAMPAIGN_ARG, "runner", "--no-adjudicate", ...(opt("arms") ? ["--arms", opt("arms")] : [])], { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  console.log(`runner pid ${child.pid}\nlog ${log}`);
}

// Runs each newly registered case (no trial on the selected arms yet) once, until none is pending.
// Retries are the nightly's job. Each pass is a `run` child under the lock; the next look for pending
// cases comes after that child exits, so a case whose eval found the lock held is picked up here.
async function runner() {
  if (!CAMP) { console.error("runner needs --campaign"); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  const seen = new Set();
  for (;;) {
    const tried = new Set(readJsonl(TRIALS).filter((r) => ARMS.includes(r.arm)).map((r) => r.case));
    const todo = readCases().filter((c) => !seen.has(c.id) && !tried.has(c.id));
    if (!todo.length) break;
    for (const c of todo) seen.add(c.id);
    console.log(`${local(now())} runner: ${todo.map((c) => c.id).join(", ")}`);
    if (locked(["run", "--no-adjudicate", ...rest, "--cases", todo.map((c) => c.id).join(",")]) === LOCK_BUSY) { console.log("runner already active; case registered, exiting"); return; }
  }
  console.log(`${local(now())} runner: no case pending; lock released`);
}

// One retry of every incomplete trial (rate-limited, skipped-quota, failed), then adjudication and reports.
async function nightly() {
  if (!CAMP) { console.error("nightly needs --campaign"); process.exit(2); }
  mkdirSync(OUT, { recursive: true });
  // A failed retry or runner pass is logged and nightly exits non-zero at the end, but still judges and reports what exists.
  let failed = null;
  try {
    if (locked(["run", "--no-adjudicate", ...rest]) === LOCK_BUSY) console.log("runner active: retries wait for tomorrow");
    else await runner(); // cases registered while the retry pass held the lock
  } catch (e) { failed = e; console.error(`nightly: ${e.message}; judging and reporting what exists`); }
  refreshCases();
  mkdirSync(path.join(OUT, "adjudications"), { recursive: true });
  try { await adjudicateAll(trialEnv()); } catch (e) { failed ??= e; console.error(`nightly: adjudication skipped: ${e.message}; reporting what exists`); }
  refreshCases();
  writeReport();
  mkdirSync(CAMP.reports, { recursive: true });
  const py = (script, ...args) => sh(`python3 ${[path.join(HERE, script), ...args].map(q).join(" ")}`);
  const pages = py("case-pages.py", OUT, path.join(CAMP.reports, "cases"), CAMP.casesFile);
  console.log((pages.stdout + pages.stderr).trim());
  const models = py("model-summary.py", OUT, CAMP.casesFile);
  if (models.status === 0) { writeFileSync(path.join(CAMP.reports, "models.md"), models.stdout); console.log(`models: ${path.join(CAMP.reports, "models.md")}`); }
  else console.log(`model-summary failed: ${models.stderr.trim().slice(-300)}`);
  // Verify and rate stay manual: count the problems (known or valid labels) no verify/<case>.json verdict covers.
  let unverified = 0, cases = 0;
  for (const c of CFG.cases) {
    const a = path.join(OUT, "adjudications", `${c.id}.json`);
    if (!existsSync(a)) continue;
    const vf = path.join(OUT, "verify", `${c.id}.json`);
    const v = new Set(existsSync(vf) ? JSON.parse(readFileSync(vf, "utf8")).verdicts.map((x) => x.index) : []);
    const n = JSON.parse(readFileSync(a, "utf8")).labels.filter((l) => l.label !== "noise" && !v.has(l.index)).length;
    unverified += n; cases += n ? 1 : 0;
  }
  console.log(`reminder: verify and rate are manual: ${unverified} unverified problems in ${cases} cases (verdicts go to ${path.join(OUT, "verify")}, ratings to ${path.join(OUT, "ratings")})`);
  if (failed) process.exitCode = 1;
}

// ---------- main ----------
// Imported (faceoff-selfcheck.mjs) rather than run: export the pure functions, dispatch nothing.
const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) {}
else if (cmd === "build-cases") buildCases();
else if (cmd === "setup-check") setupCheck();
else if (cmd === "quota") { const snap = quota(); for (const k of [...Object.values(CFG.providers).map((x) => x.quota), CFG.adjudicator.quota]) console.log(JSON.stringify(quotaFor(k, "", snap))); }
else if (cmd === "probe") console.log(JSON.stringify(credentialProbe(trialEnv()), null, 2));
else if (cmd === "run") await run();
else if (cmd === "adjudicate") { mkdirSync(path.join(OUT, "adjudications"), { recursive: true }); await adjudicateAll(trialEnv()); }
else if (cmd === "gate") gate();
else if (cmd === "report") { writeReport(); if (flag("ledger")) writeLedger(); }
else if (cmd === "repair-quota-trials") repairQuotaTrials();
else if (cmd === "eval") evalCase();
else if (cmd === "runner") await runner();
else if (cmd === "nightly") await nightly();
else { console.error("usage: faceoff.mjs build-cases | setup-check | run [--dry-run] [--deadline HH:MM] [--out DIR] [--cases a,b] [--arms x,y] [--reps N] [--no-adjudicate] [--ledger] [--report FILE] | adjudicate [--out DIR] [--cases a,b] | report [--out DIR] [--report FILE] [--ledger] | repair-quota-trials [--dry-run] [--out DIR] | --campaign NAME eval <repo> <pr> [--sha SHA] [--arms x,y] | --campaign NAME runner | --campaign NAME nightly"); process.exit(2); }
