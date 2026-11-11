'use strict';
// Routes de la boîte à idées : liste publique, proposition, vote (téléphones) ; validation et suivi (admin)
const { NEXT } = require('./next');
const { send, readJson } = require('../http/respond');
const { isAdmin } = require('../orgas/auth');
const I = require('../ideas');
const G = require('../github');

async function ideasRoutes(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/ideas') && !p.startsWith('/api/admin/ideas')) return NEXT;
  if (req.method === 'GET' && p === '/api/ideas') {
    const view = ['top', 'new', 'done', 'no', 'vote'].includes(url.searchParams.get('v')) ? url.searchParams.get('v') : 'top';
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { ideas: I.listIdeas(req, view) });
  }
  if (req.method === 'POST' && p === '/api/ideas') return send(res, ...I.proposeIdea(req, await readJson(req, 2048)));
  const v = p.match(/^\/api\/ideas\/([\w-]{1,16})\/vote$/);
  // { v: 1 | -1 | 0 } ; { on: true | false } des téléphones pas encore à jour vaut pour ou retrait
  if (v && req.method === 'POST') { const b = await readJson(req); return send(res, ...I.voteIdea(req, v[1], 'v' in b ? Number(b.v) : (b.on !== false ? 1 : 0))); }
  if (p.startsWith('/api/admin/ideas')) {
    if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    if (req.method === 'GET' && p === '/api/admin/ideas') return send(res, 200, { ideas: I.adminList(), pending: I.pendingCount(), github: G.ghStatus() });
    if (req.method === 'POST' && p === '/api/admin/ideas/github-sync') { if (!G.ghStatus().ready) return send(res, 409, { error: 'GitHub n’est pas configuré.' }); G.kick(100); return send(res, 202, { ok: true }); }
    const m = p.match(/^\/api\/admin\/ideas\/([\w-]{1,16})(\/merge)?$/);
    if (m && req.method === 'POST' && m[2]) return send(res, ...I.adminMerge(m[1], String((await readJson(req)).into || '')));
    if (m && req.method === 'POST') return send(res, ...I.adminUpdate(m[1], await readJson(req, 4096)));
    if (m && req.method === 'DELETE') return I.adminDelete(m[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Idée introuvable.' });
  }
  return send(res, 404, { error: 'Introuvable.' });
}
module.exports = { ideasRoutes };
