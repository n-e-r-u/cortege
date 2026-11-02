'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ROOT } = require('../config');
const { getMeta } = require('../db');
const { send } = require('../http/respond');

// ---- Carte hébergée sur le serveur : fichiers PMTiles (tuiles vectorielles) ----
// TILE_PMTILES=/chemin/france.pmtiles,/chemin/allemagne.pmtiles,/chemin/monde.pmtiles : la carte vient du serveur lui-même,
// plus aucune requête vers un fournisseur. Lecteur PMTiles v3 minimal (format ouvert de Protomaps) : en-tête, répertoires
// compressés, tuiles servies telles quelles.
// - Un fichier par pays ou région, au zoom de la rue (« fichiers régionaux ») ;
// - éventuellement une carte du monde légère (zooms éloignés seulement) : reconnue à son étendue (le monde entier),
//   elle sert tous les zooms qu'elle contient, pour ne jamais montrer d'écran vide en dézoomant.
// Fichiers donnés par TILE_PMTILES, plus les cartes téléchargées depuis l'admin (méta « maps », dossier MAP_DIR) :
// une carte téléchargée remplace le fichier de même nom de TILE_PMTILES. La carte du monde passe toujours en dernier.
const ENV_FILES = String(process.env.TILE_PMTILES || '').split(',').map(s => s.trim()).filter(Boolean);
const downloadedMaps = () => { try { return JSON.parse(getMeta('maps') || '[]').filter(m => m && m.file && fs.existsSync(m.file)); } catch { return []; } };
function effectiveFiles() {
  const dl = downloadedMaps(), used = new Set();
  const out = ENV_FILES.map(f => { const d = dl.find(x => path.basename(x.file) === path.basename(f)); if (d) used.add(d.file); return d ? d.file : f; });
  for (const d of dl) if (!used.has(d.file) && !d.world) out.push(d.file);
  for (const d of dl) if (!used.has(d.file) && d.world) out.push(d.file);
  return [...new Set(out)];
}
let FILES = [], pmFiles = [];
// Fichier régional principal (le premier) : lieux permanents, tracé du cortège par les rues
const pmPrimary = () => FILES[0] || '';
const pmFileList = () => FILES.slice();
// Zones couvertes par un fichier (rectangles [sud, nord, ouest, est]) : lues dans la région utilisée pour l'extraire,
// à côté du fichier (même nom en .geojson), sinon TILE_PMTILES_REGION ou tools/france.geojson pour le premier fichier
function regionZones(f, i) {
  const side = f.file.replace(/\.pmtiles$/i, '.geojson');
  const src = fs.existsSync(side) ? side : i === 0 ? (process.env.TILE_PMTILES_REGION || path.join(ROOT, 'tools', 'france.geojson')) : null;
  if (!src) return null;
  try {
    const g = JSON.parse(fs.readFileSync(src, 'utf8'));
    const geom = g.geometry || (g.features && g.features[0] && g.features[0].geometry) || g;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return polys.map(p => { const xs = p[0].map(c => c[0]), ys = p[0].map(c => c[1]); return [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)]; });
  } catch { return null; }
}
const isWorld = h => h.bounds[0] <= -170 && h.bounds[2] >= 170 && h.bounds[1] <= -55 && h.bounds[3] >= 70;

