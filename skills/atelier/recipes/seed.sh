#!/usr/bin/env bash
# Posts what an agent would post to a recipe, so it can be tried with real Proposals and Updates.
#
#   bash recipes/seed.sh list-detail|document|frontier [base-url]
#
# Run it against a fresh store: a Region that already has an open Proposal answers 409.
set -euo pipefail
RECIPE="${1:?usage: seed.sh list-detail|document|frontier [base-url]}"
BASE="${2:-${BASE_URL:-http://127.0.0.1:4801}}"
post() { curl -fsS -X POST "$BASE/api/$1" -H 'Content-Type: application/json' -d "$2" >/dev/null; }

case "$RECIPE" in
  list-detail)
    post propose '{"region":"v03","question":"Release v03 with its caption 32 px inside the button row?",
      "options":["Move the caption up 40 px, then release (recommended)","Release as is","Drop v03 from this batch"],
      "anchor":{"region":"v03/safe-zone","selector":":scope > td:nth-of-type(1)"}}'
    post propose '{"region":"v04","question":"How do we fix the quiet voice-over in v04?",
      "options":["Re-export with the gain stage (recommended)","Normalise the finished file to −14 LUFS"]}'
    post propose '{"region":"v06","question":"Shorten the countdown card in v06?",
      "options":["Cut it to 1 s so the product shows at 1.2 s (recommended)","Waive the hook rule for countdowns"]}'
    post update '{"region":"v01","title":"v01–v08 rendered","body":"All eight renders finished at 09:40; three fail a check."}'
    ;;
  document)
    post propose '{"region":"migration/steps/cutover","question":"Cut over region by region, or all regions at once?",
      "options":["Region by region, Europe first (recommended)","All regions in one flag flip"],
      "anchor":{"region":"migration/steps/cutover","quote":"Reads switch region by region, Europe first."}}'
    post propose '{"region":"migration/risks/sampling","question":"Raise shadow sampling from 1% to 5% for the last week?",
      "options":["Yes, for the last seven days (recommended)","Keep 1%"]}'
    ;;
  frontier)
    post propose '{"region":"grill/premise","question":"Is the 38% dropout figure the right basis?",
      "options":["Use the 38% figure (recommended)","Scope to the longest 5% of dropouts","Re-measure after the June firmware rollout"]}'
    post propose '{"region":"grill/sync-model","question":"Which sync model do we build against?",
      "options":["Per-field merge (recommended)","CRDT document","Last-write-wins with a warning banner"]}'
    post propose '{"region":"grill/conflict-policy","question":"When two offline edits disagree, who decides?",
      "options":["The server merges and the technician sees what changed (recommended)","The technician resolves on the next sync","The newest device wins silently"]}'
    post propose '{"region":"grill/rollout","question":"What ships to the first region?",
      "options":["Read-only offline first, writes two weeks later (recommended)","Full offline writes to one pilot region","Nothing until every model question is closed"]}'
    post propose '{"region":"grill/cost","question":"Is seven weeks acceptable to remove the reporting risk?",
      "options":["No: three reversible weeks win (recommended)","Yes, if reporting stays queryable in SQL","Decide with the reporting owner first"]}'
    post update '{"region":"grill","title":"Round one is open","body":"Five questions; the conflict policy decides what the rollout can ship."}'
    ;;
  *) echo "unknown recipe: $RECIPE" >&2; exit 2 ;;
esac
echo "seeded $RECIPE at $BASE"
