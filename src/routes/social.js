'use strict';
// Routes de l'admin pour le partage sur Bluesky et Mastodon : réglages, messages en attente, envoi à la main, retrait
const { NEXT } = require('./next');
const { send, readJson } = require('../http/respond');
const { isAdmin } = require('../orgas/auth');
const S = require('../social');

async function socialRoutes(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/admin/social')) return NEXT;
  if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
  if (req.method === 'GET' && p === '/api/admin/social') return send(res, 200, S.socialAdmin());
  if (req.method === 'POST' && p === '/api/admin/social/config') return send(res, 200, { cfg: S.saveSocialCfg(await readJson(req, 4096)) });
  if (req.method === 'POST' && p === '/api/admin/social/test') return send(res, 200, await S.socialTest());
  if (req.method === 'POST' && p === '/api/admin/social/post') return send(res, ...S.socialManual(await readJson(req, 8192)));
  const m = p.match(/^\/api\/admin\/social\/([\w-]{1,16})(?:\/(send|skip|retry))?$/);
  if (m && req.method === 'POST' && m[2]) return send(res, ...S.socialAct(m[1], m[2], await readJson(req, 8192)));
  if (m && req.method === 'DELETE' && !m[2]) return send(res, ...await S.socialDelete(m[1]));
  return send(res, 404, { error: 'Introuvable.' });
}
module.exports = { socialRoutes };
