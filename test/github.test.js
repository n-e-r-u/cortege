'use strict';
// Tickets GitHub des idées : faux serveur de l'API GitHub, jamais le vrai.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ADMIN = 'admin-key-for-tests-123', SECRET = 'hook-secret-test';
const ROOT = path.join(__dirname, '..');
let srv, B, DIR, fake, calls = [], issues = {}, next = 1;
const wait = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-gh-'));
  fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      calls.push({ m: req.method, p: req.url, h: req.headers, body });
      const ok = (j, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j)); };
      if (req.headers.authorization !== 'Bearer gh-tok') return ok({ message: 'Bad credentials' }, 401);
      const P = '/repos/compte/depot/issues';
      if (req.method === 'POST' && req.url === P) { const n = next++; issues[n] = { number: n, state: 'open', labels: body.labels || [], ...body }; return ok(issues[n], 201); }
      let m = req.url.match(/^\/repos\/compte\/depot\/issues\/(\d+)(\/labels(?:\/(.+))?|\/comments)?$/);
      if (m && issues[m[1]]) {
        const i = issues[m[1]];
        if (req.method === 'PATCH' && !m[2]) { Object.assign(i, body); return ok(i); }
        if (req.method === 'POST' && m[2] === '/comments') { (i.comments ||= []).push(body.body); return ok({ id: 1 }, 201); }
        if (req.method === 'POST' && m[2] === '/labels') { i.labels = [...new Set([...i.labels, ...body.labels])]; return ok(i.labels); }
        if (req.method === 'DELETE' && m[3]) { i.labels = i.labels.filter(l => l !== decodeURIComponent(m[3])); return ok(i.labels); }
      }
      ok({ message: 'Not Found' }, 404);
    });
  }).listen(0);
  await new Promise(r => fake.on('listening', r));
  const port = 20000 + Math.floor(Math.random() * 20000);
  B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, TRUST_PROXY: '1', IMPORT_17OCT: '0', PLACES_IMPORT: '0',
      SOCIAL: '0', PUBLIC_URL: 'https://cortege.example', GITHUB_TOKEN: 'gh-tok', GITHUB_REPO: 'compte/depot', GITHUB_API: 'http://127.0.0.1:' + fake.address().port,
      GITHUB_WEBHOOK_SECRET: SECRET, GITHUB_GAP_MS: '10', GITHUB_FIRST_MS: '200', GITHUB_TICK_MS: '400' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
});
after(() => { srv.kill(); fake.close(); fs.rmSync(DIR, { recursive: true, force: true }); });

