'use strict';
// ---- Espace orga : annonces, position en direct, lieux de repli, réseau (invitations), tableau de bord, accès ----
// Chargé à la demande (public/app-orga.js, avec la fiche « Espace orga »), seulement sur les téléphones qui ont une clé
// d'orga : voir client/app/17-orga.js. `core` donne les outils du reste de l'appli ; ce qui y change au fil du temps
// (position du téléphone, abonnement aux notifications, annonces affichées) se lit par core.me, core.pushSub, core.announcements.
window.cortegeOrga = function (core) {
  const { $, el, t, tn, toast, map, I18N, MIN, CAT, cfg, IOS_WARN, iosEvict, keySet, showRec, closeReport, closeSheets, qrSvg, left, fmtHour, fmtExp, dist, reports,
    orgaFetch, setOrga, sync, resync, openEventForm } = core;
  let orga = core.orga;   // l'orga de ce téléphone : tenue à jour par onOrga, appelé par le reste de l'appli à chaque changement
  let beacon = null;      // position partagée en direct : { role, until, timer, lock }
  core.addSheet(window.cortegeHtml.orga);

  function onOrga(o) {
    orga = o;
    if (o) $('#orgaName').textContent = o.label;
    $('#orgaTrial').hidden = !(o && o.trial);
    $('#bkBox').hidden = !(o && !o.trial);
    // L'admin peut partager « son » point (logo), pour que les collectifs viennent le voir
    { const sel = $('#bkRole'), has = sel.querySelector('option[value="contact"]');
      if (o && o.admin && !has) sel.prepend(el('option', { value: 'contact' }, '★ ' + t('l’admin : viens me voir pour un accès orga')));
      if (!(o && o.admin) && has) has.remove(); }
    if (!o && beacon) beaconStop(false);
    $('#annNationalWrap').hidden = !(o && o.admin);
    // Annonces : réservées aux orgas certifiées (pas en essai), dans un rayon de 3 km au plus ; l'admin n'a pas de limite
    { const certified = !!(o && !o.trial), admin = !!(o && o.admin);
      const info = document.querySelector('input[name="kind"][value="info"]'), legal = document.querySelector('input[name="kind"][value="legal"]'),
        rally = document.querySelector('input[name="kind"][value="rally"]');
      info.closest('label').hidden = rally.closest('label').hidden = !certified;
      if (!certified && (info.checked || rally.checked)) { legal.checked = true; legal.dispatchEvent(new Event('change')); }
      for (const op of $('#annRadius').options) op.hidden = op.disabled = !admin && +op.value > 3;
      if (!admin && +$('#annRadius').value > 3) $('#annRadius').value = '3'; }
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
    const list = mineAnns || core.announcements;
    $('#annListTitle').textContent = t(mineAnns ? (orga && orga.admin ? 'Toutes les annonces actives' : 'Tes annonces actives') : 'Annonces actives ici');
    if (!list.length) { ol.append(el('li', { class: 'empty' }, mineAnns ? t('Aucune annonce publiée.') : t('Aucune annonce active ici.'))); return; }
    for (const a of list) {
      const mine = orga && (orga.admin || (!!a.ob && a.ob === orga.ob));
      const del = el('button', { class: 'ghost' }, 'Retirer');
      del.disabled = !mine;
      del.onclick = async () => { try { await orgaFetch('/api/announcements/' + a.id, { method: 'DELETE' }); toast('Annonce retirée'); resync(); loadMine(); } catch (e) { toast(e.message); } };
      ol.append(el('li', { class: 'ann-row' },
        el('div', { class: 't' }, el('div', { class: 'l' }, (a.pending ? '⏳ ' : '') + (a.kind === 'legal' ? '⚖ ' + (a.city ? a.city + ' · ' : '') + a.phone : (a.kind === 'rally' ? '🚩 ' : '') + (a.level === 'urgent' ? '⚠ ' : '') + a.text)),
          el('div', { class: 's' }, a.pending ? 'En attente de validation par l’admin : pas encore visible'
            : `${a.by} · ${a.national ? t('toute la France') : (a.kind === 'legal' ? t('visible partout, rangé par ville') : a.r + ' km')} · ${a.permanent ? t('permanent') : t('expire dans {d}', { d: left(a.exp) })}`)), del));
    }
  }
  $('#btnOrga').onclick = () => { closeReport(); closeSheets(); renderOrgaList(); renderOrgaExtras(); loadMine(); $('#sheetOrga').hidden = false; };
  function showInviteOut(title, token, exp, fine) {
    const url = location.origin + '/?invite=' + token;
    $('#inviteTitle').textContent = t(title) + ' ' + t('(valable jusqu’au {date}, une seule fois)', { date: fmtExp(exp) });
    $('#inviteUrl').textContent = url; $('#inviteQr').textContent = '';
    qrSvg(url, 6).then(svg => { if ($('#inviteUrl').textContent === url) $('#inviteQr').innerHTML = svg; }).catch(() => {});
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
    renderBoard();
    $('#orgaRecover').textContent = me.sponsor
      ? t('Pour retrouver un accès, il faudra une nouvelle invitation de {who} ou de l’admin, ce qui coupe l’ancien.', { who: me.sponsor })
      : t('Pour retrouver un accès, il faudra une nouvelle invitation de l’admin, ce qui coupe l’ancien.');
    // Avertissement « un seul appareil » : tant qu'il n'y a ni deuxième appareil ni code de secours
    $('#orgaAccessWarn').hidden = !!me.admin || !me.canAddDevice || me.rec || (me.devices || 1) > 1;
    // Code de secours
    $('#btnOrgaRec').hidden = !me.canAddDevice; $('#btnOrgaRec').textContent = me.rec ? t('Créer un nouveau code de secours') : t('Créer mon code de secours');
    $('#orgaRecState').textContent = !me.canAddDevice ? t('Ton accès est défini dans les réglages du serveur : pas de code de secours.')
      : me.rec ? t('Tu as un code de secours. Si tu l’as égaré, crées-en un nouveau : l’ancien ne servira plus.')
        : t('Pas encore de code de secours. Il te redonne ton accès sur un autre téléphone si celui-ci est perdu, saisi ou vidé, sans dépendre de personne.');
    $('#orgaRecAt').hidden = !me.recAt;
    if (me.recAt) $('#orgaRecAt').textContent = t('⚠ Accès récupéré avec le code de secours le {date}. Si ce n’est pas toi, crée un nouveau code tout de suite et préviens l’admin.', { date: fmtExp(me.recAt) });
    $('#orgaEveWarn').hidden = !me.warn;
    if (me.warn) $('#orgaEveWarn').textContent = t('Journée de mobilisation toute proche : ton accès n’a ni code de secours ni deuxième appareil. Crée ton code maintenant.');
    $('#orgaIosWarn').hidden = !iosEvict(); $('#orgaIosWarn').textContent = IOS_WARN;
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
  // ---- Tableau de bord : chiffres du journal de l'orga, prochains rendez-vous, rappels, affiche ----
  const REMIND_KEY = 'cortege-orga-remind';
  const remindOn = () => { try { return localStorage.getItem(REMIND_KEY) === '1'; } catch { return false; } };
  // L'adresse de notification est renvoyée à chaque ouverture tant que le rappel est demandé (le serveur a pu l'oublier)
  async function remindSync() {
    if (!orga || !remindOn() || !core.pushSub) return false;
    try { await orgaFetch('/api/orga/remind', { method: 'POST', body: JSON.stringify({ sub: core.pushSub.toJSON(), lang: I18N.lang }) }); return true; } catch { return false; }
  }
  async function remindOff() {
    try { localStorage.removeItem(REMIND_KEY); } catch {}
    if (orga && core.pushSub) { try { await orgaFetch('/api/orga/remind', { method: 'DELETE', body: JSON.stringify({ endpoint: core.pushSub.endpoint }) }); } catch {} }
  }
  const posterUrl = e => '/affiche.html?orga=' + encodeURIComponent(orga.label) + (e ? '&rdv=' + encodeURIComponent(fmtExp(e.start) + ' · ' + (e.place || e.title)) + '&at=' + e.lat + ',' + e.lng : '');
  async function renderBoard() {
    const box = $('#orgaBoard');
    let d; try { d = await orgaFetch('/api/orga/board'); } catch { box.hidden = true; return; }
    box.hidden = false;
    const tiles = $('#obTiles'); tiles.textContent = '';
    for (const [k, label] of [['verified', t('Signalements vérifiés')], ['removed', t('Faux retirés')], ['announcements', t('Annonces et numéros')], ['events', t('Rendez-vous publiés')]])
      tiles.append(el('div', { class: 'ob-tile' }, el('b', {}, String(d.month[k])), el('span', {}, label), el('small', {}, t('{n} depuis le début', { n: d.total[k] }))));
    $('#obSince').textContent = d.since ? t('Première action le {date}. Ces chiffres viennent du journal de ton orga, que l’admin voit aussi.', { date: new Date(d.since).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'long', year: 'numeric' }) })
      : t('Rien pour l’instant : vérifie un signalement ou publie un rendez-vous, il apparaîtra ici.');
    const ul = $('#obEvents'); ul.textContent = '';
    if (!d.events.length) ul.append(el('li', { class: 'empty' }, t('Aucun rendez-vous à venir. Publie une manif ou un blocus depuis l’onglet Annonces.')));
    for (const e of d.events) {
      const poster = el('a', { href: posterUrl(e), target: '_blank', rel: 'noopener' }, t('Affiche'));
      ul.append(el('li', {}, el('div', { class: 't' }, el('div', { class: 'l' }, document.createTextNode((e.pending ? '⏳ ' : '') + e.title)),
        el('div', { class: 's' }, document.createTextNode(fmtExp(e.start) + (e.place ? ' · ' + e.place : '') + ' · '
          + (e.pending ? t('en attente de validation') : e.reach ? t('environ {n} téléphones recevraient une annonce urgente ici', { n: e.reach }) : t('peu de téléphones abonnés aux alertes ici pour l’instant')) + ' · '), poster))));
    }
    $('#obPoster').href = posterUrl(null);
    // Rappels : seulement avec les notifications activées sur ce téléphone
    $('#obRemindWrap').hidden = !d.remind.can;
    $('#obRemind').checked = remindOn() && !!core.pushSub;
  }
  // Rappel ouvert pendant que l'appli tourne : on va à « Mon orga »
  navigator.serviceWorker?.addEventListener('message', e => {
    if (orga && e.data && e.data.type === 'goto' && /[?&]espace=orga/.test(String(e.data.url || ''))) { try { localStorage.setItem('cortege-orga-tab', 'compte'); } catch {} $('#btnOrga').click(); }
  });
  $('#obRemind').onchange = async () => {
    const box = $('#obRemind');
    if (!box.checked) { await remindOff(); toast(t('Rappels coupés : l’adresse de notification est retirée du serveur')); return; }
    if (!core.pushSub) { box.checked = false; toast(t('Active d’abord les alertes sur ce téléphone (menu, Alertes), puis reviens cocher le rappel.')); return; }
    try { localStorage.setItem(REMIND_KEY, '1'); } catch {}
    if (await remindSync()) toast(t('Rappels activés : la veille et deux heures avant chaque rendez-vous')); else { box.checked = false; try { localStorage.removeItem(REMIND_KEY); } catch {} toast(t('Action impossible.')); }
  };
  async function renderFilleules(me) {
    const ul = $('#filleulList'); ul.textContent = '';
    if (me && me.ban) ul.append(el('li', {}, '⛔ ' + t('Invitations suspendues jusqu’au {date} : une orga que tu as invitée a été révoquée pour abus.', { date: fmtExp(me.ban) })));
    let d; try { d = await orgaFetch('/api/orga/filleules'); } catch (e) { return; }
    if (!d.orgas.length && !(me && me.ban)) { ul.append(el('li', { class: 'st' }, t('Aucune orga invitée pour l’instant.'))); return; }
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
  $('#btnOrgaRec').onclick = async () => {
    try { const r = await orgaFetch('/api/orga/recovery', { method: 'POST', body: '{}' }); showRec(r.rec, 'orga', () => $('#btnOrga').click()); }
    catch (e) { toast(e.message); }
  };
  $('#orClose').onclick = () => closeSheets();
  document.querySelectorAll('input[name="kind"]').forEach(r => r.addEventListener('change', () => {
    const kind = document.querySelector('input[name="kind"]:checked').value, legal = kind === 'legal', rally = kind === 'rally';
    $('#annInfoFields').hidden = legal; $('#annLegalFields').hidden = !legal;
    // Point de ralliement : même formulaire qu'une annonce, sans « nationale », texte d'aide propre
    $('#annRallyHint').hidden = !rally; $('#annNationalWrap').hidden = rally || !(orga && orga.admin);
    $('#annTextLabel').textContent = rally ? t('Où et comment se retrouver') : t('Message');
    $('#annText').placeholder = rally ? t('ex. : si dispersion, rendez-vous devant la fac de lettres, entrée côté parc') : t('ex. : Dispersion annoncée place de la Comédie, repli par le boulevard Sarrail');
    $('#annMinutesWrap').hidden = legal; $('#annLegalHint').hidden = !legal;
    annZoneUI();
  }));
  // Annonce nationale (admin) : pas de rayon
  const annZoneUI = () => { $('#annRadiusWrap').hidden = $('#annInfoFields').hidden || $('#annNational').checked; };
  $('#annNational').addEventListener('change', annZoneUI);
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
    if (!core.me) return false;
    for (const { data: r } of reports.values()) if (r.id !== beacon.id && dist(core.me, [r.lat, r.lng]) <= ISO_M) return false;
    for (const e of core.evCache.e) if (Math.abs(e.start - Date.now()) < 6 * 3600e3 && (dist(core.me, [e.lat, e.lng]) <= ISO_M || (e.route || []).some(p => dist(core.me, p) <= ISO_M))) return false;
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
    if (!core.me) { $('#bkState').textContent = t('En attente de ta position…'); return; }
    // Plus aucun envoi réussi depuis 3 min (pas de réseau, téléphone en veille) : le serveur a oublié le point de départ,
    // le partage s'arrête ici plutôt que de reprendre ailleurs
    if (beacon.okAt && now - beacon.okAt > 3 * MIN) { toast(t('Connexion perdue : partage de position arrêté')); return beaconStop(false, true); }
    try {
      // start : seulement tant que le partage n'a jamais été accepté (après le bouton), jamais pour un envoi suivant
      const r = await orgaFetch('/api/orga/beacon', { method: 'POST', body: JSON.stringify({ role: beacon.role, lat: core.me[0], lng: core.me[1], note: beacon.note, ...(beacon.okAt ? {} : { start: true }) }) });
      if (beacon && r && r.id) { beacon.id = r.id; beacon.okAt = Date.now(); }
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
    if (!core.me) { toast('Active d’abord ta position (bouton ◎)'); return; }
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
      national: kind === 'info' && !!(orga && orga.admin && $('#annNational').checked) });
    try {
      const out = await orgaFetch('/api/announcements', { method: 'POST', body: JSON.stringify(body) });
      if (out && out.pending) toast(out.kind === 'legal' ? 'Numéro envoyé : il s’affichera après validation par l’admin' : 'Annonce envoyée : elle s’affichera après validation par l’admin');
      else toast(out && out.kind === 'rally' ? 'Point de ralliement publié' : 'Annonce publiée');
      $('#annText').value = ''; $('#annPhone').value = ''; $('#annLegalText').value = ''; $('#annCity').value = ''; $('#annNational').checked = false; annZoneUI();
      resync(); loadMine();
    } catch (err) { toast(err.message); }
  });
  $('#btnOrgaLogout').onclick = () => {
    const b = $('#btnOrgaLogout');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = t('Confirmer : l’accès sera perdu sur cet appareil (il faudra une nouvelle invitation)'); setTimeout(() => { delete b.dataset.armed; b.textContent = t('Quitter le mode orga sur ce téléphone'); }, 6000); return; }
    remindOff().finally(() => { keySet('orga', null); setOrga(null); });
    closeSheets(); toast('Mode orga désactivé sur ce téléphone');
  };

  // ---- Espace orga : lieux de repli (orgas certifiées) ----
  {
    const RC = cfg.refuge || { glyphs: ['🕊️'], colors: ['#30a46c'], services: [] };
    const SV_LABEL = { eau: '💧 ' + t('Eau'), wc: '🚻 ' + t('Toilettes'), ecoute: '👂 ' + t('Écoute'), recharge: '🔋 ' + t('Recharge'), soins: '🩹 ' + t('Premiers soins'),
      abri: '☂️ ' + t('À l’abri'), pmr: '♿ ' + t('Accessible PMR') };
    const box = $('#refugeBox'), form = $('#refugeForm'), msg = s => { $('#refugeMsg').textContent = s || ''; };
    let list = [], max = 1, editing = null, pos = null, glyph = RC.glyphs[0], color = RC.colors[0];
    const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const at = (v, base = Date.now()) => { const [h, m] = String(v || '').split(':').map(Number); const d = new Date(base); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
    // Créneau choisi : une fermeture plus tôt que l'ouverture veut dire le lendemain
    function slot() {
      const now = Date.now(), from = $('#rfFrom').value ? at($('#rfFrom').value) : now;
      let to = at($('#rfTo').value); if (to <= from) to += 24 * 3600e3;
      return { from: Math.max(from, now - 60 * 60e3), to };
    }
    // Pictogrammes, couleurs, services : boutons et cases construits une fois
    for (const s of RC.services) $('#rfServices').append(el('label', { class: 'check' }, el('input', { type: 'checkbox', value: s }), ' ' + (SV_LABEL[s] || s)));
    const pick = (boxSel, vals, cur, set, render) => {
      const b = $(boxSel);
      for (const v of vals) { const x = el('button', { type: 'button', class: 'pick', 'data-v': v, 'aria-pressed': 'false' }, render(v)); x.onclick = () => { set(v); syncPick(); }; b.append(x); }
    };
    pick('#rfGlyphs', RC.glyphs, glyph, v => { glyph = v; }, v => v);
    pick('#rfColors', RC.colors, color, v => { color = v; }, v => el('span', { class: 'swatch', style: `background:${v}` }));
    function syncPick() {
      document.querySelectorAll('#rfGlyphs .pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === glyph)));
      document.querySelectorAll('#rfColors .pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === color)));
      document.querySelectorAll('#rfGlyphs .pick').forEach(b => { b.style.background = b.dataset.v === glyph ? color : ''; });
    }
    const showPos = () => { $('#rfPos').textContent = pos ? t('Position du lieu : {pos}', { pos: pos[0].toFixed(4) + ', ' + pos[1].toFixed(4) }) : t('Déplace la carte sur le lieu, puis place-le au centre.'); };
    $('#rfHere').onclick = () => { const c = map.getCenter(); pos = [c.lat, c.lng]; showPos(); };
    function openForm(r) {
      editing = r ? r.id : null;
      $('#rfName').value = r ? r.name : ''; $('#rfShort').value = r ? r.short : ''; $('#rfAddr').value = r ? r.addr : '';
      $('#rfMsg').value = r ? r.msg : ''; $('#rfUrl').value = r ? r.url : '';
      document.querySelectorAll('#rfServices input').forEach(i => { i.checked = !!(r && r.services.includes(i.value)); });
      glyph = r ? r.glyph : RC.glyphs[0]; color = r ? r.color : RC.colors[0];
      $('#rfUseLogo').checked = !!(r && r.useLogo); $('#rfConsent').checked = !!(r && r.consent);
      pos = r ? [r.lat, r.lng] : null; showPos(); syncPick();
      form.hidden = false; $('#rfAdd').hidden = true; $('#rfName').focus();
    }
    const canAdd = () => list.length < max;
    function closeForm() { form.hidden = true; $('#rfAdd').hidden = !canAdd(); editing = null; }
    $('#rfAdd').onclick = () => openForm(null);
    $('#rfCancel').onclick = closeForm;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pos) { msg(t('Place le lieu sur la carte.')); return; }
      const body = { name: $('#rfName').value, short: $('#rfShort').value, addr: $('#rfAddr').value, msg: $('#rfMsg').value, url: $('#rfUrl').value, lat: pos[0], lng: pos[1],
        services: [...document.querySelectorAll('#rfServices input:checked')].map(i => i.value), glyph, color, useLogo: $('#rfUseLogo').checked, consent: $('#rfConsent').checked };
      try {
        await orgaFetch('/api/orga/refuges' + (editing ? '/' + editing : ''), { method: 'POST', body: JSON.stringify(body) });
        closeForm(); msg(t('Lieu enregistré.')); load();
      } catch (err) { msg(err.message); }
    });
    const state = r => { const now = Date.now();
      if (r.state === 'closed' || !(r.to > now)) return t('Fermé');
      if (r.from > now) return t('Ouvre à {h}', { h: hhmm(r.from) });
      return (r.state === 'full' ? t('Complet') : t('Ouvert')) + ' · ' + t('jusqu’à {h}', { h: hhmm(r.to) }); };
    function render() {
      const ul = $('#refugeList'); ul.textContent = '';
      $('#refugeOpen').hidden = !list.length;
      for (const r of list) {
        const now = Date.now(), open = r.state !== 'closed' && r.to > now;
        const act = (label, fn, cls = 'ghost') => { const b = el('button', { type: 'button', class: cls }, label); b.onclick = fn; return b; };
        const setState = s => async () => { try { await orgaFetch(`/api/orga/refuges/${r.id}/state`, { method: 'POST', body: JSON.stringify({ state: s }) }); load(); } catch (err) { msg(err.message); } };
        const openOne = async () => { try { await orgaFetch('/api/orga/refuges/open', { method: 'POST', body: JSON.stringify({ ids: [r.id], ...slot() }) }); load(); } catch (err) { msg(err.message); } };
        const del = async () => { if (!confirmDel(r)) return; try { await orgaFetch('/api/orga/refuges/' + r.id, { method: 'DELETE' }); load(); } catch (err) { msg(err.message); } };
        ul.append(el('li', { class: 'refuge-item' + (open ? ' on' : '') },
          el('span', { class: 'refuge-dot', style: `background:${r.color}` }, r.glyph),
          el('div', { class: 'refuge-txt' }, el('b', {}, r.name), el('small', {}, state(r) + (r.addr ? ' · ' + r.addr : '') + (r.orga && r.orga.includes(', ') ? ' · ' + t('Partagé avec : {who}', { who: r.orga }) : ''))),
          el('div', { class: 'refuge-acts' }, ...[
            open ? act(r.state === 'full' ? t('Plus complet') : t('Complet'), setState(r.state === 'full' ? 'open' : 'full')) : act(t('Ouvrir'), openOne, 'secondary'),
            open ? act(t('Fermer'), setState('closed')) : null,
            act(t('Modifier'), () => openForm(r)), act(t('Supprimer'), del, 'ghost danger-link')].filter(Boolean))));
      }
    }
    // Suppression : deux appuis (pas de fenêtre de confirmation du navigateur)
    const armed = new Set();
    function confirmDel(r) { if (armed.has(r.id)) { armed.delete(r.id); return true; } armed.add(r.id); msg(t('Appuie encore sur « Supprimer » pour retirer {name}.', { name: r.name })); setTimeout(() => armed.delete(r.id), 5000); return false; }
    $('#rfOpenAll').onclick = async () => {
      try { const d = await orgaFetch('/api/orga/refuges/open', { method: 'POST', body: JSON.stringify(slot()) }); msg(tn(d.n, '{n} lieu ouvert.', '{n} lieux ouverts.'));  load(); } catch (err) { msg(err.message); }
    };
    // Logo : redimensionné en PNG carré de 128 px sur le téléphone avant l'envoi
    function logoState(l) {
      $('#rfLogoImg').hidden = !l; if (l) $('#rfLogoImg').src = l.img;
      $('#rfLogoDel').hidden = !l;
      $('#rfLogoState').textContent = !l ? t('Facultatif. Il s’affiche au centre de tes lieux après validation par l’admin.')
        : l.status === 'ok' ? t('Logo validé : il s’affiche sur les lieux où tu l’as choisi.') : t('Logo envoyé : en attente de validation par l’admin.');
    }
    $('#rfLogoFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(f); });
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const x = c.getContext('2d'), s = Math.max(128 / img.width, 128 / img.height);
        x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
        x.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
        URL.revokeObjectURL(img.src);
        const png = c.toDataURL('image/png');
        const d = await orgaFetch('/api/orga/logo', { method: 'POST', body: JSON.stringify({ png }) });
        logoState({ status: d.status || 'pending', img: png });
      } catch (err) { msg(err.message || t('Image illisible.')); }
    };
    $('#rfLogoDel').onclick = async () => { try { await orgaFetch('/api/orga/logo', { method: 'DELETE' }); logoState(null); } catch (err) { msg(err.message); } };
    async function load() {
      // Visible pour toute orga connectée (et l'admin) ; en essai, la section explique qu'il faut être certifiée
      box.hidden = !orga;
      const trial = !!(orga && orga.trial);
      $('#refugeTrial').hidden = !trial; $('#refugeBody').hidden = trial;
      $('#orgaLogoBox').hidden = box.hidden || trial;
      if (box.hidden || trial) return;
      try { const d = await orgaFetch('/api/orga/refuges'); list = d.refuges || []; max = d.max || 1; $('#rfAdd').hidden = !form.hidden || !canAdd(); render(); logoState(d.logo); } catch (err) { msg(err.message); }
    }
    // Créneau proposé : maintenant jusqu'à 20 h (ou 4 h plus tard si c'est déjà le soir)
    { const now = Date.now(), end = at('20:00'); $('#rfFrom').value = hhmm(now); $('#rfTo').value = hhmm(end > now + 3600e3 ? end : now + 4 * 3600e3); }
    const prev = $('#btnOrga').onclick;
    $('#btnOrga').onclick = e => { prev && prev(e); closeForm(); load(); };
  }
  // ---- Espace orga : 4 onglets (Annonces, Terrain, Réseau, Mon orga) au lieu d'une longue page ----
  // Le dernier onglet ouvert est gardé sur le téléphone. Pastilles : vert sur « Terrain » quand ta position
  // ou ton lieu de repli est en ligne, « ! » sur « Mon orga » tant qu'un seul appareil a l'accès.
  {
    const tabs = [...document.querySelectorAll('.orga-tabs [role="tab"]')], KEY = 'cortege-orga-tab';
    const panes = Object.fromEntries(tabs.map(b => [b.dataset.pane, $('#opane-' + b.dataset.pane)]));
    let cur = 'ann';
    try { cur = localStorage.getItem(KEY) || 'ann'; } catch {}
    function show(name, focus) {
      if (!panes[name]) name = 'ann';
      cur = name; try { localStorage.setItem(KEY, name); } catch {}
      for (const b of tabs) { const on = b.dataset.pane === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
      for (const [k, p] of Object.entries(panes)) p.hidden = k !== name;
      // Seulement si la page est ouverte : au démarrage, lire scrollTop forcerait le calcul de toute la mise en page
      const sh = $('#sheetOrga'); if (!sh.hidden) sh.scrollTop = 0;
    }
    tabs.forEach((b, i) => {
      b.onclick = () => show(b.dataset.pane);
      b.onkeydown = e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
        e.preventDefault(); const rtl = document.dir === 'rtl' ? -1 : 1;
        show(tabs[(i + d * rtl + tabs.length) % tabs.length].dataset.pane, true);
      };
    });
    // Statut de l'orga, invitations réservées aux orgas certifiées, pastilles
    function status() {
      if (!orga) return;
      $('#orgaStatusName').textContent = orga.label;
      $('#orgaStatusChip').textContent = orga.admin ? t('Admin') : orga.trial ? (orga.sponsored ? t('Parrainée, en essai') : t('En essai')) : t('Orga certifiée');
      $('#orgaStatusChip').dataset.k = orga.admin ? 'admin' : orga.trial ? 'trial' : 'ok';
      $('#orgaInviteOff').hidden = !$('#orgaInviteBox').hidden || !!orga.admin;
      const live = !!beacon || [...document.querySelectorAll('#refugeList .refuge-item.on')].length > 0;
      $('#otab-terrain').classList.toggle('dot-live', live);
      $('#otab-compte').classList.toggle('dot-warn', !orga.admin && !!orga.canAddDevice && (orga.devices || 1) < 2);
    }
    for (const id of ['#deviceState', '#refugeList', '#bkState']) new MutationObserver(status).observe($(id), { childList: true, subtree: true, characterData: true });
    new MutationObserver(status).observe($('#orgaInviteBox'), { attributes: true, attributeFilter: ['hidden'] });
    const prev = $('#btnOrga').onclick;
    $('#btnOrga').onclick = e => { prev && prev(e); let c = cur; try { c = localStorage.getItem(KEY) || cur; } catch {} show(c); status(); };
    show(cur);
  }

  $('#btnOrgaEvent').onclick = () => openEventForm(true);
  onOrga(orga);
  setTimeout(remindSync, 4000);
  return { onOrga, annsChanged() { if (!$('#sheetOrga').hidden) renderOrgaList(); } };
};
