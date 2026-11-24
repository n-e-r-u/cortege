'use strict';
// Mode medic : la liste des équipes sur le disque (medics.json, même forme que orgas.json) et le réglage du rayon d'alerte.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const { withLock } = require('../util');
const { getMeta, setMeta } = require('../db');

// ---- Équipes (fichier medics.json, même forme que orgas.json) ----
const FILE = () => path.join(DATA_DIR, 'medics.json');
let cache = { mtime: -1, list: [] };
function readMedics() {
  try {
    const st = fs.statSync(FILE());
    if (st.mtimeMs !== cache.mtime) cache = { mtime: st.mtimeMs, list: JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
  } catch { cache = { mtime: -1, list: [] }; }
  return cache.list;
}
function writeMedics(list) {
  const tmp = FILE() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
  cache.mtime = -1;
}
// Modifie une équipe sous verrou ; fn reçoit l'équipe et renvoie la nouvelle (ou null pour ne rien changer)
function editTeam(id, fn) {
  return withLock(() => {
    const l = readMedics().slice(), i = l.findIndex(x => x.id === id);
    if (i < 0) return null;
    const n = fn(l[i]); if (!n) return null;
    l[i] = n; writeMedics(l); return n;
  });
}
const TEAM_MAX = 2000, REF_TEAMS = 40;
const cfg = () => { let c = {}; try { c = JSON.parse(getMeta('medic') || '{}'); } catch {} return { radiusKm: c.radiusKm >= 0.5 && c.radiusKm <= 30 ? c.radiusKm : 2 }; };
const saveCfg = b => { const r = Number(b.radiusKm); if (!(r >= 0.5 && r <= 30)) return null; const c = { radiusKm: Math.round(r * 10) / 10 }; setMeta('medic', JSON.stringify(c)); return c; };

module.exports = { FILE, cache, readMedics, writeMedics, editTeam, TEAM_MAX, REF_TEAMS, cfg, saveCfg };
