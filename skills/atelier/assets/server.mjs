#!/usr/bin/env node
// atelier kernel — serves an agent-authored Surface and hosts its durable interaction loop.
// Vendored from the atelier skill: copy into <project>/tools/, own it, extend it.
// Zero dependencies (node:http). Upgrade path: diff against the skill's assets/server.mjs.
//
//   node tools/review-server.mjs                          # serve + print URL
//   PORT=4747 UI=tools/my-surface.html STORE=2026-08-27 node tools/review-server.mjs
//   UNDO_MS=30000                                       # how long a chosen option can be undone
//
// The server is deliberately ignorant of content: it knows Region KEYS as opaque strings and
// nothing about the document tree. Identity, layout, and rendering belong to the Surface.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.ROOT || path.join(HERE, '..'));   // dir served statically
const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || '127.0.0.1';
const UI   = path.resolve(process.env.UI || path.join(HERE, 'surface.html'));
const NAME = process.env.STORE || 'atelier';
const DATA_DIR = path.join(ROOT, '.review');                             // gitignore this
const STORE_FILE = path.join(DATA_DIR, `${NAME}.json`);
// The human may take back a choice for this long; the agent hears of it only afterwards.
const UNDO_MS = /^\d+$/.test(process.env.UNDO_MS || '') ? Number(process.env.UNDO_MS) : 30000;
await fsp.mkdir(DATA_DIR, { recursive: true });

const KIT_FILES = new Set(['/atelier.mjs', '/atelier.css', '/atelier-blocks.mjs', '/atelier-blocks.css']);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png',
  '.svg':'image/svg+xml', '.gif':'image/gif', '.woff2':'font/woff2', '.woff':'font/woff', '.mp4':'video/mp4',
  '.webm':'video/webm', '.mp3':'audio/mpeg', '.ico':'image/x-icon', '.txt':'text/plain', '.md':'text/markdown' };

// ---- durable store ----
// Every address is ONE Region key (a path like "onboarding/provider"). There is no Card/Section split.
// { name, threads:{[region]:[{id,text,tags,sev,anchor?,attachments?}]}, ← human Threads, client-owned
//   attachments = ['/.review/attachments/<file>'] (pasted images, uploaded through /api/attach)
//   anchor = {region, quote?, prefix?, selector?, point?:{x,y}}; only region = the whole Region
//   sent:{[commentId]:iso}, replies:{[commentId]:[{ts,msg,author:'agent'|'human',attachments?}]}, commentState:{[commentId]:{value,ts}},
//   proposals:{[id]:{id,region,threadId,anchor,question,options,suggested,explanationRequests,explanations,status,choiceIndex,custom,
//     attempt,undoUntil,cancelledAttempts,ts,openedAt,decidedAt}},     status: open → pending → decided; Undo: pending → open
//   updates:{[id]:{id,region,title,body,ts,dismissedAt}},
//   changed:{[region]:{ts}},                                        ← named by Ready, cleared by ack
//   log:[{seq,kind,region,id,ts,...}], seq }
// Attention is NOT stored: the Surface derives it from changed/proposals/commentState/updates.
// Neither is `decisions`: GET /api/state derives it from proposals for the agent (see decisionsOf).
// Normal protocol actions preserve Threads. A Thread whose Region left the document stays in
// `threads`; the Surface shows it as archived.
function emptyStore(){ return { name:NAME, threads:{}, sent:{}, replies:{}, commentState:{},
  proposals:{}, updates:{}, changed:{}, log:[], seq:0 }; }
const COMMENT_STATES = ['open','acknowledged','in_progress','implemented','accepted','rejected'];
let store = emptyStore();
try { store = { ...emptyStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }; } catch {}

