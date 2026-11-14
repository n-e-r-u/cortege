'use strict';
// Worker de détection du Flouteur : la photo est analysée ici, hors de la page, qui reste fluide pendant ce temps.
// Worker classique (pas de module) : MediaPipe y charge sa colle avec importScripts. Servi sans politique de sécurité,
// il peut compiler le moteur (WebAssembly) sans 'wasm-unsafe-eval'. Messages : init → ready | error ;
// detect { requestId, file } → progress, puis result { bitmap (transféré), faces (pixels de l'original) } | error.
importScripts('/flouter-lib.js');
const F = self.cortegeFlouteur;
importScripts(F.VISION_BUNDLE_URL);
let detector = null;
const reply = (message, transfer) => self.postMessage(message, transfer || []);

self.addEventListener('message', async e => {
  const m = e.data;
  if (m.type === 'init') {
    detector ||= F.createFaceDetector(self.Vision);
    try { await detector; reply({ type: 'ready' }); } catch (err) { detector = null; reply({ type: 'error', message: String(err) }); }
    return;
  }
  if (m.type !== 'detect') return;
  try {
    if (!detector) throw new Error('Détecteur non initialisé.');
    const { bitmap, faces } = await F.detectFacesInFile(await detector, m.file, (done, total) => reply({ type: 'progress', requestId: m.requestId, done, total }));
    reply({ type: 'result', requestId: m.requestId, bitmap, faces }, [bitmap]);
  } catch (err) { reply({ type: 'error', requestId: m.requestId, message: String(err) }); }
});