const req = (m, p, body, h = {}) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN, 'x-forwarded-for': '81.2.2.2', 'x-device': 'dev-github-test-xxxxxxxx', ...h }, body: body && JSON.stringify(body) })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
async function until(fn, ms = 6000) { for (let t = 0; t < ms; t += 100) { const v = await fn(); if (v) return v; await wait(100); } return null; }
const ideas = () => req('GET', '/api/admin/ideas').then(r => r.j);
const byTitle = async t => (await ideas()).ideas.find(i => i.title === t);
const hook = (ev, p, sig) => { const raw = JSON.stringify(p);
  return fetch(B + '/api/github/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': ev,
    'x-hub-signature-256': sig || 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex') }, body: raw }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) })); };

test('GitHub : une idée à valider n\'a pas de ticket, publiée elle en a un, tenu à jour et fermé', async () => {
  assert.equal((await req('POST', '/api/ideas', { title: 'Carte des fontaines à eau', body: 'Pour @quelquun et le ticket #3', lang: 'fr' })).s, 201);
  assert.equal((await req('POST', '/api/ideas', { title: 'Doublon des fontaines à eau', body: '', lang: 'fr' })).s, 201);
  await wait(700);
  assert.equal(Object.keys(issues).length, 0, 'rien tant que l\'idée est à valider');
  const d = await ideas();
  assert.deepEqual([d.github.ready, d.github.repo, d.github.hook], [true, 'compte/depot', true]);
  assert.ok(!JSON.stringify(d).includes('gh-tok') && !JSON.stringify(d).includes(SECRET), 'aucun secret renvoyé');
  const a = await byTitle('Carte des fontaines à eau'), b = await byTitle('Doublon des fontaines à eau');
  await req('POST', '/api/admin/ideas/' + a.id, { status: 'proposed' });
  await req('POST', '/api/admin/ideas/' + b.id, { status: 'proposed' });
  const ia = await until(() => Object.values(issues).find(i => i.title === a.title));
  assert.ok(ia, 'ticket créé');
  assert.deepEqual(ia.labels, ['idée-cortège', 'proposée']);
  assert.match(ia.body, /^Idée proposée dans Cortège \(langue : FR\)\./);
  assert.ok(ia.body.includes('https://cortege.example/?idee=' + a.id));
  assert.ok(ia.body.includes('@​quelquun') && ia.body.includes('#​3'), 'ni mention ni référence');
  assert.equal(calls[0].h['x-github-api-version'], '2022-11-28');
  assert.equal((await until(async () => (await byTitle(a.title)).gh)), ia.number, 'numéro visible dans l\'admin');
  // Vote : compté au tour suivant
  await req('POST', `/api/ideas/${a.id}/vote`, { v: 1 });
  assert.ok(await until(() => ia.body.includes('👍 1 · 👎 0')), 'votes mis à jour');
  // Prévue puis faite : étiquette changée, ticket fermé avec la version
  await req('POST', '/api/admin/ideas/' + a.id, { status: 'planned', version: '2.18' });
  assert.ok(await until(() => ia.labels.includes('prévue') && !ia.labels.includes('proposée') && ia.body.includes('Prévue (version 2.18)')));
  await req('POST', '/api/admin/ideas/' + a.id, { status: 'done', reply: 'Merci !' });
  assert.ok(await until(() => ia.state === 'closed'));
  assert.equal(ia.state_reason, 'completed');
  assert.deepEqual(ia.comments, ['✅ Idée réalisée dans la version 2.18.\n\nMerci !']);
  // Doublon fusionné : fermé, avec le numéro du ticket gardé
  const ib = Object.values(issues).find(i => i.title === b.title);
  await req('POST', `/api/admin/ideas/${b.id}/merge`, { into: a.id });
  assert.ok(await until(() => ib.state === 'closed'));
  assert.equal(ib.state_reason, 'not_planned'); assert.equal(ib.comments[0], `Fusionnée avec #${ia.number} : les votes y sont regroupés.`);
  await wait(900);
  assert.equal(ia.comments.length, 1, 'commentaire de fermeture une seule fois');
  assert.equal(Object.keys(issues).length, 2, 'jamais deux tickets pour une idée');
});

test('GitHub : webhook signé, ticket fermé ou rouvert sur GitHub repris dans Cortège', async () => {
  await req('POST', '/api/ideas', { title: 'Mode sombre plus contrasté', lang: 'fr' });
  const c = await byTitle('Mode sombre plus contrasté');
  await req('POST', '/api/admin/ideas/' + c.id, { status: 'study' });
  const ic = await until(() => Object.values(issues).find(i => i.title === c.title));
  const p = action => ({ action, repository: { full_name: 'compte/depot' }, issue: { number: ic.number, state_reason: action === 'closed' ? 'not_planned' : null } });
  assert.equal((await hook('issues', p('closed'), 'sha256=' + '0'.repeat(64))).s, 401, 'signature vérifiée');
  assert.equal((await hook('ping', { zen: 'x' })).s, 200);
  ic.state = 'closed'; ic.state_reason = 'not_planned';
  const r = await hook('issues', p('closed'));
  assert.equal(r.j.status, 'no');
  assert.equal((await byTitle(c.title)).status, 'no');
  assert.ok(await until(() => ic.labels.includes('pas retenue')));
  assert.equal(ic.comments, undefined, 'pas de commentaire ajouté : la fermeture vient de GitHub');
  ic.state = 'open';
  assert.equal((await hook('issues', p('reopened'))).j.status, 'study');
  assert.equal((await byTitle(c.title)).status, 'study');
  assert.equal((await hook('issues', { ...p('closed'), repository: { full_name: 'autre/depot' } })).j.ignored, true, 'autre dépôt ignoré');
});

test('GitHub : idée supprimée, ticket fermé et vidé', async () => {
  const c = await byTitle('Mode sombre plus contrasté');
  const ic = Object.values(issues).find(i => i.title === c.title);
  assert.equal((await req('DELETE', '/api/admin/ideas/' + c.id)).s, 200);
  assert.ok(await until(() => ic.title === 'Idée retirée' && ic.state === 'closed'));
  assert.ok(!ic.body.includes('contrasté'));
});
