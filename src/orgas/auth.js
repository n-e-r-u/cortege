'use strict';

const { ADMIN_KEY, ORGAS, RATE } = require('../config');
const { keyEq, sha } = require('../util');
const { clientHash, viaOnion } = require('../privacy');
const { q } = require('../db');
const { bump } = require('../limits');
const { readOrgas } = require('./store');
const { adminLabel } = require('../settings');

// Clés admin / orga : au-delà de 10 essais ratés en 5 min depuis un même réseau, tout est refusé,
// même la bonne clé (empêche de deviner une clé en essayant en boucle).
// Par Tor, chaque téléphone a son propre compteur, plus un compteur commun à tout Tor (ONION_KEY_TRIES) :
// changer d'identifiant à chaque essai ne redonne pas d'essais.
// En cas d'erreur de la base, on refuse (le verrou reste fermé) plutôt que de laisser essayer sans limite.
const KEY_TRIES = 10, ONION_KEY_TRIES = Number(process.env.ONION_KEY_TRIES) || 30;
const keySlots = req => [['key:' + clientHash(req), KEY_TRIES], ...(viaOnion(req) ? [['key:onion', ONION_KEY_TRIES]] : [])];
function keyLocked(req) {
  try {
    const now = Date.now();
    return keySlots(req).some(([k, max]) => { const r = q('SELECT t, reports FROM rate WHERE k=?').get(k); return !!r && now - r.t <= RATE.windowMs && r.reports >= max; });
  } catch { return true; }
}
function keyFailed(req) { try { for (const [k] of keySlots(req)) bump(k, 'report', Infinity, Date.now()); } catch {} }
function isAdmin(req) {
  const k = String(req.headers['x-admin-key'] || '');
  if (!ADMIN_KEY || !k || keyLocked(req)) return false;
  if (keyEq(k, ADMIN_KEY)) return true;
  keyFailed(req); return false;
}
function orgaOf(req) {
  const k = String(req.headers['x-orga-key'] || '');
  if (!k || keyLocked(req)) return null;
  if (ADMIN_KEY && keyEq(k, ADMIN_KEY)) return { id: 'admin', label: adminLabel(), admin: true, trial: false };
  const env = ORGAS.find(o => keyEq(k, o.key));
  if (env) return { id: 'env:' + env.label, label: env.label, admin: false, trial: false };
  const h = sha(k);
  // Une orga peut avoir plusieurs appareils : une clé principale (hash) et des clés d'appareils supplémentaires (keys)
  const o = readOrgas().find(o => keyEq(h, o.hash) || (o.keys || []).some(x => keyEq(h, x)));
  // Période d'essai : trial ; « parrainée » = invitée par une autre orga, surveillance renforcée jusqu'à sa confirmation
  if (o) return { id: o.id, label: o.label, admin: false, trial: o.trial === true, sponsored: o.sponsored === true && o.trial === true, by: o.by || null };
  keyFailed(req); return null;
}

module.exports = { KEY_TRIES, keyLocked, keyFailed, isAdmin, orgaOf };
