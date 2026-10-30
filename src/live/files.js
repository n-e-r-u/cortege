'use strict';
// ---- Publication en fichiers statiques ----
// Node écrit de petits fichiers JSON dans live/ ; sur cPanel, Apache les sert directement aux téléphones.
// Seuls les morceaux modifiés sont réécrits, au plus une fois par seconde (les changements sont regroupés).
//   live/g.json         → empreintes des annonces, de l'agenda et état de pause (presque toujours en 304)
//   live/r/<région>.json → empreinte de chaque case active d'une région de 1° (≈ 100 km)
//   live/c/<case>.json  → signalements d'une case de 0,05° (≈ 5 km)
//   live/all.json       → tous les signalements (vue nationale, réécrit au plus toutes les 10 s)
//   live/ann.json, live/events.json → annonces et agenda
//   live/index.json     → ancien format (toutes les cases), pour les téléphones qui n'ont pas rechargé l'appli
// Ce module garde ce qui est à republier (dirty) et le minuteur ; la publication elle-même (flush) est branchée par setFlusher.
const fs = require('fs');
const path = require('path');
const { ROOT, DATA_DIR } = require('../config');

const LIVE_DIR = process.env.LIVE_DIR || path.join(ROOT, 'live');
const CELL = 0.05;
const cellId = (lat, lng) => `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;
// Région = carré de 20 × 20 cases (1°) ; même calcul côté téléphone
const regionOfCell = c => { const [i, j] = c.split('_').map(Number); return `${Math.floor(i / 20)}_${Math.floor(j / 20)}`; };
fs.mkdirSync(path.join(LIVE_DIR, 'c'), { recursive: true });
fs.mkdirSync(path.join(LIVE_DIR, 'r'), { recursive: true });
fs.mkdirSync(path.join(LIVE_DIR, 'p'), { recursive: true }); // mode « réseau faible » : tous les points d'une région en un seul fichier
// En-têtes pour Apache (ignorés ailleurs) : revalidation courte, pas de listing.
try {
  fs.writeFileSync(path.join(LIVE_DIR, '.htaccess'), [
    'Options -Indexes',
    '<IfModule mod_headers.c>',
    '  Header set Cache-Control "public, max-age=2, must-revalidate"',
    '  Header set Access-Control-Allow-Origin "*"',
    '</IfModule>',
    '<IfModule mod_deflate.c>',
    '  AddOutputFilterByType DEFLATE application/json',
    '</IfModule>', ''].join('\n'));
} catch {}
function writeAtomic(file, str) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, str); fs.renameSync(tmp, file); }
function writeIfChanged(file, str) {
  try { if (fs.readFileSync(file, 'utf8') === str) return; } catch {}
  writeAtomic(file, str);
}
const FLUSH_MS = Number(process.env.FLUSH_MS) || 1000;
const ALL_EVERY = 10_000;
const LIVE_LOCK = path.join(DATA_DIR, 'live.lock');
const dirty = { cells: new Set(), ann: false, events: false, global: false, all: false, legal: false, ord: false };
// Minuteur de publication (partagé avec flush) : timer en cours, échéance, dernière vue nationale
const pub = { timer: null, due: 0, lastAll: 0 };
let flusher = () => {};
const setFlusher = fn => { flusher = fn; };
// Publication planifiée. Une demande plus urgente avance le minuteur : un nouveau signalement n'attend
// jamais les publications espacées (vue nationale toutes les 10 s, ancien index toutes les 5 s).
function scheduleFlush(ms = FLUSH_MS) {
  const due = Date.now() + ms;
  if (pub.timer && due >= pub.due) return;
  clearTimeout(pub.timer); pub.due = due; pub.timer = setTimeout(() => flusher(), ms);
}
function dirtyCell(c) { dirty.cells.add(c); dirty.all = true; scheduleFlush(); }

module.exports = { LIVE_DIR, CELL, cellId, regionOfCell, writeAtomic, writeIfChanged, FLUSH_MS, ALL_EVERY, LIVE_LOCK, dirty, pub, setFlusher, scheduleFlush, dirtyCell };
