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
cp "$ASSETS"/{atelier.mjs,atelier.css} "$TMP/"
cp "$ASSETS/poll.sh" "$TMP/review-poll.sh"
cat >"$TMP/surface.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="/atelier.css"><script type="module" src="/atelier.mjs"></script></head>
<body><atelier-activity></atelier-activity><section atl-key="screening"><h1>Screening</h1><p>material</p></section>
<atelier-host></atelier-host></body></html>
HTML

# Copies the store file the moment each POST answer's head is written, before a byte of it leaves,
# so a test reads exactly what was on disk when the server answered.
STORE_JSON="$TMP/.review/atelier-test.json"
cat >"$TMP/at-answer.mjs" <<'JS'
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { STORE_JSON, AT_ANSWER } = process.env, writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...args) {
  if (this.req?.method === 'POST') {
    try { fs.mkdirSync(AT_ANSWER, { recursive: true });
      fs.copyFileSync(STORE_JSON, path.join(AT_ANSWER, path.basename(new URL(this.req.url, 'http://x').pathname) + '.json')); } catch {}
  }
  return writeHead.apply(this, args);
};
JS

# Decisions wait UNDO_MS before they reach the agent; a short window keeps this test fast.
UNDO_MS=1500
start_server() {
  ROOT="$TMP" PORT="$PORT" UI="$TMP/surface.html" STORE=atelier-test UNDO_MS="$UNDO_MS" STORE_JSON="$STORE_JSON" AT_ANSWER="$TMP/at-answer" \
    node --import "$TMP/at-answer.mjs" "$TMP/review-server.mjs" >>"$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in {1..40}; do curl -fsS "$BASE/api/state" >/dev/null 2>&1 && break; sleep 0.1; done
}
start_server
curl -fsS "$BASE/api/state" | grep -F '"name":"atelier-test"' >/dev/null

# The kernel's own files must be served next to the server, or a copied kit renders nothing.
curl -fsS "$BASE/atelier.mjs" | grep -F "customElements.define('atelier-host'" >/dev/null
curl -fsS "$BASE/atelier.css" | grep -F '.atl-card' >/dev/null

node "$HERE/lint.test.mjs" >/dev/null

# The static lint replaced the browser check (2026-10-06, ADR 0007): no normal-handoff step may
# require a screenshot verdict, a browser walk, or a cold-reader pass.
if grep -rniE 'cold[- ]reader|read the surface twice|record-visual|screenshot (pass|verdict)|visual judgment' \
    "$HERE/../SKILL.md" "$HERE/../references" "$HERE/preflight.mjs"; then
  echo "FAIL: the handoff still requires a screenshot, browser walk or cold-reader pass" >&2; exit 1
fi

# --- preflight's non-browser gates -----------------------------------------------------
PORT="$PORT" CURSOR_FILE="$TMP/poller.cursor" bash "$TMP/review-poll.sh" --once >"$TMP/poller.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
node "$HERE/preflight.mjs" --url "$BASE" --poller-identity "$TMP/review-poll.sh" >"$TMP/preflight.log" 2>&1 \
  || { echo "FAIL: preflight on a clean Surface:" >&2; cat "$TMP/preflight.log" >&2; exit 1; }
grep -Fx 'PREFLIGHT=PASS' "$TMP/preflight.log" >/dev/null
grep -Fx "NEXT=Open $BASE for the human and keep the poller armed." "$TMP/preflight.log" >/dev/null \
  || { echo "FAIL: a passing preflight did not send the human to the page:" >&2; cat "$TMP/preflight.log" >&2; exit 1; }
if node "$HERE/preflight.mjs" --url "$BASE" --record-visual pass >/dev/null 2>&1; then
  echo "FAIL: preflight still accepts a screenshot verdict" >&2; exit 1
fi

# A copied kit never updates itself, so a Surface must not hand off on a kit it has drifted from.
cp "$TMP/atelier.mjs" "$TMP/atelier.mjs.pristine"
printf '\n// local patch\n' >>"$TMP/atelier.mjs"
if node "$HERE/preflight.mjs" --url "$BASE" --poller-identity "$TMP/review-poll.sh" >"$TMP/kit.log" 2>&1; then
  echo "FAIL: preflight passed on a drifted kit:" >&2; cat "$TMP/kit.log" >&2; exit 1