// Every mutation is written synchronously before anyone hears of it, so writes can never overtake
// each other. A write that fails puts the store back to what is on disk and throws: the request
// answers 500, no event goes out, and the human's page still holds what they wrote.
// ponytail: the whole store is rewritten per mutation; append a journal if stores reach many MB.
let saved = JSON.stringify(store, null, 2);
function persist(){
  const json = JSON.stringify(store, null, 2), tmp = STORE_FILE + '.tmp';
  try {
    fs.mkdirSync(DATA_DIR, { recursive:true });
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, STORE_FILE);
  } catch (error){
    store = JSON.parse(saved);
    console.error('store write failed, change rolled back:', error.message);
    throw error;
  }
  saved = json;
  notifyPollers();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));   // nothing is ever unwritten
// Pollers hear of a logged event only once persist() has written it.
function logEvent(kind, region, id, extra){
  store.seq += 1;
  store.log.push({ seq: store.seq, kind, region: region||null, id: id||null, ts: new Date().toISOString(), ...extra });
  if (store.log.length > 5000) store.log = store.log.slice(-4000);
}

// ---- decisions: one click, then an undo window, then the agent hears of it -------------
// A choice is `pending` until undoUntil. Only then is `decision` logged, which is what wakes the
// agent, so a human who takes a choice back has cost the agent nothing. The store is written before
// any caller hears of a change, and boot re-arms every pending choice, so a restart neither drops
// nor repeats a decision. A failed write leaves the choice pending and tries again a second later.
const undoTimers = new Map();
function armDecision(pr){
  clearTimeout(undoTimers.get(pr.id));
  undoTimers.set(pr.id, setTimeout(() => commitDecision(pr.id), Math.max(0, pr.undoUntil - Date.now())));
}
function commitDecision(id){
  undoTimers.delete(id);
  const pr = store.proposals[id];
  if (!pr || pr.status !== 'pending') return;
  if (Date.now() < pr.undoUntil) return armDecision(pr);          // a timer may fire a millisecond early
  pr.status = 'decided'; pr.decidedAt = new Date().toISOString();
  const kept = pr.custom == null && pr.choiceIndex === suggestedOf(pr);
  logEvent('decision', pr.region, pr.threadId, { proposalId:id, choiceIndex:pr.choiceIndex, custom:pr.custom,
    suggested:suggestedOf(pr), verdict: kept ? 'kept as proposed' : 'changed from the suggestion' });
  // A decision proves the human reviewed the Proposal's Region.
  if (store.changed[pr.region]){ delete store.changed[pr.region]; logEvent('ack', pr.region, null, {}); }
  try { persist(); } catch { undoTimers.set(id, setTimeout(() => commitDecision(id), 1000)); }
}

// ---- long-poll ----
const pollers = new Set();
function notifyPollers(){
  for (const p of [...pollers]){
    const events = store.log.filter(e => e.seq > p.cursor);
    if (events.length){ clearTimeout(p.timer); pollers.delete(p); sendJSON(p.res, 200, { cursor: store.seq, events }); }
  }
}

