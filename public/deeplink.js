// Liens vers un profil Instagram : ouvre l'appli Instagram si elle est installée, sinon le site.
// - Android (Chrome, Edge, Samsung Internet, dans le navigateur ou installé) et iPhone avec Cortège sur l'écran
//   d'accueil : on passe par l'adresse de l'appli (instagram://), puis on ouvre le site si le téléphone n'a pas
//   quitté Cortège au bout d'une seconde et demie. Les liens « intent » avec repli intégré ne suffisent pas :
//   Edge installé en appli ouvre directement le repli dans le navigateur.
// - iPhone dans Safari : le lien https ordinaire ouvre déjà l'appli (lien universel), on n'y touche pas.
// Rien n'est envoyé nulle part : le script lit seulement l'adresse du lien touché.
(function () {
  var ua = navigator.userAgent || '';
  var android = /Android/i.test(ua) && !/Firefox/i.test(ua); // Firefox propose déjà d'ouvrir l'appli, et gère mal les liens intent
  var ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!android && !(ios && standalone)) return;
  var RESERVED = /^(p|reel|reels|stories|explore|accounts|direct|tv|about|legal|developer)$/i;
  function handleOf(a) {
    try {
      var u = new URL(a.href);
      if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
      var parts = u.pathname.split('/').filter(Boolean);
      return parts.length === 1 && /^[A-Za-z0-9._]{1,30}$/.test(parts[0]) && !RESERVED.test(parts[0]) ? parts[0] : null;
    } catch (e) { return null; }
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    var h = a && handleOf(a);
    if (!h) return;
    e.preventDefault();
    var web = 'https://www.instagram.com/' + h + '/';
    var left = false, timer;
    var gone = function () { if (document.hidden) { left = true; clearTimeout(timer); } };
    var blurred = function () { left = true; clearTimeout(timer); };
    document.addEventListener('visibilitychange', gone);
    window.addEventListener('pagehide', gone);
    // Android : la fenêtre perd le focus dès que le système affiche l'appli (ou demande « Ouvrir avec Instagram ? »)
    if (android) window.addEventListener('blur', blurred, { once: true });
    timer = setTimeout(function () {
      document.removeEventListener('visibilitychange', gone); window.removeEventListener('blur', blurred);
      if (!left && !window.open(web, '_blank', 'noopener')) location.href = web;
    }, 1500);
    location.href = 'instagram://user?username=' + encodeURIComponent(h);
  });
})();
