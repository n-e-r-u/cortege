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
// Accès admin ; vide = admin désactivé. Une clé trop courte est refusée (elle se devinerait).
const ADMIN_KEY = (k => {
  if (k && k.length < 12) { console.error('ADMIN_KEY trop courte (12 caractères minimum) : administration désactivée.'); return ''; }
  return k;
})(process.env.ADMIN_KEY || '');
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
  kofi: process.env.BRAND_KOFI || 'https://ko-fi.com/neru', // soutien : faire durer l'appli, renforcer le serveur
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
  { id: 'calme',          group: 'soutien', label: 'Zone calme / repli',      glyph: '🕊️', ttl: 90 },
  { id: 'eau',            group: 'soutien', label: 'Eau / sérum phy',         glyph: '💧', ttl: 90 },
  { id: 'cortege',        group: 'info',    label: 'Tête de cortège',         glyph: '📣', ttl: 15 },
  { id: 'bloque',         group: 'info',    label: 'Rue bloquée',             glyph: '⛔', ttl: 30 },
  { id: 'blocus',         group: 'info',    label: 'Blocus (lycée / fac)',    glyph: '🚧', ttl: 180 },
];
// Agenda : types d'événements publiés par les orgas (ou proposés puis validés par l'admin)
const EVENT_TYPES = [
  { id: 'manif',         label: 'Manifestation',        glyph: '✊' },
  { id: 'blocus',        label: 'Blocus (lycée / fac)', glyph: '🚧' },
  { id: 'rassemblement', label: 'Rassemblement',        glyph: '📍' },
  { id: 'ag',            label: 'Assemblée générale',   glyph: '🗣️' },
];
const EVT = Object.fromEntries(EVENT_TYPES.map(e => [e.id, e]));
const ADMIN_LABEL = process.env.ADMIN_LABEL || 'Cortège';   // nom affiché sur les annonces de l'admin
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://cortege.neru.tv';
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
// Fusion : un signalement du même type dans ce rayon (m) confirme le point existant au lieu d'en créer un.
// « move » : le point glisse vers le signalement le plus récent (unités qui se déplacent).
const MERGE = {
  crs: { r: 100, move: true }, police: { r: 100, move: true }, bac: { r: 100, move: true }, canon: { r: 100, move: true },
  nasse: { r: 150 }, interpellation: { r: 80 }, lacrymo: { r: 150 }, charge: { r: 80 }, chaud: { r: 100 }, sommations: { r: 150 },
  medic: { r: 40 }, legal: { r: 40 }, presse: { r: 40 }, eau: { r: 40 }, calme: { r: 80 },
  cortege: { r: 200, move: true }, bloque: { r: 30 }, blocus: { r: 100 },
};
// Un danger actif à moins de 100 m d’une « zone calme » la suspend (affichage sur le téléphone) et empêche d’en créer une.
const CALM_KILL_M = 100;
const isDanger = cat => Object.hasOwn(CAT, cat) && (CAT[cat].group === 'fdo' || CAT[cat].group === 'danger');
const distM = (a, b) => {
  const k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
};
// Points actifs d'une catégorie autour d'une position (pré-filtre par carré, puis distance réelle)
function nearby(cat, lat, lng, m, now) {
  const dLat = m / 111000, dLng = m / (111000 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return q('SELECT * FROM reports WHERE cat=? AND exp>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?')
    .all(cat, now, lat - dLat, lat + dLat, lng - dLng, lng + dLng)
    .map(r => ({ r, d: distM({ lat, lng }, r) })).filter(x => x.d <= m).sort((a, b) => a.d - b.d);
}
const GROUPS = [
  { id: 'fdo', label: 'Forces de l’ordre' },
  { id: 'danger', label: 'Danger' },
  { id: 'soutien', label: 'Soutien' },
  { id: 'info', label: 'Infos cortège' },
];

const MIN = 60_000;
// Plafonds de signalements actifs. Ils sont pensés par zone (~5 km) : une attaque ne peut saturer
// qu'un secteur, jamais toute la France, et les vrais signalements y entrent quand même.
const MAX_REPORTS = Number(process.env.MAX_REPORTS) || 200000; // garde-fou technique, toute la France
const MAX_PER_ZONE = Number(process.env.MAX_PER_ZONE) || 300;  // par zone ; au-delà, les plus anciens non confirmés sortent
const MAX_PER_NET_ZONE = 25;                                    // par réseau et par zone
const NOTE_MAX = 120;
const ANN_MAX = 220;
// Limites sur 5 min. En 4G/5G, des centaines d'abonnés partagent la même IP : la limite fine est donc
// par téléphone (identifiant anonyme tiré au hasard sur l'appareil), avec un plafond large par IP.
const RATE = { windowMs: 5 * MIN, maxReports: 8, maxVotes: 40, ipReports: 120, ipVotes: 800 }; // par IP : large, car des milliers de téléphones partagent parfois une IP d’opérateur (CGNAT)

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
// IP du téléphone, seulement pour l'anti-spam (jamais stockée en clair).
// - Derrière un CDN : en-tête CF-Connecting-IP (sinon tout le monde aurait l'IP du CDN
//   et l'anti-spam bloquerait des foules entières).
// - Sinon : dernière adresse publique de X-Forwarded-For, celle ajoutée par le proxy de l'hébergeur ;
//   les premières peuvent être inventées par le client pour contourner les limites.
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(10\.|127\.|192\.168\.))/i;
function clientIp(req) {
  if (TRUST_PROXY) {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const pub = hops.filter(h => !PRIVATE_IP.test(h));
    if (pub.length) return pub[pub.length - 1];
    if (hops.length) return hops[hops.length - 1];
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  }
  return req.socket.remoteAddress || '';
}
function clientHash(req) {
  const ip = clientIp(req);
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
// Clés admin / orga : au-delà de 10 essais ratés en 5 min depuis un même réseau, tout est refusé,
// même la bonne clé (empêche de deviner une clé en essayant en boucle).
const KEY_TRIES = 10;
const keySlot = req => 'key:' + clientHash(req);
function keyLocked(req) {
  try { const r = q('SELECT t, reports FROM rate WHERE k=?').get(keySlot(req)); return !!r && Date.now() - r.t <= RATE.windowMs && r.reports >= KEY_TRIES; }
  catch { return false; }
}
function keyFailed(req) { try { bump(keySlot(req), 'report', Infinity, Date.now()); } catch {} }
function isAdmin(req) {
  const k = String(req.headers['x-admin-key'] || '');
  if (!ADMIN_KEY || !k || keyLocked(req)) return false;
  if (keyEq(k, ADMIN_KEY)) return true;
  keyFailed(req); return false;
}
function orgaOf(req) {
  const k = String(req.headers['x-orga-key'] || '');
  if (!k || keyLocked(req)) return null;
  if (ADMIN_KEY && keyEq(k, ADMIN_KEY)) return { id: 'admin', label: ADMIN_LABEL, admin: true, trial: false };
  const env = ORGAS.find(o => keyEq(k, o.key));
  if (env) return { id: 'env:' + env.label, label: env.label, admin: false, trial: false };
  const h = sha(k);
  const o = readOrgas().find(o => keyEq(h, o.hash));
  // Période d'essai : seules les orgas créées depuis cette version la commencent (trial: true)
  if (o) return { id: o.id, label: o.label, admin: false, trial: o.trial === true };
  keyFailed(req); return null;
}
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const e = Date.now() + ms; while (Date.now() < e); } };
function withLock(fn, lockFile = LOCK_FILE) {
  let fd;
  for (let i = 0; ; i++) {
    try { fd = fs.openSync(lockFile, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lockFile).mtimeMs > 3000) fs.unlinkSync(lockFile); } catch {}
      if (i > 300) throw new Error('busy');
      sleep(10);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lockFile); } catch {} }
}

