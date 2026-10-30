'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ROOT, MIN, TILE_URL, TILE_UA, PUBLIC_URL } = require('../config');
const { clientHash } = require('../privacy');
const { send } = require('../http/respond');
const { PMTILES } = require('./pmtiles');

// ---- Proxy de tuiles : les IP des manifestant·es ne partent pas chez le fournisseur de carte ----
const tileCache = new Map(); const TILE_CACHE_MAX = 2000, TILE_CACHE_BYTES = (Number(process.env.TILE_CACHE_MB) || 64) * 1e6;
let tileCacheBytes = 0;
function tileCachePut(key, buf) {
  const old = tileCache.get(key); if (old) tileCacheBytes -= old.length;
  tileCache.set(key, buf); tileCacheBytes += buf.length;
  while (tileCache.size > TILE_CACHE_MAX || tileCacheBytes > TILE_CACHE_BYTES) { const [k, v] = tileCache.entries().next().value; tileCache.delete(k); tileCacheBytes -= v.length; }
}
// Cache disque : une tuile téléchargée une fois est écrite dans tiles/z/x/y.png.
// Sur cPanel, Apache la sert ensuite directement, sans Node ni OpenStreetMap.
const TILE_DIR = process.env.TILE_DIR || path.join(ROOT, 'tiles');
const TILE_DISK = process.env.TILE_DISK !== '0';
const TILE_DAYS = Number(process.env.TILE_DAYS) || 30;
if (TILE_DISK) try {
  fs.mkdirSync(TILE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TILE_DIR, '.htaccess'), ['Options -Indexes', '<IfModule mod_headers.c>', '  Header set Cache-Control "public, max-age=604800"', '</IfModule>', ''].join('\n'));
} catch {}
// Ménage du cache disque : tuiles de plus de TILE_DAYS jours (la carte d'OSM évolue), puis les plus anciennes
// tant que le cache dépasse TILE_DISK_GB (2 Go par défaut) : personne ne peut remplir le disque en demandant des tuiles.
const TILE_DISK_BYTES = (Number(process.env.TILE_DISK_GB) || 2) * 1e9;
function pruneTiles() {
  const limit = Date.now() - TILE_DAYS * 24 * 60 * MIN, files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.png')) { const st = fs.statSync(p); if (st.mtimeMs < limit) try { fs.unlinkSync(p); } catch {} else files.push([st.mtimeMs, st.size, p]); }
  } };
  try { walk(TILE_DIR); } catch {}
  let total = files.reduce((t, f) => t + f[1], 0);
  if (total > TILE_DISK_BYTES) for (const [, size, p] of files.sort((a, b) => a[0] - b[0])) { if (total <= TILE_DISK_BYTES * 0.9) break; try { fs.unlinkSync(p); total -= size; } catch {} }
}
if (TILE_DISK) setInterval(pruneTiles, 6 * 60 * MIN).unref();
// Protection du proxy de tuiles : sans elle, n'importe qui pourrait faire télécharger des millions de tuiles
// par le serveur, remplir le disque et faire bannir le serveur par OpenStreetMap (la carte tomberait pour tous).
//  - zone : France métropolitaine, Corse et outre-mer à partir du zoom 8 (en dessous, le monde entier tient en peu de tuiles) ;
//  - budget par réseau de tuiles NOUVELLES (les tuiles déjà en cache ne comptent pas) ;
//  - plafond de téléchargements simultanés, et une même tuile demandée par mille personnes n'est téléchargée qu'une fois.
const TILE_ZONES = [[41, 51.6, -5.8, 10.6], [15.8, 16.6, -61.9, -60.9], [14.3, 14.95, -61.3, -60.75], [2, 6, -54.7, -51.5],
  [-21.45, -20.85, 55.1, 55.9], [-13.05, -12.6, 44.95, 45.35], [46.7, 47.2, -56.5, -56.05]]; // métropole+Corse, Guadeloupe, Martinique, Guyane, Réunion, Mayotte, St-Pierre
