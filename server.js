// Cortège — serveur, zéro dépendance (Node >= 22.13).
// Ce fichier démarre le serveur : il charge les modules de src/ (voir ARCHITECTURE.md), lance les tâches de fond
// et passe chaque requête aux routes, dans l'ordre. Tout le reste est rangé par domaine dans src/.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const { PORT, EVENT_NAME, DATA_DIR, MIN } = require('./src/config');
const { q, isBusy, setMeta } = require('./src/db');
const { send } = require('./src/http/respond');
const { gate } = require('./src/http/saturation');
const { serveStatic } = require('./src/http/static');
const { streamOpen } = require('./src/live/stream');
const { LIVE_DIR } = require('./src/live/files');
const { rebuildAll } = require('./src/live/publish');
const { settings } = require('./src/settings');
const { sweep } = require('./src/sweep');
const { migrateJson } = require('./src/migrate');
const { migrateOwners } = require('./src/orgas/names');
const { seedLegal, legalWatch } = require('./src/legal');
const { placesPublish } = require('./src/places/geofabrik');
const { NEXT } = require('./src/routes/next');

// Tâches de fond lancées au chargement de leur module : import du 17 octobre, journées de mobilisation, archive du digest
require('./src/events/import-17oct');
require('./src/mobs');
require('./src/digest/archive');

// Routes, essayées dans cet ordre ; chaque module renvoie NEXT si la requête ne le concerne pas
const ROUTES = [
  require('./src/routes/pages').pagesRoutes,         // pages publiques, bilans, plan du site, tuiles vectorielles
  require('./src/routes/public-api').publicApiRoutes, // configuration, notifications, santé, recherche de lieux
  require('./src/routes/admin').adminRoutes,          // /api/admin/…
  require('./src/routes/reports').reportsRoutes,      // signalements, votes, précisions, propositions
  require('./src/routes/orga').orgaRoutes,            // invitations et espace orga
  require('./src/routes/files').filesRoutes,          // tuiles sur disque et fichiers live/
];

// Démarrage : reprise éventuelle, annuaire, première publication, lieux
setTimeout(() => {
  try { migrateJson(); } catch (e) { console.error('reprise state.json', e.message); }
  try { seedLegal(); } catch (e) { console.error('annuaire', e.message); }
  try { settings(); sweep(); rebuildAll(); } catch (e) { console.error('publication initiale', e.message); }
  try { if (!fs.existsSync(path.join(LIVE_DIR, 'l')) && q('SELECT 1 FROM pois LIMIT 1').get()) placesPublish(); } catch (e) { console.error('lieux', e.message); }
}, 200);
// Veille de l'annuaire : vérifiée toutes les heures, faite une fois par jour (désactivable : LEGAL_WATCH=0)
if (process.env.LEGAL_WATCH !== '0') setInterval(() => legalWatch().catch(e => console.error('veille annuaire', e.message)), 60 * MIN).unref();

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
  if (!gate(req, res, pathname)) return;
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
    for (const route of ROUTES) { const r = await route(req, res, url, pathname); if (r !== NEXT) return r; }
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
