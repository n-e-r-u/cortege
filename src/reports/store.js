'use strict';
// Signalements actifs dans la base : lecture, enregistrement (republie la case), retrait (archivé pour le digest), voisinage.
const { q } = require('../db');
const { distM } = require('../util');
const { cellId, dirtyCell } = require('../live/files');
const { toReport, NOTES_KEEP } = require('./model');
const { archive } = require('../digest/archive');

// Points actifs d'une catégorie autour d'une position (pré-filtre par carré, puis distance réelle)
function nearby(cat, lat, lng, m, now) {
  const dLat = m / 111000, dLng = m / (111000 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return q('SELECT * FROM reports WHERE cat=? AND exp>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?')
    .all(cat, now, lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    .map(r => ({ r, d: distM({ lat, lng }, r) })).filter(x => x.d <= m).sort((a, b) => a.d - b.d);
}

const getReport = (id, now) => toReport(q('SELECT * FROM reports WHERE id=? AND exp>?').get(id, now));
const activeReports = (now, limit = 2000) => q('SELECT * FROM reports WHERE exp>? ORDER BY t DESC LIMIT ?').all(now, limit);
function saveReport(r) {
  const cell = cellId(r.lat, r.lng);
  if (r.cell && r.cell !== cell) dirtyCell(r.cell); // le point a glissé dans une autre case
  const notes = (r.notes || (r.note ? [{ x: r.note, t: r.t }] : [])).slice(0, NOTES_KEEP);
  r.note = notes[0] ? notes[0].x : ''; // la plus récente, pour les téléphones pas encore à jour
  q(`INSERT INTO reports(id,cat,lat,lng,cell,note,t,exp,up,down,ver,voters,down_ips,ip,last,notes,dw,ct,fl,oid,trail,bk,bkla,bklo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET cat=excluded.cat, lat=excluded.lat, lng=excluded.lng, cell=excluded.cell, note=excluded.note, notes=excluded.notes, exp=excluded.exp, up=excluded.up,
       down=excluded.down, ver=excluded.ver, voters=excluded.voters, down_ips=excluded.down_ips, last=excluded.last, dw=excluded.dw, ct=excluded.ct, fl=excluded.fl, trail=excluded.trail, bk=excluded.bk, bkla=excluded.bkla, bklo=excluded.bklo`)
    .run(r.id, r.cat, r.lat, r.lng, cell, r.note || '', r.t, r.exp, r.up || 0, r.down || 0, r.ver || null,
      JSON.stringify((r.voters || []).slice(-500)), JSON.stringify((r.downIps || []).slice(-100)), r.ip || null, r.last || r.t, JSON.stringify(notes), r.dw || 0, r.ct || 0, r.fl || 0, r.oid || null,
      r.trail && r.trail.length ? JSON.stringify(r.trail) : null, r.bk || 0, r.bkla ?? null, r.bklo ?? null);
  dirtyCell(cell);
}
// outcome : ce qu'est devenu le point, pour le digest (orga, admin, full = zone saturée, purge…)
function dropReport(id, outcome) {
  const r = q('DELETE FROM reports WHERE id=? RETURNING *').get(id);
  if (r) { archive(r, outcome || 'removed'); dirtyCell(r.cell); }
  return !!r;
}

module.exports = { nearby, getReport, activeReports, saveReport, dropReport };
