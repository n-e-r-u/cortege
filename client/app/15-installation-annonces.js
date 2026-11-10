  // ---- Installation sur l'écran d'accueil (PWA) ----
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Twitter|LinkedInApp|Snapchat/i.test(ua);
  let installEvent = null;
  function showInstall(withTool) {
    if (standalone) return;
    $('#installBox').hidden = false;
    if (withTool) $('#btnInstallTool').hidden = false;
  }
  function hideInstall() { $('#installBox').hidden = true; $('#btnInstallTool').hidden = true; }
  function installHelp(html) { const p = $('#installHelp'); p.innerHTML = t(html); p.hidden = false; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; showInstall(true); });
  window.addEventListener('appinstalled', () => { installEvent = null; hideInstall(); toast('Appli installée sur ton écran d’accueil'); });
  if (!standalone) showInstall(isIOS || inApp);
  async function doInstall() {
    closeReport(); closeSheets(); $('#sheetInfo').hidden = false;
    if (installEvent) {
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice.catch(() => ({}));
      installEvent = null;
      if (outcome === 'accepted') hideInstall(); else $('#btnInstallTool').hidden = true;
      return;
    }
    if (inApp) return installHelp(t('Tu es dans le navigateur d’une appli (Instagram, TikTok…), qui ne peut pas installer Cortège. Touche le menu <b>⋯</b> en haut à droite puis <b>Ouvrir dans le navigateur</b>, et recommence depuis là.'));
    if (isIOS) return installHelp(t('Sur iPhone, dans <b>Safari</b> : touche le bouton <b>Partager</b> (le carré avec une flèche vers le haut), puis <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.'));
    installHelp(t('Ouvre le menu de ton navigateur (<b>⋮</b>) puis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.'));
  }
  $('#btnInstall').onclick = doInstall;
  $('#btnInstallTool').onclick = doInstall;

  // ---- Annonces orga (bandeaux) ----
  let dismissed = new Set();
  try { dismissed = new Set(JSON.parse(localStorage.getItem('cortege-dismissed') || '[]')); } catch {}
  const seenAnns = new Set();
  // Points de ralliement des orgas : un drapeau sur la carte, avec l'orga, le texte et l'heure de fin
  const rallyLayer = L.layerGroup().addTo(map);
  function drawRallies(list) {
    rallyLayer.clearLayers();
    const now = Date.now();
    for (const a of list.filter(x => x.kind === 'rally' && !x.pending && x.exp > now)) {
      const icon = L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18], html: '<div class="pin rally" style="--c:var(--info, #6966c6)">🚩</div>' });
      const pop = el('div', {}, el('div', { class: 'pop-title' }, '🚩 ' + t('Point de ralliement')), el('div', { class: 'pop-ver' }, '✓ ' + a.by),
        el('p', {}, a.text), el('div', { class: 'pop-meta' }, t('Jusqu’à {h}', { h: new Date(a.exp).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' }) }) + (me ? ' · ' + fmtDist(dist(me, [a.lat, a.lng])) : '')));
      L.marker([a.lat, a.lng], { icon, title: t('Point de ralliement'), zIndexOffset: 300 }).bindPopup(pop, { maxWidth: 280 }).addTo(rallyLayer);
    }
  }
  function renderAnns(list, canAlert) {
    announcements = list;
    drawRallies(list);
    const box = $('#anns'); box.textContent = '';
    const shown = list.filter(a => (a.kind === 'info' || a.kind === 'rally') && !dismissed.has(a.id))
      .sort((a, b) => (b.level === 'urgent') - (a.level === 'urgent') || b.t - a.t);
    const maxBanners = innerHeight < 760 ? 2 : 3; // petits écrans : ne pas masquer les boutons
    for (const a of shown.slice(0, maxBanners)) {
      const close = el('button', { class: 'ann-x', 'aria-label': 'Masquer cette annonce' }, '×');
      close.onclick = () => { dismissed.add(a.id); try { localStorage.setItem('cortege-dismissed', JSON.stringify([...dismissed].slice(-200))); } catch {} renderAnns(announcements, false); };
      const rally = a.kind === 'rally';
      const go = rally ? el('button', { type: 'button', class: 'ann-link link-btn' }, t('Voir sur la carte') + ' →') : '';
      if (rally) go.onclick = () => { setFollow(false); map.setView([a.lat, a.lng], Math.max(map.getZoom(), 16)); rallyLayer.eachLayer(m => { const p = m.getLatLng(); if (p.lat === a.lat && p.lng === a.lng) m.openPopup(); }); };
      box.append(el('div', { class: 'ann ' + a.level + (rally ? ' rally' : '') },
        el('div', { class: 'ann-meta' }, (rally ? '🚩 ' + t('Point de ralliement') + ' · ' : '📣 ') + a.by + (a.national ? ' · ' + t('toute la France') : '') + ' · ' + ago(a.t)),
        el('div', { class: 'ann-text' }, a.text), go,
        a.link ? el('a', { class: 'ann-link', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, 'En savoir plus →') : '', close));
      if (canAlert && !seenAnns.has(a.id) && a.level === 'urgent') { try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch {} }
    }
    if (shown.length > maxBanners) box.append(el('div', { class: 'ann-more' }, tn(shown.length - maxBanners, '+ {n} autre annonce', '+ {n} autres annonces')));
    list.forEach(a => seenAnns.add(a.id));
    renderLegal();
    if (!$('#sheetOrga').hidden) renderOrgaList();
  }

