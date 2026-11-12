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
// Adresse publique seulement : jamais le serveur lui-même, le réseau local, ni les adresses internes des hébergeurs (métadonnées).
// Les formes IPv6 qui enveloppent une IPv4 (::ffff:, 64:ff9b::, 2002::) sont ramenées à l'IPv4 avant le test.
const net = require('net');
const BLOCK = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) BLOCK.addSubnet(a, n, 'ipv4');
for (const [a, n] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['100::', 64], ['2001:db8::', 32]]) BLOCK.addSubnet(a, n, 'ipv6');
function v4Inside(a) {
  const m = a.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i); if (m) return m[1];
  const w = a.toLowerCase().split(':');
  const hex = (h, l) => [parseInt(h || '0', 16) >> 8, parseInt(h || '0', 16) & 255, parseInt(l || '0', 16) >> 8, parseInt(l || '0', 16) & 255].join('.');
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(a)) return hex(w[3], w[4]);
  if (/^64:ff9b::/i.test(a)) { const t = a.slice(9); if (net.isIPv4(t)) return t; const [h, l] = t.split(':'); return hex(h, l); }
  if (/^2002:/i.test(a)) return hex(w[1], w[2]);
  return null;
}
function blockedIp(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const fam = net.isIP(a); if (!fam) return true; // illisible : refusé
  if (fam === 4) return BLOCK.check(a, 'ipv4');
  const v4 = v4Inside(a); if (v4 && net.isIPv4(v4)) return BLOCK.check(v4, 'ipv4');
  return BLOCK.check(a, 'ipv6');
}
// Page web d'une source (veille des legal teams) : HTTP(S) sur les ports habituels, adresse vérifiée au moment même de la connexion
// (une redirection ou un nom de domaine qui change d'adresse ne peut pas mener au réseau interne), 3 redirections au plus.
// Une adresse IP écrite directement dans le lien ne passe pas par la résolution DNS : elle est vérifiée ici avant toute connexion.
function fetchPublic(url, opts = {}) { return fetchPublicFull(url, opts).then(r => r.buf.toString('utf8')); }
// Même garde, réponse complète (octets, en-têtes, adresse finale) : sert aussi à la veille des préfectures et à ses recueils PDF.
// strict : une réponse plus lourde que max est refusée au lieu d'être coupée ; headers : en-têtes ajoutés (cache conditionnel).
function fetchPublicFull(url, { max = 3_000_000, timeout = 15000, hops = 3, headers = {}, strict = false, ua = 'Cortege-veille/1 (verification annuaire legal teams)' } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('adresse invalide')); }
    const open = process.env.FETCH_ALLOW_PRIVATE === '1';
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port) && !open) || u.username || u.password) return reject(new Error('adresse refusée'));
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) && blockedIp(bare) && !open) return reject(new Error('adresse interne refusée'));
    const lib = u.protocol === 'https:' ? require('https') : require('http');
    // Respecte opts.all (Node 20+ appelle lookup avec all:true pour essayer plusieurs adresses) : toutes les adresses sont vérifiées
    const lookup = (host, o, cb) => require('dns').lookup(host, { ...o, all: true }, (err, list) => {
      if (err) return cb(err);
      if (!list.length) return cb(new Error('site injoignable'));
      if (!open && list.some(x => blockedIp(x.address))) return cb(new Error('adresse interne refusée'));
      if (o && o.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
    // Durée totale bornée (pas seulement l'inactivité) : un site qui envoie au compte-gouttes ne retient pas la veille
    const kill = setTimeout(() => req.destroy(new Error('délai dépassé')), timeout * 4);
    const done = (fn, v) => { clearTimeout(kill); fn(v); };
    const req = lib.get(u, { lookup, timeout, headers: { 'user-agent': ua, ...headers } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops <= 0) return done(reject, new Error('trop de redirections'));
        clearTimeout(kill);
        return resolve(fetchPublicFull(new URL(res.headers.location, u).href, { max, timeout, hops: hops - 1, headers, strict, ua }));
      }
      if (res.statusCode === 304) { res.resume(); return done(resolve, { status: 304, headers: res.headers, buf: Buffer.alloc(0), url: u.href }); }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return done(reject, new Error('HTTP ' + res.statusCode)); }
      if (strict && +(res.headers['content-length'] || 0) > max) { res.destroy(); return done(reject, new Error('trop lourd')); }
      let size = 0; const parts = [];
      const out = () => ({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(parts), url: u.href });
      res.on('data', c => { size += c.length; if (size > max) { res.destroy(); strict ? done(reject, new Error('trop lourd')) : done(resolve, out()); } else parts.push(c); });
      res.on('end', () => done(resolve, out()));
      res.on('error', () => done(reject, new Error('lecture interrompue')));
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e2 => done(reject, new Error(/interne|refusée|délai/.test(e2.message) ? e2.message : 'site injoignable')));
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

module.exports = { fetchPublic, fetchPublicFull, blockedIp, legalAll, getLegal, saveLegal, legalView, phoneDigits, cleanLegal, seedLegal, watchStatus, legalWatch, legalAlerts };
