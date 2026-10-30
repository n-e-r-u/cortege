'use strict';

const { MIN } = require('../config');
const { q } = require('../db');
const { dropReport } = require('../reports/store');

// ---- Journal des actions d'orgas (30 jours) et corbeille des retraits (1 h) ----
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
function orgaStats(oid) {
  const since = Date.now() - 24 * 60 * MIN;
  const rows = q('SELECT action, COUNT(*) n, MAX(t) last FROM orga_log WHERE oid=? AND t>? GROUP BY action').all(oid, since);
  const by = Object.fromEntries(rows.map(x => [x.action, x.n]));
  return { day: { verified: by['vérifié'] || 0, removed: (by['retiré'] || 0) + (by['retrait (essai)'] || 0), blocked: by['retrait bloqué (rafale)'] || 0,
    announcements: (by['annonce'] || 0) + (by['legal team (en attente)'] || 0) }, lastAction: rows.reduce((m, x) => Math.max(m, x.last), 0) || null };
}

module.exports = { TRASH_MS, ORGA_REMOVE_MAX, orgaLog, trashReport, orgaStats };
