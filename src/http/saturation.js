'use strict';

const { clientIp } = require('../privacy');

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
// Contrôle à l'entrée de chaque requête : false si la requête a déjà reçu sa réponse (429 ou 503)
function gate(req, res, pathname) {
  if (!floodOk(clientIp(req), Date.now())) { floodCount++; res.writeHead(429, { 'Retry-After': '60', 'Content-Type': 'text/plain' }); res.end('Trop de requêtes'); return false; }
  if (shedding() && !essential(req, pathname)) { shedCount++; res.writeHead(503, { 'Retry-After': '5', 'Content-Type': 'text/plain' }); res.end('Serveur chargé, réessaie'); return false; }
  return true;
}
// Charge actuelle, pour l'onglet Direct de l'admin
const loadStats = () => ({ lagMs: Math.round(lagMs), shed: shedCount, flood: floodCount, ips: FLOOD.size });

module.exports = { gate, loadStats };
