  // ---- Bien se préparer : checklist gardée sur le téléphone ----
  const prepKey = 'cortege-prep';
  const prepGet = () => { try { return JSON.parse(localStorage.getItem(prepKey) || '{}'); } catch { return {}; } };
  const prepBoxes = [...document.querySelectorAll('#sheetPrep .checklist input[type=checkbox]')];
  function prepRender() {
    const st = prepGet();
    prepBoxes.forEach(b => (b.checked = !!st[b.dataset.k]));
    const done = prepBoxes.filter(b => b.checked).length;
    $('#prepCount').textContent = tn(done, '{n} / {total} prêt', '{n} / {total} prêts', { total: prepBoxes.length });
  }
  prepBoxes.forEach(b => b.addEventListener('change', () => {
    const st = prepGet(); st[b.dataset.k] = b.checked;
    try { localStorage.setItem(prepKey, JSON.stringify(st)); } catch {}
    prepRender();
  }));
  function openPrep() { closeReport(); closeSheets(); prepRender(); rallyRender(); $('#sheetPrep').hidden = false; }
  $('#btnPrep').onclick = openPrep;
  $('#btnPrepInfo').onclick = openPrep;
  $('#prClose').onclick = () => closeSheets();
  $('#prepReset').onclick = () => { try { localStorage.removeItem(prepKey); } catch {} prepRender(); toast('Checklist remise à zéro'); };
  $('#prepRights').onclick = () => { closeSheets(); renderLegal(); $('#sheetRights').hidden = false; };
  $('#prepSos').onclick = e => { e.preventDefault(); openSos(); };
  $('#prepOffline').onclick = e => { e.preventDefault(); closeSheets(); $('#sheetInfo').hidden = false; $('#btnPrefetch').scrollIntoView({ block: 'center' }); $('#btnPrefetch').focus(); };

  // ---- Point de ralliement du groupe (privé : reste sur le téléphone, partagé seulement si on le décide) ----
  const rallyGet = () => { try { return JSON.parse(localStorage.getItem('cortege-rally') || 'null'); } catch { return null; } };
  let rallyMarker = null, picking = false;
  const rallyLink = p => `https://www.openstreetmap.org/?mlat=${p[0].toFixed(5)}&mlon=${p[1].toFixed(5)}#map=18/${p[0].toFixed(5)}/${p[1].toFixed(5)}`;
  function rallyShare() {
    const p = rallyGet(); if (!p) return;
    const text = t('Point de ralliement si on se perd en manif : {url}', { url: rallyLink(p) });
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('Lien copié : colle-le dans ton groupe'), () => toast(text));
  }
  function rallyRender() {
    const p = rallyGet();
    if (rallyMarker) { map.removeLayer(rallyMarker); rallyMarker = null; }
    if (p) {
      rallyMarker = L.marker(p, { icon: L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [8, 34], html: '<div class="rally-pin">🚩</div>' }), title: 'Point de ralliement', zIndexOffset: 600 })
        .bindPopup(() => {
          const root = el('div', {}, el('div', { class: 'pop-title' }, '🚩 Point de ralliement'),
            el('div', { class: 'pop-meta' }, 'Visible seulement sur ton téléphone' + (me ? ' · ' + fmtDist(dist(me, p)) : '')));
          const share = el('button', { class: 'yes' }, 'Partager');
          const rm = el('button', { class: 'danger' }, 'Retirer');
          share.onclick = rallyShare;
          rm.onclick = () => { try { localStorage.removeItem('cortege-rally'); } catch {} map.closePopup(); rallyRender(); };
          root.append(el('div', { class: 'pop-actions' }, share, rm));
          return root;
        }).addTo(map);
    }
    $('#rallyState').textContent = p ? (me ? t('Point de ralliement placé, à {d} de toi.', { d: fmtDist(dist(me, p)) }) : t('Point de ralliement placé.')) : t('Aucun point de ralliement.');
    $('#rallyShare').disabled = !p;
  }
  function startPick() {
    closeSheets(); setFollow(false); map.closePopup();
    picking = true; document.body.classList.add('drawing');
    const p = rallyGet(); if (p) map.setView(p, Math.max(map.getZoom(), 17));
    $('#crosshair').style.top = '45%'; $('#crosshair').hidden = false; $('#pickBar').hidden = false;
  }
  function endPick(save) {
    if (save) {
      const pt = map.containerPointToLatLng([map.getSize().x / 2, map.getSize().y * 0.45]);
      try { localStorage.setItem('cortege-rally', JSON.stringify([pt.lat, pt.lng])); } catch {}
      toast('Point de ralliement enregistré');
    }
    picking = false; document.body.classList.remove('drawing');
    $('#crosshair').hidden = true; $('#pickBar').hidden = true;
    const ck = prepBoxes.find(b => b.dataset.k === 'ralliement');
    if (save && ck && !ck.checked) { ck.checked = true; ck.dispatchEvent(new Event('change')); }
    openPrep();
  }
  $('#rallySet').onclick = startPick;
  $('#rallyShare').onclick = rallyShare;
  $('#pickOk').onclick = () => endPick(true);
  $('#pickCancel').onclick = () => endPick(false);
  rallyRender();

  // ---- Infos : arrêtés ici, annonces des orgas, agenda proche ----
  function annCard(a) {
    return el('div', { class: 'ann ' + a.level },
      el('div', { class: 'ann-meta' }, '📣 ' + a.by + (a.national ? ' · ' + t('toute la France') : '') + ' · ' + ago(a.t)),
      el('div', { class: 'ann-text' }, a.text),
      a.link ? el('a', { class: 'ann-link', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, 'En savoir plus →') : '');
  }
  function renderFeed() {
    const c = map.getCenter(), ref = me || [c.lat, c.lng];
    $('#feedWhere').textContent = t(me ? 'Autour de ta position.' : 'Autour du centre de la carte. Active ta position pour voir ce qui te concerne.');
    const ob = $('#feedOrd'); ob.textContent = '';
    const ords = ordState && ordState.here ? ordState.here() : [];
    for (const o of ords) ob.append(ordState.card(o, true));
    if (!ords.length) ob.append(el('p', { class: 'empty' }, ordState && ordState.count && ordState.count() ? 'Aucun arrêté connu ici. D’autres sont en vigueur ailleurs en France.' : 'Aucun arrêté ni restriction connus en ce moment.'));
    const ab = $('#feedAnn'); ab.textContent = '';
    const anns = announcements.filter(a => a.kind === 'info').sort((a, b) => (b.level === 'urgent') - (a.level === 'urgent') || b.t - a.t);
    for (const a of anns) ab.append(annCard(a));
    if (!anns.length) ab.append(el('p', { class: 'empty' }, 'Aucune annonce d’orga dans cette zone pour l’instant.'));
    feedAgenda(ref);
    feedBadge();
  }
  // Pastille de l'onglet Infos : arrêtés qui concernent la zone, annonces urgentes
  function feedBadge() {
    const b = $('#infosBadge'); if (!b) return;
    const n = (ordState && ordState.here ? ordState.here().length : 0) + announcements.filter(a => a.kind === 'info' && a.level === 'urgent').length;
    b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n);
    $('#tabInfos').setAttribute('aria-label', n ? `Infos, ${n} à lire` : 'Infos');
  }

