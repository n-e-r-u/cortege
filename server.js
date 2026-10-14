// Cortège — serveur, zéro dépendance (Node >= 18).
// Compatible hébergement mutualisé (cPanel / Passenger, ex. o2switch) :
//  - l'état est partagé via un petit fichier JSON, car Passenger peut lancer plusieurs
//    processus et les endormir ; la mémoire seule ne suffit pas ;
//  - les clients interrogent le serveur toutes les quelques secondes (pas de connexion
//    permanente, que les proxys mutualisés gèrent mal).
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const EVENT_NAME = process.env.EVENT_NAME || 'Carte des mobilisations';
const CENTER = (process.env.CENTER || '46.6,2.4').split(',').map(Number); // France entière par défaut
const ZOOM = Number(process.env.ZOOM) || 6;
const ADMIN_KEY = process.env.ADMIN_KEY || '';          // accès au digest ; vide = digest désactivé
const ARCHIVE_DAYS = Number(process.env.ARCHIVE_DAYS) || 60;
// Clés orga / legal team : « Nom affiché:clé » séparés par des virgules.
// ex. ORGA_KEYS="Legal Team Montpellier:k7f…,Intersyndicale Lyon:p2x…"
const ORGAS = (process.env.ORGA_KEYS || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
  const i = x.lastIndexOf(':'); return { label: x.slice(0, i).trim(), key: x.slice(i + 1).trim() };
}).filter(o => o.label && o.key.length >= 12);
const TILE_URL = process.env.TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_UA = process.env.TILE_UA || 'Cortege/1.0 (+https://cortege.neru.tv)';
// Derrière Passenger/Apache, l'IP réelle arrive dans un en-tête : activé par défaut sous Passenger.
const UNDER_PASSENGER = typeof PhusionPassenger !== 'undefined';
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : UNDER_PASSENGER;
// Hors du dossier web, pour qu'Apache ne serve jamais ce fichier.
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.cortege-data');
// Lien « Signaler une violence policière » (plateforme de la LDH par défaut ; remplaçable par une variable)
const VIOLENCE_URL = process.env.VIOLENCE_URL || 'https://www.ldh-france.org/stop-violences-policieres/';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const HOST_INFO = process.env.HOST_INFO || '';   // ex. « o2switch, 222 boulevard …, 63000 Clermont-Ferrand — 04 … »
const SOURCE_URL = process.env.SOURCE_URL || ''; // lien du dépôt GitHub
const BRAND = {
  handle: process.env.BRAND_HANDLE || 'neru',
  instagram: process.env.BRAND_INSTAGRAM || 'https://www.instagram.com/neru/',
  site: process.env.BRAND_SITE || 'https://neru.tv',
};

