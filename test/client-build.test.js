'use strict';
// Les scripts servis (public/app.js, public/admin.js) doivent correspondre à leurs morceaux dans client/
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('scripts du téléphone et de l’admin : assemblés à jour depuis client/', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-client.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
