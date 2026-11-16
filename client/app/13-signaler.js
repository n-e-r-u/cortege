  // ---- Signaler ----
  const sheets = ['#sheetLayers', '#sheetFeed', '#sheetPoi', '#sheetNews', '#sheetEmbed', '#sheetIdeas', '#sheetJoin', '#sheetReport', '#sheetList', '#sheetInfo', '#sheetSearch', '#sheetShare', '#sheetRights', '#sheetOrga', '#sheetAgenda', '#sheetEvent', '#sheetSos', '#sheetPrep', '#sheetQueue', '#sheetNotif', '#sheetOrd', '#sheetOrdNew', '#sheetMedic', '#sheetMedicHelp', '#sheetRec', '#sheetRecover', '#sheetSon'];
  const closeSheets = () => sheets.forEach(s => ($(s).hidden = true));
  // Fond assombri derrière les feuilles : un appui dessus ferme la feuille (sauf « Signaler », qui a besoin de la carte)
  const backdrop = $('#backdrop');
  // Pages des onglets (Infos, Droits, Plus) : plein écran au-dessus de la barre, sans fond assombri
  const PAGES = { tabInfos: '#sheetFeed', tabRights: '#sheetRights', tabMore: '#sheetInfo' };
  const isPage = s => Object.values(PAGES).includes(s);
  function syncTabs() {
    const open = Object.entries(PAGES).find(([, s]) => !$(s).hidden);
    for (const id of ['tabMap', ...Object.keys(PAGES)]) {
      const on = open ? open[0] === id : id === 'tabMap';
      if (on) $('#' + id).setAttribute('aria-current', 'page'); else $('#' + id).removeAttribute('aria-current');
    }
  }
  const syncBackdrop = () => {
    backdrop.hidden = !sheets.some(s => s !== '#sheetReport' && !isPage(s) && !$(s).hidden);
    if ($('#sheetEvent').hidden && !drawing) drawLayer.clearLayers();
    syncTabs();
  };
  const sheetWatch = new MutationObserver(syncBackdrop);
  sheets.forEach(s => sheetWatch.observe($(s), { attributes: true, attributeFilter: ['hidden'] }));
  backdrop.addEventListener('click', () => closeSheets());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { map.closePopup(); closeSheets(); if (!$('#crosshair').hidden) closeReport(); } });
  function openReport(at) {
    if (!at && !me && map.getZoom() < 14) {
      toast('Zoome sur l’endroit exact (ou active ta position) avant de signaler.');
      $('#btnSearch').focus();
      return;
    }
    closeSheets();
    $('#crosshair').hidden = false;
    reportBtn('active');
    $('#srHint').textContent = t(me ? 'Le viseur est sur ta position. Déplace la carte si c’est ailleurs.' : 'Place le viseur au bon endroit sur la carte, puis choisis.');
    $('#sheetReport').hidden = false;
    // Le viseur se place au milieu de la zone de carte encore visible au-dessus de la feuille
    const y = aimY();
    $('#crosshair').style.top = y + 'px';
    const spot = at || me;
    if (spot) { map.setView(spot, Math.max(map.getZoom(), 17), { animate: false }); map.panBy([0, map.getSize().y / 2 - y], { animate: false }); }
    if (at) $('#srHint').textContent = t('Le viseur est là où tu as appuyé. Déplace la carte si besoin, puis choisis.');
    catHints();
  }
  // Sous le viseur, un point du même type existe déjà : le bouton l'indique, et l'envoyer le confirmera
  function catHints() {
    if ($('#crosshair').hidden) return;
    const p = target(), list = [...reports.values()].map(x => x.data);
    document.querySelectorAll('#catGrid .cat').forEach(b => {
      const cat = b.dataset.cat, R = mergeR(cat);
      const hit = list.filter(r => r.cat === cat && r.exp > Date.now()).map(r => ({ r, d: dist(p, [r.lat, r.lng]) })).filter(x => x.d <= R).sort((a, b) => a.d - b.d)[0];
      b.classList.toggle('exists', !!hit);
      b.querySelector('.sub').textContent = hit ? t('déjà là · {ago} · confirmer', { ago: ago(hit.r.last || hit.r.t) }) : '';
      b.setAttribute('aria-label', CAT[cat].label + (hit ? t(', déjà signalé, appuyer pour confirmer') : ''));
    });
  }
  map.on('move', () => { if (!$('#crosshair').hidden) { cancelAnimationFrame(catHints.f); catHints.f = requestAnimationFrame(catHints); } });
  function aimY() {
    const top = 60, sheetTop = $('#sheetReport').getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
    return Math.round(top + (Math.min(sheetTop, map.getSize().y) - top) / 2);
  }
  function closeReport() {
    $('#crosshair').hidden = true; $('#sheetReport').hidden = true;
    if (famOpen) famBack();
    reportBtn(pausedUntil > Date.now() ? 'paused' : 'idle');
  }
  $('#btnReport').onclick = $('#mbReport').onclick = () => ($('#crosshair').hidden ? openReport() : closeReport());
  // Appui long sur la carte (ou clic droit sur ordinateur) : « Signaler » s'ouvre avec le viseur à cet endroit.
  // Rien ne part sans choisir une catégorie, et l'appui est annulé dès que le doigt glisse ou qu'un deuxième doigt zoome.
  {
    const box = map.getContainer(), HOLD = 550, SLOP = 12;
    let timer = null, start = null;
    const skip = el => document.body.classList.contains('drawing') || el.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control, .leaflet-interactive');
    const cancel = () => { clearTimeout(timer); timer = null; start = null; };
    const fire = (x, y) => {
      const r = box.getBoundingClientRect(), at = map.containerPointToLatLng([x - r.left, y - r.top]);
      try { navigator.vibrate?.(30); } catch {}
      map.closePopup(); openReport(at);
    };
    box.addEventListener('touchstart', e => {
      cancel();
      delete box.dataset.held;
      if (e.touches.length !== 1 || skip(e.target)) return;
      const tch = e.touches[0]; start = [tch.clientX, tch.clientY];
      timer = setTimeout(() => { const p = start; cancel(); if (p) { box.dataset.held = '1'; fire(p[0], p[1]); } }, HOLD);
    }, { passive: true });
    box.addEventListener('touchmove', e => { if (!start) return; const tch = e.touches[0]; if (e.touches.length > 1 || Math.hypot(tch.clientX - start[0], tch.clientY - start[1]) > SLOP) cancel(); }, { passive: true });
    box.addEventListener('touchend', cancel); box.addEventListener('touchcancel', cancel);
    map.on('zoomstart', cancel);
    // Clic droit à la souris ; sur téléphone, le menu natif de l'appui long est bloqué (l'appui est déjà géré ci-dessus)
    box.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (box.dataset.held) { delete box.dataset.held; return; }
      if (e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents || skip(e.target)) return;
      fire(e.clientX, e.clientY);
    });
  }
  $('#srClose').onclick = closeReport;

  // ---- Choix du type, comme sur Waze : une famille, puis la précision (2.20) ----
  // Premier écran : les urgences en un appui, puis 6 familles. Une famille qui a un type « par défaut » part sans préciser ;
  // les autres demandent la précision. Nombre et direction se donnent sur l'écran de précision, avant l'envoi.
  // Un type inconnu ici (profil d'un autre pays, type ajouté au serveur) va dans la famille de son groupe.
  const URGENT = ['charge', 'nasse', 'lacrymo'];
  const FAMILIES = [
    { id: 'police', glyph: '🚓', label: 'Police', def: 'police', group: 'fdo', cats: ['police', 'crs', 'bac', 'civil', 'inter', 'blinde', 'militaires'] },
    { id: 'gaz', glyph: '💨', label: 'Lacrymo et tirs', def: 'lacrymo', group: 'danger', cats: ['lacrymo', 'tirs', 'canon', 'sommations'] },
    { id: 'charge', glyph: '⚡', label: 'Charge et nasse', def: 'charge', group: 'danger', cats: ['charge', 'nasse', 'interpellation'] },
    { id: 'facho', glyph: '☠️', label: 'Fachos', def: 'facho', group: 'danger', cats: ['facho'] },
    { id: 'soutien', glyph: '⛑️', label: 'Soutien', def: null, group: 'soutien', cats: ['medic', 'eau', 'legal', 'presse', 'secours', 'calme'] },
    { id: 'cortege', glyph: '📣', label: 'Cortège et blocages', def: null, group: 'info', cats: ['cortege', 'queue', 'bloque', 'filtrage', 'station', 'blocus', 'occupation', 'chaud'] },
  ];
  const FAM_OF_GROUP = { fdo: 'police', danger: 'gaz', soutien: 'soutien', info: 'cortege' };
  for (const c of cfg.categories) {
    if (c.beaconOnly || FAMILIES.some(f => f.cats.includes(c.id))) continue;
    const f = FAMILIES.find(x => x.id === FAM_OF_GROUP[c.group]); if (f) f.cats.push(c.id);
  }
  const catOk = id => !!CAT[id] && !CAT[id].off && !CAT[id].beaconOnly && catHere(CAT[id]);
  let famOpen = null, famPick = { n: null, d: undefined }; // famille ouverte ; nombre et direction choisis avant l'envoi
  function catBtn(id, onPick) {
    const c = CAT[id];
    const b = el('button', { type: 'button', class: 'cat', 'data-cat': id, style: `--c:${GROUP_COLOR[c.group]}` }, el('span', { class: 'g', 'aria-hidden': 'true' }, c.glyph), c.label, el('span', { class: 'sub' }));
    b.onclick = () => onPick(id);
    return b;
  }
  (function buildGrid() {
    const grid = $('#catGrid');
    const home = el('div', { class: 'cat-home' });
    const urg = el('div', { class: 'row cat-urgent' });
    for (const id of URGENT) if (CAT[id]) urg.append(catBtn(id, submit));
    home.append(el('div', { class: 'group-title' }, 'Urgent'), urg, el('div', { class: 'group-title' }, 'Ou choisis'));
    const fams = el('div', { class: 'fam-grid' });
    for (const f of FAMILIES) {
      const b = el('button', { type: 'button', class: 'fam', 'data-fam': f.id, style: `--c:${GROUP_COLOR[f.group]}` }, el('span', { class: 'g', 'aria-hidden': 'true' }, f.glyph), f.label);
      b.onclick = () => openFamily(f.id);
      fams.append(b);
    }
    home.append(fams);
    grid.append(home, el('div', { class: 'cat-fam', hidden: '' }));
    catVis();
  })();
  // Types visibles : réglages de l'admin (types coupés) et profil du pays ; une famille sans type visible disparaît
  function catVis() {
    document.querySelectorAll('#catGrid .cat').forEach(b => { b.hidden = !catOk(b.dataset.cat); });
    document.querySelectorAll('#catGrid .fam').forEach(b => { b.hidden = !FAMILIES.find(f => f.id === b.dataset.fam).cats.some(catOk); });
  }
  function famBack() {
    famOpen = null;
    $('#catGrid .cat-home').hidden = false; $('#catGrid .cat-fam').hidden = true; $('#srHint').hidden = false; $('#catGrid .cat-fam').textContent = '';
    $('#srTitle').textContent = t('Qu’est-ce qui se passe ici ?');
    catHints();
  }
  function openFamily(id) {
    const f = FAMILIES.find(x => x.id === id), cats = f.cats.filter(catOk);
    if (!cats.length) return;
    famOpen = id; famPick = { n: null, d: undefined };
    const box = $('#catGrid .cat-fam'); box.textContent = '';
    $('#srTitle').textContent = f.glyph + ' ' + t(f.label);
    const back = el('button', { type: 'button', class: 'link-btn fam-back' }, '← ' + t('Retour'));
    back.onclick = famBack;
    box.append(back);
    // Nombre et direction (facultatifs) : seulement pour une famille qui a des groupes ou des véhicules qui bougent
    if (cats.some(c => COUNT_CAT.has(c))) {
      const pick = el('div', { class: 'count-pick', role: 'group', 'aria-label': t('Combien, environ ?') });
      for (const n of [1, 2, 3, 4]) {
        const b = el('button', { type: 'button', class: 'count-b', 'aria-pressed': 'false' }, t(COUNT_LBL[n]));
        b.onclick = () => { famPick.n = famPick.n === n ? null : n; pick.querySelectorAll('.count-b').forEach((x, i) => { x.classList.toggle('on', famPick.n === i + 1); x.setAttribute('aria-pressed', String(famPick.n === i + 1)); }); };
        pick.append(b);
      }
      box.append(el('div', { class: 'fam-opt' }, el('span', { class: 'fine' }, t('Combien, environ ?')), pick));
    }
    if (cats.some(c => DIR_CAT.has(c))) {
      const pick = el('div', { class: 'dir-pick dir-row', role: 'group', 'aria-label': t('Il se dirige vers…') });
      const NAMES = ['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'];
      for (const d of [6, 7, 0, 1, 2, 3, 4, 5, null]) {
        const b = el('button', { type: 'button', class: 'dir-b' + (d === null ? ' stop' : '') }, d === null ? '■' : el('span', { style: `--d:${d * 45}deg`, 'aria-hidden': 'true' }, '↑'));
        b.setAttribute('aria-label', d === null ? t('Ne bouge pas') : t('Vers {dir}', { dir: t(NAMES[d]) }));
        b.onclick = () => { famPick.d = famPick.d === d ? undefined : d; pick.querySelectorAll('.dir-b').forEach(x => x.classList.toggle('on', x === b && famPick.d === d)); };
        pick.append(b);
      }
      box.append(el('div', { class: 'fam-opt' }, el('span', { class: 'fine' }, t('Ça bouge ? Vers où :')), pick));
    }
    if (f.def && catOk(f.def) && cats.length > 1) {
      const go = el('button', { type: 'button', class: 'fam-send cat', 'data-cat': f.def, style: `--c:${GROUP_COLOR[f.group]}` }, el('span', { class: 'g', 'aria-hidden': 'true' }, CAT[f.def].glyph), t('Envoyer sans préciser'), el('span', { class: 'sub' }));
      go.onclick = () => submit(f.def, famPick);
      box.append(go, el('div', { class: 'group-title' }, 'Ou précise'));
    }
    const row = el('div', { class: 'row' });
    for (const c of cats) row.append(catBtn(c, x => submit(x, famPick)));
    box.append(row);
    $('#catGrid .cat-home').hidden = true; box.hidden = false; $('#srHint').hidden = true;
    $('#sheetReport').scrollTop = 0;
    catHints();
  }

  // Profil pays qui change (tu passes la frontière, ou tu regardes un autre pays) : noms et types disponibles mis à jour
  document.addEventListener('cortege-profile', () => {
    for (const b of document.querySelectorAll('#catGrid .cat:not(.fam-send)')) {
      const c = CAT[b.dataset.cat]; if (!c) continue;
      const tx = [...b.childNodes].find(n => n.nodeType === 3); if (tx) tx.nodeValue = c.label;
    }
    catVis();
    if (famOpen) openFamily(famOpen);
    if (typeof regroup === 'function') regroup();
  });
  // Point visé = position du viseur à l'écran
  const target = () => map.containerPointToLatLng([map.getSize().x / 2, aimY()]);
  // ---- File d'attente hors ligne ----
  // Un signalement fait sans réseau est gardé sur le téléphone avec son heure, puis envoyé dès que ça capte.
  // Le serveur le fusionne s'il existe déjà, et le refuse s'il a dépassé sa durée de vie.
  const queue = (() => {
    let mem = [], dbp = null;
    const open = () => dbp ||= new Promise((res, rej) => {
      const o = indexedDB.open('cortege', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('queue', { keyPath: 'k' });
      o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error);
    });
    const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('queue', mode), r = fn(t.objectStore('queue'));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    }));
    return {
      all: () => run('readonly', st => st.getAll()).then(x => x || []).catch(() => mem.slice()),
      add: it => run('readwrite', st => st.put(it)).catch(() => { mem.push(it); }),
      del: k => run('readwrite', st => st.delete(k)).catch(() => { mem = mem.filter(x => x.k !== k); }),
    };
  })();
  const rid = () => { const b = new Uint8Array(9); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); };
  // Signalements envoyés par ce téléphone (gardés sur le téléphone, 1 jour) : les retirer s'ils sont posés par erreur, ou les déplacer
  const sent = new Map((() => { try { return JSON.parse(localStorage.getItem('cortege-sent') || '[]'); } catch { return []; } })().filter(([, t0]) => Date.now() - t0 < 24 * 60 * MIN));
  const sentSave = () => { try { localStorage.setItem('cortege-sent', JSON.stringify([...sent].slice(-100))); } catch {} };
  function sentAdd(id) { sent.set(id, Date.now()); sentSave(); }
  async function ownSelf(id, body) {
    try {
      const res = await fetch(`/api/reports/${id}/self`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { if (res.status === 403 || res.status === 404) { sent.delete(id); sentSave(); } toast(out.error || 'Action impossible.'); return null; }
      if (out.removed || out.withdrawn) { sent.delete(id); sentSave(); }
      if (out.removed) drop(id); else if (out.id) upsert(out);
      regroup();
      toast(out.removed ? 'Signalement retiré' : out.withdrawn ? 'Ta voix est retirée, le point reste pour les autres' : 'Point déplacé');
      etag = null; sync();
      return out;
    } catch { toast('Pas de réseau.'); return null; }
  }
  // Déplacer son point : un repère à faire glisser, posé au-dessus de la carte le temps du geste
  function moveOwn(r) {
    map.closePopup();
    map.setView([r.lat, r.lng], Math.max(map.getZoom(), 17));
    const tmp = L.marker([r.lat, r.lng], { draggable: true, icon: icon(r, true), zIndexOffset: 1000 }).addTo(map);
    const done = () => { if (map.hasLayer(tmp)) map.removeLayer(tmp); };
    tmp.on('dragend', () => { const ll = tmp.getLatLng(); done(); ownSelf(r.id, { action: 'move', lat: ll.lat, lng: ll.lng }); });
    setTimeout(done, 60_000);
    toast('Fais glisser le point à sa place (150 m au plus)');
  }
  // Réponse inexploitable (pas de réseau, serveur hôte saturé sans message) : on garde pour plus tard
  async function postReport(it) {
    const headers = { 'Content-Type': 'application/json', 'X-Device': DEVICE };
    if (orga && !orga.trial && !orga.sponsored) headers['X-Orga-Key'] = orgaKey(); // orga confirmée : vérifié d'office, dure plus longtemps
    const res = await fetch('/api/reports', { method: 'POST', headers, body: JSON.stringify({ cat: it.cat, lat: it.lat, lng: it.lng, note: it.note, t: it.t }) });
    const body = await res.json().catch(() => null);
    if (body && body.mine && body.id) mineAdd(body.id);
    if (res.status === 201 && body && body.id) sentAdd(body.id); // envoyé par ce téléphone : il pourra le retirer ou le déplacer
    if (!body && res.status >= 500) throw new Error('indisponible');
    return { status: res.status, body: body || {} };
  }
  function resultText(it, { status, body }) {
    const label = CAT[it.cat].label;
    if (status === 201) return t(body.mine ? '{what} : signalé et vérifié (orga)' : '{what} : signalé', { what: label });
    if (status === 200 && body.merged) return body.self ? t('Tu l’avais déjà signalé : point mis à jour') : t('Déjà signalé : ta confirmation est ajoutée ({n} personnes)', { n: body.up + 1 });
    return t(body.error || 'Envoi impossible. Réessaie.');
  }
  async function updateQueueChip() {
    const n = (await queue.all()).length, chip = $('#queueChip');
    chip.hidden = !n; chip.textContent = `⏳ ${n}`;
    chip.setAttribute('aria-label', tn(n, '{n} signalement en attente de réseau', '{n} signalements en attente de réseau'));
    if (!$('#sheetQueue').hidden) renderQueue();
    return n;
  }
  async function renderQueue() {
    const ol = $('#queueList'); ol.textContent = '';
    const items = (await queue.all()).sort((a, b) => a.t - b.t);
    $('#queueEmpty').hidden = items.length > 0;
    for (const it of items) {
      const c = CAT[it.cat], expired = it.t + c.ttl * MIN <= Date.now();
      const cancel = el('button', { class: 'q-cancel', 'aria-label': 'Annuler ce signalement' }, 'Annuler');
      cancel.onclick = async () => { await queue.del(it.k); updateQueueChip(); };
      ol.append(el('li', {}, el('span', { class: 'g', style: `--c:${GROUP_COLOR[c.group]}` }, c.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, c.label), el('div', { class: 's' }, expired ? 'Trop ancien, ne sera pas publié' : t('fait {ago}', { ago: ago(it.t) }))), cancel));
    }
  }
  let flushing = false;
  async function flushQueue(manual = false) {
    if (flushing) return;
    flushing = true;
    let sent = 0, stale = 0, msg = '';
    try {
      for (const it of (await queue.all()).sort((a, b) => a.t - b.t)) {
        if (it.t + CAT[it.cat].ttl * MIN <= Date.now()) { await queue.del(it.k); stale++; continue; }
        let out;
        try { out = await postReport(it); } catch { if (manual) msg = 'Toujours pas de réseau.'; break; }
        await queue.del(it.k);
        if (out.status === 410) stale++;
        else if (out.status < 300) { sent++; voted.add(out.body.id); }
        else msg = out.body.error || '';
      }
    } finally { flushing = false; }
    const n = await updateQueueChip();
    const parts = [];
    if (sent) parts.push(tn(sent, 'Signalement en attente envoyé', '{n} signalements en attente envoyés'));
    if (stale) parts.push(tn(stale, '1 trop ancien, pas publié', '{n} trop anciens, pas publiés'));
    if (parts.length || msg) toast(parts.join(' · ') || msg);
    if (sent) { lastActivity = Date.now(); sync(); }
    return n;
  }
  async function submit(cat, pick = null) {
    const p = target();
    const it = { k: rid(), cat, lat: p.lat, lng: p.lng, note: '', t: Date.now(), dev: DEVICE, ttl: CAT[cat].ttl * MIN };
    let out;
    try { out = await postReport(it); }
    catch {
      await queue.add(it);
      closeReport();
      updateQueueChip();
      // Android : le téléphone l'enverra même appli fermée ; ailleurs, au retour du réseau ou à la réouverture
      try { (await navigator.serviceWorker?.ready)?.sync?.register('cortege-queue').catch(() => {}); } catch {}
      return toast('Pas de réseau : signalement gardé, il partira dès que ça capte.');
    }
    if (out.status >= 300) return toast(resultText(it, out));
    voted.add(out.body.id);
    closeReport();
    lastActivity = Date.now();
    // Nombre et direction choisis sur l'écran de précision : envoyés tout de suite au point créé (ou confirmé)
    const given = { n: !!(pick && pick.n && COUNT_CAT.has(cat)), d: !!(pick && pick.d !== undefined && DIR_CAT.has(cat)) };
    if (given.n) fetch(`/api/reports/${out.body.id}/count`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify({ c: pick.n }) }).then(() => sync()).catch(() => {});
    if (given.d) fetch(`/api/reports/${out.body.id}/dir`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify({ d: pick.d }) }).then(() => sync()).catch(() => {});
    sync();
    openNoteCard(out.body.id, cat, resultText(it, out), given);
  }
