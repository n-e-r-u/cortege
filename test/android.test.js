'use strict';
// Appli Android (Play Store) : fichier qui lie l'appli au site (/.well-known/assetlinks.json)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FP = 'AB:'.repeat(31) + 'CD';
async function run(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-android-')), port = 20000 + Math.floor(Math.random() * 20000);
  const s = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { stdio: 'ignore', env: { ...process.env, PORT: String(port), DATA_DIR: dir + '/d', LIVE_DIR: dir + '/l', TILE_DIR: dir + '/t',
    ADMIN_KEY: 'admin-key-for-tests-123', PLACES_IMPORT: '0', SOCIAL: '0', GITHUB_SYNC: '0', MEDIC_PUSH: '0', ORGA_REMIND: '0', ANDROID_CERT_SHA256: '', ANDROID_PACKAGE: '', ...env } });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    await fn(`http://127.0.0.1:${port}`);
  } finally { await new Promise(r => { s.once('exit', r); s.kill(); }); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('assetlinks.json : absent sans empreinte, sinon le paquet et les empreintes valides', async () => {
  await run({}, async B => assert.equal((await fetch(B + '/.well-known/assetlinks.json')).status, 404));
  await run({ ANDROID_CERT_SHA256: ` ${FP.toLowerCase()} , pas-une-empreinte` }, async B => {
    const r = await fetch(B + '/.well-known/assetlinks.json'), j = await r.json();
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.deepEqual(j, [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'tv.neru.cortege', sha256_cert_fingerprints: [FP] } }]);
  });
  await run({ ANDROID_CERT_SHA256: FP, ANDROID_PACKAGE: 'org.exemple.carte' }, async B => {
    assert.equal((await (await fetch(B + '/.well-known/assetlinks.json')).json())[0].target.package_name, 'org.exemple.carte');
  });
});
