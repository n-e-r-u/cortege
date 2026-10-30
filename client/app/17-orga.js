  // ---- Espace orga / legal team ----
  // Le lien orga ressemble à https://cortege.neru.tv/?orga=CLÉ : la clé est gardée sur ce téléphone et retirée de l'adresse.
  const orgaKey = () => { try { return localStorage.getItem('cortege-orga') || ''; } catch { return ''; } };
  // Signalements faits par cette orga depuis ce téléphone : elle peut les prolonger ou les corriger
  const mine = new Set((() => { try { return JSON.parse(localStorage.getItem('cortege-mine') || '[]'); } catch { return []; } })());
  function mineAdd(id) { mine.add(id); try { localStorage.setItem('cortege-mine', JSON.stringify([...mine].slice(-200))); } catch {} }
  async function orgaFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Orga-Key': orgaKey(), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) { setOrga(null); try { localStorage.removeItem('cortege-orga'); } catch {} }
    if (!res.ok) throw new Error(body.error || 'Action impossible.');
    return body;
  }
  function setOrga(o) {
    orga = o;
    $('#btnOrga').hidden = !o;
    $('#orgaChip').hidden = !o;
    if (o) { $('#orgaChip').textContent = o.admin ? 'ADMIN' : o.trial ? t('ORGA · essai') : 'ORGA'; $('#orgaChip').title = o.label; $('#orgaName').textContent = o.label; }
    $('#orgaTrial').hidden = !(o && o.trial);
    $('#bkBox').hidden = !(o && !o.trial);
    // L'admin peut partager « son » point (logo), pour que les collectifs viennent le voir
    { const sel = $('#bkRole'), has = sel.querySelector('option[value="contact"]');
      if (o && o.admin && !has) sel.prepend(el('option', { value: 'contact' }, '★ ' + t('l’admin : viens me voir pour un accès orga')));
      if (!(o && o.admin) && has) has.remove(); }
    if (!o && beacon) beaconStop(false);
    $('#annNationalWrap').hidden = !(o && o.admin);
    $('#btnPropose').textContent = t(o ? 'Publier une manif ou un blocus' : 'Proposer un blocus ou une manif');
    $('#agFine').hidden = !!o;
  }
  (async () => {
    const params = new URLSearchParams(location.search);
    if (params.has('orga')) {
      try { localStorage.setItem('cortege-orga', params.get('orga')); } catch {}
      history.replaceState(null, '', location.pathname);
    }
    var justJoined = false;
    // Invitation par QR code : échangée une seule fois contre une clé, créée et gardée sur ce téléphone
    if (params.has('invite')) {
      const token = params.get('invite');
      history.replaceState(null, '', location.pathname);
      try {
        const res = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { toast(body.error || 'Invitation impossible.'); }
        else { try { localStorage.setItem('cortege-orga', body.key); } catch {} toast(body.device ? t('Appareil ajouté à l’espace orga {who}', { who: body.label }) : t('Bienvenue {who} : ton accès orga est activé sur ce téléphone', { who: body.label })); justJoined = !body.device; }
      } catch { toast('Pas de réseau : rouvre l’invitation quand ça capte.'); }
    }
    if (!orgaKey()) return;
    try {
      const who = await orgaFetch('/api/orga/me'); setOrga(who);
      // Premier accès : on ouvre l'espace orga pour que l'avertissement sur la perte d'accès soit lu
      if (justJoined) setTimeout(() => $('#btnOrga').click(), 600); else toast(t('Mode orga : {who}', { who: who.label }));
    }
    catch (e) { toast(e.message); }
  })();
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
  // Mes annonces (l'admin voit tout), y compris les numéros en attente de validation
  let mineAnns = null;
  async function loadMine() {
    if (!orga) return;
    try { mineAnns = (await orgaFetch('/api/orga/mine')).a || []; } catch { mineAnns = null; }
    if (!$('#sheetOrga').hidden) renderOrgaList();
  }
  function renderOrgaList() {
    const ol = $('#annList'); ol.textContent = '';
    const list = mineAnns || announcements;
    $('#annListTitle').textContent = t(mineAnns ? (orga && orga.admin ? 'Toutes les annonces actives' : 'Tes annonces actives') : 'Annonces actives ici');
    if (!list.length) { ol.append(el('li', { class: 'empty' }, mineAnns ? 'Aucune annonce publiée.' : 'Aucune annonce active ici.')); return; }
    for (const a of list) {
      const mine = orga && (orga.admin || (!!a.ob && a.ob === orga.ob));
      const del = el('button', { class: 'ghost' }, 'Retirer');
      del.disabled = !mine;
      del.onclick = async () => { try { await orgaFetch('/api/announcements/' + a.id, { method: 'DELETE' }); toast('Annonce retirée'); etag = null; sync(); loadMine(); } catch (e) { toast(e.message); } };
      ol.append(el('li', { class: 'ann-row' },
        el('div', { class: 't' }, el('div', { class: 'l' }, (a.pending ? '⏳ ' : '') + (a.kind === 'legal' ? '⚖ ' + (a.city ? a.city + ' · ' : '') + a.phone : (a.level === 'urgent' ? '⚠ ' : '') + a.text)),
          el('div', { class: 's' }, a.pending ? 'En attente de validation par l’admin : pas encore visible'
            : `${a.by} · ${a.national ? t('toute la France') : (a.kind === 'legal' ? t('visible partout, rangé par ville') : a.r + ' km')} · ${a.permanent ? t('permanent') : t('expire dans {d}', { d: left(a.exp) })}`)), del));
    }
  }
  $('#btnOrga').onclick = () => { closeReport(); closeSheets(); renderOrgaList(); renderOrgaExtras(); loadMine(); $('#sheetOrga').hidden = false; };
  // ---- Parrainage, appareils, avertissement sur l'accès ----
  const fmtExp = x => new Date(x).toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function showInviteOut(title, token, exp, fine) {
    const url = location.origin + '/?invite=' + token;
    $('#inviteTitle').textContent = t(title) + ' ' + t('(valable jusqu’au {date}, une seule fois)', { date: fmtExp(exp) });
    $('#inviteUrl').textContent = url; $('#inviteQr').textContent = '';
    if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#inviteQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
    $('#inviteFine').textContent = t(fine);
    $('#inviteShare').hidden = !navigator.share;
    $('#inviteOut').hidden = false; $('#inviteOut').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('#inviteCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#inviteUrl').textContent); toast('Lien copié'); } catch { toast($('#inviteUrl').textContent); } };
  $('#inviteShare').onclick = () => navigator.share?.({ title: 'Cortège', text: t('Lien à usage unique, à ouvrir sur le bon appareil :'), url: $('#inviteUrl').textContent }).catch(() => {});
  async function renderOrgaExtras() {
    $('#inviteOut').hidden = true;
    let me = orga;
    try { me = await orgaFetch('/api/orga/me'); setOrga({ ...orga, ...me }); } catch { return; }
    $('#orgaRecover').textContent = me.sponsor
      ? t('Pour retrouver un accès, il faudra une nouvelle invitation de {who} ou de l’admin, ce qui coupe l’ancien.', { who: me.sponsor })
      : t('Pour retrouver un accès, il faudra une nouvelle invitation de l’admin, ce qui coupe l’ancien.');
    $('#orgaAccessWarn').hidden = !!me.admin;
    $('#orgaSponsored').hidden = !me.sponsored;
    if (me.sponsored) $('#orgaSponsored').textContent = `Orga parrainée par ${me.sponsor || 'une autre orga'} : surveillance renforcée jusqu’à ta confirmation. « Vérifier » compte comme une confirmation forte (le point reste contestable), 5 retraits par 5 minutes et 3 annonces par jour au maximum. Après 7 jours et 10 actions sans incident, ${me.sponsor || 'ta marraine'} ou l’admin pourra te confirmer.`;
    // Appareils
    $('#btnAddDevice').hidden = !me.canAddDevice;
    $('#deviceState').textContent = me.canAddDevice
      ? t('{n} appareil(s) ont accès à cet espace orga (5 au plus). Ajouter un appareil crée un lien valable 10 minutes, à ouvrir sur l’autre appareil (ordinateur, deuxième téléphone…). Cet appareil-ci garde son accès.', { n: me.devices || 1 })
      : t('Ton accès est défini directement dans les réglages du serveur : demande à l’admin pour un autre appareil.');
    // Invitations
    const box = $('#orgaInviteBox');
    box.hidden = !!me.trial;
    if (me.trial) return;
    $('#orgaInviteForm').hidden = !me.canInvite;
    renderFilleules(me);
  }
  async function renderFilleules(me) {
    const ul = $('#filleulList'); ul.textContent = '';
    if (me && me.ban) ul.append(el('li', {}, '⛔ ' + t('Invitations suspendues jusqu’au {date} : une orga que tu as invitée a été révoquée pour abus.', { date: fmtExp(me.ban) })));
    let d; try { d = await orgaFetch('/api/orga/filleules'); } catch (e) { return; }
    if (!d.orgas.length && !(me && me.ban)) { ul.append(el('li', { class: 'st' }, 'Aucune orga invitée pour l’instant.')); return; }
    for (const o of d.orgas) {
      const status = !o.trial ? '✓ ' + t('confirmée') : !o.active ? t(o.invite ? 'invitation en attente' : 'invitation expirée') : o.ready ? t('prête à être confirmée') : t('parrainée · {d} j · {n} action(s)', { d: o.days, n: o.actions });
      const li = el('li', {}, el('b', {}, o.label), el('span', { class: o.ready && o.trial ? 'ready' : 'st' }, status
        + (o.trial && o.active && !o.ready ? ` (il faut 7 j et 10 actions${o.bursts || o.restored ? ', et aucun incident : ' + (o.bursts ? o.bursts + ' rafale(s) bloquée(s) ' : '') + (o.restored ? o.restored + ' retrait(s) annulé(s) par l’admin' : '') : ''})` : '')));
      if (o.recent.length) {
        const det = el('details', {}, el('summary', {}, 'Dernières actions'));
        for (const x of o.recent) det.append(el('div', {}, new Date(x.t).toLocaleString(I18N.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + x.action + (x.cat && CAT[x.cat] ? ' ' + CAT[x.cat].glyph : '')));
        li.append(det);
      }
      const btns = el('div', { class: 'row-btns' });
      if (o.trial && o.ready) {
        const c = el('button', { class: 'secondary' }, 'Confirmer cette orga');
        c.onclick = async () => { try { await orgaFetch(`/api/orga/filleules/${o.id}/confirm`, { method: 'POST', body: '{}' }); toast(t('{who} est confirmée', { who: o.label })); renderFilleules(me); } catch (e) { toast(e.message); } };
        btns.append(c);
      }
      const inv = el('button', { class: 'secondary' }, o.active ? 'Nouvelle invitation (accès perdu)' : 'Nouvelle invitation');
      inv.onclick = async () => {
        if (o.active && !inv.dataset.armed) { inv.dataset.armed = '1'; inv.textContent = t('Confirmer : son accès actuel sera coupé'); return; }
        try { const r = await orgaFetch(`/api/orga/filleules/${o.id}/invite`, { method: 'POST', body: '{}' }); showInviteOut(t('Invitation pour {who}', { who: r.label }), r.invite, r.exp, 'Envoie-la par une messagerie chiffrée (Signal). L’ancien accès de cette orga est coupé.'); renderFilleules(me); } catch (e) { toast(e.message); }
      };
      btns.append(inv); li.append(btns); ul.append(li);
    }
  }
  $('#orgaInviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await orgaFetch('/api/orga/invite', { method: 'POST', body: JSON.stringify({ label: $('#orgaInviteLabel').value }) });
      $('#orgaInviteLabel').value = '';
      showInviteOut(t('Invitation pour {who}', { who: r.label }), r.invite, r.exp, 'L’orga scanne ce QR code ou ouvre le lien sur son téléphone. Envoie le lien par une messagerie chiffrée (Signal), jamais publiquement.');
      renderFilleules(orga);
    } catch (err) { toast(err.message); }
  });
  $('#btnAddDevice').onclick = async () => {
    try { const r = await orgaFetch('/api/orga/device', { method: 'POST', body: '{}' }); showInviteOut('Ajouter un appareil', r.invite, r.exp, 'Scanne ce QR code avec l’autre appareil (ou ouvre-y le lien). Ne l’envoie à personne d’autre : il donne accès à ton espace orga.'); }
    catch (e) { toast(e.message); }
  };
  $('#orClose').onclick = () => closeSheets();
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
  document.querySelectorAll('input[name="kind"]').forEach(r => r.addEventListener('change', () => {
    const legal = document.querySelector('input[name="kind"]:checked').value === 'legal';
    $('#annInfoFields').hidden = legal; $('#annLegalFields').hidden = !legal;
    $('#annMinutesWrap').hidden = legal; $('#annLegalHint').hidden = !legal;
    annZoneUI();
  }));
  // Annonce nationale (admin) : pas de rayon
  const annZoneUI = () => { $('#annRadiusWrap').hidden = $('#annInfoFields').hidden || $('#annNational').checked; };
  $('#annNational').addEventListener('change', annZoneUI);
