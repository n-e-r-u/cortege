'use strict';
// Profils pays : ce qui change d'un pays à l'autre (noms des types de signalement, types masqués ou ajoutés, numéros d'urgence,
// droits, unités), décrit dans profiles/<pays>.json, sans toucher au code. Une instance peut couvrir plusieurs pays :
// PROFILES=fr,de (le premier sert aussi hors de toutes les zones). Le profil d'un endroit est celui de la zone où il se trouve.
// Les types gardent le même comportement partout (alertes, vibrations, fusion) : seuls les noms et la liste visible changent.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');
const { CATEGORIES, CAT, MERGE, ALERT_CATS, VIBES, BASE_TTL, GROUPS } = require('./categories');
const { inFrance } = require('./geo/communes');

const DIR = path.join(ROOT, 'profiles');
const CODES = String(process.env.PROFILES || 'fr').split(',').map(s => s.trim().toLowerCase()).filter(c => /^[a-z]{2,8}$/.test(c));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const areaOf = (area, res) => {
  const f = path.join(ROOT, 'geo', 'countries', `${area}-${res}.json`);
  const g = readJson(f).geometry;
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
};
const bboxOf = polys => polys.reduce((b, p) => p[0].reduce((b2, [x, y]) => [Math.min(b2[0], y), Math.min(b2[1], x), Math.max(b2[2], y), Math.max(b2[3], x)], b), [90, 180, -90, -180]);
function ringHas(ring, lat, lng) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

const PROFILES = [];
for (const code of CODES.length ? CODES : ['fr']) {
  let p;
  try { p = readJson(path.join(DIR, code + '.json')); } catch (e) { console.error(`profil ${code} illisible : ${e.message}`); continue; }
  p.code = code;
  if (p.area === 'france') { try { p.clientArea = areaOf('fr', '110m'); p.bbox = bboxOf(p.clientArea); } catch {} }
  else if (p.area) {
    try { p.polys = areaOf(p.area, '50m'); p.bbox = bboxOf(p.polys); p.clientArea = areaOf(p.area, '110m'); }
    catch (e) { console.error(`profil ${code} : zone ${p.area} introuvable (${e.message})`); }
  }
  PROFILES.push(p);
}
if (!PROFILES.length) PROFILES.push({ code: 'fr', name: 'France', area: 'france', units: 'metric', labels: {}, hidden: [], extra: [], emergency: { medical: '15', general: '112' }, orders: true });
const DEFAULT = PROFILES[0];

// Distance (km) d'un point au bord d'une zone : les contours simplifiés coupent parfois une ville côtière (Miami, New York)
const COAST_KM = 25;
function nearRing(ring, lat, lng, km) {
  const k = Math.cos(lat * Math.PI / 180), P = [lng * k, lat];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const A = [ring[j][0] * k, ring[j][1]], B = [ring[i][0] * k, ring[i][1]];
    if (Math.abs(A[1] - lat) > 1 && Math.abs(B[1] - lat) > 1) continue;
    const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
    if (Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy) * 111 <= km) return true;
  }
  return false;
}
// Profil d'un endroit (null hors de toutes les zones de l'instance)
function profileIn(lat, lng) {
  for (const p of PROFILES) {
    if (p.area === 'france') { if (inFrance(lat, lng)) return p; continue; }
    if (!p.polys) continue;
    const b = p.bbox, m = COAST_KM / 111 * 1.5;
    if (lat < b[0] - m || lat > b[2] + m || lng < b[1] - m * 2 || lng > b[3] + m * 2) continue;
    if (p.polys.some(pl => ringHas(pl[0], lat, lng))) return p;
  }
  // Tout près du bord d'une zone (côte, frontière) : la zone la plus probable
  for (const p of PROFILES) if (p.polys && p.polys.some(pl => nearRing(pl[0], lat, lng, COAST_KM))) return p;
  return null;
}
const profileAt = (lat, lng) => profileIn(lat, lng) || DEFAULT;
// Dans la zone de l'instance (bilans : les points d'ailleurs sont comptés à part)
const inZone = (lat, lng) => !!profileIn(lat, lng);

// Types ajoutés par les profils (ICE aux États-Unis…) : ajoutés à la liste commune, réservés à leur pays
const VIBE_DEFAULT = [200, 100, 200];
for (const p of PROFILES) for (const x of p.extra || []) {
  if (!x || !/^[a-z][a-z0-9_]{1,15}$/.test(x.id) || !GROUPS.some(g => g.id === x.group)) { console.error(`profil ${p.code} : type ajouté invalide`); continue; }
  if (CAT[x.id]) { (CAT[x.id].profiles ||= []).push(p.code); continue; }
  const c = { id: x.id, group: x.group, label: x.label, glyph: x.glyph || '•', ttl: x.ttl || 20, profiles: [p.code] };
  CATEGORIES.push(c); CAT[x.id] = c; BASE_TTL[x.id] = c.ttl;
  MERGE[x.id] = x.merge || { r: 100 };
  if (x.alert) { ALERT_CATS.add(x.id); VIBES[x.id] = x.vibe || VIBE_DEFAULT; }
}
// Un type existe-t-il à cet endroit ? (masqué par le profil, ou ajouté pour un autre pays)
function catAllowed(catId, lat, lng) {
  const p = profileAt(lat, lng), c = CAT[catId];
  if (!c) return false;
  if ((p.hidden || []).includes(catId)) return false;
  return !c.profiles || c.profiles.includes(p.code);
}
// Pour le téléphone : profils de l'instance, avec un contour simplifié de chaque zone (inutile s'il n'y a qu'un pays)
const clientProfiles = () => PROFILES.map((p, i) => ({ code: p.code, name: p.name, units: p.units || 'metric', labels: p.labels || {}, hidden: p.hidden || [],
  emergency: p.emergency || {}, rights: p.rights || null, violence: p.violence || null, orders: !!p.orders,
  ...(PROFILES.length > 1 && p.clientArea ? { area: p.clientArea.map(pl => pl[0]), bbox: p.bbox } : {}) }));

module.exports = { PROFILES, DEFAULT_PROFILE: DEFAULT, profileAt, profileIn, inZone, catAllowed, clientProfiles };
