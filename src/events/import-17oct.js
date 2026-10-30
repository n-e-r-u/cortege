'use strict';
const fs = require('fs');
const path = require('path');
const { EVENT_KEEP, dropEvent, getEvent, saveEvent } = require('./store');
const { MIN, DATA_DIR } = require('../config');
const { tx, q } = require('../db');
const { validLatLng, clean, sha, round } = require('../util');
const { parisMs } = require('../time');
const { getJson } = require('../net');

// ---- Import : manifestations de la carte participative du 17 octobre (réutilisation autorisée) ----
// On importe les actions « manifestation » (où qu'elles soient) et les « rassemblements » des lieux de manif.
// Les blocages de stations, raffineries, péages… ne sont pas importés.
const IMPORT_17 = process.env.IMPORT_17OCT !== '0';
const IMPORT_BASE = (process.env.IMPORT_17OCT_URL || 'https://www.17octobregiletjaune.net').replace(/\/$/, '');
const IMPORT_UNTIL = Date.parse(process.env.IMPORT_17OCT_UNTIL || '2026-11-01');
const IMPORT_EVERY = 15 * MIN;
const IMPORT_STAMP = path.join(DATA_DIR, 'import-17oct.stamp');
let stationCache = { t: 0, map: new Map() };
async function import17() {
  const [lieux, actions, sites] = await Promise.all([getJson(IMPORT_BASE + '/api/lieux'), getJson(IMPORT_BASE + '/api/actions'),
    getJson(IMPORT_BASE + '/data/sites.json').catch(() => ({ lieux: [] }))]);
  const places = new Map();
  for (const l of sites.lieux || []) places.set(String(l[0]), { kind: l[1], lat: +l[2], lng: +l[3], name: l[4], city: l[6] });
  for (const l of lieux.lieux || []) places.set(String(l[0]), { kind: l[1], lat: +l[2], lng: +l[3], name: l[4], city: l[6] });
  const keep = [];
  for (const [id, list] of Object.entries(actions.actions || {})) (list || []).forEach((a, i) => {
    const type = a[0], kind = places.get(id)?.kind;
    if (type === 'manifestation' || (type === 'rassemblement' && kind === 'manif')) keep.push({ id, i, type, time: a[1], date: a[2] });
  });
  // Manifestations annoncées devant une station-service : coordonnées dans le fichier des stations (lourd, relu toutes les 6 h)
  if (keep.some(k => !places.has(k.id)) && Date.now() - stationCache.t > 6 * 60 * MIN) {
    const st = await getJson(IMPORT_BASE + '/api/stations', 90_000).catch(() => null);
    if (Array.isArray(st)) stationCache = { t: Date.now(), map: new Map(st.map(x => [String(x.id), { kind: 'station', lat: +x.geom?.lat, lng: +x.geom?.lon, name: x.adresse, city: x.ville }])) };
  }
  const now = Date.now(), out = new Map();
  for (const k of keep) {
    const p = places.get(k.id) || stationCache.map.get(k.id);
    if (!p || !validLatLng(p.lat, p.lng) || !/^\d{4}-\d{2}-\d{2}$/.test(k.date) || !/^\d{1,2}:\d{2}$/.test(k.time || '')) continue;
    const start = parisMs(k.date, k.time);
    if (!(start + EVENT_KEEP > now)) continue;
    const city = clean(p.city, 60), name = clean(p.name, 80);
    const id = 'g' + sha('17oct|' + k.id + '|' + k.i).slice(0, 11);
    out.set(id, { id, type: k.type === 'manifestation' ? 'manif' : 'rassemblement', src: '17oct',
      title: clean(`${k.type === 'manifestation' ? 'Manifestation' : 'Rassemblement'}${city ? ' · ' + city : ''}`, 80),
      place: clean(p.kind === 'station' ? `Station-service, ${name}` : (name || city || 'Lieu annoncé'), 100),
      note: 'Annoncé sur la carte participative du 17 octobre.', start, lat: round(p.lat), lng: round(p.lng), route: null, end: false,
      by: '17octobregiletjaune.net', oid: 'import', link: IMPORT_BASE + '/carte/', status: 'ok', t: now });
  }
  const n = tx(() => {
    const hidden = new Set(q('SELECT id FROM hidden').all().map(x => x.id));
    for (const x of q("SELECT id FROM events WHERE src='17oct'").all()) if (!out.has(x.id)) dropEvent(x.id);
    let n = 0;
    for (const [id, e] of out) {
      if (hidden.has(id)) continue;
      const cur = getEvent(id);
      if (!cur || cur.start !== e.start || cur.place !== e.place || cur.lat !== e.lat || cur.lng !== e.lng || cur.title !== e.title) saveEvent(cur ? { ...e, t: cur.t } : e);
      n++;
    }
    return n;
  });
  console.log(`import 17 octobre : ${n} manifestation(s) et rassemblement(s)`);
}
// Un seul processus importe à la fois (Passenger peut en lancer plusieurs) : horodatage partagé dans DATA_DIR
function maybeImport17() {
  if (!IMPORT_17 || Date.now() > IMPORT_UNTIL) return;
  let last = 0; try { last = fs.statSync(IMPORT_STAMP).mtimeMs; } catch {}
  if (Date.now() - last < IMPORT_EVERY) return;
  try { fs.writeFileSync(IMPORT_STAMP, String(process.pid)); } catch { return; }
  import17().catch(e => console.error('import 17 octobre :', e.message));
}
setTimeout(maybeImport17, 3000);
setInterval(maybeImport17, 60_000).unref();

module.exports = {  };
