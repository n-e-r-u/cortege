  // ---- Espace orga / legal team ----
  // Le lien orga ressemble à https://cortege.neru.tv/?orga=CLÉ : la clé est gardée sur ce téléphone et retirée de l'adresse.
  const orgaKey = () => keyGet('orga');
  // Signalements faits par cette orga depuis ce téléphone : elle peut les prolonger ou les corriger
  const mine = new Set((() => { try { return JSON.parse(localStorage.getItem('cortege-mine') || '[]'); } catch { return []; } })());
  function mineAdd(id) { mine.add(id); try { localStorage.setItem('cortege-mine', JSON.stringify([...mine].slice(-200))); } catch {} }
  async function orgaFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Orga-Key': orgaKey(), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    // La clé n'est oubliée que si le serveur dit qu'elle n'existe plus : une action interdite ou « trop d'essais » la laisse en place
    if (res.status === 403 && body.gone) { setOrga(null); keySet('orga', null); }
    if (!res.ok) throw Object.assign(new Error(body.error || t('Action impossible.')), body.needCode ? { needCode: true } : {});
    return body;
  }
  // Coupe côté serveur la clé de ce téléphone (ou tous les autres appareils) avant de l'effacer ici ; 1,5 s au plus, sans bloquer s'il n'y a pas de réseau
  const orgaRevoke = (others = false) => !orgaKey() ? Promise.resolve() : Promise.race([
    orgaFetch('/api/orga/revoke', { method: 'POST', body: JSON.stringify(others ? { others: true } : {}) }).catch(() => {}),
    new Promise(r => setTimeout(r, 1500))]);
  // Espace orga : sa fiche et son script (public/app-orga.js) ne sont chargés que sur un téléphone qui a une clé d'orga
  let orgaMod = null;
  function setOrga(o) {
    orga = o;
    $('#btnOrga').hidden = !o;
    $('#orgaChip').hidden = !o;
    if (o) { $('#orgaChip').textContent = o.admin ? 'ADMIN' : o.trial ? t('ORGA · essai') : 'ORGA'; $('#orgaChip').title = o.label; }
    $('#btnPropose').textContent = t(o ? 'Publier une manif ou un blocus' : 'Proposer un blocus ou une manif');
    $('#agFine').hidden = !!o;
    if (orgaMod) orgaMod.onOrga(o);
  }
  (async () => {
    await keysReady;
    const params = new URLSearchParams(START_QS); // l'adresse d'arrivée : un autre lien (point, position) a pu vider l'adresse entre-temps
    if (params.has('orga')) {
      // Un lien reçu ne remplace pas en silence la clé déjà enregistrée (sinon un lien piégé ferait publier sous un autre compte)
      const nk = params.get('orga'); let ok = true;
      try { const cur = localStorage.getItem('cortege-orga'); if (cur && cur !== nk) ok = confirm(t('Ce lien remplace la clé orga enregistrée sur ce téléphone par une autre. Continuer ?')); } catch {}
      if (ok) keySet('orga', nk);
      history.replaceState(null, '', location.pathname);
    }
    var justJoined = false, joinRec = null;
    // Invitation par QR code : échangée une seule fois contre une clé, créée et gardée sur ce téléphone
    if (params.has('invite')) {
      const token = params.get('invite');
      history.replaceState(null, '', location.pathname);
      try {
        const res = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { toast(body.error || 'Invitation impossible.'); }
        else if (body.medic) { keySet('medic', body.key); if (body.rec) showRec(body.rec, 'medic'); else toast(body.device ? t('Appareil ajouté à l’équipe medic {who}', { who: body.label }) : t('Bienvenue {who} : ton accès medic est activé sur ce téléphone', { who: body.label })); medicInit(); }
        else { keySet('orga', body.key); toast(body.device ? t('Appareil ajouté à l’espace orga {who}', { who: body.label }) : t('Bienvenue {who} : ton accès orga est activé sur ce téléphone', { who: body.label })); justJoined = !body.device; if (body.rec) joinRec = body.rec; }
      } catch { toast('Pas de réseau : rouvre l’invitation quand ça capte.'); }
    }
    if (!orgaKey()) return;
    try {
      const who = await orgaFetch('/api/orga/me');
      await orgaPart(); setOrga(who);
      // Premier accès : on ouvre l'espace orga pour que l'avertissement sur la perte d'accès soit lu
      // Première ouverture : onglet « Mon orga », pour voir tout de suite comment ne pas perdre l'accès
      // Le code de secours est montré tout de suite, une seule fois ; l'espace orga s'ouvre quand il est noté
      const openSpace = () => { try { localStorage.setItem('cortege-orga-tab', 'compte'); } catch {} setTimeout(() => $('#btnOrga').click(), 300); };
      if (justJoined && joinRec) showRec(joinRec, 'orga', openSpace);
      else if (justJoined) openSpace();
      else if (params.has('espace')) { history.replaceState(null, '', location.pathname); openSpace(); }
      else toast(t('Mode orga : {who}', { who: who.label }));
    }
    catch (e) { toast(e.message); }
  })();
  // Pas de réseau et script pas encore gardé sur le téléphone : l'erreur est dite, l'accès revient à la prochaine ouverture
  function orgaPart() {
    return loadPart('orga', () => ({ $, el, t, tn, toast, map, I18N, MIN, CAT, cfg, IOS_WARN, iosEvict, keySet, showRec, closeReport, closeSheets, qrSvg, left, fmtHour, fmtExp, dist, reports,
      orgaFetch, orgaRevoke, setOrga, setFollow, sync, resync() { etag = null; sync(); }, openEventForm, addSheet,
      get orga() { return orga; }, get me() { return me; }, get pushSub() { return pushSub; }, get announcements() { return announcements; }, get evCache() { return evCache; } }))
      .then(m => { orgaMod = m; return m; }, () => { throw new Error(t('Pas de réseau : l’espace orga se chargera quand ça capte.')); });
  }
  async function ownAction(id, action, body = {}) {
    try {
      const out = await orgaFetch(`/api/reports/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      toast(action === 'extend' ? t('Prolongé : expire dans {d}', { d: left(out.exp) }) : 'Signalement corrigé');
      map.closePopup(); etag = null; sync();
    } catch (e) { toast(e.message); }
  }
  async function orgaAction(id, action) {
    try {
      const out = await orgaFetch(`/api/reports/${id}/${action}`, { method: 'POST', body: '{}' });
      toast(action === 'verify' ? 'Signalement marqué vérifié' : out && out.removed ? 'Signalement retiré' : 'Pris en compte : vaut deux « Plus là » (période d’essai)');
      map.closePopup(); etag = null; sync();
    } catch (e) { toast(e.message); }
  }
  const fmtExp = x => new Date(x).toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function openJoin(city) {
    closeReport(); closeSheets();
    if (city) $('#joCity').value = city;
    $('#sheetJoin').hidden = false;
  }
  $('#orgaRequest').onclick = () => openJoin();
  $('#joClose').onclick = () => closeSheets();
  $('#joinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { collective: $('#joCollective').value, city: $('#joCity').value, role: $('#joRole').value, link: $('#joLink').value,
      contact: $('#joContact').value, since: $('#joSince').value, sponsor: $('#joSponsor').value, note: $('#joNote').value };
    try {
      const r = await fetch('/api/orga-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return toast(j.error || 'Envoi impossible, réessaie.');
      $('#joinForm').reset(); closeSheets();
      toast('Demande envoyée : on te recontacte par le canal du collectif');
    } catch { toast('Pas de réseau : réessaie plus tard'); }
  });
  { const q = new URLSearchParams(location.search), city = q.get('rejoindre');
    if (city !== null) { history.replaceState(null, '', location.pathname); setTimeout(() => openJoin(city.slice(0, 60)), 800); } }
