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
function writeOrgas(list) {
  const tmp = ORGA_FILE() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, ORGA_FILE());
  orgaCache.mtime = -1;
}

module.exports = { ORGA_FILE, INVITE_MS, readOrgas, writeOrgas };
