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
const ARCHIVE_DAYS = Number(process.env.ARCHIVE_DAYS) || 30; // archive du digest et journal des orgas
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
const SOURCE_URL = process.env.SOURCE_URL || 'https://github.com/n-e-r-u/cortege'; // lien du dépôt GitHub
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
  // Militaires de l'opération Sentinelle : garde statique de bâtiments, pas de maintien de l'ordre (pas d'alerte, ne suspend pas les zones calmes)
  { id: 'militaires',     group: 'fdo',     label: 'Militaires (Sentinelle)', glyph: '🪖', ttl: 60 },
  { id: 'inter',          group: 'fdo',     label: 'Unités d’intervention (BRI, RAID, GIGN)', glyph: '🚨', ttl: 15 },
  { id: 'blinde',         group: 'fdo',     label: 'Blindé (Centaure, VBRG)', glyph: '🚛', ttl: 20 },
  { id: 'nasse',          group: 'fdo',     label: 'Nasse / encerclement',    glyph: '⭕', ttl: 20 },
  { id: 'interpellation', group: 'fdo',     label: 'Interpellations',         glyph: '⛓️', ttl: 20 },
  { id: 'lacrymo',        group: 'danger',  label: 'Lacrymo',                 glyph: '💨', ttl: 15 },
  { id: 'canon',          group: 'danger',  label: 'Canon à eau',             glyph: '🌊', ttl: 15 },
  { id: 'charge',         group: 'danger',  label: 'Charge',                  glyph: '⚡', ttl: 10 },
  { id: 'tirs',           group: 'danger',  label: 'Tirs LBD / grenades',     glyph: '💥', ttl: 10 },
  // Attaques de groupes d'extrême droite contre les cortèges : danger avec alerte, le point suit le groupe
  { id: 'facho',          group: 'danger',  label: 'Milice / groupe fasciste', glyph: '☠️', ttl: 20 },
  { id: 'chaud',          group: 'danger',  label: 'Point chaud',             glyph: '🔥', ttl: 20 },
  { id: 'sommations',     group: 'danger',  label: 'Sommations',              glyph: '📢', ttl: 20 },
  { id: 'medic',          group: 'soutien', label: 'Street medic',            glyph: '⛑️', ttl: 45 },
  { id: 'legal',          group: 'soutien', label: 'Legal team / observateurs', glyph: '⚖️', ttl: 60 },
  { id: 'presse',         group: 'soutien', label: 'Presse',                  glyph: '🎥', ttl: 45 },
  { id: 'calme',          group: 'soutien', label: 'Zone calme / repli',      glyph: '🕊️', ttl: 90 },
  { id: 'eau',            group: 'soutien', label: 'Eau / sérum phy',         glyph: '💧', ttl: 90 },
  // Tête et queue : un seul point chacune, qui suit le cortège (avec sa trace des 30 dernières minutes)
  { id: 'cortege',        group: 'info',    label: 'Tête de cortège',         glyph: '📣', ttl: 10 },
  { id: 'queue',          group: 'info',    label: 'Queue de cortège',        glyph: '🔚', ttl: 10 },
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
// ---- Noms d'orga : comparés sans accents, majuscules, espaces ni lettres sosies (cyrillique, grec) ----
// Le nom n'est qu'un affichage : les droits (retirer une annonce, un événement) passent par l'identifiant de l'orga.
const SOSIES = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ӏ': 'l',
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', '0': 'o', '1': 'l' };
const labelKey = l => String(l || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/./gu, c => SOSIES[c] || c).replace(/[^a-z0-9]/g, '');
const IMPORT_NAMES = ['17octobregiletjaune.net'];
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://cortege.neru.tv';
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
// Fusion : un signalement du même type dans ce rayon (m) confirme le point existant au lieu d'en créer un.
// « move » : le point glisse vers le signalement le plus récent (unités qui se déplacent).
const MERGE = {
  crs: { r: 100, move: true }, police: { r: 100, move: true }, bac: { r: 100, move: true }, canon: { r: 100, move: true },
  inter: { r: 100, move: true }, blinde: { r: 100, move: true }, tirs: { r: 100 }, militaires: { r: 60 }, facho: { r: 150, move: true },
  nasse: { r: 150 }, interpellation: { r: 80 }, lacrymo: { r: 150 }, charge: { r: 80 }, chaud: { r: 100 }, sommations: { r: 150 },
  medic: { r: 40 }, legal: { r: 40 }, presse: { r: 40 }, eau: { r: 40 }, calme: { r: 80 },
  cortege: { r: 2000, move: true }, queue: { r: 2000, move: true }, bloque: { r: 30 }, blocus: { r: 100 },
};
// Un danger actif à moins de 100 m d’une « zone calme » la suspend (affichage sur le téléphone) et empêche d’en créer une.
const CALM_KILL_M = 100;
// Dangers qui déclenchent une alerte de proximité (dans l'appli et en notification)
const ALERT_CATS = new Set(['sommations', 'lacrymo', 'canon', 'charge', 'tirs', 'facho', 'nasse', 'bac', 'inter', 'blinde', 'crs', 'interpellation']);
// Vibrations par type : on reconnaît le danger sans sortir le téléphone
const VIBES = {
  charge: [100, 60, 100, 60, 100, 60, 100, 60, 100],   // rafale courte : ça arrive vite
  nasse: [900, 200, 900],                              // deux longues : risque d'être bloqué·e
  sommations: [500, 150, 500, 150, 500],               // trois longues : partir
  lacrymo: [400, 150, 400],                            // deux moyennes
  canon: [250, 100, 250, 100, 250],                    // trois moyennes
  bac: [150, 80, 150, 80, 600],                        // deux courtes, une longue
  crs: [200, 100, 200],                                // deux courtes
  interpellation: [200, 100, 200, 100, 200],           // trois courtes
  tirs: [60, 40, 60, 40, 60, 40, 60, 40, 60, 40, 60],  // rafale très rapide : tirs
  inter: [150, 80, 150, 80, 150, 80, 600],             // trois courtes, une longue
  blinde: [700, 150, 250],                             // une longue, une courte
  facho: [600, 100, 150, 100, 150, 100, 600],          // une longue, deux courtes, une longue
};
const isDanger = cat => Object.hasOwn(CAT, cat) && cat !== 'militaires' && (CAT[cat].group === 'fdo' || CAT[cat].group === 'danger');
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

// Clés de hachage (HMAC) : une clé tirée au hasard pour chaque période (6 h pour les adresses IP, une journée pour les téléphones),
// détruite dès la période suivante terminée. Une copie ou une saisie du disque ne permet donc jamais de recalculer
// les empreintes des périodes passées, même avec le code du serveur.
// Fichiers dans DATA_DIR/keys (partagés entre processus, relus toutes les 5 s) ; SECRET_STORE=memory : seulement en mémoire
// (un seul processus). SECRET=… (variable fixe) : clés dérivées de cette valeur, sans cette protection.
const KEY_DIR = path.join(DATA_DIR, 'keys');
const SECRET_FILE = path.join(DATA_DIR, 'secret'); // ancienne clé unique (avant la 2.6.5), effacée au démarrage
const SECRET_MEMORY = process.env.SECRET_STORE === 'memory' && !process.env.SECRET;
fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
try { fs.unlinkSync(SECRET_FILE); } catch {}
const keyCache = new Map();
function periodKey(kind, bucket) {
  if (process.env.SECRET) return crypto.createHmac('sha256', process.env.SECRET).update(kind + '|' + bucket).digest('hex');
  const id = kind + '-' + bucket, now = Date.now(), hit = keyCache.get(id);
  if (hit && (SECRET_MEMORY || now - hit.t < 5000)) return hit.v;
  let v;
  if (SECRET_MEMORY) v = crypto.randomBytes(32).toString('hex');
  else {
    const f = path.join(KEY_DIR, id);
    try { v = fs.readFileSync(f, 'utf8'); } catch {
      const n = crypto.randomBytes(32).toString('hex');
      try { fs.writeFileSync(f, n, { mode: 0o600, flag: 'wx' }); v = n; } catch { v = fs.readFileSync(f, 'utf8'); }
      pruneKeys();
    }
  }
  keyCache.set(id, { v, t: now });
  return v;
}
// Seules la période en cours et la précédente sont gardées
function pruneKeys() {
  const keep = new Set([`ip-${ipBucket()}`, `ip-${ipBucket() - 1}`, `dev-${dayBucket()}`, `dev-${dayBucket() - 1}`]);
  for (const id of keyCache.keys()) if (!keep.has(id)) keyCache.delete(id);
  if (!SECRET_MEMORY) try { for (const f of fs.readdirSync(KEY_DIR)) if (!keep.has(f)) try { fs.unlinkSync(path.join(KEY_DIR, f)); } catch {} } catch {}
}
// Effacement d'urgence : toutes les clés détruites, de nouvelles sont tirées
function rotateSecret() {
  if (process.env.SECRET) return false;
  keyCache.clear();
  if (!SECRET_MEMORY) for (const f of fs.readdirSync(KEY_DIR)) try { fs.unlinkSync(path.join(KEY_DIR, f)); } catch {}
  return true;
}
// IP du téléphone, seulement pour l'anti-spam (jamais stockée en clair).
// - Derrière un CDN : en-tête CF-Connecting-IP (sinon tout le monde aurait l'IP du CDN
//   et l'anti-spam bloquerait des foules entières).
// - Sinon : dernière adresse publique de X-Forwarded-For, celle ajoutée par le proxy de l'hébergeur ;
//   les premières peuvent être inventées par le client pour contourner les limites.
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(10\.|127\.|192\.168\.))/i;
// Accès par Tor (.onion) : toutes les connexions arrivent du serveur lui-même. Le proxy local de l'adresse .onion
// ajoute X-Cortege-Onion ; l'anti-spam se fonde alors sur l'identifiant du téléphone, sinon tout Tor partagerait une seule limite.
const ONION_HOST = (process.env.ONION_HOST || '').trim();
// En-têtes de proxy crus seulement si la connexion vient du proxy lui-même : la machine (Caddy, Nginx, Tor),
// un socket local (Passenger) ou une adresse listée dans PROXY_IPS. Sinon, n'importe qui pourrait choisir son « IP ».
const PROXY_IPS = new Set((process.env.PROXY_IPS || '').split(',').map(x => x.trim()).filter(Boolean));
// CF-Connecting-IP : seulement si l'instance est vraiment derrière Cloudflare (CLOUDFLARE=1)
const CLOUDFLARE = process.env.CLOUDFLARE === '1';
// ONION_SECRET : valeur attendue dans X-Cortege-Onion (posée par le bloc .onion de Caddy). Sans elle, « 1 » comme avant.
const ONION_SECRET = process.env.ONION_SECRET || '';
const fromProxy = req => { const a = req.socket.remoteAddress || ''; return !a || /^(127\.|::1$|::ffff:127\.)/.test(a) || PROXY_IPS.has(a.replace(/^::ffff:/, '')); };
function viaOnion(req) {
  const h = String(req.headers['x-cortege-onion'] || '');
  return TRUST_PROXY && fromProxy(req) && (ONION_SECRET ? h.length === ONION_SECRET.length && keyEq(h, ONION_SECRET) : h === '1');
}
function clientIp(req) {
  if (viaOnion(req)) { const d = String(req.headers['x-device'] || ''); return 'onion:' + (/^[\w-]{16,64}$/.test(d) ? d : 'sans-id'); }
  if (TRUST_PROXY && fromProxy(req)) {
    const cf = CLOUDFLARE ? String(req.headers['cf-connecting-ip'] || '').trim() : '';
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
  const bucket = ipBucket();
  return crypto.createHmac('sha256', periodKey('ip', bucket)).update(bucket + '|' + ip).digest('base64url').slice(0, 16);
}
// Empreinte du téléphone : l'identifiant brut n'est jamais stocké, seulement son HMAC.
// Elle change chaque jour à 4 h (heure de Paris en été) : impossible de relier deux journées entre elles.
function dayBucket(now = Date.now()) { return Math.floor((now - 2 * 60 * MIN) / (24 * 60 * MIN)); }
function ipBucket(now = Date.now()) { return Math.floor(now / (6 * 60 * MIN)); }
function deviceHash(req) {
  const d = String(req.headers['x-device'] || '');
  if (!/^[\w-]{16,64}$/.test(d)) return 'ip:' + clientHash(req);
  const day = dayBucket();
  return 'd:' + crypto.createHmac('sha256', periodKey('dev', day)).update('dev|' + day + '|' + d).digest('base64url').slice(0, 16);
}

function keyEq(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
// Orgas créées depuis la page admin : seule l'empreinte (hash) de leur clé est stockée.
const ORGA_FILE = () => path.join(DATA_DIR, 'orgas.json');
const INVITE_MS = 24 * 60 * 60_000; // durée de validité d'une invitation d'orga
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
  // Une orga peut avoir plusieurs appareils : une clé principale (hash) et des clés d'appareils supplémentaires (keys)
  const o = readOrgas().find(o => keyEq(h, o.hash) || (o.keys || []).some(x => keyEq(h, x)));
  // Période d'essai : trial ; « parrainée » = invitée par une autre orga, surveillance renforcée jusqu'à sa confirmation
  if (o) return { id: o.id, label: o.label, admin: false, trial: o.trial === true, sponsored: o.sponsored === true && o.trial === true, by: o.by || null };
  keyFailed(req); return null;
}
// ---- Parrainage ----
const SPONSOR = { quota: 3, quotaMs: 7 * 24 * 60 * 60_000, banMs: 30 * 24 * 60 * 60_000, readyDays: 7, readyActions: 10, removeMax: 5, annPerDay: 3 };
const DEVICE_MS = 10 * 60_000, DEVICE_MAX = 5;
const banUntil = id => { const v = Number(getMeta('ban:' + id) || 0); return v > Date.now() ? v : 0; };
// Une parrainée est « prête à être confirmée » : assez ancienne, assez active, et rien de suspect dans son journal
function orgaReady(o) {
  const since = o.activated || o.created, days = Math.floor((Date.now() - since) / (24 * 60 * 60_000));
  const rows = q('SELECT action, COUNT(*) n FROM orga_log WHERE oid=? GROUP BY action').all(o.id);
  const actions = rows.filter(x => !/invitation|appareil/.test(x.action)).reduce((s, x) => s + x.n, 0);
  const bursts = rows.filter(x => x.action === 'retrait bloqué (rafale)').reduce((s, x) => s + x.n, 0);
  const restored = q("SELECT COUNT(*) n FROM orga_log WHERE action='restauré' AND detail=?").get('retiré par ' + o.label).n;
  return { ready: !!o.hash && days >= SPONSOR.readyDays && actions >= SPONSOR.readyActions && !bursts && !restored, days, actions, bursts, restored };
}
// Toutes les orgas entrées grâce à celle-ci (filleules, filleules des filleules…)
function descendants(list, id) {
  const out = [], todo = [id];
  while (todo.length) { const cur = todo.pop(); for (const o of list) if (o.by === cur && !out.includes(o.id)) { out.push(o.id); todo.push(o.id); } }
  return out;
}
const newInvite = () => { const token = crypto.randomBytes(18).toString('base64url'); return { token, invite: { h: sha(token), exp: Date.now() + INVITE_MS } }; };
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
  CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, status TEXT, end INTEGER, dev TEXT, data TEXT);
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

// ---- Réglages modifiables depuis l'admin (sans toucher aux variables du serveur) ----
// Bandeau d'événement (avec dates), vue d'ouverture, catégories (activées, durée), rayon d'alerte, distance des notifications.
// Les clés, chemins et liens restent dans les variables d'environnement.
const BASE_TTL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.ttl]));
let SET = { at: 0, v: {}, h: '' };
function settings() {
  const now = Date.now();
  if (now - SET.at > 3000) {
    const raw = getMeta('settings') || '{}';
    if (raw !== SET.raw) {
      let v = {}; try { v = JSON.parse(raw); } catch {}
      for (const c of CATEGORIES) { const o = v.cats?.[c.id]; c.ttl = o && o.ttl >= 5 && o.ttl <= 24 * 60 ? Math.round(o.ttl) : BASE_TTL[c.id]; c.off = !!(o && o.off); }
      SET = { at: now, v, raw };
    } else SET.at = now;
  }
  return SET.v;
}
function cleanSettings(b) {
  const s = {}, str = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const day = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null;
  if (b.banner && str(b.banner.text, 80)) s.banner = { text: str(b.banner.text, 80), from: day(b.banner.from), to: day(b.banner.to) };
  if (b.view) {
    const lat = Number(b.view.lat), lng = Number(b.view.lng), zoom = Math.round(Number(b.view.zoom));
    if (Math.abs(lat) <= 85 && Math.abs(lng) <= 180 && zoom >= 3 && zoom <= 17) s.view = { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, zoom };
  }
  if (b.cats && typeof b.cats === 'object') {
    s.cats = {};
    for (const c of CATEGORIES) {
      const o = b.cats[c.id]; if (!o) continue;
      const ttl = Math.round(Number(o.ttl)), out = {};
      if (o.off) out.off = true;
      if (ttl >= 5 && ttl <= 24 * 60 && ttl !== BASE_TTL[c.id]) out.ttl = ttl;
      if (Object.keys(out).length) s.cats[c.id] = out;
    }
  }
  const ar = Math.round(Number(b.alertRadius)); if (ar >= 50 && ar <= 2000) s.alertRadius = ar;
  const nk = Number(b.nearKm); if (nk >= 1 && nk <= 50) s.nearKm = Math.round(nk);
  return s;
}
function saveSettings(s) { setMeta('settings', JSON.stringify(s)); SET.at = 0; settings(); dirty.global = true; scheduleFlush(); }
// Journées de mobilisation prévues : notification la veille au soir, bandeau et mode renforcé le jour J, bilan proposé le lendemain
const mobsAll = () => { try { return JSON.parse(getMeta('mobs') || '[]'); } catch { return []; } };
const mobToday = (now = Date.now()) => { const d = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); return mobsAll().find(m => m.date === d) || null; };
// Bandeau affiché en haut de la carte : journée de mobilisation du jour, sinon bandeau des réglages (dans ses dates), sinon le nom par défaut
function bannerNow(now = Date.now()) {
  const m = mobToday(now); if (m) return m.title;
  const b = settings().banner, d = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  if (b && b.text && (!b.from || d >= b.from) && (!b.to || d <= b.to)) return b.text;
  return null;
}
const cfgHash = () => { const s = settings(); return crypto.createHash('sha1').update(JSON.stringify([s, bannerNow()])).digest('base64url').slice(0, 10); };

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
// Orga qui a créé le point (pour qu'elle puisse le prolonger ou le corriger), jamais publié
try { db.exec('ALTER TABLE reports ADD COLUMN oid TEXT'); } catch {}
// Trace (tête et queue de cortège) : positions des 30 dernières minutes [[lat, lng, heure]] ;
// bk : heure de début du partage de position en direct d'une orga (0 sinon)
try { db.exec('ALTER TABLE reports ADD COLUMN trail TEXT'); } catch {}
try { db.exec('ALTER TABLE reports ADD COLUMN bk INTEGER DEFAULT 0'); } catch {}
// Point de départ du partage de position en direct (jamais publié) : le partage s'arrête si l'orga s'en éloigne de plus de 2 km
try { db.exec('ALTER TABLE reports ADD COLUMN bkla REAL'); } catch {}
try { db.exec('ALTER TABLE reports ADD COLUMN bklo REAL'); } catch {}
// Depuis quand le serveur voit chaque téléphone (empreinte seulement), oublié 26 h après sa dernière action (l’empreinte change de toute façon chaque jour).
// Sert à ne pas compter les « Plus là » d'un identifiant tout juste créé.
db.exec('CREATE TABLE IF NOT EXISTS devices(h TEXT PRIMARY KEY, first INTEGER, seen INTEGER)');
// Fiabilité du jour : signalements confirmés par d'autres (good) ou contestés (bad). Repart de zéro chaque jour (empreinte quotidienne).
try { db.exec('ALTER TABLE devices ADD COLUMN good INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE devices ADD COLUMN bad INTEGER DEFAULT 0'); } catch {}
// Fiabilité du signalement à sa création : 1 = téléphone fiable, -1 = non fiable (série suspecte, mode renforcé)
try { db.exec('ALTER TABLE reports ADD COLUMN fl INTEGER DEFAULT 0'); } catch {}
// Tableau des abus : 48 h, position arrondie à ~1 km ; les empreintes (dev, net) sont effacées au bout d'une heure
db.exec(`CREATE TABLE IF NOT EXISTS abuse(id INTEGER PRIMARY KEY, t INTEGER, kind TEXT, lat REAL, lng REAL, dev TEXT, net TEXT, ref TEXT);
  CREATE INDEX IF NOT EXISTS abuse_t ON abuse(t);
  CREATE INDEX IF NOT EXISTS abuse_kind_dev ON abuse(kind, dev, t);`);
db.exec('CREATE INDEX IF NOT EXISTS reports_cell_ip ON reports(cell, ip)');
db.exec('CREATE INDEX IF NOT EXISTS reports_cat_lat ON reports(cat, lat)');
// ---- Journal des actions d'orgas (30 jours) et corbeille des retraits (1 h) ----
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
  dropReport(r.id, orga.id === 'admin' ? 'admin' : 'orga');
}
function orgaStats(oid) {
  const since = Date.now() - 24 * 60 * MIN;
  const rows = q('SELECT action, COUNT(*) n, MAX(t) last FROM orga_log WHERE oid=? AND t>? GROUP BY action').all(oid, since);
  const by = Object.fromEntries(rows.map(x => [x.action, x.n]));
  return { day: { verified: by['vérifié'] || 0, removed: (by['retiré'] || 0) + (by['retrait (essai)'] || 0), blocked: by['retrait bloqué (rafale)'] || 0,
    announcements: (by['annonce'] || 0) + (by['legal team (en attente)'] || 0) }, lastAction: rows.reduce((m, x) => Math.max(m, x.last), 0) || null };
}
const parseNotes = r => { let n = []; try { n = JSON.parse(r.notes || '[]'); } catch {} return n.length || !r.note ? n : [{ x: r.note, t: r.t }]; };
const parseTrail = r => { if (Array.isArray(r.trail)) return r.trail; try { return JSON.parse(r.trail || '[]'); } catch { return []; } };
const toReport = r => r && ({ id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note, notes: parseNotes(r), t: r.t, exp: r.exp, up: r.up, down: r.down,
  dw: r.dw || 0, ct: r.ct || 0, fl: r.fl || 0, ver: r.ver || null, voters: JSON.parse(r.voters || '[]'), downIps: JSON.parse(r.down_ips || '[]'), last: r.last || r.t, cell: r.cell, oid: r.oid || null,
  trail: parseTrail(r), bk: r.bk || 0, bkla: r.bkla ?? null, bklo: r.bklo ?? null });
