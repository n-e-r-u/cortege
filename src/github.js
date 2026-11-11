'use strict';
// ---- Boîte à idées reliée aux tickets GitHub du dépôt ----
// Chaque idée publiée (tout statut autre que « à valider ») a son ticket sur le dépôt du code : titre, texte, langue, votes,
// statut, réponse et lien vers l'idée dans l'appli. Le ticket est tenu à jour (votes au plus toutes les 10 min) ; il est fermé
// quand l'idée est faite (« completed », avec la version), pas retenue ou fusionnée (« not planned », avec la réponse ou le
// ticket gardé). Rien d'autre n'est envoyé : ni téléphone, ni adresse, ni date précise.
// Identifiants dans les variables d'environnement seulement :
//   GITHUB_TOKEN (jeton « fine-grained » limité au dépôt, droit Issues : lecture et écriture), GITHUB_REPO (compte/dépôt)
//   GITHUB_WEBHOOK_SECRET (facultatif) : un ticket fermé sur GitHub marque l'idée faite ou pas retenue dans Cortège.
const crypto = require('crypto');
const { db, q, getMeta, setMeta } = require('./db');
const { MIN, PUBLIC_URL } = require('./config');

db.exec('CREATE TABLE IF NOT EXISTS idea_gh(iid TEXT PRIMARY KEY, num INTEGER, h TEXT, lab TEXT, state TEXT, cm TEXT, t INTEGER)');

const ENV = () => ({ token: (process.env.GITHUB_TOKEN || '').trim(), repo: (process.env.GITHUB_REPO || '').trim(),
  api: (process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, ''), secret: process.env.GITHUB_WEBHOOK_SECRET || '' });
const ready = e => !!(e.token && /^[\w.-]+\/[\w.-]+$/.test(e.repo));
const BASE_LABEL = 'idée-cortège';
const LABELS = { proposed: 'proposée', study: 'à l’étude', planned: 'prévue', done: 'faite', no: 'pas retenue', merged: 'fusionnée' };
const ST_FR = { proposed: 'Proposée', study: 'À l’étude', planned: 'Prévue', done: 'Faite', no: 'Pas retenue', merged: 'Fusionnée' };
const CLOSED = { done: 'completed', no: 'not_planned', merged: 'not_planned' };
const SYNCED = Object.keys(LABELS);
const base = () => (process.env.PUBLIC_URL || PUBLIC_URL).replace(/\/+$/, '');

