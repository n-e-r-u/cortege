'use strict';
// Fil séparé : lit les lieux dans la carte PMTiles sans bloquer le serveur, et renvoie les lieux utiles par paquets.
const { parentPort, workerData } = require('worker_threads');
const { pois, countTiles } = require('./pmtiles-pois.js');

// Type Protomaps (+ nom) → type de lieu de Cortège
function kindOf(p) {
  const k = String(p.kind ?? p['pmap:kind'] ?? ''), name = String(p.name || '');
  if (/r[ée]tention administrative/i.test(name)) return 'cra';
  if (/^(h[ôo]tel de (la )?)?sous[- ]pr[ée]fecture\b/i.test(name)) return 'spref';
  if (/^(h[ôo]tel de (la )?)?pr[ée]fecture\b/i.test(name)) return 'pref'; // y compris la préfecture de police
  if (k === 'townhall') return /salle|maison des associations/i.test(name) ? null : 'mairie';
  if (k === 'police') return /gendarmerie/i.test(name) ? 'gend' : 'police';
  if (k === 'courthouse') return 'tribunal';
  if (k === 'hospital') return 'hopital';
  // Lycées et facs : la carte ne dit pas le niveau d'une école, seulement son nom
  if (k === 'university') return /^(r[ée]sidence|restaurant|cit[ée] u|crous)/i.test(name) ? null : /\blyc[ée]es?\b/i.test(name) ? 'lycee' : 'fac';
  if (k === 'school' || k === 'college') return /\blyc[ée]es?\b|\bgymnasium\b|\bhigh school\b/i.test(name) && !/^(coll[èe]ge|[ée]cole)\b/i.test(name) ? 'lycee' : null;
  if (k === 'pharmacy') return 'pharma';
  if (k === 'drinking_water') return 'eau';
  if (k === 'defibrillator') return 'dae'; // rarement présent dans les tuiles : les défibrillateurs viennent surtout d'OpenStreetMap
  return null;
}

const { file, zones } = workerData;
const inZones = (lat, lng) => !zones.length || zones.some(([s, n, w, e]) => lat >= s && lat <= n && lng >= w && lng <= e);
const total = countTiles(file);
parentPort.postMessage({ type: 'start', total });
let batch = [];
for (const p of pois(file, { onProgress: done => parentPort.postMessage({ type: 'progress', done, total }) })) {
  const kind = kindOf(p.props);
  if (!kind || !inZones(p.lat, p.lng)) continue;
  batch.push({ kind, lat: p.lat, lng: p.lng, name: String(p.props['name:fr'] || p.props.name || '').slice(0, 80) });
  if (batch.length >= 2000) { parentPort.postMessage({ type: 'batch', rows: batch }); batch = []; }
}
parentPort.postMessage({ type: 'batch', rows: batch });
parentPort.postMessage({ type: 'done' });
