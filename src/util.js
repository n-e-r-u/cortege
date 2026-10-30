'use strict';
// Petits outils sans état : comparaison de noms, distances, empreintes, verrou de fichier.
const fs = require('fs');
const crypto = require('crypto');
const { LOCK_FILE } = require('./config');

// ---- Noms d'orga : comparés sans accents, majuscules, espaces ni lettres sosies (cyrillique, grec) ----
// Le nom n'est qu'un affichage : les droits (retirer une annonce, un événement) passent par l'identifiant de l'orga.
const SOSIES = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ӏ': 'l',
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', '0': 'o', '1': 'l' };
const labelKey = l => String(l || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/./gu, c => SOSIES[c] || c).replace(/[^a-z0-9]/g, '');
const distM = (a, b) => {
  const k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
};
function keyEq(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
const sha = k => crypto.createHash('sha256').update(String(k)).digest('hex');
const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const e = Date.now() + ms; while (Date.now() < e); } };
function withLock(fn, lockFile = LOCK_FILE) {
  let fd;
  for (let i = 0; ; i++) {
    try { fd = fs.openSync(lockFile, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lockFile).mtimeMs > 3000) fs.unlinkSync(lockFile); } catch {}
      if (i > 300) throw new Error('busy');
      sleep(10);
    }
  }
  try { return fn(); } finally { fs.closeSync(fd); try { fs.unlinkSync(lockFile); } catch {} }
}

const wait = ms => new Promise(go => setTimeout(go, ms));

const h8 = str => crypto.createHash('sha1').update(str).digest('base64url').slice(0, 10);

module.exports = { SOSIES, labelKey, distM, keyEq, sha, sleep, withLock, wait, h8 };
