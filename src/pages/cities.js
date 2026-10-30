'use strict';
// Index des villes pour les pages /ville/:slug : événements à venir, legal teams et bilans publiés.
const { MIN } = require('../config');
const { cityIdx } = require('./city-cache');
const { legalAll } = require('../legal');
const { listEvents } = require('../events/store');
const { q } = require('../db');
const { slugOf } = require('../digest/pub');
const { whereOf } = require('../geo/communes');

const upcoming = (now = Date.now()) => listEvents().filter(e => e.status !== 'pending' && e.lat != null && e.start > now - 2 * 3600e3).sort((a, b) => a.start - b.start);
// Données structurées des événements (schema.org Event) : gratuit, organisé par l'orga qui l'a publié, fin estimée à 3 h après le début

function cityIndex() {
  if (Date.now() - cityIdx.at < 5 * MIN) return cityIdx.map;
  const map = new Map(), get = (name, lat, lng) => { const s = slugOf(name); if (!s) return null; if (!map.has(s)) map.set(s, { slug: s, name, lat, lng, events: [], legal: [], bilans: [] }); return map.get(s); };
  for (const e of upcoming()) { const w = whereOf(e.lat, e.lng), c = get(w.name, e.lat, e.lng); if (c) c.events.push(e); }
  for (const e of legalAll().filter(e => e.ok)) { const c = get(e.city, e.lat, e.lng); if (c) c.legal.push(e); }
  for (const x of q('SELECT date, data FROM pub ORDER BY date DESC').all()) {
    const d = JSON.parse(x.data), pages = new Map((d.cityPages || []).map(p => [p.name, p.slug]));
    for (const c2 of d.cities || []) if (c2.n >= 10) { const c = get(c2.name, c2.lat, c2.lng); if (c) c.bilans.push({ date: x.date, n: c2.n, page: pages.get(c2.name) || null }); }
  }
  cityIdx.at = Date.now(); cityIdx.map = map;
  return map;
}

module.exports = { upcoming, cityIndex };
