'use strict';
// ---- Boîte à idées : propositions d'amélioration de Cortège et votes ----
// Une idée proposée reste invisible tant que l'admin ne l'a pas publiée. Statuts : pending (à valider), proposed,
// study (à l'étude), planned (prévue, avec version), done (faite, avec version), no (pas retenue), merged (fusionnée).
// Vote : un par téléphone et par idée, pour (👍) ou contre (👎) ; le classement suit le solde pour moins contre. Le jeton est un HMAC de l'identifiant du téléphone propre à chaque idée :
// impossible de relier les votes d'un même téléphone entre deux idées, et aucune adresse IP n'est gardée.
const crypto = require('crypto');
const { q, db, tx } = require('./db');
const { periodKey, deviceHash } = require('./privacy');
const { quota } = require('./limits');
const { getMeta, setMeta } = require('./db');
const { dirty, scheduleFlush } = require('./live/files');

db.exec(`CREATE TABLE IF NOT EXISTS ideas(id TEXT PRIMARY KEY, status TEXT, t INTEGER, votes INTEGER DEFAULT 0, data TEXT);
  CREATE TABLE IF NOT EXISTS idea_votes(iid TEXT, tok TEXT, PRIMARY KEY(iid, tok));
  CREATE INDEX IF NOT EXISTS ideas_st ON ideas(status, votes);`);
// 2.14.1 : votes contre (colonne « down » des idées, sens « v » de chaque vote : 1 pour, -1 contre)
if (!q('PRAGMA table_info(ideas)').all().some(c => c.name === 'down')) db.exec('ALTER TABLE ideas ADD COLUMN down INTEGER DEFAULT 0');
if (!q('PRAGMA table_info(idea_votes)').all().some(c => c.name === 'v')) db.exec('ALTER TABLE idea_votes ADD COLUMN v INTEGER DEFAULT 1');

const STATUSES = ['pending', 'proposed', 'study', 'planned', 'done', 'no', 'merged'];
const PUBLIC = ['proposed', 'study', 'planned', 'done', 'no'];
const TITLE = [8, 80], BODY = 400, PER_DAY = 3, PENDING_MAX = 300, TOTAL_MAX = 5000;
const LINK = /(https?:\/\/|www\.|\b[\w-]{2,}\.(fr|com|org|net|io|info|be|ch|de|es|eu|ly|gg|me|app|tv)\b)/i;
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);

const rowView = r => { const d = JSON.parse(r.data); return { ...d, id: r.id, status: r.status, t: r.t, votes: r.votes, down: r.down || 0 }; };
const getIdea = id => { const r = q('SELECT * FROM ideas WHERE id=?').get(id); return r ? rowView(r) : null; };
function saveIdea(i) {
  const { id, status, t, votes, down, ...data } = i;
  q('INSERT OR REPLACE INTO ideas(id,status,t,votes,down,data) VALUES(?,?,?,?,?,?)').run(id, status, t, votes || 0, down || 0, JSON.stringify(data));
}
// Jeton de vote : propre à l'idée, tiré d'une clé durable du serveur
function voteToken(req, iid) {
  const d = String(req.headers['x-device'] || '');
  if (!/^[\w-]{16,64}$/.test(d)) return null;
  return crypto.createHmac('sha256', periodKey('idea', 0)).update(iid + '|' + d).digest('base64url').slice(0, 22);
}
// my : vote de ce téléphone (1 pour, -1 contre, 0 aucun) ; voted reste pour les téléphones pas encore à jour
const publicView = (i, my) => ({ id: i.id, title: i.title, body: i.body, lang: i.lang, t: i.t, status: i.status, votes: i.votes, down: i.down || 0,
  version: i.version || '', reply: i.reply || '', my, voted: my === 1, feat: !!i.featured });
