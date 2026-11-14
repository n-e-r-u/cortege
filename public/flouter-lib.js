'use strict';
// Flouteur : ce qui sert à la fois à la page (flouter.js), à son éditeur de masques (flouter-editor.js), au worker de détection
// (flouter-worker.js) et aux tests (Node). Rectangles, tuiles, détection, fusion des détections, masques, export en JPEG nettoyé,
// historique : rien ne touche au DOM de la page, sauf le repli document.createElement('canvas') quand OffscreenCanvas manque.
// Les photos ne quittent jamais le téléphone : tout est calculé ici, rien n'est envoyé ni enregistré.
(function (root) {
  // ---- Fichiers du Flouteur ----
  // Cache à part, rempli seulement quand on appuie sur « Préparer le flouteur », et gardé d'une version de Cortège à l'autre
  // (public/sw.js porte le même nom). Nouvelle version de MediaPipe : nouveau dossier, nouvelles tailles, cache v2.
  const FLOUTEUR_CACHE = 'cortege-flouteur-v1';
  const MEDIAPIPE_BASE = '/vendor/mediapipe/tasks-vision-1.2.2', VISION_BUNDLE_URL = MEDIAPIPE_BASE + '/vision_bundle.js';
  const MODEL_URL = '/vendor/mediapipe/blaze_face_full_range-float16-v1.tflite';
  // Taille brute de chaque fichier : la barre de progression compte les octets reçus, une fois décompressés
  const ENGINE_FILES = [{ url: VISION_BUNDLE_URL, size: 156088 }, { url: MEDIAPIPE_BASE + '/vision_wasm_internal.js', size: 334128 },
    { url: MEDIAPIPE_BASE + '/vision_wasm_internal.wasm', size: 14603354 }, { url: MODEL_URL, size: 1083786 }];
  // Ce qui passe sur le réseau au plus, en Mo, annoncé sur le bouton « Préparer le flouteur » : le serveur compresse lui-même
  // le WebAssembly (src/http/static.js) ; les autres fichiers sont comptés entiers, faute de savoir si un proxy les compresse
  const ENGINE_DOWNLOAD_MB = 5.7;
  // La page elle-même, gardée avec le moteur pour s'ouvrir hors ligne
  const PAGE_FILES = ['/flouter', '/flouter.js', '/flouter-lib.js', '/flouter-editor.js', '/flouter-worker.js'];

  // ---- Rectangles : { x, y, width, height } en pixels, origine en haut à gauche ----
  const rectArea = r => Math.max(0, r.width) * Math.max(0, r.height);
  function intersectionArea(a, b) {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }
  function unionRect(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  }
  const scaleRect = (r, f) => ({ x: r.x * f, y: r.y * f, width: r.width * f, height: r.height * f });
  // Ramène le rectangle à l'intérieur de l'image
  function clampRectToImage(r, imageWidth, imageHeight) {
    const x = Math.min(Math.max(r.x, 0), imageWidth), y = Math.min(Math.max(r.y, 0), imageHeight);
    return { x, y, width: Math.max(0, Math.min(r.x + r.width, imageWidth) - x), height: Math.max(0, Math.min(r.y + r.height, imageHeight) - y) };
  }
  const createCanvas = (width, height) => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });

  // ---- Tuiles : les petits visages d'une photo de foule ne se voient qu'en la découpant ----
  // Départs des tuiles sur un axe : pas régulier, dernière tuile calée sur le bord
  function computeTileOrigins(length, tileSize, overlapRatio) {
    if (tileSize >= length) return [0];
    const step = Math.max(1, Math.floor(tileSize * (1 - overlapRatio))), origins = [];
    for (let o = 0; o + tileSize < length; o += step) origins.push(o);
    origins.push(length - tileSize);
    return origins;
  }
  // Tuiles carrées qui couvrent l'image et se recouvrent d'au moins overlapRatio de leur côté
  function createTiles(imageWidth, imageHeight, tileSize, overlapRatio) {
    const width = Math.min(tileSize, imageWidth), height = Math.min(tileSize, imageHeight);
    return computeTileOrigins(imageHeight, height, overlapRatio).flatMap(y => computeTileOrigins(imageWidth, width, overlapRatio).map(x => ({ x, y, width, height })));
  }
  // L'image entière, puis chaque taille de tuile plus petite que le grand côté de l'image
  const createDetectionTiles = (imageWidth, imageHeight, tileSizes, overlapRatio) => [{ x: 0, y: 0, width: imageWidth, height: imageHeight },
    ...tileSizes.filter(s => s < Math.max(imageWidth, imageHeight)).flatMap(s => createTiles(imageWidth, imageHeight, s, overlapRatio))];

  // ---- Fusion des détections ----
  // iouThreshold : intersection sur union au-delà de laquelle deux boîtes désignent le même visage ;
  // containmentThreshold : part de la plus petite boîte couverte par l'autre (visage vu en tuile et en image entière)
  function isSameFace(a, b, { iouThreshold, containmentThreshold }) {
    const inter = intersectionArea(a, b);
    if (inter === 0) return false;
    return inter / (rectArea(a) + rectArea(b) - inter) >= iouThreshold || inter / Math.min(rectArea(a), rectArea(b)) >= containmentThreshold;
  }
  // Suppression des doublons : la boîte gardée devient l'union des boîtes fusionnées, pour que le masque couvre tout ce que
  // chaque détection a vu. On recommence tant que des boîtes fusionnent.
  function mergeDetections(boxes, thresholds) {
    let merged = [...boxes].sort((a, b) => b.score - a.score), previous = Infinity;
    while (merged.length < previous) {
      previous = merged.length;
      const kept = [];
      for (const box of merged) {
        const i = kept.findIndex(k => isSameFace(k, box, thresholds));
        if (i === -1) kept.push({ ...box });
        else kept[i] = { ...unionRect(kept[i], box), score: Math.max(kept[i].score, box.score) };
      }
      merged = kept;
    }
    return merged;
  }

  // ---- Détection (MediaPipe, sur le processeur du téléphone) ----
  // Réglages mesurés sur des photos de foule, à ajuster ensemble
  const DETECTION_SETTINGS = Object.freeze({
    maxWorkingSide: 2048, // grand côté de la copie de travail ; les masques s'appliquent ensuite à l'original
    tileSizes: Object.freeze([1024, 512, 256]),
    overlapRatio: 0.25,
    maxTileInputSide: 512, // chaque tuile est réduite à ce côté au plus avant la détection
    minDetectionConfidence: 0.4,
    iouThreshold: 0.3,
    containmentThreshold: 0.6,
  });
  // vision : l'objet Vision de vision_bundle.js (chargé par importScripts dans le worker, par une balise script sur la page) ;
  // le moteur charge sa propre colle (vision_wasm_internal.js) de la même façon
  async function createFaceDetector(vision) {
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_BASE, false);
    return vision.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, runningMode: 'IMAGE',
      minDetectionConfidence: DETECTION_SETTINGS.minDetectionConfidence });
  }
  // Détecte les visages tuile par tuile, puis fusionne les doublons. onProgress(tuiles faites, total)
  async function detectFaces(detector, image, onProgress) {
    const S = DETECTION_SETTINGS, tiles = createDetectionTiles(image.width, image.height, S.tileSizes, S.overlapRatio);
    const canvas = createCanvas(1, 1), ctx = canvas.getContext('2d'), boxes = [];
    for (const [i, tile] of tiles.entries()) {
      const scale = Math.min(1, S.maxTileInputSide / Math.max(tile.width, tile.height));
      canvas.width = Math.max(1, Math.round(tile.width * scale)); canvas.height = Math.max(1, Math.round(tile.height * scale));
      ctx.drawImage(image, tile.x, tile.y, tile.width, tile.height, 0, 0, canvas.width, canvas.height);
      for (const d of detector.detect(canvas).detections) {
        const b = d.boundingBox;
        if (b) boxes.push({ x: tile.x + b.originX / scale, y: tile.y + b.originY / scale, width: b.width / scale, height: b.height / scale, score: d.categories[0]?.score ?? 0 });
      }
      onProgress(i + 1, tiles.length);
      // Sur le fil principal, rendre la main entre deux tuiles laisse la barre de progression se dessiner
      await new Promise(r => setTimeout(r, 0));
    }
    return mergeDetections(boxes, S);
  }
  // Décode la photo (orientation EXIF appliquée), détecte sur une copie réduite si elle est grande,
  // et rend l'image décodée avec les visages en pixels de l'original
  async function detectFacesInFile(detector, file, onProgress) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, DETECTION_SETTINGS.maxWorkingSide / Math.max(bitmap.width, bitmap.height));
    const work = scale < 1 ? await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * scale), resizeHeight: Math.round(bitmap.height * scale), resizeQuality: 'high' }) : bitmap;
    try {
      const faces = await detectFaces(detector, work, onProgress), toOriginal = bitmap.width / work.width;
      return { bitmap, faces: faces.map(f => ({ ...scaleRect(f, toOriginal), score: f.score })) };
    } finally { if (work !== bitmap) work.close(); }
  }

  // ---- Masques ----
  // Les boîtes du détecteur vont des yeux à la bouche : +40 % couvre cheveux, oreilles et menton
  const MASK_GROWTH_FACTOR = 1.4;
  // Un bloc de pixellisation fait au moins 1/8 de la largeur du masque : rien d'un visage ne reste lisible
  const PIXELATION_BLOCKS_PER_WIDTH = 8;
  function expandBox(box, factor, imageWidth, imageHeight) {
    const width = box.width * factor, height = box.height * factor;
    return clampRectToImage({ x: box.x + box.width / 2 - width / 2, y: box.y + box.height / 2 - height / 2, width, height }, imageWidth, imageHeight);
  }
  const facesToMasks = (faces, imageWidth, imageHeight) => faces.map(f => expandBox(f, MASK_GROWTH_FACTOR, imageWidth, imageHeight)).filter(m => m.width > 0 && m.height > 0);
  const pixelationBlockSize = maskWidth => Math.max(1, Math.ceil(maskWidth / PIXELATION_BLOCKS_PER_WIDTH));
  // Dessine l'image à la taille du contexte, puis ses masques (en pixels de l'original), en aplat noir ou en gros pixels.
  // Sert à l'aperçu comme à l'export : ce que l'on voit est ce que l'on exporte.
  function drawMaskedImage(ctx, source, masks, style) {
    const scale = ctx.canvas.width / source.width;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#000000';
    for (const mask of masks) {
      const target = scaleRect(mask, scale);
      if (style !== 'pixellisation') { ctx.fillRect(target.x, target.y, target.width, target.height); continue; }
      const block = pixelationBlockSize(mask.width), cols = Math.max(1, Math.ceil(mask.width / block)), rows = Math.max(1, Math.ceil(mask.height / block));
      const blocks = createCanvas(cols, rows), bctx = blocks.getContext('2d');
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(source, mask.x, mask.y, mask.width, mask.height, 0, 0, cols, rows);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(blocks, 0, 0, cols, rows, target.x, target.y, target.width, target.height);
      ctx.imageSmoothingEnabled = true;
    }
  }

  // ---- Export ----
  const JPEG_QUALITY = 0.9;
  // 16,8 Mpx (4096 × 4096) : au-delà, Safari sur iPhone refuse de créer le canvas
  const MAX_EXPORT_PIXELS = 4096 * 4096;
  function computeExportSize(width, height, maxPixels = MAX_EXPORT_PIXELS) {
    if (width * height <= maxPixels) return { width, height, isReduced: false };
    const scale = Math.sqrt(maxPixels / (width * height));
    return { width: Math.floor(width * scale), height: Math.floor(height * scale), isReduced: true };
  }
  // Fin des données compressées d'un scan : le prochain marqueur qui n'est ni un octet de bourrage (FF00) ni un RSTn
  function findScanEnd(bytes, start) {
    for (let o = start; o < bytes.length - 1; o++) {
      if (bytes[o] !== 0xff) continue;
      const next = bytes[o + 1];
      if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) return o;
    }
    return bytes.length;
  }
  // Retire d'un JPEG les segments APP1 à APP15 (EXIF, position GPS, XMP, IPTC…), les commentaires et tout ce qui suit la fin
  // d'image. Garde APP0 (JFIF) et ce qu'il faut pour décoder. Par précaution : le réencodage par canvas n'en produit pas.
  function removeJpegMetadata(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Ce fichier n’est pas un JPEG.');
    const kept = [bytes.subarray(0, 2)];
    let o = 2;
    while (o + 1 < bytes.length) {
      if (bytes[o] !== 0xff) throw new Error('JPEG invalide : marqueur attendu.');
      const marker = bytes[o + 1];
      if (marker === 0xff) { o++; continue; } // octet de remplissage avant un marqueur
      if (marker === 0xd9) { kept.push(bytes.subarray(o, o + 2)); break; } // EOI
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { kept.push(bytes.subarray(o, o + 2)); o += 2; continue; } // sans longueur
      const end = o + 2 + ((bytes[o + 2] << 8) | bytes[o + 3]);
      if (marker === 0xda) { const scanEnd = findScanEnd(bytes, end); kept.push(bytes.subarray(o, scanEnd)); o = scanEnd; continue; } // SOS et ses données
      if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) kept.push(bytes.subarray(o, end));
      o = end;
    }
    const out = new Uint8Array(kept.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of kept) { out.set(p, at); at += p.length; }
    return out;
  }
  // Nom sans date ni nom d'origine, par exemple photo-7f3a9c.jpg (crypto.randomUUID n'existe pas hors https)
  const createRandomPhotoName = () => 'photo-' + [...crypto.getRandomValues(new Uint8Array(3))].map(b => b.toString(16).padStart(2, '0')).join('') + '.jpg';
  // Redessine l'original avec ses masques (style : celui de drawMaskedImage) et le réencode en JPEG : les métadonnées de la
  // photo d'origine disparaissent
  async function exportMaskedPhoto(source, masks, style) {
    const size = computeExportSize(source.width, source.height), canvas = createCanvas(size.width, size.height);
    drawMaskedImage(canvas.getContext('2d'), source, masks, style);
    const encoded = 'convertToBlob' in canvas ? await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
      : await new Promise((ok, ko) => canvas.toBlob(b => b ? ok(b) : ko(new Error('Encodage JPEG impossible.')), 'image/jpeg', JPEG_QUALITY));
    const clean = removeJpegMetadata(new Uint8Array(await encoded.arrayBuffer()));
    canvas.width = canvas.height = 0; // libère tout de suite la mémoire de la grande image
    return { file: new File([clean], createRandomPhotoName(), { type: 'image/jpeg' }), isReduced: size.isReduced };
  }

  // ---- Annulation ----
  // Actions annulables par photo : assez pour corriger une série d'erreurs sur une foule, sans garder trop de copies
  const MASK_HISTORY_LIMIT = 30;
  // Historique d'une photo : l'état d'avant chaque action, { masks, activeIndex } (le masque concerné, rendu actif quand on
  // annule ; null si l'action l'a créé). La dernière action est annulée en premier, la plus ancienne oubliée au-delà de la limite.
  class MaskHistory {
    constructor(limit = MASK_HISTORY_LIMIT) { this.limit = limit; this.snapshots = []; }
    get canUndo() { return this.snapshots.length > 0; }
    record(s) {
      this.snapshots.push({ masks: s.masks.map(m => ({ ...m })), activeIndex: s.activeIndex });
      if (this.snapshots.length > this.limit) this.snapshots.shift();
    }
    undo() { return this.snapshots.pop() || null; }
  }

  const lib = { FLOUTEUR_CACHE, VISION_BUNDLE_URL, MODEL_URL, ENGINE_FILES, ENGINE_DOWNLOAD_MB, PAGE_FILES,
    clampRectToImage, computeTileOrigins, createTiles, createDetectionTiles, mergeDetections, DETECTION_SETTINGS, createFaceDetector, detectFacesInFile,
    MASK_GROWTH_FACTOR, expandBox, facesToMasks, pixelationBlockSize, drawMaskedImage,
    MAX_EXPORT_PIXELS, computeExportSize, removeJpegMetadata, createRandomPhotoName, exportMaskedPhoto, MASK_HISTORY_LIMIT, MaskHistory };
  if (typeof module === 'object' && module.exports) module.exports = lib;
  if (root) root.cortegeFlouteur = lib;
})(typeof self !== 'undefined' ? self : null);
