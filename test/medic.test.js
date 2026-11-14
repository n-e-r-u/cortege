'use strict';
// Mode medic et code de secours : étanchéité de la couche privée, parcours des équipes, accès perdu puis retrouvé.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN = 'admin-key-for-tests-123';
const ROOT = path.join(__dirname, '..');
let srv, B, DIR, port, n = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Arrêt propre du serveur : on attend sa fin avant d'effacer son dossier
const stop = p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(); });
const start = async () => {
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', PLACES_IMPORT: '0', SOCIAL: '0', VEILLE: '0', GITHUB_SYNC: '0', FLUSH_MS: '150', MEDIC_PUSH: '0' } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
};
before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-medic-'));
  port = 20000 + Math.floor(Math.random() * 20000); B = 'http://127.0.0.1:' + port;
  await start();
});
after(async () => { await stop(srv); fs.rmSync(DIR, { recursive: true, force: true }); });

const req = (m, p, body, h = {}) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-forwarded-for': '82.1.' + (++n % 250) + '.' + (n % 199), 'x-device': 'dev-medic-test-' + String(n).padStart(8, '0'), ...h }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const adm = (m, p, body) => req(m, p, body, { 'x-admin-key': ADMIN });
const as = key => (m, p, body) => req(m, p, body, { 'x-medic-key': key });
const asOrga = key => (m, p, body) => req(m, p, body, { 'x-orga-key': key });
const P = { lat: 43.6108, lng: 3.8767 };
async function team(label, extra = {}) {
  const t = await adm('POST', '/api/admin/medics', { label, city: 'Montpellier', ...extra });
  assert.equal(t.s, 201, label);
  const r = await req('POST', '/api/invite', { token: t.j.invite });
  assert.equal(r.s, 200); assert.equal(r.j.medic, true);
  return { id: t.j.id, key: r.j.key, rec: r.j.rec, call: as(r.j.key), label };
}
async function orga(label) {
  const o = await adm('POST', '/api/admin/orgas', { label });
  assert.equal(o.s, 201, label);
  const r = await req('POST', '/api/invite', { token: o.j.invite });
  return { id: o.j.id, key: r.j.key, rec: r.j.rec, call: asOrga(r.j.key) };
}
// Tout ce qu'un téléphone sans clé medic peut lire, plus tout ce que le serveur a écrit sur le disque
async function publicSurface() {
  let s = '';
  for (const u of ['/api/config', '/live/g.json', '/live/n.json', '/live/ann.json', '/live/events.json', '/api/reports?bbox=43,3,44,4', '/api/ideas', '/manif', '/agenda'])
    s += await fetch(B + u).then(r => r.text()).catch(() => '');
  const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else s += fs.readFileSync(p, 'latin1'); } };
  walk(DIR + '/l'); walk(DIR + '/d');
  return s;
}

let A, Bq, C;
test('medic : invitation, code de secours donné une fois, aucun droit d’orga', async () => {
  A = await team('Medics Alpha', { ref: true }); Bq = await team('Binôme Bravo');
  assert.match(A.rec, /^([A-HJKMNP-TV-Z2-9]{4}-){4}[A-HJKMNP-TV-Z2-9]{4}$/, 'code de secours à l’activation');
  const me = await A.call('GET', '/api/medic/me');
  assert.deepEqual([me.j.label, me.j.ref, me.j.rec, me.j.devices], ['Medics Alpha', true, true, 1]);
  assert.equal((await adm('POST', '/api/admin/medics', { label: 'medics alpha' })).s, 409, 'nom en double refusé');
  // La clé medic n'ouvre rien côté orga : ni espace orga, ni annonce, ni signalement vérifié d'office
  assert.equal((await asOrga(A.key)('GET', '/api/orga/me')).s, 403);
  assert.equal((await asOrga(A.key)('POST', '/api/announcements', { kind: 'info', text: 'Essai', ...P, radiusKm: 1, minutes: 30 })).s, 403);
  const r = await req('POST', '/api/reports', { cat: 'medic', lat: 43.7, lng: 3.7 }, { 'x-orga-key': A.key });
  assert.ok(!r.j.ver, 'signalement non vérifié');
  // Et la clé admin ou une clé d'orga n'ouvre pas la carte medic
  const O = await orga('Collectif Sans Medic');
  for (const h of [{}, { 'x-medic-key': ADMIN }, { 'x-medic-key': O.key }, { 'x-admin-key': ADMIN }, { 'x-orga-key': O.key }])
    assert.equal((await req('GET', '/api/medic/state', undefined, h)).s, 403, JSON.stringify(Object.keys(h)));
});

