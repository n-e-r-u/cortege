'use strict';
// Plusieurs fichiers de carte : un par pays, plus une carte du monde légère pour les zooms éloignés
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writePmtiles } = require('./pmtiles-fixture');

test('carte : un fichier par pays et une carte du monde, la bonne tuile vient du bon fichier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-pm-'));
  // Montpellier (z13) dans le fichier France, Berlin (z13) dans le fichier Allemagne, le monde jusqu'au zoom 6
  fs.writeFileSync(dir + '/france.pmtiles', writePmtiles([{ z: 13, x: 4182, y: 2994, data: Buffer.from('montpellier') }, { z: 3, x: 4, y: 2, data: Buffer.from('france-z3') }]));
  fs.writeFileSync(dir + '/allemagne.pmtiles', writePmtiles([{ z: 13, x: 4400, y: 2686, data: Buffer.from('berlin') }], { bounds: [5.8, 47.2, 15.1, 55.1] }));
  fs.writeFileSync(dir + '/monde.pmtiles', writePmtiles([{ z: 3, x: 4, y: 2, data: Buffer.from('monde-z3') }], { maxz: 6, bounds: [-180, -85, 180, 85] }));
  const code = `const p = require('./src/geo/pmtiles'); const zlib = require('zlib');
    (async () => { const t = async (z, x, y) => { const r = await p.pmTileC(z, x, y); return r ? zlib.gunzipSync(r.data).toString() : null; };
      const out = { mtp: await t(13, 4182, 2994), ber: await t(13, 4400, 2686), z3: await t(3, 4, 2), vide: await t(13, 1, 1), info: p.pmInfo() };
      process.stdout.write('RESULT' + JSON.stringify(out)); })();`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, DATA_DIR: dir + '/d', TILE_PMTILES: [dir + '/france.pmtiles', dir + '/allemagne.pmtiles', dir + '/monde.pmtiles'].join(',') } });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.split('RESULT').pop());
  assert.equal(o.mtp, 'montpellier'); assert.equal(o.ber, 'berlin');
  assert.equal(o.z3, 'monde-z3', 'zoom éloigné : la carte du monde, pas le fichier régional');
  assert.equal(o.vide, null);
  assert.equal(o.info.worldMaxZoom, 6); assert.equal(o.info.maxzoom, 15);
  assert.ok(o.info.zones.some(z => z[2] === 5.8 && z[3] === 15.1), 'zone de l’Allemagne');
  assert.ok(!o.info.zones.some(z => z[2] === -180), 'la carte du monde n’est pas une zone régionale');
  fs.rmSync(dir, { recursive: true, force: true });
});
