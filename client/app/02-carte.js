  // ---- Carte ----
  // Les popups ne doivent pas finir sous l'en-tête ni sous le bouton « Signaler »
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(12, 120), autoPanPaddingBottomRight: L.point(12, 150) });
  // Après une mise à jour automatique, on revient exactement là où on était
  let savedView = null; try { savedView = JSON.parse(sessionStorage.getItem('cortege-view') || 'null'); sessionStorage.removeItem('cortege-view'); } catch {}
  // Ouverture depuis une notification « danger près de toi » : /?at=lat,lng
  const atParam = s => { const m = /[?&]at=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s || ''); return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? [+m[1], +m[2]] : null; };
  { const at = atParam(location.search); if (at) { savedView = { c: at, z: 17 }; history.replaceState(null, '', location.pathname); } }
  // Mention obligatoire de la licence OpenStreetMap (ODbL), toujours visible sur la carte
  const OSM_ATTR = `© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${t('contributeurs OpenStreetMap')}</a>`;
  const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 19 })
    .setView(savedView ? savedView.c : cfg.center, savedView ? savedView.z : (cfg.zoom || 6));
  map.attributionControl.setPrefix(false); // mention courte : rien ne passe sous le bouton Signaler
  // Regroupement des points quand on dézoome (bulle = nombre de signalements, couleur = le plus grave)
  const SEVERITY = ['fdo', 'danger', 'info', 'soutien'];
  // Signalements dans leur propre calque : l'écran medic les garde visibles en masquant le reste de la carte publique
  map.createPane('reports').style.zIndex = 600;
  const layer = L.markerClusterGroup({
    clusterPane: 'reports',
    maxClusterRadius: z => (z >= 15 ? 30 : 60), disableClusteringAtZoom: 16, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    iconCreateFunction: cluster => {
      const groups = new Set(cluster.getAllChildMarkers().map(m => CAT[m.options.cat].group));
      const g = SEVERITY.find(x => groups.has(x)) || 'info';
      const n = cluster.getChildCount();
      const size = n < 10 ? 38 : n < 100 ? 46 : 54;
      return L.divIcon({ className: '', iconSize: [size, size], html: `<div class="cluster" style="--c:${GROUP_COLOR[g]};width:${size}px;height:${size}px">${n}</div>` });
    },
  }).addTo(map);
  // Fond de carte : tuiles vectorielles hébergées sur le serveur (PMTiles) si l'instance en a, sinon OpenStreetMap via le proxy
  function rasterMap() {
    document.body.classList.add('raster');
    L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTR }).addTo(map);
  }
  if (cfg.vector) {
    const sc = document.createElement('script');
    sc.src = '/vendor/protomaps-leaflet.js';
    sc.onload = () => {
      try {
        // Hors de la zone du fichier de carte : repli sur OpenStreetMap (via le serveur), seulement pour les tuiles hors zone
        const zones = cfg.vector.zones || [];
        if (zones.length) {
          const Fallback = L.TileLayer.extend({ _isValidTile(c) {
            if (!L.TileLayer.prototype._isValidTile.call(this, c)) return false;
            const b = this._tileCoordsToBounds(c);
            return !zones.some(([so, no, we, ea]) => b.getSouth() >= so && b.getNorth() <= no && b.getWest() >= we && b.getEast() <= ea);
          } });
          // Avec une carte du monde légère sur le serveur, le repli ne sert qu'au-delà de ses zooms
          new Fallback('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, minZoom: cfg.vector.worldMaxZoom != null ? cfg.vector.worldMaxZoom + 1 : 0, className: 'osm-fallback' }).addTo(map);
        }
        const opts = { url: cfg.vector.url, lang: I18N.lang || 'fr', maxDataZoom: cfg.vector.maxzoom, transparent: zones.length > 0,
          attribution: OSM_ATTR + ' · Protomaps' };
        const make = () => (window.cortegeVectorLayer ? window.cortegeVectorLayer(window.protomapsL, opts)
          : window.protomapsL.leafletLayer({ ...opts, flavor: window.cortegeTheme?.current === 'light' ? 'light' : 'dark' }));
        let vl = make();
        vl.addTo(map);
        window.cortegeMapFonts?.().then(() => vl.redraw?.());
        document.body.classList.add('vector');
        // Changement de thème (réglage ou système) : la carte est redessinée avec les couleurs du nouveau thème
        window.addEventListener('cortege-theme', () => { const old = vl; vl = make(); vl.addTo(map); map.removeLayer(old); });
      } catch { rasterMap(); }
    };
    sc.onerror = rasterMap;
    document.head.append(sc);
  } else rasterMap();

  // Popup ouvert : les boutons latéraux s'effacent pour ne pas le recouvrir
  map.on('popupopen', () => document.body.classList.add('pop-open'));
  map.on('popupclose', () => document.body.classList.remove('pop-open'));
  const reports = new Map();   // id -> {data, marker}
  const voted = new Set();     // en mémoire seulement
  const hidden = new Set();    // groupes masqués
  // Événements de l'agenda masqués sur la carte (choix gardé sur ce téléphone)
  let evHidden = false; try { evHidden = localStorage.getItem('cortege-ev-hidden') === '1'; } catch {}
  let evCount = () => 0;       // nombre d'événements affichables, défini avec l'agenda
  let me = null, meMarker = null, watchId = null, meAcc = Infinity, meAt = 0;
  // Profil pays de l'endroit où tu es (sinon du centre de la carte), recalculé quand la carte bouge
  const updateProfile = () => { const c = map.getCenter(), at = me || [c.lat, c.lng]; applyProfile(profileAt(at[0], at[1])); };
  map.on('moveend', updateProfile);
  updateProfile();

