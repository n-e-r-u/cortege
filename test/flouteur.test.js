'use strict';
// Flouteur : la logique partagée (public/flouter-lib.js), testée sans navigateur, et les fichiers du moteur livrés dans public/vendor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const F = require('../public/flouter-lib.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const MODEL_SHA256 = '3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b';

test('tuiles : couvrent chaque pixel, se recouvrent d’au moins 25 %, la dernière calée sur le bord', () => {
  for (const [length, size] of [[2048, 256], [2048, 512], [1365, 1024], [1000, 300], [257, 256]]) {
    const o = F.computeTileOrigins(length, size, 0.25);
    assert.equal(o[0], 0); assert.equal(o.at(-1) + size, length);
    for (let i = 1; i < o.length; i++) assert.ok((o[i - 1] + size - o[i]) / size >= 0.25, `${length}/${size}`);
  }
  assert.deepEqual(F.computeTileOrigins(400, 512, 0.25), [0], 'tuile plus grande que l’axe');
  const tiles = F.createTiles(1301, 877, 256, 0.25), covered = (x, y) => tiles.some(t => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height);
  for (let y = 0; y < 877; y += 7) for (let x = 0; x < 1301; x += 7) assert.ok(covered(x, y), `${x},${y}`);
  assert.ok(covered(1300, 876));
  for (const t of F.createTiles(2048, 300, 512, 0.25)) { assert.ok(t.x + t.width <= 2048); assert.equal(t.height, 300); }
  const d = F.createDetectionTiles(800, 600, F.DETECTION_SETTINGS.tileSizes, F.DETECTION_SETTINGS.overlapRatio);
  assert.deepEqual(d[0], { x: 0, y: 0, width: 800, height: 600 }, 'l’image entière d’abord');
  assert.deepEqual(new Set(d.slice(1).map(t => t.width)), new Set([512, 256]), 'seulement les tuiles plus petites que l’image');
  assert.equal(F.createDetectionTiles(2048, 1365, F.DETECTION_SETTINGS.tileSizes, F.DETECTION_SETTINGS.overlapRatio).length, 104);
});

test('fusion : un visage vu plusieurs fois devient un seul masque, deux visages voisins restent deux', () => {
  const S = F.DETECTION_SETTINGS;
  assert.deepEqual(F.mergeDetections([{ x: 100, y: 100, width: 50, height: 60, score: 0.9 }, { x: 104, y: 98, width: 52, height: 58, score: 0.7 }], S),
    [{ x: 100, y: 98, width: 56, height: 62, score: 0.9 }], 'union des deux boîtes');
  const inside = F.mergeDetections([{ x: 0, y: 0, width: 100, height: 100, score: 0.6 }, { x: 10, y: 10, width: 30, height: 30, score: 0.95 }], S);
  assert.deepEqual(inside, [{ x: 0, y: 0, width: 100, height: 100, score: 0.95 }], 'vu en tuile et en image entière');
  assert.equal(F.mergeDetections([{ x: 0, y: 0, width: 40, height: 40, score: 0.8 }, { x: 45, y: 0, width: 40, height: 40, score: 0.8 }], S).length, 2);
  const dup = Array.from({ length: 6 }, (_, i) => ({ x: 200 + i * 2, y: 300 - i, width: 40, height: 44, score: 0.5 + i / 20 }));
  assert.equal(F.mergeDetections(dup, S).length, 1, 'en cascade');
  const boxes = [{ x: 0, y: 0, width: 10, height: 10, score: 0.9 }, { x: 1, y: 1, width: 10, height: 10, score: 0.8 }], before = structuredClone(boxes);
  F.mergeDetections(boxes, S);
  assert.deepEqual(boxes, before, 'boîtes reçues intactes');
});

