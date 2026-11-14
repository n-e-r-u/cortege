'use strict';
// Test de fumée dans un vrai navigateur (intégration continue seulement : Playwright n'est pas une dépendance de l'appli).
//   npx playwright install chromium && node test/e2e/smoke.js
// Lance un serveur local sur des données jetables, ouvre l'appli comme un téléphone, signale, confirme depuis un second
// téléphone, vérifie qu'aucune erreur de script n'apparaît et que le QR code de partage se charge à la demande.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..'), ADMIN = 'admin-key-for-e2e-tests-1';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pw; try { pw = require('playwright'); } catch { if (process.env.E2E_REQUIRED === '1') { console.error('Playwright absent.'); process.exit(1); } console.log('Playwright absent : test de fumée ignoré.'); return; }
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-e2e-'));
  const port = 20000 + Math.floor(Math.random() * 20000), B = 'http://127.0.0.1:' + port;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, PLACES_IMPORT: '0', SOCIAL: '0', VEILLE: '0', GITHUB_SYNC: '0', FLUSH_MS: '200', MEDIC_PUSH: '0' } });
  let browser, failed = null;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
    browser = await pw.chromium.launch();
    const errors = [];
    const phone = async (url = '/') => {
      const ctx = await browser.newContext({ ...pw.devices['Pixel 5'], geolocation: { latitude: 43.6108, longitude: 3.8767 }, permissions: ['geolocation'], locale: 'fr-FR' });
      // Hors de la machine (fonds de carte) : rien ne sort pendant le test
      await ctx.route(u => !u.href.startsWith(B), r => r.abort());
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(B + url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.L && document.querySelector('.leaflet-container'));
      // Première visite : la page « Plus » s'ouvre, on la referme (pas après une invitation : le code de secours doit rester affiché)
      if (url === '/') await page.evaluate(() => document.querySelectorAll('.sheet:not([hidden]) .x').forEach(b => b.click()));
      return page;
    };
    const a = await phone();
    assert.equal(await a.evaluate(() => typeof window.qrcode), 'undefined', 'QR code pas chargé au démarrage');
    // Signalement par l'interface : bouton central, première catégorie proposée, envoi
    await a.click('#btnReport');
    await a.waitForSelector('#sheetReport:not([hidden])');
    const sent = a.waitForResponse(r => r.url().endsWith('/api/reports') && r.request().method() === 'POST');
    await a.locator('#catGrid button[data-cat]:visible').first().click();
    const res = await sent;
    assert.equal(res.status(), 201, 'signalement accepté');
    const rep = await res.json();
    await a.waitForSelector('.leaflet-marker-icon', { timeout: 8000 });
    // Un second téléphone le voit et le confirme
    const b = await phone();
    await b.waitForSelector('.leaflet-marker-icon', { timeout: 10000 });
    const vote = await b.evaluate(async id => { const r = await fetch(`/api/reports/${id}/vote`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'e2e-second-phone-xxxxxxxx' }, body: JSON.stringify({ v: 1 }) }); return { s: r.status, j: await r.json() }; }, rep.id);
    assert.equal(vote.s, 200); assert.equal(vote.j.up, 1, 'confirmation comptée');
    // Partage : le QR code arrive à la demande
    await a.evaluate(() => document.querySelectorAll('.sheet:not([hidden]) .x').forEach(x => x.click()));
    await a.evaluate(() => document.querySelector('#btnShare').click());
    await a.waitForSelector('#qr svg', { timeout: 5000, state: 'attached' });
    // Les pages fabriquées par le serveur répondent
    for (const p of ['/agenda', '/droits', '/arretes', '/legal-teams', '/manif', '/admin.html', '/presse'])
      assert.equal((await fetch(B + p)).status, 200, p);
    assert.equal((await fetch(B + '/', { method: 'HEAD' })).status, 200, 'HEAD accepté');
    // Écran medic : son script n'est pas chargé sur un téléphone sans accès medic
    assert.equal(await a.evaluate(() => typeof window.cortegeMedic), 'undefined', 'app-medic.js pas chargé sans accès medic');
    // ---- Espace orga : tableau de bord dans « Mon orga », lien vers l'affiche au nom de l'orga ----
    {
      const h = { 'content-type': 'application/json', 'x-admin-key': ADMIN };
      const o = await fetch(B + '/api/admin/orgas', { method: 'POST', headers: h, body: JSON.stringify({ label: 'Collectif E2E' }) }).then(r => r.json());
      const p = await phone('/?invite=' + o.invite);
      await p.waitForSelector('#sheetRec:not([hidden]) #recCode');
      await p.click('#rcBody .install');
      await p.waitForSelector('#sheetOrga:not([hidden]) #orgaBoard:not([hidden]) .ob-tile');
      assert.equal(await p.locator('#obTiles .ob-tile').count(), 4, 'quatre compteurs');
      assert.match(await p.getAttribute('#obPoster', 'href'), /^\/affiche\.html\?orga=Collectif%20E2E/);
      const poster = await p.context().newPage();
      poster.on('pageerror', e => errors.push('affiche : ' + e.message));
      await poster.goto(B + '/affiche.html?orga=Collectif%20E2E&rdv=Samedi%2014%20h&at=43.61,3.87', { waitUntil: 'load' });
      await poster.waitForSelector('#qr svg');
      assert.match(await poster.textContent('#with'), /avec Collectif E2E/);
      assert.equal(await poster.isVisible('#rdvLine'), true);
      await poster.selectOption('#format', 'a6');
      assert.equal(await poster.locator('.page4 .sheet').count(), 4, 'quatre flyers par page');
      assert.equal(await poster.isVisible('#sheet'), false);
      await p.context().close();
    }
    // ---- Mode medic : deux équipes, un renfort, « j'y vais », « réglé », puis un accès perdu et retrouvé ----
    const adm = body => fetch(B + '/api/admin/medics', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN }, body: JSON.stringify(body) }).then(r => r.json());
    const t1 = await adm({ label: 'Équipe Une', city: 'Montpellier' }), t2 = await adm({ label: 'Équipe Deux', city: 'Montpellier' });
    const join = async t => {
      const p = await phone('/?invite=' + t.invite);
      await p.waitForSelector('#sheetRec:not([hidden]) #recCode');
      const code = (await p.textContent('#recCode')).trim();
      await p.click('#rcBody .install');
      await p.waitForFunction(() => document.body.classList.contains('medic'));
      return { p, code };
    };
    const m1 = await join(t1), m2 = await join(t2);
    assert.match(m1.code, /^(\w{4}-){4}\w{4}$/, 'code de secours affiché à l’activation');
    assert.equal(await m1.p.isVisible('#tabbar'), false, 'écran medic : pas de barre d’onglets');
    assert.equal(await m1.p.evaluate(() => document.querySelectorAll('.leaflet-marker-icon.pin, .marker-cluster').length), 0, 'signalements publics masqués');
    await m1.p.click('#mdHot');
    await m2.p.waitForSelector('.mpin.k-hot');
    // Seulement les points des équipes : tout ce qui est public (agenda, lieux, parcours…) est masqué, sauf demande
    const panes = p => p.evaluate(() => ['marker', 'overlay', 'medic'].map(n => getComputedStyle(document.querySelector('.leaflet-' + n + '-pane')).display !== 'none'));
    assert.deepEqual(await panes(m2.p), [false, false, true], 'écran medic : seulement les points des équipes');
    assert.equal(await m2.p.isVisible('.mpin.k-hot'), true);
    await m2.p.click('#medicPub');
    assert.deepEqual(await panes(m2.p), [true, true, true], '« Afficher aussi ce qui est public »');
    await m2.p.click('#medicPub');
    await m2.p.click('#mdHelp'); await m2.p.click('.mh-btn.l-vital');
    await m1.p.waitForSelector('.mpin.k-help.l-vital');
    await m1.p.evaluate(() => document.querySelector('.mpin.k-help').click());
    await m1.p.click('#mcActs .install');
    await m2.p.waitForSelector('.mpin.k-help em');
    await m2.p.evaluate(() => document.querySelector('.mpin.k-help').click());
    assert.match(await m2.p.textContent('#mcSub'), /Équipe Une/, 'l’équipe en route est nommée');
    await m2.p.click('#mcActs button');
    await m1.p.waitForFunction(() => !document.querySelector('.mpin.k-help'));
    // Rien de tout ça sur la carte publique
    assert.ok(!JSON.stringify(await a.evaluate(() => fetch('/api/reports?bbox=43,3,44,4').then(r => r.json()))).includes('Équipe'), 'carte publique sans équipe medic');
    // Téléphone perdu : le code de secours redonne l'accès sur un autre, et coupe le premier
    const lost = await phone();
    await lost.evaluate(() => document.querySelector('#btnRecover').click());
    await lost.fill('#rvCode', m1.code.replace(/-/g, '').toLowerCase());
    assert.equal(await lost.inputValue('#rvCode'), m1.code, 'saisie remise en forme');
    await lost.click('#rvGo');
    await lost.waitForSelector('#sheetRec:not([hidden]) #recCode');
    assert.notEqual((await lost.textContent('#recCode')).trim(), m1.code, 'nouveau code donné');
    await Promise.all([lost.waitForNavigation(), lost.click('#rcBody .install')]);
    await lost.waitForFunction(() => document.body.classList.contains('medic'));
    // L'ancien téléphone perd l'écran medic tout seul : à sa prochaine lecture de la carte (30 s au plus), sa clé est refusée
    await m1.p.waitForFunction(() => !document.body.classList.contains('medic'), null, { timeout: 40000 });
    assert.equal(await m1.p.evaluate(() => localStorage.getItem('cortege-medic')), null, 'ancien téléphone coupé');
    assert.deepEqual(errors, [], 'aucune erreur de script');
    console.log('Test de fumée : ok');
  } catch (e) { failed = e; }
  finally { try { await browser?.close(); } catch {} await new Promise(r => { srv.once('exit', r); srv.kill(); }); fs.rmSync(DIR, { recursive: true, force: true }); }
  if (failed) { console.error('Test de fumée : échec\n', failed); process.exit(1); }
})();
