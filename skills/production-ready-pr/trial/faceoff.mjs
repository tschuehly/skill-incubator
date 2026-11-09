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
//
// Stages share one campaign directory (default results/prr-faceoff): a later stage skips every completed
// trial, adds its own, re-adjudicates only new findings, and rewrites the same report over everything run.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statfsSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const CFG = JSON.parse(readFileSync(path.join(HERE, "faceoff.json"), "utf8"));
const EVAL_HOME = path.join(HOME, ".pi-workbench/evals");
const CASES_DIR = path.join(EVAL_HOME, "cases");
const PROJECTS = path.join(HOME, "IdeaProjects");
const PI_EVAL = process.env.PI_EVAL_SCRIPT ?? path.join(PROJECTS, "pi-workbench.installed/scripts/pi-eval.mjs");
const LEDGER = process.env.PRR_FACEOFF_LEDGER ?? path.join(HOME, ".pi-workbench/scratch/production-ready-pr-trial/ledger.jsonl");
const RATE_LIMIT = /\b429\b|rate.?limit|too many requests|resource.?exhausted|usage limit|quota exceeded|insufficient.?quota/i;

const repoPath = (name) => CFG.repos[name].replace(/^~/, HOME);
const sh = (cmd, opts = {}) => spawnSync("bash", ["-c", cmd], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
const q = JSON.stringify;
const now = () => Date.now();
const iso = (ms = now()) => new Date(ms).toISOString();
const local = (ms) => new Date(ms).toLocaleString("sv-SE", { hour12: false }).slice(0, 16);
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const fullSha = (repo, rev) => sh(`git -C ${q(repoPath(repo))} rev-parse ${rev}^{commit}`).stdout.trim();

// ---------- arguments ----------
const [cmd, ...rest] = process.argv.slice(2);
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
const DEADLINE = deadlineMs(opt("deadline"));
const OUT = path.resolve(opt("out") ?? path.join(EVAL_HOME, "results", CFG.id));
// The campaign's date is fixed by its first stage, so every stage rewrites the same report.
const META = path.join(OUT, "campaign.json");
const DATE = existsSync(META) ? JSON.parse(readFileSync(META, "utf8")).date : new Date().toLocaleDateString("sv-SE");
// A custom --out keeps its report beside its results, so a test run cannot overwrite the campaign report.
const REPORT = path.resolve(opt("report") ?? (opt("out") ? path.join(OUT, "report.md") : path.join(EVAL_HOME, "reports", `${CFG.id}-${DATE}.md`)));
const pick = (name, all) => {
  const want = list(name) ?? (name === "cases" ? list("case") : undefined);
  const unknown = want?.filter((x) => !all.includes(x)) ?? [];
  if (unknown.length) { console.error(`unknown --${name}: ${unknown.join(", ")} (known: ${all.join(", ")})`); process.exit(2); }
  return all.filter((x) => !want || want.includes(x));
};
const CASES = pick("cases", CFG.cases.map((c) => c.id)).map((id) => CFG.cases.find((c) => c.id === id));
const ARMS = pick("arms", Object.keys(CFG.arms));
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
  writeFileSync(path.join(dir, "pi"), `#!/bin/sh\n# Written by faceoff.mjs: Pi for sandboxed face-off trials.\nexec ${q(real)} --no-extensions ${exts} "$@"\n`, { mode: 0o755 });
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
  if (!p) return { provider, state: "absent", windows: [] };
  const windows = (p.windows ?? []).filter((w) => !w.id.startsWith("model:") || model.includes(w.id.slice(6))).map((w) => ({ id: w.id, percentRemaining: w.percentRemaining }));
  return { provider, state: p.state?.status ?? "unknown", windows };
}
// Stale or missing telemetry never stops a block; the provider's trial cap does.
function quotaStop(qf) {
  if (qf.state !== "fresh") return null;
  const low = qf.windows.find((w) => typeof w.percentRemaining === "number" && w.percentRemaining < CFG.stopBelowPercent);
  return low ? `${qf.provider} ${low.id} quota at ${low.percentRemaining}% (< ${CFG.stopBelowPercent}%)` : null;
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
const norm = (f) => `${path.basename(String(f.file ?? ""))}|${String(f.line ?? "")}|${String(f.problem ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;

// ---------- build-cases ----------
function buildCases() {
  for (const c of CFG.cases) {
    const dir = path.join(CASES_DIR, c.id);
    mkdirSync(dir, { recursive: true });
    const [base, proposed, fix] = [c.base, c.proposed, c.fix].map((r) => fullSha(c.repo, r));
    if (!base || !proposed || !fix) throw new Error(`${c.id}: unknown commit`);
    writeFileSync(path.join(dir, "case.json"), JSON.stringify({
      id: c.id, role: "review", profile: "reviewer", repo: c.repo, commit: proposed, setup: "setup.sh",
      source: `${c.pr} replay: proposed ${c.proposed} (parent of review fix ${c.fix}) against merge-base ${c.base}`,
      timeoutMinutes: CFG.trialTimeoutMinutes, prompt: CFG.prompt,
      check: { type: "script", script: "check.sh", timeoutMinutes: 2 },
    }, null, 2) + "\n");
    writeFileSync(path.join(dir, "setup.sh"), `#!/usr/bin/env bash\n# Full merge-base diff (SCOPE=.), neutral subject.\nBASE=${base} PROPOSED=${proposed} SUBJECT="Proposed change" SCOPE=. exec bash ${q(path.join(HERE, "prr-setup.sh"))}\n`);
    writeFileSync(path.join(dir, "check.sh"), `#!/usr/bin/env bash\nexec python3 ${q(path.join(HERE, "prr-check.py"))}\n`);
    writeFileSync(path.join(dir, "defects.json"), JSON.stringify({ pr: c.pr, base, proposed, fix, provenance: c.provenance, defects: c.defects }, null, 2) + "\n");
    console.log(`wrote ${dir}`);
  }
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
const isComplete = (r) => r && r.status === "done";
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
      record.findings = parseFindings(readFileSync(finalTxt, "utf8"));
    }
  }
  const errText = [record.reason, ...(pe?.runs ?? []).map((r) => r.error)].filter(Boolean).join(" ");
  record.rateLimited = record.status !== "done" && RATE_LIMIT.test(errText);
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
  const launched = () => [...latestTrials().values()].filter((r) => r.provider === prov && !["skipped"].includes(r.status)).length;
  for (const t of trials) {
    if (isComplete(latestTrials().get(t.key))) continue;
    block.stop ??= deadlineHit || now() >= cutoff ? `launch cutoff ${local(cutoff)} reached`
      : freeGB() < CFG.minFreeDiskGB ? `free disk ${freeGB().toFixed(1)} GB < ${CFG.minFreeDiskGB} GB`
      : pcfg.maxTrials != null && launched() >= pcfg.maxTrials ? `trial cap ${pcfg.maxTrials} reached`
      : quotaStop(quotaFor(pcfg.quota, model));
    if (block.stop) break;
    const r = await runTrial(t, env);
    block.ran++;
    if (r.rateLimited) block.stop = `rate limit on ${t.key}: ${String(r.reason).slice(0, 200)}`;
    // A new provider (stopOnFirstFailure) that fails its first trial is skipped for the rest of the campaign.
    else if (pcfg.stopOnFirstFailure && r.status !== "done" && ![...latestTrials().values()].some((x) => x.provider === prov && x.status === "done")) block.stop = `first trial failed (${r.status}): ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 200)}`;
  }
  Object.assign(block, { endedAt: iso(), quotaEnd: quotaFor(pcfg.quota, model) });
  appendFileSync(BLOCKS, JSON.stringify(block) + "\n");
  console.log(`${local(now())} block ${prov} ended: ran ${block.ran}${block.stop ? `, stopped: ${block.stop}` : ""}`);
}

