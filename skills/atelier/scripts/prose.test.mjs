#!/usr/bin/env node
// The prose gate against sentences agents actually wrote on eval Surfaces, and against subject
// sentences it must leave alone. Run: node scripts/prose.test.mjs
import { metaFindings } from './prose.mjs';

const caught = [
  'Each claim carries its diff hunk, the check that covers it, and its gap.',
  'Six decisions, most dangerous first.',
  'Green hexagons are gates.',
  'See gap 1.',
  'Proposed, not active.',
  'How to comment: select any sentence and press Thread.',
  'Five questions stand between this plan and a decision.',
  'Start with the conflict policy: its answer changes what the rollout question means.',
  'Four questions are open.',
  'None of the proposed text is active yet.',
  'Each value is shown as proposed text only.',
  'For each fix: your report, the change, the checks that prove it, and what no check covers.',
  'The retry budget is capped (see Gaps).',
];
const clean = [
  'Every write lands in both indexes.',
  'Red builds block the merge until the lint gate passes.',
  'Reads switch region by region.',
  'Escape closes an open card and keeps the draft.',
  'Two edits to the same job sheet during one dropout conflict.',
  'Roll out to a 1% canary before the full cutover.',
  'Each question\'s answer changes the rollout plan.',
  'Six technicians reported duplicate entry last week.',
  'The paste check dispatches a synthetic event carrying a 1×1 PNG; no human has pasted an image yet.',
  'Per-field merge keeps both edits and shows the technician which one won.',
  'Recommendation: keep the lint gate and drop the duplicate format step.',
];

let failed = 0;
for (const s of caught) if (!metaFindings([{ region:'t', text:s }]).length) { failed++; console.log(`MISSED  ${s}`); }
for (const s of clean) {
  const f = metaFindings([{ region:'t', text:s }]);
  if (f.length) { failed++; console.log(`FALSE   ${s}  (${f[0].rule})`); }
}
// Sentences split inside one block; one hit is reported once per Region.
const split = metaFindings([{ region:'r', text:'Reads switch region by region. See gap 1. Every write lands in both indexes.' }]);
if (split.length !== 1 || split[0].sentence !== 'See gap 1.') { failed++; console.log(`SPLIT   ${JSON.stringify(split)}`); }
console.log(failed ? `prose gate: ${failed} failure(s)` : `prose gate: ${caught.length} caught, ${clean.length} clean, 0 failures`);
process.exit(failed ? 1 : 0);
