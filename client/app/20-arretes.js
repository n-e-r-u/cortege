  // ---- Arrêtés et restrictions : bandeau quand on regarde la zone ou qu'on s'y trouve ----
  var ordState = null, syncOrd = null;
  {
    const S = ordState = { h: null, o: [], hidden: new Set(), layer: L.layerGroup().addTo(map), timer: null, later: () => { clearTimeout(S.timer); S.timer = setTimeout(renderOrdBar, 400); } };
    try { S.hidden = new Set(JSON.parse(sessionStorage.getItem('cortege-ord-hidden') || '[]')); } catch {}
    const OK = Object.fromEntries((cfg.orderKinds || []).map(k => [k.id, k]));
    const kindOf = k => OK[k] || { glyph: 'ℹ', label: t('Information') };
    // Point dans une zone (anneaux GeoJSON [lng, lat], trous compris)
    const inRing = (lng, lat, r) => { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
    const inZone = (o, lat, lng) => !!o.b && lat >= o.b[0] && lat <= o.b[2] && lng >= o.b[1] && lng <= o.b[3] && o.p.some(poly => inRing(lng, lat, poly[0]) && !poly.slice(1).some(h => inRing(lng, lat, h)));
    const day = x => new Date(x).toLocaleDateString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short' });
    const hour = x => { const d = new Date(x); return I18N.lang === 'fr' ? d.getHours() + ' h' + (d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : '') : d.toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' }); };
    const fmtD = x => t('{day} à {hour}', { day: day(x), hour: hour(x) });
    const span = o => o.start <= Date.now() ? t('jusqu’au {date}', { date: fmtD(o.end) }) : day(o.start) === day(o.end) ? t('{day} de {from} à {to}', { day: day(o.start), from: hour(o.start), to: hour(o.end) }) : t('du {from} au {to}', { from: fmtD(o.start), to: fmtD(o.end) });
    const where = o => o.scope === 'dep' ? t('{name} (tout le département)', { name: o.name }) : o.name;
    // Mesures à afficher : en cours ou qui commencent dans les 4 jours
    const current = () => { const now = Date.now(); return S.o.filter(o => o.end > now && o.start < now + 4 * 24 * 3600e3); };
    const here = () => {
      const c = map.getCenter(), z = map.getZoom();
      const now = Date.now();
      // En vigueur d'abord, puis le plus précis (commune avant département), puis le plus proche dans le temps
      return current().filter(o => (me && inZone(o, me[0], me[1])) || (z >= 9 && inZone(o, c.lat, c.lng)))
        .sort((a, b) => ((b.start <= now) - (a.start <= now)) || ((a.scope === 'dep') - (b.scope === 'dep')) || a.start - b.start);
    };
    syncOrd = async h => {
      if (!h || h === S.h) { if (!h && S.o.length) { S.o = []; S.h = null; renderOrdBar(); } return; }
      try { S.o = (await getJ('/live/ord.json')).o || []; S.h = h; renderOrdBar(); } catch {}
    };
    function renderOrdBar() {
      feedBadge();
      const box = $('#ordBar'), list = here().filter(o => !S.hidden.has(o.id));
      box.textContent = ''; box.hidden = !list.length;
      if (!list.length) return;
      const o = list[0], live = o.start <= Date.now();
      const close = el('button', { class: 'ann-x', 'aria-label': 'Masquer ce bandeau' }, '×');
      close.onclick = e => { e.stopPropagation(); list.forEach(x => S.hidden.add(x.id)); try { sessionStorage.setItem('cortege-ord-hidden', JSON.stringify([...S.hidden])); } catch {} renderOrdBar(); };
      const bar = el('div', { class: 'ann ord' + (live ? ' live' : ''), role: 'button', tabindex: '0' },
        el('div', { class: 'ann-meta' }, (live ? '⚠ ' + t('Arrêté en vigueur') : '📅 ' + t('Arrêté à venir')) + ' · ' + where(o) + (list.length > 1 ? ' · ' + tn(list.length - 1, '+{n} autre', '+{n} autres') : '')),
        el('div', { class: 'ann-text' }, o.items.map(x => kindOf(x.k).glyph + ' ' + x.text).join('  ·  ')),
        el('div', { class: 'ann-meta' }, span(o) + ' · ' + t('touche pour les détails')), close);
      bar.onclick = () => openOrders(list.map(x => x.id));
      bar.onkeydown = e => { if (e.key === 'Enter') bar.onclick(); };
      box.append(bar);
    }

    map.on('moveend', () => S.later());
    setInterval(renderOrdBar, 60_000);
    function showZone(o) {
      S.layer.clearLayers();
      const shape = L.polygon(o.p.map(poly => poly.map(r => r.map(([x, y]) => [y, x]))), { color: '#f0a020', weight: 2, dashArray: '6 6', fillOpacity: 0.06, interactive: false }).addTo(S.layer);
      closeSheets(); map.fitBounds(shape.getBounds(), { padding: [30, 30] });
      setTimeout(() => S.layer.clearLayers(), 20_000);
    }
    function orderCard(o, isHere) {
      const card = el('article', { class: 'ord-card' + (isHere ? ' here' : '') },
        el('h3', {}, (o.start <= Date.now() ? '⚠ ' : '📅 ') + where(o)),
        el('p', { class: 'fine' }, span(o)));
      const ul = el('ul', { class: 'ord-items' });
      for (const x of o.items) { const k = kindOf(x.k); ul.append(el('li', {}, el('span', { 'aria-hidden': 'true' }, k.glyph), el('span', {}, el('b', {}, k.label + (I18N.lang === 'fr' ? ' : ' : ': ')), x.text))); }
      card.append(ul);
      const zone = el('button', { class: 'secondary' }, 'Voir la zone sur la carte'); zone.onclick = () => showZone(o);
      card.append(el('p', { class: 'fine' }, t('Source :') + ' ', el('a', { href: o.src, target: '_blank', rel: 'noopener noreferrer' }, o.host || t('ouvrir')), o.ok ? ' · ' + t('vérifié le {date}', { date: new Date(o.ok).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'long' }) }) : ''), zone);
      return card;
    }
    S.here = here; S.card = orderCard; S.count = () => current().length;
    function openOrders(ids) {
      closeReport(); closeSheets();
      const box = $('#ordList'); box.textContent = '';
      const inHere = new Set((ids || here().map(o => o.id)));
      const list = current().sort((a, b) => (inHere.has(b.id) - inHere.has(a.id)) || a.start - b.start);
      $('#ordEmpty').hidden = !!list.length;
      const near = list.filter(o => inHere.has(o.id)), far = list.filter(o => !inHere.has(o.id));
      if (near.length) { box.append(el('h3', { class: 'menu-group' }, 'Ici')); near.forEach(o => box.append(orderCard(o))); }
      if (far.length) { box.append(el('h3', { class: 'menu-group' }, near.length ? 'Ailleurs en France' : 'En France')); far.forEach(o => box.append(orderCard(o))); }
      $('#sheetOrd').hidden = false;
    }
    $('#btnOrders').onclick = () => openOrders();
    $('#ordClose').onclick = () => closeSheets();
    // Proposition : comme pour l'agenda, vérifiée par l'admin avant d'apparaître
    const dep = $('#ordDep');
    dep.append(el('option', { value: '' }, 'Choisir…'));
    for (const [c, n] of cfg.deps || []) dep.append(el('option', { value: c }, `${c} · ${n}`));
    const addItem = (k = 'manif') => {
      const sel = el('select', { 'aria-label': 'Type de mesure' }); for (const x of cfg.orderKinds || []) sel.append(el('option', { value: x.id }, x.glyph + ' ' + x.label)); sel.value = k;
      const txt = el('input', { maxlength: '220', placeholder: 'ex. : la manifestation de samedi est interdite', 'aria-label': 'Mesure' });
      $('#ordItems').append(el('div', { class: 'ord-item' }, sel, txt));
      $('#ordAddItem').hidden = $('#ordItems').children.length >= 8;
    };
    $('#ordAddItem').onclick = () => addItem('consigne');
    $('#btnOrdPropose').onclick = () => {
      closeSheets();
      if (!$('#ordItems').children.length) { addItem('manif'); addItem('couvre'); }
      // Département deviné d'après la zone affichée
      if (!dep.value) { const c = map.getCenter(); const d = S.o.find(o => o.scope === 'dep' && inZone(o, c.lat, c.lng)); if (d) dep.value = d.dep; }
      $('#sheetOrdNew').hidden = false;
    };
    $('#ordNewClose').onclick = () => closeSheets();
    $('#ordForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const items = [...$('#ordItems').children].map(r => ({ k: r.querySelector('select').value, text: r.querySelector('input').value.trim() })).filter(x => x.text);
      if (!items.length) return toast('Décris au moins une mesure.');
      const start = new Date($('#ordStart').value).getTime(), end = new Date($('#ordEnd').value).getTime();
      if (!start || !end) return toast('Indique le début et la fin.');
      const body = { dep: dep.value, commune: $('#ordCommune').value, start, end, items, src: $('#ordSrc').value };
      try {
        const res = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) return toast(out.error || 'Envoi impossible.');
        toast('Merci ! L’arrêté apparaîtra une fois la source vérifiée.');
        $('#ordForm').reset(); $('#ordItems').textContent = ''; closeSheets();
      } catch { toast('Pas de réseau : réessaie plus tard.'); }
    });
  }
  $('#btnAgenda').onclick = () => { closeReport(); closeSheets(); renderAgenda(); $('#sheetAgenda').hidden = false; };
  $('#agClose').onclick = () => closeSheets();
  document.querySelectorAll('input[name="agScope"]').forEach(r => r.addEventListener('change', renderAgenda));

