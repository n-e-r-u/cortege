'use strict';
// Webhook GitHub (événements « Issues ») : un ticket d'idée fermé ou rouvert sur GitHub change le statut de l'idée.
// Signature HMAC obligatoire (GITHUB_WEBHOOK_SECRET) : sans secret, la route répond 404.
const { NEXT } = require('./next');
const { send } = require('../http/respond');
const G = require('../github');

const readRaw = (req, max) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const seen = new Set();
async function githubRoutes(req, res, url) {
  if (url.pathname !== '/api/github/webhook') return NEXT;
  if (!process.env.GITHUB_WEBHOOK_SECRET) return send(res, 404, { error: 'Introuvable.' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST seulement.' });
  let raw; try { raw = await readRaw(req, 512 * 1024); } catch { return send(res, 413, { error: 'Trop gros.' }); }
  if (!G.ghVerify(raw, req.headers['x-hub-signature-256'])) return send(res, 401, { error: 'Signature incorrecte.' });
  // Un même envoi (identifiant de livraison de GitHub) n'est pris en compte qu'une fois : un envoi signé intercepté ne se rejoue pas
  const id = String(req.headers['x-github-delivery'] || '');
  if (!/^[\w-]{8,64}$/.test(id)) return send(res, 400, { error: 'Livraison sans identifiant.' });
  if (seen.has(id)) return send(res, 200, { ok: true, duplicate: true });
  seen.add(id); if (seen.size > 5000) seen.delete(seen.values().next().value);
  let p; try { p = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'JSON invalide.' }); }
  return send(res, 200, G.ghEvent(String(req.headers['x-github-event'] || ''), p));
}
module.exports = { githubRoutes };