// ---- Catégories (source unique, envoyée au client) — ttl en minutes ----
const CATEGORIES = [
  { id: 'crs',            group: 'fdo',     label: 'CRS / Gendarmes mobiles', glyph: '🛡️', ttl: 20 },
  { id: 'police',         group: 'fdo',     label: 'Police',                  glyph: '🚓', ttl: 20 },
  { id: 'bac',            group: 'fdo',     label: 'BAC / BRAV-M',            glyph: '🏍️', ttl: 15 },
  { id: 'nasse',          group: 'fdo',     label: 'Nasse / encerclement',    glyph: '⭕', ttl: 20 },
  { id: 'interpellation', group: 'fdo',     label: 'Interpellations',         glyph: '⛓️', ttl: 20 },
  { id: 'lacrymo',        group: 'danger',  label: 'Lacrymo',                 glyph: '💨', ttl: 15 },
  { id: 'canon',          group: 'danger',  label: 'Canon à eau',             glyph: '🌊', ttl: 15 },
  { id: 'charge',         group: 'danger',  label: 'Charge',                  glyph: '⚡', ttl: 10 },
  { id: 'chaud',          group: 'danger',  label: 'Point chaud',             glyph: '🔥', ttl: 20 },
  { id: 'sommations',     group: 'danger',  label: 'Sommations',              glyph: '📢', ttl: 20 },
  { id: 'medic',          group: 'soutien', label: 'Street medic',            glyph: '⛑️', ttl: 45 },
  { id: 'legal',          group: 'soutien', label: 'Legal team / observateurs', glyph: '⚖️', ttl: 60 },
  { id: 'presse',         group: 'soutien', label: 'Presse',                  glyph: '🎥', ttl: 45 },
  { id: 'calme',          group: 'soutien', label: 'Zone calme / repli',      glyph: '🕊️', ttl: 30 },
  { id: 'eau',            group: 'soutien', label: 'Eau / sérum phy',         glyph: '💧', ttl: 90 },
  { id: 'cortege',        group: 'info',    label: 'Tête de cortège',         glyph: '📣', ttl: 15 },
  { id: 'bloque',         group: 'info',    label: 'Rue bloquée',             glyph: '⛔', ttl: 30 },
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const GROUPS = [
  { id: 'fdo', label: 'Forces de l’ordre' },
  { id: 'danger', label: 'Danger' },
  { id: 'soutien', label: 'Soutien' },
  { id: 'info', label: 'Infos cortège' },
];

const MIN = 60_000;
const MAX_REPORTS = 2000;
const NOTE_MAX = 120;
const ANN_MAX = 220;
// Limites sur 5 min. En 4G/5G, des centaines d'abonnés partagent la même IP : la limite fine est donc
// par téléphone (identifiant anonyme tiré au hasard sur l'appareil), avec un plafond large par IP.
const RATE = { windowMs: 5 * MIN, maxReports: 8, maxVotes: 40, ipReports: 60, ipVotes: 400 };

// ---- Stockage partagé entre processus ----
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOCK_FILE = STATE_FILE + '.lock';

// Clé de hachage des IP : jamais dans le dossier web, et renouvelée toutes les 6 h.
const SECRET = process.env.SECRET || (() => {
  const f = path.join(DATA_DIR, 'secret');
  try { return fs.readFileSync(f, 'utf8'); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(f, s, { mode: 0o600, flag: 'wx' }); return s; } catch { return fs.readFileSync(f, 'utf8'); }
})();
function clientHash(req) {
  const fwd = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
  const ip = (TRUST_PROXY && String(fwd).split(',')[0].trim()) || req.socket.remoteAddress || '';
  const bucket = Math.floor(Date.now() / (6 * 60 * MIN));
  return crypto.createHmac('sha256', SECRET).update(bucket + '|' + ip).digest('base64url').slice(0, 16);
}
// Empreinte du téléphone : l'identifiant brut n'est jamais stocké, seulement son HMAC.
function deviceHash(req) {
  const d = String(req.headers['x-device'] || '');
  if (!/^[\w-]{16,64}$/.test(d)) return 'ip:' + clientHash(req);
  return 'd:' + crypto.createHmac('sha256', SECRET).update('dev|' + d).digest('base64url').slice(0, 16);
}

function keyEq(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
// Orgas créées depuis la page admin : seule l'empreinte (hash) de leur clé est stockée.
const ORGA_FILE = () => path.join(DATA_DIR, 'orgas.json');
const sha = k => crypto.createHash('sha256').update(String(k)).digest('hex');
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
function isAdmin(req) { return !!ADMIN_KEY && keyEq(String(req.headers['x-admin-key'] || ''), ADMIN_KEY); }
function orgaOf(req) {
  const k = String(req.headers['x-orga-key'] || '');
  if (!k) return null;
  if (ADMIN_KEY && keyEq(k, ADMIN_KEY)) return { label: 'Admin', admin: true };
  const env = ORGAS.find(o => keyEq(k, o.key));
  if (env) return { label: env.label, admin: false };
  const h = sha(k);
  const o = readOrgas().find(o => keyEq(h, o.hash));
  return o ? { label: o.label, admin: false } : null;
}
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const e = Date.now() + ms; while (Date.now() < e); } };
function withLock(fn) {
  let fd;
  for (let i = 0; ; i++) {
    try { fd = fs.openSync(LOCK_FILE, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > 3000) fs.unlinkSync(LOCK_FILE); } catch {}
      if (i > 300) throw new Error('busy');
      sleep(10);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(LOCK_FILE); } catch {} }
}

