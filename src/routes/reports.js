'use strict';
// Routes des participant·es : digest, proposition d'arrêté ou d'événement, puis l'envoi d'un signalement
// (reports-create.js) et les actions sur un signalement existant (reports-actions.js).
const fs = require('fs');
const { ADMIN_KEY } = require('../config');
const { CATEGORIES, GROUPS } = require('../categories');
const { NEXT } = require('./next');
const { clientHash, deviceHash, netHash } = require('../privacy');
const { commIndex } = require('../geo/communes');
const { createEvent } = require('../events/create');
const { createOrder } = require('../orders');
const { dayRows, dayCountFr } = require('../digest/day');
const { getPub } = require('../digest/pub');
const { isAdmin, orgaOf, keyRefusal } = require('../orgas/auth');
const { listEvents } = require('../events/store');
const { orgaLog } = require('../orgas/log');
const { ARCHIVE_DIR } = require('../digest/archive');
const { q } = require('../db');
const { send, readJson } = require('../http/respond');
const { sweep } = require('../sweep');
const { parisDay } = require('../time');
const { reportsCreateRoutes } = require('./reports-create');
const { reportsActionsRoutes } = require('./reports-actions');

async function reportsRoutes(req, res, url, pathname) {
  if (req.method === 'GET' && pathname === '/api/digest') {
    if (!ADMIN_KEY) return send(res, 404, { error: 'Digest désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
    if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    const date = String(url.searchParams.get('date') || parisDay(Date.now()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Date invalide.' });
    sweep(); // archive ce qui vient d'expirer
    const { rows, zones, abroad } = dayRows(date);
    // Activité des orgas et anti-abus ce jour-là
    const day0 = Date.parse(date + 'T00:00:00+02:00'), lo = day0 - 2 * 3600e3, hi = day0 + 26 * 3600e3;
    const logs = q('SELECT t, oid, action, detail FROM orga_log WHERE t BETWEEN ? AND ?').all(lo, hi).filter(x => parisDay(x.t) === date);
    const cnt = f => logs.filter(f).length;
    const orga = { verified: cnt(x => /^vérifié|^confirmé \(parrainée\)/.test(x.action)), removed: cnt(x => x.oid !== 'admin' && /^retiré|^retrait \(essai\)/.test(x.action)), adminRemoved: cnt(x => x.oid === 'admin' && x.action === 'retiré'),
      announcements: cnt(x => x.action === 'annonce'), urgent: cnt(x => x.action === 'annonce' && /\[urgent\]/.test(x.detail || '')),
      legal: cnt(x => /^legal team/.test(x.action)), restored: cnt(x => x.action === 'restauré'), contested: cnt(x => x.action === 'contesté') };
    const abuse = {};
    for (const x of q('SELECT t, kind FROM abuse WHERE t BETWEEN ? AND ?').all(lo, hi)) if (parisDay(x.t) === date) abuse[x.kind] = (abuse[x.kind] || 0) + 1;
    // Comparaison : les 14 jours précédents
    const history = [];
    for (let i = 14; i >= 0; i--) { const d = parisDay(Date.parse(date + 'T12:00:00+02:00') - i * 86400e3); history.push({ date: d, total: i ? dayCountFr(d) : rows.length }); }
    const events = listEvents().filter(e => parisDay(e.start) === date && e.status !== 'pending').map(e => ({ title: e.title, type: e.type, place: e.place, start: e.start }));
    return send(res, 200, { date, rows, zones, abroad, communes: commIndex().rows.length > 0, orga, abuse, history, events, published: !!getPub(date),
      categories: CATEGORIES.map(({ id, label, glyph, group, ttl }) => ({ id, label, glyph, group, ttl })), groups: GROUPS,
      days: fs.readdirSync(ARCHIVE_DIR).map(f => f.slice(0, 10)).sort().reverse() });
  }
  
  // Proposer un arrêté ou une restriction (validé par l'admin avant d'apparaître)
  if (req.method === 'POST' && pathname === '/api/orders') return send(res, ...await createOrder(await readJson(req, 8192), { dev: deviceHash(req), ipH: clientHash(req), net: netHash(req) }));
  
  // Agenda : une orga publie directement, un·e participant·e propose (validé ensuite par l'admin)
  if (req.method === 'POST' && pathname === '/api/events') {
    const b = await readJson(req, 16384);
    const orga = req.headers['x-orga-key'] ? orgaOf(req) : null;
    if (req.headers['x-orga-key'] && !orga) return send(res, ...keyRefusal(req));
    const out = createEvent(b, orga, deviceHash(req), clientHash(req), netHash(req));
    if (orga && out[0] < 300) orgaLog(orga, out[1].status === 'pending' ? 'événement (en attente)' : 'événement', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id, detail: out[1].title });
    return send(res, ...out);
  }
  
  for (const part of [reportsCreateRoutes, reportsActionsRoutes]) {
    const out = await part(req, res, url, pathname);
    if (out !== NEXT) return out;
  }
  return NEXT;
}

module.exports = { reportsRoutes };
