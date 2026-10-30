  // ---- Signaler ----
  const sheets = ['#sheetLayers', '#sheetFeed', '#sheetPoi', '#sheetNews', '#sheetEmbed', '#sheetJoin', '#sheetReport', '#sheetList', '#sheetInfo', '#sheetSearch', '#sheetShare', '#sheetRights', '#sheetOrga', '#sheetAgenda', '#sheetEvent', '#sheetSos', '#sheetPrep', '#sheetQueue', '#sheetNotif', '#sheetOrd', '#sheetOrdNew'];
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
  function openReport() {
    if (!me && map.getZoom() < 14) {
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
    if (me) { map.setView(me, Math.max(map.getZoom(), 17), { animate: false }); map.panBy([0, map.getSize().y / 2 - y], { animate: false }); }
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
    reportBtn(pausedUntil > Date.now() ? 'paused' : 'idle');
  }
  $('#btnReport').onclick = $('#mbReport').onclick = () => ($('#crosshair').hidden ? openReport() : closeReport());
  $('#srClose').onclick = closeReport;

  (function buildGrid() {
    const grid = $('#catGrid');
    for (const g of cfg.groups) {
      grid.append(el('div', { class: 'group-title' }, g.label));
      const row = el('div', { class: 'row' });
      for (const c of cfg.categories.filter(c => c.group === g.id && !c.beaconOnly)) {
        const b = el('button', { class: 'cat', 'data-cat': c.id, style: `--c:${GROUP_COLOR[g.id]}` }, el('span', { class: 'g', 'aria-hidden': 'true' }, c.glyph), c.label, el('span', { class: 'sub' }));
        if (c.off) b.hidden = true;
        b.onclick = () => submit(c.id);
        row.append(b);
      }
      grid.append(row);
    }
  })();

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
  // Réponse inexploitable (pas de réseau, serveur hôte saturé sans message) : on garde pour plus tard
  async function postReport(it) {
    const headers = { 'Content-Type': 'application/json', 'X-Device': DEVICE };
    if (orga && !orga.trial && !orga.sponsored) headers['X-Orga-Key'] = orgaKey(); // orga confirmée : vérifié d'office, dure plus longtemps
    const res = await fetch('/api/reports', { method: 'POST', headers, body: JSON.stringify({ cat: it.cat, lat: it.lat, lng: it.lng, note: it.note, t: it.t }) });
    const body = await res.json().catch(() => null);
    if (body && body.mine && body.id) mineAdd(body.id);
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
  async function submit(cat) {
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
    sync();
    openNoteCard(out.body.id, cat, resultText(it, out));
  }
