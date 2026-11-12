'use strict';

const { UNDER_PASSENGER } = require('../config');
const { send } = require('../http/respond');
const { netHash } = require('../privacy');

// ---- Temps réel : prévenir les téléphones dès qu'une région change (Server-Sent Events) ----
// Le téléphone s'abonne aux régions (carrés de 1°, ~100 km) qu'il affiche ; le serveur lui envoie seulement
// « telle région a changé », et le téléphone relit les fichiers publiés comme d'habitude. Pas de position précise envoyée.
// Un seul processus (VPS) : sous Passenger, plusieurs processus ne se voient pas, on reste sur l'interrogation régulière.
const STREAM_ON = process.env.STREAM ? process.env.STREAM === '1' : !UNDER_PASSENGER;
const STREAM_MAX = Number(process.env.STREAM_MAX) || 20000;
// Par réseau : large (des centaines de téléphones partagent parfois une adresse d'opérateur), mais un seul réseau ne peut
// pas occuper toutes les places. Seul un compteur par empreinte tournante est gardé, en mémoire.
const STREAM_NET_MAX = Number(process.env.STREAM_NET_MAX) || 500;
const sseClients = new Map(), perNet = new Map();
function streamOpen(req, res, url) {
  if (!STREAM_ON || sseClients.size >= STREAM_MAX) return send(res, 503, { error: 'Temps réel indisponible, interrogation régulière.' }, { 'Retry-After': '60' });
  const net = netHash(req), n = perNet.get(net) || 0;
  if (n >= STREAM_NET_MAX) return send(res, 503, { error: 'Temps réel indisponible, interrogation régulière.' }, { 'Retry-After': '60' });
  perNet.set(net, n + 1);
  const regions = new Set(String(url.searchParams.get('r') || '').split(',').filter(x => /^-?\d{1,3}_-?\d{1,3}$/.test(x)).slice(0, 8));
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
  res.write('retry: 5000\n\n');
  const c = { regions, ping: setInterval(() => res.write(': \n\n'), 25000) };
  sseClients.set(res, c);
  let closed = false;
  const close = () => { if (closed) return; closed = true; clearInterval(c.ping); sseClients.delete(res); const k = (perNet.get(net) || 1) - 1; k > 0 ? perNet.set(net, k) : perNet.delete(net); };
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

module.exports = { STREAM_ON, STREAM_MAX, STREAM_NET_MAX, sseClients, streamOpen, streamNotify };
