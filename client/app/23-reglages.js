  // ---- Économie de batterie ----
  const ecoBadge = el('span', { class: 'eco', title: 'Économie de batterie', 'aria-label': 'Économie de batterie' }, '🔋');
  $('#status').append(ecoBadge);
  function applyEco() {
    ecoBadge.hidden = !eco;
    $('#optEco').checked = eco;
    if (eco && compassOn) {
      window.removeEventListener('deviceorientationabsolute', onOrient, true); window.removeEventListener('deviceorientation', onOrient, true);
      compassOn = false; heading = null; rawHeading = null; drawHeading();
    }
    // relance le GPS avec les nouveaux réglages
    if (watchId != null) { const f = follow; navigator.geolocation.clearWatch(watchId); watchId = null; locate(); setFollow(f); }
  }
  $('#optEco').addEventListener('change', e => {
    eco = e.target.checked;
    try { localStorage.setItem('cortege-eco', eco ? '1' : '0'); } catch {}
    applyEco(); sync();
    toast(eco ? 'Économie de batterie activée' : 'Économie de batterie désactivée');
  });
  ecoBadge.hidden = !eco; $('#optEco').checked = eco;
  // ---- Accessibilité : texte plus grand, contraste renforcé (gardés sur ce téléphone) ----
  const a11y = (id, cls, key) => {
    let on = false; try { on = localStorage.getItem(key) === '1'; } catch {}
    document.body.classList.toggle(cls, on); $(id).checked = on;
    $(id).addEventListener('change', e => { document.body.classList.toggle(cls, e.target.checked); try { localStorage.setItem(key, e.target.checked ? '1' : '0'); } catch {} });
  };
  a11y('#optBig', 'big', 'cortege-big'); a11y('#optContrast', 'contrast', 'cortege-contrast');
  $('#calmNav').onclick = () => { if (!calmTarget) return; const r = calmTarget.r; setFollow(false); map.setView([r.lat, r.lng], Math.max(map.getZoom(), 17)); reports.get(r.id)?.marker?.openPopup?.(); };
  // ---- Nouveautés : affichées une fois après chaque nouvelle version ----
  let news = null;
  async function loadNews() { try { news = await (await fetch('/nouveautes.json', { cache: 'no-cache' })).json(); } catch { news = null; } return news; }
  function openNews() {
    if (!news) return;
    closeReport(); closeSheets();
    $('#nwTitle').textContent = t('Nouveautés');
    const box = $('#newsList'); box.textContent = '';
    // Les dernières versions, la plus récente en premier
    for (const [i, v] of (news.history || [{ version: news.version, items: news.items }]).entries()) {
      box.append(el('li', { class: 'news-v' + (i ? ' old' : '') }, t('Version {v}', { v: v.version })));
      for (const [ti, d] of v['items_' + I18N.lang] || v.items) box.append(el('li', {}, el('b', {}, ti), el('span', {}, d)));
    }
    $('#sheetNews').hidden = false;
    try { localStorage.setItem('cortege-news', news.version); } catch {}
  }
  $('#btnNews').onclick = async () => { if (!news) await loadNews(); openNews(); };
  $('#nwClose').onclick = () => closeSheets();
  // Première visite : rien à annoncer (tout est nouveau) ; ensuite, une fois par version
  let returning = false; try { returning = !!localStorage.getItem('cortege-seen'); } catch {}
  loadNews().then(n => {
    if (!n) return;
    $('#newsVersion').textContent = t('Version {v}', { v: cfg.version || n.version });
    let seen = null; try { seen = localStorage.getItem('cortege-news'); } catch {}
    if (seen === n.version) return;
    if (!returning) { try { localStorage.setItem('cortege-news', n.version); } catch {} return; }
    setTimeout(() => { if (!document.querySelector('.sheet:not([hidden])')) openNews(); }, 2500);
  });
  // ---- La carte sur un autre site (iframe en lecture seule) ----
  $('#btnEmbed').onclick = () => {
    closeReport(); closeSheets();
    const c = map.getCenter(), src = `${location.origin}/embed.html?lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}&z=${Math.min(15, Math.max(10, map.getZoom()))}`;
    $('#embedCode').value = `<iframe src="${src}" width="100%" height="480" style="border:0;border-radius:12px" loading="lazy" title="${t('Carte en direct des manifs (Cortège)')}"></iframe>`;
    $('#embedOpen').href = src;
    $('#sheetEmbed').hidden = false;
  };
  $('#emClose').onclick = () => closeSheets();
  $('#embedCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#embedCode').value); toast('Code copié'); } catch { $('#embedCode').select(); } };
  try {
    navigator.getBattery?.().then(b => {
      const check = () => { if (!eco && !b.charging && b.level <= 0.2 && !check.done) { check.done = true; toast('Batterie faible : active l’économie de batterie dans « Plus »'); } };
      check(); b.addEventListener('levelchange', check);
    }).catch(() => {});
  } catch {}

