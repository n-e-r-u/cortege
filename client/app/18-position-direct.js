  // ---- Ma position en direct (orgas confirmées) : street medic, legal team, presse, tête ou queue de cortège ----
  // Envoyée toutes les 30 s tant que l'appli est ouverte ; arrêt au bout de la durée choisie, ou à la main.
  // Garde-fous (pour ne jamais révéler où l'orga va après la manif) : le serveur coupe à plus de 2 km du départ ;
  // ici, une question toutes les 30 min (« Tu es toujours en manif ? »), posée aussi plus tôt si plus rien ne se passe
  // autour depuis 10 min, et sans réponse en 3 min, le partage s'arrête. Bandeau toujours visible pendant le partage.
  const ASK_EVERY = 30 * MIN, ASK_WAIT = 3 * MIN, ISO_M = 300, ISO_MS = 10 * MIN;
  function bkBanner() {
    const b = $('#bkBanner');
    b.hidden = !beacon;
    if (!beacon) return;
    const role = $('#bkRole').selectedOptions[0]?.textContent || '';
    b.classList.toggle('ask', !!beacon.askUntil);
    $('#bkYes').hidden = !beacon.askUntil;
    $('#bkBannerTxt').textContent = beacon.askUntil
      ? t(beacon.iso ? 'Plus rien autour de toi : tu es toujours en manif ? Sans réponse, le partage s’arrête dans {d}.' : 'Tu es toujours en manif ? Sans réponse, le partage s’arrête dans {d}.', { d: left(beacon.askUntil) })
      : t('Position partagée en direct ({role})', { role: role.replace(/^\S+\s/, '') });
  }
  function bkAsk(iso) {
    if (!beacon || beacon.askUntil) return;
    beacon.askUntil = Date.now() + ASK_WAIT; beacon.iso = iso;
    try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch {}
    bkBanner();
  }
  // Activité autour : d'autres signalements à moins de 300 m (sa propre position ne compte pas), ou un événement de l'agenda
  function bkIsolated() {
    if (!me) return false;
    for (const { data: r } of reports.values()) if (r.id !== beacon.id && dist(me, [r.lat, r.lng]) <= ISO_M) return false;
    for (const e of evCache.e) if (Math.abs(e.start - Date.now()) < 6 * 3600e3 && (dist(me, [e.lat, e.lng]) <= ISO_M || (e.route || []).some(p => dist(me, p) <= ISO_M))) return false;
    return true;
  }
  async function beaconSend() {
    if (!beacon) return;
    const now = Date.now();
    if (now > beacon.until) return beaconStop(true);
    if (beacon.askUntil && now > beacon.askUntil) { toast('Pas de réponse : partage de position arrêté'); return beaconStop(false); }
    if (!beacon.askUntil && now >= beacon.askAt) bkAsk(false);
    if (!beacon.askUntil) { if (bkIsolated()) { beacon.isoSince ||= now; if (now - beacon.isoSince >= ISO_MS) bkAsk(true); } else beacon.isoSince = 0; }
    bkBanner();
    if (!me) { $('#bkState').textContent = t('En attente de ta position…'); return; }
    try {
      const r = await orgaFetch('/api/orga/beacon', { method: 'POST', body: JSON.stringify({ role: beacon.role, lat: me[0], lng: me[1], note: beacon.note }) });
      if (beacon && r && r.id) beacon.id = r.id;
      $('#bkState').textContent = t('Position partagée à {h}, jusqu’à {end}. Garde l’appli ouverte.', { h: fmtHour(Date.now()), end: fmtHour(beacon.until) });
      sync();
    } catch (e) {
      $('#bkState').textContent = t(e.message);
      if (/arrêté|réservé|Rôle/.test(e.message)) { toast(e.message); beaconStop(false, true); }
    }
  }
  async function beaconStop(tell, already = false) {
    const b = beacon; beacon = null;
    if (b) { clearInterval(b.timer); try { b.lock && b.lock.release(); } catch {} }
    bkBanner();
    $('#bkBtn').dataset.on = '0'; $('#bkBtn').textContent = t('Partager ma position'); $('#bkRole').disabled = $('#bkDur').disabled = $('#bkNote').disabled = false;
    if (b && !already) { try { await orgaFetch('/api/orga/beacon', { method: 'DELETE', body: JSON.stringify({ role: b.role }) }); } catch {} }
    if (b && !already) $('#bkState').textContent = t('Partage arrêté : ton point disparaît de la carte.');
    if (b && tell) toast('Partage de position terminé');
    sync();
  }
  $('#bkBtn').onclick = async () => {
    if (beacon) return beaconStop(false);
    if (!me) { toast('Active d’abord ta position (bouton ◎)'); return; }
    const now = Date.now();
    beacon = { role: $('#bkRole').value, note: $('#bkNote').value.trim(), until: now + Number($('#bkDur').value) * MIN, askAt: now + ASK_EVERY, askUntil: 0, isoSince: 0, id: null, timer: setInterval(beaconSend, 30_000), lock: null };
    // L'écran reste allumé pendant le partage (sinon le téléphone met l'appli en pause)
    try { beacon.lock = await navigator.wakeLock?.request('screen'); } catch {}
    $('#bkBtn').dataset.on = '1'; $('#bkBtn').textContent = t('Arrêter le partage'); $('#bkRole').disabled = $('#bkDur').disabled = $('#bkNote').disabled = true;
    beaconSend();
  };
  $('#bkYes').onclick = () => { if (!beacon) return; beacon.askUntil = 0; beacon.isoSince = 0; beacon.askAt = Date.now() + ASK_EVERY; bkBanner(); toast('Partage prolongé, merci'); };
  $('#bkOff').onclick = () => beaconStop(false);
  setInterval(() => { if (beacon && beacon.askUntil) bkBanner(); }, 15_000);
  document.addEventListener('visibilitychange', async () => { if (!document.hidden && beacon) { try { beacon.lock = await navigator.wakeLock?.request('screen'); } catch {} beaconSend(); } });
  $('#annForm').addEventListener('submit', async e => {
    e.preventDefault();
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const c = map.getCenter();
    const body = { kind, lat: c.lat, lng: c.lng, radiusKm: +$('#annRadius').value, minutes: +$('#annMinutes').value };
    if (kind === 'legal') Object.assign(body, { phone: $('#annPhone').value, text: $('#annLegalText').value, city: $('#annCity').value });
    else Object.assign(body, { text: $('#annText').value, level: document.querySelector('input[name="level"]:checked').value,
      national: !!(orga && orga.admin && $('#annNational').checked) });
    try {
      const out = await orgaFetch('/api/announcements', { method: 'POST', body: JSON.stringify(body) });
      toast(out && out.pending ? (out.kind === 'legal' ? 'Numéro envoyé : il s’affichera après validation par l’admin' : 'Annonce envoyée : elle s’affichera après validation par l’admin') : 'Annonce publiée');
      $('#annText').value = ''; $('#annPhone').value = ''; $('#annLegalText').value = ''; $('#annCity').value = ''; $('#annNational').checked = false; annZoneUI();
      etag = null; sync(); loadMine();
    } catch (err) { toast(err.message); }
  });
  $('#btnOrgaLogout').onclick = () => {
    const b = $('#btnOrgaLogout');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = t('Confirmer : l’accès sera perdu sur cet appareil (il faudra une nouvelle invitation)'); setTimeout(() => { delete b.dataset.armed; b.textContent = t('Quitter le mode orga sur ce téléphone'); }, 6000); return; }
    try { localStorage.removeItem('cortege-orga'); } catch {} setOrga(null); closeSheets(); toast('Mode orga désactivé sur ce téléphone');
  };

