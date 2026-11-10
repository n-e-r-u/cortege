'use strict';
// Veille des arrêtés : faux site de préfecture (page HTML et flux RSS), jamais les vrais sites.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ADMIN = 'admin-key-for-tests-123';
let srv, B, F, DIR, fake, page = 1, pref = 1;
const Y = new Date().getFullYear(), MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'][new Date().getMonth()];
const PDF = fs.readFileSync(path.join(__dirname, 'fixture-raa.pdf'));
// Faux site de préfecture : accueil, actualités, communiqués par année, recueil des actes par année puis par mois
const P = '/pref';
const menu = `<nav><a href="${P}/Actualites/Infos">Infos</a><a href="${P}/Publications/Espace-presse/Communiques-de-presse">Communiqués de presse</a>
<a href="${P}/Publications/Recueil-des-actes-administratifs">Recueil des actes administratifs</a><a href="${P}/Demarches/Manifestations-sportives">Manifestations sportives</a></nav>`;
const PREF = {
  [P + '/']: () => menu + '<a href="' + P + '/Actualites/Infos/Vigilance-pluie">Vigilance pluie</a>',
  [P + '/Actualites/Infos']: () => menu + (pref >= 2 ? `<a href="${P}/Actualites/Infos/Arrete-portant-mesures-de-police">Arrêté portant mesures de police pour la manifestation de samedi</a>` : ''),
  [P + '/Publications/Espace-presse/Communiques-de-presse']: () => menu + `<a href="${P}/Publications/Espace-presse/Communiques-de-presse/Annee-${Y}">Année ${Y}</a><a href="${P}/Publications/Espace-presse/Communiques-de-presse/Annee-${Y - 1}">Année ${Y - 1}</a>`,
  [`${P}/Publications/Espace-presse/Communiques-de-presse/Annee-${Y}`]: () => menu + '<a href="' + P + '/contenu/telechargement/1/1/file/cp-foire.pdf">Foire aux vins</a>',
  [P + '/Publications/Recueil-des-actes-administratifs']: () => menu + `<a href="${P}/Publications/Recueil-des-actes-administratifs/RAA-${Y}">Recueils de ${Y}</a>`,
  [`${P}/Publications/Recueil-des-actes-administratifs/RAA-${Y}`]: () => menu + `<a href="${P}/Publications/Recueil-des-actes-administratifs/RAA-${Y}/${MOIS}">Recueils de ${MOIS}</a>`,
  [`${P}/Publications/Recueil-des-actes-administratifs/RAA-${Y}/${MOIS}`]: () => menu + '<a href="' + P + '/contenu/telechargement/9/9/file/raa-1.pdf">Recueil spécial n° 1</a>'
    + (pref >= 2 ? '<a href="' + P + '/contenu/telechargement/9/10/file/raa-2.pdf">Télécharger Recueil spécial n° 2 PDF - 0,1 Mb</a>' : ''),
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const PAGE = n => `<!doctype html><html><head><meta charset="utf-8"><script>var a = '<a href="/piege">manifestation</a>';</script></head><body>
<a href="/Actualites/Fete-de-la-musique">Fête de la musique : programme</a>
<a href="/Publications/RAA/raa-2026-201.pdf">Recueil des actes administratifs n° 201</a>
${n >= 2 ? `<a href="/Actualites/Arrete-portant-interdiction-de-manifester">Arrêté portant interdiction de manifester le samedi 14 novembre</a>
<a href='/Actualites/peche'>Arrêté portant interdiction de pêche dans l’Hérault</a>
<a href="/Actualites/drones" title="Captation d’images par drones lors de la manifestation">Arrêté n° 2026-11-77</a>
<a href="https://autre.example/Arrete-mesures-de-police-et-interdiction">Arrêté portant mesures de police et interdiction de circuler</a>` : ''}
</body></html>`;
const RSS = n => `<?xml version="1.0"?><rss version="2.0"><channel><title>Préfecture</title>
<item><title>Vaccination grippe</title><link>https://pref.example/vaccin</link></item>
${n >= 2 ? '<item><title><![CDATA[Périmètre de protection autour du sommet]]></title><link>https://pref.example/perimetre</link><description>Zone interdite.</description></item>' : ''}
</channel></rss>`;

before(async () => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-veille-'));
  fake = http.createServer((req, res) => {
    if (req.url === '/rss') { res.setHeader('content-type', 'application/rss+xml'); return res.end(RSS(page)); }
    if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(PAGE(page)); }
    const u = decodeURIComponent(req.url);
    if (PREF[u]) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<html><body>' + PREF[u]() + '</body></html>'); }
    if (u.endsWith('raa-2.pdf')) { res.setHeader('content-type', 'application/pdf'); return res.end(PDF); }
    res.statusCode = 404; res.end('non');
  }).listen(0);
  await new Promise(r => fake.on('listening', r));
  F = 'http://127.0.0.1:' + fake.address().port;
  const port = 20000 + Math.floor(Math.random() * 20000);
  B = 'http://127.0.0.1:' + port;
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR + '/d', LIVE_DIR: DIR + '/l', TILE_DIR: DIR + '/t', ADMIN_KEY: ADMIN, IMPORT_17OCT: '0', PLACES_IMPORT: '0', VEILLE_TICK_MS: '3600000' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(100); }
});
after(() => { srv.kill(); fake.close(); fs.rmSync(DIR, { recursive: true, force: true }); });
const req = (m, p, body, key = ADMIN) => fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: body && JSON.stringify(body) })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));

