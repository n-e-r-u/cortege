'use strict';
// Routes publiques de l'API : tracé du cortège, configuration, notifications, santé, signalements autour, version, recherche de lieux.
const fs = require('fs');
const { APP_VERSION, versionInfo } = require('../http/version');
const { CATEGORIES, MERGE, GROUPS, EVENT_TYPES, VIBES, ALERT_CATS } = require('../categories');
const { DEPS } = require('../geo/departments');
const { MIN, EVENT_NAME, CENTER, ZOOM, BRAND, VIOLENCE_URL, CONTACT_EMAIL, HOST_INFO, SOURCE_URL, DATA_DIR, UNDER_PASSENGER, TRUST_PROXY } = require('../config');
const { NEXT } = require('./next');
const { ORDER_KINDS } = require('../orders');
const { PMTILES, pmOpen, pmTile, pmDecomp, pmInfo } = require('../geo/pmtiles');
const { POI_KINDS } = require('../places/osm');
const { STREAM_ON, sseClients } = require('../live/stream');
const { TILE_PREFETCH } = require('../geo/tiles');
const { abuseOnce } = require('../moderation');
const { activeReports } = require('../reports/store');
const { annActive, annView } = require('../announcements/store');
const { clientHash, ONION_HOST, deviceHash, PRIVATE_IP, clientIp } = require('../privacy');
const { geoCache, nominatim, placeName } = require('../geo/search');
const { nearKm, VAPID, PUSH_HOSTS, pushCount, PUSH_MAX, PUSH_NET_MAX, PUSH_LANGS, pushOne, tr, pushStat } = require('../push');
const { publicView } = require('../reports/model');
const { quota, bump } = require('../limits');
const { routeCache, streetRoute } = require('../pages/bilans');
const { send, readJson } = require('../http/respond');
const { settings, bannerNow, cfgHash } = require('../settings');
const { q, tx, DatabaseSync } = require('../db');
const { validLatLng, distM, sha, h8 } = require('../util');

async function publicApiRoutes(req, res, url, pathname) {
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
  return NEXT;
}

module.exports = { publicApiRoutes };
