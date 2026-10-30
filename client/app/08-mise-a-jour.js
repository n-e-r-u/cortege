  // ---- Mise à jour automatique : nouvelle version publiée (fichiers + Restart) ----
  // Si la personne est en train de signaler ou d'écrire, on ne l'interrompt pas : bandeau, puis mise à jour dès qu'elle a fini.
  let buildSeen = null, updating = false;
  function busyNow() {
    const a = document.activeElement;
    return !$('#crosshair').hidden || !$('#noteCard').hidden || typingInPopup() || !!(a && a.matches && a.matches('input, textarea, select'))
      || sheets.some(s => s !== '#sheetInfo' && !$(s).hidden);
  }
  function reloadForUpdate() {
    try { const c = map.getCenter(); sessionStorage.setItem('cortege-view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch {}
    location.reload();
  }
  // Réglages changés par l'admin (bandeau, catégories, rayon d'alerte) : relus sans recharger l'appli
  let cfgSeen = cfg.cfgh || null;
  async function checkCfg(h) {
    if (!h || h === cfgSeen) return;
    cfgSeen = h;
    try {
      const c = await fetch('/api/config', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      try { localStorage.setItem('cortege-config', JSON.stringify(c)); } catch {}
      cfgSeen = c.cfgh || h; cfg.event = c.event; cfg.banner = c.banner; applyBanner();
      ALERT_RADIUS = c.alertRadius || 300; cfg.nearKm = c.nearKm;
      for (const x of c.categories || []) if (CAT[x.id]) Object.assign(CAT[x.id], { ttl: x.ttl, off: !!x.off });
      document.querySelectorAll('#catGrid .cat').forEach(b => { b.hidden = !!(CAT[b.dataset.cat] && CAT[b.dataset.cat].off); });
    } catch { cfgSeen = null; }
  }
  function checkBuild(b) {
    if (!b) return;
    if (!buildSeen) { buildSeen = b; return; }
    if (b === buildSeen || updating) return;
    updating = true;
    navigator.serviceWorker?.getRegistration?.().then(r => r && r.update()).catch(() => {});
    const bar = el('div', { class: 'update-bar', role: 'status' }, t('Nouvelle version de Cortège'));
    const btn = el('button', {}, t('Mettre à jour'));
    btn.onclick = reloadForUpdate; bar.append(btn); document.body.append(bar);
    // Dès que la personne ne fait rien de particulier (ou passe l'appli en arrière-plan), on met à jour
    const tryNow = () => { if (document.hidden || !busyNow()) { bar.textContent = t('Mise à jour de Cortège…'); setTimeout(reloadForUpdate, 1200); return true; } return false; };
    if (!tryNow()) { const t = setInterval(() => { if (tryNow()) clearInterval(t); }, 4000); document.addEventListener('visibilitychange', () => { if (document.hidden) reloadForUpdate(); }); }
  }

  // Bouton « Signaler » : onglet du bas et gros bouton du mode manif
  function reportBtn(state) {
    const lbl = t(state === 'paused' ? 'En pause' : state === 'active' ? 'Annuler' : 'Signaler');
    $('#reportLbl').textContent = lbl; $('#mbReportLbl').textContent = lbl;
    for (const b of [$('#btnReport'), $('#mbReport')]) { b.disabled = state === 'paused'; b.classList.toggle('active', state === 'active'); }
  }
  // Pause décidée par l'admin (afflux de faux signalements) : on le dit et on bloque le bouton
  let pausedUntil = 0;
  function setPaused(until) {
    pausedUntil = until || 0;
    const on = pausedUntil > Date.now();
    $('#pauseBanner').hidden = !on;
    if (on) { closeReport(); reportBtn('paused'); }
    else if ($('#crosshair').hidden) reportBtn('idle');
  }
  let syncing = false, again = false;
  async function sync() {
    clearTimeout(pollTimer);
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      if (useApi) await syncApi();
      else {
        try { await syncLive(); }
        catch (e) { if (e.status === 404) { useApi = true; await syncApi(); } else throw e; }
      }
      failures = 0; lastOk = Date.now(); dataAt = lastOk; saveSnapshot();
      setStatus('live', t(net.lite ? 'En direct · mode léger' : 'En direct')); freshness();
      if (!$('#queueChip').hidden) setTimeout(() => flushQueue(), 0);
    } catch {
      // Retour au premier plan : le téléphone met souvent quelques secondes à rouvrir le réseau.
      // Pendant ce temps, on dit « reconnexion » au lieu de « hors ligne », et on réessaie vite.
      if (document.hidden || Date.now() - resumeAt < RESUME_GRACE) {
        setStatus('live', t('Reconnexion…')); syncing = false;
        if (!document.hidden) { clearTimeout(pollTimer); pollTimer = setTimeout(sync, 1500); }
        return;
      }
      failures++;
      setStatus('offline', t(Date.now() - lastOk > 15000 ? 'Hors ligne, nouvel essai…' : 'Connexion instable…'));
      if (!fallbackTried) { fallbackTried = true; useFallback(); }
    }
    syncing = false;
    if (again) { again = false; return sync(); }
    // Rythme : 5 s s'il s'est passé quelque chose autour de toi dans les 2 dernières minutes, 12 s sinon,
    // 20 s en vue nationale (×3 en économie de batterie) ; on espace en cas d'échec, et on décale au hasard
    // pour que des milliers de téléphones ne demandent pas tous à la même seconde.
    const active = Date.now() - lastActivity < 120_000;
    // Temps réel connecté : le serveur prévient dès qu'une région affichée change, l'interrogation n'est plus qu'un filet de sécurité
    const base = (stream.ok && mode !== 'all' && mode !== 'nat' ? 30000 : mode === 'all' || mode === 'nat' ? 20000 : active ? POLL_MS : 12000) * (eco ? 3 : 1);
    const delay = (failures ? Math.min(60000, base * 2 ** Math.min(failures, 3)) : base) * (0.85 + Math.random() * 0.3);
    if (!document.hidden) pollTimer = setTimeout(sync, delay);
  }