test('medic : points chauds, barrages, renforts ajoutés et retirés à la main, « j’y vais », attente longue', async () => {
  assert.equal((await A.call('POST', '/api/medic/items', { k: 'autre', ...P })).s, 400);
  assert.equal((await A.call('POST', '/api/medic/items', { k: 'help', ...P })).s, 400, 'un renfort a un niveau');
  assert.equal((await A.call('POST', '/api/medic/items', { k: 'hot', lat: 99, lng: 3 })).s, 400);
  const hot = await A.call('POST', '/api/medic/items', { k: 'hot', ...P, note: 'texte libre ignoré', name: 'Jeanne' });
  assert.equal(hot.s, 201); assert.deepEqual(Object.keys(hot.j).sort(), ['exp', 'id', 'k', 'lat', 'lng', 'mine', 't', 'team'], 'aucun texte libre gardé');
  const block = await Bq.call('POST', '/api/medic/items', { k: 'block', lat: P.lat + 0.001, lng: P.lng });
  const sB = (await Bq.call('GET', '/api/medic/state')).j;
  assert.equal(sB.items.length, 2);
  assert.deepEqual(sB.items.find(x => x.id === hot.j.id), { ...hot.j, mine: false }, 'vu par l’autre équipe');
  // Attente longue : la réponse arrive dès qu'une autre équipe ajoute quelque chose
  const t0 = Date.now(), waiting = Bq.call('GET', `/api/medic/state?v=${sB.v}&wait=1`);
  await wait(300);
  const help = await A.call('POST', '/api/medic/items', { k: 'help', lvl: 'vital', ...P });
  const got = await waiting;
  assert.ok(Date.now() - t0 < 5000, 'pas d’attente jusqu’au délai'); assert.ok(got.j.v > sB.v);
  assert.deepEqual(got.j.items.find(x => x.id === help.j.id).go, []);
  // « J'y vais », puis « Réglé »
  const go = await Bq.call('POST', `/api/medic/items/${help.j.id}/go`, { on: true });
  assert.deepEqual([go.j.go, go.j.iGo], [['Binôme Bravo'], true]);
  assert.deepEqual((await A.call('GET', '/api/medic/state')).j.items.find(x => x.id === help.j.id).go, ['Binôme Bravo']);
  assert.deepEqual((await Bq.call('POST', `/api/medic/items/${help.j.id}/go`, { on: false })).j.go, []);
  assert.equal((await Bq.call('POST', `/api/medic/items/${hot.j.id}/go`, {})).s, 404, 'seulement sur un renfort');
  assert.equal((await Bq.call('DELETE', '/api/medic/items/' + help.j.id)).s, 200, 'réglé par n’importe quelle équipe');
  assert.equal((await A.call('DELETE', '/api/medic/items/' + block.j.id)).s, 200, 'le terrain fait foi : une autre équipe retire');
  assert.equal((await A.call('DELETE', '/api/medic/items/' + block.j.id)).s, 404);
  assert.deepEqual((await A.call('GET', '/api/medic/state')).j.items.map(x => x.id), [hot.j.id]);
});

