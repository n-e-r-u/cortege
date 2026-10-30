'use strict';
const crypto = require('crypto');
const { EVT } = require('../categories');
const { MIN } = require('../config');
const { allow, quota, ORGA_LIMITS } = require('../limits');
const { clean, validLatLng, distKm, round } = require('../util');
const { saveEvent, evView } = require('./store');
const { tx, q } = require('../db');

// ---- Agenda : création d'événement (orga = publié tout de suite ; participant·e = proposition à valider) ----
function createEvent(b, orga, dev, ipH) {
  const type = Object.hasOwn(EVT, String(b.type)) ? b.type : 'manif';
  const title = clean(b.title, 80), place = clean(b.place, 100), note = clean(b.note, 220);
  const start = Number(b.start), lat = Number(b.lat), lng = Number(b.lng);
  if (title.length < 3) return [400, { error: 'Donne un titre (ex. : Blocus lycée Jean-Monnet).' }];
  if (place.length < 2) return [400, { error: 'Indique le lieu de rendez-vous.' }];
  if (!(start > Date.now() - 2 * 60 * MIN && start < Date.now() + 90 * 24 * 60 * MIN)) return [400, { error: 'Date invalide (dans les 3 prochains mois).' }];
  if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  let route = null;
  if (Array.isArray(b.route) && b.route.length >= 2) {
    route = b.route.slice(0, 300).map(p => [Math.round(Number(p[0]) * 1e5) / 1e5, Math.round(Number(p[1]) * 1e5) / 1e5]);
    if (!route.every(([a, o]) => validLatLng(a, o) && distKm(a, o, lat, lng) < 60)) return [400, { error: 'Parcours invalide.' }];
  }
  return tx(() => {
    const now = Date.now();
    if (!orga) {
      if (!allow(dev, ipH, 'report', now)) return [429, { error: 'Trop d’envois d’un coup. Réessaie dans quelques minutes.' }];
      if (q("SELECT COUNT(*) n FROM events WHERE status='pending' AND dev=?").get(dev).n >= 3) return [429, { error: 'Tu as déjà 3 propositions en attente de validation.' }];
      if (q("SELECT COUNT(*) n FROM events WHERE status='pending'").get().n >= 300) return [503, { error: 'Trop de propositions en attente, réessaie plus tard.' }];
    } else if (!orga.admin && !quota('evt:' + orga.id, ORGA_LIMITS.eventsPerDay, 24 * 60 * MIN, now)) return [429, { error: `${ORGA_LIMITS.eventsPerDay} événements par jour au maximum.` }];
    const e = { id: crypto.randomBytes(6).toString('base64url'), type, title, place, note, start, lat: round(lat), lng: round(lng),
      route, end: !!(route && b.end), by: orga ? orga.label : 'Proposition de participant·e', oid: orga ? orga.id : null, status: orga && !orga.trial ? 'ok' : 'pending', t: now };
    if (!orga) e.dev = dev;
    saveEvent(e);
    return [201, evView(e)];
  });
}

module.exports = { createEvent };