// Trace d'un point qui suit le cortège : on garde l'ancienne position (si elle a bougé d'au moins 20 m), 30 min et 30 points au plus
// Tête : 60 min de trace (le tracé du cortège suit le chemin réel de la tête jusqu'à la queue) ; queue : 30 min
const TRAIL_CATS = new Set(['cortege', 'queue']), TRAIL_MS = { cortege: 60 * MIN, queue: 30 * MIN }, TRAIL_MAX = { cortege: 60, queue: 30 };
const BEACON_ROLES = new Set(['cortege', 'queue', 'medic', 'legal', 'presse']), BEACON_TTL = 3 * MIN, BEACON_MAX = 4 * 60 * MIN, BEACON_ZONE_M = 2000;
// Distance (m) d'un point au parcours le plus proche d'un événement en cours de l'agenda (Infinity s'il n'y en a pas)
function routeDistM(lat, lng, now = Date.now()) {
  let best = Infinity;
  for (const e of listEvents()) {
    if (!e.route || e.route.length < 2 || e.status === 'pending' || e.start > now + 60 * MIN || e.start < now - 12 * 60 * MIN) continue;
    const k = Math.cos(lat * Math.PI / 180), P = [lng * 111320 * k, lat * 110540];
    for (let i = 0; i < e.route.length - 1; i++) {
      const A = [e.route[i][1] * 111320 * k, e.route[i][0] * 110540], Bq = [e.route[i + 1][1] * 111320 * k, e.route[i + 1][0] * 110540];
      const dx = Bq[0] - A[0], dy = Bq[1] - A[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy));
    }
  }
  return best;
}
function addTrail(r, now) {
  if (!TRAIL_CATS.has(r.cat)) return;
  const tr = (r.trail || []).filter(p => p[2] > now - TRAIL_MS[r.cat]), lastP = tr[tr.length - 1];
  if (!lastP || distM({ lat: lastP[0], lng: lastP[1] }, r) >= 20) tr.push([r.lat, r.lng, r.last || r.t]);
  r.trail = tr.slice(-TRAIL_MAX[r.cat]);
}
const getReport = (id, now) => toReport(q('SELECT * FROM reports WHERE id=? AND exp>?').get(id, now));
const activeReports = (now, limit = 2000) => q('SELECT * FROM reports WHERE exp>? ORDER BY t DESC LIMIT ?').all(now, limit);
function saveReport(r) {
  const cell = cellId(r.lat, r.lng);
  if (r.cell && r.cell !== cell) dirtyCell(r.cell); // le point a glissé dans une autre case
  const notes = (r.notes || (r.note ? [{ x: r.note, t: r.t }] : [])).slice(0, NOTES_KEEP);
  r.note = notes[0] ? notes[0].x : ''; // la plus récente, pour les téléphones pas encore à jour
  q(`INSERT INTO reports(id,cat,lat,lng,cell,note,t,exp,up,down,ver,voters,down_ips,ip,last,notes,dw,ct,fl,oid,trail,bk,bkla,bklo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET cat=excluded.cat, lat=excluded.lat, lng=excluded.lng, cell=excluded.cell, note=excluded.note, notes=excluded.notes, exp=excluded.exp, up=excluded.up,
       down=excluded.down, ver=excluded.ver, voters=excluded.voters, down_ips=excluded.down_ips, last=excluded.last, dw=excluded.dw, ct=excluded.ct, fl=excluded.fl, trail=excluded.trail, bk=excluded.bk, bkla=excluded.bkla, bklo=excluded.bklo`)
    .run(r.id, r.cat, r.lat, r.lng, cell, r.note || '', r.t, r.exp, r.up || 0, r.down || 0, r.ver || null,
      JSON.stringify((r.voters || []).slice(-500)), JSON.stringify((r.downIps || []).slice(-100)), r.ip || null, r.last || r.t, JSON.stringify(notes), r.dw || 0, r.ct || 0, r.fl || 0, r.oid || null,
      r.trail && r.trail.length ? JSON.stringify(r.trail) : null, r.bk || 0, r.bkla ?? null, r.bklo ?? null);
  dirtyCell(cell);
}
// outcome : ce qu'est devenu le point, pour le digest (orga, admin, full = zone saturée, purge…)
function dropReport(id, outcome) {
  const r = q('DELETE FROM reports WHERE id=? RETURNING *').get(id);
  if (r) { archive(r, outcome || 'removed'); dirtyCell(r.cell); }
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
// Plafonds des tables qui grandissent avec le trafic (même en cas d'attaque, la base garde une taille raisonnable) :
// au-delà, les lignes les plus anciennes partent d'abord
const TABLE_CAPS = [['devices', 'seen', 500_000], ['abuse', 't', 200_000], ['rate', 't', 500_000], ['quota', 't', 200_000], ['orga_log', 't', 200_000]];
function capTables() {
  for (const [t, col, max] of TABLE_CAPS) {
    const n = q(`SELECT COUNT(*) n FROM ${t}`).get().n;
    if (n > max) q(`DELETE FROM ${t} WHERE rowid IN (SELECT rowid FROM ${t} ORDER BY ${col} LIMIT ?)`).run(n - Math.floor(max * 0.9));
  }
}
// Quotas sur une période plus longue (une heure, un jour…) : notifications urgentes par orga, abonnements par réseau…
db.exec('CREATE TABLE IF NOT EXISTS quota(k TEXT PRIMARY KEY, t INTEGER, n INTEGER)');
function quota(key, max, windowMs, now = Date.now()) {
  const r = q('SELECT t, n FROM quota WHERE k=?').get(key), cur = r && now - r.t < windowMs ? r : { t: now, n: 0 };
  if (cur.n >= max) return false;
  q('INSERT OR REPLACE INTO quota(k,t,n) VALUES(?,?,?)').run(key, cur.t, cur.n + 1);
  return true;
}
// Limites des orgas (hors admin) : vérifications par 5 min, annonces urgentes par heure, annonces et événements par jour
const ORGA_LIMITS = { verify: Number(process.env.ORGA_VERIFY_MAX) || 30, urgentPerHour: Number(process.env.ORGA_URGENT_MAX) || 3, annPerDay: 30, eventsPerDay: 20 };
// Vrai si ce téléphone ET cette IP sont sous leurs limites.
function allow(dev, ip, kind, now) {
  const rep = kind === 'report', cur = q('SELECT t, reports, votes FROM rate WHERE k=?').get('ip:' + ip);
  if (cur && now - cur.t <= RATE.windowMs && cur[kind + 's'] >= (rep ? RATE.ipReports : RATE.ipVotes)) return false;
  const strict = strictUntil(now) > 0;
  if (!bump(dev, kind, rep ? (strict ? Math.ceil(RATE.maxReports / 2) : RATE.maxReports) : RATE.maxVotes, now)) return false;
  bump('ip:' + ip, kind, Infinity, now);
  return true;
}
// ---- « Plus là » : un point n'est jamais effacé par des votes, il devient « contesté » ----
// Contesté = grisé, et il ne lui reste que quelques minutes ; une confirmation le remet en état normal.
// Poids d'un « Plus là » : ×2 si le téléphone dit être sur place (calcul fait sur le téléphone, la position
// ne part jamais), ×2 si l'identifiant n'est pas tout neuf. Il en faut davantage pour chaque confirmation.
const CONTEST = { near: 2, aged: 2, need: 8, perUp: 4, more: 8, soft: 10 * MIN, short: 2 * MIN, newDev: 10 * MIN,
  devKeep: 26 * 60 * MIN, devBurst: 6, netBurst: 60 };
const VOTES = { id: 'votes', label: 'Votes « Plus là »' };
// Âge de l'identifiant du téléphone (0 si inconnu ou sans identifiant), et note qu'il vient d'agir
function deviceAge(dev, now) {
  if (!dev.startsWith('d:')) return 0;
  const row = q('SELECT first FROM devices WHERE h=?').get(dev);
  q('INSERT INTO devices(h,first,seen) VALUES(?,?,?) ON CONFLICT(h) DO UPDATE SET seen=excluded.seen').run(dev, now, now);
  return row ? now - row.first : 0;
}
// Un signalement d'un téléphone fiable demande une personne de plus pour être contesté
const contestNeed = r => CONTEST.need + CONTEST.perUp * (r.up || 0) + (r.fl === 1 ? CONTEST.perUp : 0);
// ---- Fiabilité du jour ----
const TRUST = 2; // fiable : (confirmés par d'autres) − 2 × (contestés) ≥ 2
function devRep(dev) { const x = dev.startsWith('d:') && q('SELECT good, bad FROM devices WHERE h=?').get(dev); return x ? (x.good || 0) - 2 * (x.bad || 0) : 0; }
function repAdd(dev, field, n = 1) {
  if (!dev || !dev.startsWith('d:') || (field !== 'good' && field !== 'bad')) return;
  q(`UPDATE devices SET ${field}=COALESCE(${field},0)+? WHERE h=?`).run(n, dev);
}
// Première confirmation par quelqu'un d'autre : l'auteur gagne en fiabilité, le point n'est plus « non fiable »
function firstConfirm(r) { if (r.up === 1) { repAdd(r.voters[0], 'good'); if (r.fl === -1) r.fl = 0; } }
// ---- Mode manif renforcé (réglage admin, avec une durée) ----
const strictUntil = now => { const p = Number(getMeta('strict') || 0); return p > now ? p : 0; };
// ---- Tableau des abus ----
const ABUSE_KEEP = 48 * 60 * MIN;
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
function abuseLog(kind, { lat, lng, dev, net, ref } = {}) {
  try { q('INSERT INTO abuse(t,kind,lat,lng,dev,net,ref) VALUES(?,?,?,?,?,?,?)').run(Date.now(), kind, r2(lat), r2(lng), dev || null, net || null, ref || null); } catch {}
}
// Une seule ligne par téléphone et par fenêtre (sinon une rafale remplirait le tableau)
function abuseOnce(kind, dev, windowMs, extra = {}) {
  if (q('SELECT 1 FROM abuse WHERE kind=? AND dev=? AND t>?').get(kind, dev, Date.now() - windowMs)) return;
  abuseLog(kind, { ...extra, dev });
}
// Faux dangers en série : un même téléphone (ou réseau) qui signale des dangers près de plusieurs zones calmes différentes
const SERIES = { win: 30 * MIN, dev: 3, net: 6 };
function calmSeries(dev, net, now) {
  const d = q("SELECT COUNT(DISTINCT ref) n FROM abuse WHERE kind='danger près zone calme' AND dev=? AND t>?").get(dev, now - SERIES.win).n;
  const n = q("SELECT COUNT(DISTINCT ref) n FROM abuse WHERE kind='danger près zone calme' AND net=? AND t>?").get(net, now - SERIES.win).n;
  return d >= SERIES.dev || n >= SERIES.net;
}
// File de modération, la plus urgente d'abord :
// 1 danger contesté (« Plus là »), 2 danger d'une série près de zones calmes, 3 point isolé (à plus de 500 km de toute autre activité)
// ou autre point contesté, 4 « Plus là » isolés ou point hors de France, 5 simple « pas encore confirmé » (téléphone récent, mode renforcé),
// caché par défaut dans l'admin.
const ISOLATED_KM = 500;
function modQueue(now = Date.now()) {
  const act = q('SELECT * FROM reports WHERE exp>? ORDER BY t DESC LIMIT 5000').all(now);
  const cells = new Map();
  for (const x of act) { const k = Math.floor(x.lat) + '_' + Math.floor(x.lng); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(x); }
  const isolated = x => {
    if (act.length < 10 || cells.get(Math.floor(x.lat) + '_' + Math.floor(x.lng)).length > 1) return false;
    return !act.some(y => y !== x && distKm(x.lat, x.lng, y.lat, y.lng) <= ISOLATED_KM);
  };
  const out = [];
  for (const x of act) {
    const danger = isDanger(x.cat), why = [];
    if (x.ct > 0) why.push('contested'); else if (x.down > 0) why.push('down');
    let series = false;
    if (x.fl === -1 && !x.up) {
      series = danger && nearby('calme', x.lat, x.lng, CALM_KILL_M, now).some(c => !c.r.ct);
      why.push(series ? 'series' : 'new');
    }
    const abroad = !inFrance(x.lat, x.lng), iso = isolated(x);
    if (iso) why.push('isolated');
    if (abroad) why.push('abroad');
    if (!why.length) continue;
    const prio = x.ct > 0 && danger ? 1 : series ? 2 : iso || x.ct > 0 ? 3 : x.down > 0 || abroad ? 4 : 5;
    out.push({ ...publicView(toReport(x)), dw: x.dw || 0, fl: x.fl || 0, ct: x.ct || 0, place: abroad ? 'Hors de France' : whereOf(x.lat, x.lng).name,
      group: CAT[x.cat] ? CAT[x.cat].group : '', why, prio, low: prio === 5 });
  }
  out.sort((a, b) => a.prio - b.prio || b.t - a.t);
  return out.slice(0, 400);
}
// Copie du point tel qu'il était avant d'être contesté : l'admin peut le remettre pendant 1 h
function snapshotContested(r, now) {
  q('INSERT OR REPLACE INTO trash(id,t,oid,orga,data) VALUES(?,?,?,?,?)').run(r.id, now, VOTES.id, VOTES.label, JSON.stringify({ ...r, left: r.exp - now }));
}

// Ménage toutes les 30 s : signalements, annonces et événements expirés, limites périmées, fin de pause.
function sweep() {
  const now = Date.now();
  try { pruneKeys(); } catch {}
  try { q('DELETE FROM quota WHERE t<?').run(now - 2 * 24 * 60 * MIN); capTables(); } catch (e) { console.error('plafonds', e.message); }
  try {
    const expired = tx(() => q('DELETE FROM reports WHERE exp<=? RETURNING *').all(now));
    for (const r of expired) { archive(r, r.ct ? 'cont' : 'exp'); dirtyCell(r.cell); }
    if (q('DELETE FROM ann WHERE exp<=?').run(now).changes) dirty.ann = true;
    if (q('DELETE FROM events WHERE start<=?').run(now - EVENT_KEEP).changes) dirty.events = true;
    if (q('DELETE FROM orders WHERE end<=?').run(now).changes) dirty.ord = true;
    q('DELETE FROM rate WHERE t<?').run(now - RATE.windowMs);
    q('DELETE FROM hidden WHERE until<?').run(now);
    q('DELETE FROM trash WHERE t<?').run(now - TRASH_MS);
    q('DELETE FROM devices WHERE seen<?').run(now - CONTEST.devKeep);
    q('DELETE FROM abuse WHERE t<?').run(now - ABUSE_KEEP);
    q('UPDATE abuse SET dev=NULL, net=NULL WHERE t<? AND (dev IS NOT NULL OR net IS NOT NULL)').run(now - 60 * MIN);
    q('DELETE FROM orga_log WHERE t<?').run(now - ARCHIVE_DAYS * 24 * 60 * MIN);
    const p = Number(getMeta('paused') || 0);
    if (p && p <= now) { setMeta('paused', 0); dirty.global = true; }
    if (expired.length || dirty.ann || dirty.events || dirty.ord || dirty.global) scheduleFlush(0);
  } catch (e) { if (!isBusy(e)) console.error('ménage', e.message); }
}
setInterval(sweep, 30_000).unref();
const NOTES_KEEP = 3;
// Ajoute (ou remplace) la précision d'un téléphone sur un point ; les plus récentes d'abord
function addNote(r, text, dev, t) {
  const notes = (r.notes || []).filter(n => n.d !== dev && n.x.toLowerCase() !== text.toLowerCase());
  r.notes = [{ x: text, t, d: dev }, ...notes].slice(0, NOTES_KEEP);
}
// tr : trace de la tête ou de la queue (positions arrondies à ~11 m, heures en secondes) ; live : position partagée en direct par une orga
const trailView = r => { if (!TRAIL_CATS.has(r.cat)) return {}; const tr = parseTrail(r); return tr.length ? { tr: tr.map(p => [p[0], p[1], Math.round(p[2] / 1000)]) } : {}; };
const publicView = r => ({ ...trailView(r), ...(r.bk ? { live: 1 } : {}), id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note,
  notes: (Array.isArray(r.notes) ? r.notes : parseNotes(r)).map(n => ({ x: n.x, t: n.t })), t: r.t, last: r.last || r.t, exp: r.exp, up: r.up, down: r.down, ver: r.ver || null, ...(r.ct ? { c: 1 } : {}), ...(r.fl === 1 ? { f: 1 } : r.fl === -1 && !r.up ? { nf: 1 } : {}) });
const annView = a => ({ id: a.id, kind: a.kind, level: a.level, text: a.text, phone: a.phone || null, city: a.city || null, by: a.by, ob: ownerTag(a.oid), lat: a.lat, lng: a.lng, r: a.r,
  national: !!a.national, permanent: !!a.permanent, link: a.link || null, t: a.t, exp: a.exp, ...(a.pending ? { pending: true } : {}) });
const evView = e => ({ id: e.id, type: e.type, title: e.title, place: e.place, note: e.note, start: e.start, lat: e.lat, lng: e.lng,
  route: e.route || null, end: !!e.end, by: e.by, ob: ownerTag(e.oid), status: e.status, link: e.link || null, src: e.src || null, t: e.t });
const round = n => Math.round(n * 1e4) / 1e4; // ~11 m
const EVENT_KEEP = 12 * 60 * MIN;  // un événement reste affiché 12 h après son début
const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const validLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
function distKm(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Qui peut retirer une annonce ou un événement : l'admin, ou l'orga qui l'a publié (par son identifiant, jamais par son nom)
const canManage = (orga, x) => !!orga && (orga.admin || (!!x.oid && x.oid === orga.id));
// Empreinte publique de l'auteur (l'appli sait ainsi afficher « retirer » sur ses propres annonces), sans révéler l'identifiant
const ownerTag = oid => oid ? sha('owner|' + oid).slice(0, 12) : null;
// Noms interdits : celui de l'admin, les sources importées, les orgas existantes ; pour une orga invitée par parrainage,
// aussi l'annuaire des legal teams et tout nom qui contient celui de l'admin (« Cortège officiel »…)
function labelClash(label, { sponsor = false, except = null } = {}) {
  const k = labelKey(label), admin = labelKey(ADMIN_LABEL);
  if (k.length < 2) return 'Ce nom est trop court.';
  const reserved = [ADMIN_LABEL, 'Cortège', 'admin', 'administration', 'modération', VOTES.label, ...IMPORT_NAMES].map(labelKey);
  if (reserved.includes(k) || (sponsor && (k.includes(admin) || k.includes('cortege')))) return 'Ce nom est réservé.';
  if (readOrgas().some(o => o.id !== except && labelKey(o.label) === k) || ORGAS.some(o => labelKey(o.label) === k)) return 'Une orga porte déjà ce nom.';
  if (sponsor && legalAll().some(e => labelKey(e.name) === k)) return 'Ce nom est celui d’une legal team de l’annuaire : seul·e l’admin peut l’inviter.';
  return null;
}
// Annonces et événements d'avant la 2.6.4 : auteur retrouvé par son nom, seulement s'il n'y a aucun doute
function migrateOwners() {
  const owners = new Map(), addO = (label, id) => { const k = labelKey(label); owners.set(k, [...(owners.get(k) || []), id]); };
  addO(ADMIN_LABEL, 'admin'); for (const o of ORGAS) addO(o.label, 'env:' + o.label); for (const o of readOrgas()) addO(o.label, o.id);
  const pick = by => { if (IMPORT_NAMES.includes(by)) return 'import'; const ids = owners.get(labelKey(by)) || []; return ids.length === 1 ? ids[0] : null; };
  let n = 0;
  tx(() => {
    for (const x of q('SELECT id, data FROM ann').all()) { const a = JSON.parse(x.data); if ('oid' in a) continue; a.oid = pick(a.by); q('UPDATE ann SET data=? WHERE id=?').run(JSON.stringify(a), x.id); n++; }
    for (const x of q('SELECT id, data FROM events').all()) { const e = JSON.parse(x.data); if ('oid' in e) continue; e.oid = e.src ? 'import' : pick(e.by); q('UPDATE events SET data=? WHERE id=?').run(JSON.stringify(e), x.id); n++; }
  });
  if (n) console.log(`auteurs : ${n} annonce(s) ou événement(s) rattaché(s) à leur orga`);
}

// Création d'annonce, partagée par l'espace orga et la page admin.
//  - numéro de legal team : permanent, jusqu'à ce que l'orga (ou l'admin) le retire ;
//  - annonce nationale : réservée à l'admin, visible partout en France.
function createAnnouncement(b, by, admin, pending = false, oid = admin ? 'admin' : null) {
  const kind = b.kind === 'legal' ? 'legal' : 'info';
  const national = kind === 'info' && !!b.national && admin;
  const level = kind === 'info' && b.level === 'urgent' ? 'urgent' : 'info';
  const text = clean(b.text, ANN_MAX);
  // Lien « En savoir plus » : réservé à l'admin (évite les liens piégés)
  const link = admin && kind === 'info' && /^https:\/\/[^\s"<>]{4,300}$/.test(String(b.link || '').trim()) ? String(b.link).trim() : '';
  const phone = kind === 'legal' ? String(b.phone || '').replace(/[^\d+ .]/g, '').trim().slice(0, 20) : '';
  const city = kind === 'legal' ? clean(b.city, 40) : '';
  const lat = Number(b.lat), lng = Number(b.lng);
  const r = national ? 0 : Math.min(Math.max(Number(b.radiusKm) || 3, 0.5), 50);
  const minutes = Math.min(Math.max(Number(b.minutes) || 60, 10), 24 * 60);
  if (kind === 'info' && text.length < 3) return [400, { error: 'Écris le message de l’annonce.' }];
  if (kind === 'legal' && phone.replace(/\D/g, '').length < 6) return [400, { error: 'Numéro de téléphone invalide.' }];
  if (kind === 'legal' && city.length < 2) return [400, { error: 'Indique la ville de la legal team.' }];
  if (!national && !validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  const now = Date.now();
  const a = { id: crypto.randomBytes(6).toString('base64url'), kind, level, text, phone, ...(city ? { city } : {}), by, oid, link,
    lat: national ? CENTER[0] : round(lat), lng: national ? CENTER[1] : round(lng), r, national, permanent: kind === 'legal',
    t: now, exp: kind === 'legal' ? now + 3650 * 24 * 60 * MIN : now + minutes * MIN };
  if (pending) a.pending = true; // annonce d'une orga en essai : affichée après validation par l'admin
  saveAnn(a);
  if (a.level === 'urgent' && !a.pending) pushBroadcast(a).catch(e => console.error('push', e.message));
  return [201, annView(a)];
}

// ---- Annuaire permanent des legal teams ----
// Rempli par l'admin (à partir d'une liste de départ non validée). Seules les lignes validées sont publiées
// (live/legal.json). Une veille quotidienne relit la page source de chaque ligne et prévient l'admin si le
// numéro n'y figure plus ou si d'autres numéros apparaissent. Elle ne publie et ne modifie jamais rien.
db.exec('CREATE TABLE IF NOT EXISTS legal_dir(id TEXT PRIMARY KEY, data TEXT)');
const legalAll = () => q('SELECT data FROM legal_dir').all().map(x => JSON.parse(x.data)).sort((a, b) => a.city.localeCompare(b.city, 'fr') || a.name.localeCompare(b.name, 'fr'));
const getLegal = id => { const x = q('SELECT data FROM legal_dir WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveLegal(e) { q('INSERT OR REPLACE INTO legal_dir(id,data) VALUES(?,?)').run(e.id, JSON.stringify(e)); dirty.legal = true; scheduleFlush(); }
const legalView = e => ({ id: e.id, city: e.city, lat: e.lat, lng: e.lng, name: e.name, phone: e.phone, signal: !!e.signal, src: e.src || null, checked: e.checked || null });
const phoneDigits = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2); return d; };
// Tous les numéros français d'une page, normalisés (0XXXXXXXXX)
const phonesIn = text => [...new Set((String(text).match(/(?:\+33[\s.\-]?|0)[1-9](?:[\s.\-]?\d{2}){4}/g) || []).map(phoneDigits))].sort();
function cleanLegal(b, old) {
  const e = { ...(old || {}) };
  e.city = clean(b.city ?? e.city, 40); e.name = clean(b.name ?? e.name, 80);
  e.phone = String(b.phone ?? e.phone ?? '').replace(/[^\d+ .]/g, '').trim().slice(0, 20);
  e.signal = b.signal === undefined ? !!e.signal : !!b.signal;
  const src = String(b.src ?? e.src ?? '').trim();
  e.src = /^https?:\/\/[^\s"<>]{4,400}$/.test(src) ? src : null;
  if (b.lat !== undefined) { e.lat = round(Number(b.lat)); e.lng = round(Number(b.lng)); }
  if (b.srcDate !== undefined) e.srcDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.srcDate)) ? b.srcDate : null;
  if (e.city.length < 2) return [400, 'Indique la ville.'];
  if (e.name.length < 2) return [400, 'Indique le nom du collectif.'];
  if (phoneDigits(e.phone).length < 6) return [400, 'Numéro de téléphone invalide.'];
  if (!validLatLng(e.lat, e.lng)) return [400, 'Position invalide (choisis la ville dans la recherche).'];
  return [200, e];
}
function seedLegal() {
  if (getMeta('legalseed')) return;
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'legal-seed.json'), 'utf8'));
    for (const b of list) if (!getLegal(b.id)) { const [st, e] = cleanLegal(b, { id: b.id, ok: false, added: Date.now(), seed: true }); if (st === 200) saveLegal(e); }
  } catch (e) { if (e.code !== 'ENOENT') console.error('annuaire', e.message); }
  setMeta('legalseed', Date.now());
}
const LEGAL_WATCH_MS = 24 * 60 * MIN;
// Adresse publique seulement : jamais le serveur lui-même, le réseau local, ni les adresses internes des hébergeurs (métadonnées)
const BLOCKED_IP = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|198\.1[89]\.|22[4-9]\.|2[3-5]\d\.|::$|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|::ffff:(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.))/i;
// Page web d'une source (veille des legal teams) : HTTP(S) sur les ports habituels, adresse vérifiée au moment même de la connexion
// (une redirection ou un nom de domaine qui change d'adresse ne peut pas mener au réseau interne), 3 redirections au plus.
function fetchPublic(url, { max = 3_000_000, timeout = 15000, hops = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('adresse invalide')); }
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port) && process.env.FETCH_ALLOW_PRIVATE !== '1') || u.username || u.password) return reject(new Error('adresse refusée'));
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const lookup = (host, opts, cb) => require('dns').lookup(host, { ...opts, all: false }, (err, addr, fam) => {
      if (err) return cb(err);
      if (BLOCKED_IP.test(addr) && process.env.FETCH_ALLOW_PRIVATE !== '1') return cb(new Error('adresse interne refusée'));
      cb(null, addr, fam);
    });
    const req = lib.get(u, { lookup, timeout, headers: { 'user-agent': 'Cortege-veille/1 (verification annuaire legal teams)' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops <= 0) return reject(new Error('trop de redirections'));
        return resolve(fetchPublic(new URL(res.headers.location, u).href, { max, timeout, hops: hops - 1 }));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0; const parts = [];
      res.on('data', c => { size += c.length; if (size > max) { res.destroy(); resolve(Buffer.concat(parts).toString('utf8')); } else parts.push(c); });
      res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      res.on('error', () => reject(new Error('lecture interrompue')));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e2 => reject(new Error(/interne|refusée|délai/.test(e2.message) ? e2.message : 'site injoignable')));
  });
}
async function watchOne(e) {
  const w = { at: Date.now() };
  try {
    const html = await fetchPublic(e.src);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
    w.phones = phonesIn(text);
    w.found = w.phones.includes(phoneDigits(e.phone));
  } catch (err) { w.err = String(err.message).slice(0, 80); }
  return w;
}
// État de la veille pour une ligne : ok, missing (numéro absent de la source), changed (numéros différents), error
function watchStatus(e) {
  const w = e.watch; if (!w) return 'new';
  if (w.err) return 'error';
  if (!w.found) return 'missing';
  if (e.base && JSON.stringify(e.base) !== JSON.stringify(w.phones)) return 'changed';
  return 'ok';
}
async function legalWatch(force = false) {
  // Un seul processus fait la veille : on réserve le tour dans la base
  const claimed = tx(() => { const last = +getMeta('legalwatch') || 0; if (!force && Date.now() - last < LEGAL_WATCH_MS) return false; setMeta('legalwatch', Date.now()); return true; });
  if (!claimed) return false;
  for (const e of legalAll().filter(x => x.src)) {
    const w = await watchOne(e);
    const cur = getLegal(e.id); if (!cur) continue;
    cur.watch = w;
    if (!cur.base && w.phones && w.found) cur.base = w.phones; // première lecture réussie : sert de référence
    q('INSERT OR REPLACE INTO legal_dir(id,data) VALUES(?,?)').run(cur.id, JSON.stringify(cur)); // pas de republication : rien de public ne change
  }
  return true;
}
const legalAlerts = () => legalAll().filter(e => ['missing', 'changed', 'error'].includes(watchStatus(e)) || !e.ok).length;


// ---- Demandes d'accès orga (formulaire dans l'appli, au lieu d'un e-mail) ----
// Gardé : nom du collectif, ville, rôle, lien public, canal officiel du collectif, garant éventuel, message.
// Supprimé dès que l'admin a traité la demande, et au plus tard au bout de 30 jours. Ni IP ni identifiant du téléphone.
db.exec('CREATE TABLE IF NOT EXISTS orga_req(id TEXT PRIMARY KEY, t INTEGER, data TEXT)');
const OREQ_DAYS = 30;
function orgaRequest(b) {
  const f = { collective: clean(b.collective, 80), city: clean(b.city, 60), role: clean(b.role, 40), link: String(b.link || '').trim().slice(0, 300),
    since: clean(b.since, 40), contact: clean(b.contact, 120), sponsor: clean(b.sponsor, 120), note: clean(b.note, 600) };
  if (f.collective.length < 2) return [400, { error: 'Indique le nom du collectif.' }];
  if (f.city.length < 2) return [400, { error: 'Indique la ville ou le secteur.' }];
  if (!/^https:\/\/[^\s"<>]{4,300}$/.test(f.link)) return [400, { error: 'Donne le lien public du collectif (site, Instagram…), en https://' }];
  if (f.contact.length < 3) return [400, { error: 'Indique le canal officiel du collectif où te confirmer la demande.' }];
  const now = Date.now();
  q('DELETE FROM orga_req WHERE t<?').run(now - OREQ_DAYS * 24 * 60 * MIN);
  if (q('SELECT COUNT(*) n FROM orga_req').get().n >= 500) return [503, { error: 'Trop de demandes en attente, réessaie dans quelques jours.' }];
  const id = crypto.randomBytes(6).toString('base64url');
  q('INSERT INTO orga_req(id,t,data) VALUES(?,?,?)').run(id, now, JSON.stringify(f));
  return [201, { ok: true }];
}
const orgaRequests = () => { q('DELETE FROM orga_req WHERE t<?').run(Date.now() - OREQ_DAYS * 24 * 60 * MIN);
  return q('SELECT id, t, data FROM orga_req ORDER BY t').all().map(x => ({ id: x.id, t: x.t, ...JSON.parse(x.data) })); };

// ---- Villes et agglomérations (digest) ----
// Liste des villes de plus de 5 000 habitant·es (France, outre-mer, pays voisins francophones), d'après GeoNames (CC BY 4.0).
// Un point est rattaché à la plus grande ville dont il est assez proche (rayon qui grandit avec la population :
// environ 14 km pour Paris, 10 km pour Montpellier), sinon à la ville la plus proche.
const PLACES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'places.json'), 'utf8')); } catch { return []; } })();
const PLACE_POP = new Map();
for (const [n, , , p, c] of PLACES) PLACE_POP.set(n + '|' + c, (PLACE_POP.get(n + '|' + c) || 0) + p);
const placeCache = new Map();
function placeOf(lat, lng) {
  const key = lat.toFixed(2) + ',' + lng.toFixed(2);
  if (placeCache.has(key)) return placeCache.get(key);
  const k = Math.cos(lat * Math.PI / 180);
  let pole = null, near = null, nearD = Infinity;
  for (const [n, la, lo, , c] of PLACES) {
    const dy = (la - lat) * 111; if (dy > 30 || dy < -30) continue;
    const d = Math.hypot(dy, (lo - lng) * 111 * k); if (d > 30) continue;
    const pop = PLACE_POP.get(n + '|' + c);
    if (d < nearD) { nearD = d; near = n; }
    if (pop >= 20000 && d <= Math.min(20, 6 + 4 * Math.log10(pop / 20000)) && (!pole || pop > pole.pop)) pole = { n, pop };
  }
  const name = pole ? pole.n : near && nearD <= 15 ? near : `${lat.toFixed(1)}, ${lng.toFixed(1)}`;
  if (placeCache.size > 50000) placeCache.clear();
  placeCache.set(key, name);
  return name;
}

