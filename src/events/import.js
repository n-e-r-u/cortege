'use strict';
// ---- Import d'un agenda partenaire ----
// Lit à intervalle régulier la carte d'un site partenaire et publie ses mobilisations dans l'agenda de cette instance.
// Éteint par défaut : il ne tourne que si une adresse est réglée dans l'admin (onglet Agenda).
//
// Format attendu, celui des cartes de mobilisation « 17 octobre » : trois adresses sur le même domaine,
//   /api/lieux       { lieux: [[id, type, lat, lng, nom, "", ville, cp, dep, "HH:MM", 0, 0], ...] }   positions
//   /api/actions     { actions: { "<id>": [[type, "HH:MM", "AAAA-MM-JJ", ...], ...] } }               dates
//   /data/sites.json { maj, lieux: [[id, type, lat, lng, nom, exploitant, ville, cp, dep], ...] }     sites permanents
// Les positions et les dates se joignent par l'identifiant du lieu.
//
// Ce qui est repris et ce qui ne l'est pas : seuls les types qui existent dans l'agenda de Cortège (manif, blocus,
// rassemblement). Les ronds-points et les stations-service, qui font l'essentiel de ces cartes, restent chez elles.
//
// Les événements importés sont marqués (src, by, link) : ils affichent leur source et ne sont jamais « vérifiés ».
// L'admin peut en masquer un : il passe dans « hidden » et ne revient pas au prochain passage.
const crypto = require('crypto');
const { MIN } = require('../config');
const { fetchPublic } = require('../legal');
const { parisMs } = require('../time');
const { inZone } = require('../profiles');
const { clean, validLatLng, round } = require('../util');
const { q, tx } = require('../db');
const { listEvents, saveEvent, dropEvent, EVENT_KEEP } = require('./store');
const { settings, feedBaseOk } = require('../settings');

const SRC = 'feed';                       // marque des événements venus de l'import
const EVERY_DEF = 30, DAYS_DEF = 14;      // minutes entre deux lectures, jours repris à l'avance

