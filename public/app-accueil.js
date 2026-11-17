(window.cortegeHtml = window.cortegeHtml || {}).accueil = "<section class=\"sheet welcome\" id=\"sheetWelcome\" hidden aria-labelledby=\"wlTitle1\">\n<div class=\"wl-step\" data-step=\"1\">\n<h2 id=\"wlTitle1\">Bienvenue sur Cortège</h2>\n<p>La carte des manifs en direct, tenue par celles et ceux qui y sont. Sans compte, sans pub, sans pistage.</p>\n<p>Commence par te situer : la carte s’ouvre sur ta zone, avec ce qui est signalé autour de toi.</p>\n<button class=\"secondary\" type=\"button\" id=\"wlLocate\">◎ Me situer</button>\n</div>\n<div class=\"wl-step\" data-step=\"2\" hidden>\n<h2>Signaler en deux appuis</h2>\n<p>Le bouton Signaler est au centre, en bas. Charge, nasse, lacrymo : un seul appui. Pour le reste : la famille, puis le type.</p>\n<p>Un signalement disparaît seul quand il n’est plus d’actualité. Sur place et tu ne vois plus rien ? Le bouton <b class=\"nw\">« Plus là »</b> le retire plus vite.</p>\n</div>\n<div class=\"wl-step\" data-step=\"3\" hidden>\n<h2>Être prévenu·e</h2>\n<p>Une alerte quand un danger est signalé près de toi, même appli fermée. Tu choisis ta zone et ce qui te prévient.</p>\n<button class=\"secondary\" type=\"button\" id=\"wlNotif\">🔔 Régler les alertes</button>\n<p>Dans l’onglet Droits : quoi faire en cas de contrôle ou d’interpellation, et les numéros des legal teams.</p>\n<p class=\"fine wl-credit\">Cortège est gratuit et financé par les dons. <a id=\"wlKofi\" target=\"_blank\" rel=\"noopener noreferrer\">Soutenir le projet</a><span id=\"wlIgSep\"> · </span><a id=\"wlIg\" target=\"_blank\" rel=\"noopener noreferrer\">Suivre sur Instagram</a></p>\n</div>\n<div class=\"wl-foot\">\n<button class=\"link-btn\" type=\"button\" id=\"wlSkip\">Passer</button>\n<span class=\"wl-dots\" aria-hidden=\"true\"><i class=\"on\"></i><i></i><i></i></span>\n<button class=\"install\" type=\"button\" id=\"wlNext\">Suivant</button>\n</div>\n</section>";
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