// ---- Communes : contours OpenStreetMap (limites administratives de niveau 8), extraits pendant l'import mensuel ----
// Gardés dans la base (simplifiés à ~50 m) : un point est rattaché à la commune qui le contient, sans aucun service extérieur.
db.exec('CREATE TABLE IF NOT EXISTS communes(id TEXT PRIMARY KEY, insee TEXT, name TEXT, minlat REAL, minlng REAL, maxlat REAL, maxlng REAL, data TEXT, seen INTEGER)');
let COMM = null;
const commPolys = new Map(), commCache = new Map();
function commIndex() {
  if (COMM) return COMM;
  const rows = q('SELECT id, insee, name, minlat, minlng, maxlat, maxlng FROM communes').all();
  const b = new Float64Array(rows.length * 4);
  rows.forEach((r, i) => { b[i * 4] = r.minlat; b[i * 4 + 1] = r.minlng; b[i * 4 + 2] = r.maxlat; b[i * 4 + 3] = r.maxlng; });
  return (COMM = { rows, b });
}
const commReset = () => { COMM = null; commPolys.clear(); commCache.clear(); frCache.clear(); };
// Point dans un contour (coordonnées [lng, lat]), puis dans une surface avec ses trous
function ringHas(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyHas = (p, lat, lng) => p.some(poly => ringHas(poly[0], lng, lat) && !poly.slice(1).some(h => ringHas(h, lng, lat)));
function communeOf(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (commCache.has(key)) return commCache.get(key);
  const { rows, b } = commIndex();
  let hit = null;
  for (let i = 0; i < rows.length && !hit; i++) {
    if (lat < b[i * 4] || lat > b[i * 4 + 2] || lng < b[i * 4 + 1] || lng > b[i * 4 + 3]) continue;
    const r = rows[i];
    let p = commPolys.get(r.id);
    if (!p) {
      const x = q('SELECT data FROM communes WHERE id=?').get(r.id);
      p = x ? JSON.parse(x.data) : [];
      if (commPolys.size > 500) commPolys.delete(commPolys.keys().next().value);
      commPolys.set(r.id, p);
    }
    if (polyHas(p, lat, lng)) hit = { id: r.insee || r.id, name: r.name, fr: !!r.insee };
  }
  if (commCache.size > 50000) commCache.clear();
  commCache.set(key, hit);
  return hit;
}
// En France ou non : départements (contours IGN), outre-mer (boîtes), commune française connue, ou ville française à moins de 6 km
const FR_CC = new Set(['FR', 'GP', 'MQ', 'GF', 'RE', 'YT', 'PM', 'BL', 'MF', 'NC', 'PF', 'WF']);
const OUTRE_MER = [[15.8, -61.9, 16.55, -60.95], [14.35, -61.25, 14.9, -60.8], [2.1, -54.65, 5.8, -51.6], [-21.4, 55.2, -20.85, 55.85], [-13.05, 44.95, -12.6, 45.35],
  [46.7, -56.45, 47.15, -56.1], [17.85, -63.17, 18.13, -62.78], [-22.8, 163.5, -19.5, 168.2], [-28, -155, -7, -134], [-14.4, -178.3, -13.1, -176]];
const frCache = new Map();
function inFrance(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  let v = frCache.get(key);
  if (v !== undefined) return v;
  v = OUTRE_MER.some(([a, b, c, d]) => lat >= a && lat <= c && lng >= b && lng <= d)
    || DEPS.some(d => d.p && d.b && lat >= d.b[0] - 0.01 && lat <= d.b[2] + 0.01 && lng >= d.b[1] - 0.01 && lng <= d.b[3] + 0.01 && polyHas(d.p, lat, lng));
  if (!v) { const c = communeOf(lat, lng); if (c && c.fr) v = true; }
  if (!v) {
    const k = Math.cos(lat * Math.PI / 180); let best = Infinity, cc = null;
    for (const [, la, lo, , c] of PLACES) {
      const dy = (la - lat) * 111; if (dy > 6 || dy < -6) continue;
      const dd = Math.hypot(dy, (lo - lng) * 111 * k); if (dd < best) { best = dd; cc = c; }
    }
    v = best <= 6 && FR_CC.has(cc);
  }
  if (frCache.size > 50000) frCache.clear();
  frCache.set(key, v);
  return v;
}
// Nom de lieu d'un point : sa commune si les contours sont importés, sinon la ville ou l'agglomération la plus proche
function whereOf(lat, lng) {
  const c = communeOf(lat, lng);
  return c ? { id: c.id, name: c.name } : { id: placeOf(lat, lng), name: placeOf(lat, lng) };
}

// ---- Lignes d'une journée (digest et pages publiques) ----
const readArchiveDay = d => { try { return fs.readFileSync(path.join(ARCHIVE_DIR, d + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
// Un point restauré puis expiré apparaît deux fois : on garde sa dernière ligne
const dedupeRows = list => { const m = new Map(); list.forEach((r, i) => m.set(r.k || 'old' + i, r)); return [...m.values()]; };
function dayRows(date) {
  // Lignes sans heure de fin (anciens formats, imports) : fin = début + durée normale du type
  const rows = dedupeRows(readArchiveDay(date)).map(r => ({ ...r, o: r.o || (r.d ? 'old' : 'exp'), e: r.e || r.t + ((CAT[r.c] && BASE_TTL[r.c]) || 20) * MIN }));
  for (const r of activeReports(Date.now(), 5000)) if (parisDay(r.t) === date) rows.push({ ...archLine(r, 'active'), e: null });
  // Les bilans ne comptent que la France (métropole et outre-mer) : les points envoyés d'ailleurs restent sur la carte en direct,
  // mais ne faussent ni les totaux ni les cartes. On garde seulement leur nombre.
  const fr = [], abroad = [];
  for (const r of rows) (inFrance(r.lat, r.lng) ? fr : abroad).push(r);
  // Villes : chaque point est rattaché à sa commune (contours OSM) ou, à défaut, à sa ville ou à son agglomération
  const zones = {}, names = {};
  for (const r of fr) {
    const w = whereOf(r.lat, r.lng);
    r.z = w.id; const z = (zones[w.id] ||= { name: w.name, lat: 0, lng: 0, n: 0 }); z.n++; z.lat += r.lat; z.lng += r.lng;
  }
  for (const [id, z] of Object.entries(zones)) { z.lat = Math.round(z.lat / z.n * 1000) / 1000; z.lng = Math.round(z.lng / z.n * 1000) / 1000; (names[z.name] ||= []).push(id); }
  // Deux communes du même nom (Saint-Denis…) : on ajoute le département
  for (const ids of Object.values(names)) if (ids.length > 1) for (const id of ids) if (/^\d[\dAB]\d{3}$/.test(id)) zones[id].name += ` (${id.startsWith('97') ? id.slice(0, 3) : id.slice(0, 2)})`;
  return { rows: fr, zones, abroad: abroad.length };
}
// Nombre de signalements en France d'un jour archivé (comparaison sur 14 jours)
const dayCountFr = d => dedupeRows(readArchiveDay(d)).filter(r => inFrance(r.lat, r.lng)).length;

// ---- Pages publiques par manif (/manif/AAAA-MM-JJ) ----
// Publiées à la main par l'admin. On fige alors un résumé agrégé (la page n'affiche que le centre de chaque ville et des totaux),
// plus les points arrondis à ~100 m pour la carte d'un créneau, gardés même quand l'archive détaillée est effacée.
db.exec('CREATE TABLE IF NOT EXISTS pub(date TEXT PRIMARY KEY, t INTEGER, data TEXT)');
// Bilans figés par la 2.6.0 avec le code INSEE à la place du nom de la commune : nom retrouvé à la lecture
const INSEE_RE = /^\d[\dAB]\d{3}$/;
const fixPubNames = d => { if (d && Array.isArray(d.cities)) for (const c of d.cities) if (INSEE_RE.test(c.name)) { const x = q('SELECT name FROM communes WHERE insee=?').get(c.name); if (x) c.name = x.name; } return d; };
const getPub = date => { const x = q('SELECT data FROM pub WHERE date=?').get(date); return x ? fixPubNames(JSON.parse(x.data)) : null; };
const REMOVED_O = new Set(['cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old']);
function pubSnapshot(date) {
  const { rows: all, abroad, zones } = dayRows(date);
  const rows = all.filter(r => CAT[r.c]);
  if (!rows.length) return null;
  const cats = {}, fam = {}, hours = Array(24).fill(0), cities = {};
  for (const r of rows) {
    cats[r.c] = (cats[r.c] || 0) + 1; const g = CAT[r.c].group; fam[g] = (fam[g] || 0) + 1; hours[parisHour(r.t) % 24]++;
    const c = (cities[r.z] ||= { name: zones[r.z] ? zones[r.z].name : r.z, n: 0, lat: 0, lng: 0 }); c.n++; c.lat += r.lat; c.lng += r.lng;
  }
  const ts = rows.map(r => r.t);
  return { date, total: rows.length, fam, hours,
    cats: Object.entries(cats).map(([id, n]) => ({ id, label: CAT[id].label, glyph: CAT[id].glyph, group: CAT[id].group, n })).sort((a, b) => b.n - a.n),
    cities: Object.values(cities).map(c => ({ name: c.name, n: c.n, lat: Math.round(c.lat / c.n * 100) / 100, lng: Math.round(c.lng / c.n * 100) / 100 })).sort((a, b) => b.n - a.n),
    first: Math.min(...ts), last: Math.max(...ts), confirmed: rows.filter(r => r.up > 0).length, confs: rows.reduce((t, r) => t + (r.up || 0), 0),
    verified: rows.filter(r => r.v).length, removed: rows.filter(r => REMOVED_O.has(r.o)).length, abroad, communes: commIndex().rows.length > 0, pts: pubPts(rows), ptsV: PTS_V };
}
// Points de la journée pour la carte d'un créneau (page publique) : position arrondie à ~100 m, heures à la minute,
// nombre de confirmations, vérifié ou non, et ce qu'est devenu le point. Les points retirés ou contestés restent,
// avec la mention : un retrait (même par une orga, ou en masse par des votes) ne doit pas faire disparaître ce qui a été signalé.
const PUB_PTS_MAX = 30000, PTS_V = 3; // PTS_V : format des points (2 = heures de fin corrigées, 3 = devenir du point)
const PTS_O = ['', 'cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old'];
function pubPts(rows) {
  return rows.filter(r => CAT[r.c]).slice(0, PUB_PTS_MAX)
    .map(r => { const o = REMOVED_O.has(r.o) ? Math.max(1, PTS_O.indexOf(r.o)) : 0;
      return [r.c, Math.floor(r.t / MIN), Math.floor(Math.min(r.e || Date.now(), r.t + 24 * 60 * MIN) / MIN), Math.round(r.lat * 1e3), Math.round(r.lng * 1e3), r.up || 0, r.v ? 1 : 0, ...(o ? [o] : [])]; });
}
// Bilans publiés avant la 2.3.3 : points ajoutés à la première demande, tant que l'archive du jour existe
function pubWithPts(date) {
  const d = getPub(date);
  if (!d || (d.pts && d.ptsV === PTS_V)) return d;
  const { rows } = dayRows(date);
  if (!rows.length) return d;
  d.pts = pubPts(rows); d.ptsV = PTS_V;
  q('UPDATE pub SET data=? WHERE date=?').run(JSON.stringify(d), date);
  return d;
}
let storyMap = null;
const BubbleMap = require('./public/bubble-map.js');
const { streetRoute } = require('./tools/street-route.js');
const routeCache = new Map();
function mapSvg(cities) {
  try { storyMap ||= JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'story-map.json'), 'utf8')); } catch { return ''; }
  const m = storyMap, b = BubbleMap.svg(cities, m, { fontSize: 26, labels: 14, esc: htmlEsc });
  return `<svg viewBox="0 0 ${m.w} ${m.h}" role="img" aria-label="Carte des signalements par ville"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec9fa4"/><stop offset="1" stop-color="#7d86dc"/></linearGradient></defs>`
    + m.near.map(p => `<path d="${p}" fill="#1c1c20" stroke="#34343c" stroke-width="1.5"/>`).join('') + `<path d="${m.fr}" fill="#26262c" stroke="#5a5866" stroke-width="2"/>${b.dots}${b.labels}</svg>`
    + (b.merged ? '<p class="fine">Sur la carte, les communes très proches sont regroupées sous le nom de la plus active ; le détail est dans la liste.</p>' : '');
}
const htmlEsc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GROUP_COL = { fdo: '#e5484d', danger: '#f5a524', soutien: '#30a46c', info: '#8e8cd8' };
const GROUP_FR = { fdo: 'Forces de l’ordre', danger: 'Danger', info: 'Info', soutien: 'Soutien' };
const frDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const frHour = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const PUB_CSS = `*{box-sizing:border-box}body{margin:0;background:#121214;color:#f2f1f4;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}a{color:#ec9fa4}.top{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.top img{width:44px;height:44px;border-radius:10px}
.top b{display:block;font-size:18px}.top span{color:#a3a1ad;font-size:13px}h1{font-size:clamp(28px,6vw,42px);line-height:1.1;margin:28px 0 6px}.lead{color:#c9c7d1;margin:0 0 20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.kpi{background:#1c1c20;border:1px solid #34343c;border-radius:14px;padding:12px 14px}.kpi b{display:block;font-size:30px;font-variant-numeric:tabular-nums}.kpi span{color:#a3a1ad;font-size:13px}
section{background:#1c1c20;border:1px solid #34343c;border-radius:16px;padding:16px;margin:14px 0}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ec9fa4;margin:0 0 12px}
svg{width:100%;height:auto;display:block}.row{display:grid;grid-template-columns:minmax(120px,40%) 1fr 48px;gap:10px;align-items:center;margin:6px 0;font-size:14px}.bar{height:14px;border-radius:4px}.n{text-align:right;font-variant-numeric:tabular-nums}
.hours{display:flex;gap:3px;align-items:flex-end;height:160px;border-bottom:1px solid #5a5866}.hours div{flex:1;background:#5b66c4;border-radius:3px 3px 0 0;min-height:1px}.hours .pk{background:#ec9fa4}.ticks{display:flex;gap:3px;color:#a3a1ad;font-size:11px}.ticks span{flex:1;text-align:center}
.fine{color:#a3a1ad;font-size:13px}.cta{display:grid;gap:10px;grid-template-columns:1fr 1fr;margin-top:18px}.cta a{display:block;text-align:center;padding:14px;border-radius:14px;background:#26262c;border:1px solid #34343c;color:#f2f1f4;text-decoration:none;font-weight:700}
.cta a.main{background:linear-gradient(135deg,#ec9fa4,#a191d8 60%,#7d86dc);color:#17121f;border:0}ul.days{list-style:none;padding:0}ul.days li{margin:8px 0}ul.days a{display:flex;justify-content:space-between;padding:14px 16px;border-radius:14px;background:#1c1c20;border:1px solid #34343c;color:#f2f1f4;text-decoration:none}`;
function pubShell(req, { title, desc, body, ld }) {
  const base = PUBLIC_URL_REAL(req), here = base + String(req.url || '/').split('?')[0].replace(/\/$/, '');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEsc(title)}</title><meta name="description" content="${htmlEsc(desc)}"><link rel="canonical" href="${htmlEsc(here || base + '/')}">${ld ? jsonLd(ld) : ''}
<meta property="og:title" content="${htmlEsc(title)}"><meta property="og:description" content="${htmlEsc(desc)}"><meta property="og:type" content="article">
<meta property="og:image" content="${base}/icon-512.png"><meta name="twitter:card" content="summary"><link rel="icon" href="/favicon.png"><style>${PUB_CSS}</style></head>
<body><main><a class="top" href="/"><img src="/brand/logo.png" alt=""><span><b>Cortège</b><span>La carte en direct des manifs${BRAND.handle ? ' · par @' + htmlEsc(BRAND.handle) : ''}</span></span></a>${body}
<div class="cta"><a class="main" href="/">Ouvrir la carte</a><a href="${htmlEsc(BRAND.instagram || '/')}" rel="noopener">${BRAND.handle ? 'Suivre @' + htmlEsc(BRAND.handle) : 'Suivre le projet'}</a></div>
<p class="fine">Signalements anonymes envoyés par les manifestant·es : ce ne sont pas des faits vérifiés, ils sont confirmés ou contestés par les autres sur place. Aucune position précise n’est publiée ici, seulement des totaux par ville.</p></main></body></html>`;
}
const GOOGLE_VERIFY = /^google[\w-]{6,60}\.html$/.test(process.env.GOOGLE_SITE_VERIFICATION || '') ? process.env.GOOGLE_SITE_VERIFICATION : '';
function sitemapXml(req) {
  const base = PUBLIC_URL_REAL(req), day = t => new Date(t).toISOString().slice(0, 10);
  const pubs = q('SELECT date, t FROM pub ORDER BY date DESC').all();
  const urls = [['/', day(Date.now()), 'always', '1.0'], ['/manif', pubs[0] ? day(pubs[0].t) : null, 'daily', '0.8'], ['/presse', null, 'monthly', '0.6'],
    ['/affiche.html', null, 'monthly', '0.4'], ['/legal.html', null, 'yearly', '0.2'], ...pubs.map(x => ['/manif/' + x.date, day(x.t), 'monthly', '0.7'])];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(([u, m, f, p]) => `<url><loc>${htmlEsc(base + u)}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}<changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')
    + '\n</urlset>\n';
}
// Données structurées (schema.org) : rien n'est exécuté, c'est seulement lu par les moteurs de recherche
const jsonLd = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const PUBLIC_URL_REAL = req => (process.env.PUBLIC_URL || ('https://' + String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, ''))).replace(/\/$/, '');
function pubPage(req, d) {
  const maxC = d.cats[0].n, maxH = Math.max(...d.hours), peak = d.hours.indexOf(maxH), top = d.cities.slice(0, 12), maxV = top[0].n;
  const title = `${frDay(d.date)[0].toUpperCase() + frDay(d.date).slice(1)} : ${d.total} signalements sur Cortège`;
  const desc = `${d.total} signalements de manifestant·es dans ${d.cities.length} villes, de ${frHour(d.first)} à ${frHour(d.last)}. Carte, types, heures et villes.`;
  const body = `<h1>${htmlEsc(frDay(d.date)[0].toUpperCase() + frDay(d.date).slice(1))}</h1><p class="lead">Ce que les manifestant·es ont signalé sur Cortège.</p>
<div class="kpis"><div class="kpi"><b>${d.total}</b><span>signalements</span></div><div class="kpi"><b>${d.cities.length}</b><span>villes</span></div>
<div class="kpi"><b>${frHour(d.first)}</b><span>premier signalement</span></div><div class="kpi"><b>${frHour(d.last)}</b><span>dernier signalement</span></div></div>
<section><h2>Par ville</h2>${mapSvg(d.cities)}${top.map(c => `<div class="row"><span>${htmlEsc(c.name)}</span><span class="bar" style="width:${Math.max(2, c.n / maxV * 100)}%;background:linear-gradient(90deg,#ec9fa4,#a191d8)"></span><span class="n">${c.n}</span></div>`).join('')}
${d.cities.length > 12 ? `<p class="fine">+ ${d.cities.length - 12} autres ${d.communes ? 'communes' : 'villes. Chaque ville compte aussi les communes voisines de son agglomération'}.</p>` : ''}
${d.abroad ? `<p class="fine">${d.abroad} ${d.abroad > 1 ? 'signalements envoyés' : 'signalement envoyé'} hors de France, non ${d.abroad > 1 ? 'comptés' : 'compté'} ici.</p>` : ''}</section>
<section><h2>Par type</h2><p class="fine">${Object.entries(d.fam).map(([g, n]) => `<span style="color:${GROUP_COL[g]}">●</span> ${GROUP_FR[g]} ${n}`).join(' · ')}</p>
${d.cats.map(c => `<div class="row"><span>${htmlEsc(c.label)}</span><span class="bar" style="width:${Math.max(1.5, c.n / maxC * 100)}%;background:${GROUP_COL[c.group]}"></span><span class="n">${c.n}</span></div>`).join('')}</section>
<section><h2>Par heure</h2><p class="fine">Le plus d’envois entre ${peak} h et ${(peak + 1) % 24} h (${maxH}).</p><div class="hours" role="img" aria-label="Signalements par heure">${d.hours.map((n, i) => `<div class="${i === peak ? 'pk' : ''}" style="height:${n / maxH * 100}%" title="${i} h : ${n}"></div>`).join('')}</div>
<div class="ticks">${d.hours.map((_, i) => `<span>${i % 3 ? '' : i + 'h'}</span>`).join('')}</div></section>
<section><h2>Vérification</h2><div class="kpis"><div class="kpi"><b style="color:#30a46c">${d.confirmed}</b><span>confirmés par au moins une autre personne (${d.confs} confirmations)</span></div>
<div class="kpi"><b style="color:#8e8cd8">${d.verified}</b><span>vérifiés par une orga certifiée</span></div><div class="kpi"><b style="color:#f5a524">${d.removed}</b><span>retirés avant leur expiration (inclus dans les totaux)</span></div></div></section>
<section><h2>Carte d’un créneau</h2><p>Choisis un lieu et une plage horaire : une image avec les signalements de ce moment-là, à télécharger ou partager (presse, legal teams, témoignages).</p>
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/manif/${d.date}/carte">Fabriquer une image d’un créneau</a></div></section>`;
  return pubShell(req, { title, desc, body });
}
function pubIndex(req) {
  const list = q('SELECT date, data FROM pub ORDER BY date DESC').all().map(x => { const d = JSON.parse(x.data); return { date: x.date, total: d.total, cities: d.cities.length }; });
  // Agenda : les mobilisations à venir annoncées sur Cortège (déjà publiques dans l'appli), aussi en données structurées
  const now = Date.now(), base = PUBLIC_URL_REAL(req);
  const next = listEvents().filter(e => e.status !== 'pending' && e.lat != null && e.start > now - 2 * 3600e3).slice(0, 40);
  const when = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  const body = `<h1>Agenda et bilans des manifs</h1><p class="lead">Les prochaines mobilisations annoncées sur Cortège, puis ce que les manifestant·es ont signalé, journée par journée.</p>
${next.length ? `<section><h2>À venir</h2><ul class="days">${next.map(e => `<li><a href="/?at=${e.lat},${e.lng}"><span>${htmlEsc((EVT[e.type] || EVT.manif).glyph + ' ' + e.title)}${e.place ? `<br><small class="fine">${htmlEsc(e.place)}</small>` : ''}</span><span>${htmlEsc(when(e.start))}</span></a></li>`).join('')}</ul></section>` : ''}
<section><h2>Bilans</h2>${list.length ? `<ul class="days">${list.map(x => `<li><a href="/manif/${x.date}"><span>${htmlEsc(frDay(x.date))}</span><span>${x.total} signalements · ${x.cities} villes</span></a></li>`).join('')}</ul>` : '<p class="fine">Aucun bilan publié pour l’instant.</p>'}</section>`;
  const ld = next.length ? { '@context': 'https://schema.org', '@graph': next.map(e => ({ '@type': 'Event', name: e.title, startDate: new Date(e.start).toISOString(),
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', isAccessibleForFree: true,
    location: { '@type': 'Place', name: e.place || e.title, ...(e.place ? { address: e.place } : {}), geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } },
    url: `${base}/?at=${e.lat},${e.lng}`, description: (EVT[e.type] || EVT.manif).label + (e.place ? ' · ' + e.place : '') })) } : null;
  return pubShell(req, { title: 'Agenda et bilans des manifs · Cortège', desc: 'Les prochaines manifs annoncées et les bilans des mobilisations signalées sur Cortège, la carte en direct des manifs.', body, ld });
}
function sendPage(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
  res.end(html);
}