fi
grep -F 'FAIL KIT' "$TMP/kit.log" >/dev/null
node "$HERE/preflight.mjs" --url "$BASE" --poller-identity "$TMP/review-poll.sh" --allow-kit-drift \
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

# --- a follow-up in a Thread wakes it, marked as one -----------------------------------
unknown_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/thread-message" -H 'Content-Type: application/json' -d '{"region":"screening","id":"nope","msg":"x"}')"
[ "$unknown_status" = 404 ] || { echo "FAIL: follow-up on an unsent Thread returned $unknown_status" >&2; exit 1; }
CURSOR="$(curl -fsS "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(s).seq)))')" \
  PORT="$PORT" CURSOR_FILE="$TMP/follow.cursor" bash "$TMP/review-poll.sh" --once >"$TMP/follow.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
post api/thread-message '{"region":"screening","id":"k1","msg":"One more thing."}'
wait "$POLLER_PID"; POLLER_PID=''
grep -F 'SENT · screening (id k1' "$TMP/follow.log" >/dev/null
grep -F '(follow-up) One more thing.' "$TMP/follow.log" >/dev/null
curl -fsS "$BASE/api/state" | grep -F '"author":"human"' >/dev/null

# --- a pasted image is stored, served, and named in the follow-up wake line -------------
bad_image="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/attach" -H 'Content-Type: application/json' -d '{"type":"text/html","data":"PGI+"}')"
[ "$bad_image" = 400 ] || { echo "FAIL: non-image upload returned $bad_image" >&2; exit 1; }
image_url="$(curl -fsS -X POST "$BASE/api/attach" -H 'Content-Type: application/json' \
  -d '{"type":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="}' \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).url))')"
[ -f "$TMP$image_url" ] || { echo "FAIL: image not stored at $image_url" >&2; exit 1; }
curl -fsS -o /dev/null "$BASE$image_url"
CURSOR="$(curl -fsS "$BASE/api/state" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(s).seq)))')" \
  PORT="$PORT" CURSOR_FILE="$TMP/image.cursor" bash "$TMP/review-poll.sh" --once >"$TMP/image.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
post api/thread-message "{\"region\":\"screening\",\"id\":\"k1\",\"attachments\":[\"$image_url\"]}"
wait "$POLLER_PID"; POLLER_PID=''
grep -F "(follow-up) (image) [images: $image_url]" "$TMP/image.log" >/dev/null \
  || { echo "FAIL: poller line lacks the image:" >&2; cat "$TMP/image.log" >&2; exit 1; }

# --- a Proposal keeps its anchor, and drops anything that is not one --------------------
post api/propose '{"region":"screening/detail","question":"Here?","options":["A"],"anchor":{"quote":"material","prefix":"","junk":1,"point":{"x":"no"}}}'
anchored="$(curl -fsS "$BASE/api/state")"
grep -F '"anchor":{"region":"screening/detail","quote":"material"}' <<<"$anchored" >/dev/null \
  || { echo "FAIL: Proposal anchor not stored cleanly" >&2; exit 1; }

# --- the record survives the server ----------------------------------------------------
# A review that loses its Threads when the server restarts is not a durable record.
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true
start_server
restored="$(curl -fsS "$BASE/api/state")"
grep -F 'Fix this' <<<"$restored" >/dev/null
grep -F '"rejected"' <<<"$restored" >/dev/null
grep -F 'The evidence is still missing.' <<<"$restored" >/dev/null

# --- decisions: validated, one click, undoable, heard by the agent only afterwards ---------
js() { node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const st=JSON.parse(s);process.stdout.write(String($1))})"; }
call() { curl -sS -o "$TMP/call.out" -w '%{http_code}' -X POST "$BASE/$1" -H 'Content-Type: application/json' -d "$2"; }
expect() { local got; got="$(call "$1" "$2")"; [ "$got" = "$3" ] || { echo "FAIL: $1 $2 returned $got, expected $3: $(cat "$TMP/call.out")" >&2; exit 1; }; }
status_of() { curl -fsS "$BASE/api/state" | js "st.proposals['$1'].status"; }
decisions_of() { curl -fsS "$BASE/api/state" | js "st.log.filter(e=>e.kind==='decision'&&e.proposalId==='$1').length"; }
P="$(curl -fsS "$BASE/api/state" | js "Object.values(st.proposals).find(p=>p.question==='Which?').id")"

