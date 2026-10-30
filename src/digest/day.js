'use strict';
const fs = require('fs');
const path = require('path');
const { ARCHIVE_DIR, archLine } = require('./archive');
const { CAT, BASE_TTL } = require('../categories');
const { MIN } = require('../config');
const { activeReports } = require('../reports/store');
const { inFrance, whereOf } = require('../geo/communes');
const { parisDay } = require('../time');

// ---- Lignes d'une journée (digest et pages publiques) ----
const readArchiveDay = d => { try { return fs.readFileSync(path.join(ARCHIVE_DIR, d + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
// Un point restauré puis expiré apparaît deux fois : on garde sa dernière ligne
const dedupeRows = list => { const m = new Map(); list.forEach((r, i) => m.set(r.k || 'old' + i, r)); return [...m.values()]; };
function dayRows(date) {
  // Lignes sans heure de fin (anciens formats, imports) : fin = début + durée normale du type
  const rows = dedupeRows(readArchiveDay(date)).map(r => ({ ...r, o: r.o || (r.d ? 'old' : 'exp'), e: r.e || r.t + ((CAT[r.c] && BASE_TTL[r.c]) || 20) * MIN }));
  for (const r of activeReports(Date.now(), 5000)) if (parisDay(r.t) === date) rows.push({ ...archLine(r, 'active'), e: null });
  // Les bilans ne comptent que la France (métropole et outre-mer) : les points envoyés d'ailleurs restent sur la carte en direct,
  // mais ne faussent ni les totaux ni les cartes. On garde seulement leur nombre.
  const fr = [], abroad = [];
  for (const r of rows) (inFrance(r.lat, r.lng) ? fr : abroad).push(r);
  // Villes : chaque point est rattaché à sa commune (contours OSM) ou, à défaut, à sa ville ou à son agglomération
  const zones = {}, names = {};
  for (const r of fr) {
    const w = whereOf(r.lat, r.lng);
    r.z = w.id; const z = (zones[w.id] ||= { name: w.name, lat: 0, lng: 0, n: 0 }); z.n++; z.lat += r.lat; z.lng += r.lng;
  }
  for (const [id, z] of Object.entries(zones)) { z.lat = Math.round(z.lat / z.n * 1000) / 1000; z.lng = Math.round(z.lng / z.n * 1000) / 1000; (names[z.name] ||= []).push(id); }
  // Deux communes du même nom (Saint-Denis…) : on ajoute le département
  for (const ids of Object.values(names)) if (ids.length > 1) for (const id of ids) if (/^\d[\dAB]\d{3}$/.test(id)) zones[id].name += ` (${id.startsWith('97') ? id.slice(0, 3) : id.slice(0, 2)})`;
  return { rows: fr, zones, abroad: abroad.length };
}
// Nombre de signalements en France d'un jour archivé (comparaison sur 14 jours)
const dayCountFr = d => dedupeRows(readArchiveDay(d)).filter(r => inFrance(r.lat, r.lng)).length;

module.exports = { dayRows, dayCountFr };
