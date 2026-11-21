  // ---- Itinéraire à pied qui contourne les dangers signalés ----
  // Le bouton « Y aller » des fiches (zone calme, medics, point de ralliement, lieu de repli, lieux utiles) charge à la demande le
  // calcul (public/street-route.js) et son affichage (public/app-trajet.js, client/parts/trajet.js). Tout se passe sur le téléphone :
  // la position n'est envoyée nulle part. Seulement avec une carte hébergée par le serveur (ses rues servent au calcul).
  var trajetMod = null;
  const GO_CATS = new Set(['calme', 'medic', 'legal', 'eau', 'secours']);
  function goTo(dest) {
    const lib = window.cortegeStreets ? Promise.resolve() : new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/street-route.js'; s.onload = ok; s.onerror = () => { s.remove(); ko(new Error('script')); }; document.head.append(s); });
    lib.then(() => loadPart('trajet', () => ({ $, t, tn, toast, map, CAT, cfg, reports, dist, fmtDist, addSheet, closeSheets, get me() { return me; } })))
      .then(m => { trajetMod = m; m.go(dest); }).catch(() => toast('Pas de réseau : l’itinéraire se chargera quand ça capte.'));
  }
  // Bouton à poser dans une fiche de la carte ; rien sans carte hébergée
  function goBtn(lat, lng, name) {
    if (!cfg.vector) return '';
    const b = el('button', { type: 'button', class: 'secondary go-btn' }, '🧭 ' + t('Y aller en évitant les dangers signalés'));
    b.onclick = () => goTo({ lat, lng, name });
    return b;
  }