// ---- helpers ----
const sendJSON = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(b), 'Cache-Control':'no-store' }); res.end(b); };
const readBody = (req) => new Promise((resolve) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{resolve(JSON.parse(d||'{}'));}catch{resolve({});} }); });
const commentBody = (c) => { const { id, ...rest } = c; return rest; };
const findComment = (region, id) => (store.threads[region]||[]).find(c=>c.id===id);
const IMAGE_TYPES = { 'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp' };
const cleanImages = a => Array.isArray(a) ? a.filter(u => typeof u === 'string' && /^\/\.review\/attachments\/[\w.-]+$/.test(u)).slice(0, 10) : [];
// An anchor points inside its Region; anything else is dropped rather than stored half-valid.
function cleanAnchor(a, region){
  if (!a || typeof a !== 'object') return null;
  const out = { region: str(a.region, 300) || region };
  for (const f of ['quote','prefix','selector']) if (str(a[f], 1000)) out[f] = str(a[f], 1000);
  if (a.point && Number.isFinite(a.point.x) && Number.isFinite(a.point.y)) out.point = { x:+a.point.x, y:+a.point.y };
  return out;
}
const str = (v, max) => { const s = typeof v==='string' ? v.trim() : ''; return s.length && s.length<=max ? s : null; };
// Every Proposal carries a suggested option; stores written before `suggested` existed meant the first.
const suggestedOf = pr => Number.isInteger(pr.suggested) ? pr.suggested : 0;
// What the agent may conclude about each Proposal. "Opened" means its card's options were on the human's
// screen (the kernel reports it, or a click chose one). An unopened Proposal's default is NOT agreement,
// and a choice still inside its undo window is not a decision yet: it reads opened-undecided.
function decisionsOf(s){
  return Object.values(s.proposals || {}).map(pr => {
    const suggested = suggestedOf(pr), decided = pr.status === 'decided';
    const kept = decided && pr.custom == null && pr.choiceIndex === suggested;
    return { id:pr.id, region:pr.region, question:pr.question, suggested:pr.options?.[suggested] ?? null,
      reading: decided ? (kept ? 'kept-as-proposed' : 'changed') : pr.openedAt ? 'opened-undecided' : 'not-opened-default-stands',
      answer: decided ? (pr.custom ?? pr.options?.[pr.choiceIndex] ?? null) : null,
      openedAt: pr.openedAt || null, decidedAt: pr.decidedAt || null };
  });
}

function resolveStatic(urlPath){
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const p = path.normalize(path.join(ROOT, clean));
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) return null;
  return p;
}

