'use strict';
// Partage sur Bluesky et Mastodon : faux serveurs des deux réseaux, jamais les vrais.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ADMIN = 'admin-key-for-tests-123';
const ROOT = path.join(__dirname, '..');
let srv, B, DIR, fake, calls = [], failMasto = 0;
const day = (d = 0) => new Date(Date.now() + d * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const wait = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-soc-'));
  // Faux Bluesky (PDS) et faux Mastodon sur le même port
  fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks), body = /json/.test(req.headers['content-type'] || '') && raw.length ? JSON.parse(raw) : null;
      calls.push({ m: req.method, p: req.url, h: req.headers, body, size: raw.length });
      const ok = j => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j)); };
      if (req.url === '/xrpc/com.atproto.server.createSession') return body.password === 'app-pass' ? ok({ did: 'did:plc:test', accessJwt: 'jwt1', handle: 'cortege.test' }) : (res.statusCode = 401, ok({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }));
      if (req.url === '/xrpc/com.atproto.repo.uploadBlob') return ok({ blob: { $type: 'blob', ref: { $link: 'bafy' }, mimeType: 'image/png', size: raw.length } });
      if (req.url === '/xrpc/com.atproto.repo.createRecord') return ok({ uri: 'at://did:plc:test/app.bsky.feed.post/3kabc' + calls.length, cid: 'bafyc' });
      if (req.url === '/xrpc/com.atproto.repo.deleteRecord') return ok({});
      if (req.url === '/api/v1/accounts/verify_credentials') return ok({ acct: 'cortege', url: 'https://masto.test/@cortege' });
      if (req.url === '/api/v1/statuses' && req.method === 'POST') { if (failMasto-- > 0) { res.statusCode = 503; return ok({ error: 'busy' }); } return ok({ id: '1100' + calls.length, url: 'https://masto.test/@cortege/1100' }); }
      if (req.url.startsWith('/api/v1/statuses/') && req.method === 'DELETE') return ok({});
      res.statusCode = 404; ok({ error: 'not found' });
    });
  }).listen(0);
  await new Promise(r => fake.on('listening', r));
  const F = 'http://127.0.0.1:' + fake.address().port;
  const port = 20000 + Math.floor(Math.random() * 20000);
  B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', IMPORT_17OCT: '0', PLACES_IMPORT: '0',
      ORDER_PUSH_WAIT_MS: '200', SOCIAL_ORDER_WAIT_MS: '300', SOCIAL_TICK_MS: '250', PUBLIC_URL: 'https://cortege.example',
      BLUESKY_HANDLE: '@cortege.test', BLUESKY_APP_PASSWORD: 'app-pass', BLUESKY_PDS: F, MASTODON_URL: F, MASTODON_TOKEN: 'tok' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
  await wait(300);
});
after(() => { srv.kill(); fake.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

const req = (m, p, body) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN, 'x-forwarded-for': '81.1.1.1', 'x-device': 'dev-social-test-xxxxxxxx' }, body: body && JSON.stringify(body) })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const state = () => req('GET', '/api/admin/social').then(r => r.j);
async function until(fn, ms = 6000) { for (let t = 0; t < ms; t += 150) { const v = await fn(); if (v) return v; await wait(150); } return null; }

test('réseaux : admin seulement, état des comptes, test de connexion', async () => {
  assert.equal((await fetch(B + '/api/admin/social')).status, 403);
  const d = await state();
  assert.equal(d.nets.bsky.ready, true); assert.equal(d.nets.masto.ready, true);
  assert.equal(d.nets.bsky.who, '@cortege.test');
  assert.ok(!JSON.stringify(d).includes('app-pass') && !JSON.stringify(d).includes('"tok"'), 'aucun secret renvoyé');
  const t = await req('POST', '/api/admin/social/test', {});
  assert.deepEqual([t.j.bsky.ok, t.j.masto.ok, t.j.masto.who], [true, true, '@cortege']);
});

