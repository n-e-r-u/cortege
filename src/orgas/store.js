'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

// Orgas créées depuis la page admin : seule l'empreinte (hash) de leur clé est stockée.
const ORGA_FILE = () => path.join(DATA_DIR, 'orgas.json');
const INVITE_MS = 24 * 60 * 60_000; // durée de validité d'une invitation d'orga
let orgaCache = { mtime: -1, list: [] };
function readOrgas() {
  try {
    const st = fs.statSync(ORGA_FILE());
    if (st.mtimeMs !== orgaCache.mtime) orgaCache = { mtime: st.mtimeMs, list: JSON.parse(fs.readFileSync(ORGA_FILE(), 'utf8')) };
  } catch { orgaCache = { mtime: -1, list: [] }; }
  return orgaCache.list;
}
// Point de branchement : prévenu quand l'accès d'une orga est coupé (orga supprimée, nouvelle invitation, accès repris
// avec le code de secours). Sert à oublier ce qui était lié à l'ancien accès (rappels : voir orgas/board.js).
let cutHook = null;
const onAccessCut = fn => { cutHook = fn; };
function writeOrgas(list) {
  if (cutHook) {
    const next = new Map(list.map(o => [o.id, o.hash || null]));
    for (const o of readOrgas()) if (o.hash && next.get(o.id) !== o.hash) { try { cutHook(o.id); } catch (e) { console.error('accès coupé', e.message); } }
  }
  const tmp = ORGA_FILE() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, ORGA_FILE());
  orgaCache.mtime = -1;
}

module.exports = { ORGA_FILE, INVITE_MS, readOrgas, writeOrgas, onAccessCut };
