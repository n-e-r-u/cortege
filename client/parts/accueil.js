'use strict';
// ---- Premier lancement : trois écrans (ta zone, signaler, alertes), montrés une seule fois ----
// Chargé seulement à la première visite (public/app-accueil.js, avec sa fiche) : voir la fin de client/app/26-modes.js.
window.cortegeAccueil = function (core) {
  const { $, t, closeSheets, locate, openNotif } = core;
  core.addSheet(window.cortegeHtml.accueil);
  const sheet = $('#sheetWelcome'), steps = [...sheet.querySelectorAll('.wl-step')], dots = [...sheet.querySelectorAll('.wl-dots i')];
  let cur = 0;
  function show(i) {
    cur = i;
    steps.forEach((s, k) => { s.hidden = k !== i; });
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    $('#wlNext').textContent = t(i === steps.length - 1 ? 'C’est parti' : 'Suivant');
    $('#wlSkip').hidden = i === steps.length - 1;
    sheet.scrollTop = 0;
  }
  const done = () => closeSheets();
  $('#wlNext').onclick = () => (cur < steps.length - 1 ? show(cur + 1) : done());
  $('#wlSkip').onclick = done;
  // La demande de position vient d'un appui : le navigateur peut afficher sa question
  $('#wlLocate').onclick = () => { locate(); show(1); };
  $('#wlNotif').onclick = () => { done(); openNotif(); };
  // Liens de soutien de l'instance : repris de la page Plus (masqués là-bas, masqués ici)
  for (const [mine, src] of [['#wlKofi', '#kofiLink'], ['#wlIg', '#igLink']]) { const a = $(src); if (a && !a.hidden && a.href) $(mine).href = a.href; else $(mine).hidden = true; }
  $('#wlIgSep').hidden = $('#wlKofi').hidden || $('#wlIg').hidden;
  return { open() { closeSheets(); show(0); sheet.hidden = false; } };
};
