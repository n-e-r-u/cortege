'use strict';
// Configuration : variables d'environnement et constantes partagées par tous les modules.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const EVENT_NAME = process.env.EVENT_NAME || 'Carte des mobilisations';
// Centre de la carte à l'ouverture : France entière par défaut ; une valeur invalide est ignorée au lieu de casser la carte
const CENTER = (() => {
  const c = String(process.env.CENTER || '').split(',').map(Number);
  if (c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180) return c;
  if (process.env.CENTER) console.error('CENTER invalide (attendu : latitude,longitude) : centre par défaut.');
  return [46.6, 2.4];
})();
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
// Nom affiché de l'admin (annonces, vérifications, position en direct) : choisi dans les réglages, sinon ADMIN_LABEL, sinon « Cortège »
const ADMIN_LABEL_ENV = process.env.ADMIN_LABEL || 'Cortège';
const IMPORT_NAMES = ['17octobregiletjaune.net'];
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://cortege.neru.tv';
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

// Racine du dépôt (server.js, public/, tools/)
const ROOT = path.join(__dirname, '..');

module.exports = { ROOT, PORT, EVENT_NAME, CENTER, ZOOM, ADMIN_KEY, ARCHIVE_DAYS, ORGAS, TILE_URL, TILE_UA, UNDER_PASSENGER, TRUST_PROXY, DATA_DIR,
  VIOLENCE_URL, CONTACT_EMAIL, HOST_INFO, SOURCE_URL, BRAND, ADMIN_LABEL_ENV, IMPORT_NAMES, PUBLIC_URL, MIN, MAX_REPORTS, MAX_PER_ZONE,
  MAX_PER_NET_ZONE, NOTE_MAX, ANN_MAX, RATE, STATE_FILE, LOCK_FILE };
