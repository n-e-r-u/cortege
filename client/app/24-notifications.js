  // ---- Notifications : annonces urgentes et dangers près de toi, même appli fermée ----
  const pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!cfg.pushKey;
  const b64u = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  let pushZone = null; try { pushZone = localStorage.getItem('cortege-push-zone'); } catch {}
  // Réglages : annonces urgentes (oui par défaut, comme avant) et dangers près de toi
  let pushOpts = { urgent: true, near: false, orders: true }; try { pushOpts = { ...pushOpts, ...JSON.parse(localStorage.getItem('cortege-push-opts') || '{}') }; } catch {}
  const savePushOpts = () => { try { localStorage.setItem('cortege-push-opts', JSON.stringify(pushOpts)); } catch {} };
  function bellState() {
    const on = !!pushSub; $('#btnNotif').dataset.on = on ? '1' : '0';
    $('#btnNotif .ico').textContent = on ? '🔔' : '🔕'; $('#notifSub').textContent = t(on ? 'Activées sur ce téléphone' : 'Pas encore activées');
  }
  // Le serveur ne reçoit qu'une zone arrondie à 0,1° (≈ 10 km), mise à jour quand tu changes de zone
  async function pushSend(sub, force) {
    const c = map.getCenter(), ref = me || [c.lat, c.lng];
    const z = ref.map(x => Math.round(x * 10) / 10), key = z.join(',') + (pushOpts.urgent ? 'u' : '') + (pushOpts.near ? 'n' : '') + (pushOpts.orders ? 'o' : '') + I18N.lang;
    if (!force && key === pushZone) return;
    pushZone = key;
    const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: sub.toJSON(), lat: z[0], lng: z[1], urgent: pushOpts.urgent, near: pushOpts.near, orders: pushOpts.orders, lang: I18N.lang }) });
    if (!res.ok) { pushZone = null; throw new Error((await res.json().catch(() => ({}))).error || t('Abonnement impossible.')); }
    try { localStorage.setItem('cortege-push-zone', key); } catch {}
  }
  if (isIOS && !standalone) $('#pushHelp').textContent += ' ' + t('Sur iPhone, installe d’abord l’appli sur l’écran d’accueil, puis active les alertes depuis l’appli installée.');
  function syncSwitches() { $('#optPush').checked = !!pushSub && pushOpts.urgent; $('#optNear').checked = !!pushSub && pushOpts.near; $('#optOrd').checked = !!pushSub && pushOpts.orders; $('#pushTestBox').hidden = !pushSub; bellState(); }
  // Notification de test envoyée par le serveur : vérifie toute la chaîne, pas seulement le vibreur du téléphone
  $('#btnPushTest').onclick = async () => {
    const b = $('#btnPushTest'), msg = $('#pushTestMsg');
    if (!pushSub) return;
    b.disabled = true; msg.textContent = t('Envoi…');
    try {
      await pushSend(pushSub, true).catch(() => {});
      const res = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify({ endpoint: pushSub.endpoint }) });
      const out = await res.json().catch(() => ({}));
      msg.textContent = res.ok ? t('Envoyée par le serveur. Elle arrive en quelques secondes (verrouille le téléphone pour la voir comme pendant une manif). Rien ? Vérifie que les notifications de ton navigateur sont autorisées dans les réglages du téléphone.')
        : t(out.error || 'Envoi impossible.');
    } catch { msg.textContent = t('Pas de réseau : réessaie quand ça capte.'); }
    setTimeout(() => { b.disabled = false; }, 4000);
  };
  if (pushOK) navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
    if (sub && Notification.permission === 'granted') {
      pushSub = sub; syncSwitches();
      // Réinscription au plus deux fois par jour (le serveur a pu tout effacer entre-temps)
      let at = 0; try { at = +localStorage.getItem('cortege-push-at') || 0; } catch {}
      pushSend(sub, Date.now() - at > 12 * 3600e3).then(() => { try { localStorage.setItem('cortege-push-at', String(Date.now())); } catch {} }).catch(() => {});
    }
  }).catch(() => {});
  async function pushEnable() {
    if (!pushOK) throw new Error(isIOS && !standalone ? t('Sur iPhone : installe d’abord l’appli sur l’écran d’accueil.') : t('Notifications non prises en charge par ce navigateur.'));
    if (await Notification.requestPermission() !== 'granted') throw new Error(t('Notifications refusées : autorise-les dans les réglages du téléphone.'));
    const reg = await navigator.serviceWorker.ready;
    pushSub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(cfg.pushKey) });
    await pushSend(pushSub, true);
  }
  async function pushDisable() {
    const sub = pushSub; pushSub = null; pushZone = null;
    try { localStorage.removeItem('cortege-push-zone'); } catch {}
    try {
      if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: { endpoint: sub.endpoint } }) }); await sub.unsubscribe(); }
    } catch {}
  }
  async function pushToggle(which, on) {
    const before = { ...pushOpts };
    if (!pushSub) pushOpts = { urgent: false, near: false, orders: false }; // première activation : seulement ce qui a été choisi
    pushOpts[which] = on;
    try {
      if (!pushOpts.urgent && !pushOpts.near && !pushOpts.orders) { await pushDisable(); toast('Notifications désactivées'); }
      else if (!pushSub) { await pushEnable(); toast(which === 'near' ? 'Alertes « danger près de toi » activées' : which === 'orders' ? 'Alertes « nouvel arrêté » activées' : 'Annonces urgentes activées'); }
      else { await pushSend(pushSub, true); toast(on ? 'Activé' : 'Désactivé'); }
      savePushOpts();
    } catch (err) { pushOpts = before; toast(err.message || 'Activation impossible.'); }
    syncSwitches();
  }
  $('#optPush').addEventListener('change', e => pushToggle('urgent', e.target.checked));
  $('#optNear').addEventListener('change', e => pushToggle('near', e.target.checked));
  $('#optOrd').addEventListener('change', e => pushToggle('orders', e.target.checked));
  // Légende des vibrations, avec un bouton pour les essayer
  const VIBE_TXT = { charge: 'rafale de petites vibrations', nasse: 'deux longues', sommations: 'trois longues', lacrymo: 'deux moyennes',
    canon: 'trois moyennes', bac: 'deux courtes puis une longue', crs: 'deux courtes', interpellation: 'trois courtes',
    tirs: 'rafale très rapide', facho: 'une longue, deux courtes, une longue', inter: 'trois courtes puis une longue', blinde: 'une longue puis une courte' };
  for (const id of Object.keys(VIBE_TXT)) {
    if (!CAT[id]) continue;
    const b = el('button', { type: 'button' }, 'Essayer');
    b.onclick = () => { try { navigator.vibrate?.(cfg.vibes?.[id] || [200]); } catch {} };
    $('#vibeList').append(el('li', {}, el('span', {}, CAT[id].glyph + ' ' + CAT[id].label, el('small', {}, VIBE_TXT[id])), ...(navigator.vibrate ? [b] : [])));
  }
  if (!navigator.vibrate) $('#vibeNote').textContent = t('Ce téléphone ne permet pas de vibrations personnalisées (c’est le cas des iPhone). Sur iPhone, installe d’abord l’appli sur l’écran d’accueil pour recevoir les notifications.');
  function openNotif() { closeReport(); closeSheets(); syncSwitches(); $('#sheetNotif').hidden = false; }
  $('#btnNotif').onclick = openNotif;
  $('#btnNotifInfo').onclick = openNotif;
  $('#ntClose').onclick = () => closeSheets();
  bellState();

