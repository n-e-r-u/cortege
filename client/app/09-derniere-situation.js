  // ---- Dernière situation connue (hors ligne) ----
  // Après chaque synchro réussie, on garde les points affichés sur le téléphone. Sans réseau à l'ouverture,
  // l'appli les remontre (ceux qui ne sont pas expirés), avec l'heure, et y ajoute ceux reçus par notification.
  let dataAt = 0, fallbackTried = false, snapAt = 0;
  function saveSnapshot() {
    if (Date.now() - snapAt < 30000) return; snapAt = Date.now();
    cachePut('/__snap', { at: Date.now(), r: [...reports.values()].map(x => x.data).slice(0, 500) });
  }
  const unpack = d => d.r.map(([id, cat, lat, lng, t, last, exp, up, fl]) => ({ id, cat, lat, lng, t: t * 1000, last: last * 1000, exp: exp * 1000, up, down: 0,
    ver: fl & 1 ? 'une orga' : null, notes: [], note: '', ...(fl & 2 ? { c: 1 } : {}), ...(fl & 4 ? { f: 1 } : {}), ...(fl & 8 ? { nf: 1 } : {}) })).filter(r => CAT[r.cat]);
  function mergeIn(rows, at) {
    if (!rows.length || at <= dataAt) return;
    const now = Date.now(), cur = new Map([...reports.values()].map(x => [x.data.id, x.data]));
    for (const r of rows) cur.set(r.id, r);
    dataAt = at;
    apply([...cur.values()].filter(r => r.exp > now), annsFor(), () => false, false);
    freshness();
  }
  async function useFallback() {
    const snap = await cacheGet('/__snap'), push = await cacheGet('/__push');
    if (snap && snap.r) mergeIn(snap.r, snap.at);
    if (push && push.r) mergeIn(unpack(push), push.at * 1000);
  }
  // Données arrivées avec une notification pendant que l'appli est ouverte mais sans réseau
  navigator.serviceWorker?.addEventListener?.('message', async e => {
    if (e.data && e.data.type === 'push-data' && Date.now() - lastOk > 20000) { const p = await cacheGet('/__push'); if (p && p.r) mergeIn(unpack(p), p.at * 1000); }
  });
  // ---- Temps réel ----
  // Abonnement aux régions affichées (carrés de 1°, ~100 km, comme les fichiers publiés) : à chaque changement,
  // le serveur envoie juste « cette région a changé » et l'appli relit les fichiers. Coupé quand l'appli est en arrière-plan.
  function streamRegions() {
    const b = map.getBounds(), out = new Set();
    if (map.getZoom() < 8) return '';
    for (let i = Math.floor(b.getSouth()); i <= Math.floor(b.getNorth()); i++)
      for (let j = Math.floor(b.getWest()); j <= Math.floor(b.getEast()); j++) out.add(i + '_' + j);
    if (me) out.add(Math.floor(me[0]) + '_' + Math.floor(me[1]));
    return out.size > 8 ? '' : [...out].sort().join(',');
  }
  function streamClose() { if (stream.es) { stream.es.close(); stream.es = null; } stream.ok = false; stream.key = ''; }
  function streamWatch() {
    if (!cfg.stream || !window.EventSource || document.hidden) return;
    const key = streamRegions();
    if (key === stream.key && stream.es) return;
    streamClose();
    if (!key) return;
    stream.key = key;
    const es = stream.es = new EventSource('/api/stream?r=' + key);
    es.onopen = () => { stream.ok = true; };
    es.onerror = () => { stream.ok = false; };
    es.onmessage = () => { clearTimeout(stream.t); stream.t = setTimeout(() => { etag = null; lastActivity = Date.now(); sync(); }, 250); };
  }
  // Bandeau : mode léger, ou âge de la dernière situation connue
  const agoTxt = x => { const m = Math.round((Date.now() - x) / 60000); return m < 1 ? t('à l’instant') : m < 60 ? t('il y a {m} min', { m }) : t('il y a {h} h {m}', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') }); };
  function freshness() {
    const bar = $('#netBar'); if (!bar) return;
    const stale = dataAt && Date.now() - dataAt > 60000;
    if (stale && (document.hidden || Date.now() - resumeAt < RESUME_GRACE)) return; // retour de l'arrière-plan : le temps de se reconnecter
    if (stale) { bar.hidden = false; bar.textContent = (navigator.onLine === false || !net.lite ? '📴 ' + t('Pas de réseau') : '📶 ' + t('Réseau très faible')) + ' · ' + t('dernière situation connue {ago}', { ago: agoTxt(dataAt) }); }
    else if (net.lite) { bar.hidden = false; bar.textContent = '📶 ' + t('Réseau faible : mode léger · mis à jour {ago}', { ago: dataAt ? agoTxt(dataAt) : '…' }); }
    else bar.hidden = true;
    bar.classList.toggle('stale', !!stale);
  }
  setInterval(freshness, 15000);

  let moveTimer = null;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => { sync(); streamWatch(); }, 400); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { resumeAt = Date.now(); failures = 0; sync(); streamWatch(); setTimeout(freshness, RESUME_GRACE + 500); }
    else { clearTimeout(pollTimer); streamClose(); }
  });
  // Réseau retrouvé (sortie de tunnel, mode avion coupé) : on resynchronise tout de suite
  window.addEventListener('online', () => { resumeAt = Date.now(); failures = 0; sync(); streamWatch(); });
  sync(); streamWatch();

  // ---- Alerte de proximité ----
  function proximity(r) {
    if (!me || !ALERT_CATS.has(r.cat) || hidden.has(CAT[r.cat].group)) return;
    const d = dist(me, [r.lat, r.lng]);
    const somm = r.cat === 'sommations';
    if (d > (somm ? 1000 : ALERT_RADIUS)) return; // les sommations alertent dans un rayon d'1 km
    const c = CAT[r.cat];
    const box = $('#alert');
    box.className = 'alert' + (c.group === 'fdo' || somm ? ' fdo' : '');
    box.textContent = c.glyph + ' ' + (somm ? t('Sommations à {d} : rester devient un délit. Éloigne-toi par une rue dégagée.', { d: fmtDist(d) }) : t('{what} à {d} de toi', { what: c.label, d: fmtDist(d) }));
    box.hidden = false;
    say(somm ? t('Sommations à {d}. Éloigne-toi par une rue dégagée.', { d: spokenDist(d) }) : t('{what}, à {d}', { what: c.label.replace(/\s*\/\s*/g, ', '), d: spokenDist(d) }));
    box.onclick = () => { box.hidden = true; const m = markerOf(r.id); if (m) layer.zoomToShowLayer(m, () => m.openPopup()); };
    // Chaque danger a sa vibration (même motif que dans les notifications)
    try { navigator.vibrate?.((cfg.vibes && cfg.vibes[r.cat]) || [200, 100, 200]); } catch {}
    clearTimeout(proximity.t); proximity.t = setTimeout(() => (box.hidden = true), 9000);
  }

