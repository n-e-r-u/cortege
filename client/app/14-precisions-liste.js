  // ---- Précisions ----
  const NOTE_HINTS = { fdo: 'ex. : une vingtaine, remontent vers la gare', danger: 'ex. : le nuage s’étend vers la place',
    soutien: 'ex. : sous l’abribus, côté nord', info: 'ex. : barrières, passage par la rue d’à côté' };
  // Groupe fasciste : on décrit la situation, jamais les personnes
  const NOTE_HINTS_CAT = { facho: 'Combien, direction, armes visibles. Pas de nom ni de photo.' };
  function notePlaceholder(cat) { return t(NOTE_HINTS_CAT[cat] || NOTE_HINTS[CAT[cat]?.group] || 'Ajouter une précision'); }
  async function sendNote(id, text) {
    text = String(text || '').trim();
    if (text.length < 2) return toast('Écris une précision.');
    try {
      const res = await fetch(`/api/reports/${id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify({ note: text }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return toast(body.error || 'Envoi impossible.');
      toast('Précision ajoutée'); map.closePopup(); closeNoteCard(); sync();
    } catch { toast('Pas de réseau.'); }
  }
  // Carte « Ajouter une précision ? » juste après un signalement : l'envoi n'attend pas qu'on écrive
  let noteFor = null;
  function openNoteCard(id, cat, title) {
    noteFor = id;
    $('#noteTitle').textContent = '✓ ' + title;
    $('#noteInput').value = ''; $('#noteInput').placeholder = notePlaceholder(cat);
    $('#noteCard').hidden = false;
    clearTimeout(openNoteCard.t);
    openNoteCard.t = setTimeout(() => { if (document.activeElement !== $('#noteInput') && !$('#noteInput').value) closeNoteCard(); }, 12000);
  }
  function closeNoteCard() { $('#noteCard').hidden = true; noteFor = null; clearTimeout(openNoteCard.t); }
  $('#noteClose').onclick = closeNoteCard;
  $('#noteCard').addEventListener('submit', e => { e.preventDefault(); if (noteFor) sendNote(noteFor, $('#noteInput').value); });
  $('#queueChip').onclick = () => { closeReport(); closeSheets(); renderQueue(); $('#sheetQueue').hidden = false; };
  $('#sqClose').onclick = () => closeSheets();
  $('#btnQueueRetry').onclick = () => flushQueue(true);
  addEventListener('online', () => flushQueue());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  navigator.serviceWorker?.addEventListener?.('message', e => {
    if (e.data && e.data.type === 'queue-flushed') { updateQueueChip(); sync(); }
    if (e.data && e.data.type === 'goto') { const at = atParam(e.data.url); if (at) { setFollow(false); map.setView(at, 17); sync(); } }
  });
  updateQueueChip().then(n => { if (n) flushQueue(); });

  // Sur place ? 'here' (position récente et précise, à moins de 400 m), 'far' (nettement plus loin), sinon null (on ne sait pas)
  const NEAR_M = 400;
  function onSite(r) {
    if (!me || Date.now() - meAt > 5 * MIN) return null;
    const d = dist(me, [r.lat, r.lng]), acc = Math.min(meAcc, 300);
    if (d - acc > NEAR_M) return 'far';
    return d <= NEAR_M && meAcc <= 300 ? 'here' : null;
  }
  async function vote(id, v, here = false, quiet = false) {
    voted.add(id);
    try {
      const res = await fetch(`/api/reports/${id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify(v === 1 ? { v } : { v, here }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) { voted.delete(id); return quiet || toast(body.error || 'Vote impossible.'); }
      if (quiet) return;
      toast(v === 1 ? 'Merci, signalement prolongé' : 'Merci, c’est noté');
      map.closePopup();
      sync();
    } catch { voted.delete(id); if (!quiet) toast('Pas de réseau.'); }
  }

  // ---- Liste ----
  function renderList() {
    const ol = $('#list'); ol.textContent = '';
    const view = map.getBounds();
    const items = [...reports.values()].map(x => x.data).filter(r => !hidden.has(CAT[r.cat].group) && !calmHidden(r) && view.contains([r.lat, r.lng]));
    items.sort(me ? (a, b) => dist(me, [a.lat, a.lng]) - dist(me, [b.lat, b.lng]) : (a, b) => b.t - a.t);
    $('#listEmpty').hidden = items.length > 0;
    for (const r of items) {
      const c = CAT[r.cat];
      const btn = el('button', { 'aria-label': c.label },
        el('span', { class: 'g', style: `--c:${GROUP_COLOR[c.group]}` }, c.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, c.label), el('div', { class: 's' }, r.note || (r.up ? ago(r.last || r.t) + ' · ' + t('{n} personnes', { n: r.up + 1 }) : ago(r.t)))),
        el('span', { class: 'd' }, me ? fmtDist(dist(me, [r.lat, r.lng])) : ago(r.last || r.t)));
      btn.onclick = () => { closeSheets(); const m = markerOf(r.id); if (m) layer.zoomToShowLayer(m, () => m.openPopup()); };
      ol.append(el('li', {}, btn));
    }
  }
  $('#btnList').onclick = () => { closeReport(); closeSheets(); renderList(); $('#sheetList').hidden = false; };
  $('#slClose').onclick = () => closeSheets();
  // ---- Onglets ----
  function openPage(sel) {
    closeReport(); map.closePopup();
    const wasOpen = !$(sel).hidden;
    closeSheets();
    if (wasOpen) return; // deuxième appui sur l'onglet : retour à la carte
    if (sel === '#sheetFeed') renderFeed();
    if (sel === '#sheetRights') renderLegal();
    $(sel).hidden = false; $(sel).scrollTop = 0;
  }
  $('#tabMap').onclick = () => { closeReport(); closeSheets(); };
  $('#tabInfos').onclick = () => openPage('#sheetFeed');
  $('#tabRights').onclick = () => openPage('#sheetRights');
  $('#tabMore').onclick = () => openPage('#sheetInfo');
  $('#fdClose').onclick = () => closeSheets();
  $('#siClose').onclick = () => closeSheets();

