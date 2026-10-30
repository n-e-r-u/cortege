  // ---- Mes droits : numéros des legal teams ----
  // Deux sources : l'annuaire permanent (vérifié par l'admin) et les numéros publiés par les orgas pour une manif.
  // Regroupés par ville, la plus proche de toi (ou du centre de la carte) en premier ; les autres villes en dessous.
  const normCity = c => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const dayFr = x => new Date(x).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const kmTxt = m => m < 1000 ? t('ici') : t('à {d} km', { d: m < 10000 ? (m / 1000).toFixed(1).replace('.', I18N.lang === 'en' ? '.' : ',') : Math.round(m / 1000) });
  function legalGroups() {
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    const rows = [
      ...legalCache.l.map(e => ({ ...e, dir: true })),
      ...annCache.a.filter(a => a.kind === 'legal' && a.exp > now && !a.pending)
        .map(a => ({ id: a.id, city: a.city || '', lat: a.lat, lng: a.lng, name: a.by, phone: a.phone, text: a.text, t: a.t, dir: false })),
    ];
    const groups = new Map();
    for (const e of rows) {
      const d = map.distance(ref, [e.lat, e.lng]);
      const key = normCity(e.city) || '@' + e.id;
      const g = groups.get(key) || { city: e.city || t('Autour de ce point'), d: Infinity, items: [] };
      g.items.push({ ...e, d }); groups.set(key, g);
    }
    // Distance d'une ville : celle de l'annuaire s'il la connaît (un numéro de manif peut avoir été posé loin de sa ville)
    for (const g of groups.values()) { const ref = g.items.some(x => x.dir) ? g.items.filter(x => x.dir) : g.items; g.d = Math.min(...ref.map(x => x.d)); }
    // Dans une ville : l'annuaire d'abord, puis les numéros de manif (les plus récents en premier)
    for (const g of groups.values()) g.items.sort((a, b) => (b.dir - a.dir) || (b.t || 0) - (a.t || 0));
    return [...groups.values()].sort((a, b) => a.d - b.d);
  }
  function legalRow(a, compact) {
    const num = a.phone;
    const call = el('a', { class: 'legal-call', href: 'tel:' + num.replace(/[^\d+]/g, '') }, 'Appeler');
    const copy = el('button', { class: 'legal-copy' }, 'Copier');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(num); toast('Numéro copié'); } catch { toast(num); } };
    const meta = a.dir
      ? el('span', { class: 'legal-meta' }, t('Annuaire') + (a.checked ? ' · ' + t('vérifié le {date}', { date: dayFr(a.checked) }) : ''),
          a.src ? el('a', { href: a.src, target: '_blank', rel: 'noopener noreferrer' }, ' · ' + t('source')) : '')
      : el('span', { class: 'legal-meta' }, t('Pour la mobilisation · publié {ago}', { ago: ago(a.t) }));
    return el('div', { class: 'legal-row' + (compact ? ' compact' : '') },
      el('div', { class: 'legal-who' }, el('b', {}, a.name), a.text ? el('span', {}, a.text) : '', meta),
      el('div', { class: 'legal-num' }, num, a.signal ? el('span', { class: 'legal-sig', title: 'Joignable sur Signal' }, 'Signal') : ''),
      el('div', { class: 'legal-actions' }, call, copy));
  }
  function renderLegal() {
    const box = $('#legalList'), other = $('#legalOtherList'); box.textContent = ''; other.textContent = '';
    const groups = legalGroups(), first = groups[0];
    $('#legalNone').hidden = !!first;
    $('#legalOther').hidden = groups.length < 2;
    if (!first) { $('#legalTitle').textContent = t('Legal team'); return; }
    const far = first.d > 80000;
    $('#legalTitle').textContent = far ? t('Aucune legal team connue près de toi · la plus proche : {city} ({d})', { city: first.city, d: kmTxt(first.d) })
      : t('Legal team') + ' · ' + first.city + (first.d >= 5000 ? ' (' + kmTxt(first.d) + ')' : '');
    for (const a of first.items) box.append(legalRow(a, false));
    $('#legalOtherSum').textContent = t('Autres villes ({n})', { n: groups.length - 1 });
    for (const g of groups.slice(1)) {
      other.append(el('div', { class: 'legal-city' }, g.city, el('span', {}, kmTxt(g.d))));
      for (const a of g.items) other.append(legalRow(a, true));
    }
  }
  const nearestLegal = () => legalGroups()[0]?.items[0] || null;
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
  $('#shClose').onclick = () => closeSheets();
  $('#btnNativeShare').onclick = () => navigator.share?.({ title: 'Cortège', text: t('La carte en direct des manifs, par @{h}', { h: cfg.brand?.handle || 'neru' }), url: shareUrl }).catch(() => {});
  $('#btnCopyLink').onclick = async () => { try { await navigator.clipboard.writeText(shareUrl); toast('Lien copié'); } catch { toast(shareUrl); } };

