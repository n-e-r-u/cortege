'use strict';
// Carte en lecture seule, à intégrer dans un autre site (iframe). Ne demande pas la position des visiteur·ices :
// elle lit seulement les fichiers publics de la zone affichée, toutes les 20 s.
(async () => {
  const qs = new URLSearchParams(location.search);
  const num = (k, d, lo, hi) => { const v = Number(qs.get(k)); return Number.isFinite(v) && v >= lo && v <= hi ? v : d; };
  const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  const center = [num('lat', (cfg.center || [46.6])[0], -90, 90), num('lng', (cfg.center || [0, 2.4])[1], -180, 180)];
  const map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 18 }).setView(center, num('z', 13, 5, 18));
  const raster = () => { document.body.classList.add('raster'); L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map); };
  if (cfg.vector) {
    const sc = document.createElement('script'); sc.src = '/vendor/protomaps-leaflet.js';
    sc.onload = () => {
      try {
        const zones = cfg.vector.zones || [];
        if (zones.length) {
          const Fallback = L.TileLayer.extend({ _isValidTile(c) { if (!L.TileLayer.prototype._isValidTile.call(this, c)) return false; const b = this._tileCoordsToBounds(c);
            return !zones.some(([s, n, w, e]) => b.getSouth() >= s && b.getNorth() <= n && b.getWest() >= w && b.getEast() <= e); } });
          new Fallback('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, className: 'osm-fallback', attribution: '© OpenStreetMap' }).addTo(map);
        }
        window.protomapsL.leafletLayer({ url: cfg.vector.url, flavor: 'dark', lang: 'fr', maxDataZoom: cfg.vector.maxzoom, attribution: '© OpenStreetMap · Protomaps' }).addTo(map);
      } catch { raster(); }
    };
    sc.onerror = raster; document.head.append(sc);
  } else raster();
  const CAT = Object.fromEntries((cfg.categories || []).map(c => [c.id, c]));
  const COL = { fdo: '#e5484d', danger: '#f5a524', soutien: '#30a46c', info: '#8e8cd8' };
  if (cfg.brand && cfg.brand.handle) $open().textContent = 'Cortège · @' + cfg.brand.handle + ' ↗';
  function $open() { return document.getElementById('open'); }
  const layer = L.layerGroup().addTo(map), markers = new Map();
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h`; };
  async function refresh() {
    const b = map.getBounds(), rgs = [];
    if (map.getZoom() >= 8) for (let i = Math.floor(b.getSouth()); i <= Math.floor(b.getNorth()); i++) for (let j = Math.floor(b.getWest()); j <= Math.floor(b.getEast()); j++) rgs.push(i + '_' + j);
    const res = await Promise.all(rgs.slice(0, 12).map(rg => fetch(`/live/p/${rg}.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : { r: [] }).catch(() => ({ r: [] }))));
    const now = Date.now(), seen = new Set();
    for (const r of res.flatMap(x => x.r || [])) {
      const c = CAT[r.cat]; if (!c || r.exp < now) continue;
      seen.add(r.id);
      const html = `<div class="pin${r.c ? ' old' : ''}" style="--c:${COL[c.group] || '#8e8cd8'}">${c.glyph || '•'}</div>`;
      const pop = `<b>${c.label}</b><br>${ago(r.t)}${r.up ? ` · confirmé ${r.up}×` : ''}${r.ver ? ' · vérifié par une orga' : ''}${r.c ? ' · contesté' : ''}`;
      const m = markers.get(r.id);
      if (m) { m.setIcon(L.divIcon({ className: '', iconSize: [30, 30], html })); m.setPopupContent(pop); }
      else markers.set(r.id, L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', iconSize: [30, 30], html }) }).bindPopup(pop).addTo(layer));
    }
    for (const [id, m] of markers) if (!seen.has(id)) { layer.removeLayer(m); markers.delete(id); }
    document.getElementById('state').textContent = map.getZoom() < 8 ? 'Zoome sur une ville pour voir les signalements' : `${seen.size} signalement${seen.size > 1 ? 's' : ''} en cours · mis à jour à l’instant`;
    const c = map.getCenter(); $open().href = `/?at=${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
  }
  let t = null; map.on('moveend', () => { clearTimeout(t); t = setTimeout(refresh, 400); });
  refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 20000);
})();
