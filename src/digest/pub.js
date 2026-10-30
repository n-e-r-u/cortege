'use strict';
const { CAT } = require('../categories');
const { MIN } = require('../config');
const { commIndex } = require('../geo/communes');
const { dayRows } = require('./day');
const { distM } = require('../util');
const { ordersAll, srcHost } = require('../orders');
const { parisHour } = require('./archive');
const { parisMs } = require('../events/import-17oct');
const { q } = require('../db');

// ---- Pages publiques par manif (/manif/AAAA-MM-JJ) ----
// Bilans figés par la 2.6.0 avec le code INSEE à la place du nom de la commune : nom retrouvé à la lecture
const INSEE_RE = /^\d[\dAB]\d{3}$/;
const fixPubNames = d => { if (d && Array.isArray(d.cities)) for (const c of d.cities) if (INSEE_RE.test(c.name)) { const x = q('SELECT name FROM communes WHERE insee=?').get(c.name); if (x) c.name = x.name; } return d; };
const getPub = date => { const x = q('SELECT data FROM pub WHERE date=?').get(date); return x ? fixPubNames(JSON.parse(x.data)) : null; };
const REMOVED_O = new Set(['cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old']);
function pubSnapshot(date) {
  const { rows: all, abroad, zones } = dayRows(date);
  const rows = all.filter(r => CAT[r.c]);
  if (!rows.length) return null;
  const cats = {}, fam = {}, hours = Array(24).fill(0), cities = {};
  for (const r of rows) {
    cats[r.c] = (cats[r.c] || 0) + 1; const g = CAT[r.c].group; fam[g] = (fam[g] || 0) + 1; hours[parisHour(r.t) % 24]++;
    const c = (cities[r.z] ||= { name: zones[r.z] ? zones[r.z].name : r.z, n: 0, lat: 0, lng: 0 }); c.n++; c.lat += r.lat; c.lng += r.lng;
  }
  const ts = rows.map(r => r.t);
  return { date, total: rows.length, fam, hours,
    cats: Object.entries(cats).map(([id, n]) => ({ id, label: CAT[id].label, glyph: CAT[id].glyph, group: CAT[id].group, n })).sort((a, b) => b.n - a.n),
    cities: Object.values(cities).map(c => ({ name: c.name, n: c.n, lat: Math.round(c.lat / c.n * 100) / 100, lng: Math.round(c.lng / c.n * 100) / 100 })).sort((a, b) => b.n - a.n),
    first: Math.min(...ts), last: Math.max(...ts), confirmed: rows.filter(r => r.up > 0).length, confs: rows.reduce((t, r) => t + (r.up || 0), 0),
    verified: rows.filter(r => r.v).length, removed: rows.filter(r => REMOVED_O.has(r.o)).length, abroad, communes: commIndex().rows.length > 0, pts: pubPts(rows), ptsV: PTS_V, ptsS: PTS_SCALE,
    ...pubExtras(date, rows, zones) };
}
// ---- Bilans détaillés (2.8) : moments clés, durées, parcours des cortèges, arrêtés du jour, pages par ville ----
const EXT_V = 1, CITY_PAGE_MIN = 20;
// Dangers dont on suit le premier signalement et la durée, ville par ville
const KEY_DANGERS = ['charge', 'tirs', 'nasse', 'lacrymo', 'canon', 'sommations', 'facho', 'interpellation', 'inter', 'blinde', 'bac', 'crs'];
const slugOf = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
// Total en minutes d'intervalles qui se chevauchent
function unionMin(iv) {
  let tot = 0, cs = null, ce = null;
  for (const [a, b] of iv.sort((x, y) => x[0] - y[0])) { if (cs === null || a > ce) { if (cs !== null) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  if (cs !== null) tot += ce - cs;
  return Math.round(tot / MIN);
}
// Parcours réel du cortège d'une ville, d'après le chemin de sa tête : longueur, heures, vitesse moyenne
function marchOf(heads) {
  const pts = [];
  for (const r of heads) { for (const p of r.tr || []) pts.push([p[0], p[1], p[2] * MIN]); pts.push([r.lat, r.lng, r.e || r.t]); }
  pts.sort((a, b) => a[2] - b[2]);
  let len = 0, from = null, to = null; const path = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q2 = path[path.length - 1];
    if (q2) { const d = distM({ lat: q2[0], lng: q2[1] }, { lat: p[0], lng: p[1] }); if (d < 5) continue; if (p[2] - q2[2] <= 20 * MIN && d <= 1500) { len += d; to = p[2]; } }
    if (from === null) from = to = p[2];
    path.push(p);
  }
  if (len < 100) return null;
  const h = (to - from) / 3600e3, step = Math.max(1, Math.ceil(path.length / 200));
  return { len: Math.round(len), from, to, kmh: h >= 1 / 6 ? Math.round(len / 1000 / h * 10) / 10 : null,
    path: path.filter((_, i) => i % step === 0 || i === path.length - 1).map(p => [p[0], p[1], Math.floor(p[2] / MIN)]) };
}
// Arrêtés en vigueur pendant la journée (même terminés depuis, ils sont gardés 8 jours)
function ordersOfDay(date) {
  const a = parisMs(date, '00:00'), b = a + 24 * 60 * MIN;
  return ordersAll().filter(o => o.status === 'ok' && o.zone && o.start < b && o.end > a).map(o => ({ name: o.zone.name, dep: o.zone.dep, scope: o.zone.scope, start: o.start, end: o.end,
    items: (o.items || []).map(x => ({ k: x.k, text: x.text })), src: o.src, host: srcHost(o.src) }));
}
function pubExtras(date, rows, zones) {
  const name = z => (zones[z] ? zones[z].name : z), byCity = new Map();
  for (const r of rows) { if (!byCity.has(r.z)) byCity.set(r.z, []); byCity.get(r.z).push(r); }
  // Moments clés : premier signalement de chaque danger, ville par ville
  const firsts = new Map();
  for (const r of rows.filter(r => KEY_DANGERS.includes(r.c)).sort((a, b) => a.t - b.t)) { const k = r.z + '|' + r.c; if (!firsts.has(k)) firsts.set(k, r); }
  const moments = [...firsts.values()].sort((a, b) => a.t - b.t).map(r => ({ t: r.t, c: r.c, city: name(r.z), up: r.up || 0, v: r.v ? 1 : 0, lat: r.lat, lng: r.lng }));
  const cityPages = [], durations = {}, marches = [];
  for (const [z, list] of byCity) {
    const dur = {};
    for (const c of KEY_DANGERS) { const iv = list.filter(r => r.c === c).map(r => [r.t, r.e || r.t + 10 * MIN]); if (iv.length) dur[c] = unionMin(iv); }
    const top = Object.entries(dur).filter(([, m]) => m >= 5).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (top.length) durations[name(z)] = top;
    const march = marchOf(list.filter(r => r.c === 'cortege'));
    if (march) marches.push({ city: name(z), len: march.len, from: march.from, to: march.to, kmh: march.kmh });
    if (list.length >= CITY_PAGE_MIN) {
      const cats = {}, hours = Array(24).fill(0);
      for (const r of list) { cats[r.c] = (cats[r.c] || 0) + 1; hours[parisHour(r.t) % 24]++; }
      const ts = list.map(r => r.t), lat = list.reduce((t, r) => t + r.lat, 0) / list.length, lng = list.reduce((t, r) => t + r.lng, 0) / list.length;
      cityPages.push({ slug: slugOf(name(z)), name: name(z), n: list.length, cats: Object.entries(cats).sort((a, b) => b[1] - a[1]), hours, first: Math.min(...ts), last: Math.max(...ts),
        lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, confirmed: list.filter(r => r.up > 0).length, verified: list.filter(r => r.v).length,
        moments: moments.filter(m => m.city === name(z)), durations: top, march });
    }
  }
  // Deux villes au même nom simplifié : le second reçoit un suffixe
  const seen = new Set(); for (const c of cityPages) { while (seen.has(c.slug)) c.slug += '-2'; seen.add(c.slug); }
  return { ext: EXT_V, moments: moments.slice(0, 60), durations, marches: marches.sort((a, b) => b.len - a.len), orders: ordersOfDay(date), cityPages };
}
// Bilans publiés avant la 2.8 : détails ajoutés à la première lecture, tant que l'archive du jour existe
function pubFull(date) {
  const d = pubWithPts(date);
  if (!d || d.ext === EXT_V) return d;
  const { rows: all, zones } = dayRows(date), rows = all.filter(r => CAT[r.c]);
  if (!rows.length) return d;
  Object.assign(d, pubExtras(date, rows, zones));
  q('UPDATE pub SET data=? WHERE date=?').run(JSON.stringify(d), date);
  return d;
}
// Points de la journée pour la carte d'un créneau (page publique) : position arrondie à ~11 m (dix-millième de degré), heures à la minute,
// nombre de confirmations, vérifié ou non, et ce qu'est devenu le point. Les points retirés ou contestés restent,
// avec la mention : un retrait (même par une orga, ou en masse par des votes) ne doit pas faire disparaître ce qui a été signalé.
const PUB_PTS_MAX = 30000, PTS_V = 4, PTS_SCALE = 1e4; // PTS_V : format des points (2 = heures de fin corrigées, 3 = devenir du point, 4 = précision ~11 m)
const PTS_O = ['', 'cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old'];
function pubPts(rows) {
  return rows.filter(r => CAT[r.c]).slice(0, PUB_PTS_MAX)
    .map(r => { const o = REMOVED_O.has(r.o) ? Math.max(1, PTS_O.indexOf(r.o)) : 0;
      return [r.c, Math.floor(r.t / MIN), Math.floor(Math.min(r.e || Date.now(), r.t + 24 * 60 * MIN) / MIN), Math.round(r.lat * PTS_SCALE), Math.round(r.lng * PTS_SCALE), r.up || 0, r.v ? 1 : 0, ...(o ? [o] : [])]; });
}
// Bilans publiés avant la 2.3.3 : points ajoutés à la première demande, tant que l'archive du jour existe
function pubWithPts(date) {
  const d = getPub(date);
  if (!d || (d.pts && d.ptsV === PTS_V)) return d;
  const { rows } = dayRows(date);
  if (!rows.length) return d;
  d.pts = pubPts(rows); d.ptsV = PTS_V; d.ptsS = PTS_SCALE;
  q('UPDATE pub SET data=? WHERE date=?').run(JSON.stringify(d), date);
  return d;
}

module.exports = { getPub, pubSnapshot, CITY_PAGE_MIN, slugOf, pubFull, pubWithPts };
