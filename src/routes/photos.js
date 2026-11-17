'use strict';
// Routes des photos jointes aux signalements (voir src/photos.js) : envoi, affichage, « Signaler la photo », retrait et
// remise par les orgas, choix de l'admin pour le bilan public, photos des bilans.
const { NEXT } = require('./next');
const { send, readJson } = require('../http/respond');
const { isAdmin, orgaOf, keyRefusal } = require('../orgas/auth');
const { orgaLog } = require('../orgas/log');
const { deviceHash, clientHash } = require('../privacy');
const { getReport, saveReport } = require('../reports/store');
const { quota, allow } = require('../limits');
const { tx } = require('../db');
const P = require('../photos');

// Corps brut limité en taille (la photo, en JPEG)
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// Le point change d'aspect sur la carte (photo ajoutée, cachée, retirée) : sa case est republiée
const touch = rid => { const r = getReport(rid, Date.now()); if (r) saveReport(r); };
const jpeg = (res, buf, cache) => send(res, 200, buf, { 'Content-Type': 'image/jpeg', 'Cache-Control': cache, 'Content-Disposition': 'inline' });
// Orga confirmée ou admin (clé d'orga ou clé admin)
const staff = req => (isAdmin(req) ? { id: 'admin', label: 'admin', admin: true } : req.headers['x-orga-key'] ? orgaOf(req) : null);

async function photosRoutes(req, res, url, pathname) {
  if (!pathname.startsWith('/api/reports/') && !pathname.startsWith('/api/photos/') && !pathname.startsWith('/api/admin/photos') && !pathname.startsWith('/bilans/photo/')) return NEXT;

  // Envoi : le JPEG sorti du Flouteur, pour un point encore actif
  let m = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/photo$/);
  if (m && req.method === 'POST') {
    if (!/^image\/jpeg$/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'Format refusé.' });
    const buf = await readRaw(req, P.MAX_BYTES + 1024).catch(() => null);
    if (!buf) return send(res, 413, { error: 'Photo trop lourde : passe-la par le flouteur de Cortège.' });
    const dev = deviceHash(req), ipH = clientHash(req), now = Date.now();
    const out = tx(() => {
      if (!allow(dev, ipH, 'report', now)) return [429, { error: 'Trop d’envois d’un coup. Réessaie dans quelques minutes.' }];
      const r = getReport(m[1], now);
      const o = P.addPhoto(r, buf, { dev, quota }, now);
      if (o[0] === 201) saveReport(r);
      return o;
    });
    return send(res, ...out);
  }

  // Photo d'un point : publique si le point est vérifié ou fiable, sinon pour les orgas et l'admin
  m = pathname.match(/^\/api\/photos\/([\w-]{12})$/);
  if (m && req.method === 'GET') {
    const p = P.getPhoto(m[1]), r = p ? getReport(p.rid, Date.now()) : null, acc = P.photoAccess(p, r);
    if (!acc) return send(res, 404, { error: 'Photo introuvable.' });
    if (acc === 'staff') {
      const s = staff(req);
      if (!s) return req.headers['x-orga-key'] ? send(res, ...keyRefusal(req)) : send(res, 403, { error: 'Photo en attente de vérification.' });
    }
    const buf = P.photoFile(p);
    return buf ? jpeg(res, buf, acc === 'public' ? 'public, max-age=300' : 'private, no-store') : send(res, 404, { error: 'Photo introuvable.' });
  }
  m = pathname.match(/^\/api\/photos\/([\w-]{12})\/(flag|remove|restore)$/);
  if (m && req.method === 'POST') {
    await readJson(req).catch(() => ({}));
    const p = P.getPhoto(m[1]);
    if (!p) return send(res, 404, { error: 'Photo introuvable.' });
    if (m[2] === 'flag') {
      const dev = deviceHash(req), ipH = clientHash(req);
      if (!allow(dev, ipH, 'vote', Date.now())) return send(res, 429, { error: 'Trop d’envois, patiente un peu.' });
      const out = P.flagPhoto(p, dev);
      if (out[1].hidden) touch(p.rid);
      return send(res, ...out);
    }
    const s = staff(req);
    if (!s) return req.headers['x-orga-key'] ? send(res, ...keyRefusal(req)) : send(res, 403, { error: 'Réservé aux orgas.' });
    const ok = m[2] === 'remove' ? P.removePhoto(p) : P.restorePhoto(p);
    if (!ok) return send(res, 400, { error: m[2] === 'remove' ? 'Photo déjà retirée.' : 'Rien à remettre.' });
    if (!s.admin) orgaLog(s, m[2] === 'remove' ? 'photo retirée' : 'photo remise', { lat: p.lat, lng: p.lng, ref: p.rid });
    touch(p.rid);
    return send(res, 200, { ok: true });
  }

  // Admin : photos d'un jour (digest), et choix de celles qui restent sur le bilan public
  if (pathname.startsWith('/api/admin/photos')) {
    if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    if (req.method === 'GET' && pathname === '/api/admin/photos') {
      const day = String(url.searchParams.get('date') || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: 'Date invalide.' });
      return send(res, 200, { photos: P.dayPhotos(day), keepDays: Math.round(P.KEEP_MS / 86_400_000) });
    }
    m = pathname.match(/^\/api\/admin\/photos\/([\w-]{12})\/keep$/);
    if (m && req.method === 'POST') {
      const b = await readJson(req);
      const p = P.getPhoto(m[1]);
      if (!p) return send(res, 404, { error: 'Photo introuvable.' });
      if (!P.keepPhoto(p, b.keep === true)) return send(res, 400, { error: 'Photo déjà retirée.' });
      return send(res, 200, { ok: true, kept: b.keep === true });
    }
    return NEXT;
  }

  // Photos gardées pour un bilan public : permanentes, pour tout le monde
  m = pathname.match(/^\/bilans\/photo\/([\w-]{12})\.jpg$/);
  if (m && req.method === 'GET') {
    const p = P.getPhoto(m[1]);
    if (!p || p.st !== 'kept') return send(res, 404, 'Not found');
    const buf = P.photoFile(p);
    return buf ? jpeg(res, buf, 'public, max-age=86400') : send(res, 404, 'Not found');
  }
  return NEXT;
}

module.exports = { photosRoutes };
