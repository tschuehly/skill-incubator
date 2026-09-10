#!/usr/bin/env bash
# Posts round one of the grilling session in examples/grill-session.html.
#
#   env PORT=4747 UI=examples/grill-session.html ROOT=. STORE=grill node assets/server.mjs
#   bash examples/grill-session.sh [base-url]
#
# The whole frontier goes up in one wave, followed by one Ready: the human sees five questions
# appear together, not five interruptions.
set -euo pipefail
BASE="${1:-${BASE_URL:-http://127.0.0.1:4747}}"
ask() { curl -fsS -X POST "$BASE/api/propose" -H 'Content-Type: application/json' -d "$1" >/dev/null; }

ask '{"region":"grill/sync-model","question":"Which sync model do we build against?",
      "options":["Per-field merge (recommended)","CRDT document","Last-write-wins with a warning banner"]}'

ask '{"region":"grill/conflict-policy","question":"When two offline edits disagree, who decides?",
      "options":["Server merges, technician sees what changed (recommended)","Technician resolves on next sync","Newest device wins silently"]}'

ask '{"region":"grill/rollout","question":"What ships to the first region?",
      "options":["Read-only offline first, writes two weeks later (recommended)","Full offline writes to one pilot region","Nothing until every model question is closed"]}'

ask '{"region":"grill/cost","question":"Is seven weeks acceptable if it removes the reporting rewrite risk entirely?",
      "options":["No — three weeks and reversible wins (recommended)","Yes, if reporting stays SQL-queryable","Need the reporting owner in the room first"]}'

ask '{"region":"grill/premise","question":"Is the 38% dropout figure the right basis, or should this be scoped to the p95 sessions?",
      "options":["Use the 38% figure (recommended)","Scope to p95 dropouts only","Re-measure after the June firmware rollout"]}'

curl -fsS -X POST "$BASE/api/update" -H 'Content-Type: application/json' \
  -d '{"region":"grill","title":"Round one is up","body":"Five questions, all open at once. Answering the conflict policy changes the rollout question, so start there if you want the shortest path."}' >/dev/null

curl -fsS -X POST "$BASE/api/ready" -H 'Content-Type: application/json' \
  -d '{"changed":["grill/premise","grill/sync-model","grill/conflict-policy","grill/rollout","grill/cost"]}' >/dev/null

echo "round one posted to $BASE"
