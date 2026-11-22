'use strict';
// Régions françaises : rattachement d'un point à sa région (par son département) et compte des signalements actifs par région.
// Sert à l'activité publique agrégée (/api/activity) : jamais de position, jamais de signalement individuel, et aucune région en dessous d'un seuil.
const { DEPS } = require('./departments');
const { polyHas } = require('./communes');

const REGIONS = {
  ARA: ['Auvergne-Rhône-Alpes', '01 03 07 15 26 38 42 43 63 69 73 74'],
  BFC: ['Bourgogne-Franche-Comté', '21 25 39 58 70 71 89 90'],
  BRE: ['Bretagne', '22 29 35 56'],
  CVL: ['Centre-Val de Loire', '18 28 36 37 41 45'],
  COR: ['Corse', '2A 2B'],
  GES: ['Grand Est', '08 10 51 52 54 55 57 67 68 88'],
  HDF: ['Hauts-de-France', '02 59 60 62 80'],
  IDF: ['Île-de-France', '75 77 78 91 92 93 94 95'],
  NOR: ['Normandie', '14 27 50 61 76'],
  NAQ: ['Nouvelle-Aquitaine', '16 17 19 23 24 33 40 47 64 79 86 87'],
  OCC: ['Occitanie', '09 11 12 30 31 32 34 46 48 65 66 81 82'],
  PDL: ['Pays de la Loire', '44 49 53 72 85'],
  PAC: ["Provence-Alpes-Côte d'Azur", '04 05 06 13 83 84'],
};
const BY_DEP = new Map();
for (const [code, [, deps]] of Object.entries(REGIONS)) for (const d of deps.split(' ')) BY_DEP.set(d, code);
const regionName = code => (REGIONS[code] || [''])[0];
// Région d'un point (France métropolitaine et Corse), ou null ailleurs.
// Les contours des départements sont simplifiés : un point du littoral (un port, une plage) peut tomber juste dehors.
// Il est alors rattaché au département dont le contour passe à moins de 8 km.
function regionOf(lat, lng) {
  const near = [];
  for (const d of DEPS) {
    if (!d.p || !d.b || lat < d.b[0] - 0.08 || lat > d.b[2] + 0.08 || lng < d.b[1] - 0.11 || lng > d.b[3] + 0.11) continue;
    if (polyHas(d.p, lat, lng)) return BY_DEP.get(d.c) || null;
    near.push(d);
  }
  const k = Math.cos(lat * Math.PI / 180); let best = 8, code = null;
  for (const d of near) for (const poly of d.p) for (const [x, y] of poly[0]) {
    const km = Math.hypot((y - lat) * 111, (x - lng) * 111 * k);
    if (km < best) { best = km; code = BY_DEP.get(d.c) || null; }
  }
  return code;
}
// Compte par région. Une région qui a moins de `min` signalements actifs n'est pas listée : un petit nombre en dirait trop sur des signalements précis.
function regionCounts(rows, min = 5, where = regionOf) {
  const n = {};
  for (const r of rows) { const c = where(r.lat, r.lng); if (c) n[c] = (n[c] || 0) + 1; }
  return Object.entries(n).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).map(([code, active]) => ({ code, name: regionName(code), active }));
}

module.exports = { REGIONS, regionOf, regionName, regionCounts };
