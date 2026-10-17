'use strict';
// Tests du serveur : lancés par GitHub Actions à chaque modification (node --test).
// Chaque test démarre un vrai serveur sur un port libre, avec des dossiers temporaires.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ADMIN = 'admin-key-for-tests-123';
const ROOT = path.join(__dirname, '..');
let srv, B, DIR, db, n = 0;

before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', IMPORT_17OCT: '0' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  await new Promise(r => setTimeout(r, 400));
  db = new DatabaseSync(DIR + '/d/cortege.db'); db.exec('PRAGMA busy_timeout=5000');
});
after(() => { try { db.close(); } catch {} srv.kill(); fs.rmSync(DIR, { recursive: true, force: true }); });

// Un « téléphone » = un identifiant + un réseau
const phone = (net = '81.0.' + (n % 250) + '.' + (++n % 250)) => ({ dev: ('dev' + n + 'x').padEnd(24, 'x'), ip: net });
const post = (p, body, ph = phone(), extra = {}) => fetch(B + p, { method: 'POST',
  headers: { 'content-type': 'application/json', 'x-device': ph.dev, 'x-forwarded-for': ph.ip, ...extra }, body: JSON.stringify(body) })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const admin = (p, body) => post(p, body, phone(), { 'x-admin-key': ADMIN });
const row = id => db.prepare('SELECT * FROM reports WHERE id=?').get(id);
// Les téléphones déjà vus deviennent « anciens » (plus de 10 min)
const ageAll = () => db.prepare('UPDATE devices SET first = first - 3600000').run();
let spot = 0; const place = () => ({ lat: 43.5 + (++spot) * 0.01, lng: 3.8 });

