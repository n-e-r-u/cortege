'use strict';
const { DEPS } = require('./departments');
const { PLACES, placeOf } = require('./cities');
const { q } = require('../db');

// ---- Communes : contours OpenStreetMap (limites administratives de niveau 8), extraits pendant l'import mensuel ----
let COMM = null;
const commPolys = new Map(), commCache = new Map();
function commIndex() {
  if (COMM) return COMM;
  const rows = q('SELECT id, insee, name, minlat, minlng, maxlat, maxlng FROM communes').all();
  const b = new Float64Array(rows.length * 4);
  rows.forEach((r, i) => { b[i * 4] = r.minlat; b[i * 4 + 1] = r.minlng; b[i * 4 + 2] = r.maxlat; b[i * 4 + 3] = r.maxlng; });
  return (COMM = { rows, b });
}
const commReset = () => { COMM = null; commPolys.clear(); commCache.clear(); frCache.clear(); };
// Point dans un contour (coordonnées [lng, lat]), puis dans une surface avec ses trous
function ringHas(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyHas = (p, lat, lng) => p.some(poly => ringHas(poly[0], lng, lat) && !poly.slice(1).some(h => ringHas(h, lng, lat)));
function communeOf(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (commCache.has(key)) return commCache.get(key);
  const { rows, b } = commIndex();
  let hit = null;
  for (let i = 0; i < rows.length && !hit; i++) {
    if (lat < b[i * 4] || lat > b[i * 4 + 2] || lng < b[i * 4 + 1] || lng > b[i * 4 + 3]) continue;
    const r = rows[i];
    let p = commPolys.get(r.id);
    if (!p) {
      const x = q('SELECT data FROM communes WHERE id=?').get(r.id);
      p = x ? JSON.parse(x.data) : [];
      if (commPolys.size > 500) commPolys.delete(commPolys.keys().next().value);
      commPolys.set(r.id, p);
    }
    if (polyHas(p, lat, lng)) hit = { id: r.insee || r.id, name: r.name, fr: !!r.insee };
  }
  if (commCache.size > 50000) commCache.clear();
  commCache.set(key, hit);
  return hit;
}
// En France ou non : départements (contours IGN), outre-mer (boîtes), commune française connue, ou ville française à moins de 6 km
const FR_CC = new Set(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT', 'PM', 'BL', 'MF', 'NC', 'PF', 'WF']);
const OUTRE_MER = [[15.8, -61.9, 16.55, -60.95], [14.35, -61.25, 14.9, -60.8], [2.1, -54.65, 5.8, -51.6], [-21.4, 55.2, -20.85, 55.85], [-13.05, 44.95, -12.6, 45.35],
  [46.7, -56.45, 47.15, -56.1], [17.85, -63.17, 18.13, -62.78], [-22.8, 163.5, -19.5, 168.2], [-28, -155, -7, -134], [-14.4, -178.3, -13.1, -176]];
const frCache = new Map();
function inFrance(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  let v = frCache.get(key);
  if (v !== undefined) return v;
  v = OUTRE_MER.some(([a, b, c, d]) => lat >= a && lat <= c && lng >= b && lng <= d)
    || DEPS.some(d => d.p && d.b && lat >= d.b[0] - 0.01 && lat <= d.b[2] + 0.01 && lng >= d.b[1] - 0.01 && lng <= d.b[3] + 0.01 && polyHas(d.p, lat, lng));
  if (!v) { const c = communeOf(lat, lng); if (c && c.fr) v = true; }
  if (!v) {
    const k = Math.cos(lat * Math.PI / 180); let best = Infinity, cc = null;
    for (const [, la, lo, , c] of PLACES) {
      const dy = (la - lat) * 111; if (dy > 6 || dy < -6) continue;
      const dd = Math.hypot(dy, (lo - lng) * 111 * k); if (dd < best) { best = dd; cc = c; }
    }
    v = best <= 6 && FR_CC.has(cc);
  }
  if (frCache.size > 50000) frCache.clear();
  frCache.set(key, v);
  return v;
}
// Nom de lieu d'un point : sa commune si les contours sont importés, sinon la ville ou l'agglomération la plus proche
function whereOf(lat, lng) {
  const c = communeOf(lat, lng);
  return c ? { id: c.id, name: c.name } : { id: placeOf(lat, lng), name: placeOf(lat, lng) };
}

module.exports = { commIndex, commReset, polyHas, inFrance, whereOf };
