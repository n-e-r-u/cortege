  // ---- Hors ligne : PWA + pré-chargement des tuiles de la zone ----
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Mise à jour en arrière-plan (Chrome Android, appli installée) : agenda, annonces et interface restent frais pour le hors-ligne
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(async reg => {
    if (!reg.periodicSync) return;
    try { const st = await navigator.permissions.query({ name: 'periodic-background-sync' }); if (st.state !== 'granted') return; } catch { return; }
    reg.periodicSync.register('cortege-refresh', { minInterval: 6 * 3600e3 }).catch(() => {});
  }).catch(() => {});
  // « Prêt pour la manif » : carte de la zone affichée, numéros de legal team, annonces et agenda gardés sur le téléphone.
  // La carte n'est préchargée que si elle vient de notre serveur (OpenStreetMap interdit le préchargement chez eux).
  if (!cfg.offlineTiles) {
    ['.tip-prefetch'].forEach(s => { const n = $(s); if (n) n.hidden = true; });
    const tip = $('.tip-browse'); if (tip) tip.hidden = false;
  }
  const readyInfo = () => { try { return JSON.parse(localStorage.getItem('cortege-ready') || 'null'); } catch { return null; } };
  const showReady = () => { const r = readyInfo(); if (r) $('#prefetchState').textContent = t('Dernière préparation : {date}', { date: new Date(r.at).toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + (r.city ? ', ' + r.city : '') }) + '.'; };
  showReady();
  $('#btnPrefetch').onclick = async () => {
    const state = $('#prefetchState'), btn = $('#btnPrefetch');
    if (btn.dataset.busy) return; btn.dataset.busy = '1';
    let tiles = 0, bytes = 0, failed = 0;
    try {
      if (cfg.offlineTiles) {
        const b = map.getBounds(), urls = [];
        const vec = !!cfg.vector, zmax = vec ? cfg.vector.maxzoom : 17;
        const z0 = Math.max(vec ? 8 : 13, Math.min(map.getZoom(), zmax) - 3), z1 = vec ? zmax : Math.min(18, z0 + 3);
        for (let z = z0; z <= z1; z++) {
          const nw = map.project(b.getNorthWest(), z).divideBy(256).floor();
          const se = map.project(b.getSouthEast(), z).divideBy(256).floor();
          for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) urls.push(vec ? `/vt/${z}/${x}/${y}.mvt` : `/tiles/${z}/${x}/${y}.png`);
        }
        if (urls.length > 2500) { state.textContent = t('Zone trop grande : zoome sur ta ville ou sur le parcours, puis réessaie.'); return; }
        for (let i = 0; i < urls.length; i += 6) {
          await Promise.all(urls.slice(i, i + 6).map(u => fetch(u).then(async r => { if (r.ok || r.status === 204) { tiles++; bytes += (await r.arrayBuffer()).byteLength; } else failed++; }).catch(() => failed++)));
          state.textContent = t('Carte : {n} / {total} morceaux…', { n: tiles, total: urls.length });
        }
      }
      state.textContent = t('Numéros, annonces, agenda et lieux…');
      await poiPrefetch().catch(() => {});
      const [legal, ann] = await Promise.all([getJ('/live/legal.json').catch(() => ({ l: [] })), getJ('/live/ann.json').catch(() => ({ a: [] })), getJ('/live/events.json').catch(() => null)]);
      if (legal && legal.l) legalCache = { h: legalCache.h, l: legal.l };
      if (ann && ann.a) annCache = { h: annCache.h, a: ann.a };
      await navigator.serviceWorker?.ready?.catch?.(() => {});
      const n = legalCache.l.length + annCache.a.filter(a => a.kind === 'legal').length;
      const near = nearestLegal();
      const size = bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' ' + t('Ko') : (bytes / 1048576).toFixed(1).replace('.', I18N.lang === 'en' ? '.' : ',') + ' ' + t('Mo');
      state.textContent = (cfg.offlineTiles ? t('Prêt : carte de la zone gardée ({size})', { size }) : t('Prêt'))
        + ', ' + tn(n, '{n} numéro de legal team', '{n} numéros de legal team') + (near && near.d < 80000 ? ' ' + t('(le plus proche : {phone})', { phone: near.phone }) : '') + ', ' + t('annonces et agenda.') + ' '
        + (failed ? t('{n} morceaux de carte n’ont pas pu être gardés, réessaie avec un meilleur réseau.', { n: failed }) : t('Si le réseau tombe, l’appli s’ouvrira quand même avec ces infos.'));
      try { localStorage.setItem('cortege-ready', JSON.stringify({ at: Date.now(), city: legalGroups()[0]?.d < 30000 ? legalGroups()[0].city : '' })); } catch {}
    } finally { delete btn.dataset.busy; }
  };
