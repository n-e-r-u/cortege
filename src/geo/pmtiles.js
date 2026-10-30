'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../config');
const { send } = require('../http/respond');

// ---- Carte hébergée sur le serveur : fichier PMTiles (tuiles vectorielles) ----
// TILE_PMTILES=/chemin/france.pmtiles : la carte vient du serveur lui-même, plus aucune requête vers un fournisseur.
// Lecteur PMTiles v3 minimal (format ouvert de Protomaps) : en-tête, répertoires compressés, tuiles servies telles quelles.
const PMTILES = process.env.TILE_PMTILES || '';
// Zones couvertes par le fichier (rectangles [sud, nord, ouest, est]) : lues dans la région utilisée pour l'extraire
const PM_ZONES = (() => {
  try {
    const g = JSON.parse(fs.readFileSync(process.env.TILE_PMTILES_REGION || path.join(ROOT, 'tools', 'france.geojson'), 'utf8'));
    const geom = g.geometry || g;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return polys.map(p => { const xs = p[0].map(c => c[0]), ys = p[0].map(c => c[1]); return [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)]; });
  } catch { return []; }
})();
const pm = { fd: null, h: null, dirs: new Map() };
const zlib = require('zlib');
function pmDecomp(buf, c) { return c === 2 ? zlib.gunzipSync(buf) : c === 3 ? zlib.brotliDecompressSync(buf) : buf; }
function pmRead(off, len) {
  return new Promise((ok, ko) => { const b = Buffer.alloc(len); fs.read(pm.fd, b, 0, len, off, (e, n) => e ? ko(e) : ok(b.subarray(0, n))); });
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
async function pmOpen() {
  if (pm.h || !PMTILES) return pm.h;
  pm.fd = fs.openSync(PMTILES, 'r');
  const b = await pmRead(0, 127);
  if (b.toString('latin1', 0, 7) !== 'PMTiles' || b[7] !== 3) throw new Error('fichier PMTiles v3 attendu');
  const u = o => Number(b.readBigUInt64LE(o)), i32 = o => b.readInt32LE(o) / 1e7;
  pm.h = { rootOff: u(8), rootLen: u(16), leafOff: u(40), dataOff: u(56), dirC: b[97], tileC: b[98], type: b[99], minz: b[100], maxz: b[101],
    bounds: [i32(102), i32(106), i32(110), i32(114)] };
  return pm.h;
}
async function pmGetDir(off, len) {
  const k = off + ':' + len;
  if (pm.dirs.has(k)) return pm.dirs.get(k);
  const d = pmDir(pmDecomp(await pmRead(off, len), pm.h.dirC));
  if (pm.dirs.size > 400) pm.dirs.delete(pm.dirs.keys().next().value);
  pm.dirs.set(k, d);
  return d;
}
async function pmTile(z, x, y) {
  const h = await pmOpen();
  if (z < h.minz || z > h.maxz || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return null;
  const id = zxyToTileId(z, x, y);
  let off = h.rootOff, len = h.rootLen;
  for (let depth = 0; depth < 4; depth++) {
    const dir = await pmGetDir(off, len);
    let lo = 0, hi = dir.length - 1, f = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dir[m].id <= id) { f = dir[m]; lo = m + 1; } else hi = m - 1; }
    if (!f) return null;
    if (f.run === 0) { off = h.leafOff + f.off; len = f.len; continue; }
    if (id - f.id >= f.run) return null;
    return pmRead(h.dataOff + f.off, f.len);
  }
  return null;
}
const pmInfo = () => pm.h ? { url: '/vt/{z}/{x}/{y}.mvt', minzoom: pm.h.minz, maxzoom: pm.h.maxz, bounds: pm.h.bounds, zones: PM_ZONES } : null;
if (PMTILES) pmOpen().then(h => console.log(`Carte PMTiles : zoom ${h.minz}-${h.maxz}`)).catch(e => console.error('PMTiles', e.message));
async function serveVectorTile(req, res, z, x, y) {
  let data;
  try { data = await pmTile(z, x, y); } catch (e) { return send(res, 500, { error: 'Carte indisponible.' }); }
  if (!data || !data.length) { res.writeHead(204, { 'Cache-Control': 'public, max-age=86400' }); return res.end(); }
  const headers = { 'Content-Type': 'application/vnd.mapbox-vector-tile', 'Cache-Control': 'public, max-age=604800' };
  if (pm.h.tileC === 2) {
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) headers['Content-Encoding'] = 'gzip';
    else data = zlib.gunzipSync(data);
  }
  res.writeHead(200, headers); res.end(data);
}

module.exports = { PMTILES, PM_ZONES, pmDecomp, pmOpen, pmTile, pmInfo, serveVectorTile };