// ---- Base de données : SQLite intégré à Node (22.13 ou plus), en mode WAL ----
// Chaque action n'écrit que sa propre ligne, et plusieurs processus Passenger écrivent sans se bloquer.
{
  const emit = process.emitWarning;
  process.emitWarning = function (w, ...rest) { if (/sqlite/i.test(String((w && w.message) || w))) return; return emit.call(process, w, ...rest); };
}
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch { console.error('Cortège a besoin de Node 22.13 ou plus récent (module node:sqlite) : choisis Node 24 dans cPanel.'); process.exit(1); }
const DB_FILE = path.join(DATA_DIR, 'cortege.db');
const db = new DatabaseSync(DB_FILE);
// Plusieurs processus démarrent parfois en même temps : on attend que la base soit libre (8 s max par opération).
db.exec('PRAGMA busy_timeout=8000');
for (let i = 0; ; i++) {
  try { db.exec('PRAGMA journal_mode=WAL'); break; }
  catch (e) { if (i > 50 || !/locked|busy/i.test(e.message)) throw e; sleep(100); }
}
db.exec(`PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, cat TEXT NOT NULL, lat REAL, lng REAL, cell TEXT, note TEXT, t INTEGER, exp INTEGER,
    up INTEGER DEFAULT 0, down INTEGER DEFAULT 0, ver TEXT, voters TEXT DEFAULT '[]', down_ips TEXT DEFAULT '[]');
  CREATE INDEX IF NOT EXISTS reports_cell ON reports(cell);
  CREATE INDEX IF NOT EXISTS reports_exp ON reports(exp);
  CREATE TABLE IF NOT EXISTS ann(id TEXT PRIMARY KEY, exp INTEGER, data TEXT);
  CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, status TEXT, src TEXT, start INTEGER, dev TEXT, data TEXT);
  CREATE TABLE IF NOT EXISTS rate(k TEXT PRIMARY KEY, t INTEGER, reports INTEGER DEFAULT 0, votes INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS hidden(id TEXT PRIMARY KEY, until INTEGER);
  CREATE TABLE IF NOT EXISTS cells(cell TEXT PRIMARY KEY, region TEXT, h TEXT);
  CREATE INDEX IF NOT EXISTS cells_region ON cells(region);
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`);
for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) try { fs.chmodSync(f, 0o600); } catch {}
const stmts = new Map();
const q = sql => { let st = stmts.get(sql); if (!st) stmts.set(sql, (st = db.prepare(sql))); return st; };
const isBusy = e => e && (e.message === 'busy' || /locked|busy/i.test(e.message || ''));
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
const getMeta = k => q('SELECT v FROM meta WHERE k=?').get(k)?.v;
const setMeta = (k, v) => q('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
const pausedUntil = now => { const p = Number(getMeta('paused') || 0); return p > now ? p : 0; };

// Signalements
// Empreinte du réseau de l'auteur (même HMAC tournant que l'anti-spam), effacée avec le signalement.
try { db.exec('ALTER TABLE reports ADD COLUMN ip TEXT'); } catch {}
// Heure de la dernière confirmation ou du dernier signalement fusionné
try { db.exec('ALTER TABLE reports ADD COLUMN last INTEGER'); } catch {}
// Précisions écrites (les 3 plus récentes, une par téléphone) : [{ x: texte, t: heure, d: empreinte du téléphone }]
try { db.exec("ALTER TABLE reports ADD COLUMN notes TEXT DEFAULT '[]'"); } catch {}
// « Plus là » pondérés (dw) et heure à laquelle le point est devenu contesté (ct)
try { db.exec('ALTER TABLE reports ADD COLUMN dw INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE reports ADD COLUMN ct INTEGER DEFAULT 0'); } catch {}
// Depuis quand le serveur voit chaque téléphone (empreinte seulement), oublié 48 h après sa dernière action.
// Sert à ne pas compter les « Plus là » d'un identifiant tout juste créé.
db.exec('CREATE TABLE IF NOT EXISTS devices(h TEXT PRIMARY KEY, first INTEGER, seen INTEGER)');
db.exec('CREATE INDEX IF NOT EXISTS reports_cell_ip ON reports(cell, ip)');
db.exec('CREATE INDEX IF NOT EXISTS reports_cat_lat ON reports(cat, lat)');
// ---- Journal des actions d'orgas (60 jours) et corbeille des retraits (1 h) ----
// Journal : heure, orga, action, type de signalement, position arrondie à ~100 m. Jamais d'IP.
db.exec(`CREATE TABLE IF NOT EXISTS orga_log(id INTEGER PRIMARY KEY, t INTEGER, oid TEXT, orga TEXT, action TEXT, cat TEXT, lat REAL, lng REAL, ref TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS orga_log_t ON orga_log(t);
  CREATE INDEX IF NOT EXISTS orga_log_oid ON orga_log(oid, t);
  CREATE TABLE IF NOT EXISTS trash(id TEXT PRIMARY KEY, t INTEGER, oid TEXT, orga TEXT, data TEXT);`);
const TRASH_MS = 60 * 60_000;
const ORGA_REMOVE_MAX = Number(process.env.ORGA_REMOVE_MAX) || 15; // retraits par orga et par 5 min
function orgaLog(orga, action, { r, lat, lng, ref, detail } = {}) {
  const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);
  try {
    q('INSERT INTO orga_log(t,oid,orga,action,cat,lat,lng,ref,detail) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), orga.id || null, orga.label, action, r ? r.cat : null, r3(r ? r.lat : lat), r3(r ? r.lng : lng), ref || (r ? r.id : null), detail ? String(detail).slice(0, 200) : null);
  } catch (e) { console.error('journal', e.message); }
}
// Un point retiré par une orga reste restaurable une heure par l'admin
function trashReport(r, orga) {
  const now = Date.now();
  q('INSERT OR REPLACE INTO trash(id,t,oid,orga,data) VALUES(?,?,?,?,?)').run(r.id, now, orga.id || null, orga.label, JSON.stringify({ ...r, left: r.exp - now }));
  dropReport(r.id, true);
}
function orgaStats(oid) {
  const since = Date.now() - 24 * 60 * MIN;
  const rows = q('SELECT action, COUNT(*) n, MAX(t) last FROM orga_log WHERE oid=? AND t>? GROUP BY action').all(oid, since);
  const by = Object.fromEntries(rows.map(x => [x.action, x.n]));
  return { day: { verified: by['vérifié'] || 0, removed: (by['retiré'] || 0) + (by['retrait (essai)'] || 0), blocked: by['retrait bloqué (rafale)'] || 0,
    announcements: (by['annonce'] || 0) + (by['legal team (en attente)'] || 0) }, lastAction: rows.reduce((m, x) => Math.max(m, x.last), 0) || null };
}
const parseNotes = r => { let n = []; try { n = JSON.parse(r.notes || '[]'); } catch {} return n.length || !r.note ? n : [{ x: r.note, t: r.t }]; };
const toReport = r => r && ({ id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note, notes: parseNotes(r), t: r.t, exp: r.exp, up: r.up, down: r.down,
  dw: r.dw || 0, ct: r.ct || 0, ver: r.ver || null, voters: JSON.parse(r.voters || '[]'), downIps: JSON.parse(r.down_ips || '[]'), last: r.last || r.t, cell: r.cell });
const getReport = (id, now) => toReport(q('SELECT * FROM reports WHERE id=? AND exp>?').get(id, now));
const activeReports = (now, limit = 2000) => q('SELECT * FROM reports WHERE exp>? ORDER BY t DESC LIMIT ?').all(now, limit);
function saveReport(r) {
  const cell = cellId(r.lat, r.lng);
  if (r.cell && r.cell !== cell) dirtyCell(r.cell); // le point a glissé dans une autre case
  const notes = (r.notes || (r.note ? [{ x: r.note, t: r.t }] : [])).slice(0, NOTES_KEEP);
  r.note = notes[0] ? notes[0].x : ''; // la plus récente, pour les téléphones pas encore à jour
  q(`INSERT INTO reports(id,cat,lat,lng,cell,note,t,exp,up,down,ver,voters,down_ips,ip,last,notes,dw,ct) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, cell=excluded.cell, note=excluded.note, notes=excluded.notes, exp=excluded.exp, up=excluded.up,
       down=excluded.down, ver=excluded.ver, voters=excluded.voters, down_ips=excluded.down_ips, last=excluded.last, dw=excluded.dw, ct=excluded.ct`)
    .run(r.id, r.cat, r.lat, r.lng, cell, r.note || '', r.t, r.exp, r.up || 0, r.down || 0, r.ver || null,
      JSON.stringify((r.voters || []).slice(-500)), JSON.stringify((r.downIps || []).slice(-100)), r.ip || null, r.last || r.t, JSON.stringify(notes), r.dw || 0, r.ct || 0);
  dirtyCell(cell);
}
function dropReport(id, dismissed) {
  const r = q('DELETE FROM reports WHERE id=? RETURNING *').get(id);
  if (r) { archive(r, dismissed); dirtyCell(r.cell); }
  return !!r;
}
// Annonces
const annAll = now => q('SELECT data FROM ann WHERE exp>? ORDER BY rowid').all(now).map(x => JSON.parse(x.data));
const annActive = now => annAll(now).filter(a => !a.pending);
const getAnn = id => { const x = q('SELECT data FROM ann WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveAnn(a) { q('INSERT OR REPLACE INTO ann(id,exp,data) VALUES(?,?,?)').run(a.id, a.exp, JSON.stringify(a)); dirty.ann = true; scheduleFlush(); }
function dropAnn(id) { const n = q('DELETE FROM ann WHERE id=?').run(id).changes; if (n) { dirty.ann = true; scheduleFlush(); } return n > 0; }
// Agenda
const getEvent = id => { const x = q('SELECT data FROM events WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
const listEvents = () => q('SELECT data FROM events ORDER BY start').all().map(x => JSON.parse(x.data));
function saveEvent(e) {
  q('INSERT OR REPLACE INTO events(id,status,src,start,dev,data) VALUES(?,?,?,?,?,?)').run(e.id, e.status, e.src || null, e.start, e.dev || null, JSON.stringify(e));
  dirty.events = true; scheduleFlush();
}
function dropEvent(id) { const n = q('DELETE FROM events WHERE id=?').run(id).changes; if (n) { dirty.events = true; scheduleFlush(); } return n > 0; }

// Limites anti-spam, sur 5 min
function bump(key, kind, max, now) {
  let r = q('SELECT t, reports, votes FROM rate WHERE k=?').get(key);
  r = !r || now - r.t > RATE.windowMs ? { t: now, reports: 0, votes: 0 } : { t: r.t, reports: r.reports, votes: r.votes };
  if (r[kind + 's'] >= max) return false;
  r[kind + 's']++;
  q('INSERT INTO rate(k,t,reports,votes) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET t=excluded.t, reports=excluded.reports, votes=excluded.votes')
    .run(key, r.t, r.reports, r.votes);
  return true;
}
// Vrai si ce téléphone ET cette IP sont sous leurs limites.
function allow(dev, ip, kind, now) {
  const rep = kind === 'report', cur = q('SELECT t, reports, votes FROM rate WHERE k=?').get('ip:' + ip);
  if (cur && now - cur.t <= RATE.windowMs && cur[kind + 's'] >= (rep ? RATE.ipReports : RATE.ipVotes)) return false;
  if (!bump(dev, kind, rep ? RATE.maxReports : RATE.maxVotes, now)) return false;
  bump('ip:' + ip, kind, Infinity, now);
  return true;
}
// ---- « Plus là » : un point n'est jamais effacé par des votes, il devient « contesté » ----
// Contesté = grisé, et il ne lui reste que quelques minutes ; une confirmation le remet en état normal.
// Poids d'un « Plus là » : ×2 si le téléphone dit être sur place (calcul fait sur le téléphone, la position
// ne part jamais), ×2 si l'identifiant n'est pas tout neuf. Il en faut davantage pour chaque confirmation.
const CONTEST = { near: 2, aged: 2, need: 8, perUp: 4, more: 8, soft: 10 * MIN, short: 2 * MIN, newDev: 10 * MIN,
  devKeep: 48 * 60 * MIN, devBurst: 6, netBurst: 60 };
const VOTES = { id: 'votes', label: 'Votes « Plus là »' };
// Âge de l'identifiant du téléphone (0 si inconnu ou sans identifiant), et note qu'il vient d'agir
function deviceAge(dev, now) {
  if (!dev.startsWith('d:')) return 0;
  const row = q('SELECT first FROM devices WHERE h=?').get(dev);
  q('INSERT INTO devices(h,first,seen) VALUES(?,?,?) ON CONFLICT(h) DO UPDATE SET seen=excluded.seen').run(dev, now, now);
  return row ? now - row.first : 0;
}
const contestNeed = r => CONTEST.need + CONTEST.perUp * (r.up || 0);
// Copie du point tel qu'il était avant d'être contesté : l'admin peut le remettre pendant 1 h
function snapshotContested(r, now) {
  q('INSERT OR REPLACE INTO trash(id,t,oid,orga,data) VALUES(?,?,?,?,?)').run(r.id, now, VOTES.id, VOTES.label, JSON.stringify({ ...r, left: r.exp - now }));
}

// Ménage toutes les 30 s : signalements, annonces et événements expirés, limites périmées, fin de pause.
function sweep() {
  const now = Date.now();
  try {
    const expired = tx(() => q('DELETE FROM reports WHERE exp<=? RETURNING *').all(now));
    for (const r of expired) { archive(r, !!r.ct); dirtyCell(r.cell); }
    if (q('DELETE FROM ann WHERE exp<=?').run(now).changes) dirty.ann = true;
    if (q('DELETE FROM events WHERE start<=?').run(now - EVENT_KEEP).changes) dirty.events = true;
    q('DELETE FROM rate WHERE t<?').run(now - RATE.windowMs);
    q('DELETE FROM hidden WHERE until<?').run(now);
    q('DELETE FROM trash WHERE t<?').run(now - TRASH_MS);
    q('DELETE FROM devices WHERE seen<?').run(now - CONTEST.devKeep);
    q('DELETE FROM orga_log WHERE t<?').run(now - ARCHIVE_DAYS * 24 * 60 * MIN);
    const p = Number(getMeta('paused') || 0);
    if (p && p <= now) { setMeta('paused', 0); dirty.global = true; }
    if (expired.length || dirty.ann || dirty.events || dirty.global) scheduleFlush(0);
  } catch (e) { if (!isBusy(e)) console.error('ménage', e.message); }
}
setInterval(sweep, 30_000).unref();
const NOTES_KEEP = 3;
// Ajoute (ou remplace) la précision d'un téléphone sur un point ; les plus récentes d'abord
function addNote(r, text, dev, t) {
  const notes = (r.notes || []).filter(n => n.d !== dev && n.x.toLowerCase() !== text.toLowerCase());
  r.notes = [{ x: text, t, d: dev }, ...notes].slice(0, NOTES_KEEP);
}
const publicView = r => ({ id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note,
  notes: (Array.isArray(r.notes) ? r.notes : parseNotes(r)).map(n => ({ x: n.x, t: n.t })), t: r.t, last: r.last || r.t, exp: r.exp, up: r.up, down: r.down, ver: r.ver || null, ...(r.ct ? { c: 1 } : {}) });
const annView = a => ({ id: a.id, kind: a.kind, level: a.level, text: a.text, phone: a.phone || null, by: a.by, lat: a.lat, lng: a.lng, r: a.r,
  national: !!a.national, permanent: !!a.permanent, link: a.link || null, t: a.t, exp: a.exp, ...(a.pending ? { pending: true } : {}) });
const evView = e => ({ id: e.id, type: e.type, title: e.title, place: e.place, note: e.note, start: e.start, lat: e.lat, lng: e.lng,
  route: e.route || null, end: !!e.end, by: e.by, status: e.status, link: e.link || null, src: e.src || null, t: e.t });
const round = n => Math.round(n * 1e4) / 1e4; // ~11 m
const EVENT_KEEP = 12 * 60 * MIN;  // un événement reste affiché 12 h après son début
const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const validLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
function distKm(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Création d'annonce, partagée par l'espace orga et la page admin.
//  - numéro de legal team : permanent, jusqu'à ce que l'orga (ou l'admin) le retire ;
//  - annonce nationale : réservée à l'admin, visible partout en France.
function createAnnouncement(b, by, admin, pending = false) {
  const kind = b.kind === 'legal' ? 'legal' : 'info';
  const national = kind === 'info' && !!b.national && admin;
  const level = kind === 'info' && b.level === 'urgent' ? 'urgent' : 'info';
  const text = clean(b.text, ANN_MAX);
  // Lien « En savoir plus » : réservé à l'admin (évite les liens piégés)
  const link = admin && kind === 'info' && /^https:\/\/[^\s"<>]{4,300}$/.test(String(b.link || '').trim()) ? String(b.link).trim() : '';
  const phone = kind === 'legal' ? String(b.phone || '').replace(/[^\d+ .]/g, '').trim().slice(0, 20) : '';
  const lat = Number(b.lat), lng = Number(b.lng);
  const r = national ? 0 : Math.min(Math.max(Number(b.radiusKm) || 3, 0.5), 50);
  const minutes = Math.min(Math.max(Number(b.minutes) || 60, 10), 24 * 60);
  if (kind === 'info' && text.length < 3) return [400, { error: 'Écris le message de l’annonce.' }];
  if (kind === 'legal' && phone.replace(/\D/g, '').length < 6) return [400, { error: 'Numéro de téléphone invalide.' }];
  if (!national && !validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  const now = Date.now();
  const a = { id: crypto.randomBytes(6).toString('base64url'), kind, level, text, phone, by, link,
    lat: national ? CENTER[0] : round(lat), lng: national ? CENTER[1] : round(lng), r, national, permanent: kind === 'legal',
    t: now, exp: kind === 'legal' ? now + 3650 * 24 * 60 * MIN : now + minutes * MIN };
  if (pending) a.pending = true; // numéro de legal team d'une orga en essai : affiché après validation par l'admin
  saveAnn(a);
  if (a.level === 'urgent' && !a.pending) pushBroadcast(a).catch(e => console.error('push', e.message));
  return [201, annView(a)];
}


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
let geoPending = 0;
const GEO_QUEUE_MAX = 20; // au-delà, on répond « réessaie » plutôt que d'empiler (1 requête/s chez Nominatim)
function nominatim(pathAndQuery) {
  if (geoCache.has(pathAndQuery)) return Promise.resolve(geoCache.get(pathAndQuery));
  if (geoPending >= GEO_QUEUE_MAX) return Promise.resolve(null);
  geoPending++;
  // Politique Nominatim : 1 requête par seconde maximum
  const run = () => new Promise(resolve => {
    const wait = Math.max(0, geoLast + 1100 - Date.now());
    setTimeout(() => {
      geoLast = Date.now();
      const rq = https.get('https://nominatim.openstreetmap.org' + pathAndQuery, { headers: { 'User-Agent': TILE_UA, 'Accept-Language': 'fr' }, timeout: 8000 }, up => {
        const chunks = []; up.on('data', c => chunks.push(c));
        up.on('end', () => {
          let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
          if (up.statusCode === 200 && data) { geoCache.set(pathAndQuery, data); if (geoCache.size > 3000) geoCache.delete(geoCache.keys().next().value); }
          resolve(data);
        });
      });
      rq.on('timeout', () => rq.destroy(new Error('timeout')));
      rq.on('error', () => resolve(null));
    }, wait);
  });
  const p = geoChain.then(run).finally(() => { geoPending--; }); geoChain = p.catch(() => {}); return p;
}
const placeName = a => a && (a.city || a.town || a.village || a.municipality || a.suburb || a.county || a.state) || null;

// ---- Notifications push (Web Push : chiffrement RFC 8291 + VAPID RFC 8292), sans dépendance ----
// Un téléphone abonné envoie seulement une zone arrondie à 0,1° (≈ 10 km), jamais sa position exacte.
// Seules les annonces urgentes (et nationales urgentes) déclenchent une notification.
const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const PUSH_MAX = 50000;
// Seuls les services de notification des navigateurs sont contactés (évite qu'on fasse appeler n'importe quelle adresse au serveur)
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const VAPID = (() => {
  const f = path.join(DATA_DIR, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const v = { jwk, pub: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
  try { fs.writeFileSync(f, JSON.stringify(v), { mode: 0o600, flag: 'wx' }); return v; } catch { return JSON.parse(fs.readFileSync(f, 'utf8')); }
})();
const VAPID_KEY = crypto.createPrivateKey({ key: VAPID.jwk, format: 'jwk' });
// Abonnements dans la base (avant : un fichier réécrit en entier à chaque abonnement, de plus en plus lent)
db.exec('CREATE TABLE IF NOT EXISTS push(id TEXT PRIMARY KEY, e TEXT NOT NULL, k TEXT, a TEXT, lat REAL, lng REAL, t INTEGER)');
try { // reprise de l'ancien fichier push.json, une seule fois
  if (fs.existsSync(PUSH_FILE)) {
    const old = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8'));
    tx(() => { for (const [id, x] of Object.entries(old)) q('INSERT OR IGNORE INTO push(id,e,k,a,lat,lng,t) VALUES(?,?,?,?,?,?,?)').run(id, x.e, x.k, x.a, x.lat ?? null, x.lng ?? null, x.t || Date.now()); });
    fs.renameSync(PUSH_FILE, PUSH_FILE + '.repris-' + Date.now());
  }
} catch (e) { if (!/ENOENT/.test(e.message)) console.error('reprise push.json', e.message); }
const pushCount = () => q('SELECT COUNT(*) n FROM push').get().n;
const pushAll = () => q('SELECT * FROM push').all();
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
function encryptPush(sub, payload) {
  const uaPub = Buffer.from(sub.k, 'base64url'), auth = Buffer.from(sub.a, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const ikm = hmac(hmac(auth, ecdh.computeSecret(uaPub)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
  return Buffer.concat([head, asPub, body]);
}
const jwtCache = new Map();
function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  if (hit && hit.exp - Date.now() > 3600_000) return hit.h;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp, sub: CONTACT_EMAIL ? 'mailto:' + CONTACT_EMAIL : PUBLIC_URL });
  const sig = crypto.sign('sha256', Buffer.from(data), { key: VAPID_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const h = `vapid t=${data}.${sig}, k=${VAPID.pub}`;
  jwtCache.set(aud, { h, exp: exp * 1000 });
  return h;
}
function pushOne(sub, payload) {
  return new Promise(resolve => {
    let body, u;
    try { body = encryptPush(sub, payload); u = new URL(sub.e); } catch { return resolve(410); }
    const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 10_000,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
        TTL: '3600', Urgency: 'high', Authorization: vapidAuth(sub.e) } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
    req.end(body);
  });
}
async function pushBroadcast(a) {
  const targets = pushAll().filter(s => a.national || (s.lat != null && distKm(s.lat, s.lng, a.lat, a.lng) <= a.r + 8)).map(s => [s.id, s]);
  if (!targets.length) return;
  const payload = JSON.stringify({ title: (a.national ? '⚠ National · ' : '⚠ ') + a.by, body: a.text, tag: 'ann-' + a.id, url: '/' });
  const dead = [];
  for (let i = 0; i < targets.length; i += 20) {
    const batch = targets.slice(i, i + 20);
    const codes = await Promise.all(batch.map(([, s]) => pushOne(s, payload)));
    codes.forEach((code, j) => { if (code === 404 || code === 410) dead.push(batch[j][0]); });
  }
  if (dead.length) try { tx(() => dead.forEach(id => q('DELETE FROM push WHERE id=?').run(id))); } catch {}
  console.log(`push : ${targets.length} envoi(s), ${dead.length} abonnement(s) expiré(s)`);
}

// ---- Import : manifestations de la carte participative du 17 octobre (réutilisation autorisée) ----
// On importe les actions « manifestation » (où qu'elles soient) et les « rassemblements » des lieux de manif.
// Les blocages de stations, raffineries, péages… ne sont pas importés.
const IMPORT_17 = process.env.IMPORT_17OCT !== '0';
const IMPORT_BASE = (process.env.IMPORT_17OCT_URL || 'https://www.17octobregiletjaune.net').replace(/\/$/, '');
const IMPORT_UNTIL = Date.parse(process.env.IMPORT_17OCT_UNTIL || '2026-11-01');
const IMPORT_EVERY = 15 * MIN;
const IMPORT_STAMP = path.join(DATA_DIR, 'import-17oct.stamp');
function getJson(url, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('http:') ? http : https).get(url, { headers: { 'User-Agent': TILE_UA, Accept: 'application/json' }, timeout }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
  });
}
// « 2026-10-17 » + « 14:00 », heure de Paris → horodatage (gère l'heure d'été)
function parisMs(date, hhmm) {
  const [y, m, d] = String(date).split('-').map(Number), [h, mi] = String(hhmm || '12:00').split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
    t += want - Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1, +p.slice(8, 10), +p.slice(11, 13), +p.slice(14, 16));
  }
  return t;
}
let stationCache = { t: 0, map: new Map() };
async function import17() {
  const [lieux, actions, sites] = await Promise.all([getJson(IMPORT_BASE + '/api/lieux'), getJson(IMPORT_BASE + '/api/actions'),
    getJson(IMPORT_BASE + '/data/sites.json').catch(() => ({ lieux: [] }))]);
  const places = new Map();
  for (const l of sites.lieux || []) places.set(String(l[0]), { kind: l[1], lat: +l[2], lng: +l[3], name: l[4], city: l[6] });
  for (const l of lieux.lieux || []) places.set(String(l[0]), { kind: l[1], lat: +l[2], lng: +l[3], name: l[4], city: l[6] });
  const keep = [];
  for (const [id, list] of Object.entries(actions.actions || {})) (list || []).forEach((a, i) => {
    const type = a[0], kind = places.get(id)?.kind;
    if (type === 'manifestation' || (type === 'rassemblement' && kind === 'manif')) keep.push({ id, i, type, time: a[1], date: a[2] });
  });
  // Manifestations annoncées devant une station-service : coordonnées dans le fichier des stations (lourd, relu toutes les 6 h)
  if (keep.some(k => !places.has(k.id)) && Date.now() - stationCache.t > 6 * 60 * MIN) {
    const st = await getJson(IMPORT_BASE + '/api/stations', 90_000).catch(() => null);
    if (Array.isArray(st)) stationCache = { t: Date.now(), map: new Map(st.map(x => [String(x.id), { kind: 'station', lat: +x.geom?.lat, lng: +x.geom?.lon, name: x.adresse, city: x.ville }])) };
  }
  const now = Date.now(), out = new Map();
  for (const k of keep) {
    const p = places.get(k.id) || stationCache.map.get(k.id);
    if (!p || !validLatLng(p.lat, p.lng) || !/^\d{4}-\d{2}-\d{2}$/.test(k.date) || !/^\d{1,2}:\d{2}$/.test(k.time || '')) continue;
    const start = parisMs(k.date, k.time);
    if (!(start + EVENT_KEEP > now)) continue;
    const city = clean(p.city, 60), name = clean(p.name, 80);
    const id = 'g' + sha('17oct|' + k.id + '|' + k.i).slice(0, 11);
    out.set(id, { id, type: k.type === 'manifestation' ? 'manif' : 'rassemblement', src: '17oct',
      title: clean(`${k.type === 'manifestation' ? 'Manifestation' : 'Rassemblement'}${city ? ' · ' + city : ''}`, 80),
      place: clean(p.kind === 'station' ? `Station-service, ${name}` : (name || city || 'Lieu annoncé'), 100),
      note: 'Annoncé sur la carte participative du 17 octobre.', start, lat: round(p.lat), lng: round(p.lng), route: null, end: false,
      by: '17octobregiletjaune.net', link: IMPORT_BASE + '/carte/', status: 'ok', t: now });
  }
  const n = tx(() => {
    const hidden = new Set(q('SELECT id FROM hidden').all().map(x => x.id));
    for (const x of q("SELECT id FROM events WHERE src='17oct'").all()) if (!out.has(x.id)) dropEvent(x.id);
    let n = 0;
    for (const [id, e] of out) {
      if (hidden.has(id)) continue;
      const cur = getEvent(id);
      if (!cur || cur.start !== e.start || cur.place !== e.place || cur.lat !== e.lat || cur.lng !== e.lng || cur.title !== e.title) saveEvent(cur ? { ...e, t: cur.t } : e);
      n++;
    }
    return n;
  });
  console.log(`import 17 octobre : ${n} manifestation(s) et rassemblement(s)`);
}
// Un seul processus importe à la fois (Passenger peut en lancer plusieurs) : horodatage partagé dans DATA_DIR
function maybeImport17() {
  if (!IMPORT_17 || Date.now() > IMPORT_UNTIL) return;
  let last = 0; try { last = fs.statSync(IMPORT_STAMP).mtimeMs; } catch {}
  if (Date.now() - last < IMPORT_EVERY) return;
  try { fs.writeFileSync(IMPORT_STAMP, String(process.pid)); } catch { return; }
  import17().catch(e => console.error('import 17 octobre :', e.message));
}
setTimeout(maybeImport17, 3000);
setInterval(maybeImport17, 60_000).unref();

// ---- Agenda : création d'événement (orga = publié tout de suite ; participant·e = proposition à valider) ----
function createEvent(b, orga, dev, ipH) {
  const type = Object.hasOwn(EVT, String(b.type)) ? b.type : 'manif';
  const title = clean(b.title, 80), place = clean(b.place, 100), note = clean(b.note, 220);
  const start = Number(b.start), lat = Number(b.lat), lng = Number(b.lng);
  if (title.length < 3) return [400, { error: 'Donne un titre (ex. : Blocus lycée Jean-Monnet).' }];
  if (place.length < 2) return [400, { error: 'Indique le lieu de rendez-vous.' }];
  if (!(start > Date.now() - 2 * 60 * MIN && start < Date.now() + 90 * 24 * 60 * MIN)) return [400, { error: 'Date invalide (dans les 3 prochains mois).' }];
  if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  let route = null;
  if (Array.isArray(b.route) && b.route.length >= 2) {
    route = b.route.slice(0, 300).map(p => [Math.round(Number(p[0]) * 1e5) / 1e5, Math.round(Number(p[1]) * 1e5) / 1e5]);
    if (!route.every(([a, o]) => validLatLng(a, o) && distKm(a, o, lat, lng) < 60)) return [400, { error: 'Parcours invalide.' }];
  }
  return tx(() => {
    const now = Date.now();
    if (!orga) {
      if (!allow(dev, ipH, 'report', now)) return [429, { error: 'Trop d’envois d’un coup. Réessaie dans quelques minutes.' }];
      if (q("SELECT COUNT(*) n FROM events WHERE status='pending' AND dev=?").get(dev).n >= 3) return [429, { error: 'Tu as déjà 3 propositions en attente de validation.' }];
      if (q("SELECT COUNT(*) n FROM events WHERE status='pending'").get().n >= 300) return [503, { error: 'Trop de propositions en attente, réessaie plus tard.' }];
    }
    const e = { id: crypto.randomBytes(6).toString('base64url'), type, title, place, note, start, lat: round(lat), lng: round(lng),
      route, end: !!(route && b.end), by: orga ? orga.label : 'Proposition de participant·e', status: orga && !orga.trial ? 'ok' : 'pending', t: now };
    if (!orga) e.dev = dev;
    saveEvent(e);
    return [201, evView(e)];
  });
}


// ---- Publication en fichiers statiques ----
// Node écrit de petits fichiers JSON dans live/ ; sur cPanel, Apache les sert directement aux téléphones.
// Seuls les morceaux modifiés sont réécrits, au plus une fois par seconde (les changements sont regroupés).
//   live/g.json         → empreintes des annonces, de l'agenda et état de pause (presque toujours en 304)
//   live/r/<région>.json → empreinte de chaque case active d'une région de 1° (≈ 100 km)
//   live/c/<case>.json  → signalements d'une case de 0,05° (≈ 5 km)
//   live/all.json       → tous les signalements (vue nationale, réécrit au plus toutes les 10 s)
//   live/ann.json, live/events.json → annonces et agenda
//   live/index.json     → ancien format (toutes les cases), pour les téléphones qui n'ont pas rechargé l'appli
const LIVE_DIR = process.env.LIVE_DIR || path.join(__dirname, 'live');
const CELL = 0.05;
const cellId = (lat, lng) => `${Math.floor(lat / CELL)}_${Math.floor(lng / CELL)}`;
// Région = carré de 20 × 20 cases (1°) ; même calcul côté téléphone
const regionOfCell = c => { const [i, j] = c.split('_').map(Number); return `${Math.floor(i / 20)}_${Math.floor(j / 20)}`; };
fs.mkdirSync(path.join(LIVE_DIR, 'c'), { recursive: true });
fs.mkdirSync(path.join(LIVE_DIR, 'r'), { recursive: true });
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
function writeAtomic(file, str) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, str); fs.renameSync(tmp, file); }
function writeIfChanged(file, str) {
  try { if (fs.readFileSync(file, 'utf8') === str) return; } catch {}
  writeAtomic(file, str);
}
const FLUSH_MS = Number(process.env.FLUSH_MS) || 1000;
const ALL_EVERY = 10_000;
const LIVE_LOCK = path.join(DATA_DIR, 'live.lock');
const dirty = { cells: new Set(), ann: false, events: false, global: false, all: false };
let flushTimer = null, lastAll = 0;
// Publication planifiée. Une demande plus urgente avance le minuteur : un nouveau signalement n'attend
// jamais les publications espacées (vue nationale toutes les 10 s, ancien index toutes les 5 s).
let flushDue = 0;
function scheduleFlush(ms = FLUSH_MS) {
  const due = Date.now() + ms;
  if (flushTimer && due >= flushDue) return;
  clearTimeout(flushTimer); flushDue = due; flushTimer = setTimeout(flush, ms);
}
function dirtyCell(c) { dirty.cells.add(c); dirty.all = true; scheduleFlush(); }
function writeRegion(rg) {
  const rows = q('SELECT cell, h FROM cells WHERE region=?').all(rg);
  const f = path.join(LIVE_DIR, 'r', rg + '.json');
  // Une région vide reste publiée (fichier vide) : sinon Apache ne trouve rien et chaque téléphone de la zone réveille Node.
  writeIfChanged(f, JSON.stringify({ c: Object.fromEntries(rows.map(x => [x.cell, x.h])) }));
}
// Vue nationale : par région d'environ 100 km, le nombre de signalements par famille et leur position moyenne
function writeNational(now) {
  const agg = new Map();
  for (const r of q('SELECT cat, lat, lng, t, last FROM reports WHERE exp>?').all(now)) {
    const k = `${Math.floor(r.lat)}_${Math.floor(r.lng)}`;
    let a = agg.get(k);
    if (!a) agg.set(k, (a = { k, la: 0, lo: 0, n: 0, g: {}, t: 0 }));
    const grp = Object.hasOwn(CAT, r.cat) ? CAT[r.cat].group : 'info';
    a.la += r.lat; a.lo += r.lng; a.n++; a.g[grp] = (a.g[grp] || 0) + 1; a.t = Math.max(a.t, r.last || r.t);
  }
  const r3 = x => Math.round(x * 1000) / 1000;
  writeIfChanged(path.join(LIVE_DIR, 'n.json'), JSON.stringify({ r: [...agg.values()].map(a => ({ k: a.k, lat: r3(a.la / a.n), lng: r3(a.lo / a.n), g: a.g, t: a.t })) }));
}
// Empreinte de la version servie, calculée au démarrage : après une mise à jour (fichiers + Restart),
// elle change et les téléphones se rechargent d'eux-mêmes.
let BUILD = null;
const buildId = () => BUILD || (BUILD = h8(JSON.stringify(versionInfo().files)));
function writeGlobal(now) {
  const g = { ann: getMeta('annh') || null, events: getMeta('evh') || null, paused: pausedUntil(now), build: buildId() };
  writeIfChanged(path.join(LIVE_DIR, 'g.json'), JSON.stringify(g));
  // Ancien format, pour les téléphones pas encore mis à jour : réécrit au plus toutes les 5 s (il liste toutes les cases)
  if (now - (writeGlobal.last || 0) < 5000 && fs.existsSync(path.join(LIVE_DIR, 'index.json'))) { dirty.global = true; return scheduleFlush(5000 - (now - writeGlobal.last)); }
  writeGlobal.last = now;
  const cells = q('SELECT cell, h FROM cells').all();
  writeAtomic(path.join(LIVE_DIR, 'index.json'), JSON.stringify({ v: now, t: now, cells: Object.fromEntries(cells.map(x => [x.cell, x.h])),
    ann: g.ann, events: g.events, all: getMeta('allh') || null, paused: g.paused, build: g.build }));
}
function flush() {
  flushTimer = null;
  const now = Date.now();
  const cells = [...dirty.cells], doAnn = dirty.ann, doEv = dirty.events, doAll = dirty.all && now - lastAll >= ALL_EVERY;
  const doGlobal = cells.length || doAnn || doEv || doAll || dirty.global;
  dirty.cells.clear(); dirty.ann = dirty.events = dirty.global = false; if (doAll) dirty.all = false;
  if (doGlobal) try {
    withLock(() => {
      const regions = new Set();
      for (const c of cells) {
        const rows = q('SELECT * FROM reports WHERE cell=? AND exp>? ORDER BY t').all(c, now).map(publicView);
        const f = path.join(LIVE_DIR, 'c', c + '.json');
        if (rows.length) {
          const str = JSON.stringify({ r: rows });
          writeAtomic(f, str);
          q('INSERT OR REPLACE INTO cells(cell,region,h) VALUES(?,?,?)').run(c, regionOfCell(c), h8(str));
        } else { try { fs.unlinkSync(f); } catch {} q('DELETE FROM cells WHERE cell=?').run(c); }
        regions.add(regionOfCell(c));
      }
      for (const rg of regions) writeRegion(rg);
      if (doAnn) { const str = JSON.stringify({ a: annActive(now).map(annView) }); writeIfChanged(path.join(LIVE_DIR, 'ann.json'), str); setMeta('annh', h8(str)); }
      if (doEv) {
        const str = JSON.stringify({ e: q("SELECT data FROM events WHERE status='ok' AND start>? ORDER BY start LIMIT 3000").all(now - EVENT_KEEP).map(x => evView(JSON.parse(x.data))) });
        writeIfChanged(path.join(LIVE_DIR, 'events.json'), str); setMeta('evh', h8(str));
      }
      if (doAll) { lastAll = now; const str = JSON.stringify({ r: activeReports(now).map(publicView) }); writeIfChanged(path.join(LIVE_DIR, 'all.json'), str); setMeta('allh', h8(str)); writeNational(now); }
      writeGlobal(now);
    }, LIVE_LOCK);
  } catch (e) {
    // occupé : les changements retournent dans la file, nouvel essai dans une demi-seconde
    cells.forEach(c => dirty.cells.add(c));
    if (doAnn) dirty.ann = true; if (doEv) dirty.events = true; if (doAll) dirty.all = true; if (doGlobal) dirty.global = true;
    if (!isBusy(e)) console.error('publication', e.message);
    return scheduleFlush(500);
  }
  if (dirty.all && !flushTimer) scheduleFlush(Math.max(FLUSH_MS, ALL_EVERY - (Date.now() - lastAll)));
}
// Tout republier (démarrage, purge) : chaque case active, chaque fichier existant, annonces, agenda.
function rebuildAll() {
  const now = Date.now();
  const all = new Set(q('SELECT DISTINCT cell FROM reports WHERE exp>?').all(now).map(x => x.cell));
  q('SELECT cell FROM cells').all().forEach(x => all.add(x.cell));
  try { fs.readdirSync(path.join(LIVE_DIR, 'c')).forEach(f => f.endsWith('.json') && all.add(f.slice(0, -5))); } catch {}
  all.forEach(c => dirty.cells.add(c));
  dirty.ann = dirty.events = dirty.global = dirty.all = true; lastAll = 0;
  clearTimeout(flushTimer); flushTimer = null;
  flush();
  ensureRegions();
}
// Fichiers de région publiés d'avance (vides) pour la France et l'outre-mer : un téléphone dans une zone
// sans aucun signalement reçoit un fichier statique d'Apache, sans réveiller Node.
function ensureRegions() {
  try {
    for (const [la1, la2, lo1, lo2] of TILE_ZONES)
      for (let i = Math.floor(la1); i <= Math.floor(la2); i++)
        for (let j = Math.floor(lo1); j <= Math.floor(lo2); j++) {
          const f = path.join(LIVE_DIR, 'r', `${i}_${j}.json`);
          if (!fs.existsSync(f)) writeAtomic(f, '{"c":{}}');
        }
  } catch (e) { console.error('régions', e.message); }
}
// Reprise des données de l'ancienne version (fichier state.json), une seule fois.
function migrateJson() {
  const f = path.join(DATA_DIR, 'state.json');
  if (!fs.existsSync(f) || getMeta('migrated')) return;
  let s; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  const now = Date.now();
  const done = tx(() => {
    if (getMeta('migrated')) return false;
    for (const r of Object.values(s.reports || {})) if (r.exp > now) saveReport(r);
    for (const a of Object.values(s.ann || {})) if (a.exp > now) q('INSERT OR REPLACE INTO ann(id,exp,data) VALUES(?,?,?)').run(a.id, a.exp, JSON.stringify(a));
    for (const e of Object.values(s.events || {})) if (e.start + EVENT_KEEP > now) saveEvent(e);
    for (const [id, t] of Object.entries(s.importHidden || {})) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(id, t + EVENT_KEEP);
    if (s.paused > now) setMeta('paused', s.paused);
    setMeta('migrated', now);
    return true;
  });
  if (done) { try { fs.renameSync(f, f + '.repris-' + now); } catch {} console.log('Données reprises de state.json'); }
}
setTimeout(() => {
  try { migrateJson(); } catch (e) { console.error('reprise state.json', e.message); }
  try { sweep(); rebuildAll(); } catch (e) { console.error('publication initiale', e.message); }
}, 200);

// ---- HTTP helpers ----
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readJson(req, max = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// ---- Statique ----
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// Politique de sécurité des pages : le navigateur n'exécute que nos propres scripts. Même si du code
// était un jour injecté dans une note ou un titre, il ne pourrait pas s'exécuter. Les scripts intégrés
// aux pages (admin, mentions légales) sont autorisés par leur empreinte exacte.
const cspCache = new Map();
function cspFor(buf) {
  const key = h8(buf.toString('latin1'));
  if (!cspCache.has(key)) {
    const hashes = [...buf.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    cspCache.set(key, `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; `
      + `connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  }
  return cspCache.get(key);
}
// Fichiers de l'appli gardés en mémoire avec une empreinte : un téléphone qui a déjà la bonne version
// reçoit une réponse vide « pas modifié » (304) au lieu de tout retélécharger.
const staticCache = new Map();
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    let c = staticCache.get(file);
    const reply = () => {
      const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ETag: c.etag,
        'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache' };
      if (file.endsWith('.html')) { headers['Content-Security-Policy'] = cspFor(c.buf); headers['X-Frame-Options'] = 'DENY'; }
      if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers); res.end(c.buf);
    };
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return reply();
    fs.readFile(file, (err2, buf) => {
      if (err2) return send(res, 404, 'Not found');
      c = { buf, mtime: st.mtimeMs, size: st.size, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"' };
      if (staticCache.size > 200) staticCache.clear();
      staticCache.set(file, c);
      reply();
    });
  });
}

// ---- Version en ligne : empreintes SHA-256 des fichiers servis, pour comparer avec le dépôt public ----
// Les fichiers de l'appli (public/) peuvent être vérifiés pour de vrai : verifier.js les retélécharge et les compare.
// L'empreinte de server.js est seulement déclarée par le serveur : elle ne prouve rien à elle seule.
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
let versionCache = { t: 0, body: null };
function versionInfo() {
  if (Date.now() - versionCache.t < 60_000) return versionCache.body;
  const files = {};
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name), r = rel + '/' + e.name;
      if (e.isDirectory()) walk(p, r); else files['public' + r] = sha(p);
    }
  };
  walk(PUBLIC, '');
  files['server.js'] = sha(__filename);
  versionCache = { t: Date.now(), body: { version: APP_VERSION, algorithm: 'sha256', files,
    verify: 'node verifier.js ' + PUBLIC_URL + '  (depuis une copie du dépôt public)' } };
  return versionCache.body;
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
// Protection du proxy de tuiles : sans elle, n'importe qui pourrait faire télécharger des millions de tuiles
// par le serveur, remplir le disque et faire bannir le serveur par OpenStreetMap (la carte tomberait pour tous).
//  - zone : France métropolitaine, Corse et outre-mer à partir du zoom 8 (en dessous, le monde entier tient en peu de tuiles) ;
//  - budget par réseau de tuiles NOUVELLES (les tuiles déjà en cache ne comptent pas) ;
//  - plafond de téléchargements simultanés, et une même tuile demandée par mille personnes n'est téléchargée qu'une fois.
const TILE_ZONES = [[41, 51.6, -5.8, 10], [15.8, 16.6, -61.9, -60.9], [14.3, 14.95, -61.3, -60.75], [2, 6, -54.7, -51.5],
  [-21.45, -20.85, 55.1, 55.9], [-13.05, -12.6, 44.95, 45.35], [46.7, 47.2, -56.5, -56.05]]; // métropole+Corse, Guadeloupe, Martinique, Guyane, Réunion, Mayotte, St-Pierre
// Préchargement de zone (« Garder la zone hors ligne ») : interdit par la politique d'OpenStreetMap,
// désactivé tant que les tuiles viennent de chez eux. TILE_PREFETCH=1 pour un fournisseur qui l'autorise.
const TILE_PREFETCH = process.env.TILE_PREFETCH === '1';
const TILE_NET_BUDGET = Number(process.env.TILE_NET_BUDGET) || 600;   // nouvelles tuiles par réseau et par 10 min
const TILE_UPSTREAM_MAX = 12;                                          // téléchargements simultanés vers le fournisseur
const tileBudget = new Map(), tileInflight = new Map();
let tileUpstream = 0;
const tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
function tileInZone(z, x, y) {
  if (z < 8) return true;
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
        tileCache.set(key, buf);
        if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
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

// ---- Routes ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Écritures acceptées seulement depuis l'appli elle-même : un autre site ne peut pas faire poster
  // de faux signalements par les navigateurs de ses visiteurs (CSRF).
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'Requête refusée.' });
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'Format refusé.' });
  }

  try {
    if (req.method === 'GET' && pathname === '/api/config')
      return send(res, 200, { event: EVENT_NAME, center: CENTER, zoom: ZOOM, brand: BRAND, violenceUrl: VIOLENCE_URL, contact: CONTACT_EMAIL, hostInfo: HOST_INFO, sourceUrl: SOURCE_URL, categories: CATEGORIES, merge: MERGE, offlineTiles: TILE_PREFETCH, groups: GROUPS, eventTypes: EVENT_TYPES, pushKey: VAPID.pub });

    // ---- Notifications : abonnement / désabonnement (zone arrondie à ≈ 10 km) ----
    if (req.method === 'POST' && (pathname === '/api/push/subscribe' || pathname === '/api/push/unsubscribe')) {
      const b = await readJson(req, 4096);
      const sub = b.sub || {};
      const endpoint = String(sub.endpoint || '');
      let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
      if (!PUSH_HOSTS.test(host) || endpoint.length > 1000) return send(res, 400, { error: 'Service de notification non pris en charge.' });
      const id = sha(endpoint).slice(0, 24);
      if (pathname.endsWith('/unsubscribe')) {
        q('DELETE FROM push WHERE id=?').run(id);
        return send(res, 200, { ok: true });
      }
      const k = String(sub.keys?.p256dh || '').replace(/=+$/, ''), a = String(sub.keys?.auth || '').replace(/=+$/, '');
      if (!/^[\w-]{86,88}$/.test(k) || !/^[\w-]{20,24}$/.test(a)) return send(res, 400, { error: 'Abonnement invalide.' });
      const lat = Number(b.lat), lng = Number(b.lng), hasZone = validLatLng(lat, lng);
      const out = tx(() => {
        // limite par réseau : empêche de remplir la liste avec de faux abonnements
        if (!bump('push:' + clientHash(req), 'vote', 10, Date.now())) return 'rate';
        if (!q('SELECT 1 FROM push WHERE id=?').get(id) && pushCount() >= PUSH_MAX) return false;
        q('INSERT OR REPLACE INTO push(id,e,k,a,lat,lng,t) VALUES(?,?,?,?,?,?,?)').run(id, endpoint, k, a,
          hasZone ? Math.round(lat * 10) / 10 : null, hasZone ? Math.round(lng * 10) / 10 : null, Date.now());
        return true;
      });
      if (out === 'rate') return send(res, 429, { error: 'Trop de demandes, réessaie plus tard.' });
      return out ? send(res, 200, { ok: true }) : send(res, 503, { error: 'Trop d’abonnements, réessaie plus tard.' });
    }

    // Vérification d'installation : ne renvoie jamais d'IP, seulement si un en-tête a été trouvé.
    if (req.method === 'GET' && pathname === '/api/health') {
      let writable = true; try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch { writable = false; }
      return send(res, 200, { ok: true, nodeOk: !!DatabaseSync, passenger: UNDER_PASSENGER, trustProxy: TRUST_PROXY,
        ipHeaderSeen: !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip']),
        cdn: !!req.headers['cf-connecting-ip'], ipIsPublic: !PRIVATE_IP.test(clientIp(req)), storageWritable: writable,
        database: 'sqlite', activeReports: q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(Date.now()).n });
    }

    if (req.method === 'GET' && pathname === '/api/reports') {
      // Zones demandées : jusqu'à 2 rectangles « s,w,n,e » (zone affichée + zone autour de soi, arrondies côté téléphone).
      const boxes = url.searchParams.getAll('bbox').slice(0, 2).map(b => b.split(',').map(Number))
        .filter(b => b.length === 4 && b.every(Number.isFinite));
      const now = Date.now(), seen = new Map();
      if (boxes.length) for (const [so, w, n, e] of boxes)
        for (const r of q('SELECT * FROM reports WHERE exp>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 1500').all(now, so, n, w, e)) seen.set(r.id, r);
      else for (const r of activeReports(now, 1500)) seen.set(r.id, r);
      const list = [...seen.values()].slice(0, 1500).map(publicView);
      // Annonce visible si son cercle touche une des zones demandées
      const annIn = a => a.national || !boxes.length || boxes.some(([so, w, n, e]) => {
        const dLat = a.r / 111, dLng = a.r / (111 * Math.cos(a.lat * Math.PI / 180));
        return a.lat + dLat >= so && a.lat - dLat <= n && a.lng + dLng >= w && a.lng - dLng <= e;
      });
      const anns = annActive(now).filter(annIn).map(annView);
      const etag = '"' + h8(JSON.stringify([list, anns])) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      return send(res, 200, { now, reports: list, announcements: anns }, { ETag: etag, 'Cache-Control': 'no-cache' });
    }

    if (req.method === 'GET' && pathname === '/api/version') return send(res, 200, versionInfo(), { 'Cache-Control': 'no-cache' });

    if (req.method === 'GET' && pathname === '/api/geocode') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return send(res, 400, { error: 'Tape au moins 2 lettres.' });
      const gk = 'geo:' + clientHash(req);
      if (!geoCache.has('/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=fr&q=' + encodeURIComponent(q)) && !tx(() => bump(gk, 'vote', 30, Date.now())))
        return send(res, 429, { error: 'Trop de recherches, patiente un peu.' });
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
          orgas: readOrgas().map(({ id, label, created, trial }) => ({ id, label, created, trial: trial === true, source: 'page', ...orgaStats(id) }))
            .concat(ORGAS.map(o => ({ id: null, label: o.label, created: null, trial: false, source: 'variable', ...orgaStats('env:' + o.label) }))),
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
          const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: sha(key), created: Date.now(), trial: true };
          list.push(o); writeOrgas(list); return o;
        });
        if (!out) return send(res, 409, { error: 'Une orga porte déjà ce nom.' });
        return send(res, 201, { id: out.id, label: out.label, created: out.created, key });
      }
      // --- Urgences : liste, suppression, purge, pause ---
      if (req.method === 'GET' && pathname === '/api/admin/reports') {
        const now = Date.now();
        return send(res, 200, { paused: pausedUntil(now),
          reports: activeReports(now).map(publicView),
          announcements: annAll(now).sort((a, b) => b.t - a.t).map(annView),
          pushSubs: pushCount() });
      }
      // --- Annonces de l'admin (nationales ou locales) ---
      if (req.method === 'POST' && pathname === '/api/admin/announcements') {
        const b = await readJson(req);
        return send(res, ...createAnnouncement(b, ADMIN_LABEL, true));
      }
      const delA = pathname.match(/^\/api\/admin\/announcements\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delA) {
        const ok = dropAnn(delA[1]);
        return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Annonce déjà retirée.' });
      }
      // --- Agenda : propositions à valider + événements publiés ---
      if (req.method === 'GET' && pathname === '/api/admin/events') {
        return send(res, 200, { events: listEvents().map(evView) });
      }
      const evAct = pathname.match(/^\/api\/admin\/events\/([\w-]{1,16})(\/approve)?$/);
      if (evAct && (req.method === 'DELETE' || (req.method === 'POST' && evAct[2]))) {
        const ok = tx(() => {
          const e = getEvent(evAct[1]); if (!e) return false;
          if (req.method === 'DELETE') {
            // un événement importé retiré par l'admin ne revient pas au prochain import
            if (e.src) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(e.id, e.start + EVENT_KEEP);
            dropEvent(e.id);
          } else { e.status = 'ok'; delete e.dev; saveEvent(e); }
          return true;
        });
        return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Événement introuvable.' });
      }
      const delRep = pathname.match(/^\/api\/admin\/reports\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delRep) {
        const ok = tx(() => { const r = getReport(delRep[1], Date.now()); if (!r) return false;
          const admin = { id: 'admin', label: ADMIN_LABEL }; trashReport(r, admin); orgaLog(admin, 'retiré', { r }); return true; });
        return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Déjà expiré.' });
      }
      if (req.method === 'POST' && pathname === '/api/admin/purge') {
        const b = await readJson(req);
        const list = tx(() => {
          const list = q('DELETE FROM reports RETURNING *').all();
          if (b.announcements) q('DELETE FROM ann').run();
          return list;
        });
        list.forEach(r => archive(r, true));
        rebuildAll();
        const n = list.length;
        return send(res, 200, { removed: n });
      }
      if (req.method === 'POST' && pathname === '/api/admin/pause') {
        const b = await readJson(req);
        const minutes = Math.min(Math.max(Number(b.minutes) || 0, 0), 24 * 60);
        const until = minutes ? Date.now() + minutes * MIN : 0;
        setMeta('paused', until); dirty.global = true; scheduleFlush(0);
        return send(res, 200, { paused: until });
      }

      const promo = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/trial$/);
      if (req.method === 'POST' && promo) {
        const b = await readJson(req);
        const o = withLock(() => {
          const list = readOrgas().slice(); const i = list.findIndex(x => x.id === promo[1]);
          if (i < 0) return null; list[i] = { ...list[i], trial: !!b.trial }; writeOrgas(list); return list[i];
        });
        if (!o) return send(res, 404, { error: 'Orga introuvable.' });
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, o.trial ? 'essai' : 'confirmée', { ref: o.id, detail: o.label });
        return send(res, 200, { id: o.id, trial: o.trial });
      }
      // --- Journal des orgas et corbeille ---
      if (req.method === 'GET' && pathname === '/api/admin/journal') {
        const rows = q('SELECT * FROM orga_log ORDER BY t DESC LIMIT 300').all();
        const trash = q('SELECT id, t, orga, data FROM trash WHERE t>? ORDER BY t DESC').all(Date.now() - TRASH_MS)
          .map(x => { const r = JSON.parse(x.data); return { id: x.id, t: x.t, orga: x.orga, cat: r.cat, lat: r.lat, lng: r.lng, up: r.up, note: r.note }; });
        return send(res, 200, { log: rows, trash });
      }
      const rest = pathname.match(/^\/api\/admin\/trash\/([\w-]{1,16})\/restore$/);
      if (req.method === 'POST' && rest) {
        const out = tx(() => {
          const x = q('SELECT * FROM trash WHERE id=?').get(rest[1]);
          if (!x) return [404, { error: 'Plus dans la corbeille.' }];
          const r = JSON.parse(x.data), now = Date.now();
          r.exp = now + Math.max(5 * MIN, r.left || 0); // il retrouve le temps qu'il lui restait
          delete r.left; delete r.cell;
          if (x.oid === VOTES.id) { r.down = 0; r.dw = 0; r.ct = 0; r.downIps = []; } // contestation annulée
          saveReport(r); q('DELETE FROM trash WHERE id=?').run(x.id);
          orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'restauré', { r, detail: 'retiré par ' + x.orga });
          return [200, publicView(r)];
        });
        return send(res, ...out);
      }
      const annOk = pathname.match(/^\/api\/admin\/announcements\/([\w-]{1,16})\/approve$/);
      if (req.method === 'POST' && annOk) {
        const a = getAnn(annOk[1]);
        if (!a) return send(res, 404, { error: 'Annonce introuvable.' });
        delete a.pending; saveAnn(a);
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'annonce validée', { ref: a.id, detail: a.by + ' · ' + (a.phone || a.text) });
        return send(res, 200, annView(a));
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
      sweep(); // archive ce qui vient d'expirer
      let rows = [];
      try { rows = fs.readFileSync(path.join(ARCHIVE_DIR, date + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
      // + les signalements encore actifs de ce jour
      for (const r of activeReports(Date.now(), 5000)) if (parisDay(r.t) === date)
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
      const cat = Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!cat) return send(res, 400, { error: 'Catégorie inconnue.' });
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
      const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX);
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = tx(() => {
        const now = Date.now(), ttl = cat.ttl * MIN;
        deviceAge(dev, now);
        // Heure où le signalement a été fait (file d'attente hors ligne). Jamais dans le futur ;
        // mentir dessus ne peut que raccourcir la vie du point.
        const t0 = Math.min(now, Number(b.t) || now);
        if (t0 + ttl <= now) return [410, { error: 'Signalement trop ancien, il n’a pas été publié.', stale: true }];
        if (pausedUntil(now)) return [503, { error: 'Les signalements sont en pause quelques minutes (afflux de faux signalements). Réessaie bientôt.' }];
        if (!allow(dev, ipH, 'report', now)) return [429, { error: 'Trop de signalements d’un coup. Réessaie dans quelques minutes.' }];
        const pos = { lat: round(lat), lng: round(lng) };
        // Un danger n'efface plus une zone calme voisine : le téléphone l'affiche « suspendue » tant que le danger est actif
        // (un faux danger ne peut donc plus faire disparaître une zone calme).

        if (cat.id === 'calme' && CATEGORIES.some(c => isDanger(c.id) && nearby(c.id, pos.lat, pos.lng, CALM_KILL_M, now).some(x => !x.r.ct)))
          return [409, { error: 'Un danger est signalé à moins de 100 m : la zone ne peut pas être marquée calme.' }];
        // Même type tout près : on confirme le point existant au lieu d'en créer un deuxième
        const m = MERGE[cat.id] || { r: 50 };
        const hit = nearby(cat.id, pos.lat, pos.lng, m.r, now)[0];
        if (hit) {
          const r = toReport(hit.r), self = r.voters.includes(dev);
          if (!self) { r.voters.push(dev); r.up++; }
          // Preuve plus fraîche que les « Plus là » : on les efface
          if (t0 >= (r.last || r.t)) { r.down = 0; r.downIps = []; r.dw = 0; r.ct = 0; }
          if (m.move && t0 >= (r.last || r.t)) { r.lat = pos.lat; r.lng = pos.lng; }
          if (note) addNote(r, note, dev, t0);
          r.last = Math.max(r.last || r.t, t0);
          r.exp = Math.max(r.exp, t0 + ttl);
          saveReport(r);
          return [200, { ...publicView(r), merged: true, self }];
        }

        const cell = cellId(pos.lat, pos.lng);
        if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND ip=? AND exp>?').get(cell, ipH, now).n >= MAX_PER_NET_ZONE)
          return [429, { error: 'Trop de signalements depuis ton réseau dans cette zone. Confirme plutôt ceux qui existent.' }];
        if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND exp>?').get(cell, now).n >= MAX_PER_ZONE) {
          // Zone pleine : on fait de la place en retirant le plus ancien point que personne n'a confirmé ni vérifié
          const old = q('SELECT id FROM reports WHERE cell=? AND exp>? AND ver IS NULL AND up=0 ORDER BY t LIMIT 1').get(cell, now);
          if (!old) return [503, { error: 'Zone saturée, réessaie dans quelques minutes.' }];
          dropReport(old.id, true);
        }
        if (q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(now).n >= MAX_REPORTS) return [503, { error: 'Carte saturée, réessaie plus tard.' }];
        const r = { id: crypto.randomBytes(6).toString('base64url'), cat: cat.id, lat: pos.lat, lng: pos.lng, note, notes: note ? [{ x: note, t: t0, d: dev }] : [],
          t: t0, last: t0, exp: t0 + ttl, up: 0, down: 0, voters: [dev], downIps: [], ip: ipH };
        saveReport(r);
        return [201, publicView(r)];
      });
      return send(res, ...result);
    }

    // Agenda : une orga publie directement, un·e participant·e propose (validé ensuite par l'admin)
    if (req.method === 'POST' && pathname === '/api/events') {
      const b = await readJson(req, 16384);
      const orga = req.headers['x-orga-key'] ? orgaOf(req) : null;
      if (req.headers['x-orga-key'] && !orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });
      const out = createEvent(b, orga, deviceHash(req), clientHash(req));
      if (orga && out[0] < 300) orgaLog(orga, out[1].status === 'pending' ? 'événement (en attente)' : 'événement', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id, detail: out[1].title });
      return send(res, ...out);
    }

    // Ajouter une précision à un point existant (une par téléphone, la sienne peut être corrigée)
    const noteRoute = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/note$/);
    if (req.method === 'POST' && noteRoute) {
      const b = await readJson(req);
      const text = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
      if (text.length < 2) return send(res, 400, { error: 'Écris une précision.' });
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = tx(() => {
        const now = Date.now(), r = getReport(noteRoute[1], now);
        if (!r) return [404, { error: 'Signalement expiré.' }];
        if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop d’envois, patiente un peu.' }];
        addNote(r, text, dev, now);
        saveReport(r);
        return [200, publicView(r)];
      });
      return send(res, ...result);
    }

    const vote = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/vote$/);
    if (req.method === 'POST' && vote) {
      const b = await readJson(req);
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = tx(() => {
        const now = Date.now();
        const r = getReport(vote[1], now);
        if (!r) return [404, { error: 'Signalement expiré.' }];
        if (r.voters.includes(dev)) return [409, { error: 'Déjà pris en compte.' }];
        if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop de votes, patiente un peu.' }];
        const age = deviceAge(dev, now);
        r.voters.push(dev);
        if (b.v === 1) {
          r.up++; r.last = now;
          const ttl = CAT[r.cat].ttl * MIN;
          r.exp = Math.min(Math.max(r.exp, now + ttl), r.t + 4 * ttl); // prolonge, plafonné à 4× la durée de base
          if (r.ct && (r.dw || 0) < contestNeed(r)) r.ct = 0; // confirmé : plus contesté
        } else {
          // Un téléphone ou un réseau qui conteste beaucoup de points d'affilée n'est plus compté. On ne le lui dit pas.
          const devOk = bump('dn:' + dev, 'vote', CONTEST.devBurst, now), netOk = bump('dnn:' + ipH, 'vote', CONTEST.netBurst, now);
          if (!devOk || !netOk) { saveReport(r); return [200, { ...publicView(r), down: r.down + 1 }]; }
          const before = { ...r, voters: r.voters.slice(0, -1) };
          r.down++;
          r.dw = (r.dw || 0) + (b.here === true ? CONTEST.near : 1) * (age >= CONTEST.newDev ? CONTEST.aged : 1);
          (r.downIps ||= []).push(ipH);
          // Un signalement vérifié par une orga ne peut pas être contesté par les votes.
          const nets = new Set(r.downIps).size, need = contestNeed(r);
          if (!r.ver && r.dw >= need && nets >= 2) {
            if (!r.ct) { r.ct = now; snapshotContested(before, now); orgaLog(VOTES, 'contesté', { r, detail: nets + ' réseaux' }); }
            r.exp = Math.min(r.exp, now + (r.dw >= need + CONTEST.more && nets >= 3 ? CONTEST.short : CONTEST.soft));
          }
        }
        saveReport(r);
        return [200, publicView(r)];
      });
      return send(res, ...result);
    }


    // ---- Espace orga / legal team ----
    if (pathname.startsWith('/api/orga') || pathname.startsWith('/api/announcements') || /^\/api\/events\/[\w-]{1,16}$/.test(pathname)
      || /^\/api\/reports\/[\w-]{1,16}\/(verify|remove)$/.test(pathname)) {
      const orga = orgaOf(req);
      if (!orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });

      if (req.method === 'GET' && pathname === '/api/orga/me') return send(res, 200, { label: orga.label, admin: orga.admin, trial: orga.trial });

      if (req.method === 'POST' && pathname === '/api/announcements') {
        const b = await readJson(req);
        // Période d'essai : pas d'annonce urgente (notification à toute la zone), numéro de legal team validé par l'admin
        if (orga.trial && b.kind !== 'legal' && b.level === 'urgent')
          return send(res, 400, { error: 'Pendant la période d’essai, les annonces urgentes ne sont pas possibles. Publie-la en « info ».' });
        const out = createAnnouncement(b, orga.label, orga.admin, orga.trial && b.kind === 'legal');
        if (out[0] === 201) orgaLog(orga, out[1].pending ? 'legal team (en attente)' : 'annonce', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id,
          detail: (out[1].kind === 'legal' ? out[1].phone + ' ' : '') + (out[1].level === 'urgent' ? '[urgent] ' : '') + (out[1].national ? '[nationale] ' : '') + (out[1].text || '') });
        return send(res, ...out);
      }

      const delEv = pathname.match(/^\/api\/events\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delEv) {
        const out = tx(() => {
          const e = getEvent(delEv[1]);
          if (!e) return [404, { error: 'Événement déjà retiré.' }];
          if (!orga.admin && e.by !== orga.label) return [403, { error: 'Seule l’orga qui l’a publié peut le retirer.' }];
          if (e.src) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(e.id, e.start + EVENT_KEEP);
          dropEvent(e.id); orgaLog(orga, 'événement retiré', { lat: e.lat, lng: e.lng, ref: e.id, detail: e.title }); return [200, { removed: true }];
        });
        return send(res, ...out);
      }

      const delAnn = pathname.match(/^\/api\/announcements\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delAnn) {
        const out = tx(() => {
          const a = getAnn(delAnn[1]);
          if (!a) return [404, { error: 'Annonce déjà retirée.' }];
          if (!orga.admin && a.by !== orga.label) return [403, { error: 'Seul·e l’auteur·ice peut retirer cette annonce.' }];
          dropAnn(a.id); orgaLog(orga, 'annonce retirée', { lat: a.lat, lng: a.lng, ref: a.id, detail: a.phone || a.text }); return [200, { removed: true }];
        });
        return send(res, ...out);
      }

      const act = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(verify|remove)$/);
      if (req.method === 'POST' && act) {
        const out = tx(() => {
          const r = getReport(act[1], Date.now());
          if (!r) return [404, { error: 'Signalement expiré.' }];
          if (act[2] === 'verify') { r.ver = orga.label; saveReport(r); orgaLog(orga, 'vérifié', { r }); return [200, publicView(r)]; }
          // Période d'essai : « Retirer » compte comme deux « Plus là », sans retrait direct
          if (orga.trial) {
            r.down += 2; (r.downIps ||= []).push('o1:' + orga.id, 'o2:' + orga.id);
            orgaLog(orga, 'retrait (essai)', { r });
            if (!r.ver && r.down > r.up) { trashReport(r, orga); return [200, { removed: true }]; }
            saveReport(r); return [200, { ...publicView(r), trial: true }];
          }
          // Garde-fou : des retraits en rafale bloquent le retrait pour cette orga quelques minutes
          if (!orga.admin && !bump('orm:' + orga.id, 'report', ORGA_REMOVE_MAX, Date.now())) {
            orgaLog(orga, 'retrait bloqué (rafale)', { r });
            return [429, { error: 'Trop de retraits d’un coup : le retrait est suspendu quelques minutes. L’admin est prévenu·e.' }];
          }
          trashReport(r, orga); orgaLog(orga, 'retiré', { r }); return [200, { removed: true }];
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
      return serveTile(req, res, tile[1], tile[2], tile[3]);
    }

    // Fichiers live/ : servis par Apache sur cPanel ; Node ne les sert que s'il est seul (VPS, local).
    const live = pathname.match(/^\/live\/((?:[cr]\/)?[\w-]{1,40}\.json)$/);
    if (req.method === 'GET' && live) {
      const f = path.join(LIVE_DIR, live[1]);
      if ((live[1] === 'index.json' || live[1] === 'g.json') && !fs.existsSync(f)) try { rebuildAll(); } catch {}
      fs.readFile(f, (err, buf) => {
        if (err) return send(res, 200, live[1].startsWith('c/') ? { r: [] } : live[1].startsWith('r/') ? { c: {} } : {}, { 'Cache-Control': 'no-cache' });
        const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"';
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag }); res.end(buf);
      });
      return;
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    send(res, 405, 'Method not allowed');
  } catch (e) {
    const busy = isBusy(e);
    if (!busy && !/bad json|too large/.test(e.message)) console.error('requête', req.method, pathname, e.message);
    send(res, busy ? 503 : 400, { error: busy ? 'Serveur occupé, réessaie.' : 'Requête invalide.' });
  }
});

// Connexions lentes ou abandonnées : on ne les garde pas indéfiniment
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
server.listen(PORT, () => console.log(`Cortège en écoute — ${EVENT_NAME} — données : ${DATA_DIR}`));
