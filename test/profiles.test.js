'use strict';
// Profils pays : la bonne zone pour chaque endroit, les types propres à un pays, les types masqués
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('profils pays : France, Allemagne, États-Unis sur une même instance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-pf-'));
  const code = `const p = require('./src/profiles'); const { CAT, ALERT_CATS } = require('./src/categories');
    const at = (a, b) => p.profileAt(a, b).code;
    process.stdout.write('RESULT' + JSON.stringify({
      mtp: at(43.61, 3.88), berlin: at(52.52, 13.40), cologne: at(50.94, 6.96), nyc: at(40.71, -74.0), tokyo: at(35.68, 139.69),
      zoneTokyo: p.inZone(35.68, 139.69), zoneBerlin: p.inZone(52.52, 13.40),
      iceNyc: p.catAllowed('ice', 40.71, -74.0), iceParis: p.catAllowed('ice', 48.85, 2.35), milBerlin: p.catAllowed('militaires', 52.52, 13.40),
      milParis: p.catAllowed('militaires', 48.85, 2.35), iceAlert: ALERT_CATS.has('ice') && !!CAT.ice,
      client: p.clientProfiles().map(x => [x.code, !!x.area, x.units]) }));`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, DATA_DIR: dir, PROFILES: 'fr,de,us' } });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.split('RESULT').pop());
  assert.equal(o.mtp, 'fr'); assert.equal(o.berlin, 'de'); assert.equal(o.cologne, 'de'); assert.equal(o.nyc, 'us');
  assert.equal(o.tokyo, 'fr', 'hors de toutes les zones : le premier profil');
  assert.equal(o.zoneTokyo, false); assert.equal(o.zoneBerlin, true);
  assert.equal(o.iceNyc, true); assert.equal(o.iceParis, false, 'ICE n’existe qu’aux États-Unis');
  assert.equal(o.milBerlin, false, 'masqué en Allemagne'); assert.equal(o.milParis, true); assert.equal(o.iceAlert, true);
  assert.deepEqual(o.client, [['fr', true, 'metric'], ['de', true, 'metric'], ['us', true, 'imperial']]);
  fs.rmSync(dir, { recursive: true, force: true });
});
