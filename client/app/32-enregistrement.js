  // ---- Enregistrer le son (contrôle, interpellation) : gardé sur le téléphone seulement, jamais envoyé à Cortège ----
  // Le son est écrit par morceaux de 2 secondes dans la base du navigateur (« cortege-son ») : si l'écran se verrouille,
  // si l'appli est fermée ou si le téléphone s'éteint, ce qui a déjà été pris reste. « Tout effacer » supprime la base.
  // Un enregistrement se garde ici, se télécharge en fichier ou se partage (Signal…) depuis le téléphone.
  const SON_DB = 'cortege-son';
  const sonOk = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.indexedDB);
  $('#btnSon').hidden = !sonOk;
  let son = null;       // enregistrement en cours : { mr, stream, id, t0, tick, lock }
  let sonUrls = [];     // adresses locales (blob:) des lecteurs affichés, libérées à chaque nouvel affichage
  let sonDbP = null;
  const sonDb = () => sonDbP || (sonDbP = new Promise((ok, ko) => {
    const r = indexedDB.open(SON_DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('recs', { keyPath: 'id' }); r.result.createObjectStore('chunks', { autoIncrement: true }).createIndex('rec', 'rec'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { sonDbP = null; ko(r.error); };
  }));
  // Une opération sur la base : fn reçoit la transaction et rend une requête (son résultat est rendu à la fin)
  const sonTx = async (stores, mode, fn) => { const db = await sonDb(); return new Promise((ok, ko) => {
    const tx = db.transaction(stores, mode); const rq = fn(tx);
    tx.oncomplete = () => ok(rq && 'result' in rq ? rq.result : undefined); tx.onerror = tx.onabort = () => ko(tx.error);
  }); };
  const sonDur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const sonExt = type => /mp4|aac|m4a/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
  async function sonWake() { try { if (son && !son.lock && navigator.wakeLock) { son.lock = await navigator.wakeLock.request('screen'); son.lock.addEventListener('release', () => { if (son) son.lock = null; }); } } catch {} }
  document.addEventListener('visibilitychange', () => { if (son && document.visibilityState === 'visible') sonWake(); });

  async function sonStart() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
    catch { toast('Micro refusé : autorise-le pour Cortège dans les réglages du navigateur.'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(x => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(x)) || '';
    let mr;
    try { mr = new window.MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 }); }
    catch { stream.getTracks().forEach(x => x.stop()); toast('Ce navigateur ne sait pas enregistrer le son.'); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t0 = Date.now();
    try { await sonTx('recs', 'readwrite', tx => tx.objectStore('recs').put({ id, t: t0, type: mr.mimeType || type || 'audio/webm', ms: 0 })); }
    catch { stream.getTracks().forEach(x => x.stop()); toast('Pas de place pour enregistrer sur ce téléphone.'); return; }
    son = { mr, stream, id, t0, tick: null, lock: null };
    mr.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      sonTx('chunks', 'readwrite', tx => tx.objectStore('chunks').add({ rec: id, b: e.data })).catch(() => toast('Le téléphone est plein : l’enregistrement ne peut plus être gardé.'));
      sonTx('recs', 'readwrite', tx => tx.objectStore('recs').put({ id, t: t0, type: mr.mimeType || type || 'audio/webm', ms: Date.now() - t0 })).catch(() => {});
    };
    mr.onstop = () => sonDone(id, t0);
    // Micro coupé par le système (écran verrouillé, appel) : on termine proprement, ce qui a été pris reste
    stream.getAudioTracks().forEach(tr => tr.addEventListener('ended', () => { if (son && son.id === id && mr.state !== 'inactive') mr.stop(); }));
    mr.start(2000);
    sonWake();
    son.tick = setInterval(sonShow, 500);
    sonShow();
  }
  function sonStop() { if (son && son.mr.state !== 'inactive') son.mr.stop(); }
  async function sonDone(id, t0) {
    if (!son || son.id !== id) return;
    clearInterval(son.tick); son.stream.getTracks().forEach(x => x.stop());
    try { if (son.lock) await son.lock.release(); } catch {}
    son = null; sonShow();
    // Le dernier morceau arrive juste avant « stop » : on attend qu'il soit écrit avant de relire la liste
    setTimeout(async () => {
      try { const r = await sonTx('recs', 'readonly', tx => tx.objectStore('recs').get(id)); if (r) await sonTx('recs', 'readwrite', tx => tx.objectStore('recs').put({ ...r, ms: Date.now() - t0, done: 1 })); } catch {}
      sonList();
    }, 400);
    toast('Enregistrement gardé sur ce téléphone.');
  }
  function sonShow() {
    const on = !!son, d = on ? sonDur(Date.now() - son.t0) : '';
    $('#sonGo').textContent = t(on ? '■ Arrêter' : '● Démarrer'); $('#sonGo').classList.toggle('on', on);
    $('#sonTime').hidden = !on; $('#sonTime').textContent = d;
    $('#sonChip').hidden = !on || !$('#sheetSon').hidden; $('#sonChipT').textContent = d;
  }
  async function sonBlob(r) {
    const parts = await sonTx('chunks', 'readonly', tx => tx.objectStore('chunks').index('rec').getAll(r.id));
    return new Blob((parts || []).map(p => p.b), { type: r.type.split(';')[0] });
  }
  async function sonDel(id) {
    await sonTx(['recs', 'chunks'], 'readwrite', tx => {
      tx.objectStore('recs').delete(id);
      const ix = tx.objectStore('chunks').index('rec'), c = ix.openKeyCursor(window.IDBKeyRange.only(id));
      c.onsuccess = () => { const k = c.result; if (k) { tx.objectStore('chunks').delete(k.primaryKey); k.continue(); } };
    });
    sonList();
  }
  async function sonList() {
    const ul = $('#sonList');
    sonUrls.forEach(u => URL.revokeObjectURL(u)); sonUrls = [];
    let recs = [];
    try { recs = (await sonTx('recs', 'readonly', tx => tx.objectStore('recs').getAll())) || []; } catch {}
    ul.textContent = '';
    for (const r of recs.filter(x => !son || x.id !== son.id).sort((a, b) => b.t - a.t)) {
      const blob = await sonBlob(r).catch(() => null);
      if (!blob || !blob.size) { sonDel(r.id).catch(() => {}); continue; }
      const url = URL.createObjectURL(blob); sonUrls.push(url);
      const d = new Date(r.t), stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
      const name = `cortege-son-${stamp}.${sonExt(r.type)}`;
      const when = d.toLocaleString(I18N.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const li = el('li', {}, el('b', {}, '🎙️ ' + when), ' · ' + sonDur(r.ms) + (r.done ? '' : ' · ' + t('interrompu')));
      const audio = el('audio', { controls: '', preload: 'metadata' }); audio.src = url;
      const save = el('a', { class: 'secondary', href: url, download: name }, t('Enregistrer le fichier'));
      const row = el('div', { class: 'controls' }, save);
      const file = typeof File === 'function' ? new File([blob], name, { type: blob.type }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        const sh = el('button', { type: 'button', class: 'secondary' }, t('Partager (Signal…)'));
        sh.onclick = () => navigator.share({ files: [file], title: name }).catch(() => {});
        row.append(sh);
      }
      const del = el('button', { type: 'button', class: 'ghost' }, t('Effacer'));
      del.onclick = () => { if (del.dataset.armed) { sonDel(r.id).catch(() => {}); return; } del.dataset.armed = '1'; del.textContent = t('Confirmer l’effacement'); setTimeout(() => { delete del.dataset.armed; del.textContent = t('Effacer'); }, 4000); };
      row.append(del);
      li.append(audio, row); ul.append(li);
    }
  }
  function openSon() { closeReport(); closeSheets(); $('#sheetSon').hidden = false; sonShow(); sonList(); }
  $('#btnSon').onclick = openSon;
  $('#sonChip').onclick = openSon;
  $('#sonClose').onclick = () => { closeSheets(); sonShow(); };
  $('#sonGo').onclick = () => { if (son) sonStop(); else sonStart(); };
  new MutationObserver(sonShow).observe($('#sheetSon'), { attributes: true, attributeFilter: ['hidden'] });
