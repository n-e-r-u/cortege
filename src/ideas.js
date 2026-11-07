'use strict';
// ---- Boîte à idées : propositions d'amélioration de Cortège et votes ----
// Une idée proposée reste invisible tant que l'admin ne l'a pas publiée. Statuts : pending (à valider), proposed,
// study (à l'étude), planned (prévue, avec version), done (faite, avec version), no (pas retenue), merged (fusionnée).
// Vote : un par téléphone et par idée. Le jeton est un HMAC de l'identifiant du téléphone propre à chaque idée :
// impossible de relier les votes d'un même téléphone entre deux idées, et aucune adresse IP n'est gardée.
const crypto = require('crypto');
const { q, db, tx } = require('./db');
const { periodKey, deviceHash } = require('./privacy');
const { quota } = require('./limits');

db.exec(`CREATE TABLE IF NOT EXISTS ideas(id TEXT PRIMARY KEY, status TEXT, t INTEGER, votes INTEGER DEFAULT 0, data TEXT);
  CREATE TABLE IF NOT EXISTS idea_votes(iid TEXT, tok TEXT, PRIMARY KEY(iid, tok));
  CREATE INDEX IF NOT EXISTS ideas_st ON ideas(status, votes);`);

const STATUSES = ['pending', 'proposed', 'study', 'planned', 'done', 'no', 'merged'];
const PUBLIC = ['proposed', 'study', 'planned', 'done', 'no'];
const TITLE = [8, 80], BODY = 400, PER_DAY = 3, PENDING_MAX = 300, TOTAL_MAX = 5000;
const LINK = /(https?:\/\/|www\.|\b[\w-]{2,}\.(fr|com|org|net|io|info|be|ch|de|es|eu|ly|gg|me|app|tv)\b)/i;
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

const rowView = r => { const d = JSON.parse(r.data); return { ...d, id: r.id, status: r.status, t: r.t, votes: r.votes }; };
const getIdea = id => { const r = q('SELECT * FROM ideas WHERE id=?').get(id); return r ? rowView(r) : null; };
function saveIdea(i) {
  const { id, status, t, votes, ...data } = i;
  q('INSERT OR REPLACE INTO ideas(id,status,t,votes,data) VALUES(?,?,?,?,?)').run(id, status, t, votes || 0, JSON.stringify(data));
}
// Jeton de vote : propre à l'idée, tiré d'une clé durable du serveur
function voteToken(req, iid) {
  const d = String(req.headers['x-device'] || '');
  if (!/^[\w-]{16,64}$/.test(d)) return null;
  return crypto.createHmac('sha256', periodKey('idea', 0)).update(iid + '|' + d).digest('base64url').slice(0, 22);
}
const publicView = (i, voted) => ({ id: i.id, title: i.title, body: i.body, lang: i.lang, t: i.t, status: i.status, votes: i.votes,
  version: i.version || '', reply: i.reply || '', voted: !!voted });

