  // ---- Géolocalisation + suivi + boussole (tout reste sur l'appareil) ----
  // ◎ gris : pas localisé · ◎ plein : la carte te suit · ◎ contour : localisé, carte libre (appuie pour te recentrer)
  let follow = false, heading = null, compassOn = false, gpsHeading = null, accCircle = null;
  const btnLoc = $('#btnLocate');
  function setFollow(on) {
    follow = on;
    btnLoc.dataset.state = !me ? (watchId != null ? 'searching' : 'off') : on ? 'follow' : 'free';
    btnLoc.setAttribute('aria-pressed', String(on));
    btnLoc.title = t(on ? 'La carte te suit' : 'Me recentrer');
  }
  function meIcon() {
    return L.divIcon({ className: '', iconSize: [64, 64], iconAnchor: [32, 32],
      html: '<div class="me-wrap"><div class="me-cone" hidden></div><div class="me"></div></div>' });
  }
  function drawHeading() {
    const cone = meMarker?.getElement()?.querySelector('.me-cone');
    if (!cone) return;
    const h = heading ?? gpsHeading;
    cone.hidden = h == null;
    if (h != null) cone.style.transform = `rotate(${h}deg)`;
  }
  // Boussole : iPhone (webkitCompassHeading, autorisation requise), Android (deviceorientationabsolute)
  let rawHeading = null, rafPending = false;
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading;
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + so + 360) % 360;
    // lissage circulaire pour éviter que le cône tremble
    if (rawHeading == null) rawHeading = h;
    else { const d = ((h - rawHeading + 540) % 360) - 180; rawHeading = (rawHeading + d * 0.25 + 360) % 360; }
    heading = Math.round(rawHeading);
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; drawHeading(); if (calmTarget) calmNav(); }); }
  }
  async function enableCompass() {
    if (eco || compassOn || typeof DeviceOrientationEvent === 'undefined') return;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') { // iPhone : doit venir d'un appui
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
    }
    compassOn = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient, true);
    else window.addEventListener('deviceorientation', onOrient, true);
  }
  function onPosition(p) {
    const first = !me;
    me = [p.coords.latitude, p.coords.longitude]; meAcc = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : Infinity; meAt = Date.now();
    // Cap GPS quand on marche (secours si pas de boussole)
    gpsHeading = p.coords.speed > 0.8 && p.coords.heading != null && !isNaN(p.coords.heading) ? p.coords.heading : gpsHeading;
    if (!meMarker) meMarker = L.marker(me, { icon: meIcon(), interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map);
    else meMarker.setLatLng(me);
    calmNav(); if (ordState) ordState.later();
    const acc = Math.min(p.coords.accuracy || 0, 500);
    if (!accCircle) accCircle = L.circle(me, { radius: acc, interactive: false, className: 'me-acc' }).addTo(map);
    else accCircle.setLatLng(me).setRadius(acc);
    drawHeading();
    if (pushSub) pushSend(pushSub).catch(() => {});
    if (first) { map.setView(me, Math.max(map.getZoom(), 17)); setFollow(true); }
    else if (follow && $('#sheetReport').hidden && !popupOpen && !drawing && !picking) map.panTo(me, { animate: true, duration: 0.6, noMoveStart: true });
    else setFollow(follow);
  }
  function locate() {
    enableCompass(); // appelé depuis un appui : l'iPhone peut demander l'autorisation
    if (!navigator.geolocation) return toast('Géolocalisation indisponible sur cet appareil.');
    if (watchId != null) {
      if (me) { map.setView(me, Math.max(map.getZoom(), 16)); setFollow(true); }
      return;
    }
    watchId = navigator.geolocation.watchPosition(onPosition, err => {
      // Seul un refus coupe la localisation ; une perte de signal passagère (fréquente dehors) ne change rien.
      if (err.code === 1) {
        toast('Localisation refusée. Tu peux quand même signaler avec le viseur.');
        navigator.geolocation.clearWatch(watchId); watchId = null; setFollow(false);
      } else if (!me && !locate.warned) { locate.warned = true; toast('Recherche de ta position…'); }
    }, eco ? { enableHighAccuracy: false, maximumAge: 30_000, timeout: 60_000 } : { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
    setFollow(false);
  }
  // Déplacer la carte au doigt arrête le suivi ; une fiche de signalement ouverte le met en pause
  let popupOpen = false;
  map.on('popupopen', () => (popupOpen = true)); map.on('popupclose', () => (popupOpen = false));
  map.on('dragstart', () => { if (follow) setFollow(false); });
  btnLoc.onclick = locate;
  setFollow(false);
  // Si l'autorisation a déjà été donnée, on centre directement sur toi
  try { navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') locate(); }).catch(() => {}); } catch {}
  // Android n'a pas besoin d'autorisation pour la boussole : on l'allume dès le premier appui n'importe où
  document.addEventListener('pointerdown', () => { if (me) enableCompass(); }, { once: true, passive: true });

