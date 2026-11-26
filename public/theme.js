// Thème de Cortège : « system » (par défaut), « light », « jour » ou « dark », gardé sur le téléphone (localStorage).
// « jour » (plein jour) est le thème clair renforcé : aplats francs, contours nets, aucune ombre floue, pour un écran
// lisible au soleil. Il pose data-theme="light" et la classe « jour », comme « contraste » : la carte et les tuiles
// restent celles du thème clair.
// Chargé dans <head> avant les feuilles de style pour éviter un flash. Le mode manif impose l'apparence
// (plein jour tant que le soleil est levé, sombre la nuit : écran discret dans la rue) sans toucher au choix de la personne.
// Une page peut imposer un thème avec ?theme=clair|sombre|light|dark (utile pour la carte à intégrer).
(function () {
  var KEY = 'cortege-theme', pref = 'system', forced = null, urlTheme = null;
  try { pref = localStorage.getItem(KEY) || 'system'; } catch (e) {}
  // Mode manif déjà actif à l'ouverture : sombre d'emblée (seulement dans l'appli, qui a une balise theme-color)
  // Mode manif déjà actif : on reprend l'apparence décidée au dernier passage, le temps que l'appli recalcule la hauteur du soleil
  try { if (localStorage.getItem('cortege-manif') === '1' && document.querySelector('meta[name="theme-color"]')) forced = localStorage.getItem('cortege-manif-theme') === 'jour' ? 'jour' : 'dark'; } catch (e) {}
  try {
    var q = new URLSearchParams(location.search).get('theme');
    urlTheme = q === 'clair' || q === 'light' ? 'light' : q === 'sombre' || q === 'dark' ? 'dark' : null;
  } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var PICK = { light: 1, dark: 1, jour: 1 };
  function resolve() { return urlTheme || forced || (PICK[pref] ? pref : (mq && mq.matches ? 'light' : 'dark')); }
  var last = null;
  function apply() {
    var t = resolve(), jour = t === 'jour';
    document.documentElement.setAttribute('data-theme', jour ? 'light' : t);
    document.documentElement.classList.toggle('jour', jour);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', jour ? '#ffffff' : t === 'light' ? '#f3eef6' : '#0f1230');
    if (t !== last) { last = t; try { window.dispatchEvent(new CustomEvent('cortege-theme', { detail: t })); } catch (e) {} }
  }
  window.cortegeTheme = {
    get pref() { return pref; }, get current() { return resolve(); },
    set: function (v) { pref = PICK[v] ? v : 'system'; try { localStorage.setItem(KEY, pref); } catch (e) {} apply(); },
    // Thème imposé par l'appli (mode manif) ; null rend la main au choix de la personne. Un thème passé dans l'adresse reste prioritaire.
    force: function (v) { forced = PICK[v] ? v : null; apply(); }
  };
  if (mq) { var on = function () { if (pref === 'system' && !forced && !urlTheme) apply(); }; mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener && mq.addListener(on); }
  apply();
})();