test('veille : admin seulement, adresse vérifiée, première lecture sans alerte', async () => {
  assert.equal((await req('GET', '/api/admin/veille', null, 'mauvaise')).s, 403);
  assert.equal((await req('POST', '/api/admin/veille/sources', { url: 'javascript:alert(1)', dep: '34' })).s, 400);
  assert.equal((await req('POST', '/api/admin/veille/sources', { url: F + '/', dep: '9999' })).s, 400);
  const a = await req('POST', '/api/admin/veille/sources', { url: F + '/', dep: '34', label: 'accueil' });
  assert.equal(a.s, 201); assert.equal(a.j.n, 2, 'deux liens lus (pas celui du script)'); assert.equal(a.j.ok, true);
  const r = await req('POST', '/api/admin/veille/sources', { url: F + '/rss', dep: '34', label: 'flux' });
  assert.equal(r.j.n, 1);
  assert.equal((await req('POST', '/api/admin/veille/sources', { url: F + '/', dep: '34' })).s, 409);
  assert.equal((await req('GET', '/api/admin/veille')).j.hits.length, 0, 'rien de signalé à la première lecture');
});

test('veille : seuls les nouveaux liens qui parlent de manifestation, périmètre, drones… sont signalés', async () => {
  page = 2;
  const d = (await req('GET', '/api/admin/veille')).j;
  for (const s of d.sources) await req('POST', `/api/admin/veille/sources/${s.id}/test`, {});
  const hits = (await req('GET', '/api/admin/veille')).j.hits, titles = hits.map(h => h.title).sort();
  assert.deepEqual(titles, ['Arrêté n° 2026-11-77', 'Arrêté portant interdiction de manifester le samedi 14 novembre', 'Arrêté portant mesures de police et interdiction de circuler', 'Périmètre de protection autour du sommet'].sort());
  assert.ok(!titles.some(x => /pêche/.test(x)), 'interdiction de pêche : thème trop large seul, pas signalé');
  const m = hits.find(h => /manifester/.test(h.title));
  assert.equal(m.url, F + '/Actualites/Arrete-portant-interdiction-de-manifester'); assert.equal(m.dep, '34'); assert.match(m.kw, /manifestation/);
  // Relu une seconde fois : rien de neuf
  for (const s of d.sources) await req('POST', `/api/admin/veille/sources/${s.id}/test`, {});
  assert.equal((await req('GET', '/api/admin/veille')).j.hits.length, 4);
  // Traité : sort de la liste
  assert.equal((await req('POST', '/api/admin/veille/hits/' + m.id, { status: 'done' })).s, 200);
  const after2 = (await req('GET', '/api/admin/veille')).j;
  assert.equal(after2.hits.length, 3); assert.equal(after2.done[0].id, m.id);
  // Compté dans la pastille Arrêtés de l'admin
  assert.equal((await req('GET', '/api/admin/reports')).j.ordersPending, 3);
});

test('veille : page injoignable notée, source retirée', async () => {
  const a = await req('POST', '/api/admin/veille/sources', { url: F + '/introuvable', dep: '30' });
  assert.equal(a.s, 201); assert.equal(a.j.ok, false); assert.match(a.j.error, /404/);
  assert.equal((await req('DELETE', '/api/admin/veille/sources/' + a.j.id)).s, 200);
  assert.ok(!(await req('GET', '/api/admin/veille')).j.sources.some(s => s.id === a.j.id));
});

test('veille : site de préfecture entier, pages repérées toutes seules, recueil PDF lu', async () => {
  const a = await req('POST', '/api/admin/veille/sources', { url: F + P + '/', dep: '34', kind: 'pref' });
  assert.equal(a.s, 201); assert.equal(a.j.kind, 'pref');
  assert.equal(a.j.pages, 7, 'accueil, actualités, communiqués, année, recueil, année, mois');
  assert.equal((await req('GET', '/api/admin/veille')).j.hits.filter(h => h.src === a.j.id).length, 0, 'première lecture : rien');
  pref = 2;
  await req('POST', `/api/admin/veille/sources/${a.j.id}/test`, {});
  let d = (await req('GET', '/api/admin/veille')).j;
  const mine = d.hits.filter(h => h.src === a.j.id);
  assert.deepEqual(mine.map(h => h.title), ['Arrêté portant mesures de police pour la manifestation de samedi'], 'titre clair : signalé ; recueil au titre vague : pas par son titre');
  assert.equal(d.pdf, true, 'pdftotext présent dans l’environnement de test');
  // Le recueil est lu au tour suivant de la veille : il contient une interdiction de manifester
  await req('POST', '/api/admin/veille/run', {});
  d = (await req('GET', '/api/admin/veille')).j;
  const raa = d.hits.find(h => h.url.endsWith('raa-2.pdf'));
  assert.ok(raa, 'recueil repéré par son texte');
  assert.match(raa.title, /^Télécharger Recueil spécial n° 2.*interdiction de manifester le samedi 14 novembre/);
});
