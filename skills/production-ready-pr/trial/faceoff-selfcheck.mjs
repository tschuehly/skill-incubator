#!/usr/bin/env node
// Self-check of faceoff.mjs's pure functions on in-memory inputs: node faceoff-selfcheck.mjs
import assert from "node:assert/strict";
import { appReadings, caseFingerprint, codexbarReading, mergeReadings, needsRelabel, pairStats, pct, quotaStop, recallDefects, recallPossible } from "./faceoff.mjs";

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
console.log("faceoff self-check passed");
