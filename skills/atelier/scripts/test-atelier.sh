#!/usr/bin/env bash
# Atelier server + poller test — the half of the kernel a browser cannot see.
#
#   bash scripts/test-atelier.sh
#
# scripts/verify.mjs covers the page. This covers the wake path: which events reach the agent and,
# more importantly, which must never reach it. A `ready` that woke the agent would make it answer
# its own announcement forever, and that failure is invisible in a browser.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ASSETS="$HERE/../assets"
TMP="$(mktemp -d)"
PORT=$((48000 + $$ % 1000))
SERVER_PID=''
POLLER_PID=''

cleanup() {
  [ -n "$POLLER_PID" ] && { kill "$POLLER_PID" 2>/dev/null || true; wait "$POLLER_PID" 2>/dev/null || true; }
  [ -n "$SERVER_PID" ] && { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
  rm -rf "$TMP"
}
trap cleanup EXIT

BASE="http://127.0.0.1:$PORT"
post() { curl -fsS -X POST "$BASE/$1" -H 'Content-Type: application/json' -d "$2" >/dev/null; }

cp "$ASSETS/server.mjs" "$TMP/review-server.mjs"
cp "$ASSETS/atelier.mjs" "$ASSETS/atelier.css" "$TMP/"
cp "$ASSETS/poll.sh" "$TMP/review-poll.sh"
cat >"$TMP/surface.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="/atelier.css"><script type="module" src="/atelier.mjs"></script></head>
<body><atelier-region key="screening"><h1>Screening</h1><p>material</p></atelier-region></body></html>
HTML

ROOT="$TMP" PORT="$PORT" UI="$TMP/surface.html" STORE=atelier-test node "$TMP/review-server.mjs" >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in {1..40}; do curl -fsS "$BASE/api/state" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS "$BASE/api/state" | grep -F '"name":"atelier-test"' >/dev/null

# The kernel's own files must be served next to the server, or a copied kit renders nothing.
curl -fsS "$BASE/atelier.mjs" | grep -F "customElements.define('atelier-region'" >/dev/null
curl -fsS "$BASE/atelier.css" | grep -F '.atl-region' >/dev/null

# --- preflight's non-browser gates -----------------------------------------------------
PORT="$PORT" CURSOR_FILE="$TMP/poller.cursor" bash "$TMP/review-poll.sh" --once >"$TMP/poller.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
node "$HERE/preflight.mjs" --url "$BASE" --poller-identity "$TMP/review-poll.sh" --skip-render \
  | grep -Fx 'PREFLIGHT=PASS' >/dev/null

# A copied kit never updates itself, so a Surface must not hand off on a kit it has drifted from.
cp "$TMP/atelier.mjs" "$TMP/atelier.mjs.pristine"
printf '\n// local patch\n' >>"$TMP/atelier.mjs"
if node "$HERE/preflight.mjs" --url "$BASE" --poller-identity "$TMP/review-poll.sh" --skip-render >"$TMP/kit.log" 2>&1; then
  echo "FAIL: preflight passed on a drifted kit:" >&2; cat "$TMP/kit.log" >&2; exit 1
fi
grep -F 'FAIL KIT' "$TMP/kit.log" >/dev/null
node "$HERE/preflight.mjs" --url "$BASE" --poller-identity "$TMP/review-poll.sh" --skip-render --allow-kit-drift \
  | grep -Fx 'PREFLIGHT=PASS' >/dev/null
mv "$TMP/atelier.mjs.pristine" "$TMP/atelier.mjs"

# --- agent-origin events must NOT wake the agent ---------------------------------------
post api/ready   '{"changed":["screening"]}'
post api/update  '{"region":"screening","title":"agent note"}'
post api/propose '{"region":"screening","question":"Which?","options":["A","B"]}'
sleep 0.6
if ! kill -0 "$POLLER_PID" 2>/dev/null; then
  echo "FAIL: the poller woke on an agent-origin event:" >&2; cat "$TMP/poller.log" >&2; exit 1
fi

# Former staging and destructive endpoints are gone and cannot mutate review state.
before="$(curl -fsS "$BASE/api/state")"
clear_status="$(curl -sS -o "$TMP/clear.out" -w '%{http_code}' -X POST "$BASE/api/clear" -H 'Content-Type: application/json' -d '{"scope":"all"}')"
flush_status="$(curl -sS -o "$TMP/flush.out" -w '%{http_code}' -X POST "$BASE/api/flush" -H 'Content-Type: application/json' -d '{}')"
after="$(curl -fsS "$BASE/api/state")"
[ "$clear_status" = 404 ] && [ "$flush_status" = 404 ] || { echo "FAIL: removed endpoint still responds" >&2; exit 1; }
[ "$before" = "$after" ] || { echo "FAIL: removed endpoint mutated state" >&2; exit 1; }

# A second Proposal cannot displace the human's open question.
proposal_status="$(curl -sS -o "$TMP/proposal.out" -w '%{http_code}' -X POST "$BASE/api/propose" \
  -H 'Content-Type: application/json' -d '{"region":"screening","question":"Replacement?","options":["C"]}')"
[ "$proposal_status" = 409 ] || { echo "FAIL: duplicate Proposal returned $proposal_status" >&2; exit 1; }
proposal_state="$(curl -fsS "$BASE/api/state")"
grep -F 'Which?' <<<"$proposal_state" >/dev/null
grep -F '"status":"open"' <<<"$proposal_state" >/dev/null
! grep -F 'Replacement?' <<<"$proposal_state" >/dev/null

# --- a human command wakes it, addressed by Region Key ---------------------------------
post api/event '{"kind":"signoff","region":"screening","data":{"round":1},"wake":true}'
wait "$POLLER_PID"; POLLER_PID=''
grep -F 'COMMAND · screening' "$TMP/poller.log" >/dev/null
grep -F 'signoff' "$TMP/poller.log" >/dev/null
grep -Fq 'READY' "$TMP/poller.log" && { echo "FAIL: ready reached the agent" >&2; exit 1; }
grep -Fq 'UPDATE' "$TMP/poller.log" && { echo "FAIL: update reached the agent" >&2; exit 1; }

# --- a rejection wakes it with its required follow-up ----------------------------------
post api/state        '{"threads":{"screening":[{"id":"k1","text":"Fix this"}]}}'
! curl -fsS "$BASE/api/state" | grep -F '"queued"' >/dev/null
post api/send         '{"region":"screening","id":"k1"}'
post api/comment-state '{"region":"screening","id":"k1","state":"implemented"}'
CURSOR="$(curl -fsS "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(s).seq)))')" \
  PORT="$PORT" CURSOR_FILE="$TMP/reject.cursor" bash "$TMP/review-poll.sh" --once >"$TMP/reject.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
post api/comment-reject '{"region":"screening","id":"k1","msg":"The evidence is still missing."}'
wait "$POLLER_PID"; POLLER_PID=''
grep -F 'COMMENT-REJECTED · screening' "$TMP/reject.log" >/dev/null
grep -F 'The evidence is still missing.' "$TMP/reject.log" >/dev/null

# --- the record survives the server ----------------------------------------------------
# A review that loses its Threads when the server restarts is not a durable record.
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true
ROOT="$TMP" PORT="$PORT" UI="$TMP/surface.html" STORE=atelier-test node "$TMP/review-server.mjs" >>"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in {1..40}; do curl -fsS "$BASE/api/state" >/dev/null 2>&1 && break; sleep 0.1; done
restored="$(curl -fsS "$BASE/api/state")"
grep -F 'Fix this' <<<"$restored" >/dev/null
grep -F '"rejected"' <<<"$restored" >/dev/null
grep -F 'The evidence is still missing.' <<<"$restored" >/dev/null

printf 'atelier server and poll loop: PASS\n'