expect api/decide '{"id":"prop-nope","choiceIndex":0,"attempt":"x"}' 404
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":0}" 400
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":99,\"attempt\":\"x\"}" 400
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":\"1\",\"attempt\":\"x\"}" 400
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":0,\"custom\":\"both\",\"attempt\":\"x\"}" 400
expect api/decide "{\"id\":\"$P\",\"attempt\":\"x\"}" 400
[ "$(status_of "$P")" = open ] || { echo "FAIL: a rejected decide changed the Proposal" >&2; exit 1; }

# A pending choice and its undo must not wake the agent; the closed window must, once.
CURSOR="$(curl -fsS "$BASE/api/state" | js 'st.seq')" PORT="$PORT" CURSOR_FILE="$TMP/decide.cursor" \
  bash "$TMP/review-poll.sh" --once >"$TMP/decide.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":1,\"attempt\":\"a1\"}" 200
[ "$(status_of "$P")" = pending ] || { echo "FAIL: one click did not make the choice pending" >&2; exit 1; }
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":1,\"attempt\":\"a1\"}" 200          # the same click, retried
grep -F '"repeated":true' "$TMP/call.out" >/dev/null || { echo "FAIL: a retried click was not recognised" >&2; exit 1; }
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":0,\"attempt\":\"a2\"}" 409          # a second click
expect api/propose '{"region":"screening","question":"Replacement?","options":["C"]}' 409
expect api/undo-decision "{\"id\":\"$P\",\"attempt\":\"a2\"}" 409                       # stale token
expect api/undo-decision "{\"id\":\"$P\",\"attempt\":\"a1\"}" 200
[ "$(status_of "$P")" = open ] || { echo "FAIL: undo did not reopen the Proposal" >&2; exit 1; }
expect api/undo-decision "{\"id\":\"$P\",\"attempt\":\"a1\"}" 200                       # undo retried
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":1,\"attempt\":\"a1\"}" 409          # an undone click cannot return
sleep "$(node -e "console.log(($UNDO_MS + 600) / 1000)")"
kill -0 "$POLLER_PID" 2>/dev/null || { echo "FAIL: a pending or undone choice woke the agent:" >&2; cat "$TMP/decide.log" >&2; exit 1; }
[ "$(decisions_of "$P")" = 0 ] || { echo "FAIL: an undone choice was logged as a decision" >&2; exit 1; }
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":0,\"attempt\":\"a3\"}" 200
expect api/undo-decision "{\"id\":\"$P\",\"attempt\":\"x\"}" 409
wait "$POLLER_PID"; POLLER_PID=''
grep -F "DECISION · screening" "$TMP/decide.log" >/dev/null || { echo "FAIL: the closed window did not wake the agent:" >&2; cat "$TMP/decide.log" >&2; exit 1; }
grep -Fq 'DECISION-PENDING' "$TMP/decide.log" && { echo "FAIL: pending reached the agent" >&2; exit 1; }
sleep 0.5
[ "$(status_of "$P")" = decided ] && [ "$(decisions_of "$P")" = 1 ] || { echo "FAIL: expected one decision event, found $(decisions_of "$P")" >&2; exit 1; }
expect api/undo-decision "{\"id\":\"$P\",\"attempt\":\"a3\"}" 409                       # window closed
expect api/decide "{\"id\":\"$P\",\"choiceIndex\":0,\"attempt\":\"a3\"}" 200          # retry after commit: no new event
[ "$(decisions_of "$P")" = 1 ] || { echo "FAIL: a retried click logged a second decision" >&2; exit 1; }

# --- the file never falls behind what the server answered ---------------------------------
# An older snapshot written after a newer one turned a pending choice back into an open one. Each
# answer must find its own change already on disk: a write that lands after its answer shows here
# as the state before it.
answered() { js "$1" <"$TMP/at-answer/$2.json"; }
D="$(curl -fsS -X POST "$BASE/api/propose" -H 'Content-Type: application/json' -d '{"region":"screening/answered","question":"On disk?","options":["A","B"]}' | js 'st.id')"
[ "$(answered "st.proposals['$D']?.status" propose)" = open ] || { echo "FAIL: propose answered before its Proposal was on disk" >&2; exit 1; }
expect api/decide "{\"id\":\"$D\",\"choiceIndex\":0,\"attempt\":\"d1\"}" 200
want="pending@$(js 'st.cursor' <"$TMP/call.out")"
[ "$(answered "st.proposals['$D'].status+'@'+st.seq" decide)" = "$want" ] \
  || { echo "FAIL: decide answered while the file said $(answered "st.proposals['$D'].status+'@'+st.seq" decide), not $want" >&2; exit 1; }
