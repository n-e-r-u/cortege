'use strict';
// Activité agrégée par région : rattachement d'un point à sa région, seuil de discrétion, aucune position en sortie.
const test = require('node:test');
const assert = require('node:assert');
const { regionOf, regionCounts, regionName } = require('../src/geo/regions');

test('région d’un point : Montpellier, Paris, Rennes, Ajaccio, et rien hors de France', () => {
  assert.equal(regionOf(43.6108, 3.8767), 'OCC');
  assert.equal(regionOf(48.8566, 2.3522), 'IDF');
  assert.equal(regionOf(48.1173, -1.6778), 'BRE');
  assert.equal(regionOf(41.9192, 8.7386), 'COR');
  assert.equal(regionOf(43.2965, 5.3698), 'PAC');   // Marseille, Vieux-Port : littoral
  assert.equal(regionOf(52.52, 13.405), null);
  assert.equal(regionOf(41.3851, 2.1734), null);    // Barcelone
  assert.equal(regionName('OCC'), 'Occitanie');
});

test('compte par région : seuil de cinq, tri décroissant, aucune position dans le résultat', () => {
  const pt = (lat, lng, n) => Array.from({ length: n }, (_, i) => ({ lat: lat + i * 1e-4, lng }));
  const out = regionCounts([...pt(43.6108, 3.8767, 7), ...pt(48.8566, 2.3522, 12), ...pt(48.1173, -1.6778, 4), ...pt(52.52, 13.405, 9)]);
  assert.deepEqual(out, [{ code: 'IDF', name: 'Île-de-France', active: 12 }, { code: 'OCC', name: 'Occitanie', active: 7 }]);
  assert.ok(!JSON.stringify(out).includes('lat'));
});
