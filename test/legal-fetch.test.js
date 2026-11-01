'use strict';
// Veille des legal teams : jamais vers le réseau interne, même avec une adresse IP écrite dans le lien
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-legal-'));
delete process.env.FETCH_ALLOW_PRIVATE;
const { fetchPublic, blockedIp } = require('../src/legal');

test('adresses internes reconnues, y compris sous forme IPv6', () => {
  for (const a of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', 'fd00::1', 'fe80::1'])
    assert.equal(blockedIp(a), true, a);
  for (const a of ['1.1.1.1', '2606:4700::1111', '2002:808:808::']) assert.equal(blockedIp(a), false, a);
});

test('lien avec une adresse IP littérale interne refusé avant toute connexion', async () => {
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://localhost/'])
    await assert.rejects(fetchPublic(u), /interne/, u);
});