expect api/undo-decision "{\"id\":\"$D\",\"attempt\":\"d1\"}" 200
want="open@$(js 'st.cursor' <"$TMP/call.out")"
[ "$(answered "st.proposals['$D'].status+'@'+st.seq" undo-decision)" = "$want" ] \
  || { echo "FAIL: undo answered while the file said $(answered "st.proposals['$D'].status+'@'+st.seq" undo-decision), not $want" >&2; exit 1; }

# A server killed inside the window still delivers the choice once, after restart.
R1="$(curl -fsS -X POST "$BASE/api/propose" -H 'Content-Type: application/json' -d '{"region":"screening/r1","question":"Restart?","options":["A","B"]}' | js 'st.id')"
R2="$(curl -fsS -X POST "$BASE/api/propose" -H 'Content-Type: application/json' -d '{"region":"screening/r2","question":"Down?","options":["A","B"]}' | js 'st.id')"
expect api/decide "{\"id\":\"$R1\",\"choiceIndex\":1,\"attempt\":\"r1\"}" 200
expect api/decide "{\"id\":\"$R2\",\"custom\":\"Neither\",\"attempt\":\"r2\"}" 200
kill -9 "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true       # no flush: pending was written before the reply
start_server
[ "$(status_of "$R1")" = pending ] || { echo "FAIL: a pending choice did not survive a crash" >&2; exit 1; }
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true
sleep "$(node -e "console.log(($UNDO_MS + 300) / 1000)")"             # both windows close while it is down
start_server
sleep 0.5
for id in "$R1" "$R2"; do
  [ "$(status_of "$id")" = decided ] && [ "$(decisions_of "$id")" = 1 ] \
    || { echo "FAIL: $id after restart: $(status_of "$id"), $(decisions_of "$id") decision event(s)" >&2; exit 1; }
done
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true
start_server
sleep 0.5
[ "$(decisions_of "$R1")" = 1 ] || { echo "FAIL: a restart repeated a decision" >&2; exit 1; }

# --- a store that cannot be written changes nothing and tells nobody ----------------------
# The server used to answer 200 with the choice pending while the file still said open.
disk_of() { js "st.proposals['$1'].status" <"$STORE_JSON"; }
F="$(curl -fsS -X POST "$BASE/api/propose" -H 'Content-Type: application/json' -d '{"region":"screening/disk","question":"Disk?","options":["A","B"]}' | js 'st.id')"
curl -sS --max-time 1 "$BASE/api/poll?cursor=$(curl -fsS "$BASE/api/state" | js 'st.seq')" >"$TMP/unsaved.poll" 2>/dev/null &
POLLER_PID=$!
mkdir "$STORE_JSON.tmp"                                               # every write now fails
expect api/decide "{\"id\":\"$F\",\"choiceIndex\":0,\"attempt\":\"f1\"}" 500
wait "$POLLER_PID" || true; POLLER_PID=''
[ ! -s "$TMP/unsaved.poll" ] || { echo "FAIL: a poller heard of an unsaved choice: $(cat "$TMP/unsaved.poll")" >&2; exit 1; }
[ "$(status_of "$F")/$(disk_of "$F")" = open/open ] || { echo "FAIL: an unsaved choice: $(status_of "$F")/$(disk_of "$F")" >&2; exit 1; }
rmdir "$STORE_JSON.tmp"
expect api/decide "{\"id\":\"$F\",\"choiceIndex\":0,\"attempt\":\"f2\"}" 200
mkdir "$STORE_JSON.tmp"
expect api/undo-decision "{\"id\":\"$F\",\"attempt\":\"f2\"}" 500
[ "$(status_of "$F")/$(disk_of "$F")" = pending/pending ] || { echo "FAIL: an unsaved undo: $(status_of "$F")/$(disk_of "$F")" >&2; exit 1; }
sleep "$(node -e "console.log(($UNDO_MS + 500) / 1000)")"           # the window closes while writes fail
[ "$(status_of "$F")/$(disk_of "$F")/$(decisions_of "$F")" = pending/pending/0 ] \
  || { echo "FAIL: an unsaved decision: $(status_of "$F")/$(disk_of "$F")/$(decisions_of "$F")" >&2; exit 1; }