// Liste publique : par votes, récentes, faites ou pas retenues ; le téléphone sait pour lesquelles il a voté
function listIdeas(req, view) {
  const where = view === 'done' ? "status='done'" : view === 'no' ? "status='no'" : "status IN ('proposed','study','planned')";
  const order = view === 'new' ? 't DESC' : view === 'done' || view === 'no' ? 't DESC' : 'votes DESC, t DESC';
  const rows = q(`SELECT * FROM ideas WHERE ${where} ORDER BY ${order} LIMIT 200`).all().map(rowView);
  return rows.map(i => { const tok = voteToken(req, i.id); return publicView(i, tok && q('SELECT 1 FROM idea_votes WHERE iid=? AND tok=?').get(i.id, tok)); });
}
function proposeIdea(req, b, now = Date.now()) {
  const title = cleanText(b.title, TITLE[1]), body = cleanText(b.body, BODY), lang = /^[a-z]{2}$/.test(b.lang) ? b.lang : 'fr';
  if (title.length < TITLE[0]) return [400, { error: 'Donne un titre un peu plus précis.' }];
  if (LINK.test(title) || LINK.test(body)) return [400, { error: 'Les liens ne sont pas acceptés dans les idées.' }];
  if (q("SELECT COUNT(*) n FROM ideas WHERE status='pending'").get().n >= PENDING_MAX || q('SELECT COUNT(*) n FROM ideas').get().n >= TOTAL_MAX)
    return [503, { error: 'La boîte à idées est pleine pour l’instant. Réessaie plus tard.' }];
  if (!quota('idea:' + deviceHash(req), PER_DAY, 24 * 3600e3, now)) return [429, { error: '3 idées par jour au plus. Merci pour ton enthousiasme !' }];
  const i = { id: crypto.randomBytes(6).toString('base64url'), status: 'pending', t: now, votes: 0, title, body, lang };
  saveIdea(i);
  return [201, { ok: true, pending: true }];
}
function voteIdea(req, id, on) {
  const i = getIdea(id);
  if (!i || !PUBLIC.includes(i.status) || i.status === 'done' || i.status === 'no') return [404, { error: 'Idée introuvable ou plus ouverte aux votes.' }];
  const tok = voteToken(req, id);
  if (!tok) return [400, { error: 'Mets à jour l’appli pour voter.' }];
  if (!quota('ideavote:' + deviceHash(req), 60, 3600e3)) return [429, { error: 'Trop de votes d’un coup, patiente un peu.' }];
  tx(() => {
    const had = !!q('SELECT 1 FROM idea_votes WHERE iid=? AND tok=?').get(id, tok);
    if (on && !had) { q('INSERT INTO idea_votes(iid,tok) VALUES(?,?)').run(id, tok); q('UPDATE ideas SET votes=votes+1 WHERE id=?').run(id); }
    if (!on && had) { q('DELETE FROM idea_votes WHERE iid=? AND tok=?').run(id, tok); q('UPDATE ideas SET votes=MAX(0,votes-1) WHERE id=?').run(id); }
  });
  return [200, { votes: getIdea(id).votes, voted: !!on }];
}

// ---- Admin ----
const adminList = () => q("SELECT * FROM ideas WHERE status!='merged' ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, votes DESC, t DESC").all().map(rowView);
function adminUpdate(id, b) {
  const i = getIdea(id); if (!i) return [404, { error: 'Idée introuvable.' }];
  if (b.status !== undefined) { if (!STATUSES.includes(b.status) || b.status === 'merged') return [400, { error: 'Statut inconnu.' }]; i.status = b.status; }
  if (b.title !== undefined) { const t = cleanText(b.title, TITLE[1]); if (t.length < 3) return [400, { error: 'Titre trop court.' }]; i.title = t; }
  if (b.body !== undefined) i.body = cleanText(b.body, BODY);
  if (b.reply !== undefined) i.reply = cleanText(b.reply, 300);
  if (b.version !== undefined) i.version = /^\d+\.\d+(\.\d+)?$/.test(String(b.version).trim()) ? String(b.version).trim() : '';
  saveIdea(i);
  return [200, i];
}
// Fusion d'un doublon : ses votes rejoignent l'idée gardée (un téléphone qui a voté pour les deux ne compte qu'une fois)
function adminMerge(id, into) {
  const a = getIdea(id), b = getIdea(into);
  if (!a || !b || id === into) return [404, { error: 'Idée introuvable.' }];
  tx(() => {
    // Les jetons sont propres à chaque idée : on ne peut pas dédoublonner, on additionne donc les votes
    q('UPDATE ideas SET votes=votes+? WHERE id=?').run(a.votes, into);
    q('DELETE FROM idea_votes WHERE iid=?').run(id);
    a.status = 'merged'; a.mergedInto = into; a.votes = 0; saveIdea(a);
  });
  return [200, { ok: true }];
}
function adminDelete(id) { const n = q('DELETE FROM ideas WHERE id=?').run(id).changes; q('DELETE FROM idea_votes WHERE iid=?').run(id); return n > 0; }
const pendingCount = () => q("SELECT COUNT(*) n FROM ideas WHERE status='pending'").get().n;

module.exports = { listIdeas, proposeIdea, voteIdea, adminList, adminUpdate, adminMerge, adminDelete, pendingCount, getIdea, STATUSES };