function pmDecomp(buf, c) { return c === 2 ? zlib.gunzipSync(buf) : c === 3 ? zlib.brotliDecompressSync(buf) : buf; }
function pmRead(f, off, len) {
  return new Promise((ok, ko) => { const b = Buffer.alloc(len); fs.read(f.fd, b, 0, len, off, (e, n) => e ? ko(e) : ok(b.subarray(0, n))); });
}
function zxyToTileId(z, x, y) {
  let acc = (4 ** z - 1) / 3, a = 2 ** (z - 1);
  for (let s = a; s >= 1; s /= 2) {
    const rx = (x & s) ? 1 : 0, ry = (y & s) ? 1 : 0;
    acc += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return acc;
}
function pmDir(buf) {
  let pos = 0;
  const v = () => { let r = 0, m = 1, b; do { b = buf[pos++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; };
  const n = v(), e = Array.from({ length: n }, () => ({}));
  let last = 0;
  for (const x of e) { last += v(); x.id = last; }
  for (const x of e) x.run = v();
  for (const x of e) x.len = v();
  e.forEach((x, i) => { const o = v(); x.off = o === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : o - 1; });
  return e;
}
function openFile(f, i) {
  if (f.h) return Promise.resolve(f.h);
  return f.opening || (f.opening = (async () => {
    f.fd = fs.openSync(f.file, 'r');
    const b = await pmRead(f, 0, 127);
    if (b.toString('latin1', 0, 7) !== 'PMTiles' || b[7] !== 3) throw new Error(path.basename(f.file) + ' : fichier PMTiles v3 attendu');
    const u = o => Number(b.readBigUInt64LE(o)), i32 = o => b.readInt32LE(o) / 1e7;
    f.h = { rootOff: u(8), rootLen: u(16), leafOff: u(40), dataOff: u(56), dirC: b[97], tileC: b[98], type: b[99], minz: b[100], maxz: b[101],
      bounds: [i32(102), i32(106), i32(110), i32(114)] }; // ouest, sud, est, nord
    f.world = isWorld(f.h);
    const [w, s, e, n] = f.h.bounds;
    f.zones = f.world ? [] : (regionZones(f, i) || [[s, n, w, e]]);
    return f.h;
  })());
}
// Ouvre tous les fichiers ; renvoie l'en-tête du fichier régional principal (ou du premier fichier)
async function pmOpen() {
  if (!pmFiles.length) return null;
  // Un fichier illisible (absent, abîmé) est mis de côté : les autres cartes restent servies
  const list = pmFiles;
  await Promise.all(list.map((f, i) => openFile(f, i).catch(e => { if (!f.err) console.error('PMTiles', e.message); f.err = e.message; })));
  const ok = list.filter(f => f.h);
  if (!ok.length) throw new Error('aucune carte lisible');
  return (ok.find(f => !f.world) || ok[0]).h;
}
async function pmGetDir(f, off, len) {
  const k = off + ':' + len;
  if (f.dirs.has(k)) return f.dirs.get(k);
  const d = pmDir(pmDecomp(await pmRead(f, off, len), f.h.dirC));
  if (f.dirs.size > 400) f.dirs.delete(f.dirs.keys().next().value);
  f.dirs.set(k, d);
  return d;
}
async function fileTile(f, z, x, y) {
  const h = f.h;
  if (z < h.minz || z > h.maxz) return null;
  const id = zxyToTileId(z, x, y);
  let off = h.rootOff, len = h.rootLen;
  for (let depth = 0; depth < 4; depth++) {
    const dir = await pmGetDir(f, off, len);
    let lo = 0, hi = dir.length - 1, e = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dir[m].id <= id) { e = dir[m]; lo = m + 1; } else hi = m - 1; }
    if (!e) return null;
    if (e.run === 0) { off = h.leafOff + e.off; len = e.len; continue; }
    if (id - e.id >= e.run) return null;
    return pmRead(f, h.dataOff + e.off, e.len);
  }
  return null;
}
const tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
// Tuile (z, x, y) et sa compression : la carte du monde pour les zooms qu'elle contient, sinon le premier fichier régional
// dont l'étendue touche la tuile et qui l'a
async function pmTileC(z, x, y) {
  if (x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return null;
  await pmOpen();
  const world = pmFiles.find(f => f.h && f.world);
  if (world && z >= world.h.minz && z <= world.h.maxz) {
    const data = await fileTile(world, z, x, y);
    return data ? { data, c: world.h.tileC } : null;
  }
  const w = x / 2 ** z * 360 - 180, e = (x + 1) / 2 ** z * 360 - 180, n = tile2lat(y, z), s = tile2lat(y + 1, z);
  for (const f of pmFiles) {
    if (!f.h || f.world) continue;
    const [bw, bs, be, bn] = f.h.bounds;
    if (e < bw || w > be || n < bs || s > bn) continue;
    const data = await fileTile(f, z, x, y);
    if (data && data.length) return { data, c: f.h.tileC };
  }
  return null;
}
const pmTile = async (z, x, y) => { const t = await pmTileC(z, x, y); return t ? t.data : null; };
// Pour le téléphone : adresse des tuiles, zooms, et zones régionales (hors de ces zones, au zoom de la rue, repli sur OpenStreetMap ;
// worldMaxZoom : jusqu'à ce zoom, la carte du monde suffit et le repli est inutile)
function pmInfo() {
  const open = pmFiles.filter(f => f.h);
  if (!open.length) return null;
  const regional = open.filter(f => !f.world), world = open.find(f => f.world);
  const all = regional.length ? regional : open;
  const bounds = all.reduce((b, f) => [Math.min(b[0], f.h.bounds[0]), Math.min(b[1], f.h.bounds[1]), Math.max(b[2], f.h.bounds[2]), Math.max(b[3], f.h.bounds[3])], [180, 90, -180, -90]);
  return { url: '/vt/{z}/{x}/{y}.mvt', minzoom: Math.min(...open.map(f => f.h.minz)), maxzoom: Math.max(...all.map(f => f.h.maxz)), bounds,
    zones: regional.flatMap(f => f.zones), ...(world ? { worldMaxZoom: world.h.maxz } : {}) };
}
// Pour l'admin : chaque fichier de carte, sa taille et ce qu'il couvre
const pmFilesInfo = () => pmFiles.map(f => { let bytes = null; try { bytes = fs.statSync(f.file).size; } catch {}
  return { name: path.basename(f.file), file: f.file, err: f.err || null, bytes, world: !!f.world, open: !!f.h, minz: f.h ? f.h.minz : null, maxz: f.h ? f.h.maxz : null, zones: f.zones }; });
// Recharge la liste des cartes (après un téléchargement depuis l'admin) sans redémarrer. Les anciens descripteurs
// restent ouverts une minute : une tuile en cours de lecture se termine normalement.
function pmReload() {
  const old = pmFiles;
  FILES = effectiveFiles();
  pmFiles = FILES.map(file => ({ file, fd: null, h: null, dirs: new Map(), opening: null, zones: [] }));
  setTimeout(() => { for (const f of old) if (f.fd != null) try { fs.closeSync(f.fd); } catch {} }, 60_000).unref();
  if (!pmFiles.length) return Promise.resolve();
  return pmOpen().then(() => {
    for (const f of pmFiles) console.log(`Carte PMTiles ${path.basename(f.file)} : zoom ${f.h.minz}-${f.h.maxz}${f.world ? ' (monde)' : ''}`);
  }).catch(e => console.error('PMTiles', e.message));
}
pmReload();
async function serveVectorTile(req, res, z, x, y) {
  let t;
  try { t = await pmTileC(z, x, y); } catch (e) { return send(res, 500, { error: 'Carte indisponible.' }); }
  if (!t || !t.data.length) { res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' }); return res.end(); }
  let data = t.data;
  const headers = { 'Content-Type': 'application/vnd.mapbox-vector-tile', 'Cache-Control': 'public, max-age=604800' };
  if (t.c === 2) {
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) headers['Content-Encoding'] = 'gzip';
    else data = zlib.gunzipSync(data);
  } else if (t.c === 3) data = zlib.brotliDecompressSync(data);
  res.writeHead(200, headers); res.end(data);
}

module.exports = { pmPrimary, pmFileList, pmReload, ENV_FILES, pmFilesInfo, pmDecomp, pmOpen, pmTile, pmTileC, pmInfo, serveVectorTile };
