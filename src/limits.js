'use strict';
// Limites anti-spam : par téléphone et par réseau (5 min), quotas à fenêtre, plafonds des tables, mode manif renforcé.
const { RATE } = require('./config');
const { q, getMeta } = require('./db');

// ---- Mode manif renforcé (réglage admin, avec une durée) ----
const strictUntil = now => { const p = Number(getMeta('strict') || 0); return p > now ? p : 0; };

// Limites anti-spam, sur 5 min
function bump(key, kind, max, now) {
  let r = q('SELECT t, reports, votes FROM rate WHERE k=?').get(key);
  r = !r || now - r.t > RATE.windowMs ? { t: now, reports: 0, votes: 0 } : { t: r.t, reports: r.reports, votes: r.votes };
  if (r[kind + 's'] >= max) return false;
  r[kind + 's']++;
  q('INSERT INTO rate(k,t,reports,votes) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET t=excluded.t, reports=excluded.reports, votes=excluded.votes')
    .run(key, r.t, r.reports, r.votes);
  return true;
}
// Plafonds des tables qui grandissent avec le trafic (même en cas d'attaque, la base garde une taille raisonnable) :
// au-delà, les lignes les plus anciennes partent d'abord
const TABLE_CAPS = [['devices', 'seen', 500_000], ['abuse', 't', 200_000], ['rate', 't', 500_000], ['quota', 't', 200_000], ['orga_log', 't', 200_000]];
function capTables() {
  for (const [t, col, max] of TABLE_CAPS) {
    const n = q(`SELECT COUNT(*) n FROM ${t}`).get().n;
    if (n > max) q(`DELETE FROM ${t} WHERE rowid IN (SELECT rowid FROM ${t} ORDER BY ${col} LIMIT ?)`).run(n - Math.floor(max * 0.9));
  }
}
function quota(key, max, windowMs, now = Date.now()) {
  const r = q('SELECT t, n FROM quota WHERE k=?').get(key), cur = r && now - r.t < windowMs ? r : { t: now, n: 0 };
  if (cur.n >= max) return false;
  q('INSERT OR REPLACE INTO quota(k,t,n) VALUES(?,?,?)').run(key, cur.t, cur.n + 1);
  return true;
}
// Limites des orgas (hors admin) : vérifications par 5 min, annonces urgentes par heure, annonces et événements par jour
const ORGA_LIMITS = { verify: Number(process.env.ORGA_VERIFY_MAX) || 30, urgentPerHour: Number(process.env.ORGA_URGENT_MAX) || 3, annPerDay: 30, eventsPerDay: 20 };
// Vrai si ce téléphone ET cette IP sont sous leurs limites.
function allow(dev, ip, kind, now) {
  const rep = kind === 'report', cur = q('SELECT t, reports, votes FROM rate WHERE k=?').get('ip:' + ip);
  if (cur && now - cur.t <= RATE.windowMs && cur[kind + 's'] >= (rep ? RATE.ipReports : RATE.ipVotes)) return false;
  const strict = strictUntil(now) > 0;
  if (!bump(dev, kind, rep ? (strict ? Math.ceil(RATE.maxReports / 2) : RATE.maxReports) : RATE.maxVotes, now)) return false;
  bump('ip:' + ip, kind, Infinity, now);
  return true;
}

module.exports = { strictUntil, bump, TABLE_CAPS, capTables, quota, ORGA_LIMITS, allow };
