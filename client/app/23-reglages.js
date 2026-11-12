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
  // ---- Apparence : thème du système, clair ou sombre (gardé sur ce téléphone, appliqué par theme.js dès l'ouverture) ----
  const themeSeg = () => document.querySelectorAll('#themeSeg [data-theme-pref]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themePref === (window.cortegeTheme?.pref || 'system'))));
  document.querySelectorAll('#themeSeg [data-theme-pref]').forEach(b => { b.onclick = () => { window.cortegeTheme?.set(b.dataset.themePref); themeSeg(); }; });
  themeSeg();
  $('#calmNav').onclick = () => { if (!calmTarget) return; const r = calmTarget.r; setFollow(false); map.setView([r.lat, r.lng], Math.max(map.getZoom(), 17)); if (r.refuge) repliOpen?.(r.id); else reports.get(r.id)?.marker?.openPopup?.(); };
  // ---- Nouveautés : affichées une fois après chaque nouvelle version ----
  let news = null;
  async function loadNews() { try { news = await (await fetch('/nouveautes.json', { cache: 'no-cache' })).json(); } catch { news = null; } return news; }
  // Les versions précédentes sont dans un fichier à part, lu seulement à l'ouverture de la liste (pas à chaque démarrage)
  let newsOld = null;
  function openNews() {
    if (!news) return;
    closeReport(); closeSheets();
    $('#nwTitle').textContent = t('Nouveautés');
    const draw = () => {
      const box = $('#newsList'); box.textContent = '';
      // Les dernières versions, la plus récente en premier
      const cur = { ...news, history: undefined }, older = (newsOld || []).filter(v => v.version !== news.version);
      for (const [i, v] of [cur, ...older].entries()) {
        box.append(el('li', { class: 'news-v' + (i ? ' old' : '') }, t('Version {v}', { v: v.version })));
        for (const [ti, d] of v['items_' + I18N.lang] || v.items) box.append(el('li', {}, el('b', {}, ti), el('span', {}, d)));
      }
    };
    draw();
    if (!newsOld) fetch('/nouveautes-historique.json', { cache: 'no-cache' }).then(r => r.json()).then(j => { newsOld = j.history || []; if (!$('#sheetNews').hidden) draw(); }).catch(() => {});
    $('#sheetNews').hidden = false;
    try { localStorage.setItem('cortege-news', news.version); } catch {}
  }
  $('#btnNews').onclick = async () => { if (!news) await loadNews(); openNews(); };
  // Lien partagé sur les réseaux (/?nouveautes) : ouvre directement les nouveautés
  if (/[?&]nouveautes\b/.test(location.search)) { history.replaceState(null, '', location.pathname); loadNews().then(() => setTimeout(openNews, 600)); }
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
  function embedCode() {
    const c = map.getCenter(), th = $('#embedTheme').value;
    const src = `${location.origin}/embed.html?lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}&z=${Math.min(15, Math.max(10, map.getZoom()))}${th ? '&theme=' + th : ''}`;
    $('#embedCode').value = `<iframe src="${src}" width="100%" height="480" style="border:0;border-radius:12px" loading="lazy" title="${t('Carte en direct des manifs (Cortège)')}"></iframe>`;
    $('#embedOpen').href = src;
  }
  $('#btnEmbed').onclick = () => {
    closeReport(); closeSheets();
    embedCode();
    $('#sheetEmbed').hidden = false;
  };
  $('#embedTheme').onchange = embedCode;
  $('#emClose').onclick = () => closeSheets();
  $('#embedCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#embedCode').value); toast('Code copié'); } catch { $('#embedCode').select(); } };
  try {
    navigator.getBattery?.().then(b => {
      const check = () => { if (!eco && !b.charging && b.level <= 0.2 && !check.done) { check.done = true; toast('Batterie faible : active l’économie de batterie dans « Plus »'); } };
      check(); b.addEventListener('levelchange', check);
    }).catch(() => {});
  } catch {}

