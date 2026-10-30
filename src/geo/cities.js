'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../config');

// ---- Villes et agglomérations (digest) ----
// Liste des villes de plus de 5 000 habitant·es (France, outre-mer, pays voisins francophones), d'après GeoNames (CC BY 4.0).
// Un point est rattaché à la plus grande ville dont il est assez proche (rayon qui grandit avec la population :
// environ 14 km pour Paris, 10 km pour Montpellier), sinon à la ville la plus proche.
const PLACES = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'places.json'), 'utf8')); } catch { return []; } })();
const PLACE_POP = new Map();
for (const [n, , , p, c] of PLACES) PLACE_POP.set(n + '|' + c, (PLACE_POP.get(n + '|' + c) || 0) + p);
const placeCache = new Map();
function placeOf(lat, lng) {
  const key = lat.toFixed(2) + ',' + lng.toFixed(2);
  if (placeCache.has(key)) return placeCache.get(key);
  const k = Math.cos(lat * Math.PI / 180);
  let pole = null, near = null, nearD = Infinity;
  for (const [n, la, lo, , c] of PLACES) {
    const dy = (la - lat) * 111; if (dy > 30 || dy < -30) continue;
    const d = Math.hypot(dy, (lo - lng) * 111 * k); if (d > 30) continue;
    const pop = PLACE_POP.get(n + '|' + c);
    if (d < nearD) { nearD = d; near = n; }
    if (pop >= 20000 && d <= Math.min(20, 6 + 4 * Math.log10(pop / 20000)) && (!pole || pop > pole.pop)) pole = { n, pop };
  }
  const name = pole ? pole.n : near && nearD <= 15 ? near : `${lat.toFixed(1)}, ${lng.toFixed(1)}`;
  if (placeCache.size > 50000) placeCache.clear();
  placeCache.set(key, name);
  return name;
}

module.exports = { PLACES, placeOf };