async function run() {
  const plan = schedule();
  const cutoff = DEADLINE - CFG.adjudicationReserveMinutes * 60_000;
  const trials = latestTrials();
  console.log(`face-off ${CFG.id}: ${CASES.length} cases × ${ARMS.length} arms × ${REPS} reps → ${OUT}`);
  console.log(`now ${local(now())}; launch cutoff ${local(cutoff)}; deadline ${local(DEADLINE)}; report ${REPORT}`);
  let finish = now();
  for (const [prov, ts] of Object.entries(plan)) {
    const todo = ts.filter((t) => !isComplete(trials.get(t.key)));
    const cap = CFG.providers[prov].maxTrials;
    const mins = todo.reduce((a, t) => a + armMinutes(t.arm, trials), 0);
    const end = now() + mins * 60_000;
    finish = Math.max(finish, end);
    const qf = quotaFor(CFG.providers[prov].quota, CFG.arms[ts[0].arm].model);
    console.log(`\n[${prov}] ${todo.length}/${ts.length} trials to run, cap ${cap ?? "none"}, ~${Math.round(mins)} min → ${local(end)}${end > cutoff ? "  ⚠ past launch cutoff" : ""}; quota ${qf.state} ${qf.windows.map((w) => `${w.id} ${w.percentRemaining}%`).join(", ") || "no telemetry"}`);
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
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { deadlineHit = true; killAll(); finalize(); process.exit(1); });

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

function pooled(caseId) {
  const map = new Map();
  for (const r of latestTrials().values()) {
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

// Labels every pooled finding of a case once. A later stage sends only findings not labeled before,
// with the clusters already in use, so earlier labels stay fixed and Claude usage grows with new findings.
async function adjudicateCase(c, env) {
  const file = path.join(OUT, "adjudications", `${c.id}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { case: c.id, items: [], labels: [], runs: [] };
  const known = new Map(prev.items.map((i) => [norm(i), i]));
  let next = prev.items.length ? Math.max(...prev.items.map((i) => i.index)) + 1 : 0;
  const merged = pooled(c.id).map(({ key, ...i }) => (known.has(key) ? { ...known.get(key), sources: i.sources } : { ...i, index: next++, fresh: true }));
  const fresh = merged.filter((i) => i.fresh);
  const save = (a) => writeFileSync(file, JSON.stringify(a, null, 2));
  const strip = (items) => items.map(({ fresh: _f, ...i }) => i);
  if (!fresh.length) { const a = { ...prev, items: strip(merged) }; save(a); return a; }
  const adj = CFG.adjudicator;
  const qf = quotaFor(adj.quota, adj.model);
  const stop = quotaStop(qf);
  if (stop) { console.log(`${c.id}: adjudication skipped (${stop})`); return { ...prev, skipped: stop }; }
  const dir = path.join(OUT, "adj", c.id);
  const ws = path.join(dir, "ws");
  buildWorkspace(c, ws, env);
  let diff = sh("git show --stat --patch HEAD", { cwd: ws }).stdout;
  if (diff.length > 200_000) diff = `${diff.slice(0, 200_000)}\n[diff truncated; read the files in the working directory]`;
  const ids = c.defects.map((d) => d.id);
  const clusters = [...new Map(prev.labels.filter((l) => l.label !== "noise").map((l) => [l.cluster, l])).values()];
  const prompt = `You are adjudicating anonymous code-review findings on one proposed change. The working directory holds the proposed version; the change is below. You may read any file; do not modify files.

For every finding decide one label:
- a known-defect id from the list below, only when the finding describes that same failure (same broken rule and consequence), not merely the same file or line;
- "valid": a different real problem a careful maintainer would want fixed before merging; check it against the code;
- "noise": wrong, speculative, style or naming only, or about behaviour the change does not affect.
Also give every finding a "cluster": a short kebab-case slug for its underlying problem. Findings about the same problem get the same slug; a known-defect finding uses the defect id as its cluster.${clusters.length ? " Reuse a slug from the existing clusters below when a finding is about that problem." : ""}

Reply with only JSON: {"labels": [{"index": <n>, "label": "<${ids.join("|")}|valid|noise>", "cluster": "<slug>", "reason": "<one sentence>"}]} with one entry per finding.

## Known defects
${c.defects.map((d) => `- ${d.id}: ${d.description} (around ${d.ranges.map(([f, a, b]) => `${f}:${a}-${b}`).join(", ")})`).join("\n")}
${clusters.length ? `\n## Existing clusters\n${clusters.map((l) => `- ${l.cluster} (${l.label}): ${l.reason}`).join("\n")}\n` : ""}
## Change under review
\`\`\`diff
${diff}
\`\`\`

## Findings
${fresh.map((i) => `${i.index}. ${i.file}:${i.line} — ${i.problem}`).join("\n")}`;
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
  const a = { case: c.id, items: strip(merged.filter((i) => !i.fresh || labeledIdx.has(i.index))), labels: [...prev.labels, ...(labels ?? [])], runs: [...prev.runs, runRec] };
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

// ---------- report ----------
function scored() {
  const trials = latestTrials();
  const adjs = Object.fromEntries(CFG.cases.map((c) => {
    const f = path.join(OUT, "adjudications", `${c.id}.json`);
    return [c.id, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null];
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
    for (const d of defects) clusters.delete(d);
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

function writeReport() {
  const { rows, adjs } = scored();
  const { plan, cases: CASES, arms: ARMS, reps: REPS } = campaignScope();
  const stages = readJsonl(STAGES);
  const blocks = readJsonl(BLOCKS);
  const defectCount = Object.fromEntries(CFG.cases.map((c) => [c.id, c.defects.length]));
  const fmt = (n) => (n == null ? "unknown" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  const L = [];
  L.push(`# production-ready-pr reviewer face-off — ${DATE}`, "");
  L.push(`Written ${local(now())}${deadlineHit ? " (deadline reached: partial)" : ""}. Cases: ${CASES.length} replayed review fixes; arms: ${ARMS.length}; repetitions: ${REPS}. Raw data: \`${OUT}\`.`, "");
  L.push("Scoring: one blinded adjudication per case (" + CFG.adjudicator.model + " " + CFG.adjudicator.effort + ") labels each pooled, deduplicated finding as a known defect (semantic match), a valid extra, or noise. Recall = known defects found / known defects in the adjudicated trials. Tokens = input + output + cache read + cache write as Pi reports them; `unknown` when the provider reports none.", "");

  const arms = ARMS.map((arm) => {
    const all = rows.filter((r) => r.arm === arm);
    const done = all.filter((r) => r.status === "done");
    const adj = done.filter((r) => r.adjudicated);
    const found = adj.reduce((a, r) => a + r.defects.length, 0);
    const possible = adj.reduce((a, r) => a + defectCount[r.case], 0);
    const extras = adj.reduce((a, r) => a + r.validClusters.length, 0);
    const noise = adj.reduce((a, r) => a + r.noise, 0);
    const known = adj.filter((r) => r.tokens != null);
    const tok = known.reduce((a, r) => a + r.tokens, 0);
    const validOnKnown = known.reduce((a, r) => a + r.defects.length + r.validClusters.length, 0);
    const wall = done.length ? done.reduce((a, r) => a + r.wallMs, 0) / done.length / 60_000 : null;
    const cost = done.reduce((a, r) => a + (r.usage?.cost ?? 0), 0);
    return { arm, cfg: CFG.arms[arm], scheduled: plan.filter((t) => t.arm === arm).length, done: done.length, adj: adj.length, found, possible, extras, noise, tok: known.length ? tok : null, unknownTok: adj.length - known.length, perValid: known.length && validOnKnown ? tok / validOnKnown : null, zeroValid: known.length > 0 && validOnKnown === 0, wall, cost };
  });
  L.push("## Per arm", "", "| arm | model | effort | trials done/scheduled | adjudicated | known defects found | recall | valid extras | noise | tokens | tokens per valid finding | mean wall | cost $ |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of arms) L.push(`| ${a.arm} | ${a.cfg.model} | ${a.cfg.effort} | ${a.done}/${a.scheduled} | ${a.adj} | ${a.found}/${a.possible} | ${a.possible ? `${Math.round((100 * a.found) / a.possible)}%` : "-"} | ${a.extras} | ${a.noise} | ${fmt(a.tok)}${a.unknownTok ? ` (+${a.unknownTok} unknown)` : ""} | ${a.zeroValid ? "n/a (0 valid)" : a.perValid == null ? "unknown" : fmt(Math.round(a.perValid))} | ${a.wall == null ? "-" : `${a.wall.toFixed(1)} min`} | ${a.cost ? a.cost.toFixed(2) : "-"} |`);
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

  // Pairs from solo results: union per case and repetition where both arms have an adjudicated trial.
  L.push("## Pair coverage (computed from solo results)", "", "| pair | aligned trials | combined defects found | combined recall | combined valid extras | combined tokens |", "|---|---|---|---|---|---|");
  for (let i = 0; i < ARMS.length; i++) for (let j = i + 1; j < ARMS.length; j++) {
    let n = 0, found = 0, possible = 0, extras = 0, tok = 0, unknown = false;
    for (const c of CASES) for (let rep = 0; rep < REPS; rep++) {
      const a = rows.find((r) => r.key === `${c.id}|${ARMS[i]}|${rep}` && r.adjudicated);
      const b = rows.find((r) => r.key === `${c.id}|${ARMS[j]}|${rep}` && r.adjudicated);
      if (!a || !b) continue;
      n++; possible += c.defects.length;
      found += new Set([...a.defects, ...b.defects]).size;
      extras += new Set([...a.validClusters, ...b.validClusters]).size;
      if (a.tokens == null || b.tokens == null) unknown = true; else tok += a.tokens + b.tokens;
    }
    if (n) L.push(`| ${ARMS[i]} + ${ARMS[j]} | ${n} | ${found}/${possible} | ${Math.round((100 * found) / possible)}% | ${extras} | ${unknown ? "unknown" : fmt(tok)} |`);
  }
  L.push("");

  L.push("## Per case: who found each known defect", "", "| case | defect | provenance | found by (trials) |", "|---|---|---|---|");
  for (const c of CASES) for (const d of c.defects) {
    const by = rows.filter((r) => r.case === c.id && r.adjudicated && r.defects.includes(d.id)).map((r) => `${r.arm}#${r.rep}`);
    L.push(`| ${c.id} | ${d.id} | ${c.provenance} | ${by.join(", ") || (rows.some((r) => r.case === c.id && r.adjudicated) ? "none" : "not adjudicated")} |`);
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
        materialFindings: rs.reduce((a, r) => a + r.defects.length + r.validClusters.length, 0),
        uniqueDefectClasses: mine.size, knownDefectsFound: [...new Set(rs.flatMap((r) => r.defects))],
        noiseFindings: rs.reduce((a, r) => a + r.noise, 0),
        missedCaughtByOther: [...allClasses].filter((k) => !mine.has(k)).length,
        wallMinutes: +(rs.reduce((a, r) => a + r.wallMs, 0) / rs.length / 60_000).toFixed(1),
        tokens: rs.every((r) => r.tokens != null) ? rs.reduce((a, r) => a + r.tokens, 0) : null,
      };
    }).filter(Boolean);
    const [owner, num] = c.pr.split("#");
    appendFileSync(LEDGER, JSON.stringify({ date: DATE, faceoff: true, repository: owner, pr: Number(num), level: "replay", case: c.id, proposed: c.proposed, fix: c.fix, knownDefects: c.defects.map((d) => d.id), slots }) + "\n");
    written.add(c.id);
  }
  writeFileSync(markerFile, JSON.stringify([...written]));
}

// ---------- main ----------
if (cmd === "build-cases") buildCases();
else if (cmd === "setup-check") setupCheck();
else if (cmd === "probe") console.log(JSON.stringify(credentialProbe(trialEnv()), null, 2));
else if (cmd === "run") await run();
else if (cmd === "adjudicate") { mkdirSync(path.join(OUT, "adjudications"), { recursive: true }); await adjudicateAll(trialEnv()); }
else if (cmd === "report") { writeReport(); if (flag("ledger")) writeLedger(); }
else { console.error("usage: faceoff.mjs build-cases | setup-check | run [--dry-run] [--deadline HH:MM] [--out DIR] [--cases a,b] [--arms x,y] [--reps N] [--no-adjudicate] [--ledger] [--report FILE] | adjudicate [--out DIR] [--cases a,b] | report [--out DIR] [--report FILE] [--ledger]"); process.exit(2); }
