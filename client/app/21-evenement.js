  // ---- Publier (orga) ou proposer (tout le monde) un événement, avec parcours tracé sur la carte ----
  const draft = { route: [] };
  let evAsOrga = false, drawing = false;
  const drawLayer = L.layerGroup().addTo(map);
  (function buildEvTypes() {
    const box = $('#evTypes');
    (cfg.eventTypes || []).forEach((ty, i) => {
      const input = el('input', { type: 'radio', name: 'evType', value: ty.id }); input.checked = i === 0;
      box.append(el('label', {}, input, ' ' + ty.glyph + ' ' + ty.label));
    });
  })();
  const localInput = x => { const d = new Date(x); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function routeLength(r) { let m = 0; for (let i = 1; i < r.length; i++) m += map.distance(r[i - 1], r[i]); return m; }
  function redrawDraft() {
    drawLayer.clearLayers();
    const r = draft.route, n = r.length;
    if (n > 1) L.polyline(r, { color: '#ec9fa4', weight: 5, interactive: false }).addTo(drawLayer);
    r.forEach((p, i) => L.marker(p, { interactive: false, keyboard: false,
      icon: i === 0 ? L.divIcon({ className: '', iconSize: [38, 38], html: '<div class="ev-pin">📍</div>' }) : L.divIcon({ className: '', iconSize: [14, 14], html: '<div class="draw-pt"></div>' }) }).addTo(drawLayer));
    $('#drawCount').textContent = !n ? t('Aucun point') : n === 1 ? t('Rendez-vous placé') : tn(n - 1, 'Rendez-vous + {n} point de parcours', 'Rendez-vous + {n} points de parcours');
    $('#evRouteState').textContent = !n ? t('Touche la carte pour placer le rendez-vous, puis, si tu veux, les points du parcours.')
      : n === 1 ? t('Rendez-vous placé, sans parcours.') : t('Rendez-vous placé, parcours de {d}.', { d: fmtDist(routeLength(r)) });
    $('#btnDraw').textContent = t(n ? 'Modifier sur la carte' : 'Placer le rendez-vous sur la carte');
  }
  function openEventForm(asOrga) {
    closeReport(); closeSheets();
    evAsOrga = asOrga;
    $('#evTitle').textContent = t(asOrga ? 'Publier un événement' : 'Proposer une mobilisation');
    $('#evSubmit').textContent = t(asOrga ? 'Publier' : 'Envoyer la proposition');
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
  $('#btnAnnounce').onclick = () => openEventForm(!!orga);
  $('#btnOrganize').onclick = () => openEventForm(!!orga);
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

