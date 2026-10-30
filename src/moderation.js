'use strict';
const { MIN } = require('./config');
const { VOTES } = require('./reports/votes');
const { distKm } = require('./util');
const { inFrance, whereOf } = require('./geo/communes');
const { isDanger, CALM_KILL_M, CAT } = require('./categories');
const { nearby } = require('./reports/store');
const { publicView, toReport } = require('./reports/model');
const { q } = require('./db');

// ---- Tableau des abus ----
const ABUSE_KEEP = 48 * 60 * MIN;
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
function abuseLog(kind, { lat, lng, dev, net, ref } = {}) {
  try { q('INSERT INTO abuse(t,kind,lat,lng,dev,net,ref) VALUES(?,?,?,?,?,?,?)').run(Date.now(), kind, r2(lat), r2(lng), dev || null, net || null, ref || null); } catch {}
}
// Une seule ligne par téléphone et par fenêtre (sinon une rafale remplirait le tableau)
function abuseOnce(kind, dev, windowMs, extra = {}) {
  if (q('SELECT 1 FROM abuse WHERE kind=? AND dev=? AND t>?').get(kind, dev, Date.now() - windowMs)) return;
  abuseLog(kind, { ...extra, dev });
}
// Faux dangers en série : un même téléphone (ou réseau) qui signale des dangers près de plusieurs zones calmes différentes
const SERIES = { win: 30 * MIN, dev: 3, net: 6 };
function calmSeries(dev, net, now) {
  const d = q("SELECT COUNT(DISTINCT ref) n FROM abuse WHERE kind='danger près zone calme' AND dev=? AND t>?").get(dev, now - SERIES.win).n;
  const n = q("SELECT COUNT(DISTINCT ref) n FROM abuse WHERE kind='danger près zone calme' AND net=? AND t>?").get(net, now - SERIES.win).n;
  return d >= SERIES.dev || n >= SERIES.net;
}
// File de modération, la plus urgente d'abord :
// 1 danger contesté (« Plus là »), 2 danger d'une série près de zones calmes, 3 point isolé (à plus de 500 km de toute autre activité)
// ou autre point contesté, 4 « Plus là » isolés ou point hors de France, 5 simple « pas encore confirmé » (téléphone récent, mode renforcé),
// caché par défaut dans l'admin.
const ISOLATED_KM = 500;
function modQueue(now = Date.now()) {
  const act = q('SELECT * FROM reports WHERE exp>? ORDER BY t DESC LIMIT 5000').all(now);
  const cells = new Map();
  for (const x of act) { const k = Math.floor(x.lat) + '_' + Math.floor(x.lng); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(x); }
  const isolated = x => {
    if (act.length < 10 || cells.get(Math.floor(x.lat) + '_' + Math.floor(x.lng)).length > 1) return false;
    return !act.some(y => y !== x && distKm(x.lat, x.lng, y.lat, y.lng) <= ISOLATED_KM);
  };
  const out = [];
  for (const x of act) {
    const danger = isDanger(x.cat), why = [];
    if (x.ct > 0) why.push('contested'); else if (x.down > 0) why.push('down');
    let series = false;
    if (x.fl === -1 && !x.up) {
      series = danger && nearby('calme', x.lat, x.lng, CALM_KILL_M, now).some(c => !c.r.ct);
      why.push(series ? 'series' : 'new');
    }
    const abroad = !inFrance(x.lat, x.lng), iso = isolated(x);
    if (iso) why.push('isolated');
    if (abroad) why.push('abroad');
    if (!why.length) continue;
    const prio = x.ct > 0 && danger ? 1 : series ? 2 : iso || x.ct > 0 ? 3 : x.down > 0 || abroad ? 4 : 5;
    out.push({ ...publicView(toReport(x)), dw: x.dw || 0, fl: x.fl || 0, ct: x.ct || 0, place: abroad ? 'Hors de France' : whereOf(x.lat, x.lng).name,
      group: CAT[x.cat] ? CAT[x.cat].group : '', why, prio, low: prio === 5 });
  }
  out.sort((a, b) => a.prio - b.prio || b.t - a.t);
  return out.slice(0, 400);
}
// Copie du point tel qu'il était avant d'être contesté : l'admin peut le remettre pendant 1 h
function snapshotContested(r, now) {
  q('INSERT OR REPLACE INTO trash(id,t,oid,orga,data) VALUES(?,?,?,?,?)').run(r.id, now, VOTES.id, VOTES.label, JSON.stringify({ ...r, left: r.exp - now }));
}

module.exports = { ABUSE_KEEP, abuseLog, abuseOnce, SERIES, calmSeries, modQueue, snapshotContested };
