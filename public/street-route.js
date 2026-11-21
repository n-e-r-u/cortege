// Chemin piéton par les rues de la carte (tuiles vectorielles, couche « roads »), sans service extérieur.
// Le même fichier sert au serveur (tracé d'un cortège entre sa queue et sa tête : positions publiques) et au téléphone
// (itinéraire personnel qui contourne les dangers signalés : calculé sur le téléphone, la position n'est envoyée nulle part).
//
// 1. Les rues des tuiles autour du trajet sont lues au zoom le plus détaillé, puis assemblées en graphe. Dans les tuiles, deux rues
//    qui se croisent n'ont pas toujours un point commun (la simplification l'a retiré) : les croisements sont donc recalculés, et un
//    bout de rue qui touche une autre rue y est raccordé. Sans cela, une fois sur deux, aucun chemin n'est trouvé.
// 2. Le chemin le moins coûteux est cherché (A*). Le coût d'une rue est sa longueur, multipliée selon le profil (un cortège préfère
//    les grands axes) et selon les zones à éviter (un danger signalé rend les rues autour de lui plus chères : elles sont
//    contournées s'il existe un détour raisonnable, traversées sinon, et le résultat dit lesquelles).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.cortegeStreets = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const utf8 = new TextDecoder();
  const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
  function pbf(buf) {
    let i = 0;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const varint = () => { let v = 0, s = 0, b; do { b = buf[i++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
    return {
      get pos() { return i; }, end: buf.length, varint,
      field() { const k = varint(); return [Math.floor(k / 8), k & 7]; },
      bytes() { const l = varint(), b = buf.subarray(i, i + l); i += l; return b; },
      skip(t) { if (t === 0) varint(); else if (t === 1) i += 8; else if (t === 2) i += varint(); else if (t === 5) i += 4; else throw new Error('protobuf'); },
      double() { const v = view.getFloat64(i, true); i += 8; return v; }, float() { const v = view.getFloat32(i, true); i += 4; return v; },
    };
  }
  function decodeValue(b) {
    const p = pbf(b); let v = null;
    while (p.pos < p.end) {
      const [f, t] = p.field();
      if (f === 1) v = utf8.decode(p.bytes()); else if (f === 2) v = p.float(); else if (f === 3) v = p.double();
      else if (f === 4 || f === 5) v = p.varint(); else if (f === 6) v = zz(p.varint()); else if (f === 7) v = !!p.varint(); else p.skip(t);
    }
    return v;
  }
  // Lignes d'une couche : [{ props, extent, lines: [[[x, y], …], …] }] (coordonnées de tuile)
  function layerLines(tile, name) {
    if (!(tile instanceof Uint8Array)) tile = new Uint8Array(tile);
    const t = pbf(tile), out = [];
    while (t.pos < t.end) {
      const [f, wt] = t.field();
      if (f !== 3) { t.skip(wt); continue; }
      const l = pbf(t.bytes());
      let lname = null, extent = 4096; const keys = [], vals = [], feats = [];
      while (l.pos < l.end) {
        const [lf, lt] = l.field();
        if (lf === 1) { lname = utf8.decode(l.bytes()); if (lname !== name) break; }
        else if (lf === 2) feats.push(l.bytes()); else if (lf === 3) keys.push(utf8.decode(l.bytes()));
        else if (lf === 4) vals.push(decodeValue(l.bytes())); else if (lf === 5) extent = l.varint(); else l.skip(lt);
      }
      if (lname !== name) continue;
      for (const fb of feats) {
        const p = pbf(fb); const tags = [], geom = []; let type = 0;
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

  // ---- Types de rue ----
  // Hors du graphe : autoroutes, rails, ferries, couloirs à l'intérieur des bâtiments, voies privées ou interdites
  const SKIP_KIND = new Set(['highway', 'rail', 'ferry', 'aerialway', 'aeroway']);
  const SKIP_DETAIL = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'corridor', 'runway', 'taxiway']);
  const SKIP_ACCESS = new Set(['no', 'private']);
  // Classes : 0 grand axe, 1 rue, 2 voie de desserte, 3 rue ou place piétonne, 4 chemin, trottoir, piste, 5 escalier
  const classOf = p => {
    const d = p.kind_detail;
    if (d === 'steps') return 5;
    if (p.kind === 'major_road') return 0;
    if (d === 'pedestrian' || d === 'living_street') return 3;
    if (p.kind === 'path') return 4;
    if (d === 'service' || d === 'parking_aisle' || d === 'alley') return 2;
    if (p.kind === 'minor_road' || p.kind === 'medium_road') return 1;
    return 4;
  };
  // Coût d'un mètre selon le profil (toujours ≥ 1 : la distance à vol d'oiseau reste une estimation basse pour A*)
  const PROFILES = {
    pied: [1, 1, 1.05, 1, 1, 1.3],          // à pied : au plus court, les escaliers un peu moins volontiers
    cortege: [1, 1.3, 1.9, 1.15, 2.2, 3.5], // un cortège : boulevards et avenues, rues et places piétonnes, pas les trottoirs ni les escaliers
  };

  // Tuiles à lire : celles qui touchent un couloir de `margin` mètres autour de la ligne brisée pts
  function tilesAlong(pts, z, margin) {
    const set = new Map();
    const n = 2 ** z, mPerTile = lat => 40075016 * Math.cos(lat * Math.PI / 180) / n;
    let s = 90, nn = -90, w = 180, e = -180;
    for (const p of pts) { s = Math.min(s, p[0]); nn = Math.max(nn, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
    const dLat = margin / 110540, dLng = margin / (111320 * Math.cos(pts[0][0] * Math.PI / 180));
    const [x0, y0] = tileOf(nn + dLat, w - dLng, z), [x1, y1] = tileOf(s - dLat, e + dLng, z);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) return null;
    const segDist = (p, a, b) => { // distance (m) du point p au segment ab
      const k = Math.cos(p[0] * Math.PI / 180), ax = (a[1] - p[1]) * 111320 * k, ay = (a[0] - p[0]) * 110540, bx = (b[1] - p[1]) * 111320 * k, by = (b[0] - p[0]) * 110540;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      return Math.hypot(ax + t * dx, ay + t * dy);
    };
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const c = toLatLng(z, x, y, 0.5, 0.5, 1), reach = margin + mPerTile(c[0]) * 0.71;
      let ok = pts.length === 1 && meters(c, pts[0]) <= reach;
      for (let i = 1; i < pts.length && !ok; i++) ok = segDist(c, pts[i - 1], pts[i]) <= reach;
      if (ok) set.set(x + '/' + y, [x, y]);
    }
    return [...set.values()];
  }

  // ---- Graphe des rues ----
  // getTile(z, x, y) → tuile décompressée (Uint8Array ou Buffer) ou null. pts : points par lesquels le trajet passe ([lat, lng]).
  // Résultat : le graphe, ou null (trop de tuiles, aucune rue). missing : tuiles qui n'ont pas pu être lues.
  async function buildGraph(getTile, z, pts, { margin = 350, maxTiles = 64 } = {}) {
    const tiles = tilesAlong(pts, z, margin);
    if (!tiles || !tiles.length || tiles.length > maxTiles) return null;
    const lat0 = pts[0][0], KY = 110540, KX = 111320 * Math.cos(lat0 * Math.PI / 180), lng0 = pts[0][1];
    // Nœuds : coordonnées en mètres autour du premier point (plan local, suffisant sur quelques kilomètres)
    const X = [], Y = [], ids = new Map();
    const nodeAt = (x, y) => {
      const k = Math.round(x * 2) * 4000003 + Math.round(y * 2); // à 50 cm près
      let i = ids.get(k);
      if (i === undefined) { i = X.length; X.push(x); Y.push(y); ids.set(k, i); }
      return i;
    };
    const segA = [], segB = [], segC = [], segF = []; // bouts de rue : nœuds, classe, pont ou tunnel
    const ends = [];
    let missing = 0;
    for (const [x, y] of tiles) {
      let tile; try { tile = await getTile(z, x, y); } catch { tile = null; }
      if (!tile) { missing++; continue; }
      for (const f of layerLines(tile, 'roads')) {
        const p = f.props;
        if (SKIP_KIND.has(p.kind) || SKIP_DETAIL.has(p.kind_detail) || SKIP_ACCESS.has(p.access)) continue;
        const cls = classOf(p), lvl = p.is_bridge || p.is_tunnel ? 1 : 0;
        for (const line of f.lines) {
          let prev = -1;
          for (const [px, py] of line) {
            const ll = toLatLng(z, x, y, px, py, f.extent), n = nodeAt((ll[1] - lng0) * KX, (ll[0] - lat0) * KY);
            if (prev >= 0 && prev !== n) { segA.push(prev); segB.push(n); segC.push(cls); segF.push(lvl); }
            if (prev < 0) ends.push(n);
            prev = n;
          }
          ends.push(prev);
        }
      }
    }
    if (!segA.length) return null;
    // Croisements et raccords : une grille de 40 m range les bouts de rue, chaque paire voisine est examinée une fois
    const CELL = 40, TOUCH = 3, cells = new Map(), cellKey = (i, j) => i * 100003 + j;
    const S = segA.length;
    for (let s = 0; s < S; s++) {
      const a = segA[s], b = segB[s];
      // Rangé avec 3 m de marge : deux rues qui se touchent presque, de part et d'autre d'une limite de case, se retrouvent quand même
      const i0 = Math.floor((Math.min(X[a], X[b]) - TOUCH) / CELL), i1 = Math.floor((Math.max(X[a], X[b]) + TOUCH) / CELL), j0 = Math.floor((Math.min(Y[a], Y[b]) - TOUCH) / CELL), j1 = Math.floor((Math.max(Y[a], Y[b]) + TOUCH) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = cellKey(i, j); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(s); }
    }
    const cuts = new Array(S); // pour chaque bout de rue : les nœuds ajoutés le long ([position 0-1, nœud])
    const cut = (s, t, n) => { (cuts[s] || (cuts[s] = [])).push([t, n]); };
    const extra = []; // raccords entre un bout de rue et une rue voisine : [nœud, nœud]
    const seen = new Int32Array(S).fill(-1);
    for (let s = 0; s < S; s++) {
      const a = segA[s], b = segB[s], ax = X[a], ay = Y[a], bx = X[b], by = Y[b], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const i0 = Math.floor(Math.min(ax, bx) / CELL), i1 = Math.floor(Math.max(ax, bx) / CELL), j0 = Math.floor(Math.min(ay, by) / CELL), j1 = Math.floor(Math.max(ay, by) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const o of cells.get(cellKey(i, j))) {
        if (o <= s || seen[o] === s) continue;
        seen[o] = s;
        const c = segA[o], d = segB[o];
        if (c === a || c === b || d === a || d === b) continue; // déjà reliés par un point commun
        const cx = X[c], cy = Y[c], ex = X[d] - cx, ey = Y[d] - cy, m2 = ex * ex + ey * ey;
        if (!m2) continue;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) > 1e-9) {
          const t = ((cx - ax) * ey - (cy - ay) * ex) / den, u = ((cx - ax) * dy - (cy - ay) * dx) / den;
          // Vrai croisement (pas entre un pont ou un tunnel et la rue qu'il enjambe)
          if (t > 0 && t < 1 && u > 0 && u < 1) {
            if (!segF[s] && !segF[o]) { const n = nodeAt(ax + t * dx, ay + t * dy); cut(s, t, n); cut(o, u, n); }
            continue;
          }
        }
        // Un bout de l'une touche l'autre (à moins de 3 m) : raccord
        const touch = (px, py, pn, qx, qy, qdx, qdy, ql2, seg) => {
          const t = ((px - qx) * qdx + (py - qy) * qdy) / ql2;
          if (t <= 0 || t >= 1) return;
          const fx = qx + t * qdx, fy = qy + t * qdy;
          if (Math.hypot(px - fx, py - fy) > TOUCH) return;
          const n = nodeAt(fx, fy); cut(seg, t, n); if (n !== pn) extra.push([pn, n]);
        };
        if (!segF[s] && !segF[o]) {
          touch(cx, cy, c, ax, ay, dx, dy, l2, s); touch(X[d], Y[d], d, ax, ay, dx, dy, l2, s);
          touch(ax, ay, a, cx, cy, ex, ey, m2, o); touch(bx, by, b, cx, cy, ex, ey, m2, o);
        }
      }
    }
    // Arêtes : chaque bout de rue, découpé à ses croisements
    const N0 = X.length, head = new Int32Array(N0 + 2).fill(-1), nxt = [], to = [], len = [], cls = []; // + 2 : départ et arrivée, ajoutés le temps d'un calcul
    const edge = (a, b, c) => {
      if (a === b) return;
      const l = Math.hypot(X[a] - X[b], Y[a] - Y[b]);
      to.push(b); len.push(l); cls.push(c); nxt.push(head[a]); head[a] = to.length - 1;
      to.push(a); len.push(l); cls.push(c); nxt.push(head[b]); head[b] = to.length - 1;
    };
    for (let s = 0; s < S; s++) {
      const cs = cuts[s];
      if (!cs) { edge(segA[s], segB[s], segC[s]); continue; }
      cs.sort((p, q) => p[0] - q[0]);
      let prev = segA[s];
      for (const [, n] of cs) { edge(prev, n, segC[s]); prev = n; }
      edge(prev, segB[s], segC[s]);
    }
    for (const [a, b] of extra) edge(a, b, 4);
    // Bouts de rue coupés au bord d'une tuile, ou qui s'arrêtent à quelques mètres l'un de l'autre : recollés (6 m)
    const NG = 8, ngrid = new Map(), nk = i => Math.floor(X[i] / NG) * 100003 + Math.floor(Y[i] / NG);
    const endSet = new Set(ends);
    for (const i of endSet) { const k = nk(i); let l = ngrid.get(k); if (!l) ngrid.set(k, l = []); l.push(i); }
    for (const i of endSet) {
      const gi = Math.floor(X[i] / NG), gj = Math.floor(Y[i] / NG);
      for (let u = gi - 1; u <= gi + 1; u++) for (let v = gj - 1; v <= gj + 1; v++) for (const o of ngrid.get(u * 100003 + v) || [])
        if (o > i && Math.hypot(X[i] - X[o], Y[i] - Y[o]) <= 6) edge(i, o, 4);
    }
    // Morceaux du réseau reliés entre eux (une cour fermée, un quai isolé forment leur propre morceau)
    const comp = new Int32Array(N0 + 2).fill(-1); let nc = 0; const size = [];
    for (let i = 0; i < N0; i++) {
      if (comp[i] >= 0 || head[i] < 0) continue;
      const stack = [i]; comp[i] = nc; let n = 0;
      while (stack.length) { const k = stack.pop(); n++; for (let e = head[k]; e >= 0; e = nxt[e]) if (comp[to[e]] < 0) { comp[to[e]] = nc; stack.push(to[e]); } }
      size.push(n); nc++;
    }
    // Grille des rues (cases de 60 m), pour trouver la rue la plus proche d'un point. Une arête = deux entrées voisines (aller, retour).
    const PG = 60, pgrid = new Map();
    for (let e = 0; e < to.length; e += 2) {
      const a = to[e + 1], b = to[e];
      const i0 = Math.floor(Math.min(X[a], X[b]) / PG), i1 = Math.floor(Math.max(X[a], X[b]) / PG), j0 = Math.floor(Math.min(Y[a], Y[b]) / PG), j1 = Math.floor(Math.max(Y[a], Y[b]) / PG);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * 100003 + j; let l = pgrid.get(k); if (!l) pgrid.set(k, l = []); l.push(e); }
    }
    return { X, Y, head, nxt, to, len, cls, comp, size, pgrid, PG, lat0, lng0, KX, KY, missing, tiles: tiles.length, nodes: N0, edges: to.length / 2 };
  }

  const toXY = (g, p) => [(p[1] - g.lng0) * g.KX, (p[0] - g.lat0) * g.KY];
  const toLL = (g, i) => [Math.round((g.lat0 + g.Y[i] / g.KY) * 1e5) / 1e5, Math.round((g.lng0 + g.X[i] / g.KX) * 1e5) / 1e5];
  // Les rues les plus proches d'un point (au plus `count`, à moins de `max` mètres) : [arête, distance, position 0-1 sur l'arête, x, y]
  function nearStreets(g, p, max, count) {
    const [px, py] = toXY(g, p), out = [], seen = new Set(), r = Math.ceil(max / g.PG), gi = Math.floor(px / g.PG), gj = Math.floor(py / g.PG);
    for (let i = gi - r; i <= gi + r; i++) for (let j = gj - r; j <= gj + r; j++) for (const e of g.pgrid.get(i * 100003 + j) || []) {
      if (seen.has(e)) continue;
      seen.add(e);
      const a = g.to[e + 1], b = g.to[e], dx = g.X[b] - g.X[a], dy = g.Y[b] - g.Y[a], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - g.X[a]) * dx + (py - g.Y[a]) * dy) / l2)) : 0, fx = g.X[a] + t * dx, fy = g.Y[a] + t * dy, d = Math.hypot(px - fx, py - fy);
      if (d <= max) out.push([e, d, t, fx, fy]);
    }
    return out.sort((x, y) => x[1] - y[1]).slice(0, count);
  }
  // Ajoute au graphe, le temps d'un calcul, un nœud posé sur une rue (le pied de la perpendiculaire depuis le point de départ ou
  // d'arrivée). Rend le nœud et de quoi le retirer.
  function attach(g, [e, , t, fx, fy]) {
    const a = g.to[e + 1], b = g.to[e], n = g.X.length, ha = g.head[a], hb = g.head[b], E = g.to.length;
    g.X.push(fx); g.Y.push(fy); g.head[n] = -1; g.comp[n] = g.comp[a];
    const add = (u, v, l) => { g.to.push(v); g.len.push(l); g.cls.push(g.cls[e]); g.nxt.push(g.head[u]); g.head[u] = g.to.length - 1; };
    add(n, a, t * g.len[e]); add(a, n, t * g.len[e]); add(n, b, (1 - t) * g.len[e]); add(b, n, (1 - t) * g.len[e]);
    return { n, undo() { g.head[a] = ha; g.head[b] = hb; g.head[n] = -1; g.X.pop(); g.Y.pop(); g.to.length = g.len.length = g.cls.length = g.nxt.length = E; } };
  }

  class Heap {
    constructor() { this.k = []; this.v = []; }
    push(k, v) { const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v); while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= K[i]) break; [K[p], K[i]] = [K[i], K[p]]; [V[p], V[i]] = [V[i], V[p]]; i = p; } }
    pop() {
      const K = this.k, V = this.v, top = V[0], lk = K.pop(), lv = V.pop();
      if (K.length) { K[0] = lk; V[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < K.length && K[l] < K[m]) m = l; if (r < K.length && K[r] < K[m]) m = r; if (m === i) break; [K[m], K[i]] = [K[i], K[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m; } }
      return top;
    }
    get size() { return this.k.length; }
  }

  // Chemin le moins coûteux de a à b sur le graphe g.
  //  profile : 'pied' ou 'cortege'. snap : distance maximale (m) entre un point et la rue où il est raccroché.
  //  avoid : zones à éviter [{ lat, lng, r (m), k (coût multiplié, ≥ 1) }].
  // Résultat : { path: [[lat, lng], …], len (m réels), through: [indices des zones traversées quand même] } ou null.
  function routeOn(g, a, b, { profile = 'pied', snap = 250, avoid = [] } = {}) {
    const F = PROFILES[profile] || PROFILES.pied;
    // Départ et arrivée : sur la rue la plus proche de chaque point, dans le même morceau du réseau
    const sa = nearStreets(g, a, snap, 12), sb = nearStreets(g, b, snap, 12);
    let best = null;
    for (const x of sa) for (const y of sb) if (g.comp[g.to[x[0]]] === g.comp[g.to[y[0]]] && (!best || x[1] + y[1] < best[2])) best = [x, y, x[1] + y[1]];
    if (!best) return null;
    // L'arrivée d'abord : retirée en dernier (l'ordre inverse de l'ajout remet le graphe dans son état)
    const pb = attach(g, best[1]), pa = attach(g, best[0]);
    try { return search(g, a, b, pa.n, pb.n, best[2], F, avoid); } finally { pa.undo(); pb.undo(); }
  }
  function search(g, a, b, start, goal, off, F, avoid) {
    const zones = avoid.map(z => { const [x, y] = toXY(g, [z.lat, z.lng]); return { x, y, r2: z.r * z.r, k: Math.max(1, z.k || 1) }; });
    // Longueur (m) de l'arête i → to[e] qui se trouve dans la zone z (la rue peut être longue : seul le morceau dans la zone compte)
    const inside = (i, e, z) => {
      const ax = g.X[i] - z.x, ay = g.Y[i] - z.y, dx = g.X[g.to[e]] - g.X[i], dy = g.Y[g.to[e]] - g.Y[i], A = dx * dx + dy * dy;
      if (!A) return 0;
      const B = 2 * (ax * dx + ay * dy), C = ax * ax + ay * ay - z.r2, D = B * B - 4 * A * C;
      if (D <= 0) return 0;
      const q = Math.sqrt(D), t0 = Math.max(0, (-B - q) / (2 * A)), t1 = Math.min(1, (-B + q) / (2 * A));
      return t1 > t0 ? (t1 - t0) * g.len[e] : 0;
    };
    // Mètres « en plus » comptés pour une arête : chaque mètre dans une zone coûte k fois plus cher (les zones se cumulent)
    const extra = (i, e) => { let x = 0; for (const z of zones) { const l = inside(i, e, z); if (l) x += l * (z.k - 1); } return x; };
    const N = g.X.length, dist = new Float64Array(N).fill(Infinity), real = new Float64Array(N), from = new Int32Array(N).fill(-1), fromE = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const gx = g.X[goal], gy = g.Y[goal], h = i => Math.hypot(g.X[i] - gx, g.Y[i] - gy);
    const open = new Heap(); dist[start] = 0; open.push(h(start), start);
    let found = false, steps = 0;
    while (open.size) {
      const k = open.pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === goal) { found = true; break; }
      if (++steps > 400000) break;
      for (let e = g.head[k]; e >= 0; e = g.nxt[e]) {
        const o = g.to[e];
        if (done[o]) continue;
        const nd = dist[k] + (g.len[e] + (zones.length ? extra(k, e) : 0)) * F[g.cls[e]];
        if (nd < dist[o]) { dist[o] = nd; real[o] = real[k] + g.len[e]; from[o] = k; fromE[o] = e; open.push(nd + h(o), o); }
      }
    }
    if (!found) return null;
    const path = [], through = new Set();
    for (let k = goal; k >= 0; k = from[k]) {
      path.push(toLL(g, k));
      if (fromE[k] >= 0) for (let q = 0; q < zones.length; q++) if (inside(from[k], fromE[k], zones[q]) > 1) through.add(q);
      if (k === start) break;
    }
    path.reverse();
    const r5 = p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
    return { path: [r5(a), ...path, r5(b)], len: Math.round(real[goal] + off), through: [...through].sort((x, y) => x - y) };
  }

  // Trajet qui passe par plusieurs points, dans l'ordre (la queue d'un cortège, les positions passées de sa tête, sa tête).
  // Un tronçon sans chemin est tracé droit : `air` compte ces tronçons.
  function routeVia(g, pts, opt) {
    const path = []; let air = 0;
    for (let i = 1; i < pts.length; i++) {
      const r = routeOn(g, pts[i - 1], pts[i], opt);
      if (!r) air++;
      for (const p of (r ? r.path : [pts[i - 1], pts[i]])) {
        // Aller-retour dans une rue de côté (une position un peu décalée) : le détour est retiré
        let back = -1;
        for (let k = path.length - 1; k >= Math.max(0, path.length - 60); k--) if (path[k][0] === p[0] && path[k][1] === p[1]) { back = k; break; }
        if (back >= 0) path.length = back + 1; else path.push(p);
      }
    }
    let len = 0; for (let i = 1; i < path.length; i++) len += meters(path[i - 1], path[i]);
    return { path, len: Math.round(len), air };
  }

  // Tracé d'un cortège entre a et b, en passant par via (compatibilité : streetRoute(getTile, z, a, b))
  async function streetRoute(getTile, z, a, b, { via = [], profile = 'cortege', margin = 350, snap = 250, maxTiles = 64 } = {}) {
    const pts = [a, ...via, b], g = await buildGraph(getTile, z, pts, { margin, maxTiles });
    if (!g) return null;
    const r = routeVia(g, pts, { profile, snap });
    return r.air === pts.length - 1 ? null : r;
  }

  return { buildGraph, routeOn, routeVia, streetRoute, layerLines, tileOf, tilesAlong, meters, PROFILES };
});
