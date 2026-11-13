'use strict';
// 2.19 : page « Pour les orgas », tableau de bord, rappels avant un rendez-vous, page d'accueil d'une autre instance,
// écran medic chargé à la demande.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN = 'admin-key-for-tests-123';
const ROOT = path.join(__dirname, '..');
let srv, B, DIR, port, n = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const stop = p => new Promise(r => { if (!p || p.exitCode !== null) return r(); p.once('exit', r); p.kill(); });
const start = async (extra = {}, p = port) => {
  const s = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, PORT: String(p), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', PLACES_IMPORT: '0', SOCIAL: '0', VEILLE: '0', GITHUB_SYNC: '0', FLUSH_MS: '150', MEDIC_PUSH: '0', ORGA_REMIND: '0', ...extra } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:' + p + '/api/health')).ok) break; } catch {} await wait(100); }
  return s;
};
before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-board-'));
  port = 20000 + Math.floor(Math.random() * 20000); B = 'http://127.0.0.1:' + port;
  srv = await start();
});
after(async () => { await stop(srv); fs.rmSync(DIR, { recursive: true, force: true }); });

const req = (m, p, body, h = {}) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': '83.2.' + (++n % 250) + '.' + (n % 199), 'x-device': 'dev-board-test-' + String(n).padStart(8, '0'), ...h }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const adm = (m, p, body) => req(m, p, body, { 'x-admin-key': ADMIN });
const P = { lat: 43.6108, lng: 3.8767 };
const SUB = i => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test-' + i, keys: { p256dh: 'B' + 'a'.repeat(86), auth: 'c'.repeat(22) } });
async function orga(label, certified = true) {
  const o = await adm('POST', '/api/admin/orgas', { label });
  assert.equal(o.s, 201, label);
  const r = await req('POST', '/api/invite', { token: o.j.invite });
  assert.equal(r.s, 200);
  if (certified) assert.equal((await adm('POST', `/api/admin/orgas/${o.j.id}/trial`, { trial: false })).s, 200);
  return { id: o.j.id, key: r.j.key, label, call: (m, p, body) => req(m, p, body, { 'x-orga-key': r.j.key }) };
}

test('page « Pour les orgas » : servie, dans le plan du site et le menu des pages', async () => {
  const r = await fetch(B + '/orgas'), html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /Demander un accès orga/);
  assert.match(html, /href="\/\?rejoindre="/);
  assert.ok(!html.includes('—'), 'pas de tiret long');
  assert.match(await (await fetch(B + '/sitemap.xml')).text(), /\/orgas</);
  assert.match(await (await fetch(B + '/agenda')).text(), /href="\/orgas"/);
});

test('écran medic : hors du script principal, servi à part', async () => {
  const app = await (await fetch(B + '/app.js')).text(), part = await fetch(B + '/app-medic.js');
  assert.equal(part.status, 200);
  assert.ok(!app.includes('mdLoop'), 'le code medic n’est plus dans app.js');
  assert.match(app, /app-medic\.js/);
  assert.match(await part.text(), /window\.cortegeMedic = function/);
});

