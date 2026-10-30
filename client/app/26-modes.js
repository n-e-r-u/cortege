  // ---- Mode manif : la carte, Signaler, SOS et Droits, rien d'autre ----
  let manif = false; try { manif = localStorage.getItem('cortege-manif') === '1'; } catch {}
  function setManif(on) {
    manif = on; document.body.classList.toggle('manif', on);
    try { localStorage.setItem('cortege-manif', on ? '1' : '0'); } catch {}
    $('#manifTitle').textContent = t('Mode manif') + (cfg.banner && cfg.event ? ' · ' + t(cfg.event) : '');
  }
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
  $('#optLang').value = I18N.lang;
  $('#optLang').addEventListener('change', e => { I18N.set(e.target.value); reloadForUpdate(); });

  // ---- Tout effacer d'un geste : appui long de 2 secondes (au clavier : deux fois Entrée) ----
  async function wipeAll() {
    document.querySelectorAll('[data-wipe] b').forEach(b => (b.textContent = t('Effacement…')));
    try { await Promise.race([pushDisable(), new Promise(r => setTimeout(r, 1500))]); } catch {}
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try { indexedDB.deleteDatabase('cortege'); } catch {}
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

  // Premier lancement : on montre les réflexes (et la carte @neru) une fois
  try { if (!localStorage.getItem('cortege-seen')) { $('#sheetInfo').hidden = false; localStorage.setItem('cortege-seen', '1'); } } catch {}

