'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, MIN } = require('./config');
const { cityIdx } = require('./pages/city-cache');
const { clean, round, validLatLng } = require('./util');
const { dirty, scheduleFlush } = require('./live/files');
const { q, getMeta, setMeta, tx } = require('./db');

// ---- Annuaire permanent des legal teams ----
const legalAll = () => q('SELECT data FROM legal_dir').all().map(x => JSON.parse(x.data)).sort((a, b) => a.city.localeCompare(b.city, 'fr') || a.name.localeCompare(b.name, 'fr'));
const getLegal = id => { const x = q('SELECT data FROM legal_dir WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveLegal(e) { cityIdx.at = 0; q('INSERT OR REPLACE INTO legal_dir(id,data) VALUES(?,?)').run(e.id, JSON.stringify(e)); dirty.legal = true; scheduleFlush(); }
const legalView = e => ({ id: e.id, city: e.city, lat: e.lat, lng: e.lng, name: e.name, phone: e.phone, signal: !!e.signal, src: e.src || null, checked: e.checked || null });
const phoneDigits = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2); return d; };
// Tous les numéros français d'une page, normalisés (0XXXXXXXXX)
const phonesIn = text => [...new Set((String(text).match(/(?:\+33[\s.\-]?|0)[1-9](?:[\s.\-]?\d{2}){4}/g) || []).map(phoneDigits))].sort();
function cleanLegal(b, old) {
  const e = { ...(old || {}) };
  e.city = clean(b.city ?? e.city, 40); e.name = clean(b.name ?? e.name, 80);
  e.phone = String(b.phone ?? e.phone ?? '').replace(/[^\d+ .]/g, '').trim().slice(0, 20);
  e.signal = b.signal === undefined ? !!e.signal : !!b.signal;
  const src = String(b.src ?? e.src ?? '').trim();
  e.src = /^https?:\/\/[^\s"<>]{4,400}$/.test(src) ? src : null;
  if (b.lat !== undefined) { e.lat = round(Number(b.lat)); e.lng = round(Number(b.lng)); }
  if (b.srcDate !== undefined) e.srcDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.srcDate)) ? b.srcDate : null;
  if (e.city.length < 2) return [400, 'Indique la ville.'];
  if (e.name.length < 2) return [400, 'Indique le nom du collectif.'];
  if (phoneDigits(e.phone).length < 6) return [400, 'Numéro de téléphone invalide.'];
  if (!validLatLng(e.lat, e.lng)) return [400, 'Position invalide (choisis la ville dans la recherche).'];
  return [200, e];
}
function seedLegal() {
  if (getMeta('legalseed')) return;
  try {
    const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'legal-seed.json'), 'utf8'));
    for (const b of list) if (!getLegal(b.id)) { const [st, e] = cleanLegal(b, { id: b.id, ok: false, added: Date.now(), seed: true }); if (st === 200) saveLegal(e); }
  } catch (e) { if (e.code !== 'ENOENT') console.error('annuaire', e.message); }
  setMeta('legalseed', Date.now());
}
const LEGAL_WATCH_MS = 24 * 60 * MIN;
// Adresse publique seulement : jamais le serveur lui-même, le réseau local, ni les adresses internes des hébergeurs (métadonnées)
const BLOCKED_IP = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|198\.1[89]\.|22[4-9]\.|2[3-5]\d\.|::$|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|::ffff:(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.))/i;
// Page web d'une source (veille des legal teams) : HTTP(S) sur les ports habituels, adresse vérifiée au moment même de la connexion
// (une redirection ou un nom de domaine qui change d'adresse ne peut pas mener au réseau interne), 3 redirections au plus.
function fetchPublic(url, { max = 3_000_000, timeout = 15000, hops = 3 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('adresse invalide')); }
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port) && process.env.FETCH_ALLOW_PRIVATE !== '1') || u.username || u.password) return reject(new Error('adresse refusée'));
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    const lookup = (host, opts, cb) => require('dns').lookup(host, { ...opts, all: false }, (err, addr, fam) => {
      if (err) return cb(err);
      if (BLOCKED_IP.test(addr) && process.env.FETCH_ALLOW_PRIVATE !== '1') return cb(new Error('adresse interne refusée'));
      cb(null, addr, fam);
    });
    const req = lib.get(u, { lookup, timeout, headers: { 'user-agent': 'Cortege-veille/1 (verification annuaire legal teams)' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops <= 0) return reject(new Error('trop de redirections'));
        return resolve(fetchPublic(new URL(res.headers.location, u).href, { max, timeout, hops: hops - 1 }));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0; const parts = [];
      res.on('data', c => { size += c.length; if (size > max) { res.destroy(); resolve(Buffer.concat(parts).toString('utf8')); } else parts.push(c); });
      res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      res.on('error', () => reject(new Error('lecture interrompue')));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e2 => reject(new Error(/interne|refusée|délai/.test(e2.message) ? e2.message : 'site injoignable')));
  });
}
async function watchOne(e) {
  const w = { at: Date.now() };
  try {
    const html = await fetchPublic(e.src);
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
    w.phones = phonesIn(text);
    w.found = w.phones.includes(phoneDigits(e.phone));
  } catch (err) { w.err = String(err.message).slice(0, 80); }
  return w;
}
// État de la veille pour une ligne : ok, missing (numéro absent de la source), changed (numéros différents), error
function watchStatus(e) {
  const w = e.watch; if (!w) return 'new';
  if (w.err) return 'error';
  if (!w.found) return 'missing';
  if (e.base && JSON.stringify(e.base) !== JSON.stringify(w.phones)) return 'changed';
  return 'ok';
}
async function legalWatch(force = false) {
  // Un seul processus fait la veille : on réserve le tour dans la base
  const claimed = tx(() => { const last = +getMeta('legalwatch') || 0; if (!force && Date.now() - last < LEGAL_WATCH_MS) return false; setMeta('legalwatch', Date.now()); return true; });
  if (!claimed) return false;
  for (const e of legalAll().filter(x => x.src)) {
    const w = await watchOne(e);
    const cur = getLegal(e.id); if (!cur) continue;
    cur.watch = w;
    if (!cur.base && w.phones && w.found) cur.base = w.phones; // première lecture réussie : sert de référence
    q('INSERT OR REPLACE INTO legal_dir(id,data) VALUES(?,?)').run(cur.id, JSON.stringify(cur)); // pas de republication : rien de public ne change
  }
  return true;
}
const legalAlerts = () => legalAll().filter(e => ['missing', 'changed', 'error'].includes(watchStatus(e)) || !e.ok).length;

module.exports = { legalAll, getLegal, saveLegal, legalView, phoneDigits, cleanLegal, seedLegal, watchStatus, legalWatch, legalAlerts };
