'use strict';
// Lit les lieux (couche « pois ») directement dans un fichier PMTiles de Protomaps, sans aucun service extérieur.
// Utilisé par le serveur (import des lieux permanents, dans un fil séparé) et en ligne de commande pour inspecter un fichier :
//   node tools/pmtiles-pois.js /var/lib/cortege-map/france.pmtiles --stats 48.8,2.3,48.9,2.4
// Aucune dépendance : lecture du format PMTiles v3 et des tuiles vectorielles (protobuf) à la main.
const fs = require('fs');
const zlib = require('zlib');

// ---- PMTiles v3 ----
function readVarint(buf, pos) {
  let v = 0, shift = 0, b;
  do { b = buf[pos.i++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
  return v;
}
function decomp(buf, c) { return c === 2 ? zlib.gunzipSync(buf) : c === 3 ? zlib.brotliDecompressSync(buf) : c === 4 ? zlib.zstdDecompressSync?.(buf) ?? buf : buf; }
function parseDir(buf) {
  const pos = { i: 0 }, n = readVarint(buf, pos), e = Array.from({ length: n }, () => ({}));
  let id = 0; for (const x of e) { id += readVarint(buf, pos); x.id = id; }
  for (const x of e) x.run = readVarint(buf, pos);
  for (const x of e) x.len = readVarint(buf, pos);
  for (let i = 0; i < n; i++) { const v = readVarint(buf, pos); e[i].off = v === 0 && i > 0 ? e[i - 1].off + e[i - 1].len : v - 1; }
  return e;
}
function open(file) {
  const fd = fs.openSync(file, 'r'), h = Buffer.alloc(127);
  fs.readSync(fd, h, 0, 127, 0);
  if (h.toString('latin1', 0, 7) !== 'PMTiles' || h[7] !== 3) throw new Error('Pas un fichier PMTiles v3');
  const u64 = o => Number(h.readBigUInt64LE(o));
  return { fd, rootOff: u64(8), rootLen: u64(16), leafOff: u64(40), tileOff: u64(56), dirC: h[97], tileC: h[98], maxzoom: h[101] };
}
const read = (fd, off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
// Parcourt toutes les tuiles d'un niveau de zoom (répertoire racine puis répertoires-feuilles)
function* tilesAt(pm, z) {
  const lo = (4 ** z - 1) / 3, hi = lo + 4 ** z; // identifiants des tuiles du niveau z
  const walk = function* (off, len, leaf) {
    for (const e of parseDir(decomp(read(pm.fd, (leaf ? pm.leafOff : pm.rootOff) + off, len), pm.dirC))) {
      if (e.run === 0) { if (e.id < hi) yield* walk(e.off, e.len, true); continue; } // répertoire-feuille (on ne sait pas jusqu'où il va : on entre)
      for (let k = 0; k < e.run; k++) { const id = e.id + k; if (id >= lo && id < hi) yield { id, off: e.off, len: e.len }; }
    }
  };
  yield* walk(0, pm.rootLen, false);
}
// Identifiant → z/x/y (courbe de Hilbert, comme dans la spécification PMTiles)
function tileIdToZxy(id, z) {
  let pos = id - (4 ** z - 1) / 3, x = 0, y = 0;
  const n = 2 ** z;
  for (let s = 1; s < n; s *= 2) {
    const rx = Math.floor(pos / 2) & 1, ry = (pos ^ rx) & 1;
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
    x += s * rx; y += s * ry; pos = Math.floor(pos / 4);
  }
  return [z, x, y];
}

// ---- Tuile vectorielle (Mapbox Vector Tile, protobuf) : seulement ce qu'il faut pour des points ----
function pbf(buf) {
  let i = 0;
  const varint = () => { let v = 0, s = 0, b; do { b = buf[i++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  return {
    get pos() { return i; }, set pos(v) { i = v; }, end: buf.length, varint,
    field() { const k = varint(); return [Math.floor(k / 8), k & 7]; },
    bytes() { const l = varint(), b = buf.subarray(i, i + l); i += l; return b; },
    skip(t) { if (t === 0) varint(); else if (t === 1) i += 8; else if (t === 2) i += varint(); else if (t === 5) i += 4; else throw new Error('protobuf'); },
    double() { const v = buf.readDoubleLE(i); i += 8; return v; }, float() { const v = buf.readFloatLE(i); i += 4; return v; },
  };
}
function decodeValue(b) {
  const p = pbf(b); let v = null;
  while (p.pos < p.end) {
    const [f, t] = p.field();
    if (f === 1) v = p.bytes().toString('utf8'); else if (f === 2) v = p.float(); else if (f === 3) v = p.double();
    else if (f === 4 || f === 5) v = p.varint(); else if (f === 6) { const z = p.varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; } else if (f === 7) v = !!p.varint(); else p.skip(t);
  }
  return v;
}
const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
// Points d'une couche : [{ x, y (0..extent), extent, props }]
function layerPoints(tile, name) {
  const t = pbf(tile), out = [];
  while (t.pos < t.end) {
    const [f, wt] = t.field();
    if (f !== 3) { t.skip(wt); continue; }
    const lb = t.bytes(), l = pbf(lb);
    let lname = null, extent = 4096; const keys = [], vals = [], feats = [];
    while (l.pos < l.end) {
      const [lf, lt] = l.field();
      if (lf === 1) { lname = l.bytes().toString('utf8'); if (lname !== name) break; }
      else if (lf === 2) feats.push(l.bytes()); else if (lf === 3) keys.push(l.bytes().toString('utf8'));
      else if (lf === 4) vals.push(decodeValue(l.bytes())); else if (lf === 5) extent = l.varint(); else l.skip(lt);
    }
    if (lname !== name) continue;
    for (const fb of feats) {
      const p = pbf(fb); let tags = [], geom = [], type = 0;
      while (p.pos < p.end) {
        const [ff, ft] = p.field();
        if (ff === 2) { const b = p.bytes(), q = pbf(b); while (q.pos < q.end) tags.push(q.varint()); }
        else if (ff === 3) type = p.varint();
        else if (ff === 4) { const b = p.bytes(), q = pbf(b); while (q.pos < q.end) geom.push(q.varint()); }
        else p.skip(ft);
      }
      if (geom.length < 3 || (geom[0] & 7) !== 1) continue; // premier point (MoveTo)
      const props = {}; for (let k = 0; k + 1 < tags.length; k += 2) props[keys[tags[k]]] = vals[tags[k + 1]];
      out.push({ x: zz(geom[1]), y: zz(geom[2]), extent, type, props });
    }
  }
  return out;
}
const toLngLat = (z, x, y, px, py, extent) => {
  const n = 2 ** z, wx = (x + px / extent) / n, wy = (y + py / extent) / n;
  return [wx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI];
};

// Tous les lieux de la couche « pois » au zoom le plus détaillé, éventuellement limités à un rectangle [s, w, n, e]
function* pois(file, { bbox = null, onProgress = null } = {}) {
  const pm = open(file), z = pm.maxzoom;
  let seen = 0;
  try {
    for (const tl of tilesAt(pm, z)) {
      const [, x, y] = tileIdToZxy(tl.id, z);
      if (bbox) {
        const [w, n] = toLngLat(z, x, y, 0, 0, 1), [e, s] = toLngLat(z, x, y, 1, 1, 1);
        if (n < bbox[0] || s > bbox[2] || e < bbox[1] || w > bbox[3]) continue;
      }
      seen++; if (onProgress && seen % 2000 === 0) onProgress(seen);
      let data; try { data = decomp(read(pm.fd, pm.tileOff + tl.off, tl.len), pm.tileC); } catch { continue; }
      for (const p of layerPoints(data, 'pois')) {
        if (p.x < 0 || p.y < 0 || p.x >= p.extent || p.y >= p.extent) continue; // marge d'une tuile voisine : déjà comptée là-bas
        const [lng, lat] = toLngLat(z, x, y, p.x, p.y, p.extent);
        yield { lat, lng, props: p.props };
      }
    }
  } finally { fs.closeSync(pm.fd); }
}

// Nombre de tuiles au zoom le plus détaillé (pour afficher l'avancement)
function countTiles(file) { const pm = open(file); let n = 0; try { for (const _ of tilesAt(pm, pm.maxzoom)) n++; } finally { fs.closeSync(pm.fd); } return n; }

module.exports = { pois, countTiles, tileIdToZxy, layerPoints };

// ---- Ligne de commande : statistiques des types de lieux dans un rectangle ----
if (require.main === module) {
  const [file, flag, box] = process.argv.slice(2);
  if (!file) { console.log('Usage : node tools/pmtiles-pois.js FICHIER.pmtiles [--stats s,w,n,e]'); process.exit(1); }
  const bbox = flag === '--stats' && box ? box.split(',').map(Number) : null;
  const kinds = new Map(), keys = new Map(), ex = new Map(); let n = 0;
  const t0 = Date.now();
  for (const p of pois(file, { bbox, onProgress: k => process.stderr.write(`\r${k} tuiles lues…`) })) {
    n++;
    const k = String(p.props.kind ?? p.props['pmap:kind'] ?? '?');
    kinds.set(k, (kinds.get(k) || 0) + 1);
    for (const key of Object.keys(p.props)) keys.set(key, (keys.get(key) || 0) + 1);
    if (!ex.has(k) && p.props.name) ex.set(k, `${p.props.name} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`);
  }
  process.stderr.write('\n');
  console.log(`${n} lieux en ${Math.round((Date.now() - t0) / 1000)} s`);
  console.log('Propriétés :', [...keys].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('Types :'); for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}   ex. ${ex.get(k) || ''}`);
}