// Idées mises au vote par l'admin : le rond 💡 de la carte apparaît tant qu'il y en a au moins une. Leur empreinte va dans
// live/g.json (clé « ideas ») pour que les téléphones rechargent la liste quand elle change.
const OPEN = ['proposed', 'study', 'planned'];
function featuredIds() { return q("SELECT id, data FROM ideas WHERE status IN ('proposed','study','planned')").all().filter(r => JSON.parse(r.data).featured).map(r => r.id).sort(); }
function ideasPublish() {
  const ids = featuredIds(), h = ids.length ? crypto.createHash('sha256').update(ids.join(',')).digest('base64url').slice(0, 8) : '';
  if ((getMeta('ideash') || '') !== h) { setMeta('ideash', h); dirty.global = true; scheduleFlush(); }
}

// Liste publique : par votes, récentes, faites ou pas retenues ; le téléphone sait pour lesquelles il a voté
function listIdeas(req, view) {
  const where = view === 'done' ? "status='done'" : view === 'no' ? "status='no'" : "status IN ('proposed','study','planned')";
  const order = view === 'new' ? 't DESC' : view === 'done' || view === 'no' ? 't DESC' : 'votes-down DESC, votes DESC, t DESC';
  let rows = q(`SELECT * FROM ideas WHERE ${where} ORDER BY ${order} LIMIT 200`).all().map(rowView);
  // « vote » : seulement les idées mises au vote ; « top » : elles passent en tête
  if (view === 'vote') rows = rows.filter(i => i.featured);
  if (view === 'top') rows.sort((a, b) => (!!b.featured - !!a.featured));
  return rows.map(i => { const tok = voteToken(req, i.id), r = tok && q('SELECT v FROM idea_votes WHERE iid=? AND tok=?').get(i.id, tok); return publicView(i, r ? (r.v === -1 ? -1 : 1) : 0); });
}
function proposeIdea(req, b, now = Date.now()) {
  const title = cleanText(b.title, TITLE[1]), body = cleanText(b.body, BODY), lang = /^[a-z]{2}$/.test(b.lang) ? b.lang : 'fr';
  if (title.length < TITLE[0]) return [400, { error: 'Donne un titre un peu plus précis.' }];
  if (LINK.test(title) || LINK.test(body)) return [400, { error: 'Les liens ne sont pas acceptés dans les idées.' }];
  if (q("SELECT COUNT(*) n FROM ideas WHERE status='pending'").get().n >= PENDING_MAX || q('SELECT COUNT(*) n FROM ideas').get().n >= TOTAL_MAX)
    return [503, { error: 'La boîte à idées est pleine pour l’instant. Réessaie plus tard.' }];
  if (!quota('idea:' + deviceHash(req), PER_DAY, 24 * 3600e3, now)) return [429, { error: '3 idées par jour au plus. Merci pour ton enthousiasme !' }];
  const i = { id: crypto.randomBytes(6).toString('base64url'), status: 'pending', t: now, votes: 0, down: 0, title, body, lang };
  saveIdea(i);
  return [201, { ok: true, pending: true }];
}
// v : 1 pour, -1 contre, 0 retire le vote ; changer d'avis passe directement de l'un à l'autre
function voteIdea(req, id, v) {
  const i = getIdea(id);
  if (!i || !PUBLIC.includes(i.status) || i.status === 'done' || i.status === 'no') return [404, { error: 'Idée introuvable ou plus ouverte aux votes.' }];
  if (![1, -1, 0].includes(v)) return [400, { error: 'Vote invalide.' }];
  const tok = voteToken(req, id);
  if (!tok) return [400, { error: 'Mets à jour l’appli pour voter.' }];
  if (!quota('ideavote:' + deviceHash(req), 60, 3600e3)) return [429, { error: 'Trop de votes d’un coup, patiente un peu.' }];
  const col = x => x === -1 ? 'down' : 'votes';
  tx(() => {
    const had = q('SELECT v FROM idea_votes WHERE iid=? AND tok=?').get(id, tok), old = had ? (had.v === -1 ? -1 : 1) : 0;
    if (old === v) return;
    if (old) { q('DELETE FROM idea_votes WHERE iid=? AND tok=?').run(id, tok); q(`UPDATE ideas SET ${col(old)}=MAX(0,${col(old)}-1) WHERE id=?`).run(id); }
    if (v) { q('INSERT INTO idea_votes(iid,tok,v) VALUES(?,?,?)').run(id, tok, v); q(`UPDATE ideas SET ${col(v)}=${col(v)}+1 WHERE id=?`).run(id); }
  });
  const n = getIdea(id);
  return [200, { votes: n.votes, down: n.down, my: v, voted: v === 1 }];
}