test('medic : position de l’équipe, privée par défaut, publique au choix, arrêtée seule', async () => {
  assert.equal((await A.call('POST', '/api/medic/pos', { ...P })).s, 410, 'jamais démarrée sans le bouton');
  const st = await A.call('POST', '/api/medic/pos', { ...P, start: true, dur: 60 });
  assert.equal(st.s, 201); assert.ok(st.j.until - Date.now() > 59 * 60_000 && st.j.until - Date.now() <= 60 * 60_000);
  let pos = (await Bq.call('GET', '/api/medic/state')).j.items.find(x => x.k === 'pos');
  assert.deepEqual([pos.team, pos.pub, pos.lat, pos.lng], ['Medics Alpha', false, P.lat, P.lng]);
  await wait(400);
  assert.ok(!(await publicSurface()).includes('Medics Alpha" ') && !(await fetch(B + '/api/reports?bbox=43,3,44,4').then(r => r.text())).includes('Medics Alpha'), 'position privée : rien sur la carte publique');
  // Plus de 2 km du point de départ : le partage s'arrête, cette position n'est jamais gardée
  const far = await A.call('POST', '/api/medic/pos', { lat: P.lat + 0.05, lng: P.lng });
  assert.equal(far.s, 410); assert.equal(far.j.zone, true);
  assert.equal((await Bq.call('GET', '/api/medic/state')).j.items.some(x => x.k === 'pos'), false);
  // Publique : un ⛑️ vérifié au nom de l'équipe sur la carte de tout le monde, retiré à l'arrêt
  assert.equal((await Bq.call('POST', '/api/medic/pos', { ...P, start: true, pub: true })).s, 201);
  const seen = async () => (await fetch(B + '/api/reports?bbox=43,3,44,4').then(r => r.json())).reports.filter(r => r.cat === 'medic' && r.ver === 'Binôme Bravo');
  assert.equal((await seen()).length, 1, 'visible du public');
  assert.equal((await Bq.call('DELETE', '/api/medic/pos', {})).s, 200);
  assert.equal((await seen()).length, 0, 'retirée de la carte publique');
});

test('medic : rien de la couche privée ne sort (fichiers publics, API publiques, disque, admin)', async () => {
  const mark = [];
  for (const k of ['hot', 'block']) mark.push((await A.call('POST', '/api/medic/items', { k, lat: 43.612345, lng: 3.871234 })).j.id);
  mark.push((await A.call('POST', '/api/medic/items', { k: 'help', lvl: 'duo', lat: 43.612345, lng: 3.871234 })).j.id);
  await A.call('POST', '/api/medic/pos', { lat: 43.612345, lng: 3.871234, start: true });
  await wait(700);
  const all = await publicSurface();
  for (const id of mark) assert.ok(!all.includes(id), 'identifiant d’une info medic introuvable hors de la mémoire');
  assert.ok(!all.includes('43.612345') && !all.includes('43.61234') && !all.includes('3.871234'), 'aucune position medic écrite ou publiée');
  // Temps réel public : rien n'y passe quand la couche medic change
  const ctl = new AbortController(), res = await fetch(B + '/api/stream?r=43_3', { signal: ctl.signal }), rd = res.body.getReader();
  let buf = ''; const reading = (async () => { try { for (;;) { const { value, done } = await rd.read(); if (done) break; buf += new TextDecoder().decode(value); } } catch {} })();
  await A.call('POST', '/api/medic/items', { k: 'hot', lat: 43.6131, lng: 3.8701 });
  await wait(600); ctl.abort(); await reading;
  assert.ok(!buf.includes('data:'), 'aucun événement public');
  // Admin : des totaux, jamais de position ni d'info
  const a = await adm('GET', '/api/admin/medics');
  assert.equal(a.j.stats.pos, 1); assert.ok(a.j.stats.hot >= 2); assert.equal(a.j.stats.helpsToday >= 1, true);
  const txt = JSON.stringify(a.j);
  assert.ok(!/"lat"|"lng"/.test(txt) && !mark.some(id => txt.includes(id)), 'admin sans position');
  assert.ok(!txt.includes(A.key) && !txt.includes(A.rec), 'ni clé ni code');
  for (const u of ['/api/admin/live', '/api/admin/journal', '/api/digest']) { const t = await fetch(B + u, { headers: { 'x-admin-key': ADMIN } }).then(r => r.text()); for (const id of mark) assert.ok(!t.includes(id), u); }
});