function serveStatic(req, res, filePath){
  fs.stat(filePath, (err, st) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    if (st.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.stat(filePath, (e2, st2) => {
      if (e2){ res.writeHead(404); res.end('not found'); return; }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      if (range && (type.startsWith('video') || type.startsWith('audio'))){
        const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        const start = m[1] ? parseInt(m[1],10) : 0;
        const end = m[2] ? parseInt(m[2],10) : st2.size - 1;
        res.writeHead(206, { 'Content-Type':type, 'Content-Range':`bytes ${start}-${end}/${st2.size}`,
          'Accept-Ranges':'bytes', 'Content-Length': end-start+1, 'Cache-Control':'no-store' });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type':type, 'Content-Length':st2.size, 'Cache-Control':'no-store' });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {                        // one bad request must not end the session
    console.error('request failed:', req.method, req.url, error.message);
    if (!res.headersSent) sendJSON(res, 500, { ok:false, error:'internal error' });
    else res.end();
  });
});

async function handle(req, res){
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/state'){
    if (req.method === 'GET') return sendJSON(res, 200, { ...store, decisions: decisionsOf(store) });
    if (req.method === 'POST'){                          // autosave drafts: client owns `threads`
      const body = await readBody(req);
      if (body && body.threads && typeof body.threads === 'object'){ store.threads = body.threads; persist(); }
      return sendJSON(res, 200, { ok:true });
    }
  }

  // ---- the agent's turn boundary -------------------------------------------------------
  // Ready is the ONLY thing that moves new content onto the human's screen. `changed` names the
  // Regions whose MEANING changed; it accumulates until the human acknowledges each one.
  if (p === '/api/ready' && req.method === 'POST'){      // { changed:[regionKey] }
    const { changed } = await readBody(req);
    if (!Array.isArray(changed)) return sendJSON(res, 400, { ok:false, error:'need changed[]' });
    const keys = [];
    for (const candidate of changed){
      const key = str(candidate, 300);
      if (!key) return sendJSON(res, 400, { ok:false, error:'each changed entry must be a bounded region key' });
      keys.push(key);
    }
    const ts = new Date().toISOString();
    for (const key of keys) store.changed[key] = { ts };
    logEvent('ready', null, null, { changed: keys });  // the Surface cannot validate keys server-side
    persist();                                          // (no region registry) — it warns on unknown keys
    return sendJSON(res, 200, { ok:true, changed: keys, cursor: store.seq });
  }

  if (p === '/api/ack' && req.method === 'POST'){        // { region } — human cleared the changed marker
    const { region } = await readBody(req);
    const key = str(region, 300);
    if (!key) return sendJSON(res, 400, { ok:false, error:'need region' });
    if (store.changed[key]){ delete store.changed[key]; logEvent('ack', key, null, {}); persist(); }
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  // ---- agent → human messages ----------------------------------------------------------
  // An Update needs no answer. Anything needing an answer is a Proposal. Whether an Update also
  // raises a desktop notification is the HUMAN's page preference, never the agent's choice.
  if (p === '/api/update' && req.method === 'POST'){     // { region, title, body? }
    const { region, title, body } = await readBody(req);
    const key = str(region, 300), head = str(title, 200);
    if (!key || !head) return sendJSON(res, 400, { ok:false, error:'need region and title' });
    const id = `upd-${++store.seq}`;
    store.updates[id] = { id, region:key, title:head, body: body==null ? '' : String(body).slice(0,2000),
      ts:new Date().toISOString(), dismissedAt:null };
    logEvent('update', key, id, { title:head }); persist();
    return sendJSON(res, 200, { ok:true, id, cursor: store.seq });
  }

  if (p === '/api/update-dismiss' && req.method === 'POST'){ // { id }
    const { id } = await readBody(req);
    const update = store.updates[String(id||'')];
    if (!update) return sendJSON(res, 404, { ok:false, error:'unknown update' });
    update.dismissedAt = new Date().toISOString();
    logEvent('update-dismissed', update.region, update.id, {}); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  // ---- Threads -------------------------------------------------------------------------
  if (p === '/api/send' && req.method === 'POST'){       // { region, id } — dispatch ONE comment
    const { region, id } = await readBody(req);
    const c = findComment(region, id);
    if (c){ store.sent[id] = new Date().toISOString();
      if (!store.commentState[id]) store.commentState[id] = { value:'open', ts:new Date().toISOString() };
      logEvent('sent', region, id, { comment: commentBody(c) });
      // Sending proves the human read this Region; let every open page observe the normal ack.
      if (store.changed[region]){ delete store.changed[region]; logEvent('ack', region, null, {}); }
      persist(); }
    return sendJSON(res, 200, { ok: !!c, cursor: store.seq });
  }

  if (p === '/api/reply' && req.method === 'POST'){      // { region, id, msg, state? } — agent reply
    const { region, id, msg, state } = await readBody(req);
    if (state==='rejected') return sendJSON(res, 400, { ok:false, error:'use /api/comment-reject with a non-empty msg' });
    (store.replies[id] ||= []).push({ ts:new Date().toISOString(), msg:String(msg||''), author:'agent' });
    logEvent('reply', region, id, { msg });
    if (state && COMMENT_STATES.includes(state)){ store.commentState[id] = { value:state, ts:new Date().toISOString() }; logEvent('comment-state', region, id, { state }); }
    persist();
    return sendJSON(res, 200, { ok:true });
  }

  if (p === '/api/comment-reject' && req.method === 'POST'){ // { region, id, msg } — atomic follow-up + rejection
    const { region, id, msg } = await readBody(req);
    const text = str(msg, 4000);
    if (!findComment(region, id) || !store.sent[id]) return sendJSON(res, 404, { ok:false, error:'unknown sent comment' });
    if (store.commentState[id]?.value!=='implemented') return sendJSON(res, 409, { ok:false, error:'only an implemented comment can be rejected' });
    if (!text) return sendJSON(res, 400, { ok:false, error:'need a rejection follow-up of at most 4000 characters' });
    const ts = new Date().toISOString();
    (store.replies[id] ||= []).push({ ts, msg:text, author:'human' });
    store.commentState[id] = { value:'rejected', ts };
    logEvent('comment-rejected', region, id, { state:'rejected', msg:text }); persist();
    return sendJSON(res, 200, { ok:true, state:'rejected', cursor: store.seq });
  }

  // open → acknowledged → in_progress → implemented (agent) → accepted (human, terminal).
  // Rejection uses /api/comment-reject so the follow-up and the wake event are atomic.
  if (p === '/api/comment-state' && req.method === 'POST'){ // { region, id, state }
    const { region, id, state } = await readBody(req);
    if (!COMMENT_STATES.includes(state)) return sendJSON(res, 400, { ok:false, error:'invalid state', allowed:COMMENT_STATES });
    if (state==='rejected') return sendJSON(res, 400, { ok:false, error:'use /api/comment-reject with a non-empty msg' });
    if (id){ store.commentState[id] = { value:state, ts:new Date().toISOString() }; logEvent('comment-state', region||null, id, { state }); persist(); }
    return sendJSON(res, 200, { ok: !!id, state, cursor: store.seq });
  }

  // A Thread is a conversation: the human writes into it after the first message. It wakes the
  // agent like a first comment does, marked as a follow-up.
  if (p === '/api/thread-message' && req.method === 'POST'){ // { region, id, msg, attachments? }
    const { region, id, msg, attachments } = await readBody(req);
    const text = str(msg, 4000), images = cleanImages(attachments);
    if (!findComment(region, id) || !store.sent[id]) return sendJSON(res, 404, { ok:false, error:'unknown sent comment' });
    if (!text && !images.length) return sendJSON(res, 400, { ok:false, error:'need a msg of at most 4000 characters or an image' });
    const extra = images.length ? { attachments:images } : {};
    (store.replies[id] ||= []).push({ ts:new Date().toISOString(), msg:text || '', author:'human', ...extra });
    logEvent('sent', region, id, { followUp:text || '(image)', ...extra }); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  // An image the human pasted into a Thread. Stored under .review/attachments/ and served from
  // there; the Thread or follow-up carries its URL, and the agent reads <ROOT><url>.
  if (p === '/api/attach' && req.method === 'POST'){     // { type, data:base64 }
    const { type, data } = await readBody(req);
    const ext = IMAGE_TYPES[type];
    if (!ext || typeof data !== 'string') return sendJSON(res, 400, { ok:false, error:'need a PNG, JPEG, GIF or WebP image' });
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return sendJSON(res, 413, { ok:false, error:'images must be at most 10 MB' });
    const file = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await fsp.mkdir(path.join(DATA_DIR, 'attachments'), { recursive:true });
    await fsp.writeFile(path.join(DATA_DIR, 'attachments', file), bytes);
    return sendJSON(res, 200, { ok:true, url:`/.review/attachments/${file}` });
  }

  // ---- Proposals: every question the agent has takes this shape -------------------------
  if (p === '/api/propose' && req.method === 'POST'){    // { region, question, options[], suggested?, threadId?, anchor? }
    const { region, question, options, suggested = 0, threadId, anchor } = await readBody(req);
    const key = str(region, 300), q = str(question, 2000);
    if (!key || !q || !Array.isArray(options) || !options.length)
      return sendJSON(res, 400, { ok:false, error:'need region, question, options[]' });
    if (!Number.isInteger(suggested) || suggested < 0 || suggested >= options.length)
      return sendJSON(res, 400, { ok:false, error:'suggested must be the index of one of the options' });
    const open = Object.values(store.proposals).find(pr => (pr.status==='open' || pr.status==='pending')
      && (pr.region===key || (threadId && pr.threadId===threadId)));
    if (open) return sendJSON(res, 409, { ok:false, error:'resolve the existing open Proposal before asking another', proposalId:open.id });
    const id = `prop-${++store.seq}`;
    store.proposals[id] = { id, region:key, threadId:threadId||null, anchor:cleanAnchor(anchor, key), question:q, options, suggested,
      explanationRequests:{}, explanations:{}, status:'open', choiceIndex:null, custom:null,
      ts:new Date().toISOString(), openedAt:null, decidedAt:null };
    logEvent('proposal', key, threadId||null, { proposalId:id }); persist();
    return sendJSON(res, 200, { ok:true, id });
  }

  // One click chooses; the same attempt token repeated is the same click, never a second choice.
  if (p === '/api/decide' && req.method === 'POST'){     // { id, choiceIndex | custom, attempt }
    const { id, choiceIndex, custom, attempt } = await readBody(req);
    const pr = store.proposals[String(id||'')];
    if (!pr) return sendJSON(res, 404, { ok:false, error:'unknown proposal' });
    const token = str(attempt, 100), byIndex = choiceIndex != null, text = custom == null ? null : str(custom, 4000);
    if (!token) return sendJSON(res, 400, { ok:false, error:'need an attempt token of at most 100 characters' });
    if (byIndex === (custom != null)) return sendJSON(res, 400, { ok:false, error:'send exactly one of choiceIndex or custom' });
    if (byIndex && !(Number.isInteger(choiceIndex) && choiceIndex >= 0 && choiceIndex < pr.options.length))
      return sendJSON(res, 400, { ok:false, error:`choiceIndex must be an option index from 0 to ${pr.options.length - 1}` });
    if (!byIndex && !text) return sendJSON(res, 400, { ok:false, error:'custom must be text of at most 4000 characters' });
    if (pr.attempt === token && pr.status !== 'open')
      return sendJSON(res, 200, { ok:true, repeated:true, status:pr.status, undoUntil:pr.undoUntil, cursor: store.seq });
    if (pr.status !== 'open') return sendJSON(res, 409, { ok:false, error:`this Proposal is ${pr.status}, not open`, status:pr.status });
    if ((pr.cancelledAttempts||[]).includes(token)) return sendJSON(res, 409, { ok:false, error:'this choice was undone' });
    pr.openedAt ||= new Date().toISOString();           // choosing an option proves its card was seen
    Object.assign(pr, { status:'pending', choiceIndex: byIndex ? choiceIndex : null, custom: byIndex ? null : text,
      attempt:token, undoUntil: Date.now() + UNDO_MS });
    logEvent('decision-pending', pr.region, pr.threadId, { proposalId:pr.id, choiceIndex:pr.choiceIndex, custom:pr.custom, undoUntil:pr.undoUntil });
    persist(); armDecision(pr);
    return sendJSON(res, 200, { ok:true, status:'pending', undoUntil:pr.undoUntil, cursor: store.seq });
  }

  if (p === '/api/undo-decision' && req.method === 'POST'){ // { id, attempt } — before undoUntil only
    const { id, attempt } = await readBody(req);
    const pr = store.proposals[String(id||'')];
    if (!pr) return sendJSON(res, 404, { ok:false, error:'unknown proposal' });
    const token = str(attempt, 100);
    if (!token) return sendJSON(res, 400, { ok:false, error:'need the attempt token of the choice to undo' });
    if (pr.status === 'open' && (pr.cancelledAttempts||[]).includes(token)) return sendJSON(res, 200, { ok:true, repeated:true, status:'open' });
    if (pr.status === 'pending' && Date.now() >= pr.undoUntil) commitDecision(pr.id);
    if (pr.status !== 'pending') return sendJSON(res, 409, { ok:false, error: pr.status === 'decided' ? 'the undo window has closed' : 'nothing to undo', status:pr.status });
    if (pr.attempt !== token) return sendJSON(res, 409, { ok:false, error:'a newer choice replaced this one' });
    const undone = { choiceIndex:pr.choiceIndex, custom:pr.custom };
    (pr.cancelledAttempts ||= []).push(token);
    Object.assign(pr, { status:'open', choiceIndex:null, custom:null, attempt:null, undoUntil:null });
    logEvent('decision-undone', pr.region, pr.threadId, { proposalId:pr.id, ...undone });
    persist();                                          // throws on failure: the choice stays pending
    clearTimeout(undoTimers.get(pr.id)); undoTimers.delete(pr.id);
    return sendJSON(res, 200, { ok:true, status:'open', cursor: store.seq });
  }

  // A Proposal's options were on the human's screen: the first time is recorded, later ones are not.
  if (p === '/api/proposal-opened' && req.method === 'POST'){ // { id }
    const { id } = await readBody(req);
    const pr = store.proposals[String(id||'')];
    if (!pr) return sendJSON(res, 404, { ok:false, error:'unknown proposal' });
    if (!pr.openedAt){ pr.openedAt = new Date().toISOString(); logEvent('proposal-opened', pr.region, pr.threadId, { proposalId:pr.id }); persist(); }
    return sendJSON(res, 200, { ok:true, openedAt:pr.openedAt, cursor: store.seq });
  }

  if (p === '/api/explain-request' && req.method === 'POST'){ // { id, optionIndex, answer }
    const { id, optionIndex, answer } = await readBody(req);
    const pr = store.proposals[id], text = str(answer, 2000);
    if (!pr || optionIndex===undefined || !text)
      return sendJSON(res, 400, { ok:false, error:'need proposal id, optionIndex, and answer' });
    const ts = new Date().toISOString();
    (pr.explanationRequests ||= {})[String(optionIndex)] = { status:'requested', answer:text, ts };
    logEvent('explain-request', pr.region, pr.threadId, { proposalId:id, optionIndex, answer:text }); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  if (p === '/api/explain' && req.method === 'POST'){    // { id, optionIndex, text } — agent answers
    const { id, optionIndex, text } = await readBody(req);
    const pr = store.proposals[id], body = str(text, 4000);
    if (!pr || optionIndex===undefined || !body)
      return sendJSON(res, 400, { ok:false, error:'need proposal id, optionIndex, and text' });
    const key = String(optionIndex), ts = new Date().toISOString();
    (pr.explanations ||= {})[key] = { text:body, ts };
    (pr.explanationRequests ||= {})[key] = { ...(pr.explanationRequests[key]||{}), status:'answered', ts };
    logEvent('explanation', pr.region, pr.threadId, { proposalId:id, optionIndex, text:body }); persist();
    return sendJSON(res, 200, { ok:true, cursor: store.seq });
  }

  if (p === '/api/event' && req.method === 'POST'){      // { kind, region?, data?, wake? } — bespoke event
    const { kind, region, data, wake } = await readBody(req);
    const action = str(kind, 100), target = region==null ? null : str(region, 300);
    if (!action) return sendJSON(res, 400, { ok:false, error:'need a bounded event kind' });
    if (wake === true) logEvent('command', target, null, { action, data: data ?? null });
    else logEvent(action, target, null, data == null ? {} : { data });
    persist();
    return sendJSON(res, 200, { ok:true, kind: wake===true?'command':action, cursor: store.seq });
  }

  if (p === '/api/poll'){                                // long-poll: events with seq > cursor
    const cursor = Number(url.searchParams.get('cursor') || 0);
    const events = store.log.filter(e => e.seq > cursor);
    if (events.length) return sendJSON(res, 200, { cursor: store.seq, events });
    const poller = { res, cursor };
    poller.timer = setTimeout(()=>{ pollers.delete(poller); sendJSON(res, 200, { cursor, events: [] }); }, 25000);
    pollers.add(poller);
    req.on('close', ()=>{ clearTimeout(poller.timer); pollers.delete(poller); });
    return;
  }

  // ---- task endpoints (add yours here) ----

  // ---- static ----
  if (p === '/') return serveStatic(req, res, UI);
  if (KIT_FILES.has(p)) return serveStatic(req, res, path.join(HERE, p.slice(1)));
  const fp = resolveStatic(p);
  if (!fp){ res.writeHead(403); res.end('forbidden'); return; }
  serveStatic(req, res, fp);
}

server.listen(PORT, HOST, ()=>{
  console.log(`▶ Atelier  http://${HOST}:${PORT}/`);
  console.log(`  root:  ${ROOT}`);
  console.log(`  ui:    ${UI}`);
  console.log(`  store: ${STORE_FILE}`);
});
// A choice made before a restart still reaches the agent once its window closes, exactly once.
for (const pr of Object.values(store.proposals)) if (pr.status === 'pending') armDecision(pr);
