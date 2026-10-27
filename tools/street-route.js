'use strict';
// Chemin piéton le plus court entre deux points (la queue et la tête d'un cortège), sur les rues de la carte hébergée :
// tuiles vectorielles du fichier PMTiles, couche « roads ». Tout est calculé sur le serveur, sans service extérieur.
// Les rues sont lues au zoom le plus détaillé dans un rectangle autour des deux points, puis assemblées en graphe
// (les bouts de rue coupés au bord d'une tuile sont recollés à quelques mètres près), et le plus court chemin est cherché (A*).

const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
function pbf(buf) {
  let i = 0;
  const varint = () => { let v = 0, s = 0, b; do { b = buf[i++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  return {
    get pos() { return i; }, end: buf.length, varint,
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
    else if (f === 4 || f === 5) v = p.varint(); else if (f === 6) v = zz(p.varint()); else if (f === 7) v = !!p.varint(); else p.skip(t);
  }
  return v;
}
// Lignes d'une couche : [{ props, extent, lines: [[[x, y], …], …] }] (coordonnées de tuile)
function layerLines(tile, name) {
  const t = pbf(tile), out = [];
  while (t.pos < t.end) {
    const [f, wt] = t.field();
    if (f !== 3) { t.skip(wt); continue; }
    const l = pbf(t.bytes());
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
        if (ff === 2) { const q = pbf(p.bytes()); while (q.pos < q.end) tags.push(q.varint()); }
        else if (ff === 3) type = p.varint();
        else if (ff === 4) { const q = pbf(p.bytes()); while (q.pos < q.end) geom.push(q.varint()); }
        else p.skip(ft);
      }
      if (type !== 2) continue; // lignes seulement
      const lines = []; let cx = 0, cy = 0, cur = null;
      for (let k = 0; k < geom.length;) {
        const cmd = geom[k] & 7, n = geom[k] >> 3; k++;
        if (cmd === 1 || cmd === 2) for (let j = 0; j < n; j++) {
          cx += zz(geom[k++]); cy += zz(geom[k++]);
          if (cmd === 1) { cur = [[cx, cy]]; lines.push(cur); } else if (cur) cur.push([cx, cy]);
        }
      }
      const props = {}; for (let k = 0; k + 1 < tags.length; k += 2) props[keys[tags[k]]] = vals[tags[k + 1]];
      out.push({ props, extent, lines: lines.filter(x => x.length > 1) });
    }
  }
  return out;
}
const toLatLng = (z, x, y, px, py, extent) => {
  const n = 2 ** z, wx = (x + px / extent) / n, wy = (y + py / extent) / n;
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI, wx * 360 - 180];
};
const tileOf = (lat, lng, z) => {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};
const meters = (a, b) => { const k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180); return Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * k); };
// Pas de chemin piéton sur les autoroutes, les voies ferrées, les ferries
const SKIP = new Set(['highway', 'rail', 'ferry', 'aerialway']);

// Petit tas binaire pour A*
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// getTile(z, x, y) → tuile décompressée (Buffer) ou null. a, b : [lat, lng]. Résultat : { path: [[lat, lng], …], len } ou null
async function streetRoute(getTile, z, a, b, { margin = 400, snap = 250, maxTiles = 64 } = {}) {
  const dLat = margin / 110540, dLng = margin / (111320 * Math.cos(a[0] * Math.PI / 180));
  const s = Math.min(a[0], b[0]) - dLat, nn = Math.max(a[0], b[0]) + dLat, w = Math.min(a[1], b[1]) - dLng, e = Math.max(a[1], b[1]) + dLng;
  const [x0, y0] = tileOf(nn, w, z), [x1, y1] = tileOf(s, e, z);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > maxTiles) return null;
  const nodes = new Map(), adj = new Map();
  const key = p => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  const node = p => { const k = key(p); if (!nodes.has(k)) { nodes.set(k, p); adj.set(k, []); } return k; };
  const link = (k1, k2) => { if (k1 === k2) return; const d = meters(nodes.get(k1), nodes.get(k2)); adj.get(k1).push([k2, d]); adj.get(k2).push([k1, d]); };
  const ends = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    let tile; try { tile = await getTile(z, x, y); } catch { tile = null; }
    if (!tile) continue;
    for (const f of layerLines(tile, 'roads')) {
      if (SKIP.has(f.props.kind) || SKIP.has(f.props.kind_detail)) continue;
      for (const line of f.lines) {
        let prev = null;
        for (const [px, py] of line) {
          const k = node(toLatLng(z, x, y, px, py, f.extent));
          if (prev) link(prev, k); prev = k;
        }
        ends.push(key(toLatLng(z, x, y, line[0][0], line[0][1], f.extent)), prev);
      }
    }
  }
  if (!nodes.size) return null;
  // Bouts de rue coupés au bord d'une tuile : recollés au point le plus proche à moins de 6 m
  const G = 0.0001, grid = new Map(), gk = p => Math.floor(p[0] / G) + '_' + Math.floor(p[1] / G);
  for (const [k, p] of nodes) { const c = gk(p); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(k); }
  const near = (p, max) => {
    let best = null, bd = max; const gi = Math.floor(p[0] / G), gj = Math.floor(p[1] / G), r = Math.ceil(max / 11 / 1) || 1;
    for (let i = gi - r; i <= gi + r; i++) for (let j = gj - r; j <= gj + r; j++) for (const k of grid.get(i + '_' + j) || []) { const d = meters(p, nodes.get(k)); if (d < bd) { bd = d; best = k; } }
    return best ? [best, bd] : null;
  };
  for (const k of new Set(ends)) {
    const p = nodes.get(k), gi = Math.floor(p[0] / G), gj = Math.floor(p[1] / G);
    for (let i = gi - 1; i <= gi + 1; i++) for (let j = gj - 1; j <= gj + 1; j++) for (const o of grid.get(i + '_' + j) || [])
      if (o !== k && meters(p, nodes.get(o)) <= 6 && !adj.get(k).some(x => x[0] === o)) link(k, o);
  }
  // Départ et arrivée : le point de rue le plus proche
  const start = near(a, snap), goal = near(b, snap);
  if (!start || !goal) return null;
  const target = nodes.get(goal[0]), dist = new Map([[start[0], 0]]), from = new Map(), open = new Heap();
  open.push(meters(nodes.get(start[0]), target), start[0]);
  let found = false, steps = 0;
  while (open.size) {
    const [, k] = open.pop();
    if (k === goal[0]) { found = true; break; }
    if (++steps > 200000) break;
    const dk = dist.get(k);
    for (const [o, d] of adj.get(k)) {
      const nd = dk + d;
      if (nd < (dist.get(o) ?? Infinity)) { dist.set(o, nd); from.set(o, k); open.push(nd + meters(nodes.get(o), target), o); }
    }
  }
  if (!found) return null;
  const path = [];
  for (let k = goal[0]; k; k = from.get(k)) { path.push(nodes.get(k)); if (k === start[0]) break; }
  path.reverse();
  const out = [a, ...path, b].map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  return { path: out, len: Math.round(dist.get(goal[0]) + start[1] + goal[1]) };
}

module.exports = { streetRoute, layerLines, tileOf, meters };