let cache = { mtime: -1, state: null };
function readState() {
  let st;
  try { st = fs.statSync(STATE_FILE); } catch { return { v: 0, reports: {}, rate: {}, ann: {} }; }
  if (st.mtimeMs !== cache.mtime || !cache.state) {
    try { cache = { mtime: st.mtimeMs, state: JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
    catch { return cache.state || { v: 0, reports: {}, rate: {} }; }
  }
  return cache.state;
}
function mutate(fn) {
  return withLock(() => {
    cache.mtime = -1;
    const s = JSON.parse(JSON.stringify(readState()));
    const now = Date.now();
    for (const [id, r] of Object.entries(s.reports)) if (r.exp <= now) { archive(r, false); delete s.reports[id]; }
    for (const [h, r] of Object.entries(s.rate)) if (now - r.t > RATE.windowMs) delete s.rate[h];
    s.ann = s.ann || {};
    if (s.paused && s.paused <= now) s.paused = 0;
    for (const [id, a] of Object.entries(s.ann)) if (a.exp <= now) delete s.ann[id];
    const out = fn(s, now);
    s.v = (s.v || 0) + 1;
    const tmp = STATE_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
    cache.mtime = -1;
    try { publish(s, now); } catch (e) { console.error('publish', e.message); }
    return out;
  });
}
function bump(s, key, kind, max, now) {
  let r = s.rate[key];
  if (!r || now - r.t > RATE.windowMs) r = s.rate[key] = { t: now, reports: 0, votes: 0 };
  if (r[kind + 's'] >= max) return false;
  r[kind + 's']++;
  return true;
}
// Vrai si ce téléphone ET cette IP sont sous leurs limites.
function allow(s, dev, ip, kind, now) {
  const rep = kind === 'report', cur = s.rate['ip:' + ip];
  if (cur && now - cur.t <= RATE.windowMs && cur[kind + 's'] >= (rep ? RATE.ipReports : RATE.ipVotes)) return false;
  if (!bump(s, dev, kind, rep ? RATE.maxReports : RATE.maxVotes, now)) return false;
  bump(s, 'ip:' + ip, kind, Infinity, now);
  return true;
}
const publicView = r => ({ id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note, t: r.t, exp: r.exp, up: r.up, down: r.down, ver: r.ver || null });
const annView = a => ({ id: a.id, kind: a.kind, level: a.level, text: a.text, phone: a.phone || null, by: a.by, lat: a.lat, lng: a.lng, r: a.r, t: a.t, exp: a.exp });
const round = n => Math.round(n * 1e4) / 1e4; // ~11 m


// ---- Archive anonyme pour le digest ----
// Gardé : catégorie, heure à la minute, position arrondie à ~100 m, nombre de confirmations.
// Jamais gardé : la précision écrite, les empreintes d'IP.
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
fs.mkdirSync(ARCHIVE_DIR, { recursive: true, mode: 0o700 });
const parisDay = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
const parisHour = t => Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
function archive(r, dismissed) {
  const line = JSON.stringify({ c: r.cat, t: Math.floor(r.t / MIN) * MIN, lat: Math.round(r.lat * 1e3) / 1e3, lng: Math.round(r.lng * 1e3) / 1e3,
    up: r.up, d: dismissed ? 1 : 0, v: r.ver ? 1 : 0 }) + '\n';
  try { fs.appendFileSync(path.join(ARCHIVE_DIR, parisDay(r.t) + '.jsonl'), line, { mode: 0o600 }); } catch {}
}
function pruneArchive() {
  const limit = Date.now() - ARCHIVE_DAYS * 24 * 60 * MIN;
  for (const f of fs.readdirSync(ARCHIVE_DIR)) {
    const t = Date.parse(f.slice(0, 10));
    if (t && t < limit) try { fs.unlinkSync(path.join(ARCHIVE_DIR, f)); } catch {}
  }
}
pruneArchive(); setInterval(pruneArchive, 6 * 60 * MIN).unref();

// ---- Recherche de lieux (OpenStreetMap Nominatim, via le serveur : rien ne part du téléphone) ----
const geoCache = new Map();
let geoChain = Promise.resolve(), geoLast = 0;
function nominatim(pathAndQuery) {
  if (geoCache.has(pathAndQuery)) return Promise.resolve(geoCache.get(pathAndQuery));
  // Politique Nominatim : 1 requête par seconde maximum
  const run = () => new Promise(resolve => {
    const wait = Math.max(0, geoLast + 1100 - Date.now());
    setTimeout(() => {
      geoLast = Date.now();
      https.get('https://nominatim.openstreetmap.org' + pathAndQuery, { headers: { 'User-Agent': TILE_UA, 'Accept-Language': 'fr' } }, up => {
        const chunks = []; up.on('data', c => chunks.push(c));
        up.on('end', () => {
          let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
          if (up.statusCode === 200 && data) { geoCache.set(pathAndQuery, data); if (geoCache.size > 3000) geoCache.delete(geoCache.keys().next().value); }
          resolve(data);
        });
      }).on('error', () => resolve(null));
    }, wait);
  });
  const p = geoChain.then(run); geoChain = p.catch(() => {}); return p;
}
const placeName = a => a && (a.city || a.town || a.village || a.municipality || a.suburb || a.county || a.state) || null;


// ---- Publication en fichiers statiques ----
// Après chaque écriture, Node réécrit de petits fichiers JSON dans live/. Sur un hébergement
// cPanel, ce dossier est dans la racine web : Apache les sert directement aux téléphones,
// sans réveiller Node. Node ne traite plus que les envois (signalements, votes, annonces).
//   live/index.json     → version de chaque case active (lu toutes les 5 s, souvent en 304)
//   live/c/<case>.json  → signalements d'une case de 0,05° (≈ 5 km), relus seulement si modifiés
//   live/all.json       → tous les signalements (vue nationale, lue rarement)
//   live/ann.json       → annonces orga actives
const LIVE_DIR = process.env.LIVE_DIR || path.join(__dirname, 'live');
const CELL = 0.05;
const cellId = (lat, lng) => `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;
fs.mkdirSync(path.join(LIVE_DIR, 'c'), { recursive: true });
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
const h8 = str => crypto.createHash('sha1').update(str).digest('base64url').slice(0, 10);
function writeIfChanged(file, str) {
  try { if (fs.readFileSync(file, 'utf8') === str) return; } catch {}
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, str); fs.renameSync(tmp, file);
}
function publish(s, now) {
  const active = Object.values(s.reports).filter(r => r.exp > now).map(publicView);
  const cells = {};
  for (const r of active) (cells[cellId(r.lat, r.lng)] ||= []).push(r);
  const index = { v: s.v, t: now, n: active.length, cells: {}, ann: null, paused: s.paused && s.paused > now ? s.paused : 0 };
  for (const [id, list] of Object.entries(cells)) {
    const str = JSON.stringify({ r: list });
    index.cells[id] = h8(str);
    writeIfChanged(path.join(LIVE_DIR, 'c', id + '.json'), str);
  }
  // supprime les cases devenues vides
  for (const f of fs.readdirSync(path.join(LIVE_DIR, 'c'))) {
    if (f.endsWith('.json') && !index.cells[f.slice(0, -5)]) try { fs.unlinkSync(path.join(LIVE_DIR, 'c', f)); } catch {}
  }
  const allStr = JSON.stringify({ r: active.slice(0, 2000) });
  writeIfChanged(path.join(LIVE_DIR, 'all.json'), allStr);
  index.all = h8(allStr);
  const annStr = JSON.stringify({ a: Object.values(s.ann || {}).filter(a => a.exp > now).map(annView) });
  writeIfChanged(path.join(LIVE_DIR, 'ann.json'), annStr);
  index.ann = h8(annStr);
  const tmp = path.join(LIVE_DIR, 'index.json.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(index)); fs.renameSync(tmp, path.join(LIVE_DIR, 'index.json'));
}
// Au démarrage, et chaque minute si des signalements ont expiré : republier.
setTimeout(() => { try { mutate(() => {}); } catch {} }, 200);
setInterval(() => {
  const s = readState(), now = Date.now();
  if (Object.values(s.reports).some(r => r.exp <= now) || Object.values(s.ann || {}).some(a => a.exp <= now)) try { mutate(() => {}); } catch {}
}, 60_000).unref();

// ---- HTTP helpers ----
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2048) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// ---- Statique ----
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache' });
    res.end(buf);
  });
}

// ---- Proxy de tuiles : les IP des manifestant·es ne partent pas chez le fournisseur de carte ----
const tileCache = new Map(); const TILE_CACHE_MAX = 2000;
// Cache disque : une tuile téléchargée une fois est écrite dans tiles/z/x/y.png.
// Sur cPanel, Apache la sert ensuite directement, sans Node ni OpenStreetMap.
const TILE_DIR = process.env.TILE_DIR || path.join(__dirname, 'tiles');
const TILE_DISK = process.env.TILE_DISK !== '0';
const TILE_DAYS = Number(process.env.TILE_DAYS) || 30;
if (TILE_DISK) try {
  fs.mkdirSync(TILE_DIR, { recursive: true });
  fs.writeFileSync(path.join(TILE_DIR, '.htaccess'), ['Options -Indexes', '<IfModule mod_headers.c>', '  Header set Cache-Control "public, max-age=604800"', '</IfModule>', ''].join('\n'));
} catch {}
function pruneTiles() { // supprime les tuiles de plus de TILE_DAYS jours (la carte d'OSM évolue)
  const limit = Date.now() - TILE_DAYS * 24 * 60 * MIN;
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.png') && fs.statSync(p).mtimeMs < limit) try { fs.unlinkSync(p); } catch {}
  } };
  try { walk(TILE_DIR); } catch {}
}
if (TILE_DISK) setInterval(pruneTiles, 24 * 60 * MIN).unref();
function serveTile(res, z, x, y) {
  z = +z; x = +x; y = +y;
  if (!(z >= 0 && z <= 19 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z)) return send(res, 400, 'bad tile');
  const key = `${z}/${x}/${y}`;
  const out = buf => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(buf); };
  const hit = tileCache.get(key);
  if (hit) { tileCache.delete(key); tileCache.set(key, hit); return out(hit); }
  https.get(TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y), { headers: { 'User-Agent': TILE_UA } }, up => {
    if (up.statusCode !== 200) { up.resume(); return send(res, 502, 'tile upstream'); }
    const chunks = []; up.on('data', c => chunks.push(c));
    up.on('end', () => {
      const buf = Buffer.concat(chunks);
      tileCache.set(key, buf);
      if (TILE_DISK) {
        const dir = path.join(TILE_DIR, String(z), String(x));
        fs.mkdir(dir, { recursive: true }, () => {
          const tmp = path.join(dir, y + '.png.' + process.pid + '.tmp');
          fs.writeFile(tmp, buf, err => { if (!err) fs.rename(tmp, path.join(dir, y + '.png'), () => {}); });
        });
      }
      if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
      out(buf);
    });
  }).on('error', () => send(res, 502, 'tile upstream'));
}

// ---- Routes ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    if (req.method === 'GET' && pathname === '/api/config')
      return send(res, 200, { event: EVENT_NAME, center: CENTER, zoom: ZOOM, brand: BRAND, violenceUrl: VIOLENCE_URL, contact: CONTACT_EMAIL, hostInfo: HOST_INFO, sourceUrl: SOURCE_URL, categories: CATEGORIES, groups: GROUPS });

    // Vérification d'installation : ne renvoie jamais d'IP, seulement si un en-tête a été trouvé.
    if (req.method === 'GET' && pathname === '/api/health') {
      let writable = true; try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch { writable = false; }
      return send(res, 200, { ok: true, node: process.version, passenger: UNDER_PASSENGER, trustProxy: TRUST_PROXY,
        ipHeaderSeen: !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip']), storageWritable: writable, pid: process.pid });
    }

    if (req.method === 'GET' && pathname === '/api/reports') {
      // Zones demandées : jusqu'à 2 rectangles « s,w,n,e » (zone affichée + zone autour de soi, arrondies côté téléphone).
      const boxes = url.searchParams.getAll('bbox').slice(0, 2).map(b => b.split(',').map(Number))
        .filter(b => b.length === 4 && b.every(Number.isFinite));
      const s = readState(), now = Date.now();
      const inBox = r => !boxes.length || boxes.some(([so, w, n, e]) => r.lat >= so && r.lat <= n && r.lng >= w && r.lng <= e);
      const list = Object.values(s.reports).filter(r => r.exp > now && inBox(r)).slice(0, 1500).map(publicView);
      // Annonce visible si son cercle touche une des zones demandées
      const annIn = a => !boxes.length || boxes.some(([so, w, n, e]) => {
        const dLat = a.r / 111, dLng = a.r / (111 * Math.cos(a.lat * Math.PI / 180));
        return a.lat + dLat >= so && a.lat - dLat <= n && a.lng + dLng >= w && a.lng - dLng <= e;
      });
      const anns = Object.values(s.ann || {}).filter(a => a.exp > now && annIn(a)).map(annView);
      const etag = '"' + crypto.createHash('sha1').update(`${s.v || 0}|${list.length}|${anns.length}|${boxes.join(';')}`).digest('base64url').slice(0, 16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      return send(res, 200, { now, reports: list, announcements: anns }, { ETag: etag, 'Cache-Control': 'no-cache' });
    }

    if (req.method === 'GET' && pathname === '/api/geocode') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return send(res, 400, { error: 'Tape au moins 2 lettres.' });
      const data = await nominatim('/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=fr&q=' + encodeURIComponent(q));
      if (!data) return send(res, 502, { error: 'Recherche indisponible pour l’instant.' });
      return send(res, 200, data.map(d => ({ name: d.display_name.split(',').slice(0, 2).join(','), place: placeName(d.address),
        lat: +d.lat, lng: +d.lon, bbox: d.boundingbox && d.boundingbox.map(Number) })), { 'Cache-Control': 'public, max-age=86400' });
    }

    // ---- Admin : gestion des orgas ----
    if (pathname.startsWith('/api/admin/')) {
      if (!ADMIN_KEY) return send(res, 404, { error: 'Admin désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
      if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
      if (req.method === 'GET' && pathname === '/api/admin/orgas') {
        return send(res, 200, {
          orgas: readOrgas().map(({ id, label, created }) => ({ id, label, created, source: 'page' }))
            .concat(ORGAS.map(o => ({ id: null, label: o.label, created: null, source: 'variable' }))),
        });
      }
      if (req.method === 'POST' && pathname === '/api/admin/orgas') {
        const b = await readJson(req);
        const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
        if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga (il sera affiché sur ses annonces).' });
        const key = crypto.randomBytes(18).toString('base64url');
        const out = withLock(() => {
          const list = readOrgas().slice();
          if (list.some(o => o.label.toLowerCase() === label.toLowerCase())) return null;
          const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: sha(key), created: Date.now() };
          list.push(o); writeOrgas(list); return o;
        });
        if (!out) return send(res, 409, { error: 'Une orga porte déjà ce nom.' });
        return send(res, 201, { id: out.id, label: out.label, created: out.created, key });
      }
      // --- Urgences : liste, suppression, purge, pause ---
      if (req.method === 'GET' && pathname === '/api/admin/reports') {
        const st = readState(), now = Date.now();
        return send(res, 200, { paused: st.paused && st.paused > now ? st.paused : 0,
          reports: Object.values(st.reports).filter(r => r.exp > now).sort((a, b) => b.t - a.t).map(publicView),
          announcements: Object.values(st.ann || {}).filter(a => a.exp > now).map(annView) });
      }
      const delRep = pathname.match(/^\/api\/admin\/reports\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delRep) {
        const ok = mutate(st => { const r = st.reports[delRep[1]]; if (!r) return false; archive(r, true); delete st.reports[r.id]; return true; });
        return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Déjà expiré.' });
      }
      if (req.method === 'POST' && pathname === '/api/admin/purge') {
        const b = await readJson(req);
        const n = mutate(st => {
          const list = Object.values(st.reports); list.forEach(r => archive(r, true)); st.reports = {};
          if (b.announcements) st.ann = {};
          return list.length;
        });
        return send(res, 200, { removed: n });
      }
      if (req.method === 'POST' && pathname === '/api/admin/pause') {
        const b = await readJson(req);
        const minutes = Math.min(Math.max(Number(b.minutes) || 0, 0), 24 * 60);
        const until = mutate((st, now) => (st.paused = minutes ? now + minutes * MIN : 0));
        return send(res, 200, { paused: until });
      }

      const del = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && del) {
        const ok = withLock(() => {
          const list = readOrgas(); const next = list.filter(o => o.id !== del[1]);
          if (next.length === list.length) return false; writeOrgas(next); return true;
        });
        return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Orga introuvable.' });
      }
      return send(res, 404, { error: 'Inconnu.' });
    }

    if (req.method === 'GET' && pathname === '/api/digest') {
      if (!ADMIN_KEY) return send(res, 404, { error: 'Digest désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
      if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
      const date = String(url.searchParams.get('date') || parisDay(Date.now()));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Date invalide.' });
      mutate(() => {}); // archive ce qui vient d'expirer
      let rows = [];
      try { rows = fs.readFileSync(path.join(ARCHIVE_DIR, date + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
      // + les signalements encore actifs de ce jour
      for (const r of Object.values(readState().reports)) if (parisDay(r.t) === date)
        rows.push({ c: r.cat, t: r.t, lat: Math.round(r.lat * 1e3) / 1e3, lng: Math.round(r.lng * 1e3) / 1e3, up: r.up, d: 0, active: 1 });
      const kept = rows.filter(r => !r.d);
      const byCat = {}, first = {}, byHour = Array(24).fill(0), zones = new Map();
      for (const r of kept) {
        byCat[r.c] = (byCat[r.c] || 0) + 1;
        if (!first[r.c] || r.t < first[r.c]) first[r.c] = r.t;
        byHour[parisHour(r.t)]++;
        const zk = (Math.round(r.lat * 10) / 10) + ',' + (Math.round(r.lng * 10) / 10);
        const z = zones.get(zk) || { lat: Math.round(r.lat * 10) / 10, lng: Math.round(r.lng * 10) / 10, total: 0, byCat: {} };
        z.total++; z.byCat[r.c] = (z.byCat[r.c] || 0) + 1; zones.set(zk, z);
      }
      const top = [...zones.values()].sort((a, b) => b.total - a.total).slice(0, 12);
      for (const z of top) {
        const d = await nominatim(`/reverse?format=jsonv2&zoom=10&lat=${z.lat}&lon=${z.lng}`);
        z.name = placeName(d && d.address) || `${z.lat}, ${z.lng}`;
      }
      return send(res, 200, { date, total: kept.length, dismissed: rows.length - kept.length, confirmed: kept.filter(r => r.up > 0).length,
        byCat, first, byHour, zones: top, verified: kept.filter(r => r.v).length, categories: CATEGORIES.map(({ id, label, glyph, group }) => ({ id, label, glyph, group })),
        days: fs.readdirSync(ARCHIVE_DIR).map(f => f.slice(0, 10)).sort().reverse() });
    }

    if (req.method === 'POST' && pathname === '/api/reports') {
      const b = await readJson(req);
      const cat = CAT[b.cat];
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!cat) return send(res, 400, { error: 'Catégorie inconnue.' });
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
      const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX);
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = mutate((s, now) => {
        if (s.paused && s.paused > now) return [503, { error: 'Les signalements sont en pause quelques minutes (afflux de faux signalements). Réessaie bientôt.' }];
        if (!allow(s, dev, ipH, 'report', now)) return [429, { error: 'Trop de signalements d’un coup. Réessaie dans quelques minutes.' }];
        if (Object.keys(s.reports).length >= MAX_REPORTS) return [503, { error: 'Carte saturée, réessaie plus tard.' }];
        const r = { id: crypto.randomBytes(6).toString('base64url'), cat: cat.id, lat: round(lat), lng: round(lng), note,
          t: now, exp: now + cat.ttl * MIN, up: 0, down: 0, voters: [dev], downIps: [] };
        s.reports[r.id] = r;
        return [201, publicView(r)];
      });
      return send(res, ...result);
    }

    const vote = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/vote$/);
    if (req.method === 'POST' && vote) {
      const b = await readJson(req);
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = mutate((s, now) => {
        const r = s.reports[vote[1]];
        if (!r) return [404, { error: 'Signalement expiré.' }];
        if (r.voters.includes(dev)) return [409, { error: 'Déjà pris en compte.' }];
        if (!allow(s, dev, ipH, 'vote', now)) return [429, { error: 'Trop de votes, patiente un peu.' }];
        r.voters.push(dev);
        if (b.v === 1) {
          r.up++;
          const ttl = CAT[r.cat].ttl * MIN;
          r.exp = Math.min(Math.max(r.exp, now + ttl), r.t + 4 * ttl); // prolonge, plafonné à 4× la durée de base
        } else {
          r.down++;
          (r.downIps ||= []).push(ipH);
          // Retrait : au moins 2 « Plus là » venant de 2 réseaux différents, plus nombreux que les « Toujours là ».
          // Un signalement vérifié par une orga ne peut pas être retiré par les votes.
          if (!r.ver && r.down >= 2 && new Set(r.downIps).size >= 2 && r.down > r.up) { archive(r, true); delete s.reports[r.id]; return [200, { removed: true }]; }
        }
        return [200, publicView(r)];
      });
      return send(res, ...result);
    }


    // ---- Espace orga / legal team ----
    if (pathname.startsWith('/api/orga') || pathname.startsWith('/api/announcements') || /^\/api\/reports\/[\w-]{1,16}\/(verify|remove)$/.test(pathname)) {
      const orga = orgaOf(req);
      if (!orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });

      if (req.method === 'GET' && pathname === '/api/orga/me') return send(res, 200, { label: orga.label, admin: orga.admin });

      if (req.method === 'POST' && pathname === '/api/announcements') {
        const b = await readJson(req);
        const kind = b.kind === 'legal' ? 'legal' : 'info';
        const level = b.level === 'urgent' ? 'urgent' : 'info';
        const text = String(b.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, ANN_MAX);
        const phone = kind === 'legal' ? String(b.phone || '').replace(/[^\d+ .]/g, '').trim().slice(0, 20) : '';
        const lat = Number(b.lat), lng = Number(b.lng);
        const r = Math.min(Math.max(Number(b.radiusKm) || 3, 0.5), 50);
        const minutes = Math.min(Math.max(Number(b.minutes) || 60, 10), 24 * 60);
        if (kind === 'info' && text.length < 3) return send(res, 400, { error: 'Écris le message de l’annonce.' });
        if (kind === 'legal' && phone.replace(/\D/g, '').length < 6) return send(res, 400, { error: 'Numéro de téléphone invalide.' });
        if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
        const a = mutate((s, now) => {
          const a = { id: crypto.randomBytes(6).toString('base64url'), kind, level: kind === 'legal' ? 'info' : level, text, phone,
            by: orga.label, lat: round(lat), lng: round(lng), r, t: now, exp: now + minutes * MIN };
          s.ann[a.id] = a; return a;
        });
        return send(res, 201, annView(a));
      }

      const delAnn = pathname.match(/^\/api\/announcements\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delAnn) {
        const out = mutate(s => {
          const a = s.ann[delAnn[1]];
          if (!a) return [404, { error: 'Annonce déjà retirée.' }];
          if (!orga.admin && a.by !== orga.label) return [403, { error: 'Seul·e l’auteur·ice peut retirer cette annonce.' }];
          delete s.ann[a.id]; return [200, { removed: true }];
        });
        return send(res, ...out);
      }

      const act = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(verify|remove)$/);
      if (req.method === 'POST' && act) {
        const out = mutate(s => {
          const r = s.reports[act[1]];
          if (!r) return [404, { error: 'Signalement expiré.' }];
          if (act[2] === 'verify') { r.ver = orga.label; return [200, publicView(r)]; }
          archive(r, true); delete s.reports[r.id]; return [200, { removed: true }];
        });
        return send(res, ...out);
      }
      return send(res, 404, { error: 'Inconnu.' });
    }

    const tile = pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (req.method === 'GET' && tile) {
      // Hors cPanel (pas d'Apache devant), Node sert lui-même la tuile déjà sur disque
      const f = path.join(TILE_DIR, tile[1], tile[2], tile[3] + '.png');
      if (TILE_DISK) try { const buf = fs.readFileSync(f); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' }); return res.end(buf); } catch {}
      return serveTile(res, tile[1], tile[2], tile[3]);
    }

    // Fichiers live/ : servis par Apache sur cPanel ; Node ne les sert que s'il est seul (VPS, local).
    const live = pathname.match(/^\/live\/((?:c\/)?[\w-]{1,40}\.json)$/);
    if (req.method === 'GET' && live) {
      const f = path.join(LIVE_DIR, live[1]);
      if (live[1] === 'index.json' && !fs.existsSync(f)) try { mutate(() => {}); } catch {}
      fs.readFile(f, (err, buf) => {
        if (err) return send(res, 200, live[1].startsWith('c/') ? { r: [] } : {}, { 'Cache-Control': 'no-cache' });
        const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"';
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag }); res.end(buf);
      });
      return;
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    send(res, 405, 'Method not allowed');
  } catch (e) {
    send(res, e.message === 'busy' ? 503 : 400, { error: e.message === 'busy' ? 'Serveur occupé, réessaie.' : 'Requête invalide.' });
  }
});

server.listen(PORT, () => console.log(`Cortège en écoute — ${EVENT_NAME} — données : ${DATA_DIR}`));
