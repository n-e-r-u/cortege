// Cache l'interface et la carte pour tenir quand le réseau sature, et affiche les annonces urgentes (notifications).
const SHELL = 'cortege-shell-v12', TILES = 'cortege-tiles-v1';
const ASSETS = ['/', '/style.css', '/app.js', '/vendor/leaflet.js', '/vendor/leaflet.css', '/vendor/leaflet.markercluster.js', '/vendor/MarkerCluster.css',
  '/vendor/qrcode.js', '/favicon.png', '/brand/logo.png', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('cortege-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/live/')) return;

  if (url.pathname.startsWith('/tiles/')) {
    // Tuiles OSM : cache d'abord
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
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

// Notification d'annonce urgente (le contenu arrive chiffré, seul ce téléphone peut le lire)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cortège', {
    body: d.body || 'Nouvelle annonce urgente', tag: d.tag || 'cortege', renotify: true,
    icon: '/icon-192.png', badge: '/favicon.png', vibrate: [300, 100, 300, 100, 300], data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(e.notification.data?.url || '/');
  })());
});
