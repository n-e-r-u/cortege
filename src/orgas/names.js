'use strict';
const { ADMIN_LABEL_ENV, IMPORT_NAMES, ORGAS } = require('../config');
const { VOTES } = require('../reports/votes');
const { adminLabel } = require('../settings');
const { labelKey } = require('../util');
const { legalAll } = require('../legal');
const { readOrgas } = require('./store');
const { tx, q } = require('../db');

// Noms interdits : celui de l'admin, les sources importées, les orgas existantes ; pour une orga invitée par parrainage,
// aussi l'annuaire des legal teams et tout nom qui contient celui de l'admin (« Cortège officiel »…)
function labelClash(label, { sponsor = false, except = null } = {}) {
  const k = labelKey(label), admin = labelKey(adminLabel());
  if (k.length < 2) return 'Ce nom est trop court.';
  const reserved = [adminLabel(), ADMIN_LABEL_ENV, 'Cortège', 'admin', 'administration', 'modération', VOTES.label, ...IMPORT_NAMES].map(labelKey);
  if (reserved.includes(k) || (sponsor && (k.includes(admin) || k.includes('cortege')))) return 'Ce nom est réservé.';
  if (readOrgas().some(o => o.id !== except && labelKey(o.label) === k) || ORGAS.some(o => labelKey(o.label) === k)) return 'Une orga porte déjà ce nom.';
  if (sponsor && legalAll().some(e => labelKey(e.name) === k)) return 'Ce nom est celui d’une legal team de l’annuaire : seul·e l’admin peut l’inviter.';
  return null;
}
// Annonces et événements d'avant la 2.6.4 : auteur retrouvé par son nom, seulement s'il n'y a aucun doute
function migrateOwners() {
  const owners = new Map(), addO = (label, id) => { const k = labelKey(label); owners.set(k, [...(owners.get(k) || []), id]); };
  addO(adminLabel(), 'admin'); for (const o of ORGAS) addO(o.label, 'env:' + o.label); for (const o of readOrgas()) addO(o.label, o.id);
  const pick = by => { if (IMPORT_NAMES.includes(by)) return 'import'; const ids = owners.get(labelKey(by)) || []; return ids.length === 1 ? ids[0] : null; };
  let n = 0;
  tx(() => {
    for (const x of q('SELECT id, data FROM ann').all()) { const a = JSON.parse(x.data); if ('oid' in a) continue; a.oid = pick(a.by); q('UPDATE ann SET data=? WHERE id=?').run(JSON.stringify(a), x.id); n++; }
    for (const x of q('SELECT id, data FROM events').all()) { const e = JSON.parse(x.data); if ('oid' in e) continue; e.oid = e.src ? 'import' : pick(e.by); q('UPDATE events SET data=? WHERE id=?').run(JSON.stringify(e), x.id); n++; }
  });
  if (n) console.log(`auteurs : ${n} annonce(s) ou événement(s) rattaché(s) à leur orga`);
}

module.exports = { labelClash, migrateOwners };
