'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { ROOT } = require('../config');
const { h8 } = require('../util');
const { send } = require('./respond');
const { instance } = require('../instance');

// ---- Statique ----
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
// Politique de sécurité des pages : le navigateur n'exécute que nos propres scripts. Même si du code
// était un jour injecté dans une note ou un titre, il ne pourrait pas s'exécuter. Les scripts intégrés
// aux pages (admin, mentions légales) sont autorisés par leur empreinte exacte.
const cspCache = new Map();
function cspFor(buf) {
  const key = h8(buf.toString('latin1'));
  if (!cspCache.has(key)) {
    const hashes = [...buf.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    cspCache.set(key, `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; `
      + `connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  }
  return cspCache.get(key);
}
// Page d'accueil et manifeste : écrits pour l'instance d'origine (adresse et pseudo en dur, lus par les moteurs de recherche
// et les aperçus de partage, qui n'exécutent pas le script). Une autre instance les sert avec sa propre adresse et son pseudo.
// La mention d'origine (auteur du logiciel, liens du pied de page) ne change pas.
const HOME = 'https://cortege.neru.tv', TAILORED = new Set(['/', '/index.html', '/manifest.webmanifest']);
function tailor(c, pathname, req) {
  if (!TAILORED.has(pathname)) return c;
  const base = (process.env.PUBLIC_URL || ('https://' + String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, ''))).replace(/\/$/, '');
  const handle = String(instance().brand.handle || '').replace(/[^\w.]/g, '');
  if (base === HOME && handle === 'neru') return c;
  const key = base + '|' + handle;
  if (!c.alt) c.alt = new Map();
  if (!c.alt.has(key)) {
    const buf = Buffer.from(c.buf.toString('utf8').split('</head>').map((part, i) => i ? part : part.replaceAll(HOME, base)
      .replaceAll(' Par @neru.', handle ? ` Par @${handle}.` : '').replaceAll(', par @neru', handle ? `, par @${handle}` : '')).join('</head>')
      .replace('"Cortège par @neru"', handle ? `"Cortège par @${handle}"` : '"Cortège"'));
    if (c.alt.size >= 8) c.alt.clear();
    c.alt.set(key, { buf, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"' });
    pack(c.alt.get(key), '.html');
  }
  return c.alt.get(key);
}
const WORKER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
// Politique d'une page, avec ses exceptions
function pageCsp(pathname, buf) {
  const csp = cspFor(buf);
  // La carte à intégrer (embed.html) peut s'afficher dans le site d'un média ou d'un collectif ; les autres pages, jamais
  if (pathname === '/embed.html') return csp.replace("frame-ancestors 'none'", 'frame-ancestors *');
  // Le Flouteur compile son moteur de détection (WebAssembly) dans la page quand le téléphone ne peut pas le faire dans un
  // worker : seule cette page reçoit 'wasm-unsafe-eval', qui n'autorise aucun script de plus.
  if (pathname === '/flouter.html') return csp.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'");
  return csp;
}
// Moteur du Flouteur (14,6 Mo) : 4,1 Mo une fois compressé. Le code, les styles et les pages partent compressés eux aussi
// (l'appli pèse trois à quatre fois moins sur un réseau saturé), même sans serveur frontal qui s'en charge : compressés
// une seule fois en mémoire, en Brotli pour qui l'accepte, sinon en gzip.
const isPrecompressed = file => /\.(wasm|js|css|html|json|svg|webmanifest|txt)$/.test(file);
function pack(entry, file) {
  if (!isPrecompressed(file) || entry.buf.length < 1024) return;
  zlib.gzip(entry.buf, { level: 9 }, (e, gz) => { if (!e) entry.gz = gz; });
  if (!file.endsWith('.wasm')) zlib.brotliCompress(entry.buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }, (e, br) => { if (!e) entry.br = br; });
}
// Fichiers de l'appli gardés en mémoire avec une empreinte : un téléphone qui a déjà la bonne version
// reçoit une réponse vide « pas modifié » (304) au lieu de tout retélécharger.
const staticCache = new Map();
// Pages d'outils, jamais dans les moteurs de recherche (l'admin, le digest, la carte à intégrer, l'image d'un créneau)
const NOINDEX = new Set(['/admin.html', '/digest.html', '/embed.html', '/creneau.html']);
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    let c = staticCache.get(file);
    const reply = () => {
      const v = tailor(c, pathname, req);
      const ae = String(req.headers['accept-encoding'] || '');
      const enc = v.br && /\bbr\b/.test(ae) ? 'br' : v.gz && /\bgzip\b/.test(ae) ? 'gzip' : '';
      const packed = enc && (enc === 'br' ? v.br : v.gz);
      const etag = enc ? v.etag.slice(0, -1) + (enc === 'br' ? '-br"' : '-gz"') : v.etag;
      const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ETag: etag,
        'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache' };
      if (NOINDEX.has(pathname)) headers['X-Robots-Tag'] = 'noindex, nofollow';
      if (isPrecompressed(file)) headers.Vary = 'Accept-Encoding';
      if (enc) headers['Content-Encoding'] = enc;
      if (file.endsWith('.html')) {
        headers['Content-Security-Policy'] = pageCsp(pathname, v.buf);
        // Seule la carte à intégrer peut s'afficher dans un autre site (voir pageCsp)
        if (pathname !== '/embed.html') headers['X-Frame-Options'] = 'DENY';
      }
      // Worker du Flouteur : un worker suit la politique de son propre fichier, pas celle de la page. MediaPipe y envoie des
      // statistiques à Google (odml.pa.googleapis.com) sans option pour les couper : ici, rien ne peut sortir du serveur.
      if (pathname === '/flouter-worker.js') headers['Content-Security-Policy'] = WORKER_CSP;
      // « Pas modifié » quelle que soit la forme déjà gardée par le téléphone (brute, gzip ou Brotli) : le contenu est le même
      const inm = String(req.headers['if-none-match'] || '');
      if (inm && inm.replace(/-(gz|br)"$/, '"') === v.etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers); res.end(packed || v.buf);
    };
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return reply();
    fs.readFile(file, (err2, buf) => {
      if (err2) return send(res, 404, 'Not found');
      c = { buf, mtime: st.mtimeMs, size: st.size, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"' };
      if (staticCache.size > 200) staticCache.clear();
      staticCache.set(file, c);
      // Compressé une seule fois et en arrière-plan (gzipSync bloquerait le serveur plusieurs secondes), puis gardé avec le
      // fichier ; en attendant, le fichier part tel quel.
      pack(c, file);
      reply();
    });
  });
}

module.exports = { PUBLIC, TYPES, cspFor, NOINDEX, serveStatic };