// Préchargement de zone (« Garder la zone hors ligne ») : interdit par la politique d'OpenStreetMap,
// désactivé tant que les tuiles viennent de chez eux. TILE_PREFETCH=1 pour un fournisseur qui l'autorise.
const TILE_PREFETCH = process.env.TILE_PREFETCH === '1';
const TILE_NET_BUDGET = Number(process.env.TILE_NET_BUDGET) || 600;   // nouvelles tuiles par réseau et par 10 min
const TILE_UPSTREAM_MAX = 12;                                          // téléchargements simultanés vers le fournisseur
const tileBudget = new Map(), tileInflight = new Map();
let tileUpstream = 0;
const tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
// Carte hébergée (PMTiles) : hors de sa zone, les téléphones se replient sur OpenStreetMap partout dans le monde
// (même budget par réseau et même plafond de téléchargements qu'avant).
const TILE_WORLD = process.env.TILE_WORLD ? process.env.TILE_WORLD === '1' : !!PMTILES;
function tileInZone(z, x, y) {
  if (z < 8 || TILE_WORLD) return true;
  const w = x / 2 ** z * 360 - 180, e = (x + 1) / 2 ** z * 360 - 180, n = tile2lat(y, z), so = tile2lat(y + 1, z);
  return TILE_ZONES.some(([la1, la2, lo1, lo2]) => so <= la2 && n >= la1 && w <= lo2 && e >= lo1);
}
function tileBudgetOk(ip) {
  const now = Date.now(), b = tileBudget.get(ip);
  if (!b || now - b.t > 10 * MIN) { tileBudget.set(ip, { t: now, n: 1 }); if (tileBudget.size > 20000) tileBudget.clear(); return true; }
  return ++b.n <= TILE_NET_BUDGET;
}
function fetchTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileInflight.has(key)) return tileInflight.get(key);
  const p = new Promise((resolve, reject) => {
    tileUpstream++;
    const done = () => { tileUpstream--; tileInflight.delete(key); };
    const rq = (TILE_URL.startsWith('http:') ? http : https).get(TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: { 'User-Agent': TILE_UA, Referer: PUBLIC_URL + '/' }, timeout: 10_000 }, up => {
      if (up.statusCode !== 200) { up.resume(); done(); return reject(new Error('upstream ' + up.statusCode)); }
      const chunks = []; let size = 0;
      up.on('data', c => { size += c.length; if (size > 2_000_000) rq.destroy(); else chunks.push(c); });
      up.on('end', () => {
        const buf = Buffer.concat(chunks); done();
        tileCachePut(key, buf);
        if (TILE_DISK) {
          const dir = path.join(TILE_DIR, String(z), String(x));
          fs.mkdir(dir, { recursive: true }, () => {
            const tmp = path.join(dir, y + '.png.' + process.pid + '.tmp');
            fs.writeFile(tmp, buf, err => { if (!err) fs.rename(tmp, path.join(dir, y + '.png'), () => {}); });
          });
        }
        resolve(buf);
      });
      up.on('error', e => { done(); reject(e); });
    });
    rq.on('timeout', () => rq.destroy(new Error('timeout')));
    rq.on('error', e => { if (tileInflight.get(key) === p) done(); reject(e); });
  });
  tileInflight.set(key, p);
  return p;
}
function serveTile(req, res, z, x, y) {
  z = +z; x = +x; y = +y;
  if (!(z >= 0 && z <= 19 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z)) return send(res, 400, 'bad tile');
  const out = buf => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' }); res.end(buf); };
  const key = `${z}/${x}/${y}`, hit = tileCache.get(key);
  if (hit) { tileCache.delete(key); tileCache.set(key, hit); return out(hit); }
  if (!tileInZone(z, x, y)) return send(res, 404, 'hors zone');
  if (!tileInflight.has(key)) {
    if (!tileBudgetOk(clientHash(req))) return send(res, 429, 'trop de tuiles');
    if (tileUpstream >= TILE_UPSTREAM_MAX) return send(res, 503, 'occupé', { 'Retry-After': '2' });
  }
  fetchTile(z, x, y).then(out, () => { if (!res.headersSent) send(res, 502, 'tile upstream'); });
}

module.exports = { TILE_DIR, TILE_DISK, TILE_ZONES, TILE_PREFETCH, tileInZone, serveTile };
