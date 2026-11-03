'use strict';

const { MIN } = require('../config');
const { q } = require('../db');
const { dropReport } = require('../reports/store');

// ---- Journal des actions d'orgas (gardé sans limite) et corbeille des retraits (1 h) ----
const TRASH_MS = 60 * 60_000;
const ORGA_REMOVE_MAX = Number(process.env.ORGA_REMOVE_MAX) || 15; // retraits par orga et par 5 min
function orgaLog(orga, action, { r, lat, lng, ref, detail } = {}) {
  const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);
  try {
    q('INSERT INTO orga_log(t,oid,orga,action,cat,lat,lng,ref,detail) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), orga.id || null, orga.label, action, r ? r.cat : null, r3(r ? r.lat : lat), r3(r ? r.lng : lng), ref || (r ? r.id : null), detail ? String(detail).slice(0, 200) : null);
  } catch (e) { console.error('journal', e.message); }
}
// Un point retiré par une orga reste restaurable une heure par l'admin
function trashReport(r, orga) {
  const now = Date.now();
  q('INSERT OR REPLACE INTO trash(id,t,oid,orga,data) VALUES(?,?,?,?,?)').run(r.id, now, orga.id || null, orga.label, JSON.stringify({ ...r, left: r.exp - now }));
  dropReport(r.id, orga.id === 'admin' ? 'admin' : 'orga');
}
// Compteurs d'une orga : dernières 24 h et depuis le début (journal complet), plus la date de sa première action
function orgaStats(oid) {
  const since = Date.now() - 24 * 60 * MIN;
  const rows = q('SELECT action, COUNT(*) n, SUM(t>?) d, MAX(t) last, MIN(t) first FROM orga_log WHERE oid=? GROUP BY action').all(since, oid);
  const sum = (key, ...acts) => acts.reduce((s, a) => s + ((rows.find(x => x.action === a) || {})[key] || 0), 0);
  const pick = key => ({ verified: sum(key, 'vérifié', 'confirmé (essai)', 'confirmé (parrainée)'), removed: sum(key, 'retiré', 'retrait (essai)'), blocked: sum(key, 'retrait bloqué (rafale)'),
    announcements: sum(key, 'annonce', 'annonce (en attente)', 'legal team (en attente)'), actions: rows.reduce((s, x) => s + (x[key] || 0), 0) });
  return { day: pick('d'), total: pick('n'), lastAction: rows.reduce((m, x) => Math.max(m, x.last), 0) || null, firstAction: rows.reduce((m, x) => Math.min(m, x.first), Infinity) === Infinity ? null : rows.reduce((m, x) => Math.min(m, x.first), Infinity) };
}

module.exports = { TRASH_MS, ORGA_REMOVE_MAX, orgaLog, trashReport, orgaStats };
