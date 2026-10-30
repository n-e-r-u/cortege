'use strict';
// Agenda : événements (manifs, blocus, rassemblements), lecture, enregistrement, retrait, vue publique, distance au parcours.
const { MIN } = require('../config');
const { q } = require('../db');
const { dirty, scheduleFlush } = require('../live/files');
const { ownerTag } = require('../orgas/owner');
const { cityIdx } = require('../pages/city-cache');

// Agenda
const getEvent = id => { const x = q('SELECT data FROM events WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
const listEvents = () => q('SELECT data FROM events ORDER BY start').all().map(x => JSON.parse(x.data));
function saveEvent(e) {
  cityIdx.at = 0; // pages de villes à refaire
  q('INSERT OR REPLACE INTO events(id,status,src,start,dev,data) VALUES(?,?,?,?,?,?)').run(e.id, e.status, e.src || null, e.start, e.dev || null, JSON.stringify(e));
  dirty.events = true; scheduleFlush();
}
function dropEvent(id) { const n = q('DELETE FROM events WHERE id=?').run(id).changes; if (n) { dirty.events = true; scheduleFlush(); } return n > 0; }

const evView = e => ({ id: e.id, type: e.type, title: e.title, place: e.place, note: e.note, start: e.start, lat: e.lat, lng: e.lng,
  route: e.route || null, end: !!e.end, by: e.by, ob: ownerTag(e.oid), status: e.status, link: e.link || null, src: e.src || null, t: e.t });
const EVENT_KEEP = 12 * 60 * MIN;  // un événement reste affiché 12 h après son début

// Distance (m) d'un point au parcours le plus proche d'un événement en cours de l'agenda (Infinity s'il n'y en a pas)
function routeDistM(lat, lng, now = Date.now()) {
  let best = Infinity;
  for (const e of listEvents()) {
    if (!e.route || e.route.length < 2 || e.status === 'pending' || e.start > now + 60 * MIN || e.start < now - 12 * 60 * MIN) continue;
    const k = Math.cos(lat * Math.PI / 180), P = [lng * 111320 * k, lat * 110540];
    for (let i = 0; i < e.route.length - 1; i++) {
      const A = [e.route[i][1] * 111320 * k, e.route[i][0] * 110540], Bq = [e.route[i + 1][1] * 111320 * k, e.route[i + 1][0] * 110540];
      const dx = Bq[0] - A[0], dy = Bq[1] - A[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy));
    }
  }
  return best;
}

module.exports = { getEvent, listEvents, saveEvent, dropEvent, evView, EVENT_KEEP, routeDistM };