test('masques : agrandis de 40 % autour du visage, jamais hors de l’image ; pixellisation en gros blocs', () => {
  assert.equal(F.MASK_GROWTH_FACTOR, 1.4);
  const m = F.expandBox({ x: 100, y: 200, width: 50, height: 100 }, F.MASK_GROWTH_FACTOR, 1000, 1000);
  assert.ok(Math.abs(m.width - 70) < 1e-9 && Math.abs(m.height - 140) < 1e-9);
  assert.ok(Math.abs(m.x + m.width / 2 - 125) < 1e-9 && Math.abs(m.y + m.height / 2 - 250) < 1e-9, 'même centre');
  assert.deepEqual(F.expandBox({ x: 0, y: 0, width: 100, height: 100 }, 1.4, 500, 400), { x: 0, y: 0, width: 120, height: 120 });
  const br = F.expandBox({ x: 450, y: 350, width: 50, height: 50 }, 1.4, 500, 400);
  assert.ok(Math.abs(br.x + br.width - 500) < 1e-9 && Math.abs(br.y + br.height - 400) < 1e-9);
  assert.deepEqual(F.expandBox({ x: -10, y: -10, width: 300, height: 300 }, 1.4, 200, 100), { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(F.facesToMasks([{ x: 600, y: 600, width: 10, height: 10 }], 500, 400), [], 'boîte hors de l’image écartée');
  assert.deepEqual([60, 61, 3].map(F.pixelationBlockSize), [10, 11, 1], 'au plus 6 blocs de large');
});

test('pixellisation : bruit secret par photo, borné, stable d’un rendu à l’autre, alpha intact', () => {
  const a = F.createPixelationNoise(), b = F.createPixelationNoise();
  assert.ok(a.length >= 3 * 256 && !Buffer.from(a).equals(Buffer.from(b)), 'tiré au hasard pour chaque photo');
  const blocks = () => new Uint8ClampedArray([0, 128, 255, 200, 10, 20, 30, 255, 250, 128, 5, 0]);
  const noisy = F.addPixelationNoise(blocks(), a, 0), original = blocks();
  for (let i = 0; i < noisy.length; i++) {
    if (i % 4 === 3) { assert.equal(noisy[i], original[i], 'alpha'); continue; }
    assert.ok(Math.abs(noisy[i] - original[i]) <= F.PIXELATION_NOISE_AMPLITUDE, `canal ${i}`);
  }
  assert.deepEqual(F.addPixelationNoise(blocks(), a, 0), noisy, 'même bruit, mêmes blocs : l’aperçu est l’export');
  const zero = new Uint8Array(a.length), full = new Uint8Array(a.length).fill(255);
  assert.deepEqual([...F.addPixelationNoise(blocks(), zero, 0)].filter((_, i) => i % 4 !== 3), [0, 96, 223, 0, 0, 0, 218, 96, 0]);
  assert.deepEqual([...F.addPixelationNoise(blocks(), full, 0)].filter((_, i) => i % 4 !== 3), [32, 160, 255, 42, 52, 62, 255, 160, 37]);
  const offsets = mask => [...F.addPixelationNoise(new Uint8ClampedArray(4 * 8).fill(128), a, mask)];
  assert.notDeepEqual(offsets(0), offsets(1), 'chaque masque a son propre bruit');
});

// JPEG fabriqué octet par octet : chaque sorte de segment que le nettoyage doit garder ou retirer
const seg = (marker, payload) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const ascii = s => [...Buffer.from(s, 'latin1')];
const SOI = [0xff, 0xd8], EOI = [0xff, 0xd9];
const APP0 = seg(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'));
const APP1 = seg(0xe1, ascii('Exif\0\0GPS 48.8566N 2.3522E'));
const APP13 = seg(0xed, ascii('Photoshop 3.0\0IPTC'));
const COM = seg(0xfe, ascii('secret'));
const DQT = seg(0xdb, [0, ...Array(64).fill(1)]);
// Données du scan avec des octets de bourrage (FF00) et des marqueurs de reprise (RSTn), qui ne terminent pas le scan
const SOS = [...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0x00, 0xff, 0xd7, 0x78];
const headerMarkers = b => { const out = []; for (let o = 2; o < b.length && b[o] === 0xff;) { out.push(b[o + 1]); if (b[o + 1] === 0xda) break; o += 2 + ((b[o + 2] << 8) | b[o + 3]); } return out; };

test('export : le JPEG perd EXIF, GPS, IPTC, commentaires et tout ce qui suit la fin d’image', () => {
  // 0xff avant SOS : octet de remplissage, permis devant un marqueur
  const dirty = new Uint8Array([...SOI, ...APP0, ...APP1, ...COM, ...APP13, ...DQT, 0xff, ...SOS, ...EOI, ...ascii('trailer')]);
  assert.deepEqual(headerMarkers(dirty).slice(0, 5), [0xe0, 0xe1, 0xfe, 0xed, 0xdb], 'le fichier de départ a bien ses métadonnées');
  const clean = F.removeJpegMetadata(dirty);
  assert.deepEqual([...clean], [...SOI, ...APP0, ...DQT, ...SOS, ...EOI], 'restent SOI, JFIF, tables, scan complet, EOI');
  assert.deepEqual(headerMarkers(clean), [0xe0, 0xdb, 0xda]);
  for (const s of ['Exif', 'GPS', 'secret', 'IPTC', 'trailer']) assert.ok(!Buffer.from(clean).includes(s), s);
  for (let m = 0xe1; m <= 0xef; m++) assert.ok(!headerMarkers(clean).includes(m));
  assert.throws(() => F.removeJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /JPEG/);
});

test('export : nom aléatoire sans date ni nom d’origine, taille plafonnée à 16,8 Mpx', () => {
  const names = new Set(Array.from({ length: 50 }, F.createRandomPhotoName));
  for (const n of names) assert.match(n, /^photo-[0-9a-f]{6}\.jpg$/);
  assert.ok(names.size > 45);
  assert.equal(F.MAX_EXPORT_PIXELS, 4096 * 4096);
  assert.deepEqual(F.computeExportSize(4000, 3000), { width: 4000, height: 3000, isReduced: false });
  const s = F.computeExportSize(8000, 6000);
  assert.equal(s.isReduced, true); assert.ok(s.width * s.height <= F.MAX_EXPORT_PIXELS);
  assert.ok(Math.abs(s.width / s.height - 8000 / 6000) < 0.01, 'proportions gardées');
});

test('annulation : la dernière action d’abord, 30 actions au plus, copies indépendantes', () => {
  const a = { x: 10, y: 10, width: 50, height: 50 }, b = { x: 100, y: 20, width: 40, height: 40 };
  const h = new F.MaskHistory();
  assert.equal(h.canUndo, false); assert.equal(h.undo(), null);
  h.record({ masks: [], activeIndex: null }); h.record({ masks: [a], activeIndex: null }); h.record({ masks: [a, b], activeIndex: 1 });
  assert.deepEqual(h.undo(), { masks: [a, b], activeIndex: 1 });
  assert.deepEqual(h.undo(), { masks: [a], activeIndex: null });
  assert.deepEqual(h.undo(), { masks: [], activeIndex: null });
  assert.equal(h.canUndo, false);
  assert.equal(F.MASK_HISTORY_LIMIT, 30);
  const full = new F.MaskHistory();
  for (let x = 0; x < 35; x++) full.record({ masks: [{ ...a, x }], activeIndex: 0 });
  const restored = []; for (let s = full.undo(); s; s = full.undo()) restored.push(s.masks[0].x);
  assert.equal(restored.length, 30); assert.equal(restored[0], 34); assert.equal(restored.at(-1), 5);
  const masks = [{ ...a }], copy = new F.MaskHistory();
  copy.record({ masks, activeIndex: 0 }); masks[0].x = 999;
  assert.deepEqual(copy.undo().masks, [a], 'modifier après coup ne change pas l’état gardé');
});

test('moteur : fichiers livrés, tailles annoncées exactes, modèle vérifié, taille à télécharger juste', () => {
  const local = url => path.join(PUBLIC, url);
  for (const f of F.ENGINE_FILES) assert.equal(fs.statSync(local(f.url)).size, f.size, f.url);
  assert.ok(F.ENGINE_FILES.some(f => f.url === F.MODEL_URL) && F.ENGINE_FILES.some(f => f.url === F.VISION_BUNDLE_URL));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(local(F.MODEL_URL))).digest('hex'), MODEL_SHA256);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'vendor', 'mediapipe', 'mediapipe.LICENSE')));
  // Ce qui passe sur le réseau au plus (WebAssembly compressé par le serveur, le reste entier) : c'est ce qu'annonce le bouton
  const sent = F.ENGINE_FILES.reduce((n, f) => { const b = fs.readFileSync(local(f.url)); return n + (f.url.endsWith('.wasm') ? zlib.gzipSync(b, { level: 9 }).length : b.length); }, 0);
  assert.equal(Math.round(sent / 1e5) / 10, F.ENGINE_DOWNLOAD_MB, `${sent} octets envoyés`);
});

test('service worker : même cache que flouter-lib.js, chaque fichier de page reconnu, cache gardé aux mises à jour', () => {
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  assert.equal(sw.match(/FLOUTEUR = '([^']+)'/)[1], F.FLOUTEUR_CACHE);
  const page = new RegExp(sw.match(/FLOUTEUR_PAGE = \/(.+)\/;/)[1]);
  for (const p of F.PAGE_FILES) assert.ok(page.test(p), p);
  for (const p of ['/flouter/partage', '/flouter.html', '/flouter/', '/vendor/mediapipe/x.wasm', '/app.js']) assert.ok(!page.test(p), p);
  assert.match(sw, /k\.startsWith\('cortege-shell-'\) && k !== SHELL/, 'activate ne supprime que les anciennes versions de l’interface');
  assert.ok(!F.FLOUTEUR_CACHE.startsWith('cortege-shell-'));
});