test('medic : référent·e, équipes invitées, réinvitées et retirées', async () => {
  assert.equal((await Bq.call('GET', '/api/medic/teams')).s, 403);
  assert.equal((await Bq.call('GET', '/api/medic/teams')).j.gone, undefined, 'action interdite : la clé reste sur le téléphone');
  const inv = await A.call('POST', '/api/medic/teams', { label: 'Trinôme Charlie' });
  assert.equal(inv.s, 201);
  const r = await req('POST', '/api/invite', { token: inv.j.invite });
  C = { id: inv.j.id, key: r.j.key, call: as(r.j.key) };
  assert.equal((await C.call('GET', '/api/medic/me')).j.city, 'Montpellier', 'ville de la référente');
  assert.deepEqual((await A.call('GET', '/api/medic/teams')).j.teams.map(t => [t.label, t.active]), [['Trinôme Charlie', true]]);
  assert.equal((await A.call('POST', `/api/medic/teams/${Bq.id}/invite`, {})).s, 404, 'seulement ses propres équipes');
  // Réinvitation : l'ancien accès est coupé, ses infos quittent la carte
  await C.call('POST', '/api/medic/items', { k: 'hot', lat: 43.62, lng: 3.88 });
  const again = await A.call('POST', `/api/medic/teams/${C.id}/invite`, {});
  assert.equal(again.s, 200);
  const old = await C.call('GET', '/api/medic/state');
  assert.deepEqual([old.s, old.j.gone], [403, true], 'clé retirée : le téléphone l’oublie');
  assert.equal((await A.call('GET', '/api/medic/state')).j.items.some(x => x.team === 'Trinôme Charlie'), false);
  const r2 = await req('POST', '/api/invite', { token: again.j.invite });
  C.key = r2.j.key; C.call = as(C.key); C.rec = r2.j.rec;
  // Deuxième appareil : lien à usage unique, les deux clés marchent
  const dev = await C.call('POST', '/api/medic/device', {});
  const d2 = await req('POST', '/api/invite', { token: dev.j.invite });
  assert.deepEqual([d2.j.device, d2.j.medic, d2.j.rec], [true, true, undefined]);
  assert.equal((await as(d2.j.key)('GET', '/api/medic/me')).j.devices, 2);
  assert.equal((await req('POST', '/api/invite', { token: dev.j.invite })).s, 404, 'usage unique');
  C.key2 = d2.j.key;
});