test('page d’accueil : adresse et pseudo de l’instance, mention d’origine gardée', async () => {
  // Sans PUBLIC_URL : l'adresse demandée
  const home = await (await fetch(B + '/')).text();
  assert.match(home, new RegExp(`<link rel="canonical" href="https://127\\.0\\.0\\.1:${port}/">`));
  const p2 = port + 1, other = await start({ PUBLIC_URL: 'https://carte.example', BRAND_HANDLE: 'autre', DATA_DIR: DIR + '/d2', LIVE_DIR: DIR + '/l2' }, p2);
  try {
    const r = await fetch('http://127.0.0.1:' + p2 + '/'), html = await r.text(), head = html.split('</head>')[0];
    assert.match(head, /<link rel="canonical" href="https:\/\/carte\.example\/">/);
    assert.match(head, /og:image" content="https:\/\/carte\.example\/og\.png"/);
    assert.match(head, /sans pistage, partout en France\. Par @autre\./);
    assert.ok(!head.includes('cortege.neru.tv') && !head.includes('@neru'), 'plus rien de l’instance d’origine dans l’en-tête');
    assert.match(html, /Propulsé par/, 'mention d’origine toujours dans la page');
    assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
    const man = await (await fetch('http://127.0.0.1:' + p2 + '/manifest.webmanifest')).json();
    assert.equal(man.name, 'Cortège par @autre');
    // Même page redemandée : « pas modifié »
    assert.equal((await fetch('http://127.0.0.1:' + p2 + '/', { headers: { 'if-none-match': r.headers.get('etag') } })).status, 304);
  } finally { await stop(other); }
});

test('tableau de bord : chiffres du journal, rendez-vous à venir, rien pour une autre orga', async () => {
  const A = await orga('Union locale Test'), Bo = await orga('Autre collectif');
  assert.deepEqual((await A.call('GET', '/api/orga/board')).j.month, { verified: 0, removed: 0, announcements: 0, events: 0, reports: 0 });
  const ev = await A.call('POST', '/api/events', { type: 'manif', title: 'Manif de test', place: 'Place de la Comédie', start: Date.now() + 26 * 3600e3, ...P });
  assert.equal(ev.s, 201);
  const ann = await A.call('POST', '/api/announcements', { kind: 'info', text: 'Départ décalé de 30 minutes', ...P });
  assert.equal(ann.s, 201);
  const b = (await A.call('GET', '/api/orga/board')).j;
  assert.equal(b.month.events, 1); assert.equal(b.month.announcements, 1); assert.equal(b.total.events, 1);
  assert.equal(b.events.length, 1); assert.equal(b.events[0].title, 'Manif de test'); assert.equal(b.events[0].pending, false);
  assert.equal(b.events[0].reach, 0, 'moins de 5 téléphones abonnés : pas de nombre');
  assert.equal(b.remind.can, true);
  assert.ok(b.since > Date.now() - 60_000);
  const other = (await Bo.call('GET', '/api/orga/board')).j;
  assert.equal(other.events.length, 0); assert.equal(other.month.events, 0);
  assert.equal((await req('GET', '/api/orga/board')).s, 403, 'sans clé : refusé');
});

test('rappels : demandés par l’orga, envoyés une fois la veille et deux heures avant, oubliés quand l’accès est coupé', async () => {
  const A = await orga('Rappels Test');
  const start0 = Date.now() + 30 * 3600e3;
  const ev = await A.call('POST', '/api/events', { type: 'manif', title: 'Manif des rappels', place: 'Préfecture', start: start0, ...P });
  assert.equal(ev.s, 201);
  assert.equal((await A.call('POST', '/api/orga/remind', { sub: { endpoint: 'https://exemple.test/x', keys: SUB(0).keys } })).s, 400, 'service inconnu refusé');
  assert.equal((await A.call('POST', '/api/orga/remind', { sub: SUB(1), lang: 'fr' })).s, 200);
  assert.equal((await A.call('POST', '/api/orga/remind', { sub: SUB(2), lang: 'en' })).s, 200);
  assert.equal((await A.call('DELETE', '/api/orga/remind', { endpoint: SUB(2).endpoint })).j.on, false);
  assert.equal((await adm('POST', '/api/orga/remind', { sub: SUB(3) })).s, 403, 'la clé admin n’est pas une clé orga');
  // Le reste se vérifie sur la base, serveur arrêté (les rappels sont coupés dans ce serveur de test)
  await stop(srv);
  process.env.DATA_DIR = DIR + '/d'; process.env.LIVE_DIR = DIR + '/l'; process.env.ORGA_REMIND = '0';
  const board = require('../src/orgas/board'), store = require('../src/orgas/store');
  assert.equal(board.remindDue(Date.now()).length, 0, 'trop tôt : plus de 24 h avant');
  const got = [], send = async (s, p) => { got.push({ e: s.e, lang: s.lang, p: JSON.parse(p) }); return 201; };
  const eve = start0 - 20 * 3600e3;
  assert.equal(await board.remindTick(eve, send), 1);
  assert.equal(got.length, 1); assert.equal(got[0].e, SUB(1).endpoint);
  assert.match(got[0].p.body, /Manif des rappels · Préfecture/); assert.equal(got[0].p.url, '/?espace=orga');
  assert.equal(await board.remindTick(eve + 60_000, send), 0, 'la veille : une seule fois');
  assert.equal(await board.remindTick(start0 - 90 * 60_000, send), 1, 'deux heures avant');
  assert.equal(await board.remindTick(start0 - 80 * 60_000, send), 0);
  assert.equal(await board.remindTick(start0 + 60_000, send), 0, 'rien après le début');
  const { q } = require('../src/db');
  assert.equal(q('SELECT COUNT(*) n FROM orga_push').get().n, 1);
  // Nouvelle invitation ou accès repris : l'empreinte de la clé change, les adresses de l'ancien accès sont oubliées
  store.writeOrgas(store.readOrgas().map(o => o.id === A.id ? { ...o, hash: null, keys: [] } : o));
  assert.equal(q('SELECT COUNT(*) n FROM orga_push').get().n, 0);
  srv = await start();
});
