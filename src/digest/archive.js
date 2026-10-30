'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR, MIN, ARCHIVE_DAYS } = require('../config');
const { h8 } = require('../util');
const { TRAIL_CATS, parseTrail, parseNotes } = require('../reports/model');
const { parisDay } = require('../time');

// ---- Archive anonyme pour le digest ----
// Gardé : catégorie, heures de début et de fin à la minute, position arrondie à ~11 m, nombre de confirmations
// et de « Plus là », nombre de précisions (jamais leur texte), vérification, fiabilité, et ce qu'est devenu le point.
// Jamais gardé : la précision écrite, les empreintes d'IP ou de téléphone.
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
fs.mkdirSync(ARCHIVE_DIR, { recursive: true, mode: 0o700 });
// Tête et queue de cortège : leur chemin (positions à ~11 m, heures à la minute), pour le parcours réel du cortège dans les bilans
function archTrail(r) {
  if (!TRAIL_CATS.has(r.cat)) return {};
  const tr = parseTrail(r).map(p => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4, Math.floor(p[2] / MIN)]);
  return tr.length ? { tr } : {};
}
const archLine = (r, o) => {
  const notes = Array.isArray(r.notes) ? r.notes : parseNotes(r);
  return { k: h8('a|' + r.id), c: r.cat, t: Math.floor(r.t / MIN) * MIN, e: Math.floor(Math.min(Date.now(), r.exp) / MIN) * MIN,
    lat: Math.round(r.lat * 1e4) / 1e4, lng: Math.round(r.lng * 1e4) / 1e4, up: r.up || 0, dn: r.down || 0, n: notes.length,
    v: r.ver ? 1 : 0, f: r.fl || 0, o, d: o === 'exp' || o === 'active' ? 0 : 1, ...archTrail(r) };
};
function archive(r, outcome) {
  const line = JSON.stringify(archLine(r, outcome)) + '\n';
  try { fs.appendFileSync(path.join(ARCHIVE_DIR, parisDay(r.t) + '.jsonl'), line, { mode: 0o600 }); } catch {}
}
function pruneArchive() {
  const limit = Date.now() - ARCHIVE_DAYS * 24 * 60 * MIN;
  for (const f of fs.readdirSync(ARCHIVE_DIR)) {
    const t = Date.parse(f.slice(0, 10));
    if (t && t < limit) try { fs.unlinkSync(path.join(ARCHIVE_DIR, f)); } catch {}
  }
}
pruneArchive(); setInterval(pruneArchive, 6 * 60 * MIN).unref();

module.exports = { ARCHIVE_DIR, archTrail, archLine, archive, pruneArchive };
