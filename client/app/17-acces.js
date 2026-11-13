  // ---- Accès orga et medic : clés gardées sur ce téléphone, code de secours ----
  // La clé est dans le stockage du navigateur, avec une copie dans sa base locale (un nettoyage partiel ne suffit pas à la perdre),
  // et le stockage est demandé « persistant » (le navigateur ne l'efface pas quand la place manque).
  // Elle n'est oubliée que si le serveur répond qu'elle n'existe plus (gone) ou si la personne quitte le mode elle-même.
  const KEYS = { orga: 'cortege-orga', medic: 'cortege-medic' };
  const keyGet = kind => { try { return localStorage.getItem(KEYS[kind]) || ''; } catch { return ''; } };
  const keyDb = () => new Promise((res, rej) => {
    const o = indexedDB.open('cortege-cles', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('k');
    o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error);
  });
  async function keyBackup(kind, val) {
    try {
      const db = await keyDb();
      await new Promise((res, rej) => { const tx = db.transaction('k', 'readwrite'); if (val) tx.objectStore('k').put(val, kind); else tx.objectStore('k').delete(kind); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
    } catch {}
  }
  function keySet(kind, val) {
    try { if (val) localStorage.setItem(KEYS[kind], val); else localStorage.removeItem(KEYS[kind]); } catch {}
    keyBackup(kind, val);
    if (val) try { navigator.storage?.persist?.().catch(() => {}); } catch {}
  }
  // Au démarrage : une clé disparue du stockage mais encore dans la copie est remise ; une clé sans copie est copiée
  const keysReady = (async () => {
    try {
      const db = await keyDb();
      for (const kind of Object.keys(KEYS)) {
        const v = await new Promise(res => { const r = db.transaction('k').objectStore('k').get(kind); r.onsuccess = () => res(r.result || ''); r.onerror = () => res(''); });
        const cur = keyGet(kind);
        if (!cur && v) try { localStorage.setItem(KEYS[kind], v); } catch {}
        if (cur && cur !== v) keyBackup(kind, cur);
      }
      db.close();
    } catch {}
    if (keyGet('orga') || keyGet('medic')) try { navigator.storage?.persist?.().catch(() => {}); } catch {}
  })();
  // iPhone hors de l'appli installée : Safari efface les données d'un site resté 7 jours sans visite
  const iosEvict = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const IOS_WARN = t('Sur iPhone, ajoute Cortège à l’écran d’accueil et ouvre ton accès depuis l’appli installée : sinon Safari peut effacer ton accès après 7 jours sans ouvrir le site.');

  // Code de secours : montré une seule fois (à l'activation, à la demande, après une récupération)
  let recAfter = null;
  function showRec(code, kind, after) {
    closeReport(); closeSheets(); recAfter = after || null;
    $('#rcTitle').textContent = t('Ton code de secours');
    const box = $('#rcBody'); box.textContent = '';
    box.append(
      el('p', { class: 'hint' }, kind === 'medic'
        ? t('Si ce téléphone est perdu, saisi ou vidé, ce code redonne l’accès medic de ton équipe sur un autre téléphone, et coupe celui-ci.')
        : t('Si ce téléphone est perdu, saisi ou vidé, ce code redonne ton accès orga sur un autre téléphone, et coupe celui-ci.')),
      el('p', { class: 'rec-code', id: 'recCode' }, document.createTextNode(code)),
      el('p', { class: 'access-warn' }, el('b', {}, t('Il ne sera plus jamais affiché.')), ' ',
        t('Note-le maintenant, ailleurs que sur ce téléphone et que dans ton sac de manif : gestionnaire de mots de passe, papier chez toi, ou chez une personne de confiance. Ce code vaut ta clé : ne le donne à personne d’autre.')),
      el('p', { class: 'fine' }, t('Pour t’en servir : Plus › « J’ai perdu mon accès », sur n’importe quel téléphone. Il ne sert qu’une fois : un nouveau code te sera donné à ce moment-là.')));
    const copy = el('button', { class: 'secondary', type: 'button' }, t('Copier le code'));
    copy.onclick = async () => { try { await navigator.clipboard.writeText(code); toast('Code copié'); } catch { toast('Copie impossible : note-le à la main'); } };
    const print = el('button', { class: 'secondary', type: 'button' }, t('Imprimer'));
    print.onclick = () => { document.body.classList.add('print-rec'); const done = () => { document.body.classList.remove('print-rec'); removeEventListener('afterprint', done); }; addEventListener('afterprint', done); print.blur(); window.print(); };
    const ok = el('button', { class: 'install', type: 'button' }, t('C’est noté'));
    ok.onclick = () => recClose();
    box.append(el('div', { class: 'row2' }, copy, print), ok);
    $('#sheetRec').hidden = false;
  }
  function recClose() { $('#sheetRec').hidden = true; $('#rcBody').textContent = ''; const f = recAfter; recAfter = null; if (f) f(); }
  $('#rcClose').onclick = recClose;

  // Accès perdu : le code de secours donne une nouvelle clé sur ce téléphone
  function openRecover() {
    closeReport(); closeSheets();
    $('#rvTitle').textContent = t('Retrouver mon accès');
    $('#rvHint').textContent = t('Saisis le code de secours reçu à l’activation de ton accès orga ou medic. Tu recevras un nouveau code juste après : celui-ci ne servira plus.');
    $('#rvCodeLbl').textContent = t('Code de secours');
    $('#rvCutLbl').textContent = t('Couper tous mes autres appareils (conseillé : téléphone perdu, volé ou saisi)');
    $('#rvFine').textContent = t('Pas de code ? Demande une nouvelle invitation à la personne qui t’a fait entrer (orga marraine, référent·e medic) ou à l’admin.');
    $('#rvGo').textContent = t('Retrouver mon accès');
    $('#rvCode').value = ''; $('#rvCut').checked = true;
    $('#sheetRecover').hidden = false;
  }
  $('#btnRecover').onclick = openRecover;
  $('#rvClose').onclick = () => closeSheets();
  $('#rvCode').addEventListener('input', e => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    e.target.value = (v.match(/.{1,4}/g) || []).join('-');
  });
  $('#rvForm').addEventListener('submit', async e => {
    e.preventDefault();
    const b = $('#rvGo'); b.disabled = true;
    try {
      const res = await fetch('/api/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('#rvCode').value, cut: $('#rvCut').checked }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t('Action impossible.'));
      const kind = body.medic ? 'medic' : 'orga';
      keySet(kind, body.key);
      // La page est rechargée une fois le nouveau code noté : l'appli repart avec l'accès retrouvé
      showRec(body.rec, kind, () => location.reload());
      toast(t('Accès retrouvé : {who}', { who: body.label }));
    } catch (err) { toast(err.message); }
    b.disabled = false;
  });

  // ---- Écran medic : son script (public/app-medic.js) n'est chargé que sur un téléphone qui a un accès medic ----
  // Le reste de l'appli s'en passe : la plupart des téléphones ne le téléchargent jamais.
  let medicPart = null;
  function medicInit() {
    if (!keyGet('medic')) return;
    if (!medicPart) medicPart = new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = '/app-medic.js';
      s.onload = ok; s.onerror = () => { s.remove(); ko(new Error('script')); };
      document.head.append(s);
    }).then(() => window.cortegeMedic({ $, el, t, toast, map, layer, I18N, MIN, IOS_WARN, ago, fmtDist, fmtExp, qrSvg, iosEvict, keyGet, keySet, showRec, closeReport, closeSheets, locate, setFollow, setManif,
      get me() { return me; }, get meAt() { return meAt; }, get watchId() { return watchId; }, get pushSub() { return pushSub; } }));
    // Pas de réseau et script pas encore gardé : nouvel essai un peu plus tard, tant que la clé est là
    medicPart.then(m => m.medicInit()).catch(() => { medicPart = null; setTimeout(medicInit, 10_000); });
  }
  keysReady.then(medicInit);
  // Abonnement aux notifications créé ou retrouvé : l'écran medic, s'il est chargé, le transmet pour les urgences vitales
  function mdPush() { if (medicPart) medicPart.then(m => m.mdPush()).catch(() => {}); }
