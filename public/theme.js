// Thème de Cortège : « system » (par défaut), « light » ou « dark », gardé sur le téléphone (localStorage).
// Chargé dans <head> avant les feuilles de style pour éviter un flash. Le mode manif force le sombre
// (écran discret dans la rue la nuit, moins de batterie) sans toucher au choix de la personne.
// Une page peut imposer un thème avec ?theme=clair|sombre|light|dark (utile pour la carte à intégrer).
(function () {
  var KEY = 'cortege-theme', pref = 'system', forced = null, urlTheme = null;
  try { pref = localStorage.getItem(KEY) || 'system'; } catch (e) {}
  // Mode manif déjà actif à l'ouverture : sombre d'emblée (seulement dans l'appli, qui a une balise theme-color)
  try { if (localStorage.getItem('cortege-manif') === '1' && document.querySelector('meta[name="theme-color"]')) forced = 'dark'; } catch (e) {}
  try {
    var q = new URLSearchParams(location.search).get('theme');
    urlTheme = q === 'clair' || q === 'light' ? 'light' : q === 'sombre' || q === 'dark' ? 'dark' : null;
  } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function resolve() { return urlTheme || forced || (pref === 'light' || pref === 'dark' ? pref : (mq && mq.matches ? 'light' : 'dark')); }
  var last = null;
  function apply() {
    var t = resolve(); document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#f3eef6' : '#0f1230');
    if (t !== last) { last = t; try { window.dispatchEvent(new CustomEvent('cortege-theme', { detail: t })); } catch (e) {} }
  }
  window.cortegeTheme = {
    get pref() { return pref; }, get current() { return resolve(); },
    set: function (v) { pref = v === 'light' || v === 'dark' ? v : 'system'; try { localStorage.setItem(KEY, pref); } catch (e) {} apply(); },
    // Thème imposé par l'appli (mode manif) ; null rend la main au choix de la personne. Un thème passé dans l'adresse reste prioritaire.
    force: function (v) { forced = v === 'light' || v === 'dark' ? v : null; apply(); }
  };
  if (mq) { var on = function () { if (pref === 'system' && !forced && !urlTheme) apply(); }; mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener && mq.addListener(on); }
  apply();
})();
