'use strict';
// ---- Mode medic : écran des équipes de street medics ----
// Chargé à la demande (public/app-medic.js), seulement sur les téléphones qui ont un accès medic : voir la fin de
// client/app/17-acces.js. `core` donne les outils du reste de l'appli ; ce qui y change au fil du temps (position du
// téléphone, abonnement aux notifications) se lit par core.me, core.meAt, core.watchId, core.pushSub.
window.cortegeMedic = function (core) {
  const { $, el, t, toast, map, layer, I18N, MIN, IOS_WARN, ago, fmtDist, fmtExp, qrSvg, iosEvict, keyGet, keySet, showRec, closeReport, closeSheets, locate, setFollow, setManif } = core;
  let medic = null, medicFull = false; // équipe medic de ce téléphone ; « vue complète » de Cortège demandée
  // Une carte privée, vue seulement avec la clé de l'équipe : positions des équipes, points chauds, barrages filtrants, renforts.
  // Quatre gros boutons, rien d'autre. Les infos sont ajoutées et retirées à la main par les équipes ; le serveur ne les garde
  // qu'en mémoire. L'écran se met à jour dès qu'une équipe change quelque chose (attente longue, rien n'est publié).
  const MD = { pos: ['⛑️', t('Équipe medic')], hot: ['🔥', t('Point chaud')], block: ['🚧', t('Barrage filtrant')], help: ['🆘', t('Renfort demandé')] };
  const MD_LVL = { duo: t('Besoin d’un binôme'), vital: t('Urgence vitale / évacuation'), gear: t('Besoin de matériel') };
  const MD_DUR = { 30: '30 min', 60: '1 h', 120: '2 h', 240: '4 h' };
  const mdLayer = L.layerGroup(), mdSeen = new Set();
  let mdItems = [], mdVer = 0, mdAbort = null, mdShare = null, mdSel = null, mdFocus = null, mdFirst = true, mdMe = null;
  let mdShowPub = false, mdOpts = { dur: 120, pub: false };
  try { mdShowPub = localStorage.getItem('cortege-medic-pub') === '1'; medicFull = localStorage.getItem('cortege-medic-full') === '1'; mdOpts = { ...mdOpts, ...JSON.parse(localStorage.getItem('cortege-medic-opts') || '{}') }; } catch {}
  { const m = location.search.match(/[?&]medic=([\w-]{1,16})/); if (m) { mdFocus = m[1]; history.replaceState(null, '', location.pathname); } }

  async function mdFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Medic-Key': keyGet('medic'), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403 && body.gone) { keySet('medic', null); setMedic(null); }
    if (!res.ok) throw Object.assign(new Error(body.error || t('Action impossible.')), { status: res.status, body });
    return body;
  }
  // Entrée et sortie de l'écran medic. « Vue complète » : Cortège habituel, avec un bouton pour revenir à l'écran medic.
  function mdScreen() {
    const on = !!medic && !medicFull;
    document.body.classList.toggle('medic', on);
    $('#medicBack').hidden = !medic || on;
    if (on && document.body.classList.contains('manif')) setManif(false);
    if (medic) { if (!map.hasLayer(mdLayer)) mdLayer.addTo(map); } else map.removeLayer(mdLayer);
    // Signalements publics : masqués sur l'écran medic, sauf demande
    const pub = !on || mdShowPub;
    if (pub && !map.hasLayer(layer)) map.addLayer(layer); else if (!pub && map.hasLayer(layer)) map.removeLayer(layer);
    $('#medicPub').setAttribute('aria-pressed', String(mdShowPub));
    if (on) { closeReport(); if (core.watchId == null) locate(); }
    setTimeout(() => map.invalidateSize(), 50);
  }
  function setMedic(o) {
    medic = o;
    if (!o) { mdAbort?.abort(); mdItems = []; mdVer = 0; mdDraw(); mdShareStop(false); closeSheets(); }
    else { $('#medicTitle').textContent = 'MEDIC · ' + o.label; mdLoop(); mdPush(); mdShareResume(); }
    mdScreen();
  }
  function mdFullView(full) { medicFull = full; try { localStorage.setItem('cortege-medic-full', full ? '1' : '0'); } catch {} closeSheets(); mdScreen(); }

  // ---- Carte medic ----
  async function mdLoop() {
    if (mdAbort) return;
    while (medic && !document.hidden) {
      mdAbort = new AbortController();
      try {
        const t0 = Date.now(), s = await mdFetch(`/api/medic/state?v=${mdVer}&wait=1`, { signal: mdAbort.signal });
        const same = s.v === mdVer;
        mdVer = s.v; mdItems = s.items; $('#medicTop').dataset.state = 'live'; mdDraw();
        // Réponse immédiate sans rien de neuf (serveur chargé) : on ne redemande pas en boucle
        if (same && Date.now() - t0 < 1500) await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        if (e.name === 'AbortError' || !medic) break;
        $('#medicTop').dataset.state = 'offline';
        await new Promise(r => setTimeout(r, 4000));
      }
    }
    mdAbort = null;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) mdAbort?.abort(); else if (medic) setTimeout(mdLoop, 50); });
  function mdDraw() {
    mdLayer.clearLayers();
    for (const x of mdItems) {
      const pin = el('div', { class: `mpin k-${x.k}${x.lvl ? ' l-' + x.lvl : ''}${x.mine ? ' mine' : ''}` }, el('span', { 'aria-hidden': 'true' }, document.createTextNode(MD[x.k][0])));
      if (x.k === 'pos') pin.append(el('i', {}, document.createTextNode(x.team)));
      if (x.k === 'help' && x.go.length) pin.append(el('em', {}, document.createTextNode('→ ' + x.go.length)));
      const m = L.marker([x.lat, x.lng], { icon: L.divIcon({ className: 'mpin-wrap', html: pin, iconSize: [44, 44], iconAnchor: [22, 22] }), keyboard: true, title: MD[x.k][1] + ' · ' + x.team, zIndexOffset: x.k === 'help' ? 2000 : 1000 });
      m.on('click', () => mdCard(x.id));
      mdLayer.addLayer(m);
      // Nouvelle urgence vitale d'une autre équipe : vibration et message, même si la notification n'est pas activée
      if (!mdSeen.has(x.id)) {
        mdSeen.add(x.id);
        if (!mdFirst && x.k === 'help' && !x.mine) { try { navigator.vibrate?.(x.lvl === 'vital' ? [400, 100, 400, 100, 400] : [200, 100, 200]); } catch {} toast(t('🆘 Renfort demandé par {team}', { team: x.team })); }
      }
    }
    mdFirst = false;
    $('#mdHelp').dataset.n = String(mdItems.filter(x => x.k === 'help').length || '');
    if (mdSel) mdCard(mdSel, true);
    if (mdFocus) { const x = mdItems.find(i => i.id === mdFocus); mdFocus = null; if (x) { setFollow(false); map.setView([x.lat, x.lng], Math.max(map.getZoom(), 16)); mdCard(x.id); } }
  }
  // Fiche d'une info : qui l'a posée, depuis quand, et les gestes possibles
  function mdCard(id, keep) {
    const x = mdItems.find(i => i.id === id), card = $('#medicCard');
    if (!x) { if (mdSel === id) { mdSel = null; card.hidden = true; } return; }
    mdSel = id;
    $('#mcTitle').textContent = MD[x.k][0] + ' ' + (x.k === 'help' ? MD_LVL[x.lvl] : x.k === 'pos' ? x.team : MD[x.k][1]);
    const dist = core.me ? ' · ' + fmtDist(map.distance(core.me, [x.lat, x.lng])) : '';
    $('#mcSub').textContent = (x.k === 'pos' ? (x.pub ? t('Position partagée, visible aussi du public') : t('Position partagée entre équipes')) : t('Posé par {team}', { team: x.team })) + ' · ' + ago(x.t) + dist
      + (x.k === 'help' ? ' · ' + (x.go.length ? t('En route : {teams}', { teams: x.go.join(', ') }) : t('Personne en route pour l’instant')) : '');
    const acts = $('#mcActs'); acts.textContent = '';
    const act = (label, cls, fn) => { const b = el('button', { type: 'button', class: cls }, label); b.onclick = async () => { b.disabled = true; try { await fn(); } catch (e) { toast(e.message); } b.disabled = false; }; acts.append(b); };
    if (x.k === 'help') {
      if (!x.mine) act(x.iGo ? t('Je n’y vais plus') : t('J’y vais'), x.iGo ? 'secondary' : 'install', () => mdFetch(`/api/medic/items/${x.id}/go`, { method: 'POST', body: JSON.stringify({ on: !x.iGo }) }));
      act(t('Réglé'), 'secondary', async () => { await mdFetch('/api/medic/items/' + x.id, { method: 'DELETE' }); mdClose(); toast('Appel retiré'); });
    } else if (x.k === 'pos') {
      if (x.mine) act(t('Arrêter le partage'), 'secondary', async () => { await mdShareStop(true); mdClose(); });
    } else act(t('Retirer'), 'secondary', async () => { await mdFetch('/api/medic/items/' + x.id, { method: 'DELETE' }); mdClose(); toast('Retiré'); });
    card.hidden = false;
    if (!keep) acts.querySelector('button')?.focus({ preventScroll: true });
  }
  function mdClose() { mdSel = null; $('#medicCard').hidden = true; }
  $('#mcClose').onclick = mdClose;
  map.on('click', () => { if (mdSel) mdClose(); });

  // ---- Les quatre boutons ----
  const mdFresh = () => core.me && Date.now() - core.meAt < 2 * MIN;
  async function mdAdd(k, lvl) {
    // Point chaud et barrage : à l'endroit du viseur. Renfort : là où est l'équipe (position du téléphone si elle est récente).
    const c = map.getCenter(), at = k === 'help' && mdFresh() ? core.me : [c.lat, c.lng];
    try {
      const x = await mdFetch('/api/medic/items', { method: 'POST', body: JSON.stringify({ k, lvl, lat: at[0], lng: at[1] }) });
      mdSeen.add(x.id); closeSheets();
      toast(k === 'help' ? t('Renfort demandé : les autres équipes sont prévenues') : k === 'hot' ? t('Point chaud ajouté') : t('Barrage filtrant ajouté'));
    } catch (e) { toast(e.message); }
  }
  $('#mdHot').onclick = () => mdAdd('hot');
  $('#mdBlock').onclick = () => mdAdd('block');
  $('#mdHelp').onclick = () => {
    closeSheets(); mdClose();
    $('#mhTitle').textContent = t('Demander du renfort');
    const box = $('#mhBody'); box.textContent = '';
    box.append(el('p', { class: 'hint' }, mdFresh() ? t('L’appel part de ta position.') : t('Position du téléphone inconnue : l’appel part de l’endroit du viseur, au milieu de la carte.')));
    for (const [lvl, label] of Object.entries(MD_LVL)) { const b = el('button', { type: 'button', class: 'mh-btn l-' + lvl }, label); b.onclick = () => mdAdd('help', lvl); box.append(b); }
    box.append(el('p', { class: 'fine' }, t('Seuls le lieu et le niveau sont envoyés aux autres équipes. Rien sur la personne. « Urgence vitale » envoie aussi une notification aux équipes proches. En cas d’urgence vitale, appelle d’abord le 15 ou le 112.')));
    $('#sheetMedicHelp').hidden = false;
  };
  $('#mhClose').onclick = () => closeSheets();

  // ---- « Nous sommes ici » : position de l'équipe, envoyée toutes les 20 s tant que l'appli est ouverte ----
  function mdShareUI() {
    const on = !!mdShare; $('#mdPos').classList.toggle('on', on);
    $('#mdPosLbl').textContent = on ? t('Position partagée') : t('Nous sommes ici');
  }
  async function mdShareSend(start) {
    if (!mdShare || !core.me) return;
    try { const r = await mdFetch('/api/medic/pos', { method: 'POST', body: JSON.stringify({ lat: core.me[0], lng: core.me[1], ...(start ? { start: true, dur: mdOpts.dur, pub: mdOpts.pub } : {}) }) }); mdShare.until = r.until; mdShareSave(); }
    catch (e) { if (e.status === 410) { mdShareStop(false); toast(e.message); } else if (start) { mdShareStop(false); toast(e.message); } }
  }
  const mdShareSave = () => { try { if (mdShare) localStorage.setItem('cortege-medic-pos', JSON.stringify({ until: mdShare.until })); else localStorage.removeItem('cortege-medic-pos'); } catch {} };
  async function mdShareStart() {
    if (mdShare) return;
    if (!core.me) { if (core.watchId == null) locate(); toast('Position du téléphone inconnue : autorise la localisation, puis réessaie.'); return; }
    mdShare = { until: Date.now() + mdOpts.dur * MIN, timer: setInterval(() => { if (mdShare && Date.now() >= mdShare.until) mdShareStop(false); else mdShareSend(false); }, 20_000) };
    mdShareUI(); await mdShareSend(true);
    if (mdShare) toast(mdOpts.pub ? t('Position partagée pendant {d}, visible aussi du public', { d: MD_DUR[mdOpts.dur] }) : t('Position partagée pendant {d}, entre équipes medic', { d: MD_DUR[mdOpts.dur] }));
  }
  async function mdShareStop(tell) {
    const had = mdShare; if (had) clearInterval(had.timer);
    mdShare = null; mdShareSave(); mdShareUI();
    if (had && tell && medic) { try { await mdFetch('/api/medic/pos', { method: 'DELETE', body: '{}' }); } catch {} }
  }
  // Après un rechargement de la page : le partage reprend sans rien redémarrer (le serveur refuse s'il s'est arrêté entre-temps)
  function mdShareResume() {
    if (mdShare) return;
    let s = null; try { s = JSON.parse(localStorage.getItem('cortege-medic-pos') || 'null'); } catch {}
    if (!s || !(s.until > Date.now())) return mdShareSave();
    mdShare = { until: s.until, timer: setInterval(() => { if (mdShare && Date.now() >= mdShare.until) mdShareStop(false); else mdShareSend(false); }, 20_000) };
    mdShareUI(); if (core.watchId == null) locate(); setTimeout(() => mdShareSend(false), 3000);
  }
  $('#mdPos').onclick = () => { if (mdShare) openMedic(); else mdShareStart(); };

  // ---- Notifications : les urgences vitales des autres équipes (abonnement gardé en mémoire par le serveur) ----
  function mdPush() {
    if (!medic || !core.pushSub) return;
    const c = map.getCenter(), at = core.me || [c.lat, c.lng];
    mdFetch('/api/medic/push', { method: 'POST', body: JSON.stringify({ sub: core.pushSub.toJSON(), lat: at[0], lng: at[1], lang: I18N.lang }) }).catch(() => {});
  }

  // ---- Feuille de l'équipe : position, carte, alertes, appareils, code de secours, référent·e ----
  async function openMedic() {
    closeReport(); closeSheets(); mdClose();
    $('#mdTitle').textContent = '⛑️ ' + (medic ? medic.label : '');
    const box = $('#mdBody'); box.textContent = '';
    $('#sheetMedic').hidden = false;
    try { mdMe = await mdFetch('/api/medic/me'); } catch (e) { box.append(el('p', { class: 'hint' }, document.createTextNode(e.message))); return; }
    const h3 = x => el('h3', { class: 'group-title' }, x), hint = x => el('p', { class: 'hint' }, x);
    const sw = (label, sub, on, fn) => { const i = el('input', { type: 'checkbox' }); i.checked = on; i.onchange = () => fn(i.checked);
      return el('label', { class: 'switch' }, i, el('span', { class: 'switch-txt' }, el('b', {}, label), el('span', {}, sub))); };
    const saveOpts = () => { try { localStorage.setItem('cortege-medic-opts', JSON.stringify(mdOpts)); } catch {} };
    // Position
    const dur = el('select', { 'aria-label': t('Durée du partage') }); for (const d of mdMe.durs) dur.append(new Option(MD_DUR[d], d)); dur.value = String(mdOpts.dur);
    dur.onchange = () => { mdOpts.dur = Number(dur.value); saveOpts(); }; dur.disabled = !!mdShare;
    const pubSw = sw(t('Visible aussi du public'), t('Un ⛑️ au nom de l’équipe sur la carte de tout le monde, pour que les personnes blessées vous trouvent.'), mdOpts.pub, v => { mdOpts.pub = v; saveOpts(); });
    pubSw.querySelector('input').disabled = !!mdShare;
    const go = el('button', { type: 'button', class: mdShare ? 'secondary' : 'install' }, mdShare ? t('Arrêter le partage') : t('Partager notre position'));
    go.onclick = async () => { if (mdShare) await mdShareStop(true); else await mdShareStart(); openMedic(); };
    box.append(h3(t('Notre position')), hint(mdShare ? t('Position partagée en ce moment. Elle s’arrête seule à la fin de la durée, après 3 minutes sans réseau, ou si tu t’éloignes de plus de 2 km.') : t('Les autres équipes voient où vous êtes. Le partage s’arrête seul, et rien n’est gardé ensuite.')),
      el('label', { class: 'note-label' }, t('Pendant'), dur), pubSw, go);
    // Carte
    box.append(h3(t('Carte')), sw(t('Afficher aussi les signalements publics'), t('CRS, lacrymo, charges… signalés par tout le monde sur Cortège.'), mdShowPub, v => { mdShowPub = v; try { localStorage.setItem('cortege-medic-pub', v ? '1' : '0'); } catch {} mdScreen(); }));
    // Alertes
    box.append(h3(t('Alertes')), hint(core.pushSub ? t('Tu reçois une notification pour chaque urgence vitale à moins de {km} km, même appli fermée.', { km: String(mdMe.radiusKm).replace('.', ',') })
      : t('Notifications pas encore activées sur ce téléphone : sans elles, tu ne vois les appels de renfort que si l’appli est ouverte.')));
    if (!core.pushSub) { const b = el('button', { type: 'button', class: 'secondary' }, t('Activer les alertes')); b.onclick = () => $('#btnNotif').click(); box.append(b); }
    // Appareils
    const out = el('div', { class: 'invite-out', hidden: '' });
    const showLink = (title, r, fine) => {
      const url = location.origin + '/?invite=' + r.invite, qr = el('div', { class: 'qr' });
      out.textContent = ''; out.hidden = false;
      const copy = el('button', { type: 'button', class: 'secondary' }, t('Copier le lien')); copy.onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { toast(url); } };
      out.append(el('p', { class: 'hint' }, el('b', {}, document.createTextNode(title)), ' ', t('(valable jusqu’au {date}, une seule fois)', { date: fmtExp(r.exp) })), qr, el('p', { class: 'invite-url' }, document.createTextNode(url)), copy, el('p', { class: 'fine' }, fine));
      qrSvg(url, 6).then(svg => { qr.innerHTML = svg; }).catch(() => {});
      out.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const addDev = el('button', { type: 'button', class: 'secondary' }, t('Ajouter un appareil'));
    addDev.onclick = async () => { try { showLink(t('Ajouter un appareil'), await mdFetch('/api/medic/device', { method: 'POST', body: '{}' }), t('Scanne ce QR code avec l’autre téléphone de l’équipe (ou ouvre-y le lien). Ne l’envoie à personne d’autre : il donne accès à la carte medic.')); } catch (e) { toast(e.message); } };
    box.append(h3(t('Appareils de l’équipe')), hint(t('{n} appareil(s) ont l’accès de cette équipe (5 au plus).', { n: mdMe.devices })), addDev);
    // Code de secours
    const rec = el('button', { type: 'button', class: 'secondary' }, mdMe.rec ? t('Créer un nouveau code de secours') : t('Créer mon code de secours'));
    rec.onclick = async () => { try { const r = await mdFetch('/api/medic/recovery', { method: 'POST', body: '{}' }); showRec(r.rec, 'medic', openMedic); } catch (e) { toast(e.message); } };
    box.append(h3(t('Code de secours')), hint(mdMe.rec ? t('L’équipe a un code de secours. S’il est égaré, crées-en un nouveau : l’ancien ne servira plus.') : t('Pas encore de code de secours. Il redonne l’accès sur un autre téléphone si celui-ci est perdu, saisi ou vidé, et coupe le téléphone perdu.')));
    if (mdMe.recAt) box.append(el('p', { class: 'hint trial-note' }, t('⚠ Accès récupéré avec le code de secours le {date}. Si ce n’est pas ton équipe, crée un nouveau code tout de suite et préviens ton ou ta référent·e.', { date: fmtExp(mdMe.recAt) })));
    if (mdMe.warn) box.append(el('p', { class: 'hint trial-note' }, t('Journée de mobilisation toute proche : ton accès n’a ni code de secours ni deuxième appareil. Crée ton code maintenant.')));
    box.append(rec);
    if (iosEvict()) box.append(hint(IOS_WARN));
    box.append(out);
    // Référent·e : les équipes de sa ville
    if (mdMe.ref) {
      const list = el('ul', { class: 'org-list' }), name = el('input', { maxlength: '40', placeholder: t('ex. : Medics Sud, binôme 3'), 'aria-label': t('Nom de l’équipe') });
      const inv = el('button', { type: 'button', class: 'secondary' }, t('Inviter une équipe'));
      const load = async () => {
        list.textContent = '';
        let d; try { d = await mdFetch('/api/medic/teams'); } catch { return; }
        for (const o of d.teams) {
          const again = el('button', { type: 'button', class: 'ghost' }, t('Réinviter')), del = el('button', { type: 'button', class: 'ghost danger-link' }, t('Retirer'));
          again.onclick = async () => { try { showLink(t('Nouvelle invitation pour {who}', { who: o.label }), await mdFetch(`/api/medic/teams/${o.id}/invite`, { method: 'POST', body: '{}' }), t('L’ancien accès de cette équipe est coupé. Envoie le lien par une messagerie chiffrée (Signal), jamais publiquement.')); load(); } catch (e) { toast(e.message); } };
          del.onclick = async () => { if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = t('Confirmer le retrait'); setTimeout(() => { delete del.dataset.armed; del.textContent = t('Retirer'); }, 4000); return; }
            try { await mdFetch('/api/medic/teams/' + o.id, { method: 'DELETE', body: '{}' }); load(); } catch (e) { toast(e.message); } };
          list.append(el('li', {}, el('div', { class: 't' }, el('div', { class: 'l' }, document.createTextNode(o.label)), el('div', { class: 's' }, o.active ? t('Active · {n} appareil(s)', { n: o.devices }) : o.invite ? t('Invitation en attente') : t('Invitation expirée'))), again, del));
        }
      };
      inv.onclick = async () => {
        try { const r = await mdFetch('/api/medic/teams', { method: 'POST', body: JSON.stringify({ label: name.value }) }); name.value = '';
          showLink(t('Invitation pour {who}', { who: r.label }), r, t('L’équipe scanne ce QR code ou ouvre le lien sur son téléphone. Envoie le lien par une messagerie chiffrée (Signal), jamais publiquement.')); load(); }
        catch (e) { toast(e.message); }
      };
      box.append(h3(t('Référent·e : les équipes que tu as fait entrer')), hint(t('Tu peux inviter des équipes, leur renvoyer une invitation si elles ont perdu leur accès, et les retirer.')), name, inv, list, out);
      load();
    }
    // Vue complète, sortie
    const full = el('button', { type: 'button', class: 'secondary' }, t('Vue complète de Cortège')); full.onclick = () => mdFullView(true);
    const quit = el('button', { type: 'button', class: 'ghost danger-link' }, t('Quitter le mode medic sur ce téléphone'));
    quit.onclick = async () => {
      if (!quit.dataset.armed) { quit.dataset.armed = '1'; quit.textContent = t('Confirmer : l’accès medic sera retiré de ce téléphone'); setTimeout(() => { delete quit.dataset.armed; quit.textContent = t('Quitter le mode medic sur ce téléphone'); }, 5000); return; }
      await mdShareStop(true);
      if (core.pushSub) { try { await mdFetch('/api/medic/push', { method: 'DELETE', body: JSON.stringify({ endpoint: core.pushSub.endpoint }) }); } catch {} }
      keySet('medic', null); setMedic(null); toast('Mode medic désactivé sur ce téléphone');
    };
    box.append(h3(t('Cortège')), full, quit);
  }
  $('#medicPill').onclick = openMedic;
  $('#mdClose').onclick = () => closeSheets();
  $('#medicExit').onclick = () => mdFullView(true);
  $('#medicBack').onclick = () => mdFullView(false);
  $('#medicPub').onclick = () => { mdShowPub = !mdShowPub; try { localStorage.setItem('cortege-medic-pub', mdShowPub ? '1' : '0'); } catch {} mdScreen(); toast(mdShowPub ? t('Signalements publics affichés') : t('Signalements publics masqués')); };
  // Textes fixes de l'écran
  $('#medicExit').textContent = t('Vue complète'); $('#medicBack').textContent = '⛑️ ' + t('Écran medic');
  $('#medicPub').textContent = '👁'; $('#medicPub').title = t('Afficher ou masquer les signalements publics'); $('#medicPub').setAttribute('aria-label', t('Afficher ou masquer les signalements publics'));
  $('#medicPill').title = t('Notre équipe : position, alertes, appareils');
  $('#mdHotLbl').textContent = t('Point chaud'); $('#mdBlockLbl').textContent = t('Barrage filtrant'); $('#mdHelpLbl').textContent = t('Renfort');
  mdShareUI();
  // Notification ouverte pendant que l'appli tourne : on va à l'appel
  navigator.serviceWorker?.addEventListener('message', e => {
    const m = e.data && e.data.type === 'goto' && String(e.data.url || '').match(/[?&]medic=([\w-]{1,16})/);
    if (m && medic) { mdFocus = m[1]; if (medicFull) mdFullView(false); mdDraw(); }
  });
  // Démarrage (et juste après une invitation) : la clé medic gardée sur ce téléphone ouvre l'écran.
  // Sans réseau, l'écran s'ouvre quand même avec le nom gardé : la carte se remplira dès que ça capte.
  async function medicInit() {
    if (!keyGet('medic')) return;
    let label = '…'; try { label = localStorage.getItem('cortege-medic-label') || label; } catch {}
    try { const who = await mdFetch('/api/medic/me'); mdMe = who; try { localStorage.setItem('cortege-medic-label', who.label); } catch {} setMedic({ label: who.label, ref: who.ref }); }
    catch (e) { if (keyGet('medic')) setMedic({ label }); }
  }
  return { medicInit, mdPush };
};
