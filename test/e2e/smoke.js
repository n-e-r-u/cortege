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

const ROOT = path.join(__dirname, '..', '..');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let pw; try { pw = require('playwright'); } catch { if (process.env.E2E_REQUIRED === '1') { console.error('Playwright absent.'); process.exit(1); } console.log('Playwright absent : test de fumée ignoré.'); return; }
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-e2e-'));
  const port = 20000 + Math.floor(Math.random() * 20000), B = 'http://127.0.0.1:' + port;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', PLACES_IMPORT: '0', SOCIAL: '0', VEILLE: '0', GITHUB_SYNC: '0', FLUSH_MS: '200' } });
  let browser, failed = null;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
    browser = await pw.chromium.launch();
    const errors = [];
    const phone = async () => {
      const ctx = await browser.newContext({ ...pw.devices['Pixel 5'], geolocation: { latitude: 43.6108, longitude: 3.8767 }, permissions: ['geolocation'], locale: 'fr-FR' });
      // Hors de la machine (fonds de carte) : rien ne sort pendant le test
      await ctx.route(u => !u.href.startsWith(B), r => r.abort());
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(B + '/', { waitUntil: 'load' });
      await page.waitForFunction(() => window.L && document.querySelector('.leaflet-container'));
      // Première visite : la page « Plus » s'ouvre, on la referme
      await page.evaluate(() => document.querySelectorAll('.sheet:not([hidden]) .x').forEach(b => b.click()));
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
    assert.deepEqual(errors, [], 'aucune erreur de script');
    console.log('Test de fumée : ok');
  } catch (e) { failed = e; }
  finally { try { await browser?.close(); } catch {} await new Promise(r => { srv.once('exit', r); srv.kill(); }); fs.rmSync(DIR, { recursive: true, force: true }); }
  if (failed) { console.error('Test de fumée : échec\n', failed); process.exit(1); }
})();