// Texte des personnes : pas de mention (@compte) ni de référence (#12) qui préviendrait ou relierait quelqu'un sur GitHub
const tame = s => String(s || '').replace(/@(?=\w)/g, '@​').replace(/#(?=\d)/g, '#​').replace(/<!--|-->/g, '');
const quote = s => tame(s).split('\n').map(l => '> ' + l).join('\n');
function issueBody(i) {
  const st = ST_FR[i.status] + (i.version && ['planned', 'done'].includes(i.status) ? ' (version ' + i.version + ')' : '');
  return [
    `Idée proposée dans Cortège (langue : ${String(i.lang || 'fr').toUpperCase()}).`, '',
    quote(i.body || '(sans description)'), '',
    `👍 ${i.votes || 0} · 👎 ${i.down || 0}`, '',
    `**Statut** : ${st}`,
    ...(i.reply ? [`**Réponse** : ${tame(i.reply)}`] : []), '',
    `Voir et voter dans l'appli : ${base()}/?idee=${i.id}`, '',
    '<sub>Ce ticket est tenu à jour automatiquement depuis Cortège.</sub>',
    `<!-- cortege-idee:${i.id} -->`,
  ].join('\n');
}
const hash = (...a) => crypto.createHash('sha256').update(JSON.stringify(a)).digest('base64url').slice(0, 16);

// ---- Appels à l'API GitHub ----
async function gh(method, p, body) {
  const e = ENV();
  const r = await fetch(`${e.api}/repos/${e.repo}${p}`, { method, signal: AbortSignal.timeout(15000), headers: {
    authorization: 'Bearer ' + e.token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
    'user-agent': 'Cortege', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(`GitHub ${r.status} : ${String(j.message || r.statusText).slice(0, 120)}`); err.status = r.status; throw err; }
  return j;
}
const row = iid => q('SELECT * FROM idea_gh WHERE iid=?').get(iid);
const saveRow = r => q('INSERT OR REPLACE INTO idea_gh(iid,num,h,lab,state,cm,t) VALUES(?,?,?,?,?,?,?)').run(r.iid, r.num, r.h, r.lab, r.state, r.cm, Date.now());

function closeComment(i) {
  if (i.status === 'done') return '✅ Idée réalisée' + (i.version ? ' dans la version ' + i.version : '') + '.' + (i.reply ? '\n\n' + tame(i.reply) : '');
  if (i.status === 'no') return '✖ Idée pas retenue.' + (i.reply ? '\n\n' + tame(i.reply) : '');
  const into = i.mergedInto && row(i.mergedInto);
  return 'Fusionnée avec ' + (into ? '#' + into.num : 'une autre idée') + ' : les votes y sont regroupés.';
}
// Met un ticket au niveau de son idée ; renvoie le nombre d'appels faits
async function syncIdea(i) {
  let r = row(i.id), n = 0;
  const title = tame(i.title).slice(0, 200), body = issueBody(i), h = hash(title, body), lab = LABELS[i.status];
  if (!r) {
    let j;
    try { j = await gh('POST', '/issues', { title, body, labels: [BASE_LABEL, lab] }); }
    catch (e) { if (e.status !== 422 && e.status !== 403) throw e; j = await gh('POST', '/issues', { title, body }); } // étiquettes refusées : ticket sans
    n++; r = { iid: i.id, num: j.number, h, lab, state: 'open', cm: null }; saveRow(r);
  }
  if (r.h !== h) { await gh('PATCH', '/issues/' + r.num, { title, body }); n++; r.h = h; saveRow(r); }
  if (r.lab !== lab) {
    try { await gh('POST', `/issues/${r.num}/labels`, { labels: [BASE_LABEL, lab] }); n++; } catch (e) { if (e.status !== 422 && e.status !== 403) throw e; }
    if (r.lab) try { await gh('DELETE', `/issues/${r.num}/labels/${encodeURIComponent(r.lab)}`); n++; } catch (e) { if (e.status !== 404) throw e; }
    r.lab = lab; saveRow(r);
  }
  const want = CLOSED[i.status] ? 'closed' : 'open';
  if (want === 'closed' && r.cm !== i.status) { await gh('POST', `/issues/${r.num}/comments`, { body: closeComment(i) }); n++; r.cm = i.status; saveRow(r); }
  if (r.state !== want) {
    await gh('PATCH', '/issues/' + r.num, want === 'closed' ? { state: 'closed', state_reason: CLOSED[i.status] } : { state: 'open' }); n++;
    r.state = want; if (want === 'open') r.cm = null; saveRow(r);
  }
  return n;
}
// Idée supprimée de Cortège : son ticket est fermé, le texte retiré
async function syncGone(r) {
  await gh('PATCH', '/issues/' + r.num, { title: 'Idée retirée', body: 'Cette idée a été retirée de Cortège.', state: 'closed', state_reason: 'not_planned' });
  q('DELETE FROM idea_gh WHERE iid=?').run(r.iid);
}

// ---- Synchronisation : toutes les 10 min, et peu après chaque changement dans l'admin ----
// Au plus 30 appels par tour, espacés : les règles de GitHub limitent les créations en rafale.
let running = false, kickT = null;
const MAX_CALLS = +(process.env.GITHUB_MAX_CALLS || 30), GAP = +(process.env.GITHUB_GAP_MS || 1200);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function ghSync() {
  if (running || !ready(ENV())) return;
  running = true;
  const I = require('./ideas');
  let calls = 0;
  try {
    // Fusionnées en dernier : le ticket gardé existe déjà quand on cite son numéro
    const ideas = q(`SELECT id FROM ideas WHERE status IN (${SYNCED.map(() => '?').join(',')}) ORDER BY CASE status WHEN 'merged' THEN 1 ELSE 0 END, t`).all(...SYNCED)
      .map(x => I.getIdea(x.id)).filter(i => i && !(i.status === 'merged' && !row(i.id)));
    for (const i of ideas) {
      if (calls >= MAX_CALLS) break;
      const n = await syncIdea(i); calls += n; if (n) await wait(GAP);
    }
    for (const r of q('SELECT g.* FROM idea_gh g LEFT JOIN ideas i ON i.id=g.iid WHERE i.id IS NULL').all()) {
      if (calls >= MAX_CALLS) break;
      await syncGone(r); calls++; await wait(GAP);
    }
    setMeta('github_err', '');
    if (calls >= MAX_CALLS) kick(60_000); // reste à faire : tour suivant dans une minute
  } catch (e) {
    console.error('GitHub', e.message); setMeta('github_err', JSON.stringify({ t: Date.now(), msg: e.message }));
  } finally { running = false; }
}
function kick(ms = 3000) { clearTimeout(kickT); kickT = setTimeout(() => ghSync().catch(() => {}), ms); kickT.unref?.(); }
if (process.env.GITHUB_SYNC !== '0') {
  setInterval(() => ghSync().catch(() => {}), +(process.env.GITHUB_TICK_MS || 10 * MIN)).unref();
  kick(+(process.env.GITHUB_FIRST_MS || 30_000));
}

// ---- Retour depuis GitHub (webhook « Issues ») ----
// Ticket fermé à la main : idée faite (« completed ») ou pas retenue (« not planned ») ; rouvert : de nouveau à l'étude.
function ghVerify(raw, sig) {
  const s = ENV().secret; if (!s || !/^sha256=[0-9a-f]{64}$/.test(String(sig || ''))) return false;
  const mac = Buffer.from('sha256=' + crypto.createHmac('sha256', s).update(raw).digest('hex'));
  const got = Buffer.from(String(sig));
  return got.length === mac.length && crypto.timingSafeEqual(got, mac);
}
function ghEvent(ev, p) {
  if (ev === 'ping') return { ok: true, ping: true };
  if (ev !== 'issues' || !p?.issue || p.repository?.full_name?.toLowerCase() !== ENV().repo.toLowerCase()) return { ok: true, ignored: true };
  const r = q('SELECT * FROM idea_gh WHERE num=?').get(p.issue.number);
  if (!r) return { ok: true, ignored: true };
  const I = require('./ideas'), i = I.getIdea(r.iid);
  if (!i) return { ok: true, ignored: true };
  if (p.action === 'closed') {
    r.state = 'closed';
    const st = ['not_planned', 'duplicate'].includes(p.issue.state_reason) ? 'no' : 'done';
    if (!CLOSED[i.status]) { r.cm = st; saveRow(r); I.adminUpdate(i.id, { status: st }); return { ok: true, status: st }; }
    saveRow(r); return { ok: true };
  }
  if (p.action === 'reopened') {
    r.state = 'open'; r.cm = null; saveRow(r);
    if (i.status === 'done' || i.status === 'no') { I.adminUpdate(i.id, { status: 'study' }); return { ok: true, status: 'study' }; }
    return { ok: true };
  }
  return { ok: true, ignored: true };
}

// ---- Admin ----
const ghNums = () => Object.fromEntries(q('SELECT iid, num FROM idea_gh').all().map(r => [r.iid, r.num]));
function ghStatus() {
  const e = ENV(); let err = null; try { err = JSON.parse(getMeta('github_err') || 'null'); } catch {}
  return { ready: ready(e), repo: e.repo || null, url: e.repo ? 'https://github.com/' + e.repo + '/issues' : null, hook: !!e.secret,
    n: q('SELECT COUNT(*) n FROM idea_gh').get().n, err: err || null };
}

module.exports = { ghSync, kick, ghVerify, ghEvent, ghNums, ghStatus, issueBody };