// ---- Archive anonyme pour le digest ----
// Gardé : catégorie, heures de début et de fin à la minute, position arrondie à ~100 m, nombre de confirmations
// et de « Plus là », nombre de précisions (jamais leur texte), vérification, fiabilité, et ce qu'est devenu le point.
// Jamais gardé : la précision écrite, les empreintes d'IP ou de téléphone.
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
fs.mkdirSync(ARCHIVE_DIR, { recursive: true, mode: 0o700 });
const parisDay = t => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
const parisHour = t => Number(new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));
const archLine = (r, o) => {
  const notes = Array.isArray(r.notes) ? r.notes : parseNotes(r);
  return { k: h8('a|' + r.id), c: r.cat, t: Math.floor(r.t / MIN) * MIN, e: Math.floor(Math.min(Date.now(), r.exp) / MIN) * MIN,
    lat: Math.round(r.lat * 1e3) / 1e3, lng: Math.round(r.lng * 1e3) / 1e3, up: r.up || 0, dn: r.down || 0, n: notes.length,
    v: r.ver ? 1 : 0, f: r.fl || 0, o, d: o === 'exp' || o === 'active' ? 0 : 1 };
};
function archive(r, outcome) {
  const line = JSON.stringify(archLine(r, outcome)) + '\n';
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
// urg : annonces urgentes ; near : dangers signalés dans la zone ; last : dernier envoi « danger » (anti-avalanche)
try { db.exec('ALTER TABLE push ADD COLUMN urg INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE push ADD COLUMN near INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE push ADD COLUMN last INTEGER'); } catch {}
// lang : langue de l'appli sur ce téléphone (textes des notifications) ; ord : nouveaux arrêtés dans la zone
try { db.exec("ALTER TABLE push ADD COLUMN lang TEXT DEFAULT 'fr'"); } catch {}
try { db.exec('ALTER TABLE push ADD COLUMN ord INTEGER DEFAULT 1'); } catch {}
// fails : refus d'envoi consécutifs du service de notification (abonnement supprimé au 5e)
try { db.exec('ALTER TABLE push ADD COLUMN fails INTEGER DEFAULT 0'); } catch {}
const PUSH_FAILS = 5, PUSH_NET_MAX = Number(process.env.PUSH_NET_MAX) || 60, PUSH_ZONES_MAX = 3000;
// Textes des notifications dans la langue du téléphone : mêmes traductions que l'appli (public/lang/*.json, le français sert de clé)
const PUSH_LANGS = ['fr', 'en', 'es', 'ar'];
const LANG_DICT = {};
for (const l of PUSH_LANGS.slice(1)) {
  LANG_DICT[l] = {};
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'lang', l + '.json'), 'utf8')))) LANG_DICT[l][k.replace(/\s+/g, ' ').trim()] = v; } catch {}
}
function tr(lang, s, v) {
  const d = LANG_DICT[lang], out = (d && d[String(s).replace(/\s+/g, ' ').trim()]) || s;
  return v ? out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : out;
}
const LOCALE = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', ar: 'ar-u-nu-latn' };
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
// Jeton VAPID par service : valable 1 h, renouvelé au bout de 30 min. Apple (web.push.apple.com) refuse
// un jeton émis depuis plus d'une heure (403 ExpiredProviderToken), même si son « exp » n'est pas dépassé.
const jwtCache = new Map();
function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud), now = Date.now();
  if (hit && now - hit.at < 30 * 60_000) return hit.h;
  const exp = Math.floor(now / 1000) + 3600;
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp, sub: CONTACT_EMAIL ? 'mailto:' + CONTACT_EMAIL : PUBLIC_URL });
  const sig = crypto.sign('sha256', Buffer.from(data), { key: VAPID_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const h = `vapid t=${data}.${sig}, k=${VAPID.pub}`;
  jwtCache.set(aud, { h, at: now });
  return h;
}
// File d'envoi commune : connexions réutilisées vers les services de notification (Google, Mozilla, Apple),
// au plus PUSH_PARALLEL envois en même temps, et les annonces urgentes passent devant les alertes de proximité.
const pushAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
const PUSH_PARALLEL = Number(process.env.PUSH_PARALLEL) || 48;
let pushRunning = 0;
const pushQueue = { hi: [], lo: [] };
function pushSlot(urgent) {
  return new Promise(go => {
    if (pushRunning < PUSH_PARALLEL) { pushRunning++; return go(); }
    pushQueue[urgent ? 'hi' : 'lo'].push(go);
  });
}
function pushDone() {
  const next = pushQueue.hi.shift() || pushQueue.lo.shift();
  if (next) next(); else pushRunning--;
}
async function pushOne(sub, payload, urgent = false) {
  await pushSlot(urgent);
  try { return await pushSend(sub, payload); } finally { pushDone(); }
}
function pushSend(sub, payload) {
  return new Promise(resolve => {
    let body, u;
    try { body = encryptPush(sub, payload); u = new URL(sub.e); } catch { return resolve(410); }
    const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 10_000, agent: pushAgent,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
        TTL: '3600', Urgency: 'high', Authorization: vapidAuth(sub.e) } }, res => {
      if (res.statusCode < 300 || res.statusCode === 404 || res.statusCode === 410) { res.resume(); return resolve(res.statusCode); }
      // Refus inattendu : on garde le début de la réponse du service pour le diagnostic (tableau de bord de l'admin)
      let txt = ''; res.setEncoding('utf8');
      res.on('data', d => { if (txt.length < 300) txt += d; });
      res.on('end', () => { PSTATS.lastErr = { t: Date.now(), host: u.hostname, code: res.statusCode, msg: txt.slice(0, 300) }; resolve(res.statusCode); });
      res.on('error', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e => { PSTATS.lastErr = { t: Date.now(), host: u.hostname, code: 0, msg: String(e.code || e.message).slice(0, 120) }; resolve(0); });
    req.end(body);
  });
}
// Réseau saturé : chaque notification transporte aussi les signalements actifs autour de la zone de l'abonné·e
// (format compact, ≈ 3 Ko au plus). Le téléphone les garde, même appli fermée : la carte est à jour à l'ouverture.
// Ligne : [id, catégorie, lat, lng, début, dernière confirmation, fin, confirmations, drapeaux (1 vérifié, 2 contesté, 4 fiable, 8 non fiable)]
function pushData(lat, lng, now = Date.now()) {
  if (lat == null) return null;
  const d = 0.12, out = [];
  let size = 40;
  for (const r of q('SELECT id, cat, lat, lng, t, last, exp, up, ver, ct, fl FROM reports WHERE exp>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY t DESC LIMIT 200')
    .all(now, lat - d, lat + d, lng - d * 1.5, lng + d * 1.5)) {
    const row = [r.id, r.cat, r.lat, r.lng, Math.round(r.t / 1000), Math.round((r.last || r.t) / 1000), Math.round(r.exp / 1000), r.up || 0,
      (r.ver ? 1 : 0) | (r.ct ? 2 : 0) | (r.fl === 1 ? 4 : 0) | (r.fl === -1 && !r.up ? 8 : 0)];
    size += JSON.stringify(row).length + 1;
    if (size > 2800) break;
    out.push(row);
  }
  return { at: Math.round(now / 1000), lat, lng, r: out };
}
// Statistiques d'envoi depuis le démarrage (tableau de bord de l'admin) : réussis, expirés, refusés, sans réponse
const PSTATS = { since: Date.now(), sent: 0, ok: 0, gone: 0, fail: 0, codes: {}, batches: [] };
function pushStat(kind, codes) {
  const b = { t: Date.now(), kind, n: codes.length, ok: 0, gone: 0, fail: 0, codes: {} };
  for (const c of codes) {
    const k = c >= 200 && c < 300 ? 'ok' : c === 404 || c === 410 ? 'gone' : 'fail';
    b[k]++; PSTATS[k]++; PSTATS.sent++;
    if (k !== 'ok') { b.codes[c] = (b.codes[c] || 0) + 1; PSTATS.codes[c] = (PSTATS.codes[c] || 0) + 1; }
  }
  PSTATS.batches.unshift(b); PSTATS.batches.length = Math.min(PSTATS.batches.length, 20);
  // Dans le journal du serveur (journalctl -u cortege | grep push) : code 0 = pas de réponse du service de notification
  console.log(`push ${kind} : ${b.n} envoi(s), ${b.ok} reçu(s), ${b.gone} expiré(s), ${b.fail} échec(s)` + (b.fail ? ' ' + JSON.stringify(b.codes) : ''));
  return b;
}
async function pushSendAll(targets, payload, urgent = false, kind = 'envoi') {
  const dead = [];
  // payload : texte JSON, ou fonction (langue) → texte JSON, écrit une fois par langue
  const mk = typeof payload === 'function' ? payload : () => payload, byLang = new Map();
  const base = l => { if (!byLang.has(l)) byLang.set(l, JSON.parse(mk(l))); return byLang.get(l); };
  // Les abonné·es d'une même zone (arrondie à ~10 km) reçoivent les mêmes données : calculées une seule fois
  // (au plus PUSH_ZONES_MAX zones différentes par envoi : au-delà, la notification part sans les données)
  const memo = new Map(), dataFor = s => { const k = s.lat + ',' + s.lng; if (!memo.has(k)) { if (memo.size >= PUSH_ZONES_MAX) return null; memo.set(k, pushData(s.lat, s.lng)); } return memo.get(k); };
  const codes = await Promise.all(targets.map(s => pushOne(s, JSON.stringify({ ...base(PUSH_LANGS.includes(s.lang) ? s.lang : 'fr'), d: dataFor(s) }), urgent)));
  // Abonnement mort (404, 410) : supprimé. Autre refus définitif (400, 413…) : supprimé au 5e d'affilée.
  // Pas 403 ni 429 : c'est en général un souci de notre côté (jeton) ou une surcharge passagère.
  const failed = [], healed = [];
  codes.forEach((code, j) => {
    const t = targets[j];
    if (code === 404 || code === 410) dead.push(t.id);
    else if (code >= 400 && code < 500 && code !== 403 && code !== 429) { if ((t.fails || 0) + 1 >= PUSH_FAILS) dead.push(t.id); else failed.push(t.id); }
    else if (code >= 200 && code < 300 && t.fails) healed.push(t.id);
  });
  if (failed.length || healed.length) try { tx(() => { for (const id of failed) q('UPDATE push SET fails=COALESCE(fails,0)+1 WHERE id=?').run(id); for (const id of healed) q('UPDATE push SET fails=0 WHERE id=?').run(id); }); } catch {}
  pushStat(kind, codes);
  if (dead.length) try { tx(() => dead.forEach(id => q('DELETE FROM push WHERE id=?').run(id))); } catch {}
  return dead.length;
}
// « Danger près de toi » : abonné·es dont la zone (arrondie à ~10 km) est à moins de 10 km, au plus un envoi toutes les 3 min
const NEAR_GAP = 3 * MIN;
const nearKm = () => settings().nearKm || 10;
async function pushNear(r) {
  const NEAR_KM = nearKm(), now = Date.now(), c = CAT[r.cat], d = NEAR_KM / 111;
  const cand = q('SELECT * FROM push WHERE near=1 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?').all(r.lat - d, r.lat + d, r.lng - d * 1.5, r.lng + d * 1.5)
    .filter(s => distKm(s.lat, s.lng, r.lat, r.lng) <= NEAR_KM);
  // On réserve l'envoi (plusieurs processus peuvent tourner en même temps)
  const targets = tx(() => cand.filter(s => q('UPDATE push SET last=? WHERE id=? AND (last IS NULL OR last<?)').run(now, s.id, now - NEAR_GAP).changes));
  if (!targets.length) return;
  const payload = l => JSON.stringify({ title: `${c.glyph} ${tr(l, '{x} près de ta zone', { x: tr(l, c.label) })}`, body: tr(l, 'Signalé à l’instant. Ouvre Cortège pour voir où exactement.'),
    tag: 'near-' + r.cat, url: `/?at=${r.lat},${r.lng}`, vibrate: VIBES[r.cat] || [200, 100, 200] });
  await pushSendAll(targets, payload, false, 'danger');
}
const pushNearLater = r => setImmediate(() => pushNear(r).catch(e => console.error('push danger', e.message)));
async function pushBroadcast(a) {
  const targets = pushAll().filter(s => s.urg !== 0).filter(s => a.national || (s.lat != null && distKm(s.lat, s.lng, a.lat, a.lng) <= a.r + 8)).map(s => [s.id, s]);
  if (!targets.length) return;
  const payload = l => JSON.stringify({ title: (a.national ? '⚠ ' + tr(l, 'National') + ' · ' : '⚠ ') + a.by, body: a.text, tag: 'ann-' + a.id, url: '/', vibrate: [300, 100, 300, 100, 300] });
  await pushSendAll(targets.map(([, s]) => s), payload, true, 'annonce');
}

// ---- Lieux permanents : lieux de pouvoir et lieux utiles aux manifestant·es, depuis OpenStreetMap ----
// Importés une fois par mois (Overpass), corrigeables et masquables dans l'admin. Publiés par région de 1° :
// l/<région>.json (pouvoir + hôpitaux, visibles dès le zoom 13) et l/<région>-s.json (pharmacies, eau : zoom rue).
const POI_KINDS = [
  { id: 'mairie', label: 'Mairie', glyph: '🏛', grp: 'pouvoir' },
  { id: 'pref', label: 'Préfecture', glyph: '🏢', grp: 'pouvoir' },
  { id: 'spref', label: 'Sous-préfecture', glyph: '🏢', grp: 'pouvoir' },
  { id: 'police', label: 'Commissariat', glyph: '👮', grp: 'pouvoir' },
  { id: 'gend', label: 'Gendarmerie', glyph: '👮', grp: 'pouvoir' },
  { id: 'tribunal', label: 'Tribunal', glyph: '🔨', grp: 'pouvoir' },
  { id: 'cra', label: 'Centre de rétention (CRA)', glyph: '🔒', grp: 'pouvoir' },
  { id: 'hopital', label: 'Hôpital', glyph: '🏥', grp: 'aide' },
  { id: 'pharma', label: 'Pharmacie', glyph: '💊', grp: 'aide', street: true },
  { id: 'eau', label: 'Eau potable', glyph: '🚰', grp: 'aide', street: true },
  { id: 'cam', label: 'Caméra de surveillance', glyph: '📷', grp: 'surv', cam: true },
];
const POI = Object.fromEntries(POI_KINDS.map(k => [k.id, k]));
db.exec(`CREATE TABLE IF NOT EXISTS pois(id TEXT PRIMARY KEY, kind TEXT, lat REAL, lng REAL, rg TEXT, data TEXT, src TEXT, hid INTEGER DEFAULT 0, ed INTEGER DEFAULT 0, seen INTEGER);
  CREATE INDEX IF NOT EXISTS pois_rg ON pois(rg);`);
