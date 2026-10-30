'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, PUBLIC_URL } = require('../config');
const { PUBLIC } = require('./static');

// ---- Version en ligne : empreintes SHA-256 des fichiers servis, pour comparer avec le dépôt public ----
// Les fichiers de l'appli (public/) peuvent être vérifiés pour de vrai : verifier.js les retélécharge et les compare.
// L'empreinte de server.js est seulement déclarée par le serveur : elle ne prouve rien à elle seule.
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
let versionCache = { t: 0, body: null };
function versionInfo() {
  if (Date.now() - versionCache.t < 60_000) return versionCache.body;
  const files = {};
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name), r = rel + '/' + e.name;
      if (e.isDirectory()) walk(p, r); else files['public' + r] = sha(p);
    }
  };
  walk(PUBLIC, '');
  files['server.js'] = sha(path.join(ROOT, 'server.js'));
  // Code serveur découpé dans src/ (déclaré, comme server.js)
  const walkSrc = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue; const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p, rel + '/' + e.name); else if (e.name.endsWith('.js')) files['src' + rel + '/' + e.name] = sha(p); } };
  try { walkSrc(path.join(ROOT, 'src'), ''); } catch {}
  versionCache = { t: Date.now(), body: { version: APP_VERSION, algorithm: 'sha256', files,
    verify: 'node verifier.js ' + PUBLIC_URL + '  (depuis une copie du dépôt public)' } };
  return versionCache.body;
}

module.exports = { APP_VERSION, versionInfo };
