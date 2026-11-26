  // ---- Agenda : manifs, blocus, rassemblements, AG ----
  const EVT = Object.fromEntries((cfg.eventTypes || []).map(t => [t.id, t]));
  const evLayer = L.layerGroup().addTo(map);           // parcours et points de dispersion (une grappe n'accepte que des marqueurs)
  // Épingles regroupées au dézoom : au zoom région, sept jours de mobilisations faisaient une forêt d'épingles
  const evPins = L.markerClusterGroup({
    maxClusterRadius: z => (z >= 13 ? 24 : 70), disableClusteringAtZoom: 15, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    iconCreateFunction: cluster => {
      const n = cluster.getChildCount(), size = n < 10 ? 38 : n < 100 ? 46 : 54;
      return L.divIcon({ className: '', iconSize: [size, size], html: `<div class="cluster ev" style="--c:var(--accent);width:${size}px;height:${size}px">${n}</div>` });
    },
  }).addTo(map);
  const evMarkers = new Map();
  let selectedEv = null;
  const fmtWhen = x => new Date(x).toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtHour = x => new Date(x).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
  // Sur la carte : les événements des 7 jours qui viennent (jusqu'à 10 h après le départ), dès le zoom région,
  // plus celui choisi dans l'agenda. Avant, il fallait attendre 12 h avant le départ et zoomer sur le quartier.
  // Masqués par le filtre « Agenda » sauf celui que la personne vient d'ouvrir dans l'agenda.
  const EV_AHEAD = 7 * 24 * 60 * MIN, EV_ZOOM = 6, EV_MAX = 60;
  const evOnMap = e => e.id === selectedEv || (!evHidden && map.getZoom() >= EV_ZOOM && e.start - EV_AHEAD < Date.now() && e.start + 10 * 60 * MIN > Date.now());
  map.on('zoomend', () => { const z = map.getZoom() >= EV_ZOOM; if (z !== evOnMap.z) { evOnMap.z = z; renderEvents(); } });
  // Au zoom région, sept jours d'événements peuvent faire des centaines d'épingles : on garde les plus proches
  // du centre de la carte, et toujours celui qui est ouvert.
  function evShown() {
    const list = evCache.e.filter(evOnMap);
    if (list.length <= EV_MAX) return list;
    const c = map.getCenter();
    return list.slice().sort((a, b) => (b.id === selectedEv) - (a.id === selectedEv)
      || dist([c.lat, c.lng], [a.lat, a.lng]) - dist([c.lat, c.lng], [b.lat, b.lng])).slice(0, EV_MAX);
  }
  function evPopup(e) {
    const ty = EVT[e.type] || { glyph: '📍', label: '' };
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, ty.glyph + ' ', e.title));
    root.append(el('div', { class: 'pop-meta' }, `${ty.label} · ${fmtWhen(e.start)}`));
    root.append(el('div', { class: 'pop-meta' }, '📍 ' + e.place + (me ? ' · ' + fmtDist(dist(me, [e.lat, e.lng])) : '')));
    if (e.note) root.append(el('p', { class: 'pop-note' }, e.note));
    // Arrêté qui interdit la manif ou un périmètre qu'elle traverse : dit clairement, avec le texte officiel
    const ban = ordBan?.(e);
    // La zone connue est la commune ou le département entier : le texte dit seulement qu'un arrêté s'applique ici, à lire pour savoir ce qu'il couvre
    if (ban) root.append(el('div', { class: 'pop-calm-warn' }, (ban.items.some(x => x.k === 'manif') ? '🚫 ' + t('Arrêté d’interdiction de manifester en vigueur ici') : '⛔ ' + t('Arrêté avec un périmètre interdit en vigueur ici')) + ' (' + ban.name + '). ' + t('Lis-le pour savoir exactement ce qu’il couvre.'),
      ban.src ? el('div', {}, el('a', { href: ban.src, target: '_blank', rel: 'noopener noreferrer' }, t('Lire l’arrêté') + ' →')) : ''));
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
    evLayer.clearLayers(); evPins.clearLayers(); evMarkers.clear();
    for (const e of evShown()) {
      const ty = EVT[e.type] || { glyph: '📍' };
      if (e.route) {
        L.polyline(e.route, { color: themeCol('--route', '#f6a29c'), weight: 5, opacity: .9, dashArray: '10 8', interactive: false }).addTo(evLayer);
        if (e.end) L.marker(e.route[e.route.length - 1], { icon: L.divIcon({ className: '', iconSize: [30, 30], html: '<div class="ev-end">🏁</div>' }), title: t('Dispersion prévue'), keyboard: false })
          .bindPopup(() => el('div', {}, t('Dispersion prévue : {title}', { title: e.title }))).addTo(evLayer);
      }
      const m = L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18], html: `<div class="ev-pin">${ty.glyph}</div>` }),
        title: e.title, zIndexOffset: 500 }).bindPopup(() => evPopup(e)).addTo(evPins);
      evMarkers.set(e.id, m);
    }
    if (!$('#sheetAgenda').hidden) renderAgenda();
    try { drawFlow(); } catch {}
    renderFilters();
  }
  // Thème changé (réglage, système ou mode manif) : les parcours prennent la couleur du nouveau thème
  window.addEventListener('cortege-theme', () => { try { renderEvents(); drawFlow(); } catch {} });
  // ---- Agenda : filtres, calendrier du mois, puis la liste ----
  // Repris de la proposition de 22eme-Arkane (branche refonte-interface), y compris la correction du week-end le dimanche.
  // Plus de rayon de 50 km par défaut : il se calculait depuis le centre de la carte et pouvait cacher des manifs proches.
  let agWhen = 'all', agSel = null, agCal = false;
  // Autour de soi : actif par défaut dès que la position est connue. Le rayon part de la position de la personne,
  // jamais du centre de la carte (c'était le défaut de l'ancien filtre : il cachait des manifs proches quand on
  // regardait ailleurs sur la carte).
  const AG_NEAR_M = 50_000;
  let agNear = true;
  const agTypes = new Set();
  const dayKey = x => { const d = new Date(x); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function agWhenOk(e) {
    const now = new Date(), day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (agWhen === 'today') return e.start < day0 + 864e5;
    if (agWhen === 'week') return e.start < day0 + 7 * 864e5;
    // Le dimanche, « ce week-end » se réduit à aujourd'hui : calculer le samedi suivant faisait sauter le jour même
    if (agWhen === 'weekend') {
      const wd = now.getDay(), sat = wd === 0 ? day0 : day0 + (6 - wd) * 864e5;
      return e.start >= Math.min(sat, day0) && e.start < (wd === 0 ? day0 + 864e5 : sat + 2 * 864e5);
    }
    return true;
  }
  function renderAgChips() {
    const box = $('#agFilters'); if (!box) return;
    box.textContent = '';
    const chip = (label, on, fn) => {
      const b = el('button', { type: 'button', class: 'ag-chip' + (on ? ' on' : ''), 'aria-pressed': String(on) }, label);
      b.onclick = () => { fn(); agSel = null; renderAgenda(); };
      return b;
    };
    if (me) {
      const where = el('div', { class: 'ag-chips', role: 'group', 'aria-label': t('Où') });
      where.append(chip(t('Autour de moi'), agNear, () => { agNear = true; }), chip(t('Partout'), !agNear, () => { agNear = false; }));
      box.append(where);
    }
    const when = el('div', { class: 'ag-chips', role: 'group', 'aria-label': t('Quand') });
    for (const [k, l] of [['all', 'Tout'], ['today', 'Aujourd’hui'], ['weekend', 'Ce week-end'], ['week', '7 jours']])
      when.append(chip(t(l), agWhen === k, () => { agWhen = k; }));
    const what = el('div', { class: 'ag-chips', role: 'group', 'aria-label': t('Quoi') });
    for (const ty of Object.values(EVT))
      what.append(chip(ty.glyph + ' ' + t(ty.label), agTypes.has(ty.id), () => { agTypes.has(ty.id) ? agTypes.delete(ty.id) : agTypes.add(ty.id); }));
    box.append(when, what);
  }
  // Calendrier du mois : une pastille les jours qui ont quelque chose, un appui filtre la liste sur ce jour.
  // Replié par défaut : la liste du jour compte plus que la grille.
  function renderCal(list) {
    const box = $('#agCal'), tog = $('#agCalToggle');
    if (!box || !tog) return;
    box.hidden = !agCal;
    tog.setAttribute('aria-expanded', String(agCal));
    tog.textContent = (agCal ? '▾ ' : '▸ ') + t('Calendrier du mois');
    if (!agCal) return;
    box.textContent = '';
    const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1);
    const days = new Set(list.map(e => dayKey(e.start)));
    box.append(el('div', { class: 'cal-head' }, first.toLocaleDateString(I18N.locale, { month: 'long', year: 'numeric' })));
    const grid = el('div', { class: 'cal-grid' });
    // En-tête des jours, dans la langue de l'appli : sans elle, on ne sait pas quelle colonne est quel jour
    for (let k = 0; k < 7; k++) {
      const d = new Date(2024, 0, 1 + k);   // 1er janvier 2024 était un lundi
      grid.append(el('abbr', { class: 'cal-wd', title: d.toLocaleDateString(I18N.locale, { weekday: 'long' }) },
        d.toLocaleDateString(I18N.locale, { weekday: 'narrow' })));
    }
    // Première colonne : lundi (le tableau commence au jour 1 du mois)
    const shift = (first.getDay() + 6) % 7;
    for (let k = 0; k < shift; k++) grid.append(el('span', { class: 'cal-pad', 'aria-hidden': 'true' }));
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const date = new Date(now.getFullYear(), now.getMonth(), d), key = dayKey(date);
      const past = d < now.getDate(), has = days.has(key);
      if (!has) { grid.append(el('span', { class: 'cal-day' + (past ? ' past' : '') }, String(d))); continue; }
      const b = el('button', { type: 'button', class: 'cal-day has' + (agSel === key ? ' on' : ''), 'aria-pressed': String(agSel === key) },
        String(d), el('i', { class: 'cal-dot', 'aria-hidden': 'true' }));
      b.setAttribute('aria-label', date.toLocaleDateString(I18N.locale, { weekday: 'long', day: 'numeric', month: 'long' }));
      b.onclick = () => { agSel = agSel === key ? null : key; renderAgenda(); };
      grid.append(b);
    }
    box.append(grid);
  }
  function renderAgenda() {
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    renderAgChips();
    let list = evCache.e.filter(e => e.start + 3 * 60 * MIN > now);
    if (me && agNear) list = list.filter(e => dist(me, [e.lat, e.lng]) <= AG_NEAR_M);
    if (agTypes.size) list = list.filter(e => agTypes.has(e.type));
    renderCal(list);                       // le calendrier montre le mois entier, avant le filtre « quand »
    list = list.filter(agWhenOk);
    if (agSel) list = list.filter(e => dayKey(e.start) === agSel);
    list.sort((a, b) => a.start - b.start || dist(ref, [a.lat, a.lng]) - dist(ref, [b.lat, b.lng]));
    const ol = $('#agList'); ol.textContent = '';
    $('#agEmpty').hidden = list.length > 0;
    $('#agEmpty').textContent = agSel ? t('Rien d’annoncé ce jour-là.')
      : me && agNear ? t('Rien d’annoncé à moins de 50 km de toi. Appuie sur « Partout » pour voir le reste.')
      : agWhen !== 'all' || agTypes.size ? t('Rien d’annoncé avec ces filtres.')
      : t('Aucune mobilisation annoncée pour l’instant.');
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
      el('span', { class: 't' }, el('div', { class: 'l' }, e.title), el('div', { class: 's' }, `${fmtHour(e.start)} · ${e.place} · ${e.by}`),
        ordBan?.(e) ? el('div', { class: 's ag-ban' }, '🚫 ' + t('Arrêté en vigueur dans la zone')) : ''),
      el('span', { class: 'd' }, fmtDist(dist(ref, [e.lat, e.lng]))));
    btn.onclick = () => showEvent(e);
    return el('li', {}, btn);
  }
  function showEvent(e) {
    closeSheets(); setFollow(false);
    selectedEv = e.id; renderEvents();
    if (e.route) map.fitBounds(L.latLngBounds(e.route.concat([[e.lat, e.lng]])), { padding: [40, 40], maxZoom: 16 });
    else map.setView([e.lat, e.lng], 16);
    setTimeout(() => { const m = evMarkers.get(e.id); if (m) evPins.zoomToShowLayer(m, () => m.openPopup()); }, 350);
  }