test('code de secours : accès retrouvé, autres appareils coupés, chaque code ne sert qu’une fois', async () => {
  // Équipe medic : téléphone saisi, récupération sur un autre
  assert.equal((await req('POST', '/api/recover', { code: 'pas-un-code' })).s, 400);
  assert.equal((await req('POST', '/api/recover', { code: 'AAAA-BBBB-CCCC-DDDD-EEEE' })).s, 404);
  const rc = await req('POST', '/api/recover', { code: C.rec.toLowerCase().replace(/-/g, ' ') });
  assert.deepEqual([rc.s, rc.j.medic, rc.j.cut, rc.j.label], [200, true, true, 'Trinôme Charlie']);
  assert.notEqual(rc.j.rec, C.rec);
  for (const k of [C.key, C.key2]) assert.deepEqual([(await as(k)('GET', '/api/medic/me')).s, (await as(k)('GET', '/api/medic/me')).j.gone], [403, true], 'anciens appareils coupés');
  const me = await as(rc.j.key)('GET', '/api/medic/me');
  assert.equal(me.s, 200); assert.ok(me.j.recAt > Date.now() - 5000, 'récupération visible des appareils de l’équipe');
  assert.equal((await req('POST', '/api/recover', { code: C.rec })).s, 404, 'ancien code inutilisable');
  // Sans couper : l'appareil s'ajoute, l'ancien reste
  const keep = await req('POST', '/api/recover', { code: rc.j.rec, cut: false });
  assert.equal(keep.s, 200);
  assert.equal((await as(rc.j.key)('GET', '/api/medic/me')).s, 200); assert.equal((await as(keep.j.key)('GET', '/api/medic/me')).j.devices, 2);
  // Nouveau code à la demande : le précédent ne sert plus
  const fresh = await as(keep.j.key)('POST', '/api/medic/recovery', {});
  assert.equal((await req('POST', '/api/recover', { code: keep.j.rec })).s, 404);
  assert.equal((await req('POST', '/api/recover', { code: fresh.j.rec })).s, 200);

  // Orga : même mécanique
  const O = await orga('Collectif Secours');
  assert.match(O.rec, /^(\w{4}-){4}\w{4}$/);
  const om = (await O.call('GET', '/api/orga/me')).j;
  assert.deepEqual([om.rec, om.recAt, om.warn], [true, null, false]);
  const or = await req('POST', '/api/recover', { code: O.rec });
  assert.deepEqual([or.s, or.j.medic, or.j.label], [200, undefined, 'Collectif Secours']);
  const gone = await O.call('GET', '/api/orga/me');
  assert.deepEqual([gone.s, gone.j.gone], [403, true]);
  assert.equal((await asOrga(or.j.key)('GET', '/api/orga/me')).j.label, 'Collectif Secours');
  // Réinvitation par l'admin : le code de secours est coupé avec l'accès
  await adm('POST', `/api/admin/orgas/${O.id}/invite`, {});
  assert.equal((await req('POST', '/api/recover', { code: or.j.rec })).s, 404);
  // Journal : l'action est tracée, jamais le code
  const j = await fetch(B + '/api/admin/journal', { headers: { 'x-admin-key': ADMIN } }).then(r => r.text());
  assert.ok(j.includes('accès récupéré (code de secours)')); assert.ok(!j.includes(or.j.rec) && !j.includes(O.rec));
});

