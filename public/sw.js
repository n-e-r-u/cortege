// Cache l'interface et la carte pour tenir quand le réseau sature, et affiche les annonces urgentes (notifications).
const SHELL = 'cortege-shell-v43', TILES = 'cortege-tiles-v1';
const ASSETS = ['/', '/style.css', '/i18n.js', '/app.js', '/vendor/leaflet.js', '/vendor/leaflet.css', '/vendor/leaflet.markercluster.js', '/vendor/MarkerCluster.css',
  '/vendor/qrcode.js', '/vendor/protomaps-leaflet.js', '/map-style.js', '/vendor/fonts/inter-400.woff2', '/vendor/fonts/inter-700.woff2', '/favicon.png', '/brand/logo.png', '/brand/kofi.png', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('cortege-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/live/')) return;

  if (url.pathname.startsWith('/tiles/') || url.pathname.startsWith('/vt/')) {
    // Tuiles OSM : cache d'abord. Réseau faible : uniquement le cache, la bande passante va aux signalements.
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      if (lite) return new Response('', { status: 504, statusText: 'mode léger' });
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // Interface : réseau d'abord, cache en secours
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) caches.open(SHELL).then(c => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});

// Mode léger (réseau faible), décidé par l'appli
let lite = false;
self.addEventListener('message', e => { if (e.data && e.data.type === 'lite') lite = !!e.data.on; });
const putData = (key, obj) => caches.open('cortege-data').then(c => c.put(key, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } })));

// Notification (annonce urgente ou danger près de toi). Le contenu arrive chiffré, seul ce téléphone peut le lire.
// Elle transporte aussi les derniers signalements de la zone : gardés pour que la carte soit à jour à l'ouverture, même sans réseau.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const keep = d.d && Array.isArray(d.d.r) ? putData('/__push', d.d).then(async () => {
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'push-data' });
  }).catch(() => {}) : Promise.resolve();
  e.waitUntil(keep.then(() => self.registration.showNotification(d.title || 'Cortège', {
    body: d.body || 'Nouvelle annonce urgente', tag: d.tag || 'cortege', renotify: true,
    icon: '/icon-192.png', badge: '/favicon.png', vibrate: Array.isArray(d.vibrate) ? d.vibrate.slice(0, 12) : [300, 100, 300, 100, 300], data: { url: d.url || '/' },
  })));
});

// Mise à jour en arrière-plan (Chrome Android, appli installée) : Chrome décide du rythme, quelques fois par jour.
// Sert à garder à jour l'interface, l'agenda et les annonces (numéros de legal team) pour le hors-ligne.
self.addEventListener('periodicsync', e => {
  if (e.tag !== 'cortege-refresh') return;
  e.waitUntil((async () => {
    try { const c = await caches.open(SHELL); await c.addAll(ASSETS); } catch {}
    for (const u of ['/live/events.json', '/live/ann.json', '/live/legal.json']) {
      try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await putData(u, await r.json()); } catch {}
    }
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = e.notification.data?.url || '/';
    // Appli déjà ouverte : on la ramène au premier plan et on lui dit où regarder
    for (const c of list) if ('focus' in c) { c.postMessage({ type: 'goto', url }); return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || '/');
  })());
});

// File d'attente hors ligne : les signalements faits sans réseau partent dès que ça capte,
// même appli fermée sur Android (Background Sync). Sur iPhone, l'appli s'en charge à l'ouverture.
// Envoyer deux fois le même signalement est sans risque : le serveur le fusionne.
function queueStore(mode, fn) {
  return new Promise((res, rej) => {
    const o = indexedDB.open('cortege', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('queue', { keyPath: 'k' });
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const t = o.result.transaction('queue', mode); const r = fn(t.objectStore('queue')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); };
  });
}
async function flushQueue() {
  const items = (await queueStore('readonly', s => s.getAll())) || [];
  for (const it of items.sort((a, b) => a.t - b.t)) {
    if (it.t + it.ttl <= Date.now()) { await queueStore('readwrite', s => s.delete(it.k)); continue; }
    const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': it.dev },
      body: JSON.stringify({ cat: it.cat, lat: it.lat, lng: it.lng, note: it.note, t: it.t }) }); // erreur réseau : le navigateur réessaiera
    const json = (res.headers.get('content-type') || '').includes('json');
    if (res.status >= 500 && !json) throw new Error('serveur indisponible');
    await queueStore('readwrite', s => s.delete(it.k));
  }
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'queue-flushed' });
}
self.addEventListener('sync', e => { if (e.tag === 'cortege-queue') e.waitUntil(flushQueue()); });
