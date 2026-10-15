'use strict';
(async function () {
  const $ = s => document.querySelector(s);
  const MIN = 60_000;
  const ALERT_RADIUS = 300;                 // mètres
  const ALERT_CATS = new Set(['sommations', 'lacrymo', 'canon', 'charge', 'nasse', 'bac', 'crs', 'interpellation']);
  let orga = null; // { label, admin } quand ce téléphone a un lien orga
  let announcements = [];
  // Économie de batterie : rafraîchissement espacé, GPS moins précis, boussole coupée
  let eco = false; try { eco = localStorage.getItem('cortege-eco') === '1'; } catch {}
  let pushSub = null;               // abonnement aux notifications (annonces urgentes)
  let evCache = { h: null, e: [] }; // agenda (événements publiés)

  // Identifiant anonyme de ce téléphone (tiré au hasard, jamais lié à une personne) : sert seulement
  // à limiter le spam par appareil, car en 4G des centaines de personnes partagent la même adresse IP.
  const DEVICE = (() => {
    let d = null; try { d = localStorage.getItem('cortege-dev'); } catch {}
    if (!d || !/^[\w-]{16,64}$/.test(d)) {
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      d = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { localStorage.setItem('cortege-dev', d); } catch {}
    }
    return d;
  })();
  const cfg = await fetch('/api/config').then(r => r.json());
  const CAT = Object.fromEntries(cfg.categories.map(c => [c.id, c]));
  const GROUP_COLOR = { fdo: 'var(--fdo)', danger: 'var(--danger)', soutien: 'var(--soutien)', info: 'var(--info)' };
  $('#eventName').textContent = cfg.event;
  if (cfg.violenceUrl) document.querySelectorAll('#violenceLink, .violence-inline').forEach(a => (a.href = cfg.violenceUrl));
  if (cfg.brand) {
    document.querySelectorAll('.handle').forEach(n => (n.textContent = '@' + cfg.brand.handle));
    document.querySelectorAll('a[href="https://www.instagram.com/neru/"]').forEach(a => (a.href = cfg.brand.instagram));
    $('#brandLink').href = cfg.brand.instagram;
    const siteLabel = cfg.brand.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    document.querySelectorAll('a[href="https://neru.tv"]').forEach(a => { a.href = cfg.brand.site; if (!a.querySelector('svg')) a.textContent = siteLabel; });
  }

  // ---- Carte ----
  const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 19 }).setView(cfg.center, cfg.zoom || 6);
  // Regroupement des points quand on dézoome (bulle = nombre de signalements, couleur = le plus grave)
  const SEVERITY = ['fdo', 'danger', 'info', 'soutien'];
  const layer = L.markerClusterGroup({
    maxClusterRadius: z => (z >= 15 ? 30 : 60), disableClusteringAtZoom: 16, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    iconCreateFunction: cluster => {
      const groups = new Set(cluster.getAllChildMarkers().map(m => CAT[m.options.cat].group));
      const g = SEVERITY.find(x => groups.has(x)) || 'info';
      const n = cluster.getChildCount();
      const size = n < 10 ? 38 : n < 100 ? 46 : 54;
      return L.divIcon({ className: '', iconSize: [size, size], html: `<div class="cluster" style="--c:${GROUP_COLOR[g]};width:${size}px;height:${size}px">${n}</div>` });
    },
  }).addTo(map);
  let mapMode = 'raster';
  if (mapMode === 'raster') {
    document.body.classList.add('raster');
    L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  }

  const reports = new Map();   // id -> {data, marker}
  const voted = new Set();     // en mémoire seulement
  const hidden = new Set();    // groupes masqués
  let me = null, meMarker = null, watchId = null;

  // ---- Utilitaires ----
  const ago = t => { const m = Math.round((Date.now() - t) / MIN); return m < 1 ? 'à l’instant' : `il y a ${m} min`; };
  const left = exp => { const m = Math.max(0, Math.round((exp - Date.now()) / MIN)); return `${m} min`; };
  const dist = (a, b) => map.distance(a, b);
  const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
  }
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === 'style' ? n.style.cssText = v : n.setAttribute(k, v);
    for (const k of kids) n.append(k);
    return n;
  }

  // ---- Marqueurs ----
  function icon(r, fresh) {
    const c = CAT[r.cat];
    const age = Date.now() - r.t, ttl = c.ttl * MIN;
    const cls = ['pin', fresh ? 'fresh' : '', age > ttl * 0.6 ? 'old' : ''].join(' ');
    return L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18],
      html: `<div class="${cls}${r.ver ? ' ver' : ''}" style="--c:${GROUP_COLOR[c.group]}">${c.glyph}</div>` });
  }
  function popup(r) {
    const c = CAT[r.cat];
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, c.glyph + ' ', c.label));
    const meta = `${ago(r.t)} · expire dans ${left(r.exp)}` + (r.up ? ` · confirmé ${r.up}×` : '') + (me ? ` · ${fmtDist(dist(me, [r.lat, r.lng]))}` : '');
    root.append(el('div', { class: 'pop-meta' }, meta));
    if (r.ver) root.append(el('div', { class: 'pop-ver' }, '✓ Vérifié par ' + r.ver));
    if (r.note) root.append(el('p', { class: 'pop-note' }, r.note));
    const yes = el('button', { class: 'yes' }, 'Toujours là');
    const no = el('button', { class: 'no' }, 'Plus là');
    if (voted.has(r.id)) yes.disabled = no.disabled = true;
    yes.onclick = () => vote(r.id, 1);
    no.onclick = () => vote(r.id, -1);
    root.append(el('div', { class: 'pop-actions' }, yes, no));
    if (orga) {
      const ok = el('button', { class: 'yes' }, r.ver ? '✓ Vérifié' : '✓ Vérifier (orga)');
      const rm = el('button', { class: 'danger' }, 'Retirer (faux)');
      ok.disabled = !!r.ver;
      ok.onclick = () => orgaAction(r.id, 'verify');
      rm.onclick = () => { if (rm.dataset.armed) orgaAction(r.id, 'remove'); else { rm.dataset.armed = '1'; rm.textContent = 'Confirmer le retrait'; } };
      root.append(el('div', { class: 'pop-actions orga' }, ok, rm));
    }
    return root;
  }
  function upsert(r, fresh = false) {
    const cur = reports.get(r.id);
    if (cur) {
      cur.data = r;
      cur.marker.setIcon(icon(r, false));
      if (cur.marker.isPopupOpen()) cur.marker.setPopupContent(popup(r));
    } else {
      const marker = L.marker([r.lat, r.lng], { icon: icon(r, fresh), keyboard: true, title: CAT[r.cat].label, cat: r.cat });
      marker.bindPopup(() => popup(reports.get(r.id).data));
      reports.set(r.id, { data: r, marker });
      if (!hidden.has(CAT[r.cat].group)) layer.addLayer(marker);
    }
  }
  function drop(id) {
    const cur = reports.get(id);
    if (cur) { layer.removeLayer(cur.marker); reports.delete(id); }
  }
  function refreshUI() { renderFilters(); if (!$('#sheetList').hidden) renderList(); }
  // Rafraîchit l'opacité des points vieillissants
  setInterval(() => { for (const { data, marker } of reports.values()) if (!marker.isPopupOpen()) marker.setIcon(icon(data, false)); }, 60_000);

  // ---- Synchro : interrogation régulière du serveur (robuste sur hébergement mutualisé) ----
  const POLL_MS = 5000;
  let etag = null, firstSync = true, pollTimer = null, lastOk = 0;
  const status = $('#status');
  const setStatus = (state, txt) => { status.dataset.state = state; status.querySelector('.txt').textContent = txt; };
  // Le serveur ne reçoit que des carrés arrondis (≈ 5 km au plus près), jamais la position exacte.
  function snap(s, w, n, e, g) {
    const f = x => Math.round(x * 1000) / 1000;
    return [f(Math.floor(s / g) * g), f(Math.floor(w / g) * g), f(Math.ceil(n / g) * g), f(Math.ceil(e / g) * g)].join(',');
  }
  function zones() {
    const z = map.getZoom(), b = map.getBounds();
    const g = z >= 11 ? 0.05 : z >= 8 ? 0.5 : 2;
    const out = [snap(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), g)];
    if (me) { const around = snap(me[0] - 0.02, me[1] - 0.03, me[0] + 0.02, me[1] + 0.03, 0.05); if (around !== out[0]) out.push(around); }
    return out;
  }
  let lastZoneKey = '';
  // Applique une liste de signalements + annonces à la carte.
  // isFresh(r) dit si un point inconnu est vraiment nouveau (et pas juste découvert en déplaçant la carte).
  function apply(list, anns, isFresh, canAlertAnns) {
    renderAnns(anns, canAlertAnns);
    const ids = new Set(list.map(r => r.id));
    for (const id of [...reports.keys()]) if (!ids.has(id)) drop(id);
    for (const r of list) {
      const fresh = !reports.has(r.id) && !firstSync && isFresh(r);
      upsert(r, fresh);
      if (fresh) proximity(r);
    }
    firstSync = false;
    refreshUI();
  }

  // --- Mode principal : fichiers statiques live/ (servis par Apache, Node n'est pas sollicité) ---
  const CELL = 0.05;
  const cellOf = r => `${Math.floor(r.lat / CELL)}_${Math.floor(r.lng / CELL)}`;
  const cellCache = new Map();          // case -> { h, r }
  let allCache = { h: null, r: [] }, annCache = { h: null, a: [] };
  let mode = null, knownCells = new Set(), useApi = false, failures = 0;
  const getJ = url => fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status }); return r.json(); });
  function neededCells() {
    const b = map.getBounds(), ids = new Set();
    const add = (s, w, n, e) => {
      for (let i = Math.floor(s / CELL); i <= Math.floor(n / CELL); i++)
        for (let j = Math.floor(w / CELL); j <= Math.floor(e / CELL); j++) { ids.add(i + '_' + j); if (ids.size > 80) return false; }
      return true;
    };
    if (!add(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())) return null; // trop dézoomé : vue nationale
    if (me) add(me[0] - 0.02, me[1] - 0.03, me[0] + 0.02, me[1] + 0.03);         // toujours la zone autour de soi (alertes)
    return [...ids];
  }
  function annsFor() {
    const b = map.getBounds(), c = b.getCenter(), viewR = map.distance(c, b.getNorthEast());
    return annCache.a.filter(x => x.exp > Date.now() && (x.national ||
      map.distance(c, [x.lat, x.lng]) < x.r * 1000 + viewR || (me && map.distance(me, [x.lat, x.lng]) < x.r * 1000)));
  }
  async function syncLive() {
    const idx = await getJ('/live/index.json');
    if (!idx || !idx.cells) throw Object.assign(new Error('index'), { status: 404 });
    const need = neededCells(), now = Date.now();
    let list, isFresh;
    if (need === null) {
      if (allCache.h !== idx.all) allCache = { h: idx.all, r: (await getJ('/live/all.json')).r };
      const wasAll = mode === 'all';
      list = allCache.r; isFresh = () => wasAll; mode = 'all';
    } else {
      const prev = knownCells; knownCells = new Set(need);
      await Promise.all(need.map(async id => {
        const h = idx.cells[id];
        if (!h) { cellCache.delete(id); return; }
        const c = cellCache.get(id);
        if (!c || c.h !== h) cellCache.set(id, { h, r: (await getJ('/live/c/' + id + '.json')).r });
      }));
      for (const id of [...cellCache.keys()]) if (!knownCells.has(id)) cellCache.delete(id);
      list = need.flatMap(id => cellCache.get(id)?.r || []);
      isFresh = r => mode === 'cells' && prev.has(cellOf(r)); mode = 'cells';
    }
    setPaused(idx.paused);
    if (idx.events && evCache.h !== idx.events) { evCache = { h: idx.events, e: (await getJ('/live/events.json')).e || [] }; renderEvents(); }
    const annChanged = annCache.h !== idx.ann;
    if (annChanged) annCache = { h: idx.ann, a: (await getJ('/live/ann.json')).a };
    apply(list.filter(r => r.exp > now), annsFor(), isFresh, annChanged && !firstSync);
  }

  // --- Repli : ancienne API (si live/ n'est pas disponible) ---
  async function syncApi() {
    const zs = zones(), key = zs.join('|');
    const sameZone = key === lastZoneKey;
    if (!sameZone) etag = null;
    const res = await fetch('/api/reports?' + zs.map(z => 'bbox=' + z).join('&'), { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store' });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(res.status);
    etag = res.headers.get('ETag');
    const { reports: list, announcements: anns = [] } = await res.json();
    lastZoneKey = key;
    apply(list, anns, () => sameZone, sameZone);
  }

  // Pause décidée par l'admin (afflux de faux signalements) : on le dit et on bloque le bouton
  let pausedUntil = 0;
  function setPaused(until) {
    pausedUntil = until || 0;
    const on = pausedUntil > Date.now();
    $('#pauseBanner').hidden = !on;
    const btn = $('#btnReport');
    btn.disabled = on;
    if (on) { closeReport(); btn.textContent = 'Signalements en pause'; }
    else if ($('#crosshair').hidden) btn.textContent = 'Signaler';
  }
  let syncing = false, again = false;
  async function sync() {
    clearTimeout(pollTimer);
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      if (useApi) await syncApi();
      else {
        try { await syncLive(); }
        catch (e) { if (e.status === 404) { useApi = true; await syncApi(); } else throw e; }
      }
      failures = 0; lastOk = Date.now();
      setStatus('live', 'En direct');
    } catch {
      failures++;
      setStatus('offline', Date.now() - lastOk > 15000 ? 'Hors ligne — nouvel essai…' : 'Connexion instable…');
    }
    syncing = false;
    if (again) { again = false; return sync(); }
    // Rythme : 5 s en zone, 15 s en vue nationale, et on espace en cas d'échec (réseau saturé)
    const base = mode === 'all' ? (eco ? 60000 : 15000) : (eco ? 20000 : POLL_MS);
    const delay = failures ? Math.min(30000, base * 2 ** Math.min(failures, 3)) : base;
    if (!document.hidden) pollTimer = setTimeout(sync, delay);
  }
  let moveTimer = null;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(sync, 400); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); else clearTimeout(pollTimer); });
  sync();

  // ---- Alerte de proximité ----
  function proximity(r) {
    if (!me || !ALERT_CATS.has(r.cat) || hidden.has(CAT[r.cat].group)) return;
    const d = dist(me, [r.lat, r.lng]);
    const somm = r.cat === 'sommations';
    if (d > (somm ? 1000 : ALERT_RADIUS)) return; // les sommations alertent dans un rayon d'1 km
    const c = CAT[r.cat];
    const box = $('#alert');
    box.className = 'alert' + (c.group === 'fdo' || somm ? ' fdo' : '');
    box.textContent = somm ? `${c.glyph} Sommations à ${fmtDist(d)} : rester devient un délit. Éloigne-toi par une rue dégagée.` : `${c.glyph} ${c.label} à ${fmtDist(d)} de toi`;
    if (somm) { try { navigator.vibrate?.([500, 150, 500, 150, 500]); } catch {} }
    box.hidden = false;
    box.onclick = () => { box.hidden = true; const m = reports.get(r.id)?.marker; if (m) layer.zoomToShowLayer(m, () => m.openPopup()); };
    try { navigator.vibrate?.([200, 100, 200]); } catch {}
    clearTimeout(proximity.t); proximity.t = setTimeout(() => (box.hidden = true), 9000);
  }

  // ---- Géolocalisation + suivi + boussole (tout reste sur l'appareil) ----
  // ◎ gris : pas localisé · ◎ plein : la carte te suit · ◎ contour : localisé, carte libre (appuie pour te recentrer)
  let follow = false, heading = null, compassOn = false, gpsHeading = null, accCircle = null;
  const btnLoc = $('#btnLocate');
  function setFollow(on) {
    follow = on;
    btnLoc.dataset.state = !me ? (watchId != null ? 'searching' : 'off') : on ? 'follow' : 'free';
    btnLoc.setAttribute('aria-pressed', String(on));
    btnLoc.title = on ? 'La carte te suit' : 'Me recentrer';
  }
  function meIcon() {
    return L.divIcon({ className: '', iconSize: [64, 64], iconAnchor: [32, 32],
      html: '<div class="me-wrap"><div class="me-cone" hidden></div><div class="me"></div></div>' });
  }
  function drawHeading() {
    const cone = meMarker?.getElement()?.querySelector('.me-cone');
    if (!cone) return;
    const h = heading ?? gpsHeading;
    cone.hidden = h == null;
    if (h != null) cone.style.transform = `rotate(${h}deg)`;
  }
  // Boussole : iPhone (webkitCompassHeading, autorisation requise), Android (deviceorientationabsolute)
  let rawHeading = null, rafPending = false;
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading;
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + so + 360) % 360;
    // lissage circulaire pour éviter que le cône tremble
    if (rawHeading == null) rawHeading = h;
    else { const d = ((h - rawHeading + 540) % 360) - 180; rawHeading = (rawHeading + d * 0.25 + 360) % 360; }
    heading = Math.round(rawHeading);
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; drawHeading(); }); }
  }
  async function enableCompass() {
    if (eco || compassOn || typeof DeviceOrientationEvent === 'undefined') return;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') { // iPhone : doit venir d'un appui
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
    }
    compassOn = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient, true);
    else window.addEventListener('deviceorientation', onOrient, true);
  }
  function onPosition(p) {
    const first = !me;
    me = [p.coords.latitude, p.coords.longitude];
    // Cap GPS quand on marche (secours si pas de boussole)
    gpsHeading = p.coords.speed > 0.8 && p.coords.heading != null && !isNaN(p.coords.heading) ? p.coords.heading : gpsHeading;
    if (!meMarker) meMarker = L.marker(me, { icon: meIcon(), interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map);
    else meMarker.setLatLng(me);
    const acc = Math.min(p.coords.accuracy || 0, 500);
    if (!accCircle) accCircle = L.circle(me, { radius: acc, interactive: false, className: 'me-acc' }).addTo(map);
    else accCircle.setLatLng(me).setRadius(acc);
    drawHeading();
    if (pushSub) pushSend(pushSub).catch(() => {});
    if (first) { map.setView(me, Math.max(map.getZoom(), 17)); setFollow(true); }
    else if (follow && $('#sheetReport').hidden && !popupOpen && !drawing && !picking) map.panTo(me, { animate: true, duration: 0.6, noMoveStart: true });
    else setFollow(follow);
  }
  function locate() {
    enableCompass(); // appelé depuis un appui : l'iPhone peut demander l'autorisation
    if (!navigator.geolocation) return toast('Géolocalisation indisponible sur cet appareil.');
    if (watchId != null) {
      if (me) { map.setView(me, Math.max(map.getZoom(), 16)); setFollow(true); }
      return;
    }
    watchId = navigator.geolocation.watchPosition(onPosition, err => {
      // Seul un refus coupe la localisation ; une perte de signal passagère (fréquente dehors) ne change rien.
      if (err.code === 1) {
        toast('Localisation refusée. Tu peux quand même signaler avec le viseur.');
        navigator.geolocation.clearWatch(watchId); watchId = null; setFollow(false);
      } else if (!me && !locate.warned) { locate.warned = true; toast('Recherche de ta position…'); }
    }, eco ? { enableHighAccuracy: false, maximumAge: 30_000, timeout: 60_000 } : { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
    setFollow(false);
  }
  // Déplacer la carte au doigt arrête le suivi ; une fiche de signalement ouverte le met en pause
  let popupOpen = false;
  map.on('popupopen', () => (popupOpen = true)); map.on('popupclose', () => (popupOpen = false));
  map.on('dragstart', () => { if (follow) setFollow(false); });
  btnLoc.onclick = locate;
  setFollow(false);
  // Si l'autorisation a déjà été donnée, on centre directement sur toi
  try { navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') locate(); }).catch(() => {}); } catch {}
  // Android n'a pas besoin d'autorisation pour la boussole : on l'allume dès le premier appui n'importe où
  document.addEventListener('pointerdown', () => { if (me) enableCompass(); }, { once: true, passive: true });

  // ---- Recherche de ville ----
  let searchTimer = null;
  $('#btnSearch').onclick = () => { closeReport(); closeSheets(); $('#sheetSearch').hidden = false; setTimeout(() => $('#searchInput').focus(), 50); };
  $('#ssClose').onclick = () => closeSheets();
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch(); });
  $('#searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 600); });
  async function runSearch() {
    const q = $('#searchInput').value.trim(), out = $('#searchResults');
    if (q.length < 2) { out.textContent = ''; return; }
    out.textContent = 'Recherche…';
    try {
      const res = await fetch('/api/geocode?q=' + encodeURIComponent(q));
      const list = await res.json();
      out.textContent = '';
      if (!res.ok) { out.textContent = list.error || 'Recherche indisponible.'; return; }
      if (!list.length) { out.textContent = 'Aucun lieu trouvé en France.'; return; }
      for (const p of list) {
        const b = el('button', { class: 'result' }, p.name);
        b.onclick = () => {
          closeSheets();
          if (p.bbox) map.fitBounds([[p.bbox[0], p.bbox[2]], [p.bbox[1], p.bbox[3]]], { maxZoom: 15 });
          else map.setView([p.lat, p.lng], 14);
        };
        out.append(el('li', {}, b));
      }
    } catch { out.textContent = 'Pas de réseau.'; }
  }

  // ---- Filtres ----
  function renderFilters() {
    const box = $('#filters'); box.textContent = '';
    for (const g of cfg.groups) {
      const n = [...reports.values()].filter(x => CAT[x.data.cat].group === g.id).length;
      const b = el('button', { class: 'chip', style: `--c:${GROUP_COLOR[g.id]}`, 'aria-pressed': String(!hidden.has(g.id)) }, g.label, ' ', el('span', { class: 'n' }, String(n)));
      b.onclick = () => {
        hidden.has(g.id) ? hidden.delete(g.id) : hidden.add(g.id);
        for (const { data, marker } of reports.values()) {
          if (CAT[data.cat].group !== g.id) continue;
          hidden.has(g.id) ? layer.removeLayer(marker) : layer.addLayer(marker);
        }
        refreshUI();
      };
      box.append(b);
    }
  }
  renderFilters();

  // ---- Signaler ----
  const sheets = ['#sheetReport', '#sheetList', '#sheetInfo', '#sheetSearch', '#sheetShare', '#sheetRights', '#sheetOrga', '#sheetAgenda', '#sheetEvent', '#sheetSos', '#sheetPrep'];
  const closeSheets = () => sheets.forEach(s => ($(s).hidden = true));
  // Fond assombri derrière les feuilles : un appui dessus ferme la feuille (sauf « Signaler », qui a besoin de la carte)
  const backdrop = $('#backdrop');
  const syncBackdrop = () => {
    backdrop.hidden = !sheets.some(s => s !== '#sheetReport' && !$(s).hidden);
    if ($('#sheetEvent').hidden && !drawing) drawLayer.clearLayers();
  };
  const sheetWatch = new MutationObserver(syncBackdrop);
  sheets.forEach(s => sheetWatch.observe($(s), { attributes: true, attributeFilter: ['hidden'] }));
  backdrop.addEventListener('click', () => closeSheets());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheets(); if (!$('#crosshair').hidden) closeReport(); } });
  function openReport() {
    if (!me && map.getZoom() < 14) {
      toast('Zoome sur l’endroit exact (ou active ta position) avant de signaler.');
      $('#btnSearch').focus();
      return;
    }
    closeSheets();
    $('#crosshair').hidden = false;
    $('#btnReport').classList.add('active');
    $('#btnReport').textContent = 'Annuler';
    $('#srHint').textContent = me ? 'Le viseur est sur ta position. Déplace la carte si c’est ailleurs.' : 'Place le viseur au bon endroit sur la carte, puis choisis.';
    $('#sheetReport').hidden = false;
    $('#srNote').value = '';
    // Le viseur se place au milieu de la zone de carte encore visible au-dessus de la feuille
    const y = aimY();
    $('#crosshair').style.top = y + 'px';
    if (me) { map.setView(me, Math.max(map.getZoom(), 17), { animate: false }); map.panBy([0, map.getSize().y / 2 - y], { animate: false }); }
  }
  function aimY() {
    const top = 60, sheetTop = $('#sheetReport').getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
    return Math.round(top + (Math.min(sheetTop, map.getSize().y) - top) / 2);
  }
  function closeReport() {
    $('#crosshair').hidden = true; $('#sheetReport').hidden = true;
    $('#btnReport').classList.remove('active'); $('#btnReport').textContent = 'Signaler';
  }
  $('#btnReport').onclick = () => ($('#crosshair').hidden ? openReport() : closeReport());
  $('#srClose').onclick = closeReport;

  (function buildGrid() {
    const grid = $('#catGrid');
    for (const g of cfg.groups) {
      grid.append(el('div', { class: 'group-title' }, g.label));
      const row = el('div', { class: 'row' });
      for (const c of cfg.categories.filter(c => c.group === g.id)) {
        const b = el('button', { class: 'cat', style: `--c:${GROUP_COLOR[g.id]}` }, el('span', { class: 'g', 'aria-hidden': 'true' }, c.glyph), c.label);
        b.onclick = () => submit(c.id);
        row.append(b);
      }
      grid.append(row);
    }
  })();

  // Point visé = position du viseur à l'écran
  const target = () => map.containerPointToLatLng([map.getSize().x / 2, aimY()]);
  async function submit(cat) {
    const p = target();
    try {
      const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE },
        body: JSON.stringify({ cat, lat: p.lat, lng: p.lng, note: $('#srNote').value }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return toast(body.error || 'Envoi impossible. Réessaie.');
      voted.add(body.id);
      closeReport();
      sync();
      toast(`${CAT[cat].label} signalé`);
    } catch { toast('Pas de réseau. Le signalement n’est pas parti.'); }
  }

  async function vote(id, v) {
    voted.add(id);
    try {
      const res = await fetch(`/api/reports/${id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify({ v }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) { voted.delete(id); return toast(body.error || 'Vote impossible.'); }
      toast(v === 1 ? 'Merci, signalement prolongé' : 'Merci, c’est noté');
      map.closePopup();
      sync();
    } catch { voted.delete(id); toast('Pas de réseau.'); }
  }

  // ---- Liste ----
  function renderList() {
    const ol = $('#list'); ol.textContent = '';
    const view = map.getBounds();
    const items = [...reports.values()].map(x => x.data).filter(r => !hidden.has(CAT[r.cat].group) && view.contains([r.lat, r.lng]));
    items.sort(me ? (a, b) => dist(me, [a.lat, a.lng]) - dist(me, [b.lat, b.lng]) : (a, b) => b.t - a.t);
    $('#listEmpty').hidden = items.length > 0;
    for (const r of items) {
      const c = CAT[r.cat];
      const btn = el('button', { 'aria-label': c.label },
        el('span', { class: 'g', style: `--c:${GROUP_COLOR[c.group]}` }, c.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, c.label), el('div', { class: 's' }, r.note || ago(r.t))),
        el('span', { class: 'd' }, me ? fmtDist(dist(me, [r.lat, r.lng])) : ago(r.t).replace('il y a ', '')));
      btn.onclick = () => { closeSheets(); const m = reports.get(r.id)?.marker; if (m) layer.zoomToShowLayer(m, () => m.openPopup()); };
      ol.append(el('li', {}, btn));
    }
  }
  $('#btnList').onclick = () => { closeReport(); closeSheets(); renderList(); $('#sheetList').hidden = false; };
  $('#slClose').onclick = () => closeSheets();
  $('#btnInfo').onclick = () => { closeReport(); closeSheets(); $('#sheetInfo').hidden = false; };
  $('#siClose').onclick = () => closeSheets();

  // ---- Installation sur l'écran d'accueil (PWA) ----
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Twitter|LinkedInApp|Snapchat/i.test(ua);
  let installEvent = null;
  function showInstall(withTool) {
    if (standalone) return;
    $('#installBox').hidden = false;
    if (withTool) $('#btnInstallTool').hidden = false;
  }
  function hideInstall() { $('#installBox').hidden = true; $('#btnInstallTool').hidden = true; }
  function installHelp(html) { const p = $('#installHelp'); p.innerHTML = html; p.hidden = false; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; showInstall(true); });
  window.addEventListener('appinstalled', () => { installEvent = null; hideInstall(); toast('Appli installée sur ton écran d’accueil'); });
  if (!standalone) showInstall(isIOS || inApp);
  async function doInstall() {
    closeReport(); closeSheets(); $('#sheetInfo').hidden = false;
    if (installEvent) {
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice.catch(() => ({}));
      installEvent = null;
      if (outcome === 'accepted') hideInstall(); else $('#btnInstallTool').hidden = true;
      return;
    }
    if (inApp) return installHelp('Tu es dans le navigateur d’une appli (Instagram, TikTok…), qui ne peut pas installer Cortège. Touche le menu <b>⋯</b> en haut à droite puis <b>Ouvrir dans le navigateur</b>, et recommence depuis là.');
    if (isIOS) return installHelp('Sur iPhone, dans <b>Safari</b> : touche le bouton <b>Partager</b> (le carré avec une flèche vers le haut), puis <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.');
    installHelp('Ouvre le menu de ton navigateur (<b>⋮</b>) puis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.');
  }
  $('#btnInstall').onclick = doInstall;
  $('#btnInstallTool').onclick = doInstall;

  // ---- Annonces orga (bandeaux) ----
  let dismissed = new Set();
  try { dismissed = new Set(JSON.parse(localStorage.getItem('cortege-dismissed') || '[]')); } catch {}
  const seenAnns = new Set();
  function renderAnns(list, canAlert) {
    announcements = list;
    const box = $('#anns'); box.textContent = '';
    const shown = list.filter(a => a.kind === 'info' && !dismissed.has(a.id))
      .sort((a, b) => (b.level === 'urgent') - (a.level === 'urgent') || b.t - a.t);
    const maxBanners = innerHeight < 760 ? 2 : 3; // petits écrans : ne pas masquer les boutons
    for (const a of shown.slice(0, maxBanners)) {
      const close = el('button', { class: 'ann-x', 'aria-label': 'Masquer cette annonce' }, '×');
      close.onclick = () => { dismissed.add(a.id); try { localStorage.setItem('cortege-dismissed', JSON.stringify([...dismissed].slice(-200))); } catch {} renderAnns(announcements, false); };
      box.append(el('div', { class: 'ann ' + a.level },
        el('div', { class: 'ann-meta' }, '📣 ' + a.by + (a.national ? ' · toute la France' : '') + ' · ' + ago(a.t)),
        el('div', { class: 'ann-text' }, a.text),
        a.link ? el('a', { class: 'ann-link', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, 'En savoir plus →') : '', close));
      if (canAlert && !seenAnns.has(a.id) && a.level === 'urgent') { try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch {} }
    }
    if (shown.length > maxBanners) box.append(el('div', { class: 'ann-more' }, `+ ${shown.length - maxBanners} autre(s) annonce(s)`));
    list.forEach(a => seenAnns.add(a.id));
    renderLegal();
    if (!$('#sheetOrga').hidden) renderOrgaList();
  }

  // ---- Mes droits : numéros des legal teams de la zone ----
  function renderLegal() {
    const box = $('#legalList'); box.textContent = '';
    const legal = announcements.filter(a => a.kind === 'legal');
    $('#legalNone').hidden = legal.length > 0;
    for (const a of legal) {
      const num = a.phone;
      const call = el('a', { class: 'legal-call', href: 'tel:' + num.replace(/[^\d+]/g, '') }, 'Appeler');
      const copy = el('button', { class: 'legal-copy' }, 'Copier');
      copy.onclick = async () => { try { await navigator.clipboard.writeText(num); toast('Numéro copié'); } catch { toast(num); } };
      box.append(el('div', { class: 'legal-row' },
        el('div', { class: 'legal-who' }, el('b', {}, a.by), a.text ? el('span', {}, a.text) : ''),
        el('div', { class: 'legal-num' }, num), el('div', { class: 'legal-actions' }, call, copy)));
    }
  }
  $('#btnRights').onclick = () => { closeReport(); closeSheets(); renderLegal(); $('#sheetRights').hidden = false; };
  $('#rgClose').onclick = () => closeSheets();

  // ---- Partage par QR code (généré sur le téléphone, marche hors ligne) ----
  const shareUrl = location.origin + '/';
  function openShare() {
    closeReport(); closeSheets();
    if (!openShare.done && window.qrcode) {
      const q = qrcode(0, 'M'); q.addData(shareUrl); q.make();
      $('#qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
      openShare.done = true;
    }
    $('#qrUrl').textContent = shareUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('#btnNativeShare').hidden = !navigator.share;
    $('#sheetShare').hidden = false;
    try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  }
  $('#btnShare').onclick = openShare;
  $('#btnShareTop').onclick = openShare;
  $('#shClose').onclick = () => closeSheets();
  $('#btnNativeShare').onclick = () => navigator.share?.({ title: 'Cortège', text: 'La carte en direct des manifs, par @' + (cfg.brand?.handle || 'neru'), url: shareUrl }).catch(() => {});
  $('#btnCopyLink').onclick = async () => { try { await navigator.clipboard.writeText(shareUrl); toast('Lien copié'); } catch { toast(shareUrl); } };

  // ---- Espace orga / legal team ----
  // Le lien orga ressemble à https://cortege.neru.tv/?orga=CLÉ : la clé est gardée sur ce téléphone et retirée de l'adresse.
  const orgaKey = () => { try { return localStorage.getItem('cortege-orga') || ''; } catch { return ''; } };
  async function orgaFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Orga-Key': orgaKey(), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) { setOrga(null); try { localStorage.removeItem('cortege-orga'); } catch {} }
    if (!res.ok) throw new Error(body.error || 'Action impossible.');
    return body;
  }
  function setOrga(o) {
    orga = o;
    $('#btnOrga').hidden = !o;
    $('#orgaChip').hidden = !o;
    if (o) { $('#orgaChip').textContent = o.admin ? 'ADMIN' : 'ORGA'; $('#orgaChip').title = o.label; $('#orgaName').textContent = o.label; }
    $('#annNationalWrap').hidden = !(o && o.admin);
    $('#btnPropose').textContent = o ? 'Publier une manif ou un blocus' : 'Proposer un blocus ou une manif';
    $('#agFine').hidden = !!o;
  }
  (async () => {
    const params = new URLSearchParams(location.search);
    if (params.has('orga')) {
      try { localStorage.setItem('cortege-orga', params.get('orga')); } catch {}
      history.replaceState(null, '', location.pathname);
    }
    if (!orgaKey()) return;
    try { const who = await orgaFetch('/api/orga/me'); setOrga(who); toast('Mode orga : ' + who.label); }
    catch (e) { toast(e.message); }
  })();
  async function orgaAction(id, action) {
    try {
      await orgaFetch(`/api/reports/${id}/${action}`, { method: 'POST', body: '{}' });
      toast(action === 'verify' ? 'Signalement marqué vérifié' : 'Signalement retiré');
      map.closePopup(); etag = null; sync();
    } catch (e) { toast(e.message); }
  }
  function renderOrgaList() {
    const ol = $('#annList'); ol.textContent = '';
    if (!announcements.length) { ol.append(el('li', { class: 'empty' }, 'Aucune annonce active ici.')); return; }
    for (const a of announcements) {
      const mine = orga && (orga.admin || a.by === orga.label);
      const del = el('button', { class: 'ghost' }, 'Retirer');
      del.disabled = !mine;
      del.onclick = async () => { try { await orgaFetch('/api/announcements/' + a.id, { method: 'DELETE' }); toast('Annonce retirée'); etag = null; sync(); } catch (e) { toast(e.message); } };
      ol.append(el('li', { class: 'ann-row' },
        el('div', { class: 't' }, el('div', { class: 'l' }, (a.kind === 'legal' ? '⚖ ' + a.phone : (a.level === 'urgent' ? '⚠ ' : '') + a.text)),
          el('div', { class: 's' }, `${a.by} · ${a.national ? 'toute la France' : a.r + ' km'} · ${a.permanent ? 'permanent' : 'expire dans ' + left(a.exp)}`)), del));
    }
  }
  $('#btnOrga').onclick = () => { closeReport(); closeSheets(); renderOrgaList(); $('#sheetOrga').hidden = false; };
  $('#orClose').onclick = () => closeSheets();
  document.querySelectorAll('input[name="kind"]').forEach(r => r.addEventListener('change', () => {
    const legal = document.querySelector('input[name="kind"]:checked').value === 'legal';
    $('#annInfoFields').hidden = legal; $('#annLegalFields').hidden = !legal;
    $('#annMinutesWrap').hidden = legal; $('#annLegalHint').hidden = !legal;
    annZoneUI();
  }));
  // Annonce nationale (admin) : pas de rayon
  const annZoneUI = () => { $('#annRadiusWrap').hidden = $('#annNational').checked && !$('#annInfoFields').hidden; };
  $('#annNational').addEventListener('change', annZoneUI);
  $('#annForm').addEventListener('submit', async e => {
    e.preventDefault();
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const c = map.getCenter();
    const body = { kind, lat: c.lat, lng: c.lng, radiusKm: +$('#annRadius').value, minutes: +$('#annMinutes').value };
    if (kind === 'legal') Object.assign(body, { phone: $('#annPhone').value, text: $('#annLegalText').value });
    else Object.assign(body, { text: $('#annText').value, level: document.querySelector('input[name="level"]:checked').value,
      national: !!(orga && orga.admin && $('#annNational').checked) });
    try {
      await orgaFetch('/api/announcements', { method: 'POST', body: JSON.stringify(body) });
      toast('Annonce publiée');
      $('#annText').value = ''; $('#annPhone').value = ''; $('#annLegalText').value = ''; $('#annNational').checked = false; annZoneUI();
      etag = null; sync();
    } catch (err) { toast(err.message); }
  });
  $('#btnOrgaLogout').onclick = () => { try { localStorage.removeItem('cortege-orga'); } catch {} setOrga(null); closeSheets(); toast('Mode orga désactivé sur ce téléphone'); };

  // ---- Agenda : manifs, blocus, rassemblements, AG ----
  const EVT = Object.fromEntries((cfg.eventTypes || []).map(t => [t.id, t]));
  const evLayer = L.layerGroup().addTo(map);
  const evMarkers = new Map();
  let selectedEv = null;
  const fmtWhen = t => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtHour = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Sur la carte : les événements du moment (de 12 h avant à 10 h après le départ), plus celui choisi dans l'agenda
  const evOnMap = e => e.id === selectedEv || (e.start - 12 * 60 * MIN < Date.now() && e.start + 10 * 60 * MIN > Date.now());
  function evPopup(e) {
    const t = EVT[e.type] || { glyph: '📍', label: '' };
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, t.glyph + ' ', e.title));
    root.append(el('div', { class: 'pop-meta' }, `${t.label} · ${fmtWhen(e.start)}`));
    root.append(el('div', { class: 'pop-meta' }, '📍 ' + e.place + (me ? ' · ' + fmtDist(dist(me, [e.lat, e.lng])) : '')));
    if (e.note) root.append(el('p', { class: 'pop-note' }, e.note));
    root.append(el('div', { class: 'pop-meta' }, 'Publié par ' + e.by));
    if (orga && (orga.admin || e.by === orga.label)) {
      const rm = el('button', { class: 'danger' }, 'Retirer cet événement');
      rm.onclick = async () => {
        if (!rm.dataset.armed) { rm.dataset.armed = '1'; rm.textContent = 'Confirmer le retrait'; return; }
        try { await orgaFetch('/api/events/' + e.id, { method: 'DELETE' }); toast('Événement retiré'); map.closePopup(); sync(); } catch (err) { toast(err.message); }
      };
      root.append(el('div', { class: 'pop-actions orga', style: 'grid-template-columns:1fr' }, rm));
    }
    return root;
  }
  function renderEvents() {
    evLayer.clearLayers(); evMarkers.clear();
    for (const e of evCache.e.filter(evOnMap)) {
      const t = EVT[e.type] || { glyph: '📍' };
      if (e.route) {
        L.polyline(e.route, { color: '#ec9fa4', weight: 5, opacity: .9, dashArray: '10 8', interactive: false }).addTo(evLayer);
        if (e.end) L.marker(e.route[e.route.length - 1], { icon: L.divIcon({ className: '', iconSize: [30, 30], html: '<div class="ev-end">🏁</div>' }), title: 'Dispersion prévue', keyboard: false })
          .bindPopup('Dispersion prévue : ' + e.title).addTo(evLayer);
      }
      const m = L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18], html: `<div class="ev-pin">${t.glyph}</div>` }),
        title: e.title, zIndexOffset: 500 }).bindPopup(() => evPopup(e)).addTo(evLayer);
      evMarkers.set(e.id, m);
    }
    if (!$('#sheetAgenda').hidden) renderAgenda();
  }
  function renderAgenda() {
    const scope = document.querySelector('input[name="agScope"]:checked').value;
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    let list = evCache.e.filter(e => e.start + 3 * 60 * MIN > now);
    if (scope === 'near') list = list.filter(e => dist(ref, [e.lat, e.lng]) <= 50_000);
    list.sort((a, b) => a.start - b.start);
    const ol = $('#agList'); ol.textContent = '';
    $('#agEmpty').hidden = list.length > 0;
    $('#agEmpty').textContent = scope === 'all' ? 'Aucune mobilisation annoncée pour l’instant.'
      : me ? 'Rien d’annoncé à moins de 50 km de toi. Regarde « Toute la France ».' : 'Rien d’annoncé à moins de 50 km du centre de la carte. Active ta position ou regarde « Toute la France ».';
    let day = '';
    for (const e of list.slice(0, 200)) {
      const d = e.start < now ? 'En cours' : new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (d !== day) { day = d; ol.append(el('li', { class: 'ag-day' }, d)); }
      const t = EVT[e.type] || { glyph: '📍' };
      const btn = el('button', { 'aria-label': e.title },
        el('span', { class: 'g', style: '--c:var(--accent)' }, t.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, e.title), el('div', { class: 's' }, `${fmtHour(e.start)} · ${e.place} · ${e.by}`)),
        el('span', { class: 'd' }, fmtDist(dist(ref, [e.lat, e.lng]))));
      btn.onclick = () => showEvent(e);
      ol.append(el('li', {}, btn));
    }
  }
  function showEvent(e) {
    closeSheets(); setFollow(false);
    selectedEv = e.id; renderEvents();
    if (e.route) map.fitBounds(L.latLngBounds(e.route.concat([[e.lat, e.lng]])), { padding: [40, 40], maxZoom: 16 });
    else map.setView([e.lat, e.lng], 16);
    setTimeout(() => evMarkers.get(e.id)?.openPopup(), 350);
  }
  $('#btnAgenda').onclick = () => { closeReport(); closeSheets(); renderAgenda(); $('#sheetAgenda').hidden = false; };
  $('#agClose').onclick = () => closeSheets();
  document.querySelectorAll('input[name="agScope"]').forEach(r => r.addEventListener('change', renderAgenda));

  // ---- Publier (orga) ou proposer (tout le monde) un événement, avec parcours tracé sur la carte ----
  const draft = { route: [] };
  let evAsOrga = false, drawing = false;
  const drawLayer = L.layerGroup().addTo(map);
  (function buildEvTypes() {
    const box = $('#evTypes');
    (cfg.eventTypes || []).forEach((t, i) => {
      const input = el('input', { type: 'radio', name: 'evType', value: t.id }); input.checked = i === 0;
      box.append(el('label', {}, input, ' ' + t.glyph + ' ' + t.label));
    });
  })();
  const localInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function routeLength(r) { let m = 0; for (let i = 1; i < r.length; i++) m += map.distance(r[i - 1], r[i]); return m; }
  function redrawDraft() {
    drawLayer.clearLayers();
    const r = draft.route, n = r.length;
    if (n > 1) L.polyline(r, { color: '#ec9fa4', weight: 5, interactive: false }).addTo(drawLayer);
    r.forEach((p, i) => L.marker(p, { interactive: false, keyboard: false,
      icon: i === 0 ? L.divIcon({ className: '', iconSize: [38, 38], html: '<div class="ev-pin">📍</div>' }) : L.divIcon({ className: '', iconSize: [14, 14], html: '<div class="draw-pt"></div>' }) }).addTo(drawLayer));
    $('#drawCount').textContent = !n ? 'Aucun point' : n === 1 ? 'Rendez-vous placé' : `Rendez-vous + ${n - 1} point${n > 2 ? 's' : ''} de parcours`;
    $('#evRouteState').textContent = !n ? 'Touche la carte pour placer le rendez-vous, puis, si tu veux, les points du parcours.'
      : n === 1 ? 'Rendez-vous placé, sans parcours.' : `Rendez-vous placé, parcours de ${fmtDist(routeLength(r))}.`;
    $('#btnDraw').textContent = n ? 'Modifier sur la carte' : 'Placer le rendez-vous sur la carte';
  }
  function openEventForm(asOrga) {
    closeReport(); closeSheets();
    evAsOrga = asOrga;
    $('#evTitle').textContent = asOrga ? 'Publier un événement' : 'Proposer une mobilisation';
    $('#evSubmit').textContent = asOrga ? 'Publier' : 'Envoyer la proposition';
    if (!$('#evStart').value) { const d = new Date(Date.now() + 60 * MIN); d.setMinutes(0, 0, 0); $('#evStart').value = localInput(d); }
    redrawDraft();
    $('#sheetEvent').hidden = false;
  }
  function startDraw() {
    closeSheets(); setFollow(false); map.closePopup();
    drawing = true; document.body.classList.add('drawing'); $('#drawBar').hidden = false;
    if (!draft.route.length && me) map.setView(me, Math.max(map.getZoom(), 16));
    redrawDraft();
  }
  function stopDraw() { drawing = false; document.body.classList.remove('drawing'); $('#drawBar').hidden = true; $('#sheetEvent').hidden = false; redrawDraft(); }
  map.on('click', e => { if (!drawing) return; if (draft.route.length < 300) draft.route.push([e.latlng.lat, e.latlng.lng]); redrawDraft(); });
  $('#btnDraw').onclick = startDraw;
  $('#drawUndo').onclick = () => { draft.route.pop(); redrawDraft(); };
  $('#drawClear').onclick = () => { draft.route = []; redrawDraft(); };
  $('#drawDone').onclick = stopDraw;
  $('#evClose').onclick = () => closeSheets();
  $('#btnPropose').onclick = () => openEventForm(!!orga);
  $('#btnOrgaEvent').onclick = () => openEventForm(true);
  $('#evForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!draft.route.length) { toast('Place d’abord le rendez-vous sur la carte.'); return; }
    const start = new Date($('#evStart').value).getTime();
    if (!start) { toast('Choisis la date et l’heure.'); return; }
    const [lat, lng] = draft.route[0];
    const body = { type: document.querySelector('input[name="evType"]:checked').value, title: $('#evTitleIn').value, place: $('#evPlace').value,
      note: $('#evNote').value, start, lat, lng, route: draft.route.length >= 2 ? draft.route : null, end: $('#evEnd').checked };
    const headers = { 'Content-Type': 'application/json', 'X-Device': DEVICE };
    if (evAsOrga) headers['X-Orga-Key'] = orgaKey();
    try {
      const res = await fetch('/api/events', { method: 'POST', headers, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return toast(out.error || 'Envoi impossible.');
      toast(out.status === 'ok' ? 'Événement publié' : 'Proposition envoyée : elle apparaîtra après vérification');
      $('#evForm').reset(); $('#evStart').value = ''; draft.route = []; drawLayer.clearLayers();
      document.querySelector('input[name="evType"]').checked = true;
      closeSheets();
      if (out.status === 'ok') { selectedEv = out.id; sync(); }
    } catch { toast('Pas de réseau. Rien n’est parti.'); }
  });

  // ---- Interpellation : prévenir un proche (le message part du téléphone, rien ne passe par le serveur) ----
  const sosGet = () => { try { return JSON.parse(localStorage.getItem('cortege-sos') || 'null'); } catch { return null; } };
  function sosMessage() {
    const who = document.querySelector('input[name="sosWho"]:checked').value;
    const hour = fmtHour(Date.now()).replace(':', ' h ');
    let s = who === 'me' ? `Je viens d’être interpellé·e (${hour})` : `Quelqu’un de mon groupe vient d’être interpellé·e (${hour})`;
    if (me) { const la = me[0].toFixed(4), lo = me[1].toFixed(4); s += ` ici : https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`; }
    const legal = announcements.find(a => a.kind === 'legal');
    s += legal ? `. Préviens la legal team : ${legal.phone} (${legal.by}).` : '. Préviens la legal team de la manif.';
    s += ' Message envoyé avec Cortège.';
    return s;
  }
  function sosLink() {
    const c = sosGet(); if (!c) return;
    const num = c.phone.replace(/[^\d+]/g, '');
    $('#sosSms').href = `sms:${num}${isIOS ? '&' : '?'}body=${encodeURIComponent($('#sosMsg').value)}`;
  }
  function openSos() {
    closeReport(); closeSheets();
    const c = sosGet();
    $('#sosSetup').hidden = !!c; $('#sosReady').hidden = !c;
    if (c) { $('#sosTo').textContent = c.name || c.phone; $('#sosMsg').value = sosMessage(); sosLink(); }
    else { $('#sosName').value = ''; $('#sosPhone').value = ''; }
    $('#sheetSos').hidden = false;
  }
  $('#btnSos').onclick = openSos;
  $('#btnSosRights').onclick = openSos;
  $('#sosClose').onclick = () => closeSheets();
  $('#sosForm').addEventListener('submit', e => {
    e.preventDefault();
    const phone = $('#sosPhone').value.trim();
    if (phone.replace(/\D/g, '').length < 6) return toast('Numéro invalide.');
    try { localStorage.setItem('cortege-sos', JSON.stringify({ name: $('#sosName').value.trim().slice(0, 30), phone })); } catch { return toast('Impossible d’enregistrer sur ce téléphone.'); }
    toast('Contact enregistré sur ce téléphone'); openSos();
  });
  $('#sosEdit').onclick = () => { const c = sosGet() || {}; $('#sosSetup').hidden = false; $('#sosReady').hidden = true; $('#sosName').value = c.name || ''; $('#sosPhone').value = c.phone || ''; };
  $('#sosMsg').addEventListener('input', sosLink);
  document.querySelectorAll('input[name="sosWho"]').forEach(r => r.addEventListener('change', () => { $('#sosMsg').value = sosMessage(); sosLink(); }));
  $('#sosShare').onclick = () => {
    const text = $('#sosMsg').value;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('Message copié : colle-le dans ta messagerie'), () => toast(text));
  };

  // ---- Économie de batterie ----
  const ecoBadge = el('span', { class: 'eco', title: 'Économie de batterie', 'aria-label': 'Économie de batterie' }, '🔋');
  $('#status').append(ecoBadge);
  function applyEco() {
    ecoBadge.hidden = !eco;
    $('#optEco').checked = eco;
    if (eco && compassOn) {
      window.removeEventListener('deviceorientationabsolute', onOrient, true); window.removeEventListener('deviceorientation', onOrient, true);
      compassOn = false; heading = null; rawHeading = null; drawHeading();
    }
    // relance le GPS avec les nouveaux réglages
    if (watchId != null) { const f = follow; navigator.geolocation.clearWatch(watchId); watchId = null; locate(); setFollow(f); }
  }
  $('#optEco').addEventListener('change', e => {
    eco = e.target.checked;
    try { localStorage.setItem('cortege-eco', eco ? '1' : '0'); } catch {}
    applyEco(); sync();
    toast(eco ? 'Économie de batterie activée' : 'Économie de batterie désactivée');
  });
  ecoBadge.hidden = !eco; $('#optEco').checked = eco;
  try {
    navigator.getBattery?.().then(b => {
      const check = () => { if (!eco && !b.charging && b.level <= 0.2 && !check.done) { check.done = true; toast('Batterie faible : active l’économie de batterie dans « ? »'); } };
      check(); b.addEventListener('levelchange', check);
    }).catch(() => {});
  } catch {}

  // ---- Notifications : annonces urgentes même appli fermée ----
  const pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!cfg.pushKey;
  const b64u = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  let pushZone = null; try { pushZone = localStorage.getItem('cortege-push-zone'); } catch {}
  // Le serveur ne reçoit qu'une zone arrondie à 0,1° (≈ 10 km), mise à jour quand tu changes de zone
  async function pushSend(sub, force) {
    const c = map.getCenter(), ref = me || [c.lat, c.lng];
    const z = ref.map(x => Math.round(x * 10) / 10), key = z.join(',');
    if (!force && key === pushZone) return;
    pushZone = key;
    const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: sub.toJSON(), lat: z[0], lng: z[1] }) });
    if (!res.ok) { pushZone = null; throw new Error((await res.json().catch(() => ({}))).error || 'Abonnement impossible.'); }
    try { localStorage.setItem('cortege-push-zone', key); } catch {}
  }
  if (isIOS && !standalone) $('#pushHelp').textContent += ' Sur iPhone, installe d’abord l’appli sur l’écran d’accueil, puis active ce réglage depuis l’appli installée.';
  if (pushOK) navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
    if (sub && Notification.permission === 'granted') { pushSub = sub; $('#optPush').checked = true; pushSend(sub).catch(() => {}); }
  }).catch(() => {});
  $('#optPush').addEventListener('change', async e => {
    const box = e.target;
    if (box.checked) {
      if (!pushOK) { box.checked = false; return toast(isIOS && !standalone ? 'Sur iPhone : installe d’abord l’appli sur l’écran d’accueil.' : 'Notifications non prises en charge par ce navigateur.'); }
      try {
        if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du téléphone.');
        const reg = await navigator.serviceWorker.ready;
        pushSub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(cfg.pushKey) });
        await pushSend(pushSub, true);
        toast('Annonces urgentes activées');
      } catch (err) { box.checked = false; pushSub = null; toast(err.message || 'Activation impossible.'); }
    } else {
      const sub = pushSub; pushSub = null; pushZone = null;
      try { localStorage.removeItem('cortege-push-zone'); } catch {}
      try {
        if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: { endpoint: sub.endpoint } }) }); await sub.unsubscribe(); }
      } catch {}
      toast('Notifications désactivées');
    }
  });

  // ---- Bien se préparer : checklist gardée sur le téléphone ----
  const prepKey = 'cortege-prep';
  const prepGet = () => { try { return JSON.parse(localStorage.getItem(prepKey) || '{}'); } catch { return {}; } };
  const prepBoxes = [...document.querySelectorAll('#sheetPrep .checklist input[type=checkbox]')];
  function prepRender() {
    const st = prepGet();
    prepBoxes.forEach(b => (b.checked = !!st[b.dataset.k]));
    const done = prepBoxes.filter(b => b.checked).length;
    $('#prepCount').textContent = `${done} / ${prepBoxes.length} prêt${done > 1 ? 's' : ''}`;
  }
  prepBoxes.forEach(b => b.addEventListener('change', () => {
    const st = prepGet(); st[b.dataset.k] = b.checked;
    try { localStorage.setItem(prepKey, JSON.stringify(st)); } catch {}
    prepRender();
  }));
  function openPrep() { closeReport(); closeSheets(); prepRender(); rallyRender(); $('#sheetPrep').hidden = false; }
  $('#btnPrep').onclick = openPrep;
  $('#btnPrepInfo').onclick = openPrep;
  $('#prClose').onclick = () => closeSheets();
  $('#prepReset').onclick = () => { try { localStorage.removeItem(prepKey); } catch {} prepRender(); toast('Checklist remise à zéro'); };
  $('#prepRights').onclick = () => { closeSheets(); renderLegal(); $('#sheetRights').hidden = false; };
  $('#prepSos').onclick = e => { e.preventDefault(); openSos(); };
  $('#prepOffline').onclick = e => { e.preventDefault(); closeSheets(); $('#sheetInfo').hidden = false; $('#btnPrefetch').scrollIntoView({ block: 'center' }); $('#btnPrefetch').focus(); };

  // ---- Point de ralliement du groupe (privé : reste sur le téléphone, partagé seulement si on le décide) ----
  const rallyGet = () => { try { return JSON.parse(localStorage.getItem('cortege-rally') || 'null'); } catch { return null; } };
  let rallyMarker = null, picking = false;
  const rallyLink = p => `https://www.openstreetmap.org/?mlat=${p[0].toFixed(5)}&mlon=${p[1].toFixed(5)}#map=18/${p[0].toFixed(5)}/${p[1].toFixed(5)}`;
  function rallyShare() {
    const p = rallyGet(); if (!p) return;
    const text = `Point de ralliement si on se perd en manif : ${rallyLink(p)}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('Lien copié : colle-le dans ton groupe'), () => toast(text));
  }
  function rallyRender() {
    const p = rallyGet();
    if (rallyMarker) { map.removeLayer(rallyMarker); rallyMarker = null; }
    if (p) {
      rallyMarker = L.marker(p, { icon: L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [8, 34], html: '<div class="rally-pin">🚩</div>' }), title: 'Point de ralliement', zIndexOffset: 600 })
        .bindPopup(() => {
          const root = el('div', {}, el('div', { class: 'pop-title' }, '🚩 Point de ralliement'),
            el('div', { class: 'pop-meta' }, 'Visible seulement sur ton téléphone' + (me ? ' · ' + fmtDist(dist(me, p)) : '')));
          const share = el('button', { class: 'yes' }, 'Partager');
          const rm = el('button', { class: 'danger' }, 'Retirer');
          share.onclick = rallyShare;
          rm.onclick = () => { try { localStorage.removeItem('cortege-rally'); } catch {} map.closePopup(); rallyRender(); };
          root.append(el('div', { class: 'pop-actions' }, share, rm));
          return root;
        }).addTo(map);
    }
    $('#rallyState').textContent = p ? `Point de ralliement placé${me ? ', à ' + fmtDist(dist(me, p)) + ' de toi' : ''}.` : 'Aucun point de ralliement.';
    $('#rallyShare').disabled = !p;
  }
  function startPick() {
    closeSheets(); setFollow(false); map.closePopup();
    picking = true; document.body.classList.add('drawing');
    const p = rallyGet(); if (p) map.setView(p, Math.max(map.getZoom(), 17));
    $('#crosshair').style.top = '45%'; $('#crosshair').hidden = false; $('#pickBar').hidden = false;
  }
  function endPick(save) {
    if (save) {
      const pt = map.containerPointToLatLng([map.getSize().x / 2, map.getSize().y * 0.45]);
      try { localStorage.setItem('cortege-rally', JSON.stringify([pt.lat, pt.lng])); } catch {}
      toast('Point de ralliement enregistré');
    }
    picking = false; document.body.classList.remove('drawing');
    $('#crosshair').hidden = true; $('#pickBar').hidden = true;
    const ck = prepBoxes.find(b => b.dataset.k === 'ralliement');
    if (save && ck && !ck.checked) { ck.checked = true; ck.dispatchEvent(new Event('change')); }
    openPrep();
  }
  $('#rallySet').onclick = startPick;
  $('#rallyShare').onclick = rallyShare;
  $('#pickOk').onclick = () => endPick(true);
  $('#pickCancel').onclick = () => endPick(false);
  rallyRender();

  // Premier lancement : on montre les réflexes (et la carte @neru) une fois
  try { if (!localStorage.getItem('cortege-seen')) { $('#sheetInfo').hidden = false; localStorage.setItem('cortege-seen', '1'); } } catch {}

  // ---- Hors ligne : PWA + pré-chargement des tuiles de la zone ----
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  $('#btnPrefetch').onclick = async () => {
    const state = $('#prefetchState');
    const b = map.getBounds(), z0 = Math.max(13, map.getZoom() - 1), z1 = Math.min(18, z0 + 3);
    const urls = [];
    for (let z = z0; z <= z1; z++) {
      const nw = map.project(b.getNorthWest(), z).divideBy(256).floor();
      const se = map.project(b.getSouthEast(), z).divideBy(256).floor();
      for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) urls.push(`/tiles/${z}/${x}/${y}.png`);
    }
    if (urls.length > 1500) return (state.textContent = 'Zone trop grande : zoome sur le parcours puis réessaie.');
    let done = 0;
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(urls.slice(i, i + 6).map(u => fetch(u).then(() => done++).catch(() => {})));
      state.textContent = `${done} / ${urls.length} morceaux de carte gardés`;
    }
    state.textContent = `Zone gardée (${done} morceaux). La carte s’affichera même si le réseau sature.`;
  };
})();