rmdir "$STORE_JSON.tmp"
sleep 1.5                                                            # the next try writes it, once
[ "$(status_of "$F")/$(disk_of "$F")/$(decisions_of "$F")" = decided/decided/1 ] \
  || { echo "FAIL: after the store recovered: $(status_of "$F")/$(disk_of "$F")/$(decisions_of "$F")" >&2; exit 1; }

# --- every Proposal carries a suggested option ------------------------------------------
expect api/propose '{"region":"other","question":"Q?","options":["A"],"suggested":3}' 400
curl -fsS "$BASE/api/state" | grep -F '"suggested":0' >/dev/null || { echo "FAIL: the default suggestion is not stored" >&2; exit 1; }

# --- what each Proposal lets the agent conclude: never read "not opened" as agreement -------
id_of() { curl -fsS -X POST "$BASE/api/propose" -H 'Content-Type: application/json' -d "$1" | js 'st.id'; }
P1="$(id_of '{"region":"d1","question":"Kept?","options":["A","B"],"suggested":1}')"
P2="$(id_of '{"region":"d2","question":"Changed?","options":["A","B"]}')"
P3="$(id_of '{"region":"d3","question":"Looked at?","options":["A","B"]}')"
P4="$(id_of '{"region":"d4","question":"Unseen?","options":["A","B"]}')"
expect api/proposal-opened '{"id":"nope"}' 404
expect api/proposal-opened "{\"id\":\"$P3\"}" 200
first_open="$(curl -fsS "$BASE/api/state" | js "st.proposals['$P3'].openedAt")"
expect api/proposal-opened "{\"id\":\"$P3\"}" 200
[ "$first_open" = "$(curl -fsS "$BASE/api/state" | js "st.proposals['$P3'].openedAt")" ] || { echo "FAIL: a second opening moved openedAt" >&2; exit 1; }
CURSOR="$(curl -fsS "$BASE/api/state" | js 'st.seq')" PORT="$PORT" CURSOR_FILE="$TMP/verdict.cursor" \
  bash "$TMP/review-poll.sh" --once >"$TMP/verdict.log" 2>&1 &
POLLER_PID=$!
sleep 0.4
expect api/decide "{\"id\":\"$P1\",\"choiceIndex\":1,\"attempt\":\"k1\"}" 200
expect api/decide "{\"id\":\"$P2\",\"choiceIndex\":1,\"attempt\":\"k2\"}" 200
reading() { curl -fsS "$BASE/api/state" | js "['d1','d2','d3','d4'].map(r=>st.decisions.find(x=>x.region===r).reading).join(' ')"; }
# A choice inside its undo window is not a decision yet; choosing proves the options were seen.
[ "$(reading)" = 'opened-undecided opened-undecided opened-undecided not-opened-default-stands' ] \
  || { echo "FAIL: readings inside the undo window: $(reading)" >&2; exit 1; }
wait "$POLLER_PID"; POLLER_PID=''
grep -F 'DECISION · d1' "$TMP/verdict.log" | grep -F 'kept as proposed' >/dev/null \
  || { echo "FAIL: the decision wake line does not say it kept the suggestion:" >&2; cat "$TMP/verdict.log" >&2; exit 1; }
grep -Fq 'PROPOSAL-OPENED' "$TMP/verdict.log" && { echo "FAIL: an opened card woke the agent" >&2; exit 1; }
sleep 0.5
[ "$(reading)" = 'kept-as-proposed changed opened-undecided not-opened-default-stands' ] \
  || { echo "FAIL: /api/state decisions read: $(reading)" >&2; exit 1; }
BASE_URL="$BASE" bash "$TMP/review-poll.sh" --decisions >"$TMP/decisions.log"
grep -F "DECISION-STATE · d1 (id $P1) — decided, kept as proposed: B" "$TMP/decisions.log" >/dev/null \
  && grep -F "DECISION-STATE · d2 (id $P2) — decided, changed: B (suggested: A)" "$TMP/decisions.log" >/dev/null \
  && grep -F "DECISION-STATE · d3 (id $P3) — opened, undecided (suggested: A)" "$TMP/decisions.log" >/dev/null \
  && grep -F "DECISION-STATE · d4 (id $P4) — not opened; default stands, NOT agreement (suggested: A)" "$TMP/decisions.log" >/dev/null \
  || { echo "FAIL: poller --decisions output:" >&2; cat "$TMP/decisions.log" >&2; exit 1; }

printf 'atelier server and poll loop: PASS\n'
