'use strict';
// Import d'un agenda partenaire : correspondance des types, fenêtre de dates, mises à jour et retraits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cortege-import-'));
const { parseFeed, apply, evType } = require('../src/events/import');
const { listEvents, dropEvent } = require('../src/events/store');
const { q } = require('../src/db');
const { parisMs } = require('../src/time');

const CFG = { base: 'https://exemple.org', days: 14, label: 'exemple.org' };
const NOW = parisMs('2026-11-26', '09:00');
const jour = n => new Date(NOW + n * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

// Format du site partenaire : des tableaux positionnels, joints par l'identifiant du lieu
const DATA = () => ({
  lieux: { lieux: [
    [1, 'manif', 43.6108, 3.8767, 'Place de la Comédie', '', 'Montpellier', '34000', '34', '14:00', 0, 0],
    [2, 'lycee', 43.6000, 3.8800, 'Lycée Jean-Monnet', '', 'Montpellier', '34000', '34', '08:00', 0, 0],
    [3, 'rondpoint', 43.5900, 3.8500, 'Rond-point du Lez', '', 'Lattes', '34970', '34', '07:00', 0, 0],
    [4, 'manif', 48.8674, 2.3636, '', '', 'Paris', '75011', '75', '10:00', 0, 0],
    [5, 'manif', 51.5074, -0.1278, 'Trafalgar', '', 'Londres', '', '', '12:00', 0, 0],
  ] },
  sites: { maj: '2026-09-15', lieux: [[6, 'raffinerie', 49.48804, 0.2383, 'Raffinerie de Normandie', 'TotalEnergies', "Gonfreville-l'Orcher", '76700', '76']] },
  actions: { actions: {
    1: [['rassemblement', '14:00', jour(1)]],
    2: [['blocage', '08:00', jour(2)]],
    3: [['rond_point', '07:00', jour(1)]],                     // pas un type de Cortège
    4: [['rassemblement', '10:00', jour(3)]],                   // sans nom, mais avec une ville
    5: [['rassemblement', '12:00', jour(1)]],                   // hors des pays de l'instance
    6: [['blocage', '05:00', jour(4)]],
    7: [['rassemblement', '10:00', jour(1)]],                   // lieu inconnu (station-service)
    8: [['rassemblement', '10:00', jour(-30)], ['rassemblement', '10:00', jour(40)]], // trop vieux, trop loin
  } },
});

test('types : ronds-points écartés, lycée et raffinerie en blocus, lieu de manif en manif', () => {
  assert.equal(evType('rond_point', 'manif'), null);
  assert.equal(evType('blocage', 'lycee'), 'blocus');
  assert.equal(evType('blocage', 'raffinerie'), 'blocus');
  assert.equal(evType('rassemblement', 'manif'), 'rassemblement', 'on ne transforme pas un rassemblement en manif');
  assert.equal(evType('manif', 'manif'), 'manif');
  assert.equal(evType('rassemblement', 'gare'), 'blocus');
});

test('lecture : seuls les lieux connus, dans la zone et dans la fenêtre', () => {
  const list = parseFeed(DATA(), CFG, NOW);
  const types = list.map(e => e.type).sort();
  assert.deepEqual(types, ['blocus', 'blocus', 'rassemblement', 'rassemblement'], 'un par lieu retenu');
  assert.ok(!list.some(e => /Lez/.test(e.place)), 'rond-point écarté');
  assert.ok(!list.some(e => /Trafalgar/.test(e.place)), 'hors zone écarté');
  const paris = list.find(e => /Paris/.test(e.place));
  assert.ok(paris, 'un lieu sans nom passe grâce à sa ville');
  const com = list.find(e => /Comédie/.test(e.place));
  assert.equal(com.by, 'exemple.org'); assert.equal(com.src, 'feed');
  assert.equal(com.link, 'https://exemple.org/carte/');
  assert.equal(com.status, 'ok');
  assert.ok(!com.oid, 'aucune orga derrière');
  assert.equal(com.start, parisMs(jour(1), '14:00'), 'heure de Paris');
});

test('publication : relecture sans doublon, mise à jour, puis retrait de ce qui a disparu', () => {
  const r1 = apply(parseFeed(DATA(), CFG, NOW), NOW);
  assert.equal(r1.added, 4); assert.equal(r1.gone, 0);
  assert.equal(listEvents().filter(e => e.src === 'feed').length, 4);

  const r2 = apply(parseFeed(DATA(), CFG, NOW), NOW);
  assert.equal(r2.added, 0, 'rien de neuf à la relecture'); assert.equal(r2.kept, 4);
  assert.equal(listEvents().filter(e => e.src === 'feed').length, 4, 'toujours quatre');

  // L'heure change chez eux : l'événement est mis à jour, pas dupliqué
  const d = DATA(); d.lieux.lieux[0][9] = '15:00'; d.actions.actions[1] = [['rassemblement', '15:00', jour(1)]];
  const r3 = apply(parseFeed(d, CFG, NOW), NOW);
  assert.equal(listEvents().filter(e => e.src === 'feed').length, 4, 'pas de doublon');
  assert.equal(r3.added + r3.gone, 2, 'un ajouté, un retiré (l’heure fait partie de l’identité)');

  // Le lycée disparaît de leur carte : il part de l'agenda
  const d2 = DATA(); delete d2.actions.actions[2];
  const r4 = apply(parseFeed(d2, CFG, NOW), NOW);
  assert.ok(r4.gone >= 1, 'retiré avec la source');
  assert.ok(!listEvents().some(e => /Jean-Monnet/.test(e.place || '')), 'le lycée n’est plus là');
});

test('un événement masqué par l’admin ne revient pas', () => {
  for (const e of listEvents()) dropEvent(e.id);
  apply(parseFeed(DATA(), CFG, NOW), NOW);
  const one = listEvents().find(e => /Comédie/.test(e.place));
  assert.ok(one);
  // L'admin le retire : il passe en masqué, comme le fait la route de retrait
  q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(one.id, NOW + 864e5);
  dropEvent(one.id);
  apply(parseFeed(DATA(), CFG, NOW), NOW);
  assert.ok(!listEvents().some(e => e.id === one.id), 'toujours absent après une relecture');
  assert.equal(listEvents().filter(e => e.src === 'feed').length, 3);
});
