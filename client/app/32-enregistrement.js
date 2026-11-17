  // ---- Enregistrer le son (contrôle, interpellation) : gardé sur le téléphone seulement, jamais envoyé à Cortège ----
  // L'enregistreur et sa fiche (public/app-son.js, client/parts/son.js) ne sont chargés qu'au premier appui sur 🎙️.
  const sonOk = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.indexedDB);
  const openSon = () => {
    closeReport(); closeSheets();
    loadPart('son', () => ({ $, el, t, toast, I18N, closeReport, closeSheets, addSheet })).then(m => m.open()).catch(() => toast('Pas de réseau : l’enregistreur se chargera quand ça capte.'));
  };
  for (const b of ['#btnSon', '#btnSonMap', '#btnSonMore', '#srSon']) { $(b).hidden = !sonOk; $(b).onclick = openSon; }
