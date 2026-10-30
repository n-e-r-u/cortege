'use strict';
// Départements et contours officiels (geo.api.gouv.fr), simplification des polygones.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../config');

const DEPS = (() => {
  let list = []; try { list = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo', 'departements.json'), 'utf8')); } catch (e) { console.error('départements', e.message); }
  for (const [c, n] of [['971', 'Guadeloupe'], ['972', 'Martinique'], ['973', 'Guyane'], ['974', 'La Réunion'], ['976', 'Mayotte']]) if (!list.some(d => d.c === c)) list.push({ c, n, b: null, p: null });
  return list;
})();
const depOf = c => DEPS.find(d => d.c === String(c || '').toUpperCase().padStart(2, '0'));
const GEO_API = process.env.GEO_API || 'https://geo.api.gouv.fr';
const normName = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Simplification d'un contour (Douglas-Peucker), pour garder des fichiers légers
function simplifyRing(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]; const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function geoPoly(g, tol = 0.0004) {
  const polys = g && g.type === 'Polygon' ? [g.coordinates] : g && g.type === 'MultiPolygon' ? g.coordinates : [];
  const r = v => Math.round(v * 1e4) / 1e4;
  const p = polys.map(poly => poly.map(ring => simplifyRing(ring, tol).map(([x, y]) => [r(x), r(y)])).filter(ring => ring.length >= 4)).filter(x => x.length);
  if (!p.length) return null;
  const all = p.flat(2), lat = all.map(x => x[1]), lng = all.map(x => x[0]);
  return { p, b: [Math.min(...lat), Math.min(...lng), Math.max(...lat), Math.max(...lng)] };
}
// Contour officiel d'une commune (API Géo de l'État, appelée par le serveur seulement, à la validation)

module.exports = { DEPS, depOf, GEO_API, normName, geoPoly };
