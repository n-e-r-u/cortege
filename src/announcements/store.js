'use strict';
// Annonces (urgentes, legal teams, nationales) : lecture, enregistrement, retrait, vue publique.
const { q } = require('../db');
const { dirty, scheduleFlush } = require('../live/files');
const { ownerTag } = require('../orgas/owner');

// Annonces
const annAll = now => q('SELECT data FROM ann WHERE exp>? ORDER BY rowid').all(now).map(x => JSON.parse(x.data));
const annActive = now => annAll(now).filter(a => !a.pending);
const getAnn = id => { const x = q('SELECT data FROM ann WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveAnn(a) { q('INSERT OR REPLACE INTO ann(id,exp,data) VALUES(?,?,?)').run(a.id, a.exp, JSON.stringify(a)); dirty.ann = true; scheduleFlush(); }
function dropAnn(id) { const n = q('DELETE FROM ann WHERE id=?').run(id).changes; if (n) { dirty.ann = true; scheduleFlush(); } return n > 0; }

const annView = a => ({ id: a.id, kind: a.kind, level: a.level, text: a.text, phone: a.phone || null, city: a.city || null, by: a.by, ob: ownerTag(a.oid), lat: a.lat, lng: a.lng, r: a.r,
  national: !!a.national, permanent: !!a.permanent, link: a.link || null, t: a.t, exp: a.exp, ...(a.pending ? { pending: true } : {}) });

module.exports = { annAll, annActive, getAnn, saveAnn, dropAnn, annView };