test('medic : appareils d’une équipe, listés et retirés par l’équipe ou sa référente', async () => {
  const inv = await A.call('POST', '/api/medic/teams', { label: 'Binôme Écho' });
  const first = await req('POST', '/api/invite', { token: inv.j.invite });
  const ua = (key, kind) => (m, p, body) => req(m, p, body, { 'x-medic-key': key, 'user-agent': kind });
  const E = ua(first.j.key, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  const add = async () => { const d = await E('POST', '/api/medic/device', {}); return (await req('POST', '/api/invite', { token: d.j.invite })).j.key; };
  const k2 = await add(), k3 = await add();
  const E2 = ua(k2, 'Mozilla/5.0 (Linux; Android 14; Pixel 8)'), E3 = ua(k3, 'Mozilla/5.0 (X11; Linux x86_64)');
  assert.equal((await E2('GET', '/api/medic/me')).s, 200); await E3('GET', '/api/medic/me');
  const l = (await E('GET', '/api/medic/devices')).j.devices;
  assert.equal(l.length, 3);
  assert.deepEqual(l.map(d => [d.kind, d.me, d.first]), [['iPhone', true, true], ['Android', false, false], ['Linux', false, false]]);
  assert.ok(l.every(d => /^[\w-]{12}$/.test(d.id) && d.since > Date.now() - 60_000 && d.active), 'date d’arrivée et activité');
  assert.ok(!JSON.stringify(l).includes('Pixel'), 'jamais le modèle');
  // Pas soi-même, pas un appareil d'une autre équipe
  assert.equal((await E('DELETE', '/api/medic/devices/' + l[0].id, {})).s, 400);
  assert.equal((await A.call('DELETE', '/api/medic/devices/' + l[1].id, {})).s, 404);
  // L'équipe retire son appareil Android : sa clé ne vaut plus rien, il l'oublie
  assert.equal((await E('DELETE', '/api/medic/devices/' + l[1].id, {})).s, 200);
  const gone = await E2('GET', '/api/medic/state');
  assert.deepEqual([gone.s, gone.j.gone], [403, true]);
  assert.equal((await E('GET', '/api/medic/me')).j.devices, 2);
  // La référente voit et retire les appareils des équipes qu'elle a fait entrer, pas des autres
  assert.equal((await A.call('GET', `/api/medic/teams/${Bq.id}/devices`)).s, 404);
  const rl = (await A.call('GET', `/api/medic/teams/${inv.j.id}/devices`)).j.devices;
  assert.deepEqual(rl.map(d => [d.kind, d.me]), [['iPhone', false], ['Linux', false]]);
  // Appareil principal retiré : l'autre prend sa place et garde l'accès
  assert.equal((await A.call('DELETE', `/api/medic/teams/${inv.j.id}/devices/${rl[0].id}`, {})).s, 200);
  assert.equal((await E('GET', '/api/medic/me')).s, 403);
  assert.equal((await E3('GET', '/api/medic/me')).s, 200);
  // Jamais le dernier : pour couper l'équipe, on la réinvite
  const last = (await A.call('GET', `/api/medic/teams/${inv.j.id}/devices`)).j.devices;
  assert.deepEqual(last.map(d => d.first), [true]);
  assert.equal((await A.call('DELETE', `/api/medic/teams/${inv.j.id}/devices/${last[0].id}`, {})).s, 400);
});

test('accès : une clé valable n’est jamais perdue pour un refus ou un verrouillage du réseau', async () => {
  const O = await orga('Collectif Verrou'), net = { 'x-forwarded-for': '83.7.7.7' };
  // Action interdite (orga en essai) : 403 sans « gone », le téléphone garde sa clé
  const no = await O.call('POST', '/api/announcements', { kind: 'info', text: 'Essai', ...P, radiusKm: 1, minutes: 30 });
  assert.deepEqual([no.s, no.j.gone], [403, undefined]);
  // Dix mauvaises clés depuis le même réseau (une foule derrière la même adresse d'opérateur)
  for (let i = 0; i < 11; i++) await req('GET', '/api/orga/me', undefined, { ...net, 'x-orga-key': 'fausse-cle-' + i });
  const bad = await req('GET', '/api/orga/me', undefined, { ...net, 'x-orga-key': 'encore-une-fausse' });
  assert.deepEqual([bad.s, bad.j.gone], [429, undefined], 'réseau verrouillé : « réessaie », sans faire oublier la clé');
  assert.equal((await req('GET', '/api/orga/me', undefined, { ...net, 'x-orga-key': O.key })).s, 200, 'la vraie clé orga passe quand même');
  assert.equal((await req('GET', '/api/medic/me', undefined, { ...net, 'x-medic-key': A.key })).s, 200, 'la vraie clé medic aussi');
  assert.equal((await req('GET', '/api/admin/medics', undefined, { ...net, 'x-admin-key': ADMIN })).s, 403, 'la clé admin reste verrouillée');
  // Clé inconnue hors verrouillage : 403 avec « gone »
  const un = await req('GET', '/api/orga/me', undefined, { 'x-orga-key': 'cle-inconnue' });
  assert.deepEqual([un.s, un.j.gone], [403, true]);
});

test('public : type « Contrôle / barrage filtrant » pour tout le monde, sans effet sur les zones calmes', async () => {
  const cfg = await fetch(B + '/api/config').then(r => r.json());
  const c = cfg.categories.find(x => x.id === 'filtrage');
  assert.deepEqual([c.group, c.glyph], ['info', '🛂']);
  const calm = await req('POST', '/api/reports', { cat: 'calme', lat: 44.2, lng: 4.2 });
  assert.equal(calm.s, 201);
  assert.equal((await req('POST', '/api/reports', { cat: 'filtrage', lat: 44.2002, lng: 4.2 })).s, 201);
  assert.equal((await req('POST', '/api/reports', { cat: 'calme', lat: 44.2004, lng: 4.2002 })).s, 200, 'une zone calme reste possible à côté (fusion)');
});

test('medic : urgence vitale, équipes prévenues dans le rayon ; la couche disparaît au redémarrage et à l’effacement d’urgence', async () => {
  const key = () => ({ p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
  assert.equal((await Bq.call('POST', '/api/medic/push', { sub: { endpoint: 'https://exemple.org/x', keys: key() } })).s, 400);
  assert.equal((await Bq.call('POST', '/api/medic/push', { sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/medic-' + Date.now(), keys: key() }, ...P, lang: 'fr' })).s, 200);
  assert.equal((await adm('POST', '/api/admin/medics/config', { radiusKm: 99 })).s, 400);
  assert.equal((await adm('POST', '/api/admin/medics/config', { radiusKm: 3 })).j.radiusKm, 3);
  assert.equal((await A.call('GET', '/api/medic/me')).j.radiusKm, 3);
  assert.equal((await A.call('POST', '/api/medic/items', { k: 'help', lvl: 'vital', ...P })).s, 201);
  assert.ok((await A.call('GET', '/api/medic/state')).j.items.length > 0);
  // Effacement d'urgence
  assert.equal((await adm('POST', '/api/admin/wipe', { confirm: 'EFFACER' })).s, 200);
  assert.deepEqual((await A.call('GET', '/api/medic/state')).j.items, []);
  // Redémarrage : les équipes restent (medics.json), la carte medic repart vide
  await A.call('POST', '/api/medic/items', { k: 'hot', ...P });
  await stop(srv); await start();
  const s = await A.call('GET', '/api/medic/state');
  assert.equal(s.s, 200); assert.deepEqual(s.j.items, []);
  assert.equal((await adm('GET', '/api/admin/medics')).j.cfg.radiusKm, 3);
  // Équipe retirée par l'admin : sa clé ne vaut plus rien
  assert.equal((await adm('DELETE', '/api/admin/medics/' + Bq.id)).s, 200);
  assert.deepEqual([(await Bq.call('GET', '/api/medic/me')).s, (await Bq.call('GET', '/api/medic/me')).j.gone], [403, true]);
});

test('medic : un appareil qui n’a plus accès ne reçoit plus les urgences', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-medic-d-'));
  process.env.DATA_DIR = dir;
  delete require.cache[require.resolve('../src/medic')];
  const M = require('../src/medic');
  const k = () => ({ p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
  M.writeMedics([{ id: 'eq', label: 'Équipe', hash: 'H1', keys: ['H2'] }, { id: 'autre', label: 'Autre', hash: 'H9', keys: [] }]);
  for (const h of ['H1', 'H2']) M.subscribe({ id: 'eq', h }, { sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/' + h, keys: k() }, ...P });
  assert.equal(M.vitalTargets({ tid: 'autre', ...P }).length, 2);
  M.writeMedics([{ id: 'eq', label: 'Équipe', hash: 'H1', keys: [] }, { id: 'autre', label: 'Autre', hash: 'H9', keys: [] }]);
  assert.deepEqual(M.vitalTargets({ tid: 'autre', ...P }).map(x => x.s.h), ['H1'], 'H2 coupé : plus de notification');
  M.wipe();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('medic : choix des équipes prévenues (rayon, position partagée, zone inconnue)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-medic-u-'));
  process.env.DATA_DIR = dir;
  const M = require('../src/medic');
  const k = () => ({ p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
  const sub = (id, pos) => M.subscribe({ id }, { sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/' + id, keys: k() }, ...(pos || {}) });
  sub('demandeuse', P); sub('proche', { lat: P.lat + 0.005, lng: P.lng }); sub('loin', { lat: P.lat + 0.5, lng: P.lng }); sub('inconnue');
  sub('partage', { lat: P.lat + 0.5, lng: P.lng });
  M.posSet({ id: 'partage', label: 'Partage' }, { lat: P.lat + 0.002, lng: P.lng, start: true }); // loin d'après l'abonnement, tout près d'après sa position
  const got = M.vitalTargets({ tid: 'demandeuse', lat: P.lat, lng: P.lng }).map(x => x.tid).sort();
  assert.deepEqual(got, ['inconnue', 'partage', 'proche']);
  M.wipe();
  fs.rmSync(dir, { recursive: true, force: true });
});
