'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { CAT, VIBES } = require('./categories');
const { DATA_DIR, ROOT, CONTACT_EMAIL, PUBLIC_URL, MIN } = require('./config');
const { distKm } = require('./util');
const { settings } = require('./settings');
const { tx, q } = require('./db');

// ---- Notifications push (Web Push : chiffrement RFC 8291 + VAPID RFC 8292), sans dépendance ----
// Un téléphone abonné envoie seulement une zone arrondie à 0,1° (≈ 10 km), jamais sa position exacte.
// Seules les annonces urgentes (et nationales urgentes) déclenchent une notification.
const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const PUSH_MAX = 50000;
// Seuls les services de notification des navigateurs sont contactés (évite qu'on fasse appeler n'importe quelle adresse au serveur)
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const VAPID = (() => {
  const f = path.join(DATA_DIR, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const v = { jwk, pub: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url') };
  try { fs.writeFileSync(f, JSON.stringify(v), { mode: 0o600, flag: 'wx' }); return v; } catch { return JSON.parse(fs.readFileSync(f, 'utf8')); }
})();
const VAPID_KEY = crypto.createPrivateKey({ key: VAPID.jwk, format: 'jwk' });
const PUSH_FAILS = 5, PUSH_NET_MAX = Number(process.env.PUSH_NET_MAX) || 60, PUSH_ZONES_MAX = 3000;
// Textes des notifications dans la langue du téléphone : mêmes traductions que l'appli (public/lang/*.json, le français sert de clé)
const PUSH_LANGS = ['fr', 'en', 'es', 'ar'];
const LANG_DICT = {};
for (const l of PUSH_LANGS.slice(1)) {
  LANG_DICT[l] = {};
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'lang', l + '.json'), 'utf8')))) LANG_DICT[l][k.replace(/\s+/g, ' ').trim()] = v; } catch {}
}
function tr(lang, s, v) {
  const d = LANG_DICT[lang], out = (d && d[String(s).replace(/\s+/g, ' ').trim()]) || s;
  return v ? out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : out;
}
const LOCALE = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', ar: 'ar-u-nu-latn' };
try { // reprise de l'ancien fichier push.json, une seule fois
  if (fs.existsSync(PUSH_FILE)) {
    const old = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8'));
    tx(() => { for (const [id, x] of Object.entries(old)) q('INSERT OR IGNORE INTO push(id,e,k,a,lat,lng,t) VALUES(?,?,?,?,?,?,?)').run(id, x.e, x.k, x.a, x.lat ?? null, x.lng ?? null, x.t || Date.now()); });
    fs.renameSync(PUSH_FILE, PUSH_FILE + '.repris-' + Date.now());
  }
} catch (e) { if (!/ENOENT/.test(e.message)) console.error('reprise push.json', e.message); }
const pushCount = () => q('SELECT COUNT(*) n FROM push').get().n;
const pushAll = () => q('SELECT * FROM push').all();
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
function encryptPush(sub, payload) {
  const uaPub = Buffer.from(sub.k, 'base64url'), auth = Buffer.from(sub.a, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys();
  const ikm = hmac(hmac(auth, ecdh.computeSecret(uaPub)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
  return Buffer.concat([head, asPub, body]);
}
// Jeton VAPID par service : valable 1 h, renouvelé au bout de 30 min. Apple (web.push.apple.com) refuse
// un jeton émis depuis plus d'une heure (403 ExpiredProviderToken), même si son « exp » n'est pas dépassé.
const jwtCache = new Map();
function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud), now = Date.now();
  if (hit && now - hit.at < 30 * 60_000) return hit.h;
  const exp = Math.floor(now / 1000) + 3600;
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp, sub: CONTACT_EMAIL ? 'mailto:' + CONTACT_EMAIL : PUBLIC_URL });
  const sig = crypto.sign('sha256', Buffer.from(data), { key: VAPID_KEY, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const h = `vapid t=${data}.${sig}, k=${VAPID.pub}`;
  jwtCache.set(aud, { h, at: now });
  return h;
}
// File d'envoi commune : connexions réutilisées vers les services de notification (Google, Mozilla, Apple),
// au plus PUSH_PARALLEL envois en même temps, et les annonces urgentes passent devant les alertes de proximité.
const pushAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });
const PUSH_PARALLEL = Number(process.env.PUSH_PARALLEL) || 48;
let pushRunning = 0;
const pushRunningNow = () => pushRunning;
const pushQueue = { hi: [], lo: [] };
function pushSlot(urgent) {
  return new Promise(go => {
    if (pushRunning < PUSH_PARALLEL) { pushRunning++; return go(); }
    pushQueue[urgent ? 'hi' : 'lo'].push(go);
  });
}
function pushDone() {
  const next = pushQueue.hi.shift() || pushQueue.lo.shift();
  if (next) next(); else pushRunning--;
}
async function pushOne(sub, payload, urgent = false) {
  await pushSlot(urgent);
  try { return await pushSend(sub, payload); } finally { pushDone(); }
}
function pushSend(sub, payload) {
  return new Promise(resolve => {
    let body, u;
    try { body = encryptPush(sub, payload); u = new URL(sub.e); } catch { return resolve(410); }
    const req = https.request({ method: 'POST', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, timeout: 10_000, agent: pushAgent,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
        TTL: '3600', Urgency: 'high', Authorization: vapidAuth(sub.e) } }, res => {
      if (res.statusCode < 300 || res.statusCode === 404 || res.statusCode === 410) { res.resume(); return resolve(res.statusCode); }
      // Refus inattendu : on garde le début de la réponse du service pour le diagnostic (tableau de bord de l'admin)
      let txt = ''; res.setEncoding('utf8');
      res.on('data', d => { if (txt.length < 300) txt += d; });
      res.on('end', () => { PSTATS.lastErr = { t: Date.now(), host: u.hostname, code: res.statusCode, msg: txt.slice(0, 300) }; resolve(res.statusCode); });
      res.on('error', () => resolve(res.statusCode));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e => { PSTATS.lastErr = { t: Date.now(), host: u.hostname, code: 0, msg: String(e.code || e.message).slice(0, 120) }; resolve(0); });
    req.end(body);
  });
}
// Réseau saturé : chaque notification transporte aussi les signalements actifs autour de la zone de l'abonné·e
// (format compact, ≈ 3 Ko au plus). Le téléphone les garde, même appli fermée : la carte est à jour à l'ouverture.
// Ligne : [id, catégorie, lat, lng, début, dernière confirmation, fin, confirmations, drapeaux (1 vérifié, 2 contesté, 4 fiable, 8 non fiable)]
function pushData(lat, lng, now = Date.now()) {
  if (lat == null) return null;
  const d = 0.12, out = [];
  let size = 40;
  for (const r of q('SELECT id, cat, lat, lng, t, last, exp, up, ver, ct, fl FROM reports WHERE exp>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY t DESC LIMIT 200')
    .all(now, lat - d, lat + d, lng - d * 1.5, lng + d * 1.5)) {
    const row = [r.id, r.cat, r.lat, r.lng, Math.round(r.t / 1000), Math.round((r.last || r.t) / 1000), Math.round(r.exp / 1000), r.up || 0,
      (r.ver ? 1 : 0) | (r.ct ? 2 : 0) | (r.fl === 1 ? 4 : 0) | (r.fl === -1 && !r.up ? 8 : 0)];
    size += JSON.stringify(row).length + 1;
    if (size > 2800) break;
    out.push(row);
  }
  return { at: Math.round(now / 1000), lat, lng, r: out };
}
// Statistiques d'envoi depuis le démarrage (tableau de bord de l'admin) : réussis, expirés, refusés, sans réponse
const PSTATS = { since: Date.now(), sent: 0, ok: 0, gone: 0, fail: 0, codes: {}, batches: [] };
function pushStat(kind, codes) {
  const b = { t: Date.now(), kind, n: codes.length, ok: 0, gone: 0, fail: 0, codes: {} };
  for (const c of codes) {
    const k = c >= 200 && c < 300 ? 'ok' : c === 404 || c === 410 ? 'gone' : 'fail';
    b[k]++; PSTATS[k]++; PSTATS.sent++;
    if (k !== 'ok') { b.codes[c] = (b.codes[c] || 0) + 1; PSTATS.codes[c] = (PSTATS.codes[c] || 0) + 1; }
  }
  PSTATS.batches.unshift(b); PSTATS.batches.length = Math.min(PSTATS.batches.length, 20);
  // Dans le journal du serveur (journalctl -u cortege | grep push) : code 0 = pas de réponse du service de notification
  console.log(`push ${kind} : ${b.n} envoi(s), ${b.ok} reçu(s), ${b.gone} expiré(s), ${b.fail} échec(s)` + (b.fail ? ' ' + JSON.stringify(b.codes) : ''));
  return b;
}
async function pushSendAll(targets, payload, urgent = false, kind = 'envoi') {
  const dead = [];
  // payload : texte JSON, ou fonction (langue) → texte JSON, écrit une fois par langue
  const mk = typeof payload === 'function' ? payload : () => payload, byLang = new Map();
  const base = l => { if (!byLang.has(l)) byLang.set(l, JSON.parse(mk(l))); return byLang.get(l); };
  // Les abonné·es d'une même zone (arrondie à ~10 km) reçoivent les mêmes données : calculées une seule fois
  // (au plus PUSH_ZONES_MAX zones différentes par envoi : au-delà, la notification part sans les données)
  const memo = new Map(), dataFor = s => { const k = s.lat + ',' + s.lng; if (!memo.has(k)) { if (memo.size >= PUSH_ZONES_MAX) return null; memo.set(k, pushData(s.lat, s.lng)); } return memo.get(k); };
  const codes = await Promise.all(targets.map(s => pushOne(s, JSON.stringify({ ...base(PUSH_LANGS.includes(s.lang) ? s.lang : 'fr'), d: dataFor(s) }), urgent)));
  // Abonnement mort (404, 410) : supprimé. Autre refus définitif (400, 413…) : supprimé au 5e d'affilée.
  // Pas 403 ni 429 : c'est en général un souci de notre côté (jeton) ou une surcharge passagère.
  const failed = [], healed = [];
  codes.forEach((code, j) => {
    const t = targets[j];
    if (code === 404 || code === 410) dead.push(t.id);
    else if (code >= 400 && code < 500 && code !== 403 && code !== 429) { if ((t.fails || 0) + 1 >= PUSH_FAILS) dead.push(t.id); else failed.push(t.id); }
    else if (code >= 200 && code < 300 && t.fails) healed.push(t.id);
  });
  if (failed.length || healed.length) try { tx(() => { for (const id of failed) q('UPDATE push SET fails=COALESCE(fails,0)+1 WHERE id=?').run(id); for (const id of healed) q('UPDATE push SET fails=0 WHERE id=?').run(id); }); } catch {}
  pushStat(kind, codes);
  if (dead.length) try { tx(() => dead.forEach(id => q('DELETE FROM push WHERE id=?').run(id))); } catch {}
  return dead.length;
}
// « Danger près de toi » : abonné·es dont la zone (arrondie à ~10 km) est à moins de 10 km, au plus un envoi toutes les 3 min
const NEAR_GAP = 3 * MIN;
const nearKm = () => settings().nearKm || 10;
async function pushNear(r) {
  const NEAR_KM = nearKm(), now = Date.now(), c = CAT[r.cat], d = NEAR_KM / 111;
  const cand = q('SELECT * FROM push WHERE near=1 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?').all(r.lat - d, r.lat + d, r.lng - d * 1.5, r.lng + d * 1.5)
    .filter(s => distKm(s.lat, s.lng, r.lat, r.lng) <= NEAR_KM);
  // On réserve l'envoi (plusieurs processus peuvent tourner en même temps)
  const targets = tx(() => cand.filter(s => q('UPDATE push SET last=? WHERE id=? AND (last IS NULL OR last<?)').run(now, s.id, now - NEAR_GAP).changes));
  if (!targets.length) return;
  const payload = l => JSON.stringify({ title: `${c.glyph} ${tr(l, '{x} près de ta zone', { x: tr(l, c.label) })}`, body: tr(l, 'Signalé à l’instant. Ouvre Cortège pour voir où exactement.'),
    tag: 'near-' + r.cat, url: `/?at=${r.lat},${r.lng}`, vibrate: VIBES[r.cat] || [200, 100, 200] });
  await pushSendAll(targets, payload, false, 'danger');
}
const pushNearLater = r => setImmediate(() => pushNear(r).catch(e => console.error('push danger', e.message)));
async function pushBroadcast(a) {
  const targets = pushAll().filter(s => s.urg !== 0).filter(s => a.national || (s.lat != null && distKm(s.lat, s.lng, a.lat, a.lng) <= a.r + 8)).map(s => [s.id, s]);
  if (!targets.length) return;
  const payload = l => JSON.stringify({ title: (a.national ? '⚠ ' + tr(l, 'National') + ' · ' : '⚠ ') + a.by, body: a.text, tag: 'ann-' + a.id, url: '/', vibrate: [300, 100, 300, 100, 300] });
  await pushSendAll(targets.map(([, s]) => s), payload, true, 'annonce');
}

module.exports = { PUSH_MAX, PUSH_HOSTS, VAPID, PUSH_NET_MAX, PUSH_LANGS, tr, LOCALE, pushCount, pushAll, pushRunningNow, pushQueue, pushOne, PSTATS, pushStat, pushSendAll, nearKm, pushNearLater, pushBroadcast };
