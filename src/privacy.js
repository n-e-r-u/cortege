'use strict';
// Vie privée : clés de hachage par période, empreintes de l'adresse IP et du téléphone, IP réelle derrière le proxy, accès par Tor.
// Aucune adresse IP ni identifiant de téléphone n'est jamais stocké en clair : seulement ces empreintes, qui changent avec la période.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, TRUST_PROXY, MIN } = require('./config');
const { keyEq } = require('./util');

// Clés de hachage (HMAC) : une clé tirée au hasard pour chaque période (6 h pour les adresses IP, une journée pour les téléphones),
// détruite dès la période suivante terminée. Une copie ou une saisie du disque ne permet donc jamais de recalculer
// les empreintes des périodes passées, même avec le code du serveur.
// Fichiers dans DATA_DIR/keys (partagés entre processus, relus toutes les 5 s) ; SECRET_STORE=memory : seulement en mémoire
// (un seul processus). SECRET=… (variable fixe) : clés dérivées de cette valeur, sans cette protection.
const KEY_DIR = path.join(DATA_DIR, 'keys');
const SECRET_FILE = path.join(DATA_DIR, 'secret'); // ancienne clé unique (avant la 2.6.5), effacée au démarrage
const SECRET_MEMORY = process.env.SECRET_STORE === 'memory' && !process.env.SECRET;
fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
try { fs.unlinkSync(SECRET_FILE); } catch {}
const keyCache = new Map();
function periodKey(kind, bucket) {
  if (process.env.SECRET) return crypto.createHmac('sha256', process.env.SECRET).update(kind + '|' + bucket).digest('hex');
  const id = kind + '-' + bucket, now = Date.now(), hit = keyCache.get(id);
  if (hit && (SECRET_MEMORY || now - hit.t < 5000)) return hit.v;
  let v;
  if (SECRET_MEMORY) v = crypto.randomBytes(32).toString('hex');
  else {
    const f = path.join(KEY_DIR, id);
    try { v = fs.readFileSync(f, 'utf8'); } catch {
      const n = crypto.randomBytes(32).toString('hex');
      try { fs.writeFileSync(f, n, { mode: 0o600, flag: 'wx' }); v = n; } catch { v = fs.readFileSync(f, 'utf8'); }
      pruneKeys();
    }
  }
  keyCache.set(id, { v, t: now });
  return v;
}
// Seules la période en cours et la précédente sont gardées
function pruneKeys() {
  const keep = new Set([`ip-${ipBucket()}`, `ip-${ipBucket() - 1}`, `dev-${dayBucket()}`, `dev-${dayBucket() - 1}`]);
  for (const id of keyCache.keys()) if (!keep.has(id)) keyCache.delete(id);
  if (!SECRET_MEMORY) try { for (const f of fs.readdirSync(KEY_DIR)) if (!keep.has(f)) try { fs.unlinkSync(path.join(KEY_DIR, f)); } catch {} } catch {}
}
// Effacement d'urgence : toutes les clés détruites, de nouvelles sont tirées
function rotateSecret() {
  if (process.env.SECRET) return false;
  keyCache.clear();
  if (!SECRET_MEMORY) for (const f of fs.readdirSync(KEY_DIR)) try { fs.unlinkSync(path.join(KEY_DIR, f)); } catch {}
  return true;
}
// IP du téléphone, seulement pour l'anti-spam (jamais stockée en clair).
// - Derrière un CDN : en-tête CF-Connecting-IP (sinon tout le monde aurait l'IP du CDN
//   et l'anti-spam bloquerait des foules entières).
// - Sinon : dernière adresse publique de X-Forwarded-For, celle ajoutée par le proxy de l'hébergeur ;
//   les premières peuvent être inventées par le client pour contourner les limites.
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:|::ffff:(10\.|127\.|192\.168\.))/i;
// Accès par Tor (.onion) : toutes les connexions arrivent du serveur lui-même. Le proxy local de l'adresse .onion
// ajoute X-Cortege-Onion ; l'anti-spam se fonde alors sur l'identifiant du téléphone, sinon tout Tor partagerait une seule limite.
const ONION_HOST = (process.env.ONION_HOST || '').trim();
// En-têtes de proxy crus seulement si la connexion vient du proxy lui-même : la machine (Caddy, Nginx, Tor),
// un socket local (Passenger) ou une adresse listée dans PROXY_IPS. Sinon, n'importe qui pourrait choisir son « IP ».
const PROXY_IPS = new Set((process.env.PROXY_IPS || '').split(',').map(x => x.trim()).filter(Boolean));
// CF-Connecting-IP : seulement si l'instance est vraiment derrière Cloudflare (CLOUDFLARE=1)
const CLOUDFLARE = process.env.CLOUDFLARE === '1';
// ONION_SECRET : valeur attendue dans X-Cortege-Onion (posée par le bloc .onion de Caddy). Sans elle, « 1 » comme avant.
const ONION_SECRET = process.env.ONION_SECRET || '';
const fromProxy = req => { const a = req.socket.remoteAddress || ''; return !a || /^(127\.|::1$|::ffff:127\.)/.test(a) || PROXY_IPS.has(a.replace(/^::ffff:/, '')); };
function viaOnion(req) {
  const h = String(req.headers['x-cortege-onion'] || '');
  return TRUST_PROXY && fromProxy(req) && (ONION_SECRET ? h.length === ONION_SECRET.length && keyEq(h, ONION_SECRET) : h === '1');
}
function clientIp(req) {
  if (viaOnion(req)) { const d = String(req.headers['x-device'] || ''); return 'onion:' + (/^[\w-]{16,64}$/.test(d) ? d : 'sans-id'); }
  if (TRUST_PROXY && fromProxy(req)) {
    const cf = CLOUDFLARE ? String(req.headers['cf-connecting-ip'] || '').trim() : '';
    if (cf) return cf;
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const pub = hops.filter(h => !PRIVATE_IP.test(h));
    if (pub.length) return pub[pub.length - 1];
    if (hops.length) return hops[hops.length - 1];
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  }
  return req.socket.remoteAddress || '';
}
function clientHash(req) {
  const ip = clientIp(req);
  const bucket = ipBucket();
  return crypto.createHmac('sha256', periodKey('ip', bucket)).update(bucket + '|' + ip).digest('base64url').slice(0, 16);
}
// Empreinte du téléphone : l'identifiant brut n'est jamais stocké, seulement son HMAC.
// Elle change chaque jour à 4 h (heure de Paris en été) : impossible de relier deux journées entre elles.
function dayBucket(now = Date.now()) { return Math.floor((now - 2 * 60 * MIN) / (24 * 60 * MIN)); }
function ipBucket(now = Date.now()) { return Math.floor(now / (6 * 60 * MIN)); }
function deviceHash(req) {
  const d = String(req.headers['x-device'] || '');
  if (!/^[\w-]{16,64}$/.test(d)) return 'ip:' + clientHash(req);
  const day = dayBucket();
  return 'd:' + crypto.createHmac('sha256', periodKey('dev', day)).update('dev|' + day + '|' + d).digest('base64url').slice(0, 16);
}

module.exports = { KEY_DIR, SECRET_MEMORY, periodKey, pruneKeys, rotateSecret, PRIVATE_IP, ONION_HOST, PROXY_IPS, CLOUDFLARE, ONION_SECRET,
  fromProxy, viaOnion, clientIp, clientHash, dayBucket, ipBucket, deviceHash };
