  // ---- Synchro : interrogation régulière du serveur (robuste sur hébergement mutualisé) ----
  const POLL_MS = 5000;
  let etag = null, firstSync = true, pollTimer = null, lastOk = 0;
  const stream = { es: null, ok: false, key: '', t: null };
  const status = $('#status');
  const setStatus = (state, txt) => { status.dataset.state = state; status.querySelector('.txt').textContent = txt; $('#manifTop').dataset.state = state; };
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
    computeCalm(list);
    for (const r of list) {
      const fresh = !reports.has(r.id) && !firstSync && isFresh(r);
      upsert(r, fresh);
      if (fresh) proximity(r);
    }
    firstSync = false;
    regroup(); calmNav();
    refreshUI();
  }

  // --- Mode principal : fichiers statiques live/ (servis par Apache, Node n'est pas sollicité) ---
  const CELL = 0.05;
  const cellOf = r => `${Math.floor(r.lat / CELL)}_${Math.floor(r.lng / CELL)}`;
  const cellCache = new Map();          // case -> { h, r }
  let allCache = { h: null, r: [] }, annCache = { h: null, a: [] };
  let mode = null, knownCells = new Set(), useApi = false, failures = 0;
  // ---- Réseau faible ----
  // L'appli mesure ses propres requêtes (et ce qu'annonce Chrome sur Android) : si ça rame, elle passe en mode léger.
  const net = { lite: false, samples: [], told: false };
  const conn = navigator.connection;
  const slowHint = () => !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '') || conn.rtt > 1500));
  // Retour de l'arrière-plan ou réseau retrouvé : les premiers échecs ne veulent pas dire « réseau faible »
  let resumeAt = 0;
  const RESUME_GRACE = 12000;
  function netSample(ms, ok) {
    if (!ok && (navigator.onLine === false || Date.now() - resumeAt < RESUME_GRACE)) return;
    net.samples.push({ ms, ok }); if (net.samples.length > 6) net.samples.shift();
    const last4 = net.samples.slice(-4), bad = last4.filter(x => !x.ok || x.ms > 3000).length;
    if (!net.lite && (slowHint() || bad >= 2)) setLite(true);
    else if (net.lite && !slowHint() && net.samples.length >= 5 && net.samples.slice(-5).every(x => x.ok && x.ms < 1200)) setLite(false);
  }
  function setLite(on) {
    net.lite = on;
    navigator.serviceWorker?.controller?.postMessage({ type: 'lite', on });
    if (on && !net.told) { net.told = true; toast(t('Réseau faible : mode léger activé (seuls les signalements passent)')); }
    freshness();
  }
  conn?.addEventListener?.('change', () => { if (slowHint() && !net.lite) setLite(true); });
  // Fichiers gardés pour le hors-ligne (agenda, annonces) : dernière version reçue
  const KEEP = /\/live\/(events|ann|legal|l\/[\w-]+)\.json$/;
  const dataCache = () => caches.open('cortege-data');
  async function cacheGet(key) { try { const r = await (await dataCache()).match(key); return r ? r.json() : null; } catch { return null; } }
  function cachePut(key, obj) { try { dataCache().then(c => c.put(key, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {}); } catch {} }
  const getJ = (url, ms) => {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms || (net.lite ? 6000 : 12000)), t0 = performance.now();
    return fetch(url, { cache: 'no-cache', signal: ac.signal })
      .then(r => { netSample(performance.now() - t0, true); if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status }); return r.json(); },
        e => { netSample(null, false); throw e; })
      .then(j => { if (KEEP.test(url)) cachePut(url, j); return j; })
      .catch(async e => { if (KEEP.test(url) && !e.status) { const c = await cacheGet(url); if (c) return c; } throw e; })
      .finally(() => clearTimeout(to));
  };
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
  async function syncLegal(g) {
    if (!('legal' in g) || legalCache.h === g.legal) return;
    try { legalCache = { h: g.legal, l: g.legal ? (await getJ('/live/legal.json')).l || [] : [] }; } catch {}
  }
  // Sans réseau à l'ouverture : derniers numéros connus (annuaire et legal teams des manifs)
  (async () => {
    const [l, a] = await Promise.all([cacheGet('/live/legal.json'), cacheGet('/live/ann.json')]);
    if (l && !legalCache.h && !legalCache.l.length) legalCache = { h: null, l: l.l || [] };
    if (a && !annCache.h && !annCache.a.length) annCache = { h: null, a: a.a || [] };
  })();
  // Format actuel : g.json (annonces, agenda, pause) + un index par région de 1° autour de la zone affichée.
  // Ces petits fichiers changent rarement : le téléphone reçoit presque toujours un « rien de neuf » (304).
  let lastActivity = 0, legacy = false;
  const regionOf = id => { const [i, j] = id.split('_').map(Number); return `${Math.floor(i / 20)}_${Math.floor(j / 20)}`; };
  const getOpt = (url, empty) => getJ(url).catch(e => { if (e.status === 404) return empty; throw e; });
  // Charge les cases demandées (index de région, puis seulement les cases modifiées)
  async function loadCells(need, now) {
    const regions = [...new Set(need.map(regionOf))];
    const idxs = await Promise.all(regions.map(rg => getOpt('/live/r/' + rg + '.json', { c: {} })));
    const hashes = Object.assign({}, ...idxs.map(x => x.c || {}));
    const prev = knownCells; knownCells = new Set(need);
    await Promise.all(need.map(async id => {
      const h = hashes[id];
      const c = cellCache.get(id);
      if (!h) { if (c && prev.has(id)) lastActivity = now; cellCache.delete(id); return; }
      if (!c || c.h !== h) {
        if (prev.has(id)) lastActivity = now;
        cellCache.set(id, { h, r: (await getOpt('/live/c/' + id + '.json', { r: [] })).r });
      }
    }));
    for (const id of [...cellCache.keys()]) if (!knownCells.has(id)) cellCache.delete(id);
    return { list: need.flatMap(id => cellCache.get(id)?.r || []), prev };
  }
  // Cases autour de soi (≈ 4 km) : toujours chargées, même dézoomé
  function meCells() {
    if (!me) return [];
    const ids = [];
    for (let i = Math.floor((me[0] - 0.02) / CELL); i <= Math.floor((me[0] + 0.02) / CELL); i++)
      for (let j = Math.floor((me[1] - 0.03) / CELL); j <= Math.floor((me[1] + 0.03) / CELL); j++) ids.push(i + '_' + j);
    return ids;
  }
  // Bulles de la vue nationale : une par région d'environ 100 km
  let natCache = { r: [] };
  const natLayer = L.layerGroup().addTo(map);
  function renderNational() {
    natLayer.clearLayers();
    if (mode !== 'nat') return;
    for (const z of natCache.r) {
      const groups = SEVERITY.filter(g => !hidden.has(g) && z.g[g]);
      const n = groups.reduce((s, g) => s + z.g[g], 0);
      if (!n) continue;
      const size = n < 10 ? 40 : n < 100 ? 50 : 60;
      const label = groups.map(g => `${z.g[g]} ${cfg.groups.find(x => x.id === g)?.label.toLowerCase() || g}`).join(' · ');
      const m = L.marker([z.lat, z.lng], { title: label, keyboard: true, zIndexOffset: 200,
        icon: L.divIcon({ className: '', iconSize: [size, size], html: `<div class="cluster nat" style="--c:${GROUP_COLOR[groups[0]]};width:${size}px;height:${size}px">${n}</div>` }) });
      // Zoom sur le cœur de l'activité de la région, assez près pour afficher les vrais points
      m.on('click', () => map.setView([z.lat, z.lng], 12));
      natLayer.addLayer(m);
    }
  }
  // Mode léger : un seul petit fichier par région (≈ 100 km) au lieu de plusieurs requêtes ; l'état général une fois par minute
  const lite = { g: null, gAt: 0 };
  async function syncLite() {
    navigator.serviceWorker?.controller?.postMessage({ type: 'lite', on: true }); // le service worker a pu redémarrer
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    const rgs = new Set([`${Math.floor(ref[0])}_${Math.floor(ref[1])}`, `${Math.floor(c.lat)}_${Math.floor(c.lng)}`]);
    if (!lite.g || now - lite.gAt > 60000) { try { lite.g = await getJ('/live/g.json'); lite.gAt = now; } catch {} }
    const res = await Promise.allSettled([...rgs].map(rg => getJ(`/live/p/${rg}.json`)));
    if (!res.some(x => x.status === 'fulfilled')) throw res[0].reason;
    const list = res.flatMap(x => x.status === 'fulfilled' ? x.value.r || [] : []);
    const wasLite = mode === 'lite'; mode = 'lite';
    if (list.some(r => now - r.t < 15 * MIN)) lastActivity = now;
    let annChanged = false;
    const g = lite.g;
    if (g) {
      setPaused(g.paused); checkBuild(g.build); checkCfg(g.cfg); syncPois(g.pois); if (syncOrd) syncOrd(g.ord);
      if (g.events && evCache.h !== g.events) { try { evCache = { h: g.events, e: (await getJ('/live/events.json')).e || [] }; renderEvents(); } catch {} }
      if (annCache.h !== g.ann) { try { annCache = { h: g.ann, a: g.ann ? (await getJ('/live/ann.json')).a : [] }; annChanged = true; } catch {} }
      await syncLegal(g);
    }
    apply(list.filter(r => r.exp > now), annsFor(), () => wasLite, annChanged && !firstSync);
  }
  async function syncLive() {
    if (net.lite) return syncLite();
    if (legacy) return syncLegacy();
    let g;
    try { g = await getJ('/live/g.json'); }
    catch (e) { if (e.status === 404) { legacy = true; return syncLegacy(); } throw e; }
    const need = neededCells(), now = Date.now();
    let list, isFresh;
    // Vue nationale : des compteurs par région (n.json, quelques Ko) au lieu de tous les points,
    // plus les vrais points autour de toi pour que les alertes de proximité continuent de marcher.
    const nat = need === null ? await getOpt('/live/n.json', null) : null;
    if (need === null && nat && Array.isArray(nat.r)) {
      natCache = nat;
      const wasNat = mode === 'nat';
      const out = await loadCells(meCells(), now);
      list = out.list; isFresh = r => wasNat && out.prev.has(cellOf(r)); mode = 'nat';
    } else if (need === null) {
      // ancien serveur : tous les points
      const all = (await getJ('/live/all.json')).r || [];
      const sig = all.length + ':' + all.reduce((m, r) => Math.max(m, r.t), 0);
      if (allCache.h !== sig) { if (allCache.h) lastActivity = now; allCache = { h: sig, r: all }; }
      const wasAll = mode === 'all';
      list = allCache.r; isFresh = () => wasAll; mode = 'all';
    } else {
      const wasCells = mode === 'cells';
      const out = await loadCells(need, now);
      list = out.list; isFresh = r => wasCells && out.prev.has(cellOf(r)); mode = 'cells';
      // Un signalement de moins de 15 min autour de toi : ça bouge, on reste au rythme rapide
      if (list.some(r => now - r.t < 15 * 60_000)) lastActivity = now;
    }
    setPaused(g.paused); checkBuild(g.build); checkCfg(g.cfg); syncPois(g.pois); if (syncOrd) syncOrd(g.ord);
    if (g.events && evCache.h !== g.events) { evCache = { h: g.events, e: (await getJ('/live/events.json')).e || [] }; renderEvents(); }
    const annChanged = annCache.h !== g.ann;
    if (annChanged) { if (annCache.h) lastActivity = now; annCache = { h: g.ann, a: g.ann ? (await getJ('/live/ann.json')).a : [] }; }
    await syncLegal(g);
    apply(list.filter(r => r.exp > now), annsFor(), isFresh, annChanged && !firstSync);
  }

  // Ancien format (serveur pas encore mis à jour)
  async function syncLegacy() {
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
    setPaused(idx.paused); checkBuild(idx.build);
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
    if (anns.length) annCache = { h: annCache.h, a: [...annCache.a.filter(x => !anns.some(y => y.id === x.id)), ...anns] };
    lastZoneKey = key;
    apply(list, anns, () => sameZone, sameZone);
  }

