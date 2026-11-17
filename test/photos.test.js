'use strict';
// Photos jointes aux signalements (2.21) : envoi, métadonnées retirées, visibilité (vérifié ou fiable), signalement, retrait,
// choix de l'admin pour le bilan public, effacement au bout de 3 jours.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ADMIN = 'admin-key-for-tests-123';
const ROOT = path.join(__dirname, '..');
// Petite photo JPEG avec des métadonnées (marque et modèle du téléphone), comme une photo brute
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4QBIRXhpZgAATU0AKgAAAAgAAgEPAAIAAAARAAAAJgEQAAIAAAAHAAAAOAAAAABTZWNyZXRQaG9uZU1ha2VyAABNb2RlbFgAAP/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIADAAQAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AIqKKK+PPvgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z', 'base64');
let srv, B, DIR, n = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const stop = p => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(); });
before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-photos-'));
  const port = 20000 + Math.floor(Math.random() * 20000); B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', PLACES_IMPORT: '0', SOCIAL: '0', GITHUB_SYNC: '0', FLUSH_MS: '150', MEDIC_PUSH: '0', ORGA_REMIND: '0' } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
});
after(async () => { await stop(srv); fs.rmSync(DIR, { recursive: true, force: true }); });

const hdr = (h = {}) => ({ 'content-type': 'application/json', 'x-forwarded-for': '83.2.' + (++n % 250) + '.' + (n % 199), 'x-device': 'dev-photo-test-' + String(n).padStart(6, '0'), ...h });
const req = (m, p, body, h) => fetch(B + p, { method: m, headers: hdr(h), body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const adm = (m, p, body) => req(m, p, body, { 'x-admin-key': ADMIN });
const send = (id, buf = JPEG, h = {}) => fetch(B + '/api/reports/' + id + '/photo', { method: 'POST', headers: { ...hdr(h), 'content-type': 'image/jpeg' }, body: buf }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
async function orga(label) {
  const o = await adm('POST', '/api/admin/orgas', { label });
  const r = await req('POST', '/api/invite', { token: o.j.invite });
  await adm('POST', `/api/admin/orgas/${o.j.id}/trial`, { trial: false });
  return { key: r.j.key, call: (m, p, body) => req(m, p, body, { 'x-orga-key': r.j.key }) };
}

test('photo : envoyée en JPEG, métadonnées retirées, cachée au public tant que le point n’est pas vérifié', async () => {
  const r = (await req('POST', '/api/reports', { cat: 'lacrymo', lat: 43.6108, lng: 3.8767 })).j;
  assert.equal((await fetch(B + '/api/reports/' + r.id + '/photo', { method: 'POST', headers: hdr(), body: '{}' })).status, 415, 'pas une photo');
  assert.equal((await fetch(B + '/api/reports/' + r.id + '/photo', { method: 'POST', headers: { ...hdr(), 'content-type': 'image/png' }, body: JPEG })).status, 415);
  assert.equal((await send(r.id, Buffer.from('pas une image du tout, juste du texte qui fait plus de deux cents octets pour passer le premier contrôle de taille minimale imposé par le serveur avant la lecture du fichier JPEG reçu par la route'))).s, 400);
  const up = await send(r.id);
  assert.equal(up.s, 201); assert.equal(up.j.p, 0, 'pas encore publique');
  const pub = await fetch(B + '/api/photos/' + up.j.id);
  assert.equal(pub.status, 403, 'le public ne la voit pas avant vérification');
  const o = await orga('Legal Team Photos');
  const seen = await fetch(B + '/api/photos/' + up.j.id, { headers: { 'x-orga-key': o.key } });
  assert.equal(seen.status, 200, 'une orga la voit');
  const buf = Buffer.from(await seen.arrayBuffer());
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);
  assert.ok(!buf.includes('SecretPhoneMaker'), 'marque du téléphone retirée par le serveur');
  // Une orga vérifie le point : la photo devient publique
  assert.equal((await o.call('POST', '/api/reports/' + r.id + '/verify', {})).s, 200);
  assert.equal((await fetch(B + '/api/photos/' + up.j.id)).status, 200, 'publique une fois le point vérifié');
  // Trois photos par point au plus
  assert.equal((await send(r.id)).s, 201); assert.equal((await send(r.id)).s, 201);
  assert.equal((await send(r.id)).s, 429);
  // Deux téléphones la signalent : cachée au public, l'orga la remet ou la retire
  assert.equal((await req('POST', '/api/photos/' + up.j.id + '/flag', {})).s, 200);
  assert.equal((await fetch(B + '/api/photos/' + up.j.id)).status, 200, 'un seul signalement ne suffit pas');
  assert.equal((await req('POST', '/api/photos/' + up.j.id + '/flag', {})).j.hidden, true);
  assert.equal((await fetch(B + '/api/photos/' + up.j.id)).status, 403, 'cachée au public');
  assert.equal((await req('POST', '/api/photos/' + up.j.id + '/restore', {})).s, 403, 'le public ne peut pas la remettre');
  assert.equal((await o.call('POST', '/api/photos/' + up.j.id + '/restore', {})).s, 200);
  assert.equal((await fetch(B + '/api/photos/' + up.j.id)).status, 200, 'remise');
  assert.equal((await o.call('POST', '/api/photos/' + up.j.id + '/remove', {})).s, 200);
  assert.equal((await fetch(B + '/api/photos/' + up.j.id, { headers: { 'x-orga-key': o.key } })).status, 404, 'retirée pour tout le monde');
  // Le fichier a bien disparu du disque
  assert.ok(!fs.existsSync(path.join(DIR, 'd', 'photos', up.j.id + '.jpg')));
});

test('photo : publique tout de suite si le point vient d’une orga ; l’admin la garde pour le bilan public', async () => {
  const o = await orga('Orga Bilan Photos');
  const r = (await o.call('POST', '/api/reports', { cat: 'medic', lat: 43.62, lng: 3.88 })).j;
  const up = await send(r.id);
  assert.equal(up.j.p, 1, 'point vérifié d’office : photo publique');
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const list = await adm('GET', '/api/admin/photos?date=' + day);
  assert.ok(list.j.photos.some(p => p.id === up.j.id), 'dans le digest de l’admin');
  assert.equal((await req('GET', '/api/admin/photos?date=' + day)).s, 403);
  assert.equal((await fetch(B + '/bilans/photo/' + up.j.id + '.jpg')).status, 404, 'pas encore sur le bilan');
  assert.equal((await adm('POST', '/api/admin/photos/' + up.j.id + '/keep', { keep: true })).s, 200);
  const k = await fetch(B + '/bilans/photo/' + up.j.id + '.jpg');
  assert.equal(k.status, 200); assert.equal(k.headers.get('content-type'), 'image/jpeg');
  assert.ok(fs.existsSync(path.join(DIR, 'd', 'bilan-photos', up.j.id + '.jpg')), 'rangée avec les bilans (sauvegardée)');
});

test('photo : effacée du disque et de la base au bout de 3 jours, sauf si elle est gardée pour un bilan', () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-photos-unit-'));
  const out = require('node:child_process').execFileSync(process.execPath, ['-e', `
    const P = require(${JSON.stringify(path.join(ROOT, 'src', 'photos.js'))}), { q } = require(${JSON.stringify(path.join(ROOT, 'src', 'db.js'))});
    const fs = require('fs'), path = require('path'), old = Date.now() - 3 * 86400000 - 60000;
    for (const [id, st] of [['vieillephoto', 'ok'], ['gardeebilan', 'kept'], ['recentephoto', 'ok']]) {
      q('INSERT INTO photos(id,rid,cat,lat,lng,t,day,st,flags,w,h,sz) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'r', 'eau', 0, 0, id === 'recentephoto' ? Date.now() : old, '2026-01-01', st, '[]', 1, 1, 1);
      fs.writeFileSync(path.join(process.env.DATA_DIR, st === 'kept' ? 'bilan-photos' : 'photos', id + '.jpg'), 'x');
    }
    fs.writeFileSync(path.join(process.env.DATA_DIR, 'photos', 'orpheline.jpg'), 'x');
    P.prunePhotos();
    console.log(JSON.stringify({ rows: q("SELECT id FROM photos WHERE st<>'gone' ORDER BY id").all().map(x => x.id),
      files: [...fs.readdirSync(path.join(process.env.DATA_DIR, 'photos')), ...fs.readdirSync(path.join(process.env.DATA_DIR, 'bilan-photos'))].sort() }));
  `], { env: { ...process.env, DATA_DIR: D, PHOTO_PRUNE: '0' } }).toString().trim().split('\n').pop();
  fs.rmSync(D, { recursive: true, force: true });
  const r = JSON.parse(out);
  assert.deepEqual(r.rows, ['gardeebilan', 'recentephoto']);
  assert.deepEqual(r.files, ['gardeebilan.jpg', 'recentephoto.jpg'], 'vieille photo et fichier orphelin effacés');
});