// ---- Admin ----
// Tickets GitHub (src/github.js) : mis à jour peu après chaque changement
const ghKick = () => { try { require('./github').kick(); } catch (e) { console.error('GitHub', e.message); } };
function adminList() {
  const nums = require('./github').ghNums();
  return q("SELECT * FROM ideas WHERE status!='merged' ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, votes-down DESC, votes DESC, t DESC").all().map(rowView).map(i => ({ ...i, gh: nums[i.id] || null }));
}
function adminUpdate(id, b) {
  const i = getIdea(id); if (!i) return [404, { error: 'Idée introuvable.' }];
  const wasFeat = !!i.featured;
  if (b.status !== undefined) { if (!STATUSES.includes(b.status) || b.status === 'merged') return [400, { error: 'Statut inconnu.' }]; i.status = b.status; }
  if (b.title !== undefined) { const t = cleanText(b.title, TITLE[1]); if (t.length < 3) return [400, { error: 'Titre trop court.' }]; i.title = t; }
  if (b.body !== undefined) i.body = cleanText(b.body, BODY);
  if (b.reply !== undefined) i.reply = cleanText(b.reply, 300);
  if (b.version !== undefined) i.version = /^\d+\.\d+(\.\d+)?$/.test(String(b.version).trim()) ? String(b.version).trim() : '';
  if (b.featured !== undefined) i.featured = b.featured === true;
  if (!OPEN.includes(i.status)) i.featured = false; // une idée faite, écartée ou à valider n'est pas au vote
  saveIdea(i); ideasPublish();
  // Mise au vote : message sur Bluesky et Mastodon (une seule fois par idée, même si elle est retirée puis remise au vote)
  if (!wasFeat && i.featured) try { require('./social').onIdea(i); } catch (e) { console.error('réseaux (idée)', e.message); }
  ghKick();
  return [200, i];
}
// Fusion d'un doublon : ses votes rejoignent l'idée gardée (un téléphone qui a voté pour les deux ne compte qu'une fois)
function adminMerge(id, into) {
  const a = getIdea(id), b = getIdea(into);
  if (!a || !b || id === into) return [404, { error: 'Idée introuvable.' }];
  tx(() => {
    // Les jetons sont propres à chaque idée : on ne peut pas dédoublonner, on additionne donc les votes
    q('UPDATE ideas SET votes=votes+?, down=down+? WHERE id=?').run(a.votes, a.down || 0, into);
    q('DELETE FROM idea_votes WHERE iid=?').run(id);
    a.status = 'merged'; a.mergedInto = into; a.votes = 0; a.down = 0; a.featured = false; saveIdea(a);
  });
  ideasPublish(); ghKick();
  return [200, { ok: true }];
}
function adminDelete(id) { const n = q('DELETE FROM ideas WHERE id=?').run(id).changes; q('DELETE FROM idea_votes WHERE iid=?').run(id); ideasPublish(); ghKick(); return n > 0; }
const pendingCount = () => q("SELECT COUNT(*) n FROM ideas WHERE status='pending'").get().n;

module.exports = { ideasPublish, featuredIds, listIdeas, proposeIdea, voteIdea, adminList, adminUpdate, adminMerge, adminDelete, pendingCount, getIdea, STATUSES };
