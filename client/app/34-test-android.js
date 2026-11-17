  // ---- Test fermé du Play Store : bandeau sur Android et cadre dans Plus, si l'admin a renseigné la page d'inscription ----
  // Rien dans l'appli Android elle-même (ouverte depuis le Play Store : elle est déjà installée) ; le bandeau fermé ne revient pas
  // (sauf si le lien change).
  const TEST_KEY = 'cortege-test-android';
  let testInApp = false;
  try {
    if (document.referrer.startsWith('android-app://')) sessionStorage.setItem('cortege-twa', '1');
    testInApp = sessionStorage.getItem('cortege-twa') === '1';
  } catch {}
  function testShow() {
    const url = cfg.androidTest, on = !!url && !testInApp;
    let closed = false; try { closed = localStorage.getItem(TEST_KEY) === url; } catch {}
    $('#testCard').hidden = !on; if (on) $('#testCard').href = url;
    $('#testBand').hidden = !on || closed || !/Android/i.test(navigator.userAgent);
    if (on) $('#testBandLink').href = url;
  }
  $('#testBandX').onclick = () => { try { localStorage.setItem(TEST_KEY, cfg.androidTest); } catch {} $('#testBand').hidden = true; };
  testShow();
