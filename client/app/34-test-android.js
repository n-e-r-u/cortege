  // ---- Play Store : test fermé (bandeau sur Android et cadre dans Plus) tant que l'admin a renseigné la page d'inscription,
  // puis cadre « Cortège est sur le Play Store » quand il a renseigné la fiche de l'appli publiée ----
  // Rien dans l'appli Android elle-même (ouverte depuis le Play Store : elle est déjà installée) ; le bandeau fermé ne revient pas
  // (sauf si le lien change).
  const TEST_KEY = 'cortege-test-android';
  let testInApp = false;
  try {
    if (document.referrer.startsWith('android-app://')) sessionStorage.setItem('cortege-twa', '1');
    testInApp = sessionStorage.getItem('cortege-twa') === '1';
  } catch {}
  function testShow() {
    // Appli publiée (fiche Google Play renseignée) : le test fermé n'est plus proposé, le cadre de Plus mène à la fiche (pas sur iPhone)
    const play = cfg.playStore, url = cfg.androidTest, on = !!url && !play && !testInApp;
    let closed = false; try { closed = localStorage.getItem(TEST_KEY) === url; } catch {}
    $('#testCard').hidden = !on; if (on) $('#testCard').href = url;
    $('#testBand').hidden = !on || closed || !/Android/i.test(navigator.userAgent);
    if (on) $('#testBandLink').href = url;
    $('#playCard').hidden = !play || testInApp || /iphone|ipad|ipod/i.test(navigator.userAgent); if (play) $('#playCard').href = play;
  }
  $('#testBandX').onclick = () => { try { localStorage.setItem(TEST_KEY, cfg.androidTest); } catch {} $('#testBand').hidden = true; };
  testShow();
