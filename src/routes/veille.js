'use strict';
// Routes de l'admin pour la veille des arrêtés (pages de préfecture surveillées, liens repérés)
const { NEXT } = require('./next');
const { send, readJson } = require('../http/respond');
const { isAdmin } = require('../orgas/auth');
const V = require('../veille');

async function veilleRoutes(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/admin/veille')) return NEXT;
  if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
  if (req.method === 'GET' && p === '/api/admin/veille') return send(res, 200, V.veilleAdmin());
  if (req.method === 'POST' && p === '/api/admin/veille/sources') return send(res, ...await V.veilleAdd(await readJson(req, 4096)));
  if (req.method === 'POST' && p === '/api/admin/veille/run') { await V.readPdfs(10); return send(res, 200, { ok: true }); }
  if (req.method === 'POST' && p === '/api/admin/veille/prefectures') return send(res, ...V.veilleAddAll());
  let m = p.match(/^\/api\/admin\/veille\/sources\/([\w-]{1,16})(\/test)?$/);
  if (m && req.method === 'POST' && m[2]) return send(res, ...await V.veilleTest(m[1]));
  if (m && req.method === 'DELETE' && !m[2]) return send(res, ...V.veilleDel(m[1]));
  m = p.match(/^\/api\/admin\/veille\/hits\/([\w-]{1,16})$/);
  if (m && req.method === 'POST') return send(res, ...V.veilleHit(m[1], (await readJson(req, 1024)).status));
  return send(res, 404, { error: 'Introuvable.' });
}
module.exports = { veilleRoutes };