const PLACES_IMPORT = process.env.PLACES_IMPORT !== '0';
// overpass.private.coffee d'abord : overpass-api.de met parfois les requêtes en attente jusqu'au délai (et refuse l'IPv6 de certains hébergeurs)
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass.private.coffee/api/interpreter,https://overpass-api.de/api/interpreter';
const PLACES_EVERY = 30 * 24 * 60 * MIN;
const wait = ms => new Promise(go => setTimeout(go, ms));
const poiRg = (lat, lng) => `${Math.floor(lat)}_${Math.floor(lng)}`;
function poiKind(t) {
  const name = t.name || '';
  // Caméras qui filment la rue (publiques, ou privées tournées vers l'extérieur) ; pas les caméras intérieures ni les vigiles
  if (t.man_made === 'surveillance') return t.surveillance === 'indoor' || /^(guard|mobile)$/.test(t['surveillance:type'] || '') ? null : 'cam';
  if (/r[ée]tention administrative/i.test(name)) return 'cra';
  if (t.office === 'government' && t.government === 'prefecture') return /sous[- ]pr[ée]fecture/i.test(name) ? 'spref' : 'pref';
  if (t.amenity === 'townhall') return /^(village_hall|community_centre)$/.test(t['townhall:type'] || '') ? null : 'mairie';
  if (t.amenity === 'police') return /gendarmerie/i.test(name + ' ' + (t.operator || '') + ' ' + (t['police:FR'] || '')) ? 'gend' : 'police';
  if (t.amenity === 'courthouse') return 'tribunal';
  if (t.amenity === 'hospital') return 'hopital';
  if (t.amenity === 'pharmacy') return 'pharma';
  if (t.amenity === 'drinking_water') return /^(private|no)$/.test(t.access || '') || t.drinking_water === 'no' ? null : 'eau';
  return null;
}
const poiStr = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function poiData(t, kind) {
  const d = {};
  const n = poiStr(t['name:fr'] || t.name, 80); if (n) d.n = n;
  const h = poiStr(t.opening_hours, 120); if (h && kind !== 'eau') d.h = h;
  const p = poiStr(t['contact:phone'] || t.phone, 30); if (p && /^[+\d][\d .()-]{5,}$/.test(p)) d.p = p;
  if (kind === 'hopital' && t.emergency === 'yes') d.e = 1;
  if (kind === 'eau' && t.seasonal === 'yes') d.s = 1;
  if (kind === 'cam') {
    delete d.n; delete d.h; delete d.p;
    if (t.surveillance === 'public') d.c = 1; // police, mairie, transports publics
    const o = poiStr(t.operator, 40); if (o) d.o = o;
    const COMPASS = { N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157, S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337 };
    const rd = String(t['camera:direction'] || t.direction || '').trim().toUpperCase();
    const dir = Object.hasOwn(COMPASS, rd) ? COMPASS[rd] : /^\d{1,3}(\.\d+)?$/.test(rd) ? Math.round(+rd) % 360 : null;
    if (dir != null) d.dir = dir;
    const ct = t['camera:type']; if (/^(dome|fixed|panning)$/.test(ct || '')) d.ct = ct[0];
  }
  return d;
}
// Requête Overpass pour un carré : France, Belgique, Suisse, Luxembourg, Monaco (et l'outre-mer, inclus dans la France)
function overpassQuery(s, w, n, e) {
  // Simple rectangle, sans filtre par pays (le calcul des frontières rendait chaque requête trop lente pour Overpass) :
  // seuls les carrés qui contiennent une ville de France, Belgique, Suisse, Luxembourg ou Monaco sont demandés (voir placeChunks)
  const b = `(${s},${w},${n},${e})`;
  // Valeurs exactes plutôt qu'une expression régulière : Overpass utilise alors son index, bien plus vite
  return `[out:json][timeout:170];
(${['townhall', 'police', 'courthouse', 'hospital', 'pharmacy', 'drinking_water'].map(v => `nwr["amenity"="${v}"]${b};`).join('\n ')}
 nwr["office"="government"]["government"="prefecture"]${b};
 nwr["amenity"="prison"]["name"~"tention",i]${b};
 nwr["office"="government"]["name"~"tention",i]${b};);
out center tags qt;`;
}
// Plusieurs serveurs Overpass possibles (séparés par des virgules) : si l'un refuse ou ne répond pas, on passe au suivant
const OVERPASS_URLS = OVERPASS_URL.split(',').map(x => x.trim()).filter(Boolean);
function overpass(query, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), body = 'data=' + encodeURIComponent(query);
    const req = (u.protocol === 'http:' ? http : https).request({ method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, timeout: 190_000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': TILE_UA, 'Accept-Encoding': 'gzip' } }, res => {
      const chunks = []; let size = 0;
      const src = /gzip/.test(res.headers['content-encoding'] || '') ? res.pipe(zlib.createGunzip()) : res;
      src.on('data', c => { size += c.length; if (size > 200e6) req.destroy(new Error('réponse trop grosse')); else chunks.push(c); });
      src.on('end', () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error('Overpass ' + res.statusCode), { status: res.statusCode }));
        let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reject(e); }
        // Requête interrompue côté Overpass (trop longue, serveur chargé) : réponse 200 mais incomplète
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) return reject(new Error('Overpass : ' + j.remark.slice(0, 120)));
        resolve(j);
      });
      src.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end(body);
  });
}
// Carrés de 1° couvrant les zones de la carte (petites requêtes : plus rapides, et un échec ne coûte qu'un carré)
function placeChunks() {
  const out = [];
  for (const [la1, la2, lo1, lo2] of TILE_ZONES)
    for (let a = la1; a < la2; a += 1) for (let o = lo1; o < lo2; o += 1)
      out.push([a, o, Math.min(a + 1, la2), Math.min(o + 1, lo2)].map(x => Math.round(x * 100) / 100));
  // Carrés sans aucune ville de la liste (mer, Angleterre, Allemagne, Espagne…) : ignorés
  const near = ([s, w, n, e]) => PLACES.some(([, la, lo]) => la >= s - 0.15 && la <= n + 0.15 && lo >= w - 0.15 && lo <= e + 0.15);
  return PLACES.length ? out.filter(near) : out;
}
const placesStatus = () => { try { return JSON.parse(getMeta('poisimp') || 'null'); } catch { return null; } };
const placesRun = () => { try { return JSON.parse(getMeta('poisrun') || 'null'); } catch { return null; } };
let placesRunning = null;
// ---- Source principale : copie complète d'OpenStreetMap chez Geofabrik (simple fichier, ni API ni quota) ----
// Une fois par mois : téléchargement (~4,5 Go pour la France), extraction des lieux et des caméras avec osmium,
// puis suppression du gros fichier. Donne aussi les horaires, téléphones et services d'urgences.
const GEOFABRIK = (process.env.GEOFABRIK_URLS || 'https://download.geofabrik.de/europe/france-latest.osm.pbf').split(',').map(x => x.trim()).filter(Boolean);
const hasOsmium = (() => { try { return require('child_process').spawnSync('osmium', ['--version'], { timeout: 5000 }).status === 0; } catch { return false; } })();
const placesSource = () => process.env.PLACES_SOURCE || (hasOsmium ? 'osm' : PMTILES && fs.existsSync(PMTILES) ? 'carte' : 'overpass');
function download(url, file, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'http:' ? http : https).get(u, { headers: { 'User-Agent': TILE_UA }, timeout: 60_000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, file, onProgress, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${u.hostname} ${res.statusCode}`)); }
      const total = +res.headers['content-length'] || 0, out = fs.createWriteStream(file + '.part');
      let done = 0;
      res.on('data', c => { done += c.length; onProgress(done, total); });
      res.pipe(out);
      out.on('finish', () => { fs.renameSync(file + '.part', file); resolve(); });
      out.on('error', reject); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}
// Lance osmium avec une priorité basse (l'appli reste fluide pendant l'extraction)
function osmium(args) {
  return new Promise((resolve, reject) => {
    const p = require('child_process').spawn('nice', ['-n', '15', 'osmium', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { if (err.length < 2000) err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('osmium : ' + (err.trim().split('\n')[0] || 'code ' + code).slice(0, 160))));
  });
}
// Centre approximatif d'une géométrie GeoJSON (point, ligne, surface)
function geoCenter(g) {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.type === 'LineString' ? g.coordinates : null;
  if (!ring || !ring.length) return null;
  const pts = ring.length > 2 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  let x = 0, y = 0; for (const [a, b] of pts) { x += a; y += b; }
  return [x / pts.length, y / pts.length];
}
async function placesImportOsm() {
  const dir = path.join(DATA_DIR, 'osm'); fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now(), run = { t: t0, src: 'osm', step: 'téléchargement', total: 0, done: 0, n: 0, errs: 0, err: null, part: 1, parts: GEOFABRIK.length };
  let last = 0; const save = (force) => { if (force || Date.now() - last > 2000) { last = Date.now(); setMeta('poisrun', JSON.stringify(run)); } };
  save(true);
  const up = q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,seen) VALUES(?,?,?,?,?,?,'osm',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,
    kind=CASE WHEN ed=1 THEN kind ELSE excluded.kind END, lat=CASE WHEN ed=1 THEN lat ELSE excluded.lat END, lng=CASE WHEN ed=1 THEN lng ELSE excluded.lng END,
    rg=CASE WHEN ed=1 THEN rg ELSE excluded.rg END, data=CASE WHEN ed=1 THEN data ELSE excluded.data END`);
  const clean = () => { for (const f of fs.readdirSync(dir)) try { fs.unlinkSync(path.join(dir, f)); } catch {} };
  const upComm = q('INSERT OR REPLACE INTO communes(id,insee,name,minlat,minlng,maxlat,maxlng,data,seen) VALUES(?,?,?,?,?,?,?,?,?)');
  try {
    for (const [i, url] of GEOFABRIK.entries()) {
      run.part = i + 1; run.step = 'téléchargement'; run.done = run.total = 0; save(true);
      try { const st = fs.statfsSync(dir), free = st.bavail * st.bsize; const need = +(process.env.OSM_MIN_FREE_GB || 6); if (free < need * 1e9) throw new Error(`pas assez de place sur le disque (${(free / 1e9).toFixed(1)} Go libres, il en faut environ ${need})`); } catch (e) { if (/place/.test(e.message)) throw e; }
      console.log(`lieux : téléchargement de ${url}`);
      const src = path.join(dir, 'source.osm.pbf'), flt = path.join(dir, 'lieux.osm.pbf'), out = path.join(dir, 'lieux.geojsonseq');
      await download(url, src, (d, tot) => { run.done = d; run.total = tot; save(); });
      run.step = 'extraction'; save(true); console.log('lieux : extraction avec osmium…');
      // Les limites des communes (niveau administratif 8) sortent dans le même passage : elles servent aux bilans par commune
      await osmium(['tags-filter', src, 'n/man_made=surveillance', 'nwr/amenity=townhall,police,courthouse,hospital,pharmacy,drinking_water,prison', 'nwr/office=government',
        'r/admin_level=8', '-o', flt, '--overwrite']);
      fs.unlinkSync(src); // le gros fichier ne sert plus
      await osmium(['export', flt, '-f', 'geojsonseq', '-o', out, '--overwrite', '-a', 'type,id', '-x', 'print_record_separator=false']);
      run.step = 'enregistrement'; save(true);
      const rl = require('readline').createInterface({ input: fs.createReadStream(out), crlfDelay: Infinity });
      let batch = [], comm = []; const seenIds = new Set();
      const flush = () => { const b = batch; batch = []; tx(() => { for (const r of b) up.run(...r); }); };
      const flushComm = () => { const b = comm; comm = []; tx(() => { for (const r of b) upComm.run(...r); }); };
      for await (const line of rl) {
        if (!line.trim()) continue;
        let f; try { f = JSON.parse(line.replace(/^\x1e/, '')); } catch { continue; }
        const t = f.properties || {};
        if (t.boundary === 'administrative' && String(t.admin_level) === '8' && t.name && f.geometry && /Polygon$/.test(f.geometry.type)) {
          const id = String(t['@type'] || 'r')[0] + t['@id'];
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          const z = geoPoly(f.geometry, 0.0005), insee = /^\d[\dAB]\d{3}$/.test(t['ref:INSEE'] || '') ? t['ref:INSEE'] : null;
          if (z) { comm.push([id, insee, poiStr(t.name, 80), z.b[0], z.b[1], z.b[2], z.b[3], JSON.stringify(z.p), t0]); run.communes = (run.communes || 0) + 1; }
          if (comm.length >= 200) flushComm();
          continue;
        }
        const kind = poiKind(t), c = kind && geoCenter(f.geometry);
        if (!c || !validLatLng(c[1], c[0])) continue;
        const lat = Math.round(c[1] * 1e5) / 1e5, lng = Math.round(c[0] * 1e5) / 1e5;
        const id = String(t['@type'] || 'n')[0] + t['@id'];
        if (seenIds.has(id)) continue; // une surface fermée peut sortir deux fois (ligne et surface)
        seenIds.add(id);
        batch.push([id, kind, lat, lng, poiRg(lat, lng), JSON.stringify(poiData(t, kind)), t0]); run.n++;
        if (batch.length >= 2000) { flush(); save(); await new Promise(go => setImmediate(go)); }
      }
      flush(); flushComm();
    }
    // Communes : on ne remplace les anciens contours que si l'import en a trouvé
    if (run.communes) { q('DELETE FROM communes WHERE seen<?').run(t0); commReset(); console.log(`communes : ${run.communes} contours importés`); }
    // Lieux disparus (et ceux des anciennes sources) : retirés, sauf ceux corrigés ou ajoutés dans l'admin
    q("DELETE FROM pois WHERE src='osm' AND ed=0 AND seen<?").run(t0);
    setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, communes: run.communes || 0, errs: 0, err: null, ms: Date.now() - t0, src: 'osm' }));
    q("DELETE FROM meta WHERE k='poisrun'").run();
    await placesPublish();
    console.log(`lieux : ${run.n} lieux et caméras importés en ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    run.err = e.message; run.errs = 1; save(true);
    setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, errs: 1, err: e.message, ms: Date.now() - t0, src: 'osm' }));
    q("DELETE FROM meta WHERE k='poisrun'").run();
    console.error('lieux :', e.message);
  } finally { clean(); }
}

// Source des lieux : la carte du serveur (fichier PMTiles, aucune requête extérieure) si elle existe, sinon Overpass.
// PLACES_SOURCE=overpass force Overpass (horaires et téléphones en plus, mais services publics parfois saturés).
const placesFromMap = () => placesSource() === 'carte' && !!PMTILES && fs.existsSync(PMTILES);
function placesImportMap() {
  return new Promise((resolve, reject) => {
    const { Worker } = require('worker_threads');
    const t0 = Date.now(), run = { t: t0, total: 0, done: 0, n: 0, errs: 0, err: null, src: 'carte' };
    const save = () => setMeta('poisrun', JSON.stringify(run));
    save(); console.log('lieux : lecture de la carte du serveur…');
    const up = q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,seen) VALUES(?,?,?,?,?,?,'osm',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,
      kind=CASE WHEN ed=1 THEN kind ELSE excluded.kind END, lat=CASE WHEN ed=1 THEN lat ELSE excluded.lat END, lng=CASE WHEN ed=1 THEN lng ELSE excluded.lng END,
      rg=CASE WHEN ed=1 THEN rg ELSE excluded.rg END, data=CASE WHEN ed=1 THEN data ELSE excluded.data END`);
    const w = new Worker(path.join(__dirname, 'tools', 'pois-worker.js'), { workerData: { file: PMTILES, zones: [] } });
    let last = 0;
    w.on('message', m => {
      if (m.type === 'start') { run.total = m.total; save(); }
      else if (m.type === 'progress') { run.done = m.done; if (Date.now() - last > 3000) { last = Date.now(); save(); } if (m.done % 50000 === 0) console.log(`lieux : ${m.done}/${m.total} tuiles lues, ${run.n} lieux`); }
      else if (m.type === 'batch') tx(() => {
        for (const r of m.rows) {
          const lat = Math.round(r.lat * 1e5) / 1e5, lng = Math.round(r.lng * 1e5) / 1e5;
          const id = 'm' + sha(r.kind + '|' + lat + '|' + lng).slice(0, 12);
          up.run(id, r.kind, lat, lng, poiRg(lat, lng), JSON.stringify(r.name ? { n: r.name } : {}), t0); run.n++;
        }
      });
      else if (m.type === 'done') {
        // Lieux disparus de la carte (anciens imports compris) : retirés, sauf ceux corrigés ou ajoutés dans l'admin
        q("DELETE FROM pois WHERE src='osm' AND ed=0 AND seen<?").run(t0);
        setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, errs: 0, err: null, ms: Date.now() - t0, src: 'carte' }));
        q("DELETE FROM meta WHERE k='poisrun'").run();
        placesPublish();
        console.log(`lieux : ${run.n} lieux lus dans la carte en ${Math.round((Date.now() - t0) / 1000)} s`);
        resolve();
      }
    });
    w.on('error', e => { run.err = e.message; run.errs = 1; save(); reject(e); });
    w.on('exit', code => { if (code) reject(new Error('lecture de la carte interrompue (' + code + ')')); });
  });
}
// Import en plusieurs étapes, repris là où il s'était arrêté si le serveur redémarre (mise à jour, panne)
async function placesImport(resume = false) {
  if (placesRunning) return placesRunning;
  if (placesSource() === 'osm') {
    placesRunning = placesImportOsm().finally(() => { placesRunning = null; });
    return placesRunning;
  }
  if (placesFromMap()) {
    placesRunning = placesImportMap().catch(e => console.error('lieux', e.message)).finally(() => { placesRunning = null; });
    return placesRunning;
  }
  placesRunning = (async () => {
    const chunks = placeChunks(), prev = resume ? placesRun() : null;
    const run = prev && prev.total === chunks.length ? prev : { t: Date.now(), total: chunks.length, done: 0, n: 0, errs: 0, err: null };
    run.err = null; console.log(`lieux : import ${prev && run === prev ? 'repris' : 'lancé'} (${run.done}/${chunks.length} zones faites)`);
    const t0 = run.t, save = () => setMeta('poisrun', JSON.stringify(run));
    save();
    const up = q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,seen) VALUES(?,?,?,?,?,?,'osm',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,
      kind=CASE WHEN ed=1 THEN kind ELSE excluded.kind END, lat=CASE WHEN ed=1 THEN lat ELSE excluded.lat END, lng=CASE WHEN ed=1 THEN lng ELSE excluded.lng END,
      rg=CASE WHEN ed=1 THEN rg ELSE excluded.rg END, data=CASE WHEN ed=1 THEN data ELSE excluded.data END`);
    // Une zone : chaque serveur essayé ; si aucun ne répond à temps, la zone est coupée en 4 (zones très denses), deux fois au plus
    const fetchZone = async ([s, w, nn, e], label, depth = 0) => {
      for (let tries = 0; tries < OVERPASS_URLS.length; tries++) {
        const url = OVERPASS_URLS[tries], host = new URL(url).hostname;
        run.cur = { host, since: Date.now(), zone: label }; save();
        console.log(`lieux : zone ${label}, demande à ${host}…`);
        try { const r = await overpass(overpassQuery(s, w, nn, e), url); run.err = null; return r; }
        catch (err) {
          run.err = `${host} · ${err.message}`.slice(0, 160); save();
          console.error(`lieux : zone ${label} : ${run.err}`);
          await wait(err.status === 429 ? 60_000 : Number(process.env.OVERPASS_RETRY ?? 10_000));
        }
      }
      if (depth >= 2) return null;
      const ms = (s + nn) / 2, mw = (w + e) / 2, parts = [[s, w, ms, mw], [s, mw, ms, e], [ms, w, nn, mw], [ms, mw, nn, e]], out = [];
      for (const [i, q4] of parts.entries()) { const r = await fetchZone(q4.map(x => Math.round(x * 1e4) / 1e4), `${label}.${i + 1}`, depth + 1); if (!r) return null; out.push(...(r.elements || [])); }
      return { elements: out };
    };
    run.failed ||= [];
    for (; run.done < chunks.length; run.done++) {
      const [s, w] = chunks[run.done];
      const res = await fetchZone(chunks[run.done], `${run.done + 1}/${chunks.length}`);
      if (!res) { run.errs++; run.failed.push(run.done); }
      else if (Array.isArray(res.elements)) tx(() => {
        for (const el of res.elements) {
          const t = el.tags || {}, kind = poiKind(t), lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
          if (!kind || !validLatLng(lat, lng)) continue;
          up.run(el.type[0] + el.id, kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, poiRg(lat, lng), JSON.stringify(poiData(t, kind)), t0); run.n++;
        }
      });
      save();
      console.log(`lieux : zone ${run.done + 1}/${chunks.length} (${s}, ${w})${res ? '' : ' en échec'} · ${run.n} lieux en tout`);
      if (res && run.done % 10 === 9) placesPublish(); // la carte se remplit au fur et à mesure
      await wait(Number(process.env.OVERPASS_GAP ?? 3000));
    }
    // Zones en échec : une nouvelle tentative à la fin (souvent un serveur momentanément surchargé)
    for (const i of run.failed.splice(0)) {
      const res = await fetchZone(chunks[i], `${i + 1}/${chunks.length} (nouvel essai)`);
      if (!res) { run.failed.push(i); continue; }
      run.errs--;
      tx(() => { for (const el of res.elements || []) { const t = el.tags || {}, kind = poiKind(t), lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (kind && validLatLng(lat, lng)) { up.run(el.type[0] + el.id, kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, poiRg(lat, lng), JSON.stringify(poiData(t, kind)), t0); run.n++; } } });
      save(); await wait(Number(process.env.OVERPASS_GAP ?? 3000));
    }
    // Lieux disparus d'OpenStreetMap : retirés seulement si tout l'import a réussi (sinon on garderait une carte trouée)
    if (!run.errs) q("DELETE FROM pois WHERE src='osm' AND ed=0 AND seen<?").run(t0);
    setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, errs: run.errs, err: run.errs ? run.err : null, ms: Date.now() - t0 }));
    q("DELETE FROM meta WHERE k='poisrun'").run();
    placesPublish();
    console.log(`lieux : ${run.n} lieux importés en ${Math.round((Date.now() - t0) / 1000)} s, ${run.errs} carré(s) en échec`);
  })().catch(e => console.error('lieux', e.message)).finally(() => { placesRunning = null; });
  return placesRunning;
}
const poiRow = x => { const d = JSON.parse(x.data || '{}');
  // Caméra : [id, 'cam', lat, lng, opérateur, publique (1/0), direction en degrés (-1 : inconnue), type (d dôme, f fixe, p mobile)]
  if (x.kind === 'cam') return [x.id, x.kind, x.lat, x.lng, d.o || '', d.c ? 1 : 0, d.dir ?? -1, d.ct || ''];
  const row = [x.id, x.kind, x.lat, x.lng, d.n || '', d.h || '', d.p || '', d.e || d.s || 0];
  while (row.length > 4 && !row[row.length - 1]) row.pop(); return row; };
// Publie les fichiers de lieux (toutes les régions, ou seulement celles indiquées)
const placesPublish = (regions = null) => placesPublishRun(regions).catch(e => console.error('lieux : publication', e.message));
async function placesPublishRun(regions) {
  const dir = path.join(LIVE_DIR, 'l');
  fs.mkdirSync(dir, { recursive: true });
  const rgs = regions ? [...regions] : q('SELECT DISTINCT rg FROM pois').all().map(x => x.rg);
  const street = new Set(POI_KINDS.filter(k => k.street).map(k => k.id)), cams = new Set(POI_KINDS.filter(k => k.cam).map(k => k.id));
  const written = new Set();
  for (const rg of rgs) {
    if (!regions) await new Promise(go => setImmediate(go)); // publication complète : on rend la main entre deux zones
    const rows = q('SELECT id, kind, lat, lng, data FROM pois WHERE rg=? AND hid=0').all(rg);
    for (const [suffix, list] of [['', rows.filter(x => !street.has(x.kind) && !cams.has(x.kind))], ['-s', rows.filter(x => street.has(x.kind))], ['-c', rows.filter(x => cams.has(x.kind))]]) {
      const f = path.join(dir, rg + suffix + '.json');
      if (list.length) { writeIfChanged(f, JSON.stringify({ p: list.map(poiRow) })); written.add(rg + suffix + '.json'); }
      else try { fs.unlinkSync(f); } catch {}
    }
  }
  if (!regions) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !written.has(f)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
  setMeta('poish', h8(String(Date.now()) + q('SELECT COUNT(*) n FROM pois').get().n));
  dirty.global = true; scheduleFlush();
}
// Import automatique : au premier démarrage (base vide), puis tous les 30 jours ; jamais un jour de mobilisation
function placesMaybe() {
  if (!PLACES_IMPORT || placesRunning || mobToday()) return;
  if (placesRun()) return placesImport(true); // import interrompu (redémarrage) : on reprend (depuis le début pour Geofabrik)
  const last = placesStatus();
  // Depuis la carte du serveur : relu seulement quand le fichier de carte a changé (nouvelle extraction)
  if (placesFromMap()) { if (!last || last.src !== 'carte' || fs.statSync(PMTILES).mtimeMs > last.t) placesImport(); return; }
  if (!last || (last.src || 'overpass') !== placesSource() || Date.now() - last.t > PLACES_EVERY) placesImport();
}
if (PLACES_IMPORT) { setTimeout(placesMaybe, 2 * MIN).unref(); setInterval(placesMaybe, 60 * MIN).unref(); }
const poiView = x => { const d = JSON.parse(x.data || '{}'); return { id: x.id, kind: x.kind, lat: x.lat, lng: x.lng, n: d.n || '', h: d.h || '', p: d.p || '', e: !!d.e, src: x.src, hid: !!x.hid, ed: !!x.ed }; };

// ---- Journées de mobilisation prévues ----
// La veille à 20 h : notification à tous les abonné·es aux annonces urgentes. Le jour J dès 7 h : mode renforcé jusqu'à 2 h du matin
// et titre de la journée en bandeau. Le lendemain : l'admin est invité·e à publier le bilan public.
const nextDay = d => parisDay(parisMs(d, '12:00') + 24 * 60 * MIN);
function cleanMob(b, old = {}) {
  const str = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const date = String(b.date || old.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Date invalide.' };
  const title = str(b.title ?? old.title, 80);
  if (title.length < 3) return { error: 'Donne un titre à la journée (affiché en bandeau).' };
  return { id: old.id || crypto.randomBytes(5).toString('base64url'), date, title, eve: str(b.eve ?? old.eve, 160),
    push: (b.push ?? old.push) !== false, strict: (b.strict ?? old.strict) !== false };
}
async function mobEve(m) {
  const targets = pushAll().filter(s => s.urg !== 0);
  if (!targets.length) return;
  // Le titre et le texte de la journée sont écrits par l'admin (en français) ; le reste suit la langue du téléphone
  const day = l => new Date(parisMs(m.date, '12:00')).toLocaleDateString(LOCALE[l], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const payload = l => JSON.stringify({ title: '📣 ' + tr(l, 'Demain : {t}', { t: m.title }),
    body: m.eve || tr(l, 'Journée de mobilisation {d}. Ouvre Cortège pour voir l’agenda et les numéros utiles.', { d: day(l) }),
    tag: 'mob-' + m.id, url: '/', vibrate: [300, 100, 300] });
  await pushSendAll(targets, payload, true, 'veille de mobilisation');
}
function mobTick() {
  const now = Date.now(), today = parisDay(now), h = parisHour(now) % 24;
  if (mobTick.day !== today) { mobTick.day = today; dirty.global = true; scheduleFlush(); } // bandeau du jour
  let list = mobsAll();
  if (!list.length) return;
  const old = parisDay(now - 30 * 24 * 60 * MIN), kept = list.filter(m => m.date >= old);
  if (kept.length !== list.length) { setMeta('mobs', JSON.stringify(kept)); list = kept; }
  for (const m of list) {
    if (m.push && m.date === nextDay(today) && h >= 20 && h < 23 && !getMeta('mob:eve:' + m.id)) {
      setMeta('mob:eve:' + m.id, now);
      mobEve(m).catch(e => console.error('veille de mobilisation', e.message));
    }
    if (m.strict && m.date === today && h >= 7 && !getMeta('mob:strict:' + m.id)) {
      setMeta('mob:strict:' + m.id, now);
      const until = parisMs(nextDay(today), '02:00');
      if (strictUntil(now) < until) { setMeta('strict', until); orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'mode manif renforcé (journée prévue)', { detail: m.title }); }
    }
  }
}
setInterval(() => { try { mobTick(); } catch (e) { console.error('journées', e.message); } }, 60_000).unref();
// Bilans à publier : journées passées depuis moins de 7 jours, pas encore publiées
const mobsToPublish = (now = Date.now()) => { const today = parisDay(now), from = parisDay(now - 7 * 24 * 60 * MIN);
  return mobsAll().filter(m => m.date < today && m.date >= from && !getPub(m.date)).map(m => ({ date: m.date, title: m.title })); };

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
      by: '17octobregiletjaune.net', oid: 'import', link: IMPORT_BASE + '/carte/', status: 'ok', t: now });
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
    } else if (!orga.admin && !quota('evt:' + orga.id, ORGA_LIMITS.eventsPerDay, 24 * 60 * MIN, now)) return [429, { error: `${ORGA_LIMITS.eventsPerDay} événements par jour au maximum.` }];
    const e = { id: crypto.randomBytes(6).toString('base64url'), type, title, place, note, start, lat: round(lat), lng: round(lng),
      route, end: !!(route && b.end), by: orga ? orga.label : 'Proposition de participant·e', oid: orga ? orga.id : null, status: orga && !orga.trial ? 'ok' : 'pending', t: now };
    if (!orga) e.dev = dev;
    saveEvent(e);
    return [201, evView(e)];
  });
}


// ---- Arrêtés et restrictions (interdiction de manif, couvre-feu, transports…) ----
// N'importe qui peut proposer, avec une source fiable ; seul l'admin valide. La zone est une commune ou un département :
// son contour officiel est envoyé aux téléphones, qui affichent un bandeau quand on regarde la zone ou qu'on s'y trouve.
const ORDER_KINDS = [
  { id: 'manif', glyph: '🚫', label: 'Manifestation interdite' }, { id: 'perimetre', glyph: '⛔', label: 'Périmètre interdit' },
  { id: 'couvre', glyph: '🌙', label: 'Couvre-feu' }, { id: 'transport', glyph: '🚋', label: 'Transports' },
  { id: 'consigne', glyph: '⚠', label: 'Consigne' }, { id: 'autre', glyph: 'ℹ', label: 'Information' },
];
const ORDER_KIND = Object.fromEntries(ORDER_KINDS.map(k => [k.id, k]));
// Départements : contours simplifiés (≈ 400 m) d'après france-geojson (IGN, licence ouverte) ; outre-mer : par commune seulement
const DEPS = (() => {
  let list = []; try { list = JSON.parse(fs.readFileSync(path.join(__dirname, 'geo', 'departements.json'), 'utf8')); } catch (e) { console.error('départements', e.message); }
  for (const [c, n] of [['971', 'Guadeloupe'], ['972', 'Martinique'], ['973', 'Guyane'], ['974', 'La Réunion'], ['976', 'Mayotte']]) if (!list.some(d => d.c === c)) list.push({ c, n, b: null, p: null });
  return list;
})();
const depOf = c => DEPS.find(d => d.c === String(c || '').toUpperCase().padStart(2, '0'));
const GEO_API = process.env.GEO_API || 'https://geo.api.gouv.fr';
const normName = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Simplification d'un contour (Douglas-Peucker), pour garder des fichiers légers
function simplifyRing(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]; const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function geoPoly(g, tol = 0.0004) {
  const polys = g && g.type === 'Polygon' ? [g.coordinates] : g && g.type === 'MultiPolygon' ? g.coordinates : [];
  const r = v => Math.round(v * 1e4) / 1e4;
  const p = polys.map(poly => poly.map(ring => simplifyRing(ring, tol).map(([x, y]) => [r(x), r(y)])).filter(ring => ring.length >= 4)).filter(x => x.length);
  if (!p.length) return null;
  const all = p.flat(2), lat = all.map(x => x[1]), lng = all.map(x => x[0]);
  return { p, b: [Math.min(...lat), Math.min(...lng), Math.max(...lat), Math.max(...lng)] };
}
// Contour officiel d'une commune (API Géo de l'État, appelée par le serveur seulement, à la validation)
async function communeZone(dep, name, insee) {
  const f = 'fields=nom,code,codeDepartement,population,contour&format=json';
  let list;
  if (/^\d[\dAB]\d{3}$/.test(insee || '')) list = [await getJson(`${GEO_API}/communes/${insee}?${f}`, 15_000)];
  else list = await getJson(`${GEO_API}/communes?nom=${encodeURIComponent(name)}&codeDepartement=${encodeURIComponent(dep)}&boost=population&limit=10&${f}`, 15_000);
  list = (Array.isArray(list) ? list : []).filter(c => c && c.contour);
  const c = list.find(c => normName(c.nom) === normName(name)) || (insee ? list[0] : null);
  if (!c) throw new Error(`commune « ${name} » introuvable dans le département ${dep}${list.length ? ` (proches : ${list.slice(0, 3).map(x => x.nom).join(', ')})` : ''}`);
  const z = geoPoly(c.contour);
  if (!z) throw new Error('contour de la commune illisible');
  return { scope: 'commune', name: c.nom, insee: c.code, dep: c.codeDepartement, ...z };
}
async function orderZone(o) {
  const d = depOf(o.dep);
  if (!d) throw new Error('département inconnu');
  if (o.commune) return communeZone(d.c, o.commune, o.insee);
  if (!d.p) throw new Error(`pour ${d.n}, indique la commune`);
  return { scope: 'dep', name: d.n, insee: null, dep: d.c, p: d.p, b: d.b };
}
const getOrder = id => { const x = q('SELECT data FROM orders WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveOrder(o) { q('INSERT OR REPLACE INTO orders(id,status,end,dev,data) VALUES(?,?,?,?,?)').run(o.id, o.status, o.end, o.dev || null, JSON.stringify(o)); dirty.ord = true; scheduleFlush(); }
function dropOrder(id) { const n = q('DELETE FROM orders WHERE id=?').run(id).changes; if (n) { dirty.ord = true; scheduleFlush(); } return n > 0; }
const ordersAll = () => q('SELECT data FROM orders ORDER BY end').all().map(x => JSON.parse(x.data));
const srcHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const orderView = o => ({ id: o.id, status: o.status, dep: o.dep, commune: o.commune || '', start: o.start, end: o.end, items: o.items, src: o.src, host: srcHost(o.src),
  by: o.by, t: o.t, ok: o.ok || null, zone: o.zone ? { scope: o.zone.scope, name: o.zone.name, insee: o.zone.insee, dep: o.zone.dep } : null });
const ordersLive = now => ordersAll().filter(o => o.status === 'ok' && o.end > now && o.zone)
  .map(o => ({ id: o.id, start: o.start, end: o.end, items: o.items, src: o.src, host: srcHost(o.src), ok: o.ok, scope: o.zone.scope, name: o.zone.name, dep: o.zone.dep, b: o.zone.b, p: o.zone.p }));
// Heure de Paris : « 2026-10-24 20:00 », « 2026-10-24T20:00 », ou horodatage en millisecondes
const whenMs = v => typeof v === 'number' ? v : /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?$/.test(String(v || '').trim())
  ? parisMs(String(v).trim().slice(0, 10), String(v).trim().slice(11) || '00:00') : NaN;
function cleanOrder(b) {
  const d = depOf(b.dep ?? b.departement);
  if (!d) return [null, 'Choisis le département.'];
  const commune = clean(b.commune, 80), insee = clean(b.insee, 5);
  const start = whenMs(b.start ?? b.debut), end = whenMs(b.end ?? b.fin), now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [null, 'Indique le début et la fin.'];
  if (end <= start) return [null, 'La fin doit être après le début.'];
  if (end <= now) return [null, 'Cette mesure est déjà terminée.'];
  if (start > now + 60 * 24 * 60 * MIN || end - start > 62 * 24 * 60 * MIN) return [null, 'Dates trop lointaines (2 mois au plus).'];
  const raw = Array.isArray(b.items ?? b.mesures) ? (b.items ?? b.mesures) : [];
  const items = raw.slice(0, 8).map(x => Array.isArray(x) ? { k: x[0], text: x[1] } : { k: x && (x.k ?? x.type), text: x && (x.text ?? x.texte) })
    .map(x => ({ k: Object.hasOwn(ORDER_KIND, String(x.k)) ? String(x.k) : 'autre', text: clean(x.text, 220) })).filter(x => x.text.length >= 3);
  if (!items.length) return [null, 'Décris au moins une mesure.'];
  const src = clean(b.src ?? b.source, 400);
  let u; try { u = new URL(src); } catch {}
  if (!u || !/^https?:$/.test(u.protocol)) return [null, 'Donne le lien de la source (site de la préfecture, compte officiel ou article de presse).'];
  return [{ dep: d.c, commune, insee: /^\d[\dAB]\d{3}$/.test(insee) ? insee : '', start, end, items, src: u.href }, null];
}
// Proposition (téléphone) : en attente de validation ; admin : publiée tout de suite (après calcul de la zone)
async function createOrder(b, { admin = false, dev = null, ipH = null } = {}) {
  const [o, err] = cleanOrder(b);
  if (err) return [400, { error: err }];
  const now = Date.now();
  if (!admin) {
    if (!allow(dev, ipH, 'report', now)) return [429, { error: 'Trop d’envois d’un coup. Réessaie dans quelques minutes.' }];
    if (q("SELECT COUNT(*) n FROM orders WHERE status='pending' AND dev=?").get(dev).n >= 3) return [429, { error: 'Tu as déjà 3 propositions en attente de validation.' }];
    if (q("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n >= 200) return [503, { error: 'Trop de propositions en attente, réessaie plus tard.' }];
    const p = { id: crypto.randomBytes(6).toString('base64url'), ...o, status: 'pending', by: 'Proposition de participant·e', dev, t: now };
    saveOrder(p);
    return [201, orderView(p)];
  }
  let zone; try { zone = await orderZone(o); } catch (e) { return [400, { error: 'Zone : ' + e.message }]; }
  const p = { id: crypto.randomBytes(6).toString('base64url'), ...o, zone, status: 'ok', by: 'admin', t: now, ok: now };
  saveOrder(p); orderPushLater(p);
  return [201, orderView(p)];
}
async function approveOrder(id) {
  const o = getOrder(id);
  if (!o) return [404, { error: 'Introuvable.' }];
  let zone; try { zone = await orderZone(o); } catch (e) { return [400, { error: 'Zone : ' + e.message }]; }
  const p = { ...o, zone, status: 'ok', ok: Date.now() }; delete p.dev;
  saveOrder(p); if (o.status !== 'ok') orderPushLater(p);
  return [200, orderView(p)];
}
// Nouvel arrêté validé : notification aux abonné·es dont la zone (arrondie à ~10 km) touche la zone de l'arrêté.
// Les arrêtés validés à quelques secondes d'écart (import de plusieurs arrêtés) partent ensemble : une seule notification.
const ORDER_PUSH_WAIT = +(process.env.ORDER_PUSH_WAIT_MS || 60_000);
let orderPushQ = [], orderPushT = null;
function orderPushLater(o) {
  orderPushQ.push(o.id);
  clearTimeout(orderPushT);
  orderPushT = setTimeout(() => { const ids = orderPushQ; orderPushQ = []; orderPush(ids).catch(e => console.error('push arrêtés', e.message)); }, ORDER_PUSH_WAIT);
}
// La zone de l'abonné·e est arrondie à 0,1° : on compte aussi les arrêtés à moins de ~8 km de ce point
function orderTouches(o, lat, lng) {
  const z = o.zone, m = 0.07;
  if (!z || !z.b || lat < z.b[0] - m || lat > z.b[2] + m || lng < z.b[1] - m * 1.5 || lng > z.b[3] + m * 1.5) return false;
  if (polyHas(z.p, lat, lng)) return true;
  for (const [dy, dx] of [[m, 0], [-m, 0], [0, m * 1.5], [0, -m * 1.5]]) if (polyHas(z.p, lat + dy, lng + dx)) return true;
  return z.scope === 'commune' && distKm(lat, lng, (z.b[0] + z.b[2]) / 2, (z.b[1] + z.b[3]) / 2) <= 8;
}
async function orderPush(ids) {
  const now = Date.now(), list = ids.map(getOrder).filter(o => o && o.status === 'ok' && o.end > now && o.zone && o.zone.p);
  if (!list.length) return;
  const groups = new Map();
  for (const s of q('SELECT * FROM push WHERE ord=1 AND lat IS NOT NULL').all()) {
    const mine = list.filter(o => orderTouches(o, s.lat, s.lng));
    if (!mine.length) continue;
    const k = mine.map(o => o.id).join(',');
    if (!groups.has(k)) groups.set(k, { mine, subs: [] });
    groups.get(k).subs.push(s);
  }
  for (const { mine, subs } of groups.values()) {
    const o = mine[0], k = ORDER_KIND[o.items[0].k] || ORDER_KIND.autre, z = o.zone;
    const when = l => new Date(o.start).toLocaleDateString(LOCALE[l], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
    const payload = l => JSON.stringify(mine.length === 1
      ? { title: `${k.glyph} ${tr(l, k.label)} · ${z.name}`, body: tr(l, 'Nouvel arrêté à partir du {d}. Ouvre Cortège pour voir la zone et la source.', { d: when(l) }),
          tag: 'ord-' + o.id, url: `/?at=${((z.b[0] + z.b[2]) / 2).toFixed(4)},${((z.b[1] + z.b[3]) / 2).toFixed(4)}`, vibrate: [200, 100, 200] }
      : { title: '⛔ ' + tr(l, '{n} nouveaux arrêtés dans ta zone', { n: mine.length }), body: [...new Set(mine.map(x => x.zone.name))].slice(0, 4).join(', '),
          tag: 'ord-' + o.id, url: '/', vibrate: [200, 100, 200] });
    await pushSendAll(subs, payload, false, 'arrêté');
  }
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
const h8 = str => crypto.createHash('sha1').update(str).digest('base64url').slice(0, 10);
function writeAtomic(file, str) { const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, str); fs.renameSync(tmp, file); }
function writeIfChanged(file, str) {
  try { if (fs.readFileSync(file, 'utf8') === str) return; } catch {}
  writeAtomic(file, str);
}
const FLUSH_MS = Number(process.env.FLUSH_MS) || 1000;
const ALL_EVERY = 10_000;
const LIVE_LOCK = path.join(DATA_DIR, 'live.lock');
const dirty = { cells: new Set(), ann: false, events: false, global: false, all: false, legal: false, ord: false };
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
  // Réseau faible : une seule requête pour tous les signalements de la région (≈ 100 km), compressée par Apache
  const [a, b] = rg.split('_').map(Number), now = Date.now();
  const pts = q('SELECT * FROM reports WHERE exp>? AND lat>=? AND lat<? AND lng>=? AND lng<? ORDER BY t DESC LIMIT 600').all(now, a, a + 1, b, b + 1).map(publicView);
  writeIfChanged(path.join(LIVE_DIR, 'p', rg + '.json'), JSON.stringify({ r: pts }));
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
  const g = { ann: getMeta('annh') || null, events: getMeta('evh') || null, legal: getMeta('legalh') || null, ord: getMeta('ordh') || null, paused: pausedUntil(now), build: buildId(), cfg: cfgHash(), pois: getMeta('poish') || null };
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
  const cells = [...dirty.cells], doAnn = dirty.ann, doEv = dirty.events, doLegal = dirty.legal, doOrd = dirty.ord, doAll = dirty.all && now - lastAll >= ALL_EVERY;
  const doGlobal = cells.length || doAnn || doEv || doLegal || doOrd || doAll || dirty.global;
  dirty.cells.clear(); dirty.ann = dirty.events = dirty.legal = dirty.ord = dirty.global = false; if (doAll) dirty.all = false;
  const changed = new Set();
  if (doGlobal) try {
    withLock(() => {
      const regions = changed;
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
      if (doOrd) { const str = JSON.stringify({ o: ordersLive(now) }); writeIfChanged(path.join(LIVE_DIR, 'ord.json'), str); setMeta('ordh', h8(str)); }
      if (doLegal) { const str = JSON.stringify({ l: legalAll().filter(e => e.ok).map(legalView) }); writeIfChanged(path.join(LIVE_DIR, 'legal.json'), str); setMeta('legalh', h8(str)); }
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
    if (doAnn) dirty.ann = true; if (doEv) dirty.events = true; if (doLegal) dirty.legal = true; if (doOrd) dirty.ord = true; if (doAll) dirty.all = true; if (doGlobal) dirty.global = true;
    if (!isBusy(e)) console.error('publication', e.message);
    return scheduleFlush(500);
  }
  if (dirty.all && !flushTimer) scheduleFlush(Math.max(FLUSH_MS, ALL_EVERY - (Date.now() - lastAll)));
  if (doGlobal) streamNotify(changed, doAnn || doEv || doLegal || doOrd || dirty.global);
}
// Tout republier (démarrage, purge) : chaque case active, chaque fichier existant, annonces, agenda.
function rebuildAll() {
  const now = Date.now();
  const all = new Set(q('SELECT DISTINCT cell FROM reports WHERE exp>?').all(now).map(x => x.cell));
  q('SELECT cell FROM cells').all().forEach(x => all.add(x.cell));
  try { fs.readdirSync(path.join(LIVE_DIR, 'c')).forEach(f => f.endsWith('.json') && all.add(f.slice(0, -5))); } catch {}
  all.forEach(c => dirty.cells.add(c));
  dirty.ann = dirty.events = dirty.legal = dirty.ord = dirty.global = dirty.all = true; lastAll = 0;
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
          const pf = path.join(LIVE_DIR, 'p', `${i}_${j}.json`);
          if (!fs.existsSync(pf)) writeAtomic(pf, '{"r":[]}');
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
  try { seedLegal(); } catch (e) { console.error('annuaire', e.message); }
  try { settings(); sweep(); rebuildAll(); } catch (e) { console.error('publication initiale', e.message); }
  try { if (!fs.existsSync(path.join(LIVE_DIR, 'l')) && q('SELECT 1 FROM pois LIMIT 1').get()) placesPublish(); } catch (e) { console.error('lieux', e.message); }
}, 200);
// Veille de l'annuaire : vérifiée toutes les heures, faite une fois par jour (désactivable : LEGAL_WATCH=0)
if (process.env.LEGAL_WATCH !== '0') setInterval(() => legalWatch().catch(e => console.error('veille annuaire', e.message)), 60 * MIN).unref();

// ---- HTTP helpers ----
// ---- Temps réel : prévenir les téléphones dès qu'une région change (Server-Sent Events) ----
// Le téléphone s'abonne aux régions (carrés de 1°, ~100 km) qu'il affiche ; le serveur lui envoie seulement
// « telle région a changé », et le téléphone relit les fichiers publiés comme d'habitude. Pas de position précise envoyée.
// Un seul processus (VPS) : sous Passenger, plusieurs processus ne se voient pas, on reste sur l'interrogation régulière.
const STREAM_ON = process.env.STREAM ? process.env.STREAM === '1' : !UNDER_PASSENGER;
const STREAM_MAX = Number(process.env.STREAM_MAX) || 20000;
const sseClients = new Map();
function streamOpen(req, res, url) {
  if (!STREAM_ON || sseClients.size >= STREAM_MAX) return send(res, 503, { error: 'Temps réel indisponible, interrogation régulière.' }, { 'Retry-After': '60' });
  const regions = new Set(String(url.searchParams.get('r') || '').split(',').filter(x => /^-?\d{1,3}_-?\d{1,3}$/.test(x)).slice(0, 8));
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 5000\n\n');
  const c = { regions, ping: setInterval(() => res.write(': \n\n'), 25000) };
  sseClients.set(res, c);
  const close = () => { clearInterval(c.ping); sseClients.delete(res); };
  req.on('close', close); res.on('error', close);
}
function streamNotify(regions, global) {
  if (!sseClients.size) return;
  const rs = [...regions];
  for (const [res, c] of sseClients) {
    const mine = rs.filter(r => c.regions.has(r));
    if (mine.length || global) res.write(`data: ${JSON.stringify({ r: mine, g: global ? 1 : 0 })}\n\n`);
  }
}

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
    req.on('end', () => { let v; try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return reject(new Error('bad json')); } v && typeof v === 'object' && !Array.isArray(v) ? resolve(v) : reject(new Error('bad json')); });
    req.on('error', reject);
  });
}

// ---- Statique ----
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' };
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
// Pages d'outils, jamais dans les moteurs de recherche (l'admin, le digest, la carte à intégrer, l'image d'un créneau)
const NOINDEX = new Set(['/admin.html', '/digest.html', '/embed.html', '/creneau.html']);
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    let c = staticCache.get(file);
    const reply = () => {
      const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ETag: c.etag,
        'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache' };
      if (NOINDEX.has(pathname)) headers['X-Robots-Tag'] = 'noindex, nofollow';
      if (file.endsWith('.html')) {
        // La carte à intégrer (embed.html) peut s'afficher dans le site d'un média ou d'un collectif ; les autres pages, jamais
        if (pathname === '/embed.html') headers['Content-Security-Policy'] = cspFor(c.buf).replace("frame-ancestors 'none'", 'frame-ancestors *');
        else { headers['Content-Security-Policy'] = cspFor(c.buf); headers['X-Frame-Options'] = 'DENY'; }
      }
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

// ---- Carte hébergée sur le serveur : fichier PMTiles (tuiles vectorielles) ----
// TILE_PMTILES=/chemin/france.pmtiles : la carte vient du serveur lui-même, plus aucune requête vers un fournisseur.
// Lecteur PMTiles v3 minimal (format ouvert de Protomaps) : en-tête, répertoires compressés, tuiles servies telles quelles.
const PMTILES = process.env.TILE_PMTILES || '';
// Zones couvertes par le fichier (rectangles [sud, nord, ouest, est]) : lues dans la région utilisée pour l'extraire
const PM_ZONES = (() => {
  try {
    const g = JSON.parse(fs.readFileSync(process.env.TILE_PMTILES_REGION || path.join(__dirname, 'tools', 'france.geojson'), 'utf8'));
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
const TILE_DIR = process.env.TILE_DIR || path.join(__dirname, 'tiles');
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

// ---- Protection contre la saturation (sans service extérieur) ----
// 1. Une même adresse ne peut pas envoyer plus de FLOOD_MAX requêtes par minute à Node (les fichiers live/ servis
//    par le serveur web ne comptent pas). Large : des centaines de téléphones partagent parfois une adresse d'opérateur.
// 2. Si Node est débordé (boucle d'événements en retard), il ne garde que l'essentiel : envoyer un signalement,
//    voter, le temps réel et la santé. Le reste reçoit « réessaie dans 5 s », et les téléphones ont la carte en cache.
const FLOOD_MAX = Number(process.env.FLOOD_MAX) || 6000;
const FLOOD = new Map();
function floodOk(ip, now) {
  let e = FLOOD.get(ip);
  if (!e || now - e.t > 60_000) { if (FLOOD.size > 200_000) FLOOD.clear(); FLOOD.set(ip, (e = { t: now, n: 0 })); }
  return ++e.n <= FLOOD_MAX;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of FLOOD) if (now - e.t > 60_000) FLOOD.delete(k); }, 60_000).unref();
const LAG = require('perf_hooks').monitorEventLoopDelay({ resolution: 20 }); LAG.enable();
let lagMs = 0, lagHigh = 0;
const LAG_SHED = Number(process.env.LAG_SHED) || 500, BOOT = Date.now();
// Délestage seulement si Node est débordé plusieurs secondes d'affilée (pas pour un pic isolé : démarrage, import, sauvegarde)
setInterval(() => { lagMs = LAG.percentile(99) / 1e6; LAG.reset(); lagHigh = lagMs > LAG_SHED && Date.now() - BOOT > 20_000 ? lagHigh + 1 : 0; }, 1000).unref();
const shedding = () => lagHigh >= 3;
// Jamais délestés : la page et ses fichiers (peu coûteux, et sans eux l'appli ne s'ouvre pas), les fichiers live, et les actions vitales
const essential = (req, pathname) => pathname === '/api/health' || pathname === '/api/stream'
  || (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/vt/') && !pathname.startsWith('/tiles/'))
  || (req.method === 'POST' && (pathname === '/api/reports' || /^\/api\/reports\/[\w-]{1,16}\/(vote|note)$/.test(pathname)));
let shedCount = 0, floodCount = 0;

// ---- Routes ----
// Filet de sécurité : une erreur imprévue dans une requête est notée dans le journal, elle n'arrête plus le serveur
process.on('unhandledRejection', e => console.error('erreur non gérée :', e && e.stack || e));
// Plantage vraiment imprévu : la cause est gardée pour l'onglet Direct de l'admin, puis systemd relance le serveur
process.on('uncaughtException', e => {
  console.error('plantage :', e && e.stack || e);
  try { setMeta('crash', JSON.stringify({ t: Date.now(), msg: String(e && e.message || e).slice(0, 200), at: String(e && e.stack || '').split('\n')[1]?.trim().slice(0, 160) || '' })); } catch {}
  process.exit(1);
});
const server = http.createServer(async (req, res) => {
  // Adresse lue sans jamais planter : « //%5c.. » et autres chemins piégés des robots d'attaque donnent une erreur 400
  let url; try { url = new URL('http://x' + (String(req.url || '/').startsWith('/') ? req.url : '/' + req.url)); } catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Requête invalide'); }
  const { pathname } = url;
  if (!floodOk(clientIp(req), Date.now())) { floodCount++; res.writeHead(429, { 'Retry-After': '60', 'Content-Type': 'text/plain' }); return res.end('Trop de requêtes'); }
  if (shedding() && !essential(req, pathname)) { shedCount++; res.writeHead(503, { 'Retry-After': '5', 'Content-Type': 'text/plain' }); return res.end('Serveur chargé, réessaie'); }
  try { settings(); } catch {}
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
    if (req.method === 'GET' && pathname === '/api/stream') return streamOpen(req, res, url);
    if (req.method === 'GET' && (pathname === '/presse' || pathname === '/presse/')) return serveStatic(req, res, '/presse.html');
    // Référencement : robots.txt, plan du site, et fichier de validation de Google Search Console (GOOGLE_SITE_VERIFICATION=google0123….html)
    if (req.method === 'GET' && pathname === '/robots.txt')
      return send(res, 200, `User-agent: *\nDisallow: /api/\nAllow: /\n\nSitemap: ${PUBLIC_URL_REAL(req)}/sitemap.xml\n`, { 'Cache-Control': 'public, max-age=3600' });
    if (req.method === 'GET' && pathname === '/sitemap.xml') return send(res, 200, sitemapXml(req), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    if (req.method === 'GET' && GOOGLE_VERIFY && pathname === '/' + GOOGLE_VERIFY) return send(res, 200, 'google-site-verification: ' + GOOGLE_VERIFY);
    if (req.method === 'GET' && (pathname === '/manif' || pathname === '/manif/')) return sendPage(res, pubIndex(req));
    const pubM = req.method === 'GET' && pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})$/);
    if (pubM) { const d = getPub(pubM[1]); return d ? sendPage(res, pubPage(req, d)) : send(res, 404, 'Bilan non publié'); }
    // Carte d'un créneau, ouverte à tous pour les bilans publiés : la page et ses points (l'image est fabriquée dans le navigateur)
    const pubC = req.method === 'GET' && pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/(carte|points\.json)$/);
    if (pubC) {
      if (!getPub(pubC[1])) return send(res, 404, pubC[2] === 'carte' ? 'Bilan non publié' : { error: 'Bilan non publié.' });
      if (pubC[2] === 'carte') return serveStatic(req, res, '/creneau.html');
      if (!tx(() => bump('pts:' + clientHash(req), 'vote', 150, Date.now()))) return send(res, 429, { error: 'Trop de demandes : réessaie dans quelques minutes.' }, { 'Retry-After': '120' });
      const d = pubWithPts(pubC[1]);
      if (!d.pts) return send(res, 404, { error: 'Les points de cette journée ne sont plus disponibles.' });
      const body = JSON.stringify({ date: d.date, pts: d.pts, cats: CATEGORIES.map(c => ({ id: c.id, label: c.label, group: c.group })) });
      const etag = '"' + h8(body) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120', ETag: etag }); return res.end(body);
    }
    if (req.method === 'POST' && pathname === '/api/orga-requests') {
      if (!tx(() => bump('oreq:' + clientHash(req), 'report', 3, Date.now()))) return send(res, 429, { error: 'Trop de demandes d’un coup. Réessaie plus tard.' });
      return send(res, ...orgaRequest(await readJson(req)));
    }
    const vt = PMTILES && req.method === 'GET' && pathname.match(/^\/vt\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.mvt$/);
    if (vt) return serveVectorTile(req, res, +vt[1], +vt[2], +vt[3]);
    // Tracé du cortège entre la queue et la tête, par les rues de la carte hébergée (positions publiques, rien sur la personne qui demande)
    if (req.method === 'GET' && pathname === '/api/cortege-route') {
      const pt = v => { const m = String(v || '').match(/^(-?\d{1,2}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/); return m && validLatLng(+m[1], +m[2]) ? [+m[1], +m[2]] : null; };
      const a = pt(url.searchParams.get('a')), b = pt(url.searchParams.get('b'));
      if (!a || !b) return send(res, 400, { error: 'Points invalides.' });
      if (!PMTILES) return send(res, 404, { error: 'Pas de carte hébergée.' });
      if (distM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) > 5000) return send(res, 404, { error: 'Trop loin.' });
      const k = a.map(x => x.toFixed(4)).join(',') + '|' + b.map(x => x.toFixed(4)).join(',');
      if (!routeCache.has(k)) {
        if (!quota('route:' + clientHash(req), 120, 5 * MIN)) return send(res, 429, { error: 'Trop de demandes.' });
        let r = null;
        try { const h = await pmOpen(); r = await streetRoute(async (z, x, y) => { const t = await pmTile(z, x, y); return t ? pmDecomp(t, h.tileC) : null; }, Math.min(h.maxz, 15), a, b); }
        catch (e) { console.error('tracé du cortège', e.message); }
        routeCache.set(k, r); if (routeCache.size > 300) routeCache.delete(routeCache.keys().next().value);
      }
      const r = routeCache.get(k);
      return r ? send(res, 200, r, { 'Cache-Control': 'public, max-age=60' }) : send(res, 404, { error: 'Pas de chemin trouvé.' });
    }
    if (req.method === 'GET' && pathname === '/api/config')
      { const S = settings(), banner = bannerNow();
      return send(res, 200, { event: banner || EVENT_NAME, banner: !!banner, center: S.view ? [S.view.lat, S.view.lng] : CENTER, zoom: S.view ? S.view.zoom : ZOOM,
        alertRadius: S.alertRadius || 300, nearKm: nearKm(), poiKinds: POI_KINDS, orderKinds: ORDER_KINDS, deps: DEPS.map(d => [d.c, d.n]), cfgh: cfgHash(),
        brand: BRAND, violenceUrl: VIOLENCE_URL, contact: CONTACT_EMAIL, hostInfo: HOST_INFO, sourceUrl: SOURCE_URL, categories: CATEGORIES, merge: MERGE, offlineTiles: TILE_PREFETCH || !!pmInfo(), groups: GROUPS, eventTypes: EVENT_TYPES, pushKey: VAPID.pub, vibes: VIBES, alertCats: [...ALERT_CATS], stream: STREAM_ON, vector: pmInfo(), version: APP_VERSION, onion: /^[a-z2-7]{56}\.onion$/.test(ONION_HOST) ? ONION_HOST : null, accessLogs: process.env.ACCESS_LOGS === 'none' ? 'none' : '' }, { 'Cache-Control': 'no-cache' }); }

    // ---- Notifications : abonnement / désabonnement (zone arrondie à ≈ 10 km) ----
    if (req.method === 'POST' && (pathname === '/api/push/subscribe' || pathname === '/api/push/unsubscribe')) {
      const b = await readJson(req, 4096);
      const sub = b.sub || {};
      const endpoint = String(sub.endpoint || '');
      let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
      if (!PUSH_HOSTS.test(host) || endpoint.length > 1000) return send(res, 400, { error: 'Service de notification non pris en charge.' });
      const id = sha(endpoint).slice(0, 24);
      if (pathname.endsWith('/unsubscribe')) {
        if (!quota('unsub:' + clientHash(req), 60, 5 * MIN)) return send(res, 429, { error: 'Trop de demandes, réessaie plus tard.' });
        q('DELETE FROM push WHERE id=?').run(id);
        return send(res, 200, { ok: true });
      }
      const k = String(sub.keys?.p256dh || '').replace(/=+$/, ''), a = String(sub.keys?.auth || '').replace(/=+$/, '');
      if (!/^[\w-]{86,88}$/.test(k) || !/^[\w-]{20,24}$/.test(a)) return send(res, 400, { error: 'Abonnement invalide.' });
      const lat = Number(b.lat), lng = Number(b.lng), hasZone = validLatLng(lat, lng);
      const out = tx(() => {
        // limite par réseau : empêche de remplir la liste avec de faux abonnements
        if (!bump('push:' + clientHash(req), 'vote', 10, Date.now())) return 'rate';
        const known = !!q('SELECT 1 FROM push WHERE id=?').get(id);
        if (!known && pushCount() >= PUSH_MAX) return false;
        // Nouveaux abonnements : au plus PUSH_NET_MAX par réseau et par 6 h (une machine ne peut pas remplir la liste)
        if (!known && !quota('pushnet:' + clientHash(req), PUSH_NET_MAX, 6 * 60 * MIN)) { abuseOnce('abonnements en rafale', deviceHash(req), 60 * MIN, { net: clientHash(req) }); return 'rate'; }
        const urg = b.urgent === false ? 0 : 1, near = b.near === true && hasZone ? 1 : 0, ord = b.orders === false || !hasZone ? 0 : 1;
        const lang = PUSH_LANGS.includes(b.lang) ? b.lang : 'fr';
        q(`INSERT INTO push(id,e,k,a,lat,lng,t,urg,near,lang,ord) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET e=excluded.e, k=excluded.k, a=excluded.a,
           lat=excluded.lat, lng=excluded.lng, t=excluded.t, urg=excluded.urg, near=excluded.near, lang=excluded.lang, ord=excluded.ord`).run(id, endpoint, k, a,
          hasZone ? Math.round(lat * 10) / 10 : null, hasZone ? Math.round(lng * 10) / 10 : null, Date.now(), urg, near, lang, ord);
        return true;
      });
      if (out === 'rate') return send(res, 429, { error: 'Trop de demandes, réessaie plus tard.' });
      return out ? send(res, 200, { ok: true }) : send(res, 503, { error: 'Trop d’abonnements, réessaie plus tard.' });
    }

    // Notification de test envoyée par le serveur à ce seul téléphone : vérifie toute la chaîne (serveur → Google/Apple/Mozilla → téléphone)
    if (req.method === 'POST' && pathname === '/api/push/test') {
      const b = await readJson(req, 4096);
      const endpoint = String(b.endpoint || '');
      const row = endpoint && q('SELECT * FROM push WHERE id=?').get(sha(endpoint).slice(0, 24));
      if (!row) return send(res, 404, { error: 'Ce téléphone n’est pas abonné sur le serveur. Désactive puis réactive les notifications.' });
      if (!tx(() => bump('ptest:' + deviceHash(req), 'report', 3, Date.now()) && quota('ptestnet:' + clientHash(req), 20, 5 * MIN))) return send(res, 429, { error: 'Trois essais au plus toutes les 5 minutes.' });
      const l = PUSH_LANGS.includes(row.lang) ? row.lang : 'fr';
      const code = await pushOne(row, JSON.stringify({ title: '🔔 ' + tr(l, 'Test Cortège'), body: tr(l, 'Les notifications marchent : tu seras prévenu·e ici.'), tag: 'test', url: '/',
        vibrate: [200, 100, 200, 100, 600] }), true);
      pushStat('test', [code]);
      if (code === 404 || code === 410) q('DELETE FROM push WHERE id=?').run(row.id);
      const ok = code >= 200 && code < 300;
      return send(res, ok ? 200 : 502, ok ? { ok: true, code }
        : { error: code === 404 || code === 410 ? 'Abonnement expiré chez le service de notification : réactive les notifications.'
          : code === 0 ? 'Le serveur n’arrive pas à joindre le service de notification. Réessaie plus tard.' : `Le service de notification a refusé l’envoi (code ${code}).`, code });
    }

    // Vérification d'installation : ne renvoie jamais d'IP, seulement si un en-tête a été trouvé.
    if (req.method === 'GET' && pathname === '/api/health') {
      let writable = true; try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch { writable = false; }
      // Pour la surveillance (UptimeRobot, mot-clé "ok":true) : ok passe à false si le disque ou la mémoire saturent
      let diskFree = null, memFree = null;
      try { const st = fs.statfsSync(DATA_DIR); diskFree = Math.round(st.bavail / st.blocks * 100); } catch {}
      try { const m = fs.readFileSync('/proc/meminfo', 'utf8'), g = k => +(m.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1];
        memFree = Math.round(g('MemAvailable') / g('MemTotal') * 100); } catch {}
      const healthy = writable && (diskFree == null || diskFree >= 5) && (memFree == null || !Number.isFinite(memFree) || memFree >= 5);
      return send(res, 200, { ok: healthy, diskFreePct: diskFree, memFreePct: Number.isFinite(memFree) ? memFree : null, streams: sseClients.size, nodeOk: !!DatabaseSync, passenger: UNDER_PASSENGER, trustProxy: TRUST_PROXY,
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
          orgas: (() => { const list = readOrgas(); return list.map(o => ({ id: o.id, label: o.label, created: o.created, trial: o.trial === true, source: 'page',
            active: !!o.hash, invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, devices: o.hash ? 1 + (o.keys || []).length : 0,
            by: o.by || null, byLabel: o.by ? (list.find(x => x.id === o.by)?.label || o.byLabel || 'orga supprimée') : null, sponsored: o.sponsored === true,
            children: list.filter(x => x.by === o.id).length, ban: banUntil(o.id), clash: !!labelClash(o.label, { except: o.id }), ...(o.sponsored && o.trial ? { readiness: orgaReady(o) } : {}), ...orgaStats(o.id) })); })()
            .concat(ORGAS.map(o => ({ id: null, label: o.label, created: null, trial: false, source: 'variable', ...orgaStats('env:' + o.label) }))),
        });
      }
      if (req.method === 'POST' && pathname === '/api/admin/orgas') {
        const b = await readJson(req);
        const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
        if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga (il sera affiché sur ses annonces).' });
        // Invitation à usage unique (24 h) : la clé n'est créée que sur le téléphone de l'orga, au moment où elle scanne le QR code.
        const token = crypto.randomBytes(18).toString('base64url');
        const out = withLock(() => {
          const list = readOrgas().slice();
          if (labelClash(label)) return null;
          const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, invite: { h: sha(token), exp: Date.now() + INVITE_MS } };
          list.push(o); writeOrgas(list); return o;
        });
        if (!out) return send(res, 409, { error: labelClash(label) || 'Une orga porte déjà ce nom.' });
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'invitation', { ref: out.id, detail: out.label });
        return send(res, 201, { id: out.id, label: out.label, created: out.created, invite: token, exp: out.invite.exp });
      }
      // Révocation pour abus : l'orga et toutes celles qu'elle a fait entrer ; sa marraine perd le droit d'inviter 30 jours
      const revoke = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/revoke$/);
      if (req.method === 'POST' && revoke) {
        const out = withLock(() => {
          const list = readOrgas(), root = list.find(x => x.id === revoke[1]);
          if (!root) return null;
          const ids = [root.id, ...descendants(list, root.id)];
          writeOrgas(list.filter(x => !ids.includes(x.id)));
          return { root, removed: list.filter(x => ids.includes(x.id)).map(x => x.label) };
        });
        if (!out) return send(res, 404, { error: 'Orga introuvable.' });
        if (out.root.by) setMeta('ban:' + out.root.by, Date.now() + SPONSOR.banMs);
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'révoquée pour abus', { ref: out.root.id, detail: out.removed.join(', ') + (out.root.by ? ' · marraine privée d’invitations 30 j' : '') });
        return send(res, 200, { removed: out.removed, sponsorBanned: !!out.root.by });
      }
      // Nouvelle invitation pour une orga existante : l'ancienne clé est révoquée immédiatement
      const reinv = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/invite$/);
      if (req.method === 'POST' && reinv) {
        const token = crypto.randomBytes(18).toString('base64url');
        const o = withLock(() => {
          const list = readOrgas().slice(), i = list.findIndex(x => x.id === reinv[1]);
          if (i < 0) return null;
          list[i] = { ...list[i], hash: null, keys: [], devInv: undefined, invite: { h: sha(token), exp: Date.now() + INVITE_MS } }; writeOrgas(list); return list[i];
        });
        if (!o) return send(res, 404, { error: 'Orga introuvable.' });
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'nouvelle invitation (ancienne clé révoquée)', { ref: o.id, detail: o.label });
        return send(res, 200, { id: o.id, label: o.label, invite: token, exp: o.invite.exp });
      }
      // --- Urgences : liste, suppression, purge, pause ---
      if (req.method === 'GET' && pathname === '/api/admin/reports') {
        const now = Date.now();
        return send(res, 200, { paused: pausedUntil(now),
          reports: activeReports(now).map(publicView),
          announcements: annAll(now).sort((a, b) => b.t - a.t).map(annView),
          pending: annAll(now).filter(a => a.pending).length, legalAlerts: legalAlerts(), orgaRequests: orgaRequests().length, ordersPending: q("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n,
          pushSubs: pushCount(), moderation: modQueue(now).filter(x => !x.low).length, toPublish: mobsToPublish(now) });
      }
      // --- Réglages modifiables (bandeau, vue d'ouverture, catégories, seuils) ---
      if (req.method === 'GET' && pathname === '/api/admin/settings')
        return send(res, 200, { settings: settings(), defaults: { event: EVENT_NAME, center: CENTER, zoom: ZOOM, alertRadius: 300, nearKm: 10, ttl: BASE_TTL },
          categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, glyph: c.glyph, group: c.group, ttl: c.ttl, base: BASE_TTL[c.id], off: !!c.off })) });
      if (req.method === 'POST' && pathname === '/api/admin/settings') {
        const s = cleanSettings(await readJson(req, 8192));
        saveSettings(s);
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'réglages modifiés');
        return send(res, 200, { settings: s });
      }
      // --- Journées de mobilisation prévues ---
      if (req.method === 'GET' && pathname === '/api/admin/mobs')
        return send(res, 200, { list: mobsAll().sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ ...m, eveSent: !!getMeta('mob:eve:' + m.id), strictSet: !!getMeta('mob:strict:' + m.id), published: !!getPub(m.date) })),
          toPublish: mobsToPublish(), today: parisDay(Date.now()) });
      const mobR = pathname.match(/^\/api\/admin\/mobs(?:\/([\w-]{1,16}))?$/);
      if (mobR && req.method === 'POST') {
        const b = await readJson(req, 4096), list = mobsAll(), i = mobR[1] ? list.findIndex(m => m.id === mobR[1]) : -1;
        if (mobR[1] && i < 0) return send(res, 404, { error: 'Journée introuvable.' });
        const m = cleanMob(b, i >= 0 ? list[i] : {});
        if (m.error) return send(res, 400, m);
        if (i < 0 && m.date < parisDay(Date.now())) return send(res, 400, { error: 'Cette date est passée.' });
        if (list.some((x, j) => j !== i && x.date === m.date)) return send(res, 409, { error: 'Une journée est déjà prévue ce jour-là.' });
        if (i >= 0) list[i] = m; else list.push(m);
        setMeta('mobs', JSON.stringify(list)); dirty.global = true; scheduleFlush();
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, i >= 0 ? 'journée modifiée' : 'journée prévue', { detail: m.date + ' ' + m.title });
        return send(res, i >= 0 ? 200 : 201, m);
      }
      if (mobR && mobR[1] && req.method === 'DELETE') {
        const list = mobsAll(), next = list.filter(m => m.id !== mobR[1]);
        if (next.length === list.length) return send(res, 404, { error: 'Journée introuvable.' });
        setMeta('mobs', JSON.stringify(next)); dirty.global = true; scheduleFlush();
        return send(res, 200, { removed: true });
      }
      // --- Tableau de bord en direct ---
      if (req.method === 'GET' && pathname === '/api/admin/live') {
        const now = Date.now(), perMin = Array(15).fill(0);
        for (const x of q('SELECT t FROM reports WHERE t>?').all(now - 15 * MIN)) { const i = Math.floor((now - x.t) / MIN); if (i >= 0 && i < 15) perMin[14 - i]++; }
        let disk = null, mem = null;
        try { const st = fs.statfsSync(DATA_DIR); disk = { free: Math.round(st.bavail / st.blocks * 100), gb: Math.round(st.bavail * st.bsize / 1e9 * 10) / 10 }; } catch {}
        try { const m = fs.readFileSync('/proc/meminfo', 'utf8'), g = k => +(m.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1];
          mem = { free: Math.round(g('MemAvailable') / g('MemTotal') * 100), mb: Math.round(g('MemAvailable') / 1024) }; } catch {}
        const subs = q('SELECT COUNT(*) n, SUM(urg=1) urg, SUM(near=1) near FROM push').get();
        return send(res, 200, { now, perMin, active: q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(now).n,
          contested: q('SELECT COUNT(*) n FROM reports WHERE exp>? AND (ct>0 OR fl=-1)').get(now).n,
          streams: sseClients.size, strict: strictUntil(now), paused: pausedUntil(now), mob: mobToday(now),
          push: { subs: subs.n, urg: subs.urg || 0, near: subs.near || 0, queue: pushQueue.hi.length + pushQueue.lo.length, running: pushRunning,
            since: PSTATS.since, sent: PSTATS.sent, ok: PSTATS.ok, gone: PSTATS.gone, fail: PSTATS.fail, codes: PSTATS.codes, batches: PSTATS.batches.slice(0, 8), lastErr: PSTATS.lastErr || null },
          sys: { disk, mem, load: os.loadavg().map(x => Math.round(x * 100) / 100), cpus: os.cpus().length, uptime: Math.round(process.uptime()), rss: Math.round(process.memoryUsage().rss / 1e6) },
          load: { lagMs: Math.round(lagMs), shed: shedCount, flood: floodCount, ips: FLOOD.size }, crash: (() => { try { return JSON.parse(getMeta('crash') || 'null'); } catch { return null; } })(), up: Math.round(process.uptime()), version: APP_VERSION });
      }
      // --- File de modération : points contestés ou non fiables ---
      if (req.method === 'GET' && pathname === '/api/admin/moderation') {
        const now = Date.now();
        return send(res, 200, { list: modQueue(now) });
      }
      const modR = pathname.match(/^\/api\/admin\/reports\/([\w-]{1,16})\/(keep|verify)$/);
      if (modR && req.method === 'POST') {
        const out = tx(() => {
          const r = getReport(modR[1], Date.now());
          if (!r) return [404, { error: 'Signalement expiré.' }];
          r.down = 0; r.downIps = []; r.dw = 0; r.ct = 0; if (r.fl === -1) r.fl = 0;
          if (modR[2] === 'verify') { if (!r.ver) repAdd(r.voters[0], 'good', 2); r.ver = ADMIN_LABEL; }
          saveReport(r); orgaLog({ id: 'admin', label: ADMIN_LABEL }, modR[2] === 'verify' ? 'vérifié (modération)' : 'gardé (modération)', { r });
          return [200, publicView(r)];
        });
        return send(res, ...out);
      }
      // --- Lieux permanents ---
      if (req.method === 'GET' && pathname === '/api/admin/places') {
        const term = String(url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase(), kind = String(url.searchParams.get('kind') || '');
        const filter = url.searchParams.get('filter') || '';
        let rows = [];
        if (term.length >= 2 || filter || kind) {
          const like = '%' + term.replace(/[%_]/g, '') + '%';
          rows = q(`SELECT * FROM pois WHERE (? = '' OR lower(data) LIKE ? OR lower(id)=?) AND (? = '' OR kind=?)
            AND (? = '' OR (?='hidden' AND hid=1) OR (?='edited' AND ed=1) OR (?='admin' AND src='admin')) LIMIT 200`)
            .all(term, like, term, kind, kind, filter, filter, filter, filter);
        }
        const counts = Object.fromEntries(q('SELECT kind, COUNT(*) n FROM pois WHERE hid=0 GROUP BY kind').all().map(x => [x.kind, x.n]));
        const run = placesRun();
        return send(res, 200, { kinds: POI_KINDS, counts, last: placesStatus(), source: placesSource(), running: placesRunning ? run || {} : null, paused: !placesRunning && run ? run : null, auto: PLACES_IMPORT, list: rows.map(poiView) });
      }
      if (req.method === 'POST' && pathname === '/api/admin/places/import') {
        if (placesRunning) return send(res, 409, { error: 'Import déjà en cours.' });
        const resume = !!placesRun() && (await readJson(req)).restart !== true;
        placesImport(resume); orgaLog({ id: 'admin', label: ADMIN_LABEL }, resume ? 'import des lieux repris' : 'import des lieux lancé');
        return send(res, 202, { started: true });
      }
      const plR = pathname.match(/^\/api\/admin\/places(?:\/([\w:-]{1,24}))?$/);
      if (plR && req.method === 'POST') {
        const b = await readJson(req, 4096), old = plR[1] ? q('SELECT * FROM pois WHERE id=?').get(plR[1]) : null;
        if (plR[1] && !old) return send(res, 404, { error: 'Lieu introuvable.' });
        const kind = b.kind != null ? String(b.kind) : old?.kind;
        if (!POI[kind]) return send(res, 400, { error: 'Type de lieu inconnu.' });
        const lat = b.lat != null ? Number(b.lat) : old?.lat, lng = b.lng != null ? Number(b.lng) : old?.lng;
        if (!validLatLng(lat, lng)) return send(res, 400, { error: 'Position invalide.' });
        const d = old ? JSON.parse(old.data || '{}') : {};
        if (b.n != null) { const v = poiStr(b.n, 80); if (v) d.n = v; else delete d.n; }
        if (b.h != null) { const v = poiStr(b.h, 120); if (v) d.h = v; else delete d.h; }
        if (b.p != null) { const v = poiStr(b.p, 30); if (v) d.p = v; else delete d.p; }
        if (b.e != null) { if (b.e && kind === 'hopital') d.e = 1; else delete d.e; }
        const onlyHide = old && Object.keys(b).every(k => k === 'hid');
        const id = old ? old.id : 'a' + crypto.randomBytes(5).toString('hex');
        const rgs = new Set([poiRg(lat, lng)]); if (old) rgs.add(old.rg);
        q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,hid,ed,seen) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, lat=excluded.lat,
           lng=excluded.lng, rg=excluded.rg, data=excluded.data, hid=excluded.hid, ed=excluded.ed`)
          .run(id, kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, poiRg(lat, lng), JSON.stringify(d), old ? old.src : 'admin',
            b.hid != null ? (b.hid ? 1 : 0) : old ? old.hid : 0, onlyHide ? old.ed : 1, Date.now());
        placesPublish(rgs);
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, old ? (onlyHide ? (b.hid ? 'lieu masqué' : 'lieu réaffiché') : 'lieu corrigé') : 'lieu ajouté', { lat, lng, ref: id, detail: d.n || POI[kind].label });
        return send(res, old ? 200 : 201, poiView(q('SELECT * FROM pois WHERE id=?').get(id)));
      }
      if (plR && plR[1] && req.method === 'DELETE') {
        const old = q('SELECT * FROM pois WHERE id=?').get(plR[1]);
        if (!old) return send(res, 404, { error: 'Lieu introuvable.' });
        // Un lieu d'OpenStreetMap reviendrait au prochain import : on le masque au lieu de l'effacer
        if (old.src === 'osm') q('UPDATE pois SET hid=1 WHERE id=?').run(old.id); else q('DELETE FROM pois WHERE id=?').run(old.id);
        placesPublish([old.rg]);
        return send(res, 200, { removed: true, hidden: old.src === 'osm' });
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
      // --- Pages publiques par manif ---
      const pubA = pathname.match(/^\/api\/admin\/publish\/(\d{4}-\d{2}-\d{2})$/);
      if (pubA && req.method === 'POST') {
        const snap = pubSnapshot(pubA[1]);
        if (!snap) return send(res, 404, { error: 'Aucun signalement ce jour-là.' });
        q('INSERT OR REPLACE INTO pub(date,t,data) VALUES(?,?,?)').run(pubA[1], Date.now(), JSON.stringify(snap));
        return send(res, 200, { url: '/manif/' + pubA[1], total: snap.total });
      }
      if (pubA && req.method === 'DELETE') { q('DELETE FROM pub WHERE date=?').run(pubA[1]); return send(res, 200, { removed: true }); }
      // --- Demandes d'accès orga ---
      if (req.method === 'GET' && pathname === '/api/admin/orga-requests') return send(res, 200, { list: orgaRequests() });
      const oreq = pathname.match(/^\/api\/admin\/orga-requests\/([\w-]{1,16})$/);
      if (oreq && req.method === 'DELETE') {
        const n = q('DELETE FROM orga_req WHERE id=?').run(oreq[1]).changes;
        return n ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Demande déjà traitée.' });
      }
      // --- Annuaire des legal teams ---
      if (req.method === 'GET' && pathname === '/api/admin/legal') {
        return send(res, 200, { lastWatch: +getMeta('legalwatch') || null,
          list: legalAll().map(e => ({ ...legalView(e), ok: !!e.ok, srcDate: e.srcDate || null, seed: !!e.seed, status: watchStatus(e),
            watch: e.watch ? { at: e.watch.at, err: e.watch.err || null, found: !!e.watch.found, phones: e.watch.phones || [] } : null, base: e.base || null })) });
      }
      if (req.method === 'POST' && pathname === '/api/admin/legal') {
        const b = await readJson(req);
        const old = b.id ? getLegal(String(b.id)) : null;
        if (b.id && !old) return send(res, 404, { error: 'Ligne introuvable.' });
        const [st, e] = cleanLegal(b, old || { id: crypto.randomBytes(5).toString('base64url'), ok: false, added: Date.now() });
        if (st !== 200) return send(res, st, { error: e });
        // Numéro ou source modifiés : la ligne doit être revalidée et la référence de la veille est refaite
        if (old && (phoneDigits(old.phone) !== phoneDigits(e.phone) || old.src !== e.src)) { e.ok = false; delete e.base; delete e.watch; }
        saveLegal(e); orgaLog({ id: 'admin', label: ADMIN_LABEL }, old ? 'annuaire modifié' : 'annuaire ajouté', { ref: e.id, detail: e.city + ' ' + e.phone });
        return send(res, 200, legalView(e));
      }
      const legalAct = pathname.match(/^\/api\/admin\/legal\/([\w-]{1,16})(?:\/(validate|unvalidate|ack))?$/);
      if (legalAct && req.method === 'DELETE' && !legalAct[2]) {
        const e = getLegal(legalAct[1]); if (!e) return send(res, 404, { error: 'Ligne introuvable.' });
        q('DELETE FROM legal_dir WHERE id=?').run(e.id); dirty.legal = true; scheduleFlush();
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'annuaire retiré', { ref: e.id, detail: e.city + ' ' + e.phone });
        return send(res, 200, { removed: true });
      }
      if (legalAct && req.method === 'POST' && legalAct[2]) {
        const e = getLegal(legalAct[1]); if (!e) return send(res, 404, { error: 'Ligne introuvable.' });
        if (legalAct[2] === 'validate') { e.ok = true; e.checked = Date.now(); delete e.seed; }
        if (legalAct[2] === 'unvalidate') e.ok = false;
        // « Vu » : la page source a changé mais le numéro est toujours bon → nouvelle référence
        if (legalAct[2] === 'ack') { if (e.watch && e.watch.phones) e.base = e.watch.phones; e.checked = Date.now(); }
        saveLegal(e); orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'annuaire ' + { validate: 'validé', unvalidate: 'dépublié', ack: 'source revue' }[legalAct[2]], { ref: e.id, detail: e.city + ' ' + e.phone });
        return send(res, 200, legalView(e));
      }
      if (req.method === 'POST' && pathname === '/api/admin/legal-watch') {
        await legalWatch(true);
        return send(res, 200, { done: true });
      }
      // --- Arrêtés : propositions à valider, publiés, import d'un bloc préparé ---
      if (req.method === 'GET' && pathname === '/api/admin/orders') return send(res, 200, { orders: ordersAll().map(orderView), kinds: ORDER_KINDS, deps: DEPS.map(d => [d.c, d.n]) });
      if (req.method === 'POST' && pathname === '/api/admin/orders') {
        const out = await createOrder(await readJson(req, 16384), { admin: true });
        if (out[0] < 300) orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'arrêté publié', { ref: out[1].id, detail: out[1].zone && out[1].zone.name });
        return send(res, ...out);
      }
      if (req.method === 'POST' && pathname === '/api/admin/orders/import') {
        const b = await readJson(req, 65536);
        let list; try { list = JSON.parse(String(b.text || '')); } catch { return send(res, 400, { error: 'Bloc illisible : colle-le en entier, du premier [ au dernier ].' }); }
        if (list && !Array.isArray(list)) list = list.arretes || list.orders || [list];
        if (!Array.isArray(list) || !list.length || list.length > 30) return send(res, 400, { error: 'Le bloc doit contenir entre 1 et 30 arrêtés.' });
        const results = [];
        for (const x of list) { const [st, out] = await createOrder(x || {}, { admin: true }); results.push(st < 300 ? { ok: true, name: out.zone.name, id: out.id } : { ok: false, error: out.error, name: (x && (x.commune || x.departement || x.dep)) || '?' }); }
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, 'arrêtés importés', { detail: `${results.filter(r => r.ok).length} / ${results.length}` });
        return send(res, 200, { results });
      }
      const ordAct = pathname.match(/^\/api\/admin\/orders\/([\w-]{1,16})(\/approve)?$/);
      if (ordAct && req.method === 'POST' && ordAct[2]) return send(res, ...await approveOrder(ordAct[1]));
      if (ordAct && req.method === 'DELETE' && !ordAct[2]) return dropOrder(ordAct[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Introuvable.' });
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
        list.forEach(r => archive(r, 'purge'));
        rebuildAll();
        const n = list.length;
        return send(res, 200, { removed: n });
      }
      // Effacement d'urgence : toutes les traces liées aux personnes, d'un coup (signalements, journal, corbeille,
      // empreintes, abonnements aux notifications, archive du digest), et nouvelle clé de hachage.
      // On garde : les orgas, l'agenda public (sans empreinte), les réglages.
      if (req.method === 'POST' && pathname === '/api/admin/wipe') {
        const b = await readJson(req);
        if (b.confirm !== 'EFFACER') return send(res, 400, { error: 'Tape EFFACER pour confirmer.' });
        const n = tx(() => {
          const n = q('DELETE FROM reports').run().changes;
          for (const t of ['ann', 'orga_log', 'trash', 'devices', 'rate', 'quota', 'hidden', 'push', 'abuse', 'orga_req']) q('DELETE FROM ' + t).run();
          for (const e of listEvents()) if (e.dev) { delete e.dev; saveEvent(e); }
          q("UPDATE events SET dev=NULL").run();
          // Arrêtés proposés par des participant·es : l'empreinte du téléphone disparaît aussi (colonne et données)
          for (const x of q('SELECT id, data FROM orders').all()) { const o = JSON.parse(x.data); if ('dev' in o) { delete o.dev; q('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o), x.id); } }
          q('UPDATE orders SET dev=NULL').run();
          // Bilans publics : seulement si l'admin le demande (ils ne contiennent que des totaux et des points arrondis)
          if (b.pub === true) q('DELETE FROM pub').run();
          return n;
        });
        // Archive du digest : chaque fichier séparément (un fichier qui résiste n'empêche pas d'effacer les autres)
        const left = [];
        try { for (const f of fs.readdirSync(ARCHIVE_DIR)) try { fs.unlinkSync(path.join(ARCHIVE_DIR, f)); } catch { left.push(f); } } catch {}
        const rotated = (() => { try { return rotateSecret(); } catch { return false; } })();
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
        rebuildAll();
        console.log('effacement d’urgence effectué' + (left.length ? ` (${left.length} fichier(s) d’archive non effacé(s))` : ''));
        return send(res, left.length ? 500 : 200, { removed: n, rotated, pub: b.pub === true, left: left.length, ...(left.length ? { error: `${left.length} fichier(s) de l’archive n’ont pas pu être effacés : vérifie les droits du dossier.` } : {}) });
      }
      // --- Tableau des abus (24 h) et mode manif renforcé ---
      if (req.method === 'GET' && pathname === '/api/admin/abuse') {
        const now = Date.now(), since = now - 24 * 60 * MIN;
        const rows = q('SELECT t, kind, lat, lng FROM abuse WHERE t>? ORDER BY t').all(since);
        const kinds = {}, hours = {}, zones = new Map();
        for (const x of rows) {
          kinds[x.kind] = (kinds[x.kind] || 0) + 1;
          const h = Math.floor((now - x.t) / (60 * MIN)); // 0 = dernière heure
          (hours[x.kind] ||= Array(24).fill(0))[Math.min(23, h)]++;
          if (x.lat != null) {
            const k = (Math.round(x.lat * 20) / 20).toFixed(2) + ',' + (Math.round(x.lng * 20) / 20).toFixed(2); // ≈ 5 km
            const z = zones.get(k) || { lat: +k.split(',')[0], lng: +k.split(',')[1], n: 0, kinds: {} };
            z.n++; z.kinds[x.kind] = (z.kinds[x.kind] || 0) + 1; zones.set(k, z);
          }
        }
        const top = [...zones.values()].sort((a, b) => b.n - a.n).slice(0, 10);
        for (const z of top) z.name = placeOf(z.lat, z.lng);
        return send(res, 200, { kinds, hours, zones: top, strict: strictUntil(now), paused: pausedUntil(now),
          trusted: q('SELECT COUNT(*) n FROM devices WHERE COALESCE(good,0) - 2 * COALESCE(bad,0) >= ?').get(TRUST).n,
          unreliable: q('SELECT COUNT(*) n FROM reports WHERE fl=-1 AND up=0 AND exp>?').get(now).n });
      }
      if (req.method === 'POST' && pathname === '/api/admin/strict') {
        const b = await readJson(req);
        const minutes = Math.min(Math.max(Number(b.minutes) || 0, 0), 24 * 60);
        const until = minutes ? Date.now() + minutes * MIN : 0;
        setMeta('strict', until);
        orgaLog({ id: 'admin', label: ADMIN_LABEL }, until ? 'mode manif renforcé' : 'fin du mode renforcé', { detail: until ? minutes + ' min' : null });
        return send(res, 200, { strict: until });
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
      const { rows, zones, abroad } = dayRows(date);
      // Activité des orgas et anti-abus ce jour-là
      const day0 = Date.parse(date + 'T00:00:00+02:00'), lo = day0 - 2 * 3600e3, hi = day0 + 26 * 3600e3;
      const logs = q('SELECT t, oid, action, detail FROM orga_log WHERE t BETWEEN ? AND ?').all(lo, hi).filter(x => parisDay(x.t) === date);
      const cnt = f => logs.filter(f).length;
      const orga = { verified: cnt(x => /^vérifié|^confirmé \(parrainée\)/.test(x.action)), removed: cnt(x => x.oid !== 'admin' && /^retiré|^retrait \(essai\)/.test(x.action)), adminRemoved: cnt(x => x.oid === 'admin' && x.action === 'retiré'),
        announcements: cnt(x => x.action === 'annonce'), urgent: cnt(x => x.action === 'annonce' && /\[urgent\]/.test(x.detail || '')),
        legal: cnt(x => /^legal team/.test(x.action)), restored: cnt(x => x.action === 'restauré'), contested: cnt(x => x.action === 'contesté') };
      const abuse = {};
      for (const x of q('SELECT t, kind FROM abuse WHERE t BETWEEN ? AND ?').all(lo, hi)) if (parisDay(x.t) === date) abuse[x.kind] = (abuse[x.kind] || 0) + 1;
      // Comparaison : les 14 jours précédents
      const history = [];
      for (let i = 14; i >= 0; i--) { const d = parisDay(Date.parse(date + 'T12:00:00+02:00') - i * 86400e3); history.push({ date: d, total: i ? dayCountFr(d) : rows.length }); }
      const events = listEvents().filter(e => parisDay(e.start) === date && e.status !== 'pending').map(e => ({ title: e.title, type: e.type, place: e.place, start: e.start }));
      return send(res, 200, { date, rows, zones, abroad, communes: commIndex().rows.length > 0, orga, abuse, history, events, published: !!getPub(date),
        categories: CATEGORIES.map(({ id, label, glyph, group, ttl }) => ({ id, label, glyph, group, ttl })), groups: GROUPS,
        days: fs.readdirSync(ARCHIVE_DIR).map(f => f.slice(0, 10)).sort().reverse() });
    }

    if (req.method === 'POST' && pathname === '/api/reports') {
      const b = await readJson(req);
      const cat = Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!cat) return send(res, 400, { error: 'Catégorie inconnue.' });
      if (cat.off) return send(res, 400, { error: 'Ce type de signalement est désactivé pour l’instant.' });
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
      const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX);
      const ipH = clientHash(req), dev = deviceHash(req);
      // Orga confirmée (ni en essai, ni parrainée en attente) : son signalement est vérifié d'office et dure deux fois plus longtemps
      const orga = req.headers['x-orga-key'] ? orgaOf(req) : null, sure = !!(orga && !orga.trial && !orga.sponsored);
      const result = tx(() => {
        const base = cat.ttl * MIN, now = Date.now(), ttl = sure ? 2 * base : base;
        const strict = strictUntil(now) > 0;
        // Heure où le signalement a été fait (file d'attente hors ligne). Jamais dans le futur ;
        // mentir dessus ne peut que raccourcir la vie du point.
        const t0 = Math.min(now, Number(b.t) || now);
        if (t0 + ttl <= now) return [410, { error: 'Signalement trop ancien, il n’a pas été publié.', stale: true }];
        if (pausedUntil(now)) return [503, { error: 'Les signalements sont en pause quelques minutes (afflux de faux signalements). Réessaie bientôt.' }];
        if (!allow(dev, ipH, 'report', now)) { abuseOnce('signalements en rafale', dev, RATE.windowMs, { lat, lng }); return [429, { error: 'Trop de signalements d’un coup. Réessaie dans quelques minutes.' }]; }
        // Après la limite d'envois : un identifiant inventé à chaque requête refusée ne remplit pas la table
        const age = deviceAge(dev, now);
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
          if (!self) { r.voters.push(dev); r.up++; firstConfirm(r); }
          // Preuve plus fraîche que les « Plus là » : on les efface
          if (t0 >= (r.last || r.t)) { r.down = 0; r.downIps = []; r.dw = 0; r.ct = 0; }
          // Point qui suit (forces mobiles, tête, queue) : il se déplace, sauf s'il est partagé en direct par une orga (sa position fait foi)
          if (m.move && !r.bk && t0 >= (r.last || r.t) && (r.lat !== pos.lat || r.lng !== pos.lng)) { addTrail(r, now); r.lat = pos.lat; r.lng = pos.lng; }
          if (note) addNote(r, note, dev, t0);
          r.last = Math.max(r.last || r.t, t0);
          r.exp = Math.max(r.exp, t0 + ttl);
          if (sure) {
            r.exp = Math.min(r.exp, Math.max(r.t + 4 * base, t0 + ttl));
            if (!r.ver) { repAdd(r.voters[0], 'good', 2); r.ver = orga.label; orgaLog(orga, 'vérifié (signalement)', { r }); }
            if (r.fl === -1) r.fl = 0;
          }
          saveReport(r);
          return [200, { ...publicView(r), merged: true, self }];
        }

        const cell = cellId(pos.lat, pos.lng);
        if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND ip=? AND exp>?').get(cell, ipH, now).n >= (strict ? Math.ceil(MAX_PER_NET_ZONE / 2) : MAX_PER_NET_ZONE))
          return [429, { error: 'Trop de signalements depuis ton réseau dans cette zone. Confirme plutôt ceux qui existent.' }];
        if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND exp>?').get(cell, now).n >= MAX_PER_ZONE) {
          // Zone pleine : on fait de la place en retirant le plus ancien point que personne n'a confirmé ni vérifié
          const old = q('SELECT id FROM reports WHERE cell=? AND exp>? AND ver IS NULL AND up=0 ORDER BY t LIMIT 1').get(cell, now);
          if (!old) return [503, { error: 'Zone saturée, réessaie dans quelques minutes.' }];
          dropReport(old.id, 'full');
        }
        if (q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(now).n >= MAX_REPORTS) return [503, { error: 'Carte saturée, réessaie plus tard.' }];
        const r = { id: crypto.randomBytes(6).toString('base64url'), cat: cat.id, lat: pos.lat, lng: pos.lng, note, notes: note ? [{ x: note, t: t0, d: dev }] : [],
          t: t0, last: t0, exp: t0 + ttl, up: 0, down: 0, voters: [dev], downIps: [], ip: ipH };
        // Fiabilité : téléphone fiable aujourd'hui, ou au contraire série suspecte près des zones calmes / téléphone neuf en mode renforcé
        const trusted = devRep(dev) >= TRUST;
        if (isDanger(cat.id)) {
          const calms = nearby('calme', pos.lat, pos.lng, CALM_KILL_M, now).filter(x => !x.r.ct);
          for (const x of calms) abuseLog('danger près zone calme', { lat: pos.lat, lng: pos.lng, dev, net: ipH, ref: x.r.id });
          if (calms.length && !trusted && calmSeries(dev, ipH, now)) { r.fl = -1; abuseOnce('série de dangers près des zones calmes', dev, SERIES.win, { lat: pos.lat, lng: pos.lng }); }
        }
        if (!r.fl && strict && !trusted && age < CONTEST.newDev) r.fl = -1;
        if (!r.fl && trusted) r.fl = 1;
        if (sure) { r.ver = orga.label; r.fl = 1; r.oid = orga.id; r.notes.forEach(n => { n.d = 'o:' + orga.id; }); }
        saveReport(r);
        if (sure) orgaLog(orga, 'signalement', { r });
        // Notification « danger près de toi » : seulement pour un téléphone qui n'est pas tout neuf (ou fiable), jamais pour un signalement non fiable
        if (ALERT_CATS.has(cat.id) && r.fl !== -1 && (age >= CONTEST.newDev || trusted || sure)) pushNearLater(r);
        if (sure) return [201, { ...publicView(r), mine: true }];
        return [201, publicView(r)];
      });
      return send(res, ...result);
    }

    // Agenda : une orga publie directement, un·e participant·e propose (validé ensuite par l'admin)
    // Proposer un arrêté ou une restriction (validé par l'admin avant d'apparaître)
    if (req.method === 'POST' && pathname === '/api/orders') return send(res, ...await createOrder(await readJson(req, 8192), { dev: deviceHash(req), ipH: clientHash(req) }));

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
        const age = deviceAge(dev, now), strict = strictUntil(now) > 0, trusted = devRep(dev) >= TRUST;
        r.voters.push(dev);
        if (b.v === 1) {
          r.up++; r.last = now; firstConfirm(r);
          const ttl = CAT[r.cat].ttl * MIN;
          r.exp = Math.min(Math.max(r.exp, now + ttl), r.t + 4 * ttl); // prolonge, plafonné à 4× la durée de base
          if (r.ct && (r.dw || 0) < contestNeed(r)) r.ct = 0; // confirmé : plus contesté
        } else {
          // Un téléphone ou un réseau qui conteste beaucoup de points d'affilée n'est plus compté. On ne le lui dit pas.
          const k = strict ? 2 / 3 : 1;
          const devOk = bump('dn:' + dev, 'vote', Math.ceil(CONTEST.devBurst * k), now), netOk = bump('dnn:' + ipH, 'vote', Math.ceil(CONTEST.netBurst * k), now);
          if (!devOk || !netOk) { abuseOnce('« Plus là » en rafale', dev, RATE.windowMs, { lat: r.lat, lng: r.lng }); saveReport(r); return [200, { ...publicView(r), down: r.down + 1 }]; }
          const before = { ...r, voters: r.voters.slice(0, -1) };
          r.down++;
          const aged = age >= CONTEST.newDev;
          // Poids : sur place ×2, identifiant pas tout neuf ×2, téléphone fiable +2 ; en mode renforcé un identifiant neuf ne compte pas
          let w = (b.here === true ? CONTEST.near : 1) * (aged ? CONTEST.aged : 1) + (trusted ? 2 : 0);
          if (strict && !aged && !trusted) w = 0;
          r.dw = (r.dw || 0) + w;
          (r.downIps ||= []).push(ipH);
          // Un signalement vérifié par une orga ne peut pas être contesté par les votes.
          const nets = new Set(r.downIps).size, need = contestNeed(r);
          if (!r.ver && r.dw >= need && nets >= 2) {
            if (!r.ct) { r.ct = now; snapshotContested(before, now); orgaLog(VOTES, 'contesté', { r, detail: nets + ' réseaux' }); repAdd(r.voters[0], 'bad'); abuseLog('point contesté', { lat: r.lat, lng: r.lng, ref: r.id }); }
            r.exp = Math.min(r.exp, now + (r.dw >= need + CONTEST.more && nets >= 3 ? CONTEST.short : CONTEST.soft));
          }
        }
        saveReport(r);
        return [200, publicView(r)];
      });
      return send(res, ...result);
    }


    // ---- Invitation d'orga : le jeton du QR code est échangé une seule fois contre une clé ----
    if (req.method === 'POST' && pathname === '/api/invite') {
      if (keyLocked(req)) return send(res, 429, { error: 'Trop d’essais, réessaie dans quelques minutes.' });
      const b = await readJson(req);
      const token = String(b.token || '');
      if (!/^[\w-]{20,40}$/.test(token)) { keyFailed(req); return send(res, 400, { error: 'Invitation invalide.' }); }
      const key = crypto.randomBytes(18).toString('base64url'), h = sha(token);
      let device = false;
      const o = withLock(() => {
        const list = readOrgas().slice(), now = Date.now();
        let i = list.findIndex(x => x.invite && keyEq(x.invite.h, h) && x.invite.exp > now);
        if (i >= 0) { const { invite, ...rest } = list[i]; list[i] = { ...rest, hash: sha(key), keys: [], activated: rest.activated || now }; writeOrgas(list); return list[i]; }
        // Ajout d'un appareil : la clé principale reste valable, on en ajoute une (5 appareils au plus)
        i = list.findIndex(x => x.devInv && keyEq(x.devInv.h, h) && x.devInv.exp > now);
        if (i >= 0) { const { devInv, ...rest } = list[i]; list[i] = { ...rest, keys: [...(rest.keys || []), sha(key)].slice(-(DEVICE_MAX - 1)) }; writeOrgas(list); device = true; return list[i]; }
        return null;
      });
      if (!o) { keyFailed(req); return send(res, 404, { error: 'Lien expiré ou déjà utilisé. Demande-en un nouveau.' }); }
      orgaLog({ id: o.id, label: o.label }, device ? 'appareil ajouté' : 'invitation utilisée');
      return send(res, 200, { key, label: o.label, device });
    }

    // ---- Espace orga / legal team ----
    if (pathname.startsWith('/api/orga') || pathname.startsWith('/api/announcements') || /^\/api\/events\/[\w-]{1,16}$/.test(pathname)
      || /^\/api\/reports\/[\w-]{1,16}\/(verify|remove|extend|edit)$/.test(pathname)) {
      const orga = orgaOf(req);
      if (!orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });

      if (req.method === 'GET' && pathname === '/api/orga/me') {
        const me = readOrgas().find(x => x.id === orga.id);
        return send(res, 200, { label: orga.label, ob: ownerTag(orga.admin ? 'admin' : orga.id), admin: orga.admin, trial: orga.trial, sponsored: !!orga.sponsored,
          sponsor: me && me.by ? (readOrgas().find(x => x.id === me.by)?.label || me.byLabel || null) : null,
          canInvite: !orga.trial && !banUntil(orga.id), ban: banUntil(orga.id), canAddDevice: !!me, devices: me && me.hash ? 1 + (me.keys || []).length : 0 });
      }

      // Ses propres annonces, y compris les numéros en attente de validation
      if (req.method === 'GET' && pathname === '/api/orga/mine') {
        return send(res, 200, { a: annAll(Date.now()).filter(a => orga.admin ? true : a.oid === orga.id).sort((a, b) => b.t - a.t).map(annView) });
      }

      // --- Parrainage : une orga confirmée invite une autre orga (QR code / lien à usage unique, 24 h) ---
      if (req.method === 'POST' && pathname === '/api/orga/invite') {
        if (orga.trial) return send(res, 400, { error: 'Seules les orgas confirmées peuvent inviter.' });
        const ban = banUntil(orga.id);
        if (ban) return send(res, 400, { error: 'Invitations suspendues jusqu’au ' + new Date(ban).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' (une orga que tu as invitée a été révoquée).' });
        const b = await readJson(req);
        const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
        if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga invitée.' });
        const { token, invite } = newInvite();
        const out = withLock(() => {
          const list = readOrgas().slice();
          if (labelClash(label, { sponsor: true })) return 'dup';
          if (!orga.admin && list.filter(o => o.by === orga.id && o.created > Date.now() - SPONSOR.quotaMs).length >= SPONSOR.quota) return 'quota';
          const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, sponsored: true, by: orga.id, byLabel: orga.label, invite };
          list.push(o); writeOrgas(list); return o;
        });
        if (out === 'dup') return send(res, 409, { error: labelClash(label, { sponsor: true }) || 'Une orga porte déjà ce nom.' });
        if (out === 'quota') return send(res, 429, { error: `${SPONSOR.quota} invitations par semaine au maximum. Réessaie dans quelques jours.` });
        orgaLog(orga, 'invitation (parrainage)', { ref: out.id, detail: out.label });
        return send(res, 201, { id: out.id, label: out.label, invite: token, exp: invite.exp });
      }
      if (req.method === 'GET' && pathname === '/api/orga/filleules') {
        const list = readOrgas().filter(o => o.by === orga.id);
        return send(res, 200, { orgas: list.map(o => ({ id: o.id, label: o.label, created: o.created, active: !!o.hash, trial: o.trial === true,
          invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, ...orgaReady(o),
          recent: q('SELECT t, action, cat FROM orga_log WHERE oid=? ORDER BY t DESC LIMIT 15').all(o.id) })) });
      }
      const fil = pathname.match(/^\/api\/orga\/filleules\/([\w-]{1,16})\/(confirm|invite)$/);
      if (req.method === 'POST' && fil) {
        const target = readOrgas().find(o => o.id === fil[1] && o.by === orga.id);
        if (!target) return send(res, 404, { error: 'Orga introuvable parmi tes invitées.' });
        if (fil[2] === 'confirm') {
          if (!target.trial) return send(res, 400, { error: 'Déjà confirmée.' });
          if (!orgaReady(target).ready) return send(res, 400, { error: 'Pas encore prête : il faut au moins 7 jours, 10 actions et aucun incident. Seul·e l’admin peut la confirmer avant.' });
          withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], trial: false }; writeOrgas(l); } });
          orgaLog(orga, 'confirmée (parrainage)', { ref: target.id, detail: target.label });
          return send(res, 200, { id: target.id, trial: false });
        }
        // Nouvelle invitation (la filleule a perdu son accès) : l'ancien accès est coupé
        const { token, invite } = newInvite();
        withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], hash: null, keys: [], invite }; writeOrgas(l); } });
        orgaLog(orga, 'nouvelle invitation (parrainage)', { ref: target.id, detail: target.label });
        return send(res, 200, { id: target.id, label: target.label, invite: token, exp: invite.exp });
      }
      // --- Ajouter un appareil : lien à usage unique, 10 minutes, la clé actuelle reste valable ---
      // --- Position en direct (orgas confirmées) : tête ou queue de cortège, street medic, legal team, presse ---
      // Le téléphone de l'orga envoie sa position toutes les 30 s tant que l'appli est ouverte ; le point disparaît 3 min après
      // le dernier envoi, et le partage s'arrête de lui-même au bout de 8 h. Seule la dernière position est gardée
      // (plus la trace des 30 dernières minutes pour la tête et la queue, jamais pour une personne).
      if (pathname === '/api/orga/beacon' && (req.method === 'POST' || req.method === 'DELETE')) {
        const b = await readJson(req);
        const role = String(b.role || '');
        if (!BEACON_ROLES.has(role) || !CAT[role]) return send(res, 400, { error: 'Rôle inconnu.' });
        if (orga.trial) return send(res, 403, { error: 'Le partage de position est réservé aux orgas confirmées.' });
        const out = tx(() => {
          const now = Date.now();
          const cur = toReport(q('SELECT * FROM reports WHERE oid=? AND cat=? AND bk>0 AND exp>?').get(orga.id, role, now));
          if (req.method === 'DELETE') { if (cur) { dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position', { r: cur }); } return [200, { stopped: true }]; }
          const lat = Number(b.lat), lng = Number(b.lng);
          if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
          if (cur && now - cur.bk > BEACON_MAX) { dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position', { r: cur }); return [410, { error: 'Partage arrêté au bout de 4 h. Relance-le si besoin.' }]; }
          // Garde-fou : à plus de 2 km du point de départ (et du parcours d'une manif en cours), le partage s'arrête tout seul
          // et cette position n'est jamais enregistrée (une orga qui oublie de l'arrêter ne révèle pas où elle rentre)
          if (cur && cur.bkla != null && distM({ lat: cur.bkla, lng: cur.bklo }, { lat, lng }) > BEACON_ZONE_M && routeDistM(lat, lng, now) > BEACON_ZONE_M) {
            dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position (hors zone)', { r: cur });
            return [410, { error: 'Tu t’es éloigné·e de plus de 2 km de la manif : partage de position arrêté.', zone: true }];
          }
          if (cur && now - (cur.last || cur.t) < 10_000) return [200, publicView(cur)];
          const pos = { lat: round(lat), lng: round(lng) };
          if (cur) {
            if (cur.lat !== pos.lat || cur.lng !== pos.lng) { addTrail(cur, now); cur.lat = pos.lat; cur.lng = pos.lng; }
            Object.assign(cur, { last: now, exp: now + BEACON_TTL, down: 0, downIps: [], dw: 0, ct: 0, ver: orga.label, fl: 1 });
            saveReport(cur); return [200, publicView(cur)];
          }
          const r = { id: crypto.randomBytes(6).toString('base64url'), cat: role, lat: pos.lat, lng: pos.lng, note: '', notes: [], t: now, last: now, exp: now + BEACON_TTL,
            up: 0, down: 0, voters: ['o:' + orga.id], downIps: [], ip: null, ver: orga.label, fl: 1, oid: orga.id, bk: now, trail: [], bkla: pos.lat, bklo: pos.lng };
          // Tête ou queue déjà signalée tout près par des participant·es : la position de l'orga prend le relais (avec la trace)
          if (TRAIL_CATS.has(role)) for (const x of nearby(role, pos.lat, pos.lng, MERGE[role].r, now).filter(x => !x.r.bk)) {
            const old = toReport(x.r); r.trail = [...(old.trail || []), [old.lat, old.lng, old.last || old.t]].slice(-TRAIL_MAX[role]); r.up += old.up || 0; dropReport(old.id, 'exp');
          }
          saveReport(r); orgaLog(orga, 'partage de position', { r });
          return [201, publicView(r)];
        });
        return send(res, ...out);
      }
      if (req.method === 'POST' && pathname === '/api/orga/device') {
        const token = crypto.randomBytes(18).toString('base64url');
        const ok = withLock(() => {
          const l = readOrgas().slice(), i = l.findIndex(x => x.id === orga.id);
          if (i < 0) return false;
          l[i] = { ...l[i], devInv: { h: sha(token), exp: Date.now() + DEVICE_MS } }; writeOrgas(l); return true;
        });
        if (!ok) return send(res, 400, { error: 'Pas possible pour un accès défini par l’admin dans les réglages du serveur.' });
        orgaLog(orga, 'lien d’appareil créé');
        return send(res, 200, { invite: token, exp: Date.now() + DEVICE_MS });
      }

      if (req.method === 'POST' && pathname === '/api/announcements') {
        const b = await readJson(req);
        // Période d'essai : pas d'annonce urgente (notification à toute la zone), numéro de legal team validé par l'admin
        if (orga.trial && b.kind !== 'legal' && b.level === 'urgent')
          return send(res, 400, { error: 'Pendant la période d’essai, les annonces urgentes ne sont pas possibles. Publie-la en « info ».' });
        if (orga.sponsored && b.kind !== 'legal' && q("SELECT COUNT(*) n FROM orga_log WHERE oid=? AND action IN ('annonce', 'annonce (en attente)') AND t>?").get(orga.id, Date.now() - 24 * 60 * 60_000).n >= SPONSOR.annPerDay)
          return send(res, 400, { error: `Orga parrainée : ${SPONSOR.annPerDay} annonces par jour au maximum jusqu’à ta confirmation.` });
        if (!orga.admin && !quota('ann:' + orga.id, ORGA_LIMITS.annPerDay, 24 * 60 * MIN))
          return send(res, 429, { error: `${ORGA_LIMITS.annPerDay} annonces par jour au maximum.` });
        // Notifications urgentes : au plus quelques-unes par heure et par orga (une orga piratée ne peut pas inonder les téléphones)
        if (!orga.admin && b.kind !== 'legal' && b.level === 'urgent' && !quota('urg:' + orga.id, ORGA_LIMITS.urgentPerHour, 60 * MIN)) {
          abuseLog('orga en rafale', { ref: orga.id });
          return send(res, 429, { error: `${ORGA_LIMITS.urgentPerHour} annonces urgentes par heure au maximum. Publie celle-ci en « info ».` });
        }
        // Période d'essai : toute annonce (info ou numéro de legal team) n'est visible qu'après validation par l'admin
        const out = createAnnouncement(b, orga.label, orga.admin, orga.trial, orga.admin ? 'admin' : orga.id);
        if (out[0] === 201) orgaLog(orga, out[1].pending ? (out[1].kind === 'legal' ? 'legal team (en attente)' : 'annonce (en attente)') : 'annonce', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id,
          detail: (out[1].kind === 'legal' ? out[1].phone + ' ' : '') + (out[1].level === 'urgent' ? '[urgent] ' : '') + (out[1].national ? '[nationale] ' : '') + (out[1].text || '') });
        return send(res, ...out);
      }

      const delEv = pathname.match(/^\/api\/events\/([\w-]{1,16})$/);
      if (req.method === 'DELETE' && delEv) {
        const out = tx(() => {
          const e = getEvent(delEv[1]);
          if (!e) return [404, { error: 'Événement déjà retiré.' }];
          if (!canManage(orga, e)) return [403, { error: 'Seule l’orga qui l’a publié peut le retirer.' }];
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
          if (!canManage(orga, a)) return [403, { error: 'Seul·e l’auteur·ice peut retirer cette annonce.' }];
          dropAnn(a.id); orgaLog(orga, 'annonce retirée', { lat: a.lat, lng: a.lng, ref: a.id, detail: a.phone || a.text }); return [200, { removed: true }];
        });
        return send(res, ...out);
      }

      // Son propre signalement : le prolonger (une durée de plus, au plus 4 fois la durée normale à partir de maintenant) ou le corriger
      const own = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(extend|edit)$/);
      if (req.method === 'POST' && own) {
        const b = own[2] === 'edit' ? await readJson(req) : {};
        const out = tx(() => {
          const now = Date.now(), r = getReport(own[1], now);
          if (!r) return [404, { error: 'Signalement expiré.' }];
          if (!orga.admin && r.oid !== orga.id) return [403, { error: 'Seule l’orga qui l’a signalé peut le modifier.' }];
          if (own[2] === 'extend') {
            const base = CAT[r.cat].ttl * MIN;
            const exp = Math.min(Math.max(r.exp, now) + base, now + 4 * base);
            if (exp <= r.exp + MIN) return [409, { error: 'Déjà prolongé au maximum.' }];
            r.exp = exp; r.last = now; saveReport(r); orgaLog(orga, 'prolongé', { r });
            return [200, { ...publicView(r), mine: true }];
          }
          const cat = b.cat != null && Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
          if (b.cat != null && (!cat || cat.off)) return [400, { error: 'Catégorie inconnue.' }];
          const note = b.note == null ? null : String(b.note).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
          if (cat && cat.id !== r.cat) r.cat = cat.id;
          if (note != null) {
            const mark = 'o:' + orga.id;
            r.notes = (r.notes || []).filter(n => n.d !== mark);
            if (note) addNote(r, note, mark, now);
          }
          saveReport(r); orgaLog(orga, 'corrigé', { r, detail: note || null });
          return [200, { ...publicView(r), mine: true }];
        });
        return send(res, ...out);
      }
      const act = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(verify|remove)$/);
      if (req.method === 'POST' && act) {
        const out = tx(() => {
          const r = getReport(act[1], Date.now());
          if (!r) return [404, { error: 'Signalement expiré.' }];
          // Vérifications en rafale : bloquées quelques minutes, et l'admin le voit dans le tableau des abus
          if (act[2] === 'verify' && !orga.admin && !bump('orv:' + orga.id, 'report', ORGA_LIMITS.verify, Date.now())) {
            orgaLog(orga, 'vérification bloquée (rafale)', { r }); abuseLog('orga en rafale', { lat: r.lat, lng: r.lng, ref: orga.id });
            return [429, { error: 'Trop de vérifications d’un coup : c’est suspendu quelques minutes. L’admin est prévenu·e.' }];
          }
          // Période d'essai (parrainée ou non) : « Vérifier » vaut une confirmation forte, sans la coche « vérifié », le point reste contestable
          if (act[2] === 'verify' && (orga.sponsored || orga.trial)) {
            const mark = 'o:' + orga.id;
            if (r.voters.includes(mark)) return [409, { error: 'Déjà confirmé.' }];
            r.voters.push(mark); r.up++; r.last = Date.now(); firstConfirm(r);
            const ttl = CAT[r.cat].ttl * MIN; r.exp = Math.min(Math.max(r.exp, Date.now() + ttl), r.t + 4 * ttl);
            saveReport(r); orgaLog(orga, orga.sponsored ? 'confirmé (parrainée)' : 'confirmé (essai)', { r }); return [200, { ...publicView(r), sponsored: true }];
          }
          if (act[2] === 'verify') { if (!r.ver) repAdd(r.voters[0], 'good', 2); r.ver = orga.label; if (r.fl === -1) r.fl = 0; saveReport(r); orgaLog(orga, 'vérifié', { r }); return [200, publicView(r)]; }
          // Période d'essai : « Retirer » compte comme deux « Plus là », sans retrait direct
          if (orga.sponsored && !bump('orm:' + orga.id, 'report', SPONSOR.removeMax, Date.now())) {
            orgaLog(orga, 'retrait bloqué (rafale)', { r }); abuseLog('orga en rafale', { lat: r.lat, lng: r.lng, ref: orga.id });
            return [429, { error: 'Trop de retraits d’un coup : le retrait est suspendu quelques minutes.' }];
          }
          if (orga.trial) {
            r.down += 2; (r.downIps ||= []).push('o1:' + orga.id, 'o2:' + orga.id);
            orgaLog(orga, 'retrait (essai)', { r });
            if (!r.ver && r.down > r.up) { trashReport(r, orga); return [200, { removed: true }]; }
            saveReport(r); return [200, { ...publicView(r), trial: true }];
          }
          // Garde-fou : des retraits en rafale bloquent le retrait pour cette orga quelques minutes
          if (!orga.admin && !bump('orm:' + orga.id, 'report', ORGA_REMOVE_MAX, Date.now())) {
            orgaLog(orga, 'retrait bloqué (rafale)', { r }); abuseLog('orga en rafale', { lat: r.lat, lng: r.lng, ref: orga.id });
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
    const live = pathname.match(/^\/live\/((?:[crpl]\/)?[\w-]{1,40}\.json)$/);
    if (req.method === 'GET' && live) {
      const f = path.join(LIVE_DIR, live[1]);
      if ((live[1] === 'index.json' || live[1] === 'g.json') && !fs.existsSync(f)) try { rebuildAll(); } catch {}
      fs.readFile(f, (err, buf) => {
        if (err) return send(res, 200, live[1].startsWith('l/') ? { p: [] } : live[1].startsWith('c/') || live[1].startsWith('p/') ? { r: [] } : live[1].startsWith('r/') ? { c: {} } : {}, { 'Cache-Control': 'no-cache' });
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
try { migrateOwners(); } catch (e) { console.error('auteurs', e.message); }
server.listen(PORT, process.env.HOST || undefined, () => console.log(`Cortège en écoute — ${EVENT_NAME} — données : ${DATA_DIR}`));
