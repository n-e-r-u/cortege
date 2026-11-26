  // ---- Mode manif : la carte, Signaler, SOS et Droits, rien d'autre ----
  let manif = false; try { manif = localStorage.getItem('cortege-manif') === '1'; } catch {}
  // Hauteur du soleil au-dessus de l'horizon, en degrés (calcul local, méthode NOAA simplifiée, à quelques minutes près).
  // Le calcul se fait sur le centre de l'instance, jamais sur la position de la personne : rien de nouveau n'est écrit
  // sur le téléphone, et la différence d'un bout à l'autre d'un pays est de l'ordre du quart d'heure.
  function sunAltitude(now = new Date()) {
    const RAD = Math.PI / 180, c = cfg.center || [46.6, 2.4], lat = c[0], lng = c[1];
    const d = (now.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;   // jours depuis J2000
    const g = (357.529 + 0.98560028 * d) * RAD;                     // anomalie moyenne
    const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // longitude apparente
    const e = (23.439 - 0.00000036 * d) * RAD;                      // obliquité
    const dec = Math.asin(Math.sin(e) * Math.sin(L));               // déclinaison
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD / 15;  // ascension droite, en heures
    const mod = (x, n) => ((x % n) + n) % n;
    const ha = (mod(18.697375 + 24.065709824279 * d + lng / 15 - ra + 12, 24) - 12) * 15 * RAD; // angle horaire
    const p = lat * RAD;
    return Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(ha)) / RAD;
  }
  // Apparence du mode manif : « plein jour » tant que le soleil est levé (un écran lu dehors), sombre une fois couché
  // (écran discret dans la rue, moins de batterie). Comme avant, le mode manif impose l'apparence ; le choix de la
  // personne revient en sortant. Revu toutes les dix minutes et au retour sur l'appli, pour la tombée de la nuit.
  const manifTheme = () => (sunAltitude() > 0 ? 'jour' : 'dark');
  let manifTimer = null;
  function applyManifTheme() {
    const want = manifTheme();
    try { localStorage.setItem('cortege-manif-theme', want); } catch {}
    window.cortegeTheme?.force(want);
  }
  function setManif(on) {
    manif = on; document.body.classList.toggle('manif', on);
    clearInterval(manifTimer); manifTimer = null;
    if (on) { applyManifTheme(); manifTimer = setInterval(applyManifTheme, 10 * 60_000); }
    else window.cortegeTheme?.force(null);
    try { localStorage.setItem('cortege-manif', on ? '1' : '0'); } catch {}
    $('#manifTitle').textContent = t('Mode manif') + (cfg.banner && cfg.event ? ' · ' + t(cfg.event) : '');
  }
  document.addEventListener('visibilitychange', () => { if (manif && !document.hidden) applyManifTheme(); });
  $('#btnManif').onclick = () => { closeSheets(); setManif(true); if (watchId == null) locate(); toast('Mode manif. « Quitter » en haut pour revenir à l’appli complète.'); };
  $('#manifExit').onclick = () => setManif(false);
  $('#mbSos').onclick = openSos;
  $('#mbLegal').onclick = () => openPage('#sheetRights');
  setManif(manif);

  // ---- Alerte vocale : la voix du téléphone lit les dangers proches (rien ne part sur Internet) ----
  function say(text) {
    if (!voice || !canSpeak) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = I18N.locale; u.rate = 1.05; speechSynthesis.speak(u); } catch {}
  }
  function spokenDist(m) {
    return m < 1000 ? t('{n} mètres', { n: Math.round(m / 10) * 10 }) : t('{n} kilomètres', { n: (m / 1000).toFixed(1).replace('.', I18N.lang === 'en' ? '.' : ',') });
  }
  $('#optVoice').checked = voice;
  $('#btnVoiceTest').hidden = !voice;
  if (!canSpeak) { $('#optVoice').disabled = true; $('#optVoice').closest('label').append(el('span', { class: 'fine' }, 'Ce navigateur ne sait pas lire à voix haute.')); }
  $('#optVoice').addEventListener('change', e => {
    voice = e.target.checked;
    try { localStorage.setItem('cortege-voice', voice ? '1' : '0'); } catch {}
    $('#btnVoiceTest').hidden = !voice;
    if (voice) say(t('Alerte vocale activée'));
  });
  $('#btnVoiceTest').onclick = () => say(t('{what}, à {d}', { what: CAT.charge ? CAT.charge.label : t('Charge'), d: spokenDist(120) }));

  // ---- Langue ----
  // Les langues disponibles sur le serveur (une langue ajoutée y apparaît toute seule), chacune écrite dans sa langue
  if (Array.isArray(I18N.list) && I18N.list.length) {
    const sel = $('#optLang'); sel.textContent = '';
    for (const x of I18N.list) sel.append(el('option', { value: x.code, lang: x.code, ...(x.dir === 'rtl' ? { dir: 'rtl' } : {}) }, x.name));
  }
  $('#optLang').value = I18N.code || I18N.lang;
  $('#optLang').addEventListener('change', e => { I18N.set(e.target.value); reloadForUpdate(); });

  // ---- Tout effacer d'un geste : appui long de 2 secondes (au clavier : deux fois Entrée) ----
  async function wipeAll() {
    document.querySelectorAll('[data-wipe] b').forEach(b => (b.textContent = t('Effacement…')));
    try { await Promise.race([pushDisable(), new Promise(r => setTimeout(r, 1500))]); } catch {}
    try { await orgaRevoke(); } catch {}
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    // Attend la fin de la suppression (bloquée tant qu'une connexion reste ouverte : 1,5 s au plus avant de quitter la page)
    try { await Promise.race([new Promise(r => { const d = indexedDB.deleteDatabase('cortege'); d.onsuccess = d.onerror = d.onblocked = r; }), new Promise(r => setTimeout(r, 1500))]); } catch {}
    try { await Promise.race([new Promise(r => { const d = indexedDB.deleteDatabase('cortege-son'); d.onsuccess = d.onerror = d.onblocked = r; }), new Promise(r => setTimeout(r, 800))]); } catch {}
    try { await Promise.race([new Promise(r => { const d = indexedDB.deleteDatabase('cortege-cles'); d.onsuccess = d.onerror = d.onblocked = r; }), new Promise(r => setTimeout(r, 800))]); } catch {}
    try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
    try { for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister(); } catch {}
    location.replace('about:blank');
  }
  document.querySelectorAll('[data-wipe]').forEach(b => {
    const small = b.querySelector('small'), hint = small.textContent;
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; b.classList.remove('holding'); };
    b.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault(); b.classList.add('holding');
      timer = setTimeout(() => { timer = null; wipeAll(); }, 2000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => { if (timer) stop(); }));
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.addEventListener('click', e => {
      if (e.detail !== 0) { if (!b.classList.contains('holding')) toast('Garde le doigt appuyé 2 secondes pour tout effacer'); return; }
      if (b.dataset.armed) return wipeAll();
      b.dataset.armed = '1'; b.classList.add('armed'); small.textContent = t('Appuie encore une fois pour tout effacer');
      setTimeout(() => { delete b.dataset.armed; b.classList.remove('armed'); small.textContent = hint; }, 5000);
    });
  });

  // Premier lancement : trois écrans (ta zone, signaler, alertes), une seule fois. Leur script n'est chargé que ce jour-là.
  // Pas avec une invitation ou un lien vers un point, une idée, les nouveautés : la personne vient pour autre chose.
  // Sans réseau pour les charger : la page Plus, comme avant.
  const openWelcome = () => loadPart('accueil', () => ({ $, t, closeSheets, addSheet, locate, openNotif })).then(m => m.open());
  try {
    if (!localStorage.getItem('cortege-seen')) {
      localStorage.setItem('cortege-seen', '1');
      if (!/[?&](invite|orga|medic|point|idee|nouveautes|rejoindre|espace)\b/.test(START_QS)) openWelcome().catch(() => { $('#sheetInfo').hidden = false; });
    }
  } catch {}
  $('#btnWelcome').onclick = () => openWelcome().catch(() => toast('Pas de réseau : la présentation se chargera quand ça capte.'));

