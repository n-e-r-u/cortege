'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('../config');
const { h8 } = require('../util');
const { send } = require('./respond');

// ---- Statique ----
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2' };
// Politique de sécurité des pages : le navigateur n'exécute que nos propres scripts. Même si du code
// était un jour injecté dans une note ou un titre, il ne pourrait pas s'exécuter. Les scripts intégrés
// aux pages (admin, mentions légales) sont autorisés par leur empreinte exacte.
const cspCache = new Map();
function cspFor(buf) {
  const key = h8(buf.toString('latin1'));
  if (!cspCache.has(key)) {
    const hashes = [...buf.toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    cspCache.set(key, `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; `
      + `connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  }
  return cspCache.get(key);
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
      const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ETag: c.etag,
        'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache' };
      if (NOINDEX.has(pathname)) headers['X-Robots-Tag'] = 'noindex, nofollow';
      if (file.endsWith('.html')) {
        // La carte à intégrer (embed.html) peut s'afficher dans le site d'un média ou d'un collectif ; les autres pages, jamais
        if (pathname === '/embed.html') headers['Content-Security-Policy'] = cspFor(c.buf).replace("frame-ancestors 'none'", 'frame-ancestors *');
        else { headers['Content-Security-Policy'] = cspFor(c.buf); headers['X-Frame-Options'] = 'DENY'; }
      }
      if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers); res.end(c.buf);
    };
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return reply();
    fs.readFile(file, (err2, buf) => {
      if (err2) return send(res, 404, 'Not found');
      c = { buf, mtime: st.mtimeMs, size: st.size, etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"' };
      if (staticCache.size > 200) staticCache.clear();
      staticCache.set(file, c);
      reply();
    });
  });
}

module.exports = { PUBLIC, TYPES, cspFor, NOINDEX, serveStatic };
