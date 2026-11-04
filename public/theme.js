// Thème de l'appli : clair, sombre ou celui du système (choix gardé sur ce téléphone).
// Chargé tout en haut de la page, avant l'affichage, pour éviter un flash de la mauvaise couleur.
(function () {
  var KEY = 'cortege-theme', pref = 'system';
  try { pref = localStorage.getItem(KEY) || 'system'; } catch (e) {}
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function resolve() { return pref === 'light' || pref === 'dark' ? pref : (mq && mq.matches ? 'light' : 'dark'); }
  function apply() {
    var t = resolve();
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#fbeceb' : '#0f1230');
    try { window.dispatchEvent(new CustomEvent('cortege-theme', { detail: t })); } catch (e) {}
  }
  window.cortegeTheme = {
    get pref() { return pref; },
    get current() { return resolve(); },
    set: function (v) { pref = v === 'light' || v === 'dark' ? v : 'system'; try { localStorage.setItem(KEY, pref); } catch (e) {} apply(); },
  };
  if (mq) { var on = function () { if (pref === 'system') apply(); }; mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener && mq.addListener(on); }
  apply();
})();
