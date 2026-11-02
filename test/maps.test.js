'use strict';
// Cartes téléchargées depuis l'admin : estimation, extraction (faux outil pmtiles), mise en service sans redémarrer, suppression
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writePmtiles } = require('./pmtiles-fixture');

const ADMIN = 'admin-key-for-tests-456';
let srv, B, DIR, meta;
const api = (p, opt = {}) => fetch(B + p, { ...opt, headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json', ...(opt.headers || {}) } })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));

before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-maps-'));
  fs.writeFileSync(DIR + '/france.pmtiles', writePmtiles([{ z: 13, x: 4182, y: 2994, data: Buffer.from('montpellier') }]));
  fs.writeFileSync(DIR + '/source-de.pmtiles', writePmtiles([{ z: 13, x: 4400, y: 2686, data: Buffer.from('berlin') }], { bounds: [5.8, 47.2, 15.1, 55.1] }));
  // Faux index des builds de Protomaps : le plus récent en version 4 doit être choisi
  meta = require('node:http').createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([{ key: '20261030.pmtiles', version: '4.12.0' }, { key: '20261101.pmtiles', version: '4.13.0' }, { key: '20261102.pmtiles', version: '5.0.0-beta' }]));
  }).listen(0);
  await new Promise(r => meta.on('listening', r));
  const port = 20000 + Math.floor(Math.random() * 20000);
  B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, IMPORT_17OCT: '0', PLACES_IMPORT: '0',
      TILE_PMTILES: DIR + '/france.pmtiles', PMTILES_BIN: path.join(__dirname, 'fake-pmtiles.js'), FAKE_PM_SRC: DIR + '/source-de.pmtiles', FAKE_PM_LOG: DIR + '/pm.log',
      MAP_BUILDS_URL: 'http://127.0.0.1:' + meta.address().port + '/builds.json', MAP_BUILD_BASE: 'https://build.example/', LEGAL_WATCH: '0' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
});
after(() => { srv.kill(); meta.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

const tile = async (z, x, y) => { const r = await fetch(`${B}/vt/${z}/${x}/${y}.mvt`); return r.status === 200 ? Buffer.from(await r.arrayBuffer()).toString() : r.status; };

test('cartes : téléchargées depuis l’admin et servies sans redémarrer, puis supprimées', async () => {
  assert.equal((await api('/api/admin/maps', { headers: { 'x-admin-key': 'mauvaise' } })).s, 403);
  let st = (await api('/api/admin/maps')).j;
  assert.equal(st.tool, '1.31.2'); assert.match(st.install, /go-pmtiles_1\.31\.2_Linux_/);
  assert.ok(st.targets.find(t => t.code === 'fr').inUse, 'la carte de TILE_PMTILES est reconnue');
  assert.ok(st.targets.find(t => t.code === 'monde'));
  assert.equal(await tile(13, 4400, 2686), 204, 'Berlin pas encore couvert');
  // Pays non coché : refusé
  assert.equal((await api('/api/admin/maps/download', { method: 'POST', body: JSON.stringify({ code: 'de' }) })).s, 404);
  await api('/api/admin/countries/active', { method: 'POST', body: JSON.stringify({ codes: ['fr', 'de'] }) });
  const h0 = (await fetch(B + '/api/config').then(r => r.json())).cfgh;
  const go = await api('/api/admin/maps/download', { method: 'POST', body: JSON.stringify({ code: 'de' }) });
  assert.equal(go.s, 202, JSON.stringify(go.j));
  assert.equal((await api('/api/admin/maps/download', { method: 'POST', body: JSON.stringify({ code: 'de' }) })).s, 409, 'un seul à la fois');
  for (let i = 0; i < 100 && !(st = (await api('/api/admin/maps')).j).job.end; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(st.job.err, null); assert.equal(st.job.build, '20261101');
  const de = st.targets.find(t => t.code === 'de');
  assert.ok(de.inUse && de.downloaded); assert.equal(de.build, '20261101');
  assert.equal(await tile(13, 4400, 2686), 'berlin', 'Berlin servi tout de suite');
  assert.equal(await tile(13, 4182, 2994), 'montpellier', 'la France reste servie');
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  assert.notEqual(cfg.cfgh, h0, 'les téléphones rechargent leur configuration');
  assert.ok(cfg.vector.zones.some(z => z[2] === 5.8 && z[3] === 15.1), 'zone de l’Allemagne envoyée aux téléphones');
  // Estimation puis extraction, sur le build choisi et la zone du pays, au zoom de la rue
  const calls = fs.readFileSync(DIR + '/pm.log', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(calls.length, 2); assert.ok(calls[0].includes('--dry-run'));
  assert.equal(calls[1][1], 'https://build.example/20261101.pmtiles');
  assert.ok(calls[1].includes('--maxzoom=15') && calls[1].some(a => /^--region=.*germany\.geojson\.part$/.test(a)));
  assert.ok(fs.existsSync(DIR + '/d/cartes/germany.geojson') && !fs.readdirSync(DIR + '/d/cartes').some(f => f.endsWith('.part')));
  // Suppression : seulement les cartes téléchargées ici
  assert.equal((await api('/api/admin/maps/france.pmtiles', { method: 'DELETE' })).s, 404);
  assert.equal((await api('/api/admin/maps/germany.pmtiles', { method: 'DELETE' })).s, 200);
  assert.equal(await tile(13, 4400, 2686), 204);
  assert.ok(!fs.existsSync(DIR + '/d/cartes/germany.pmtiles'));
});