test('réseaux : message écrit à la main, publié sur les deux réseaux avec lien, mots-clés et carte', async () => {
  await req('POST', '/api/admin/social/config', { tags: 'manif #Cortège bad-tag!' });
  assert.equal((await state()).cfg.tags, '#manif #Cortège #badtag');
  assert.equal((await req('POST', '/api/admin/social/post', { text: 'Salut', link: 'http://pas-https.fr' })).s, 400);
  calls = [];
  const p = await req('POST', '/api/admin/social/post', { text: 'Rendez-vous samedi, la carte est prête ✊', link: 'https://cortege.example/' });
  assert.equal(p.s, 201);
  const done = await until(async () => (await state()).posts.find(x => x.id === p.j.id && x.status === 'done'));
  assert.ok(done, 'publié');
  assert.match(done.nets.bsky.url, /^https:\/\/bsky\.app\/profile\/cortege\.test\/post\/3kabc/);
  const rec = calls.find(c => c.p.endsWith('createRecord')).body;
  assert.equal(rec.repo, 'did:plc:test'); assert.equal(rec.collection, 'app.bsky.feed.post');
  const r = rec.record, bytes = Buffer.from(r.text);
  const link = r.facets.find(f => f.features[0].$type.endsWith('#link')), tag = r.facets.find(f => f.features[0].tag === 'Cortège');
  assert.equal(bytes.subarray(link.index.byteStart, link.index.byteEnd).toString(), 'https://cortege.example/');
  assert.equal(bytes.subarray(tag.index.byteStart, tag.index.byteEnd).toString(), '#Cortège', 'positions en octets (accents et emoji)');
  assert.equal(r.embed.external.uri, 'https://cortege.example/'); assert.ok(r.embed.external.thumb, 'image de la carte envoyée');
  assert.equal(calls.find(c => c.p.endsWith('createRecord')).h.authorization, 'Bearer jwt1');
  const st = calls.find(c => c.p === '/api/v1/statuses');
  assert.equal(st.h.authorization, 'Bearer tok'); assert.equal(st.h['idempotency-key'], p.j.id);
  assert.match(st.body.status, /Rendez-vous samedi[\s\S]*https:\/\/cortege\.example\/\n#manif #Cortège #badtag$/);
  assert.equal(st.body.visibility, 'public'); assert.equal(st.body.language, 'fr');
  // Retrait des deux réseaux
  calls = [];
  assert.equal((await req('DELETE', '/api/admin/social/' + p.j.id)).s, 200);
  assert.ok(calls.some(c => c.p.endsWith('deleteRecord') && c.body.rkey.startsWith('3kabc')));
  assert.ok(calls.some(c => c.m === 'DELETE' && c.p.startsWith('/api/v1/statuses/1100')));
  assert.equal((await state()).posts.find(x => x.id === p.j.id).status, 'deleted');
});

test('réseaux : texte trop long coupé à 300 pour Bluesky, 500 pour Mastodon, lien gardé', async () => {
  await req('POST', '/api/admin/social/config', { tags: '' });
  calls = [];
  const long = 'é'.repeat(700);
  const p = await req('POST', '/api/admin/social/post', { text: long, link: 'https://cortege.example/x' });
  await until(async () => (await state()).posts.find(x => x.id === p.j.id && x.status === 'done'));
  const bt = calls.find(c => c.p.endsWith('createRecord')).body.record.text, mt = calls.find(c => c.p === '/api/v1/statuses').body.status;
  assert.equal([...bt].length, 300); assert.ok(bt.endsWith('…\n\nhttps://cortege.example/x'));
  assert.equal([...mt].length, 500); assert.ok(mt.endsWith('https://cortege.example/x'));
});

test('réseaux : erreur passagère réessayée, relecture avant envoi, bilan publié une seule fois', async () => {
  // Mastodon indisponible au premier essai : nouvel essai prévu, Bluesky déjà publié
  failMasto = 1;
  const p = await req('POST', '/api/admin/social/post', { text: 'Essai avec panne' });
  const half = await until(async () => { const x = (await state()).posts.find(y => y.id === p.j.id); return x && x.nets.masto.tries === 1 && x; });
  assert.equal(half.nets.bsky.st, 'ok'); assert.equal(half.nets.masto.st, 'wait'); assert.equal(half.status, 'queued');
  // Relecture : le bilan attend, modifiable, puis publié
  await req('POST', '/api/admin/social/config', { mode: 'review' });
  await req('POST', '/api/reports', { cat: 'nasse', lat: 43.61, lng: 3.88 });
  assert.equal((await req('POST', '/api/admin/publish/' + day(), {})).s, 200);
  const d = await state();
  const pub = d.posts.find(x => x.kind === 'pub');
  assert.equal(pub.status, 'review'); assert.equal(d.review, 1);
  assert.match(pub.text, /^📊 Bilan du .+\n1 signalement dans 1 ville\./);
  assert.equal(pub.link, 'https://cortege.example/manif/' + day());
  await req('POST', '/api/admin/publish/' + day(), {});
  assert.equal((await state()).posts.filter(x => x.kind === 'pub').length, 1, 'bilan republié : pas de second message');
  calls = [];
  assert.equal((await req('POST', `/api/admin/social/${pub.id}/send`, { text: 'Bilan corrigé à la main' })).s, 200);
  await until(async () => (await state()).posts.find(x => x.id === pub.id && x.status === 'done'));
  assert.ok(calls.find(c => c.p === '/api/v1/statuses').body.status.startsWith('Bilan corrigé à la main'));
  await req('POST', '/api/admin/social/config', { mode: 'auto', kinds: { pub: false } });
});

test('réseaux : arrêtés importés regroupés en un seul message', async () => {
  calls = [];
  const blk = ['34', '30'].map(dep => ({ departement: dep, debut: day(1) + ' 06:00', fin: day(1) + ' 23:00', source: 'https://x.gouv.fr/a', mesures: [{ type: 'manif', texte: 'Manifestation interdite.' }] }));
  const imp = await req('POST', '/api/admin/orders/import', { text: JSON.stringify(blk) });
  assert.deepEqual(imp.j.results.map(r => r.ok), [true, true]);
  const o = await until(async () => (await state()).posts.find(x => x.kind === 'ord' && x.status === 'done'));
  assert.ok(o, 'message des arrêtés publié');
  assert.match(o.text, /^⛔ 2 nouveaux arrêtés : (Hérault, Gard|Gard, Hérault)\./);
  assert.equal((await state()).posts.filter(x => x.kind === 'ord').length, 1);
});

test('réseaux : réseau coupé dans les réglages, rien envoyé dessus', async () => {
  await req('POST', '/api/admin/social/config', { off: { masto: true } });
  calls = [];
  const p = await req('POST', '/api/admin/social/post', { text: 'Seulement Bluesky' });
  await until(async () => (await state()).posts.find(x => x.id === p.j.id && x.status === 'done'));
  assert.ok(!calls.some(c => c.p === '/api/v1/statuses'));
  assert.deepEqual(Object.keys((await state()).posts.find(x => x.id === p.j.id).nets), ['bsky']);
  await req('POST', '/api/admin/social/config', { off: { masto: false, bsky: true } });
  assert.equal((await req('POST', '/api/admin/social/config', { off: { masto: true } })).s, 200);
  assert.equal((await req('POST', '/api/admin/social/post', { text: 'Aucun réseau' })).s, 409);
});
