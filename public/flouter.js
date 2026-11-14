'use strict';
// Flouteur (/flouter) : masque les visages d'une photo avant de la publier. Tout se passe sur le téléphone : la photo n'est
// ni envoyée ni enregistrée (ni IndexedDB, ni cache), et seule la photo affichée reste décodée en mémoire.
// Le moteur de détection (MediaPipe) n'est téléchargé qu'à l'appui sur « Préparer le flouteur », dans un cache à part
// gardé d'une version de Cortège à l'autre : le Flouteur marche ensuite sans réseau. Logique partagée : flouter-lib.js ;
// éditeur de masques : flouter-editor.js.
(async () => {
  await window.I18N.ready;
  const F = window.cortegeFlouteur, I = window.I18N;
  const t = (s, v) => I.t(s, v), tn = (n, one, many, v) => I.tn(n, one, many, v);
  const percent = new Intl.NumberFormat(I.locale, { style: 'percent' });
  const decimal = new Intl.NumberFormat(I.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = r => percent.format(Math.min(1, Math.max(0, r)));
  // Région lue par les lecteurs d'écran : on ne réécrit le texte que s'il change, pour ne pas le faire relire
  const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

  // ---- Moteur de détection ----
  // Dans un worker si le téléphone sait y dessiner (OffscreenCanvas) ; sinon sur la page elle-même, plus lent mais pareil
  const canUseWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
  // Le Cache API n'existe que sur une adresse sécurisée (https ou localhost) : sans lui, le Flouteur marche en ligne seulement
  const canWorkOffline = 'caches' in window;
  const ENGINE_URLS = F.ENGINE_FILES.map(f => f.url), SIZE = Object.fromEntries(F.ENGINE_FILES.map(f => [f.url, f.size]));
  // Fichiers absents du cache du Flouteur ; tous s'il n'existe pas encore (une simple visite ne le crée pas)
  async function missingFiles(urls) {
    if (!canWorkOffline || !(await caches.has(F.FLOUTEUR_CACHE))) return urls;
    const cache = await caches.open(F.FLOUTEUR_CACHE), hits = await Promise.all(urls.map(u => cache.match(u)));
    return urls.filter((_, i) => !hits[i]);
  }
  // Télécharge ce qui manque, en comptant les octets reçus, puis la page elle-même pour l'ouvrir hors ligne.
  // Sans Cache API, le téléchargement remplit seulement le cache du navigateur (fichiers versionnés), que le moteur relira.
  async function downloadEngine(onProgress) {
    const engineFiles = await missingFiles(ENGINE_URLS), pageFiles = await missingFiles(F.PAGE_FILES);
    const cache = canWorkOffline ? await caches.open(F.FLOUTEUR_CACHE) : null, total = engineFiles.reduce((n, u) => n + SIZE[u], 0);
    let loaded = 0;
    onProgress(0, total);
    for (const url of engineFiles) {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`Téléchargement impossible : ${url} (HTTP ${res.status})`);
      const chunks = [], reader = res.body.getReader();
      for (let c = await reader.read(); !c.done; c = await reader.read()) {
        if (cache) chunks.push(c.value);
        loaded = Math.min(total, loaded + c.value.length); onProgress(loaded, total);
      }
      if (cache) await cache.put(url, new Response(new Blob(chunks), { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } }));
    }
    if (cache && pageFiles.length) await cache.addAll(pageFiles);
  }
  async function startWorkerEngine() {
    const worker = new Worker('/flouter-worker.js'), pending = new Map();
    let next = 1;
    await new Promise((resolve, reject) => {
      worker.addEventListener('error', () => reject(new Error('Le worker de détection ne démarre pas.')), { once: true });
      worker.addEventListener('message', ({ data: m }) => { if (m.type === 'ready') resolve(); if (m.type === 'error' && m.requestId === undefined) reject(new Error(m.message)); });
      worker.postMessage({ type: 'init' });
    }).catch(err => { worker.terminate(); throw err; });
    worker.addEventListener('error', () => { for (const p of pending.values()) p.reject(new Error('Le worker de détection s’est arrêté.')); pending.clear(); });
    worker.addEventListener('message', ({ data: m }) => {
      const p = pending.get(m.requestId);
      if (!p) return;
      if (m.type === 'progress') return p.onProgress(m.done, m.total);
      pending.delete(m.requestId);
      if (m.type === 'result') p.resolve({ bitmap: m.bitmap, faces: m.faces }); else p.reject(new Error(m.message));
    });
    return { mode: 'worker', detect: (file, onProgress) => new Promise((resolve, reject) => {
      const requestId = next++;
      pending.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({ type: 'detect', requestId, file });
    }) };
  }
  // Repli : même détection, sur la page. Le moteur y est compilé : c'est pour lui que cette page seule autorise
  // 'wasm-unsafe-eval' (voir src/http/static.js)
  async function startPageEngine() {
    if (!window.Vision) await new Promise((resolve, reject) => document.head.append(Object.assign(document.createElement('script'),
      { src: F.VISION_BUNDLE_URL, onload: resolve, onerror: () => reject(new Error('Moteur de détection introuvable.')) })));
    const detector = await F.createFaceDetector(window.Vision);
    return { mode: 'fil-principal', detect: (file, onProgress) => F.detectFacesInFile(detector, file, onProgress) };
  }

  // ---- Partage et enregistrement ----
  const canShareFiles = files => typeof navigator.canShare === 'function' && navigator.canShare({ files });
  function saveFile(file) {
    const url = URL.createObjectURL(file), a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  // Feuille de partage du téléphone si possible, sinon téléchargement. false si la personne annule le partage.
  async function shareOrSave(files, preferShare) {
    if (preferShare && canShareFiles(files)) {
      try { await navigator.share({ files }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    files.forEach(saveFile);
    return true;
  }

  // ---- Page ----
  // Éléments de la page par id, lus une fois : updateControls revient à chaque mouvement d'un pincement
  const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(el => [el.id, el]));
  const ctx = ui.preview.getContext('2d');
  const shareAvailable = canShareFiles([new File([], 'test.jpg', { type: 'image/jpeg' })]);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const decode = file => createImageBitmap(file, { imageOrientation: 'from-image' });
  // Une photo : { file, bitmap (seulement la photo affichée), width, height, masks, history, status : en-attente | analyse | prete | erreur }
  let photos = [], current = 0, maskStyle = 'aplat', analysing = false, exporting = false, enginePromise = null;

  const editor = window.cortegeMaskEditor({ stage: ui.stage, content: ui.stageContent, layer: ui.maskLayer, toolbar: ui.tools,
    maskLabel: n => t('Masque {n} (activer pour le retirer)', { n }) }, (masks, change) => {
    const photo = photos[current];
    if (!photo) return;
    photo.history.record({ masks: photo.masks, activeIndex: change.kind === 'ajout' ? null : change.maskIndex });
    photo.masks = masks;
    renderPreview();
    if (change.kind === 'retrait') announce(t('Masque retiré.'));
    updateControls();
  }, () => updateControls());

  // Un message identique au précédent ne serait pas relu : une espace insécable le rend différent
  function announce(message) { ui.announce.textContent = ui.announce.textContent === message ? message + ' ' : message; }
  // Message de fin d'export : il reçoit le focus, car on est en bas de l'éditeur et le message est en haut
  function showResult(message) { ui.status.textContent = message; ui.status.focus(); }
  function showProgress(ratio, label) { ui.progress.hidden = false; ui.progressLabel.textContent = label; ui.progressBar.value = Math.round(ratio * 100); }
  const hideProgress = () => { ui.progress.hidden = true; };
  // Un bouton qui se désactive perd le focus : on le rend au bouton actif le plus proche du même groupe, d'abord avant lui
  function keepFocus(el) {
    if (!(el instanceof HTMLButtonElement) || !el.disabled) return;
    const all = [...el.parentElement.querySelectorAll('button')], i = all.indexOf(el);
    [...all.slice(0, i).reverse(), ...all.slice(i + 1)].find(b => !b.disabled && !b.hidden)?.focus();
  }

  async function startEngine() {
    // Moteur déjà en cache (total nul) : pas de barre de téléchargement pendant son démarrage
    await downloadEngine((loaded, total) => { if (total) showProgress(loaded / total, t('Téléchargement du flouteur : {pct}', { pct: pct(loaded / total) })); });
    if (canUseWorker) {
      try { return await startWorkerEngine(); } catch { ui.status.textContent = t('Le mode rapide ne marche pas sur cet appareil. Préparation du mode de secours.'); }
    }
    return startPageEngine();
  }
  function prepare() {
    if (enginePromise) return enginePromise;
    // L'appli (service worker) ne s'installe qu'ici : une simple visite de la page ne télécharge rien
    if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) navigator.serviceWorker.register('/sw.js').catch(() => {});
    ui.prepare.disabled = true;
    ui.status.textContent = t('Préparation du flouteur…');
    enginePromise = startEngine().then(engine => {
      hideProgress();
      ui.prepare.hidden = true;
      if (!canWorkOffline) ui.readyText.textContent = t('Prêt, mais pas hors ligne : cette adresse n’est pas sécurisée (https).');
      ui.ready.hidden = false;
      ui.status.textContent = '';
      ui.flouteur.dataset.engine = engine.mode;
      return engine;
    }, err => {
      enginePromise = null;
      hideProgress();
      ui.prepare.disabled = false;
      ui.status.textContent = navigator.onLine ? t('La préparation a échoué. Vérifie ta connexion et réessaie.')
        : t('Le flouteur n’est pas encore prêt et le réseau est indisponible. Reconnecte-toi une fois pour le préparer.');
      throw err;
    });
    return enginePromise;
  }

  function releaseBitmap(photo) { if (photo) { photo.bitmap?.close(); photo.bitmap = null; } }
  // Aperçu vide : ni image, ni masque qui puisse recevoir un geste
  function clearPreview() { ctx.clearRect(0, 0, ui.preview.width, ui.preview.height); editor.clear(); }
  function renderPreview() {
    const photo = photos[current];
    if (!photo?.bitmap) return;
    ui.preview.width = Math.min(photo.width, Math.round((ui.stage.clientWidth || 360) * devicePixelRatio));
    ui.preview.height = Math.max(1, Math.round(ui.preview.width * photo.height / photo.width));
    F.drawMaskedImage(ctx, photo.bitmap, photo.masks, maskStyle);
    const n = photo.masks.length;
    setText(ui.maskCount, n ? tn(n, '{n} visage masqué. Vérifie avant de partager.', '{n} visages masqués. Vérifie avant de partager.') : t('Aucun visage masqué. Touche l’image pour ajouter un masque.'));
  }
  function updateControls() {
    const focused = document.activeElement, photo = photos[current], readyCount = photos.filter(p => p.status === 'prete').length;
    const isReady = photo?.status === 'prete', canEdit = isReady && !editor.isFinalPreview, canExport = isReady && !exporting;
    ui.editor.hidden = !photos.length;
    setText(ui.position, photos.length > 1 ? t('Photo {i} sur {n}', { i: current + 1, n: photos.length }) : '');
    ui.batchNav.hidden = photos.length < 2;
    ui.prev.disabled = current === 0;
    ui.next.disabled = current >= photos.length - 1;
    ui.undo.disabled = !canEdit || !photo.history.canUndo;
    ui.zoomOut.disabled = ui.zoomReset.disabled = !editor.isZoomed;
    ui.zoomIn.disabled = !isReady || !editor.canZoomIn;
    ui.addMask.disabled = !canEdit;
    ui.growMask.disabled = ui.shrinkMask.disabled = !canEdit || !editor.hasActive;
    ui.finalPreview.disabled = !isReady;
    ui.finalPreview.setAttribute('aria-pressed', String(editor.isFinalPreview));
    ui.share.hidden = !shareAvailable;
    ui.share.disabled = ui.save.disabled = !canExport;
    ui.exportAll.hidden = photos.length < 2;
    ui.exportAll.disabled = analysing || exporting || !readyCount;
    // Libellé court : il tient sur une ligne à 360 px
    ui.exportAll.textContent = readyCount ? tn(readyCount, 'Exporter {n} photo', 'Exporter les {n} photos') : t('Exporter les photos');
    keepFocus(focused);
  }

  async function showPhoto(index) {
    if (photos[current] !== photos[index]) releaseBitmap(photos[current]);
    current = index;
    const photo = photos[index];
    updateControls();
    if (!photo) return;
    if (photo.status !== 'prete' || !photo.file) {
      clearPreview();
      setText(ui.maskCount, photo.status === 'erreur' ? t('Cette photo n’a pas pu être lue.') : t('Analyse en cours…'));
      return;
    }
    if (!photo.bitmap) {
      // Pendant le décodage, les masques de la photo précédente ne doivent plus recevoir de geste
      clearPreview();
      const bitmap = await decode(photo.file);
      // Une autre photo a pu être affichée, ou celle-ci décodée par un appel concurrent, pendant l'attente
      const shown = photos[current] === photo;
      if (!shown || photo.bitmap) bitmap.close(); else photo.bitmap = bitmap;
      if (!shown) return;
    }
    ui.stageContent.style.aspectRatio = `${photo.width} / ${photo.height}`;
    editor.setImage(photo.width, photo.height, photo.masks);
    renderPreview();
    updateControls();
  }
  async function analysePending() {
    if (analysing) return;
    analysing = true;
    updateControls();
    try {
      const engine = await prepare();
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (photo.status !== 'en-attente' || !photo.file) continue;
        photo.status = 'analyse';
        try {
          const label = r => photos.length > 1 ? t('Analyse de la photo {i} sur {n} : {pct}', { i: i + 1, n: photos.length, pct: pct(r) }) : t('Analyse de la photo : {pct}', { pct: pct(r) });
          const { bitmap, faces } = await engine.detect(photo.file, (done, total) => showProgress(done / total, label(done / total)));
          Object.assign(photo, { width: bitmap.width, height: bitmap.height, masks: F.facesToMasks(faces, bitmap.width, bitmap.height), status: 'prete' });
          // Une seule image décodée à la fois : celle qui est affichée
          if (photos[current] === photo) { photo.bitmap = bitmap; await showPhoto(current); } else bitmap.close();
        } catch {
          photo.status = 'erreur';
          if (photos[current] === photo) await showPhoto(current);
        }
      }
    } catch {
      // La préparation a échoué : le message est déjà affiché, les photos restent en attente
    } finally { analysing = false; hideProgress(); updateControls(); }
  }
  function addPhotos(files) {
    const images = files.filter(f => f.type === '' || f.type.startsWith('image/'));
    if (!images.length) return;
    const first = photos.length;
    photos.push(...images.map(file => ({ file, bitmap: null, width: 0, height: 0, masks: [], history: new F.MaskHistory(), status: 'en-attente' })));
    ui.status.textContent = '';
    if (first === 0 || photos[current]?.status !== 'prete') showPhoto(first); else updateControls();
    // L'éditeur est sous la préparation et le choix des photos : on y amène la vue et le focus
    ui.editorTitle.focus({ preventScroll: true });
    ui.editorTitle.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    analysePending();
  }
  // La photo exportée quitte la liste : rien n'en reste en mémoire
  function removePhotos(removed) {
    for (const p of removed) { releaseBitmap(p); p.file = null; }
    photos = photos.filter(p => !removed.includes(p));
    editor.resetZoom();
    showPhoto(Math.min(current, Math.max(0, photos.length - 1)));
  }
  async function exportCurrent(preferShare) {
    const photo = photos[current];
    if (!photo?.bitmap || exporting) return;
    exporting = true;
    updateControls();
    try {
      const { file, isReduced } = await F.exportMaskedPhoto(photo.bitmap, photo.masks, maskStyle);
      if (!(await shareOrSave([file], preferShare))) return;
      removePhotos([photo]);
      showResult(t('Photo exportée : {name}.', { name: file.name }) + (isReduced ? ' ' + t('Elle a été réduite à {mp} millions de pixels.', { mp: decimal.format(F.MAX_EXPORT_PIXELS / 1e6) }) : ''));
    } catch { showResult(t('L’export a échoué. Réessaie.')); } finally { exporting = false; updateControls(); }
  }
  async function exportAll() {
    const ready = photos.filter(p => p.status === 'prete' && p.file);
    if (!ready.length || exporting) return;
    exporting = true;
    updateControls();
    try {
      const files = [];
      for (const [i, photo] of ready.entries()) {
        showProgress(i / ready.length, t('Export des photos : {pct}', { pct: pct(i / ready.length) }));
        // Une seule image décodée à la fois
        const bitmap = photo.bitmap || await decode(photo.file);
        try { files.push((await F.exportMaskedPhoto(bitmap, photo.masks, maskStyle)).file); } finally { bitmap.close(); photo.bitmap = null; }
      }
      hideProgress();
      if (!(await shareOrSave(files, true))) return void showPhoto(current);
      removePhotos(ready);
      showResult(tn(files.length, '{n} photo exportée.', '{n} photos exportées.'));
    } catch { showResult(t('L’export a échoué. Réessaie.')); } finally { hideProgress(); exporting = false; updateControls(); }
  }
  function undo() {
    const photo = photos[current], snapshot = photo?.history.undo();
    if (!snapshot) return;
    photo.masks = snapshot.masks;
    editor.restore(snapshot.masks, snapshot.activeIndex);
    renderPreview();
    announce(t('Annulé.'));
    updateControls();
  }
  // Photo partagée depuis une autre appli (Web Share Target) : le service worker la garde en mémoire sous un jeton, le temps
  // que la page la demande. partage=0 : elle est arrivée sans service worker pour la recevoir (voir server.js).
  async function receiveShared() {
    const token = new URLSearchParams(location.search).get('partage');
    if (token === null) return;
    history.replaceState(null, '', location.pathname);
    const sw = token !== '0' && navigator.serviceWorker?.controller;
    const files = sw ? await new Promise(resolve => {
      const onMessage = e => {
        if (e.data?.type !== 'flouteur-photos') return;
        navigator.serviceWorker.removeEventListener('message', onMessage);
        resolve(e.data.files || []);
      };
      navigator.serviceWorker.addEventListener('message', onMessage);
      navigator.serviceWorker.startMessages();
      sw.postMessage({ type: 'flouteur-partage', token });
    }) : [];
    if (!files.length) ui.status.textContent = t('La photo partagée n’a pas pu être reçue. Choisis-la ci-dessous.');
    addPhotos(files);
  }

  ui.prepare.textContent = t('Préparer le flouteur ({mb} Mo, une seule fois)', { mb: decimal.format(F.ENGINE_DOWNLOAD_MB) });
  ui.prepare.addEventListener('click', () => prepare().catch(() => {}));
  for (const input of document.querySelectorAll('.photo-input')) input.addEventListener('change', () => { addPhotos([...input.files]); input.value = ''; });
  for (const input of document.querySelectorAll('input[name="masquage"]')) input.addEventListener('change', () => { maskStyle = input.value; renderPreview(); });
  ui.undo.addEventListener('click', undo);
  ui.zoomOut.addEventListener('click', () => editor.zoomOut());
  ui.zoomIn.addEventListener('click', () => editor.zoomIn());
  ui.zoomReset.addEventListener('click', () => editor.resetZoom());
  ui.addMask.addEventListener('click', () => editor.addAtViewCenter());
  ui.growMask.addEventListener('click', () => editor.grow());
  ui.shrinkMask.addEventListener('click', () => editor.shrink());
  ui.finalPreview.addEventListener('click', () => { editor.showFinalPreview(!editor.isFinalPreview); updateControls(); });
  ui.share.addEventListener('click', () => exportCurrent(true));
  ui.save.addEventListener('click', () => exportCurrent(false));
  ui.exportAll.addEventListener('click', exportAll);
  ui.prev.addEventListener('click', () => showPhoto(current - 1));
  ui.next.addEventListener('click', () => showPhoto(current + 1));
  addEventListener('resize', renderPreview);
  ui.flouteur.hidden = false;
  updateControls();
  // Moteur déjà téléchargé : il démarre tout de suite, pour qu'aucune requête n'ait lieu entre le choix d'une photo et l'export
  missingFiles([...ENGINE_URLS, ...F.PAGE_FILES]).then(m => { if (!m.length) prepare().catch(() => {}); });
  receiveShared();
})();
