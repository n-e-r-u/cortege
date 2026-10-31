'use strict';
// Reprise d'une ancienne base : la colonne « oid » des signalements (nom réservé par SQLite) devient « owner »
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('base ancienne : le propriétaire des points passe de « oid » à « owner » sans rien perdre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-migr-'));
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(path.join(dir, 'cortege.db'));
  old.exec(`CREATE TABLE reports(id TEXT PRIMARY KEY, cat TEXT NOT NULL, lat REAL, lng REAL, cell TEXT, note TEXT, t INTEGER, exp INTEGER,
    up INTEGER DEFAULT 0, down INTEGER DEFAULT 0, ver TEXT, voters TEXT DEFAULT '[]', down_ips TEXT DEFAULT '[]', oid TEXT)`);
  old.prepare('INSERT INTO reports(id,cat,lat,lng,cell,t,exp,oid) VALUES(?,?,?,?,?,?,?,?)').run('p1', 'medic', 43.6, 3.88, 'x', 1, Date.now() + 3600e3, 'orga-42');
  old.close();
  const code = `const { q } = require('./src/db'); process.stdout.write(JSON.stringify(q('SELECT owner FROM reports WHERE id=?').get('p1')));`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { owner: 'orga-42' });
  fs.rmSync(dir, { recursive: true, force: true });
});