// Réglages (admin) : adresse du site, lecture toutes les N minutes, fenêtre de N jours
function feedCfg() {
  const f = settings().feed || {};
  if (f.off) return null;                   // coupé depuis l'admin, sans perdre l'adresse
  const base = String(f.base || '').replace(/\/+$/, '');
  if (!feedBaseOk(base)) return null;
  return { base, every: Math.min(Math.max(Number(f.every) || EVERY_DEF, 10), 240), days: Math.min(Math.max(Number(f.days) || DAYS_DEF, 1), 60),
    label: clean(f.label, 60) || base.replace(/^https:\/\//, '') };
}

// Correspondance des types : ce qu'ils publient → ce qui existe dans l'agenda de Cortège.
// On prend ce que la source dit, sans deviner : un « rassemblement » reste un rassemblement, même sur un lieu de manif
// (leurs données ne disent pas si le cortège marche ou non, et annoncer une manif pour un rassemblement statique
// trompe les gens qui viennent). Un lieu bloquable (pont, péage, gare, port, lycée, raffinerie, dépôt) donne un blocus.
// Les ronds-points et les stations-service, qui font l'essentiel de ces cartes, ne sont pas repris.
const BLOCUS = new Set(['pont', 'peage', 'gare', 'port', 'lycee', 'fac', 'raffinerie', 'depot', 'zone', 'entrepot']);
function evType(action, lieu) {
  if (action === 'rond_point') return null;
  if (action === 'blocage' || BLOCUS.has(lieu)) return 'blocus';
  if (action === 'manif') return 'manif';
  if (action === 'rassemblement') return 'rassemblement';
  return null;
}

// Identifiant stable : le même lieu à la même date redonne le même événement, donc une relecture met à jour au lieu de doubler
const feedId = key => 'f' + crypto.createHash('sha1').update(key).digest('base64url').slice(0, 11);

// Index des positions : identifiant → { lat, lng, nom, ville, type }
function placeIndex(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const [id, type, lat, lng, nom, , ville] = r;
    if (id == null || !validLatLng(Number(lat), Number(lng))) continue;
    out.set(String(id), { lat: Number(lat), lng: Number(lng), type: String(type || ''), nom: clean(nom, 80), ville: clean(ville, 60) });
  }
  return out;
}

// Lecture d'une adresse du site : protégée contre le réseau interne (l'adresse est réglée dans l'admin, elle ne doit
// jamais pouvoir viser une machine du réseau du serveur), et bornée en taille.
const read = async (url) => JSON.parse(await fetchPublic(url, { max: 4_000_000, timeout: 20_000, strict: false,
  ua: 'Cortege-agenda/1 (import d\'un agenda partenaire)' }));

// Une lecture complète : renvoie la liste des événements à publier
async function fetchFeed(cfg, now = Date.now()) {
  const [lieux, sites, actions] = await Promise.all([
    read(cfg.base + '/api/lieux').catch(() => null),
    read(cfg.base + '/data/sites.json').catch(() => null),
    read(cfg.base + '/api/actions'),
  ]);
  return parseFeed({ lieux, sites, actions }, cfg, now);
}

// Partie sans réseau : le tri, la correspondance des types et la fenêtre de dates (testée à part)
function parseFeed({ lieux, sites, actions }, cfg, now = Date.now()) {
  const places = placeIndex(lieux && lieux.lieux);
  for (const [k, v] of placeIndex(sites && sites.lieux)) if (!places.has(k)) places.set(k, v);
  const byId = actions && actions.actions;
  if (!byId || typeof byId !== 'object') throw new Error('actions illisibles');
  const until = now + cfg.days * 24 * 60 * MIN, from = now - EVENT_KEEP;
  const out = [];
  for (const [id, list] of Object.entries(byId)) {
    const p = places.get(String(id));
    if (!p || !Array.isArray(list)) continue;              // station-service ou lieu inconnu : pas repris
    if (!inZone(p.lat, p.lng)) continue;                   // hors des pays de cette instance
    for (const a of list) {
      if (!Array.isArray(a) || a.length < 3) continue;
      const [kind, hhmm, date] = a.map(x => String(x == null ? '' : x));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const type = evType(kind, p.type);
      if (!type) continue;
      const start = parisMs(date, /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : '12:00');
      if (!(start > from && start < until)) continue;
      const place = p.nom && p.ville ? `${p.nom}, ${p.ville}` : p.nom || p.ville;
      if (!place) continue;                                 // sans nom ni ville, on ne sait pas où envoyer les gens
      out.push({ id: feedId(cfg.base + '|' + id + '|' + date + '|' + hhmm + '|' + kind), type,
        title: clean(p.ville ? `${p.ville} : ${p.nom || type}` : p.nom, 80), place: clean(place, 100), note: '',
        start, lat: round(p.lat), lng: round(p.lng), route: null, end: false,
        by: cfg.label, oid: null, status: 'ok', src: SRC, link: cfg.base + '/carte/', t: now });
    }
  }
  return out;
}

// Publication : on ajoute, on met à jour, et on retire ce qui a disparu de la source (manif annulée chez elle).
// Un événement masqué par l'admin reste masqué.
function apply(list, now = Date.now()) {
  return tx(() => {
    const masked = new Set(q('SELECT id FROM hidden WHERE until>?').all(now).map(x => x.id));
    const olds = new Map(listEvents().filter(e => e.src === SRC).map(e => [e.id, e]));
    let added = 0, kept = 0, gone = 0;
    for (const e of list) {
      if (masked.has(e.id)) continue;
      const old = olds.get(e.id);
      olds.delete(e.id);
      if (old && old.start === e.start && old.title === e.title && old.place === e.place && old.lat === e.lat && old.lng === e.lng && old.type === e.type) { kept++; continue; }
      saveEvent(old ? { ...old, ...e, t: old.t } : e);
      added++;
    }
    for (const id of olds.keys()) { dropEvent(id); gone++; }
    return { added, kept, gone, seen: list.length };
  });
}

let lastRun = 0, lastInfo = null;
async function feedTick(now = Date.now(), force = false) {
  const cfg = feedCfg();
  if (!cfg) return null;
  if (!force && now - lastRun < cfg.every * MIN) return null;
  lastRun = now;
  try {
    const res = apply(await fetchFeed(cfg, now), now);
    lastInfo = { at: now, ok: true, ...res };
  } catch (e) {
    lastInfo = { at: now, ok: false, error: e.message };
    console.error('import agenda', e.message);
  }
  return lastInfo;
}
const feedState = () => ({ on: !!feedCfg(), cfg: feedCfg(), last: lastInfo,
  count: q("SELECT COUNT(*) n FROM events WHERE src=?").get(SRC).n });

module.exports = { feedTick, feedState, feedCfg, parseFeed, apply, evType, SRC, EVERY_DEF, DAYS_DEF };