test('sécurité : en-têtes et requêtes venues d’un autre site', async () => {
  const r = await fetch(B + '/');
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const csrf = await fetch(B + '/api/reports', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.ok(csrf.status >= 400, 'POST non JSON refusé');
});

test('fusion : deux signalements proches du même type = un seul point confirmé', async () => {
  const p = place();
  const a = await post('/api/reports', { cat: 'police', ...p });
  const b = await post('/api/reports', { cat: 'police', lat: p.lat + 0.0002, lng: p.lng });
  assert.equal(a.s, 201); assert.equal(b.j.merged, true); assert.equal(b.j.id, a.j.id); assert.equal(b.j.up, 1);
});

test('« Plus là » : contesté (pas effacé), puis rétabli par une confirmation', async () => {
  const p = place();
  const r = (await post('/api/reports', { cat: 'police', ...p })).j;
  const v1 = phone(), v2 = phone();
  await post('/api/reports', { cat: 'medic', ...place() }, v1); await post('/api/reports', { cat: 'medic', ...place() }, v2); ageAll();
  await post(`/api/reports/${r.id}/vote`, { v: -1, here: true }, v1);
  const c = await post(`/api/reports/${r.id}/vote`, { v: -1, here: true }, v2);
  assert.equal(c.j.c, 1, 'contesté'); assert.ok(row(r.id), 'toujours présent');
  assert.ok(c.j.exp <= Date.now() + 10 * 60e3 + 2000, 'plus que ~10 min');
  const y = await post(`/api/reports/${r.id}/vote`, { v: 1 });
  assert.ok(!y.j.c, 'plus contesté');
});

test('« Plus là » : identifiants neufs ou un seul réseau ne suffisent pas', async () => {
  const r = (await post('/api/reports', { cat: 'police', ...place() })).j;
  await post(`/api/reports/${r.id}/vote`, { v: -1, here: true }); await post(`/api/reports/${r.id}/vote`, { v: -1, here: true });
  assert.ok(!row(r.id).ct, 'neufs : pas contesté');
  const r2 = (await post('/api/reports', { cat: 'police', ...place() })).j;
  const same = [phone('90.0.0.1'), phone('90.0.0.1'), phone('90.0.0.1')];
  for (const ph of same) await post('/api/reports', { cat: 'eau', ...place() }, ph);
  ageAll();
  for (const ph of same) await post(`/api/reports/${r2.id}/vote`, { v: -1, here: true }, ph);
  assert.ok(!row(r2.id).ct, 'un seul réseau : pas contesté');
});

test('zones calmes : un danger les suspend sans les effacer, et bloque la création', async () => {
  const p = place();
  const calm = (await post('/api/reports', { cat: 'calme', ...p })).j;
  await post('/api/reports', { cat: 'charge', lat: p.lat + 0.0005, lng: p.lng });
  assert.ok(row(calm.id), 'zone calme gardée');
  const again = await post('/api/reports', { cat: 'calme', lat: p.lat + 0.0003, lng: p.lng });
  assert.equal(again.s, 409);
});

test('faux dangers en série près de zones calmes : marqués non fiables', async () => {
  const troll = phone();
  const calms = [];
  for (let i = 0; i < 3; i++) calms.push({ ...place() });
  for (const c of calms) await post('/api/reports', { cat: 'calme', ...c });
  const out = [];
  for (const c of calms) out.push((await post('/api/reports', { cat: 'charge', lat: c.lat + 0.0005, lng: c.lng }, troll)).j);
  assert.ok(!out[0].nf && !out[1].nf, 'les deux premiers passent');
  assert.equal(out[2].nf, 1, 'le troisième est non fiable');
});

test('fiabilité : un téléphone souvent confirmé publie des points « fiables »', async () => {
  const good = phone();
  for (let i = 0; i < 2; i++) {
    const r = (await post('/api/reports', { cat: 'legal', ...place() }, good)).j;
    await post(`/api/reports/${r.id}/vote`, { v: 1 });
  }
  const next = (await post('/api/reports', { cat: 'presse', ...place() }, good)).j;
  assert.equal(next.f, 1);
});

test('mode manif renforcé : un téléphone tout neuf publie des points non fiables', async () => {
  assert.equal((await admin('/api/admin/strict', { minutes: 30 })).s, 200);
  const r = (await post('/api/reports', { cat: 'charge', ...place() })).j;
  assert.equal(r.nf, 1);
  await admin('/api/admin/strict', { minutes: 0 });
  const r2 = (await post('/api/reports', { cat: 'charge', ...place() })).j;
  assert.ok(!r2.nf);
});

test('tableau des abus : accessible à l’admin seulement', async () => {
  assert.equal((await fetch(B + '/api/admin/abuse')).status, 403);
  const r = await fetch(B + '/api/admin/abuse', { headers: { 'x-admin-key': ADMIN } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.kinds['point contesté'] >= 1 && d.kinds['série de dangers près des zones calmes'] >= 1);
});

test('invitation d’orga : usage unique, et une nouvelle invitation coupe l’ancien accès', async () => {
  const o = (await admin('/api/admin/orgas', { label: 'Legal Team Test' })).j;
  assert.ok(o.invite && !o.key, 'pas de clé envoyée à l’admin');
  const red = await post('/api/invite', { token: o.invite });
  assert.equal(red.s, 200);
  assert.equal((await post('/api/invite', { token: o.invite })).s, 404, 'déjà utilisée');
  const me = await fetch(B + '/api/orga/me', { headers: { 'x-orga-key': red.j.key } });
  assert.equal(me.status, 200);
  await admin(`/api/admin/orgas/${o.id}/invite`, {});
  assert.equal((await fetch(B + '/api/orga/me', { headers: { 'x-orga-key': red.j.key } })).status, 403);
});

test('notifications : choix enregistrés, alerte « danger près de toi » limitée à une toutes les 3 min', async () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-' + Date.now(), keys: { p256dh: require('node:crypto').createECDH('prime256v1').generateKeys().toString('base64url'), auth: require('node:crypto').randomBytes(16).toString('base64url') } };
  const p = place();
  const s1 = await post('/api/push/subscribe', { sub, lat: p.lat, lng: p.lng, urgent: false, near: true });
  assert.equal(s1.s, 200);
  const x = db.prepare('SELECT urg, near, last FROM push').get();
  assert.equal(x.urg, 0); assert.equal(x.near, 1); assert.equal(x.last, null);
  const ph = phone(); await post('/api/reports', { cat: 'eau', ...place() }, ph); ageAll();
  await post('/api/reports', { cat: 'nasse', lat: p.lat + 0.01, lng: p.lng }, ph);
  await new Promise(r => setTimeout(r, 300));
  // L'envoi a été tenté : l'abonnement est marqué (ou supprimé si le service de test l'a refusé)
  const after = db.prepare('SELECT last FROM push').get();
  assert.ok(!after || after.last > 0, 'envoi tenté');
});

test('effacement d’urgence : confirmation obligatoire, puis plus aucune trace', async () => {
  assert.equal((await admin('/api/admin/wipe', {})).s, 400);
  const before = fs.readFileSync(DIR + '/d/secret', 'utf8');
  const w = await admin('/api/admin/wipe', { confirm: 'EFFACER' });
  assert.equal(w.s, 200); assert.equal(w.j.rotated, true);
  for (const t of ['reports', 'devices', 'abuse', 'trash', 'orga_log', 'push'])
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t + ' vide');
  assert.notEqual(fs.readFileSync(DIR + '/d/secret', 'utf8'), before, 'nouvelle clé');
});
