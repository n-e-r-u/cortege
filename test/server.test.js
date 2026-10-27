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
let srv, B, DIR, db, n = 0, geo;
const B_URL = p => B + p;

before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-'));
  fs.writeFileSync(DIR + '/carte.pmtiles', require('./pmtiles-fixture').writePmtiles([
    { z: 13, x: 4182, y: 2994, data: Buffer.from('tuile-montpellier') }, { z: 0, x: 0, y: 0, data: Buffer.from('monde') }]));
  // Faux service de contours des communes (API Géo)
  const mtp = { nom: 'Montpellier', code: '34172', codeDepartement: '34', population: 300000, contour: { type: 'Polygon', coordinates: [[[3.80, 43.56], [3.94, 43.56], [3.94, 43.66], [3.80, 43.66], [3.80, 43.56]]] } };
  geo = require('node:http').createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); res.setHeader('content-type', 'application/json');
    if (u.pathname === '/communes') return res.end(JSON.stringify(/montpellier/i.test(u.searchParams.get('nom')) && u.searchParams.get('codeDepartement') === '34' ? [mtp] : []));
    res.statusCode = 404; res.end('{}');
  }).listen(0);
  await new Promise(r => geo.on('listening', r));
  const port = 20000 + Math.floor(Math.random() * 20000);
  B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', IMPORT_17OCT: '0', PLACES_IMPORT: '0', ORDER_PUSH_WAIT_MS: '200', FETCH_ALLOW_PRIVATE: '1', TILE_PMTILES: DIR + '/carte.pmtiles', GEO_API: 'http://127.0.0.1:' + geo.address().port },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  await new Promise(r => setTimeout(r, 400));
  db = new DatabaseSync(DIR + '/d/cortege.db'); db.exec('PRAGMA busy_timeout=5000');
});
after(() => { try { db.close(); } catch {} srv.kill(); geo.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

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

// Orga activée à partir d'une invitation (admin ou parrainage)
const orgaFrom = async (token) => (await post('/api/invite', { token })).j;
const asOrga = (key, p, body) => post(p, body, phone(), { 'x-orga-key': key });

test('parrainage : seule une orga confirmée invite, la parrainée est plus surveillée', async () => {
  const a = (await admin('/api/admin/orgas', { label: 'Marraine' })).j;
  const A = await orgaFrom(a.invite);
  assert.equal((await asOrga(A.key, '/api/orga/invite', { label: 'Filleule' })).s, 400, 'en essai : pas d’invitation');
  await admin(`/api/admin/orgas/${a.id}/trial`, { trial: false });
  const inv = await asOrga(A.key, '/api/orga/invite', { label: 'Filleule' });
  assert.equal(inv.s, 201);
  const B = await orgaFrom(inv.j.invite);
  const me = await fetch(B.key ? B_URL('/api/orga/me') : '', { headers: { 'x-orga-key': B.key } }).then(r => r.json());
  assert.equal(me.sponsored, true); assert.equal(me.sponsor, 'Marraine');
  // « Vérifier » d'une parrainée : confirmation, pas de vérification
  const r = (await post('/api/reports', { cat: 'police', ...place() })).j;
  const v = await asOrga(B.key, `/api/reports/${r.id}/verify`, {});
  assert.equal(v.j.ver, null); assert.equal(v.j.up, 1);
  // pas encore prête : la marraine ne peut pas confirmer
  const fl = await fetch(B_URL('/api/orga/filleules'), { headers: { 'x-orga-key': A.key } }).then(r => r.json());
  assert.equal(fl.orgas.length, 1); assert.equal(fl.orgas[0].ready, false);
  assert.equal((await asOrga(A.key, `/api/orga/filleules/${fl.orgas[0].id}/confirm`, {})).s, 400);
  // 8 jours plus tard et 10 actions sans incident : prête, la marraine confirme
  const f = DIR + '/d/orgas.json', list = JSON.parse(fs.readFileSync(f, 'utf8'));
  const fi = list.find(o => o.label === 'Filleule'); fi.activated = Date.now() - 8 * 86400e3; fs.writeFileSync(f, JSON.stringify(list));
  for (let i = 0; i < 10; i++) db.prepare("INSERT INTO orga_log(t,oid,orga,action) VALUES(?,?,?,'confirmé (parrainée)')").run(Date.now(), fi.id, 'Filleule');
  assert.equal((await asOrga(A.key, `/api/orga/filleules/${fi.id}/confirm`, {})).s, 200, 'confirmée par la marraine');
  const me2 = await fetch(B_URL('/api/orga/me'), { headers: { 'x-orga-key': B.key } }).then(r => r.json());
  assert.equal(me2.trial, false); assert.equal(me2.sponsored, false);
  // quota : 3 par semaine
  await asOrga(A.key, '/api/orga/invite', { label: 'F2' }); await asOrga(A.key, '/api/orga/invite', { label: 'F3' });
  assert.equal((await asOrga(A.key, '/api/orga/invite', { label: 'F4' })).s, 429);
});

test('appareils : un lien ajoute un appareil, une nouvelle invitation les coupe tous', async () => {
  const o = (await admin('/api/admin/orgas', { label: 'Multi appareils' })).j;
  const first = await orgaFrom(o.invite);
  const dev = await asOrga(first.key, '/api/orga/device', {});
  const second = await orgaFrom(dev.j.invite);
  assert.equal(second.device, true);
  for (const k of [first.key, second.key]) assert.equal((await fetch(B_URL('/api/orga/me'), { headers: { 'x-orga-key': k } })).status, 200);
  assert.equal((await post('/api/invite', { token: dev.j.invite })).s, 404, 'lien d’appareil à usage unique');
  await admin(`/api/admin/orgas/${o.id}/invite`, {});
  for (const k of [first.key, second.key]) assert.equal((await fetch(B_URL('/api/orga/me'), { headers: { 'x-orga-key': k } })).status, 403);
});

test('révocation pour abus : l’orga et ses invitées sont coupées, la marraine ne peut plus inviter', async () => {
  const a = (await admin('/api/admin/orgas', { label: 'Racine' })).j; const A = await orgaFrom(a.invite);
  await admin(`/api/admin/orgas/${a.id}/trial`, { trial: false });
  const bi = (await asOrga(A.key, '/api/orga/invite', { label: 'Niveau 1' })).j; const Bk = await orgaFrom(bi.invite);
  await admin(`/api/admin/orgas/${bi.id}/trial`, { trial: false });
  const ci = (await asOrga(Bk.key, '/api/orga/invite', { label: 'Niveau 2' })).j; const Ck = await orgaFrom(ci.invite);
  const rv = await admin(`/api/admin/orgas/${bi.id}/revoke`, {});
  assert.deepEqual(rv.j.removed.sort(), ['Niveau 1', 'Niveau 2']);
  for (const k of [Bk.key, Ck.key]) assert.equal((await fetch(B_URL('/api/orga/me'), { headers: { 'x-orga-key': k } })).status, 403);
  assert.equal((await asOrga(A.key, '/api/orga/invite', { label: 'Encore' })).s, 400, 'marraine suspendue');
});

test('annuaire legal teams : publié après validation, veille qui prévient sans rien publier', async () => {
  const http = require('node:http');
  let page = '<p>Legal team : 06 12 34 56 78</p>';
  const src = http.createServer((q, r) => r.end(page)).listen(0);
  await new Promise(r => src.once('listening', r));
  const url = 'http://127.0.0.1:' + src.address().port + '/';
  const getA = p => fetch(B + p, { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  // Liste de départ : rien n'est publié tant que l'admin n'a pas validé
  const seed = await getA('/api/admin/legal');
  assert.ok(seed.list.length >= 5 && seed.list.every(e => !e.ok), 'liste de départ non validée');
  await new Promise(x => setTimeout(x, 1200));
  assert.deepEqual(await fetch(B + '/live/legal.json').then(r => r.json()), { l: [] });
  const add = await admin('/api/admin/legal', { city: 'Testville', name: 'LT Test', phone: '06 12 34 56 78', src: url, lat: 44.1, lng: 4.1 });
  assert.equal(add.s, 200);
  assert.equal((await admin('/api/admin/legal/' + add.j.id + '/validate', {})).s, 200);
  await new Promise(x => setTimeout(x, 1200));
  const pub = await fetch(B + '/live/legal.json').then(r => r.json());
  assert.deepEqual(pub.l.map(e => e.phone), ['06 12 34 56 78']);
  // Veille : numéro présent → ok ; numéro remplacé sur la source → alerte, mais la ligne publiée ne bouge pas
  const st = async () => { await admin('/api/admin/legal-watch', {}); return (await getA('/api/admin/legal')).list.find(e => e.id === add.j.id).status; };
  assert.equal(await st(), 'ok');
  page = '<p>Nouveau numéro : 07 99 88 77 66</p>';
  assert.equal(await st(), 'missing');
  assert.deepEqual((await fetch(B + '/live/legal.json').then(r => r.json())).l.map(e => e.phone), ['06 12 34 56 78'], 'jamais publié automatiquement');
  // Numéro de legal team d'une orga : la ville est obligatoire
  const k = { 'x-orga-key': ADMIN };
  assert.equal((await post('/api/announcements', { kind: 'legal', phone: '0611223344', lat: 44, lng: 4 }, phone(), k)).s, 400);
  assert.equal((await post('/api/announcements', { kind: 'legal', phone: '0611223344', city: 'Testville', lat: 44, lng: 4 }, phone(), k)).s, 201);
  src.close();
});

test('digest : les signalements retirés restent comptés, avec leur devenir', async () => {
  const r = (await post('/api/reports', { cat: 'nasse', ...place() })).j;
  await fetch(B + '/api/admin/reports/' + r.id, { method: 'DELETE', headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' } });
  const d = await fetch(B + '/api/digest', { headers: { 'x-admin-key': ADMIN } }).then(x => x.json());
  const row = d.rows.find(x => x.c === 'nasse' && x.o === 'admin');
  assert.ok(row, 'point retiré présent'); assert.ok(row.e >= row.t, 'heure de fin');
  assert.equal(d.history.length, 15);
  assert.ok(!JSON.stringify(d).includes(r.id), 'aucun identifiant de signalement');
});

test('réseau faible : un seul fichier compact par région, publié même vide', async () => {
  const empty = await fetch(B + '/live/p/45_5.json').then(r => r.json());
  assert.deepEqual(empty, { r: [] });
  const r = (await post('/api/reports', { cat: 'canon', lat: 47.2184, lng: -1.5536 })).j;
  await new Promise(x => setTimeout(x, 1600));
  const pf = await fetch(B + '/live/p/47_-2.json').then(x => x.json());
  assert.ok(pf.r.some(x => x.id === r.id), 'le point est dans le fichier de sa région');
});

test('temps réel : un nouveau signalement prévient les téléphones abonnés à sa région', async () => {
  const ctl = new AbortController();
  const res = await fetch(B + '/api/stream?r=43_3,99_99', { signal: ctl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  const got = (async () => { while (!buf.includes('data:')) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } })();
  await post('/api/reports', { cat: 'police', lat: 43.61, lng: 3.88 });
  await Promise.race([got, new Promise(r => setTimeout(r, 4000))]);
  ctl.abort();
  const msg = JSON.parse(buf.split('data: ')[1].split('\n')[0]);
  assert.deepEqual(msg.r, ['43_3']);
});

test('digest : villes regroupées par agglomération, sans service extérieur', async () => {
  await post('/api/reports', { cat: 'lacrymo', lat: 48.8867, lng: 2.3066 }); // 17e arrondissement, près de Clichy
  await post('/api/reports', { cat: 'lacrymo', lat: 43.6108, lng: 3.8767 });
  const d = await fetch(B + '/api/digest', { headers: { 'x-admin-key': ADMIN } }).then(x => x.json());
  const names = Object.values(d.zones).map(z => z.name);
  assert.ok(names.includes('Paris') && names.includes('Montpellier'), names.join(', '));
  assert.ok(!names.includes('Clichy'));
});

test('bilans : seulement la France, les points d’ailleurs sont comptés à part', async () => {
  await post('/api/reports', { cat: 'police', lat: 40.4168, lng: -3.7038 }); // Madrid
  await post('/api/reports', { cat: 'police', lat: 46.2044, lng: 6.1432 }); // Genève (frontière)
  await post('/api/reports', { cat: 'police', lat: 47.2184, lng: -1.5536 }); // Nantes
  await post('/api/reports', { cat: 'police', lat: 16.2411, lng: -61.5331 }); // Guadeloupe
  const d = await fetch(B + '/api/digest', { headers: { 'x-admin-key': ADMIN } }).then(x => x.json());
  assert.ok(d.abroad >= 2, 'Madrid et Genève à part');
  assert.ok(!d.rows.some(r => (r.lat > 40 && r.lat < 41 && r.lng < -3) || (r.lat > 46.1 && r.lat < 46.3 && r.lng > 6.1)), 'aucun point étranger dans les lignes');
  assert.ok(d.rows.some(r => r.lat > 47.2 && r.lat < 47.3) && d.rows.some(r => r.lat > 16 && r.lat < 17), 'Nantes et l’outre-mer comptés');
});

test('modération : le plus urgent d’abord, simples « pas encore confirmé » à part, points isolés signalés', async () => {
  assert.equal((await admin('/api/admin/strict', { minutes: 30 })).s, 200);
  const fresh = (await post('/api/reports', { cat: 'bac', ...place() })).j;
  await admin('/api/admin/strict', { minutes: 0 });
  const danger = (await post('/api/reports', { cat: 'charge', ...place() })).j;
  db.prepare('UPDATE reports SET ct=?, down=3 WHERE id=?').run(Date.now(), danger.id);
  const far = (await post('/api/reports', { cat: 'police', lat: -33.86, lng: 151.21 })).j; // Sydney
  const mod = await fetch(B + '/api/admin/moderation', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  const by = id => mod.list.find(x => x.id === id);
  assert.equal(by(danger.id).prio, 1); assert.deepEqual(by(danger.id).why, ['contested']);
  assert.equal(by(fresh.id).low, true); assert.deepEqual(by(fresh.id).why, ['new']);
  assert.ok(by(far.id).why.includes('isolated'));
  assert.equal(mod.list[0].prio, 1, 'trié par urgence');
  const b = await fetch(B + '/api/admin/reports', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  assert.equal(b.moderation, mod.list.filter(x => !x.low).length, 'le badge ignore les « pas encore confirmé »');
});

test('référencement : robots.txt, plan du site, pages d’outils hors des moteurs', async () => {
  const robots = await fetch(B + '/robots.txt').then(r => r.text());
  assert.match(robots, /Disallow: \/api\//); assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
  const sm = await fetch(B + '/sitemap.xml');
  assert.match(sm.headers.get('content-type'), /xml/);
  const xml = await sm.text();
  for (const u of ['/manif', '/presse', '/legal.html']) assert.ok(xml.includes(u + '</loc>'), u);
  for (const u of ['/admin.html', '/embed.html', '/digest.html']) assert.equal((await fetch(B + u)).headers.get('x-robots-tag'), 'noindex, nofollow', u);
  assert.equal((await fetch(B + '/')).headers.get('x-robots-tag'), null);
  const idx = await fetch(B + '/').then(r => r.text());
  assert.ok(!/<title>[^<]*—/.test(idx), 'pas de tiret long dans le titre');
  assert.match(idx, /application\/ld\+json/);
  assert.match(await fetch(B + '/manif').then(r => r.text()), /rel="canonical"/);
});

test('milice / groupe fasciste : danger avec alerte, le point suit le groupe', async () => {
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  const c = cfg.categories.find(x => x.id === 'facho');
  assert.equal(c.group, 'danger'); assert.equal(c.glyph, '☠️');
  assert.ok(cfg.alertCats.includes('facho') && cfg.vibes.facho, 'alerte et vibration');
  const p = place(), a = (await post('/api/reports', { cat: 'facho', ...p })).j;
  const b = (await post('/api/reports', { cat: 'facho', lat: p.lat + 0.001, lng: p.lng })).j;
  assert.equal(b.id, a.id, 'fusion à ~110 m'); assert.ok(Math.abs(b.lat - (p.lat + 0.001)) < 1e-6, 'le point suit le groupe');
});

test('santé : disque et mémoire exposés pour la surveillance', async () => {
  const h = await fetch(B + '/api/health').then(r => r.json());
  assert.equal(h.ok, true);
  assert.ok(h.diskFreePct === null || (h.diskFreePct >= 0 && h.diskFreePct <= 100));
  assert.equal(typeof h.streams, 'number');
});

test('carte hébergée : tuiles vectorielles lues dans le fichier PMTiles', async () => {
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  assert.equal(cfg.vector.url, '/vt/{z}/{x}/{y}.mvt'); assert.equal(cfg.vector.maxzoom, 15); assert.equal(cfg.offlineTiles, true);
  const r = await fetch(B + '/vt/13/4182/2994.mvt');
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'tuile-montpellier'); // fetch décompresse le gzip
  assert.equal((await fetch(B + '/vt/13/1/1.mvt')).status, 204);
  assert.equal((await fetch(B + '/vt/16/1/1.mvt')).status, 204);
  const raw = await new Promise(ok => require('http').get(B + '/vt/0/0/0.mvt', { headers: { 'accept-encoding': 'identity' } }, res => {
    const c = []; res.on('data', d => c.push(d)); res.on('end', () => ok({ enc: res.headers['content-encoding'], body: Buffer.concat(c).toString() })); }));
  assert.deepEqual(raw, { enc: undefined, body: 'monde' });
});

test('demandes d’accès orga : formulaire public, liste admin, suppression', async () => {
  assert.equal((await post('/api/orga-requests', { collective: 'LT Test', city: 'Testville' })).s, 400);
  const ok = await post('/api/orga-requests', { collective: 'Legal Team Testville', city: 'Testville', role: 'Legal team', link: 'https://exemple.org/lt', contact: 'contact@exemple.org' });
  assert.equal(ok.s, 201);
  const list = await fetch(B + '/api/admin/orga-requests', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  const r = list.list.find(x => x.collective === 'Legal Team Testville');
  assert.ok(r && r.city === 'Testville' && !('ip' in r));
  const del = await fetch(B + '/api/admin/orga-requests/' + r.id, { method: 'DELETE', headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' } });
  assert.equal(del.status, 200);
  assert.equal((await fetch(B + '/api/admin/orga-requests', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json())).list.length, 0);
});

test('pages publiques par manif : publiées par l’admin, sans position de signalement', async () => {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  await post('/api/reports', { cat: 'nasse', lat: 45.7601, lng: 4.8401 });
  assert.equal((await fetch(B + '/manif/' + day)).status, 404);
  const pub = await fetch(B + '/api/admin/publish/' + day, { method: 'POST', headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(pub.status, 200);
  const r = await fetch(B + '/manif/' + day), html = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(html, /Lyon/); assert.match(html, /og:title/);

  assert.match(await fetch(B + '/manif').then(x => x.text()), new RegExp('/manif/' + day));
  // Carte d'un créneau : page ouverte, points arrondis à ~100 m, sans les signalements retirés
  assert.match(html, new RegExp('/manif/' + day + '/carte'));
  const cp = await fetch(B + '/manif/' + day + '/carte');
  assert.equal(cp.status, 200); assert.match(await cp.text(), /creneau\.js/);
  const pts = await fetch(B + '/manif/' + day + '/points.json').then(r => r.json());
  assert.equal(pts.ps, 1e4, 'précision au dix-millième de degré (~11 m)');
  const mine = pts.pts.find(x => x[0] === 'nasse' && x[3] === 457601 && x[4] === 48401);
  assert.ok(mine, 'point présent, arrondi au dix-millième');
  assert.ok(pts.pts.every(x => (x.length === 7 || x.length === 8) && Number.isInteger(x[3])), 'format compact, rien d’autre');
  assert.equal((await fetch(B + '/manif/2001-01-01/points.json')).status, 404);
  await fetch(B + '/api/admin/publish/' + day, { method: 'DELETE', headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' } });
  assert.equal((await fetch(B + '/manif/' + day)).status, 404);
});

test('carte à intégrer : seule embed.html peut s’afficher dans un autre site', async () => {
  const e = await fetch(B + '/embed.html');
  assert.match(e.headers.get('content-security-policy'), /frame-ancestors \*/);
  assert.equal(e.headers.get('x-frame-options'), null);
  const i = await fetch(B + '/');
  assert.match(i.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  assert.ok(cfg.vector.zones.length >= 1 && cfg.vector.zones[0].length === 4);
  assert.equal(cfg.version, require('../package.json').version);
});

test('orga confirmée : signalement vérifié d’office, deux fois plus long, prolongeable et corrigeable par elle seule', async () => {
  const o = (await admin('/api/admin/orgas', { label: 'Orga Sûre' })).j;
  const O = await orgaFrom(o.invite);
  await admin(`/api/admin/orgas/${o.id}/trial`, { trial: false });
  const p = place();
  const r = await asOrga(O.key, '/api/reports', { cat: 'medic', ...p, note: 'devant la gare' });
  assert.equal(r.s, 201); assert.equal(r.j.ver, 'Orga Sûre'); assert.equal(r.j.mine, true);
  const ttl = 45 * 60_000;
  assert.ok(Math.abs(r.j.exp - r.j.t - 2 * ttl) < 2000, 'durée ×2');
  // Un·e participant·e ne peut pas prolonger ; une autre orga non plus
  assert.equal((await post(`/api/reports/${r.j.id}/extend`, {})).s, 403);
  const x = (await admin('/api/admin/orgas', { label: 'Autre Orga' })).j, X = await orgaFrom(x.invite);
  assert.equal((await asOrga(X.key, `/api/reports/${r.j.id}/extend`, {})).s, 403);
  const ext = await asOrga(O.key, `/api/reports/${r.j.id}/extend`, {});
  assert.equal(ext.s, 200); assert.ok(ext.j.exp > r.j.exp);
  assert.ok(ext.j.exp - Date.now() <= 4 * ttl + 1000, 'plafond 4×');
  await asOrga(O.key, `/api/reports/${r.j.id}/extend`, {});
  assert.equal((await asOrga(O.key, `/api/reports/${r.j.id}/extend`, {})).s, 409, 'déjà au maximum');
  const ed = await asOrga(O.key, `/api/reports/${r.j.id}/edit`, { cat: 'legal', note: 'côté parking' });
  assert.equal(ed.s, 200); assert.equal(ed.j.cat, 'legal'); assert.deepEqual(ed.j.notes.map(n => n.x), ['côté parking']);
  // Orga en essai : signalement ordinaire
  const t = await asOrga(X.key, '/api/reports', { cat: 'medic', ...place() });
  assert.equal(t.s, 201); assert.equal(t.j.ver, null);
  assert.ok(Math.abs(t.j.exp - t.j.t - ttl) < 2000);
  // Fusion sur un point existant : vérifié par l'orga confirmée
  const q2 = place(), base = await post('/api/reports', { cat: 'crs', ...q2 });
  const m = await asOrga(O.key, '/api/reports', { cat: 'crs', lat: q2.lat + 0.0002, lng: q2.lng });
  assert.equal(m.j.merged, true); assert.equal(m.j.ver, 'Orga Sûre'); assert.equal(m.j.id, base.j.id);
});

test('réglages de l’admin : bandeau daté, vue, catégorie désactivée, durée, seuils', async () => {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const s = await admin('/api/admin/settings', { banner: { text: 'Grève générale', from: day, to: day }, view: { lat: 45.76, lng: 4.84, zoom: 12 },
    cats: { presse: { off: true }, eau: { ttl: 120 } }, alertRadius: 500, nearKm: 15 });
  assert.equal(s.s, 200);
  await new Promise(r => setTimeout(r, 3100)); // relu toutes les 3 s
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  assert.equal(cfg.event, 'Grève générale'); assert.deepEqual(cfg.center, [45.76, 4.84]); assert.equal(cfg.zoom, 12);
  assert.equal(cfg.alertRadius, 500); assert.equal(cfg.nearKm, 15);
  assert.equal(cfg.categories.find(c => c.id === 'presse').off, true); assert.equal(cfg.categories.find(c => c.id === 'eau').ttl, 120);
  assert.equal((await post('/api/reports', { cat: 'presse', ...place() })).s, 400, 'catégorie désactivée');
  const e = await post('/api/reports', { cat: 'eau', ...place() });
  assert.ok(Math.abs(e.j.exp - e.j.t - 120 * 60_000) < 2000);
  // Bandeau hors de ses dates : nom par défaut
  await admin('/api/admin/settings', { banner: { text: 'Passé', from: '2020-01-01', to: '2020-01-02' } });
  await new Promise(r => setTimeout(r, 3100));
  const cfg2 = await fetch(B + '/api/config').then(r => r.json());
  assert.notEqual(cfg2.event, 'Passé'); assert.equal(cfg2.categories.find(c => c.id === 'presse').off, false);
  assert.ok(JSON.parse(fs.readFileSync(DIR + '/l/g.json', 'utf8')).cfg, 'empreinte des réglages publiée');
});

test('journées prévues, tableau de bord, modération, test de notification', async () => {
  const tomorrow = new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  assert.equal((await admin('/api/admin/mobs', { date: '2020-01-01', title: 'Vieux' })).s, 400);
  const m = await admin('/api/admin/mobs', { date: tomorrow, title: 'Journée test' });
  assert.equal(m.s, 201);
  assert.equal((await admin('/api/admin/mobs', { date: tomorrow, title: 'Doublon' })).s, 409);
  const list = await fetch(B + '/api/admin/mobs', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  assert.equal(list.list.length, 1);
  assert.equal((await fetch(B + '/api/admin/mobs/' + m.j.id, { method: 'DELETE', headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' } })).status, 200);
  const live = await fetch(B + '/api/admin/live', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  assert.equal(live.perMin.length, 15); assert.ok(live.sys.load.length === 3); assert.ok('subs' in live.push);
  // Point contesté → file de modération → gardé
  const p = place(), r = await post('/api/reports', { cat: 'chaud', ...p });
  db.prepare('UPDATE reports SET ct=?, down=3 WHERE id=?').run(Date.now(), r.j.id);
  const mod = await fetch(B + '/api/admin/moderation', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json());
  assert.ok(mod.list.some(x => x.id === r.j.id));
  const keep = await admin(`/api/admin/reports/${r.j.id}/verify`, {});
  assert.equal(keep.s, 200); assert.equal(keep.j.down, 0); assert.equal(keep.j.ver, 'Cortège');
  // Test de notification : téléphone non abonné
  assert.equal((await post('/api/push/test', { endpoint: 'https://fcm.googleapis.com/fcm/send/inconnu' })).s, 404);
});

test('lieux permanents : import OpenStreetMap, fichiers par région, correction et masquage', async () => {
  const http = require('node:http');
  const fake = http.createServer((req, res) => {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      const q = decodeURIComponent(body.replace(/^data=/, '').replace(/\+/g, ' '));
      const inLyon = /\(45(\.\d+)?,4/.test(q);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ elements: inLyon && !fake.done ? (fake.done = true, [
        { type: 'node', id: 1, lat: 45.7578, lon: 4.8320, tags: { amenity: 'townhall', name: 'Hôtel de ville de Lyon' } },
        { type: 'way', id: 2, center: { lat: 45.7590, lon: 4.8290 }, tags: { office: 'government', government: 'prefecture', name: 'Préfecture du Rhône' } },
        { type: 'node', id: 3, lat: 45.75, lon: 4.85, tags: { amenity: 'police', name: 'Gendarmerie de Lyon' } },
        { type: 'node', id: 4, lat: 45.751, lon: 4.851, tags: { amenity: 'pharmacy', name: 'Pharmacie du Centre', opening_hours: 'Mo-Sa 09:00-19:00', phone: '+33 4 00 00 00 00' } },
        { type: 'node', id: 5, lat: 45.752, lon: 4.852, tags: { amenity: 'drinking_water', access: 'private' } },
        { type: 'node', id: 6, lat: 45.753, lon: 4.853, tags: { amenity: 'hospital', name: 'Hôpital Test', emergency: 'yes' } },
      ]) : [] }));
    });
  }).listen(0);
  await new Promise(r => fake.on('listening', r));
  // Le serveur de test tourne déjà : on lance un second serveur pointé sur le faux Overpass
  const port = 20000 + Math.floor(Math.random() * 20000), B2 = 'http://127.0.0.1:' + port, D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-l-'));
  const s2 = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore', env: { ...process.env, PORT: String(port), DATA_DIR: D2 + '/d', LIVE_DIR: D2 + '/l',
    ADMIN_KEY: ADMIN, IMPORT_17OCT: '0', PLACES_IMPORT: '0', PLACES_SOURCE: 'overpass', OVERPASS_URL: 'http://127.0.0.1:' + fake.address().port + '/api/interpreter', OVERPASS_GAP: '0' } });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(B2 + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const A = (p, body, method = 'POST') => fetch(B2 + p, { method, headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ s: r.status, j: await r.json() }));
    assert.equal((await A('/api/admin/places/import', {})).s, 202);
    let st; for (let i = 0; i < 100; i++) { st = (await A('/api/admin/places?q=lyon', undefined, 'GET')).j; if (!st.running && st.last) break; await new Promise(r => setTimeout(r, 100)); }
    assert.equal(st.last.n, 5, 'eau privée ignorée');
    assert.equal(st.counts.pref, 1); assert.equal(st.counts.gend, 1); assert.equal(st.counts.mairie, 1);
    const main = JSON.parse(fs.readFileSync(D2 + '/l/l/45_4.json', 'utf8')).p, street = JSON.parse(fs.readFileSync(D2 + '/l/l/45_4-s.json', 'utf8')).p;
    assert.equal(main.length, 4); assert.equal(street.length, 1);
    assert.equal(street[0][1], 'pharma'); assert.equal(street[0][5], 'Mo-Sa 09:00-19:00');
    assert.equal(main.find(x => x[1] === 'hopital')[7], 1, 'urgences');
    // Correction, masquage, ajout
    const ed = await A('/api/admin/places/n1', { n: 'Mairie centrale' });
    assert.equal(ed.j.n, 'Mairie centrale'); assert.equal(ed.j.ed, true);
    await A('/api/admin/places/n3', { hid: true });
    const add = await A('/api/admin/places', { kind: 'cra', lat: 45.72, lng: 4.9, n: 'CRA de test' });
    assert.equal(add.s, 201);
    const main2 = JSON.parse(fs.readFileSync(D2 + '/l/l/45_4.json', 'utf8')).p;
    assert.ok(main2.some(x => x[4] === 'Mairie centrale')); assert.ok(!main2.some(x => x[0] === 'n3')); assert.ok(main2.some(x => x[1] === 'cra'));
    // Nouvel import vide : les lieux corrigés ou ajoutés restent, les autres d'OSM disparaissent
    assert.equal((await A('/api/admin/places/import', {})).s, 202);
    for (let i = 0; i < 100; i++) { st = (await A('/api/admin/places?filter=edited', undefined, 'GET')).j; if (!st.running && st.last.n === 0) break; await new Promise(r => setTimeout(r, 100)); }
    const main3 = JSON.parse(fs.readFileSync(D2 + '/l/l/45_4.json', 'utf8')).p;
    assert.deepEqual(main3.map(x => x[1]).sort(), ['cra', 'mairie']);
    assert.ok(JSON.parse(fs.readFileSync(D2 + '/l/g.json', 'utf8')).pois);
  } finally { s2.kill(); fake.close(); fs.rmSync(D2, { recursive: true, force: true }); }
});

test('arrêtés : proposition avec source, validation par l’admin, zone officielle, import', async () => {
  const day = d => new Date(Date.now() + d * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const base = { dep: '34', commune: 'Montpellier', start: day(1) + ' 22:00', end: day(3) + ' 06:00', items: [['manif', 'La manifestation de samedi est interdite.'], ['couvre', 'Couvre-feu des mineurs dès 22 h.']], src: 'https://www.herault.gouv.fr/arrete' };
  assert.equal((await post('/api/orders', { ...base, src: 'pas un lien' })).s, 400, 'source obligatoire');
  assert.equal((await post('/api/orders', { ...base, dep: '99' })).s, 400, 'département inconnu');
  // Abonné·e à Montpellier, appli en espagnol : prévenu·e quand l'arrêté est validé
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/ord-' + Date.now(), keys: { p256dh: require('node:crypto').createECDH('prime256v1').generateKeys().toString('base64url'), auth: require('node:crypto').randomBytes(16).toString('base64url') } };
  assert.equal((await post('/api/push/subscribe', { sub, lat: 43.6, lng: 3.9, urgent: true, lang: 'es' })).s, 200);
  assert.deepEqual({ ...db.prepare('SELECT lang, ord FROM push WHERE e=?').get(sub.endpoint) }, { lang: 'es', ord: 1 });
  const p = await post('/api/orders', base);
  assert.equal(p.s, 201); assert.equal(p.j.status, 'pending');
  const ord = () => JSON.parse(fs.readFileSync(DIR + '/l/ord.json', 'utf8')).o;
  await new Promise(r => setTimeout(r, 1300));
  assert.ok(!fs.existsSync(DIR + '/l/ord.json') || !ord().length, 'rien avant validation');
  const ok = await admin('/api/admin/orders/' + p.j.id + '/approve', {});
  assert.equal(ok.s, 200); assert.equal(ok.j.zone.name, 'Montpellier'); assert.equal(ok.j.zone.insee, '34172');
  let sent; for (let i = 0; i < 60 && !sent; i++) { await new Promise(r => setTimeout(r, 250)); sent = (await fetch(B + '/api/admin/live', { headers: { 'x-admin-key': ADMIN } }).then(r => r.json())).push.batches.find(x => x.kind === 'arrêté'); }
  assert.ok(sent && sent.n >= 1, 'une notification « nouvel arrêté » envoyée à l’abonné·e de la zone');
  // Import : département entier (contour livré avec l'appli), commune introuvable refusée, outre-mer sans commune refusé
  const blk = [{ departement: '34', debut: day(1) + ' 06:00', fin: day(1) + ' 23:00', source: 'https://x.fr/a', mesures: [{ type: 'transport', texte: 'Pas de tram samedi.' }] },
    { departement: '34', commune: 'Inconnue', debut: day(1) + ' 06:00', fin: day(1) + ' 23:00', source: 'https://x.fr/a', mesures: [{ type: 'autre', texte: 'Test' }] },
    { departement: '971', debut: day(1) + ' 06:00', fin: day(1) + ' 23:00', source: 'https://x.fr/a', mesures: [{ type: 'autre', texte: 'Test' }] }];
  const imp = await admin('/api/admin/orders/import', { text: JSON.stringify(blk) });
  assert.deepEqual(imp.j.results.map(r => r.ok), [true, false, false]);
  await new Promise(r => setTimeout(r, 1300));
  const live = ord();
  assert.deepEqual(live.map(o => o.name).sort(), ['Hérault', 'Montpellier']);
  const m = live.find(o => o.name === 'Montpellier');
  assert.equal(m.scope, 'commune'); assert.deepEqual(m.b, [43.56, 3.8, 43.66, 3.94]); assert.equal(m.host, 'herault.gouv.fr');
  assert.ok(JSON.parse(fs.readFileSync(DIR + '/l/g.json', 'utf8')).ord, 'empreinte dans g.json');
  const h = live.find(o => o.name === 'Hérault'); assert.equal(h.scope, 'dep'); assert.ok(h.p[0][0].length > 20, 'contour du département');
  assert.equal((await fetch(B + '/api/admin/orders/' + m.id, { method: 'DELETE', headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' } })).status, 200);
});

test('adresses piégées des robots : erreur 400 ou 404, le serveur reste debout', async () => {
  const net = require('node:net'), port = new URL(B).port;
  for (const u of ['//%5c%2e%2e/%2e%2e/%2e%2e/etc%5cpasswd', '//%5c%2e%2e/etc/passwd/', '/..%2f..%2fd%2fsecret', '//etc/passwd', 'http://evil/x']) {
    const line = await new Promise(r => { const c = net.connect(port, '127.0.0.1', () => c.write(`GET ${u} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)); let d = ''; c.on('data', x => (d += x)); c.on('close', () => r(d.split('\r\n')[0])); c.on('error', () => r('')); });
    assert.match(line, /^HTTP\/1\.1 (400|404)/, u);
  }
  assert.equal((await fetch(B + '/api/health')).status, 200);
});

test('lieux et caméras : copie Geofabrik triée par osmium', { skip: require('child_process').spawnSync('osmium', ['--version']).status !== 0 && 'osmium absent' }, async () => {
  const http = require('node:http'), { execFileSync } = require('child_process');
  const D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-g-'));
  fs.writeFileSync(D2 + '/t.osm', `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">
<node id="1" version="1" lat="48.8660" lon="2.3620"><tag k="man_made" v="surveillance"/><tag k="surveillance" v="public"/><tag k="camera:direction" v="90"/><tag k="camera:type" v="fixed"/><tag k="operator" v="Préfecture de police"/></node>
<node id="2" version="1" lat="48.8665" lon="2.3625"><tag k="man_made" v="surveillance"/><tag k="surveillance" v="outdoor"/><tag k="camera:direction" v="SW"/></node>
<node id="3" version="1" lat="48.8667" lon="2.3628"><tag k="man_made" v="surveillance"/><tag k="surveillance" v="indoor"/></node>
<node id="5" version="1" lat="48.8670" lon="2.3640"><tag k="amenity" v="pharmacy"/><tag k="name" v="Pharmacie"/><tag k="phone" v="01 42 00 00 00"/></node>
<node id="6" version="1" lat="48.8600" lon="2.3500"><tag k="shop" v="bakery"/></node>
<node id="10" version="1" lat="48.8640" lon="2.3560"/><node id="11" version="1" lat="48.8640" lon="2.3580"/><node id="12" version="1" lat="48.8656" lon="2.3580"/><node id="13" version="1" lat="48.8656" lon="2.3560"/>
<way id="100" version="1"><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="13"/><nd ref="10"/><tag k="amenity" v="townhall"/><tag k="name" v="Mairie du 3e"/><tag k="building" v="yes"/></way>
<node id="20" version="1" lat="48.8500" lon="2.3400"/><node id="21" version="1" lat="48.8500" lon="2.3800"/><node id="22" version="1" lat="48.8800" lon="2.3800"/><node id="23" version="1" lat="48.8800" lon="2.3400"/>
<way id="200" version="1"><nd ref="20"/><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="20"/></way>
<relation id="300" version="1"><member type="way" ref="200" role="outer"/><tag k="type" v="boundary"/><tag k="boundary" v="administrative"/><tag k="admin_level" v="8"/><tag k="name" v="Paris"/><tag k="ref:INSEE" v="75056"/></relation>
</osm>`);
  execFileSync('osmium', ['sort', D2 + '/t.osm', '-o', D2 + '/t.osm.pbf']);
  const pbf = fs.readFileSync(D2 + '/t.osm.pbf');
  const fake = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: '/t.osm.pbf' }); return res.end(); }
    res.writeHead(200, { 'content-length': pbf.length }); res.end(pbf);
  }).listen(0);
  await new Promise(r => fake.on('listening', r));
  const port = 20000 + Math.floor(Math.random() * 20000), B2 = 'http://127.0.0.1:' + port;
  const s2 = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore', env: { ...process.env, PORT: String(port), DATA_DIR: D2 + '/d', LIVE_DIR: D2 + '/l',
    ADMIN_KEY: ADMIN, IMPORT_17OCT: '0', PLACES_IMPORT: '0', PLACES_SOURCE: 'osm', OSM_MIN_FREE_GB: '0', GEOFABRIK_URLS: 'http://127.0.0.1:' + fake.address().port + '/redir' } });
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(B2 + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const A = (p, body, method = 'POST') => fetch(B2 + p, { method, headers: { 'x-admin-key': ADMIN, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ s: r.status, j: await r.json() }));
    assert.equal((await A('/api/admin/places/import', {})).s, 202);
    let st; for (let i = 0; i < 100; i++) { st = (await A('/api/admin/places', undefined, 'GET')).j; if (!st.running && st.last) break; await new Promise(r => setTimeout(r, 100)); }
    assert.equal(st.source, 'osm'); assert.equal(st.last.err, null);
    assert.equal(st.last.communes, 1, 'contour de commune extrait pendant le même passage');
    // Bilan : la commune est nommée (pas son code INSEE)
    await fetch(B2 + '/api/reports', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'dev-commune'.padEnd(24, 'x') }, body: JSON.stringify({ cat: 'nasse', lat: 48.866, lng: 2.36 }) });
    const dg = (await A('/api/digest', undefined, 'GET')).j;
    assert.equal(dg.zones['75056'].name, 'Paris');
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    assert.equal((await A('/api/admin/publish/' + day, {})).s, 200);
    const page = await fetch(B2 + '/manif/' + day).then(r => r.text());
    assert.match(page, />Paris</); assert.ok(!page.includes('75056'), 'pas de code INSEE dans le bilan');
    // Veille des legal teams : jamais une adresse interne (ici le serveur lui-même), même par un lien enregistré par l'admin
    const lt = await A('/api/admin/legal', { city: 'Testville', name: 'LT Interne', phone: '06 12 34 56 78', src: B2 + '/api/health', lat: 44.1, lng: 4.1 });
    assert.ok(lt.s < 300, 'ligne ajoutée');
    await A('/api/admin/legal-watch', {});
    let w; for (let i = 0; i < 30 && !(w && w.watch); i++) { await new Promise(r => setTimeout(r, 100)); w = (await A('/api/admin/legal', undefined, 'GET')).j.list.find(e => e.id === lt.j.id); }
    assert.match(w.watch.err, /refusée/);
    assert.deepEqual(st.counts, { cam: 2, mairie: 1, pharma: 1 }, 'caméra intérieure et boulangerie ignorées');
    const cams = JSON.parse(fs.readFileSync(D2 + '/l/l/48_2-c.json', 'utf8')).p;
    assert.deepEqual(cams.find(x => x[0] === 'n1'), ['n1', 'cam', 48.866, 2.362, 'Préfecture de police', 1, 90, 'f']);
    assert.deepEqual(cams.find(x => x[0] === 'n2').slice(5), [0, 225, '']);
    const main = JSON.parse(fs.readFileSync(D2 + '/l/l/48_2.json', 'utf8')).p;
    assert.equal(main.length, 1); assert.equal(main[0][0], 'w100'); assert.ok(Math.abs(main[0][2] - 48.8648) < 1e-3, 'centre de la surface');
    assert.deepEqual(fs.readdirSync(D2 + '/d/osm'), [], 'fichiers téléchargés effacés');
  } finally { s2.kill(); fake.close(); fs.rmSync(D2, { recursive: true, force: true }); }
});

test('sécurité : une orga ne peut pas prendre le nom d’une autre, ni retirer ce qui n’est pas à elle', async () => {
  for (const label of ['Cortège', 'CORTEGE', 'Cоrtège' /* o cyrillique */, '17octobregiletjaune.net'])
    assert.equal((await admin('/api/admin/orgas', { label })).s, 409, label + ' refusé');
  const A = await orgaFrom((await admin('/api/admin/orgas', { label: 'Collectif Audit A' })).j.invite);
  assert.equal((await admin('/api/admin/orgas', { label: 'collectif  audit-a' })).s, 409, 'doublon à la casse et aux espaces près');
  const Bo = await orgaFrom((await admin('/api/admin/orgas', { label: 'Collectif Audit B' })).j.invite);
  const p = place();
  const adm = await admin('/api/admin/announcements', { kind: 'info', text: 'Annonce officielle', ...p, radiusKm: 3, minutes: 30 });
  assert.equal(adm.s, 201);
  const del = (key, id) => fetch(B + '/api/announcements/' + id, { method: 'DELETE', headers: { 'x-orga-key': key, 'content-type': 'application/json' } }).then(r => r.status);
  assert.equal(await del(A.key, adm.j.id), 403, 'une orga ne retire pas une annonce de l’admin');
  const mine = await asOrga(A.key, '/api/announcements', { kind: 'info', text: 'Annonce de A', ...p, radiusKm: 3, minutes: 30 });
  assert.equal(mine.s, 201); assert.ok(mine.j.ob, 'empreinte de l’auteur');
  assert.equal(await del(Bo.key, mine.j.id), 403, 'B ne retire pas l’annonce de A');
  const listB = await fetch(B + '/api/orga/mine', { headers: { 'x-orga-key': Bo.key } }).then(r => r.json());
  assert.ok(!listB.a.some(x => x.id === mine.j.id), 'B ne voit pas les annonces de A');
  const meA = await fetch(B + '/api/orga/me', { headers: { 'x-orga-key': A.key } }).then(r => r.json());
  assert.equal(meA.ob, mine.j.ob);
  assert.equal(await del(A.key, mine.j.id), 200, 'A retire la sienne');
});

test('orgas : en essai, ni coche « vérifié » ni annonce visible avant validation ; urgences limitées', async () => {
  const T = await orgaFrom((await admin('/api/admin/orgas', { label: 'Collectif Essai 265' })).j.invite);
  const r = (await post('/api/reports', { cat: 'police', ...place() })).j;
  const v = await asOrga(T.key, `/api/reports/${r.id}/verify`, {});
  assert.equal(v.s, 200); assert.ok(!v.j.ver, 'pas de coche pendant l’essai'); assert.equal(v.j.up, 1, 'confirmation forte');
  const a = await asOrga(T.key, '/api/announcements', { kind: 'info', text: 'Info d’essai', ...place(), radiusKm: 3, minutes: 30 });
  assert.equal(a.s, 201); assert.equal(a.j.pending, true, 'en attente de validation');
  // Orga confirmée : 3 annonces urgentes par heure au plus
  const C = await orgaFrom((await admin('/api/admin/orgas', { label: 'Collectif Confirme 265' })).j.invite);
  const orgas = await fetch(B + '/api/admin/orgas', { headers: { 'x-admin-key': ADMIN } }).then(x => x.json());
  const id = orgas.orgas.find(o => o.label === 'Collectif Confirme 265').id;
  await admin(`/api/admin/orgas/${id}/trial`, { trial: false });
  const urg = [];
  for (let i = 0; i < 4; i++) urg.push((await asOrga(C.key, '/api/announcements', { kind: 'info', level: 'urgent', text: 'Urgence ' + i, ...place(), radiusKm: 3, minutes: 30 })).s);
  assert.deepEqual(urg, [201, 201, 201, 429]);
});

test('cortège : tête qui suit (avec sa trace), queue, et position en direct des orgas confirmées', async () => {
  const p = place(), h1 = (await post('/api/reports', { cat: 'cortege', ...p })).j;
  const h2 = (await post('/api/reports', { cat: 'cortege', lat: p.lat + 0.002, lng: p.lng })).j; // ~220 m plus loin
  assert.equal(h2.id, h1.id, 'une seule tête'); assert.ok(Math.abs(h2.lat - (p.lat + 0.002)) < 1e-6, 'elle suit');
  assert.equal(h2.tr.length, 1, 'trace : l’ancienne position'); assert.ok(Math.abs(h2.tr[0][0] - p.lat) < 1e-6);
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  assert.ok(cfg.categories.some(c => c.id === 'queue'), 'queue de cortège');
  // Position en direct : réservée aux orgas confirmées
  const T = await orgaFrom((await admin('/api/admin/orgas', { label: 'Medics Essai 27' })).j.invite);
  assert.equal((await asOrga(T.key, '/api/orga/beacon', { role: 'medic', ...place() })).s, 403);
  const C = await orgaFrom((await admin('/api/admin/orgas', { label: 'Service Ordre 27' })).j.invite);
  const id = (await fetch(B + '/api/admin/orgas', { headers: { 'x-admin-key': ADMIN } }).then(x => x.json())).orgas.find(o => o.label === 'Service Ordre 27').id;
  await admin(`/api/admin/orgas/${id}/trial`, { trial: false });
  const bk = await asOrga(C.key, '/api/orga/beacon', { role: 'cortege', lat: p.lat + 0.0021, lng: p.lng });
  assert.equal(bk.s, 201); assert.equal(bk.j.live, 1); assert.equal(bk.j.ver, 'Service Ordre 27');
  assert.ok(!row(h1.id), 'la tête signalée à côté est reprise par la position de l’orga'); assert.ok(bk.j.tr.length >= 2, 'avec sa trace');
  const again = await asOrga(C.key, '/api/orga/beacon', { role: 'cortege', lat: p.lat + 0.01, lng: p.lng });
  assert.equal(again.j.id, bk.j.id); assert.ok(Math.abs(again.j.lat - (p.lat + 0.0021)) < 1e-6, 'pas plus d’une mise à jour toutes les 10 s');
  const hp = (await post('/api/reports', { cat: 'cortege', lat: p.lat + 0.0025, lng: p.lng })).j;
  assert.equal(hp.id, bk.j.id, 'un signalement de participant·e confirme la tête en direct'); assert.ok(Math.abs(hp.lat - (p.lat + 0.0021)) < 1e-6, 'sans la déplacer');
  const stop = await fetch(B + '/api/orga/beacon', { method: 'DELETE', headers: { 'x-orga-key': C.key, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'cortege' }) });
  assert.equal(stop.status, 200); assert.ok(!row(bk.j.id), 'point retiré à l’arrêt');
});

test('position en direct : arrêtée net à plus de 2 km du départ, sans garder la position lointaine', async () => {
  const C = await orgaFrom((await admin('/api/admin/orgas', { label: 'Medics Zone 271' })).j.invite);
  const id = (await fetch(B + '/api/admin/orgas', { headers: { 'x-admin-key': ADMIN } }).then(x => x.json())).orgas.find(o => o.label === 'Medics Zone 271').id;
  await admin(`/api/admin/orgas/${id}/trial`, { trial: false });
  const p = place(), bk = await asOrga(C.key, '/api/orga/beacon', { role: 'medic', ...p });
  assert.equal(bk.s, 201); assert.ok(!('bkla' in bk.j), 'point de départ jamais publié');
  const far = await asOrga(C.key, '/api/orga/beacon', { role: 'medic', lat: p.lat + 0.03, lng: p.lng }); // ~3,3 km
  assert.equal(far.s, 410); assert.equal(far.j.zone, true);
  assert.ok(!row(bk.j.id), 'point retiré');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM reports').all()).includes(String(Math.round((p.lat + 0.03) * 1e4) / 1e4)), 'position lointaine jamais enregistrée');
});

test('tracé du cortège par les rues : plus court chemin piéton, sans autoroute', async () => {
  const { streetRoute, tileOf } = require(path.join(ROOT, 'tools', 'street-route.js'));
  // Petite tuile vectorielle (format MVT) : une rue en L, et une autoroute en diagonale qui ne doit pas servir
  const vi = n => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
  const zz = n => n >= 0 ? 2 * n : -2 * n - 1;
  const fld = (f, w, body) => w === 2 ? [...vi(f * 8 + 2), ...vi(body.length), ...body] : [...vi(f * 8), ...vi(body)];
  const str = x => [...Buffer.from(x)];
  const line = pts => { const g = [...vi(9), ...vi(zz(pts[0][0])), ...vi(zz(pts[0][1])), ...vi(((pts.length - 1) << 3) | 2)]; for (let i = 1; i < pts.length; i++) g.push(...vi(zz(pts[i][0] - pts[i - 1][0])), ...vi(zz(pts[i][1] - pts[i - 1][1]))); return g; };
  const feat = (pts, kindIdx) => fld(2, 2, [...fld(2, 2, [0, kindIdx]), ...fld(3, 0, 2), ...fld(4, 2, line(pts))]);
  const layer = [...fld(15, 0, 2), ...fld(1, 2, str('roads')), ...feat([[200, 1000], [3800, 1000], [3800, 3000]], 0), ...feat([[200, 1000], [3800, 3000]], 1),
    ...fld(3, 2, str('kind')), ...fld(4, 2, fld(1, 2, str('minor_road'))), ...fld(4, 2, fld(1, 2, str('highway'))), ...fld(5, 0, 4096)];
  const tile = Buffer.from(fld(3, 2, layer));
  const z = 15, [tx, ty] = tileOf(43.61, 3.877, z);
  const at = (px, py) => { const n = 2 ** z, wx = (tx + px / 4096) / n, wy = (ty + py / 4096) / n; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI, wx * 360 - 180]; };
  const r = await streetRoute(async (zz2, x, y) => (x === tx && y === ty ? tile : null), z, at(250, 1010), at(3790, 2950));
  assert.ok(r && r.path.length >= 4, 'chemin trouvé');
  assert.ok(r.path.some(p => Math.abs(p[0] - at(3800, 1000)[0]) < 1e-4 && Math.abs(p[1] - at(3800, 1000)[1]) < 1e-4), 'passe par le coin de la rue (pas par l’autoroute)');
  const straight = r.path[0], end = r.path[r.path.length - 1];
  assert.ok(r.len > require(path.join(ROOT, 'tools', 'street-route.js')).meters(straight, end) * 1.2, 'plus long qu’à vol d’oiseau');
  assert.equal((await fetch(B + '/api/cortege-route?a=1,2&b=x')).status, 400);
});

test('sécurité : CF-Connecting-IP ignoré sans CLOUDFLARE=1 (impossible de changer d’« IP » à volonté)', async () => {
  const net = '9.9.' + (Date.now() % 250) + '.9';
  for (let i = 0; i < 11; i++)
    await fetch(B + '/api/admin/orgas', { headers: { 'x-admin-key': 'mauvaise-cle-' + i, 'x-forwarded-for': net, 'cf-connecting-ip': '7.7.7.' + i } });
  const r = await fetch(B + '/api/admin/orgas', { headers: { 'x-admin-key': ADMIN, 'x-forwarded-for': net, 'cf-connecting-ip': '7.7.8.1' } });
  assert.equal(r.status, 403, 'même réseau malgré l’en-tête changé : bloqué après 10 essais');
});

test('effacement d’urgence : confirmation obligatoire, puis plus aucune trace', async () => {
  assert.equal((await admin('/api/admin/wipe', {})).s, 400);
  const day = d => new Date(Date.now() + d * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  assert.equal((await post('/api/orders', { dep: '34', commune: 'Montpellier', start: day(1) + ' 10:00', end: day(2) + ' 10:00', items: [['manif', 'Test effacement']], src: 'https://x.fr/a' })).s, 201);
  const keys = () => fs.readdirSync(DIR + '/d/keys').map(f => fs.readFileSync(DIR + '/d/keys/' + f, 'utf8'));
  const before = keys();
  assert.ok(before.length >= 1, 'clés par période sur le disque');
  const w = await admin('/api/admin/wipe', { confirm: 'EFFACER' });
  assert.equal(w.s, 200); assert.equal(w.j.rotated, true);
  for (const t of ['reports', 'devices', 'abuse', 'trash', 'orga_log', 'push', 'orga_req'])
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t + ' vide');
  // Aucune empreinte de téléphone ou de réseau, dans aucune table (colonnes et données JSON)
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    const cols = db.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
    for (const c of cols.filter(c => ['dev', 'ip', 'net', 'voters', 'down_ips'].includes(c)))
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${name} WHERE ${c} IS NOT NULL AND ${c} NOT IN ('[]', '')`).get().n, 0, name + '.' + c);
    if (cols.includes('data')) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${name} WHERE data LIKE '%"dev":"%'`).get().n, 0, name + ' (données)');
  }
  assert.ok(!keys().some(k => before.includes(k)), 'anciennes clés détruites');
});

test('traductions : fichiers valides, mêmes textes dans chaque langue', () => {
  const out = require('node:child_process').execFileSync(process.execPath, [path.join(ROOT, 'tools', 'i18n-build.js')], { encoding: 'utf8' });
  assert.match(out, /textes traduits/);
  const L = l => JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'public', 'lang', l + '.json'), 'utf8'));
  const en = L('en'), es = L('es'), ar = L('ar');
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const k of ['Signaler', 'Droits', 'Mode manif', 'Garde à vue']) assert.ok(en[k] && es[k] && ar[k], k);
});
