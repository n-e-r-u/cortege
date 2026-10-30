  // ---- Agenda : manifs, blocus, rassemblements, AG ----
  const EVT = Object.fromEntries((cfg.eventTypes || []).map(t => [t.id, t]));
  const evLayer = L.layerGroup().addTo(map);
  const evMarkers = new Map();
  let selectedEv = null;
  const fmtWhen = x => new Date(x).toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtHour = x => new Date(x).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
  // Sur la carte : les événements du moment (de 12 h avant à 10 h après le départ), plus celui choisi dans l'agenda
  // Masqués par le filtre « Agenda » sauf celui que la personne vient d'ouvrir dans l'agenda
  const evOnMap = e => e.id === selectedEv || (!evHidden && map.getZoom() >= 9 && e.start - 12 * 60 * MIN < Date.now() && e.start + 10 * 60 * MIN > Date.now());
  evCount = () => evCache.e.filter(e => map.getZoom() >= 9 && e.start - 12 * 60 * MIN < Date.now() && e.start + 10 * 60 * MIN > Date.now()).length;
  map.on('zoomend', () => { const z = map.getZoom() >= 9; if (z !== evOnMap.z) { evOnMap.z = z; renderEvents(); } });
  function evPopup(e) {
    const ty = EVT[e.type] || { glyph: '📍', label: '' };
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, ty.glyph + ' ', e.title));
    root.append(el('div', { class: 'pop-meta' }, `${ty.label} · ${fmtWhen(e.start)}`));
    root.append(el('div', { class: 'pop-meta' }, '📍 ' + e.place + (me ? ' · ' + fmtDist(dist(me, [e.lat, e.lng])) : '')));
    if (e.note) root.append(el('p', { class: 'pop-note' }, e.note));
    root.append(el('div', { class: 'pop-meta' }, t('Publié par {who}', { who: e.by })));
    if (e.link) root.append(el('a', { class: 'ann-link', href: e.link, target: '_blank', rel: 'noopener noreferrer' }, 'Voir la carte d’origine →'));
    if (orga && (orga.admin || (!!e.ob && e.ob === orga.ob))) {
      const rm = el('button', { class: 'danger' }, 'Retirer cet événement');
      rm.onclick = async () => {
        if (!rm.dataset.armed) { rm.dataset.armed = '1'; rm.textContent = t('Confirmer le retrait'); return; }
        try { await orgaFetch('/api/events/' + e.id, { method: 'DELETE' }); toast('Événement retiré'); map.closePopup(); sync(); } catch (err) { toast(err.message); }
      };
      root.append(el('div', { class: 'pop-actions orga', style: 'grid-template-columns:1fr' }, rm));
    }
    return root;
  }
  function renderEvents() {
    evLayer.clearLayers(); evMarkers.clear();
    for (const e of evCache.e.filter(evOnMap)) {
      const ty = EVT[e.type] || { glyph: '📍' };
      if (e.route) {
        L.polyline(e.route, { color: '#ec9fa4', weight: 5, opacity: .9, dashArray: '10 8', interactive: false }).addTo(evLayer);
        if (e.end) L.marker(e.route[e.route.length - 1], { icon: L.divIcon({ className: '', iconSize: [30, 30], html: '<div class="ev-end">🏁</div>' }), title: t('Dispersion prévue'), keyboard: false })
          .bindPopup(() => el('div', {}, t('Dispersion prévue : {title}', { title: e.title }))).addTo(evLayer);
      }
      const m = L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18], html: `<div class="ev-pin">${ty.glyph}</div>` }),
        title: e.title, zIndexOffset: 500 }).bindPopup(() => evPopup(e)).addTo(evLayer);
      evMarkers.set(e.id, m);
    }
    if (!$('#sheetAgenda').hidden) renderAgenda();
    try { drawFlow(); } catch {}
    renderFilters();
  }
  function renderAgenda() {
    const scope = document.querySelector('input[name="agScope"]:checked').value;
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    let list = evCache.e.filter(e => e.start + 3 * 60 * MIN > now);
    if (scope === 'near') list = list.filter(e => dist(ref, [e.lat, e.lng]) <= 50_000);
    list.sort((a, b) => a.start - b.start);
    const ol = $('#agList'); ol.textContent = '';
    $('#agEmpty').hidden = list.length > 0;
    $('#agEmpty').textContent = t(scope === 'all' ? 'Aucune mobilisation annoncée pour l’instant.'
      : me ? 'Rien d’annoncé à moins de 50 km de toi. Regarde « Toute la France ».' : 'Rien d’annoncé à moins de 50 km du centre de la carte. Active ta position ou regarde « Toute la France ».');
    let day = '';
    if (list.length > 200) ol.append(el('li', { class: 'ag-day' }, t('{n} événements : les 200 premiers', { n: list.length })));
    for (const e of list.slice(0, 200)) {
      const d = agDay(e, now);
      if (d !== day) { day = d; ol.append(el('li', { class: 'ag-day' }, d)); }
      ol.append(agRow(e, ref));
    }
  }
  const agDay = (e, now) => e.start < now ? t('En cours') : new Date(e.start).toLocaleDateString(I18N.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  function agRow(e, ref) {
    const ty = EVT[e.type] || { glyph: '📍' };
    const btn = el('button', { 'aria-label': e.title },
      el('span', { class: 'g', style: '--c:var(--accent)' }, ty.glyph),
      el('span', { class: 't' }, el('div', { class: 'l' }, e.title), el('div', { class: 's' }, `${fmtHour(e.start)} · ${e.place} · ${e.by}`)),
      el('span', { class: 'd' }, fmtDist(dist(ref, [e.lat, e.lng]))));
    btn.onclick = () => showEvent(e);
    return el('li', {}, btn);
  }
  // Infos : les 4 prochains événements à moins de 50 km
  function feedAgenda(ref) {
    const now = Date.now(), ol = $('#feedAg'); ol.textContent = '';
    const list = evCache.e.filter(e => e.start + 3 * 60 * MIN > now && dist(ref, [e.lat, e.lng]) <= 50_000).sort((a, b) => a.start - b.start).slice(0, 4);
    $('#feedAgEmpty').hidden = list.length > 0;
    let day = '';
    for (const e of list) { const d = agDay(e, now); if (d !== day) { day = d; ol.append(el('li', { class: 'ag-day' }, d)); } ol.append(agRow(e, ref)); }
  }
  function showEvent(e) {
    closeSheets(); setFollow(false);
    selectedEv = e.id; renderEvents();
    if (e.route) map.fitBounds(L.latLngBounds(e.route.concat([[e.lat, e.lng]])), { padding: [40, 40], maxZoom: 16 });
    else map.setView([e.lat, e.lng], 16);
    setTimeout(() => evMarkers.get(e.id)?.openPopup(), 350);
  }

