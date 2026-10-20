'use strict';
// Petit écrivain PMTiles v3 pour les tests : quelques tuiles, un seul répertoire (compressé gzip), tuiles compressées gzip.
const zlib = require('zlib');
function zxyToTileId(z, x, y) {
  let acc = (4 ** z - 1) / 3;
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (x & s) ? 1 : 0, ry = (y & s) ? 1 : 0;
    acc += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return acc;
}
const varint = n => { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
function writePmtiles(tiles, { minz = 0, maxz = 15, bounds = [-5, 41, 10, 51.5] } = {}) {
  // tiles : [{ z, x, y, data: Buffer (non compressé) }]
  const list = tiles.map(t => ({ id: zxyToTileId(t.z, t.x, t.y), data: zlib.gzipSync(t.data) })).sort((a, b) => a.id - b.id);
  let off = 0; const parts = [];
  for (const t of list) { t.off = off; t.len = t.data.length; off += t.len; parts.push(t.data); }
  const dirBytes = [...varint(list.length)];
  let last = 0; for (const t of list) { dirBytes.push(...varint(t.id - last)); last = t.id; }
  for (const t of list) dirBytes.push(...varint(1));
  for (const t of list) dirBytes.push(...varint(t.len));
  list.forEach((t, i) => dirBytes.push(...varint(i > 0 && t.off === list[i - 1].off + list[i - 1].len ? 0 : t.off + 1)));
  const dir = zlib.gzipSync(Buffer.from(dirBytes)), data = Buffer.concat(parts);
  const h = Buffer.alloc(127); h.write('PMTiles', 0, 'latin1'); h[7] = 3;
  const u = (o, v) => h.writeBigUInt64LE(BigInt(v), o);
  u(8, 127); u(16, dir.length); u(24, 127 + dir.length); u(32, 0); u(40, 127 + dir.length); u(48, 0);
  u(56, 127 + dir.length); u(64, data.length); u(72, list.length); u(80, list.length); u(88, list.length);
  h[96] = 1; h[97] = 2; h[98] = 2; h[99] = 1; h[100] = minz; h[101] = maxz;
  [bounds[0], bounds[1], bounds[2], bounds[3]].forEach((v, i) => h.writeInt32LE(Math.round(v * 1e7), 102 + i * 4));
  return Buffer.concat([h, dir, data]);
}
module.exports = { writePmtiles, zxyToTileId };
