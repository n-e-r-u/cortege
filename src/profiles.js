'use strict';
// Profils pays : ce qui change d'un pays à l'autre (noms des types de signalement, types masqués ou ajoutés, numéros d'urgence,
// droits, unités), décrit dans profiles/<pays>.json, sans toucher au code. Une instance peut couvrir plusieurs pays.
// Les pays actifs et leur ordre se choisissent dans l'admin (onglet Pays) ; PROFILES=fr,de ne sert que de valeur de départ.
// Le premier pays actif est le pays principal : il sert aussi hors de toutes les zones.
// Un profil peut être corrigé depuis l'admin : la correction est gardée dans la base et passe devant le fichier.
// Les types gardent le même comportement partout (alertes, vibrations, fusion) : seuls les noms et la liste visible changent.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');
const { CATEGORIES, CAT, MERGE, ALERT_CATS, VIBES, BASE_TTL, GROUPS } = require('./categories');
const { inFrance } = require('./geo/communes');
const { getMeta, setMeta } = require('./db');

const DIR = path.join(ROOT, 'profiles');
const ENV_CODES = String(process.env.PROFILES || 'fr').split(',').map(s => s.trim().toLowerCase()).filter(c => /^[a-z]{2,8}$/.test(c));
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
// Point représentatif du pays (milieu de son plus grand morceau) : sert à savoir si une carte détaillée le couvre
function mainPoint(polys) {
  let best = null, area = -1;
  for (const p of polys) { const b = bboxOf([p]), a = (b[2] - b[0]) * (b[3] - b[1]); if (a > area) { area = a; best = b; } }
  return best ? [(best[0] + best[2]) / 2, (best[1] + best[3]) / 2] : null;
}

// ---- Tous les profils livrés (profiles/*.json), avec leurs contours ----
const FALLBACK = { code: 'fr', name: 'France', area: 'france', lang: 'fr', units: 'metric', labels: {}, hidden: [], extra: [], emergency: { medical: '15', general: '112' }, orders: true };
const BASE = {};
let files = [];
try { files = fs.readdirSync(DIR).filter(f => /^[a-z]{2,8}\.json$/.test(f)).sort(); } catch {}
for (const f of files) {
  const code = f.slice(0, -5);
  let p;
  try { p = readJson(path.join(DIR, f)); } catch (e) { console.error(`profil ${code} illisible : ${e.message}`); continue; }
  p.code = code;
  if (p.area === 'france') { try { p.clientArea = areaOf('fr', '110m'); p.bbox = bboxOf(p.clientArea); p.point = [46.6, 2.4]; } catch {} }
  else if (p.area) {
    try { p.polys = areaOf(p.area, '50m'); p.bbox = bboxOf(p.polys); p.clientArea = areaOf(p.area, '110m'); p.point = mainPoint(p.polys); }
    catch (e) { console.error(`profil ${code} : zone ${p.area} introuvable (${e.message})`); continue; }
  }
  BASE[code] = p;
}
if (!BASE.fr) BASE.fr = { ...FALLBACK };

// Types ajoutés par les profils (ICE aux États-Unis…) : ajoutés à la liste commune, réservés à leur pays
const VIBE_DEFAULT = [200, 100, 200];
for (const p of Object.values(BASE)) for (const x of p.extra || []) {
  if (!x || !/^[a-z][a-z0-9_]{1,15}$/.test(x.id) || !GROUPS.some(g => g.id === x.group)) { console.error(`profil ${p.code} : type ajouté invalide`); continue; }
  if (CAT[x.id]) { if (CAT[x.id].profiles) CAT[x.id].profiles.push(p.code); continue; }
  const c = { id: x.id, group: x.group, label: x.label, glyph: x.glyph || '•', ttl: x.ttl || 20, profiles: [p.code] };
  CATEGORIES.push(c); CAT[x.id] = c; BASE_TTL[x.id] = c.ttl;
  MERGE[x.id] = x.merge || { r: 100 };
  if (x.alert) { ALERT_CATS.add(x.id); VIBES[x.id] = x.vibe || VIBE_DEFAULT; }
}

// ---- Ce que l'admin peut corriger dans un profil ----
const EDITABLE = ['name', 'units', 'emergency', 'labels', 'hidden', 'rights', 'violence'];
const s = (x, n) => String(x ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const httpUrl = x => { const v = s(x, 300); try { return v && /^https?:$/.test(new URL(v).protocol) ? v : ''; } catch { return ''; } };
function cleanEdit(code, b) {
  const base = BASE[code], out = {}, bad = m => { throw Object.assign(new Error(m), { status: 400 }); };
  if (!base) bad('Pays inconnu.');
  if (b.name !== undefined) { const v = s(b.name, 40); if (v.length < 2) bad('Nom du pays trop court.'); out.name = v; }
  if (b.units !== undefined) out.units = b.units === 'imperial' ? 'imperial' : 'metric';
  if (b.emergency && typeof b.emergency === 'object') {
    out.emergency = {};
    for (const k of ['medical', 'general', 'police', 'pharmacy']) { const v = s(b.emergency[k], 20); if (v && !/^[\d +()-]{2,20}$/.test(v)) bad('Numéro d’urgence invalide : ' + v); if (v) out.emergency[k] = v; }
  }
  if (b.labels && typeof b.labels === 'object') {
    out.labels = {};
    for (const [id, v] of Object.entries(b.labels)) if (CAT[id] && s(v, 60)) out.labels[id] = s(v, 60);
  }
  if (Array.isArray(b.hidden)) out.hidden = [...new Set(b.hidden.filter(id => CAT[id]))];
  if (Array.isArray(b.rights)) {
    out.rights = b.rights.slice(0, 12).map(x => ({ title: s(x && x.title, 80), items: (Array.isArray(x && x.items) ? x.items : []).map(i => s(i, 400)).filter(Boolean).slice(0, 12) }))
      .filter(x => x.title && x.items.length);
    if (!out.rights.length) out.rights = null;
  }
  if (b.violence !== undefined) {
    const u = b.violence && httpUrl(b.violence.url);
    out.violence = u ? { url: u, label: s(b.violence.label, 80) || 'Signaler une violence policière', ...(s(b.violence.desc, 200) ? { desc: s(b.violence.desc, 200) } : {}) } : null;
  }
  return out;
}

// ---- Pays actifs, relus dans la base (choix de l'admin) ----
const PROFILES = [];   // pays actifs, dans l'ordre ; le tableau garde la même identité, son contenu est remplacé
let ST = { at: 0, raw: null };
const parse = (raw, d) => { try { return raw ? JSON.parse(raw) : d; } catch { return d; } };
function sync(force) {
  const now = Date.now();
  if (!force && now - ST.at < 3000) return;
  const raw = (getMeta('profiles') || '') + '\n' + (getMeta('profileEdits') || '');
  ST.at = now;
  if (raw === ST.raw && !force) return;
  ST.raw = raw;
  const want = parse(getMeta('profiles'), null), edits = parse(getMeta('profileEdits'), {});
  let codes = (Array.isArray(want) ? want : ENV_CODES).filter(c => BASE[c]);
  if (!codes.length) codes = ['fr'];
  PROFILES.length = 0;
  for (const c of codes) PROFILES.push({ ...BASE[c], ...(edits[c] || {}), code: c, edited: !!edits[c] });
}
sync(true);
const defaultProfile = () => { sync(); return PROFILES[0]; };

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
  sync();
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
const profileAt = (lat, lng) => profileIn(lat, lng) || defaultProfile();
// Dans la zone de l'instance (bilans : les points d'ailleurs sont comptés à part)
const inZone = (lat, lng) => !!profileIn(lat, lng);

// Un type existe-t-il à cet endroit ? (masqué par le profil, ou ajouté pour un autre pays)
function catAllowed(catId, lat, lng) {
  const p = profileAt(lat, lng), c = CAT[catId];
  if (!c) return false;
  if ((p.hidden || []).includes(catId)) return false;
  return !c.profiles || c.profiles.includes(p.code);
}
// Types utiles à l'instance : ceux d'un pays inactif (ICE si les États-Unis sont désactivés) ne sont pas envoyés
const activeCategories = () => { sync(); return CATEGORIES.filter(c => !c.profiles || c.profiles.some(code => PROFILES.some(p => p.code === code))); };
// Pour le téléphone : profils de l'instance, avec un contour simplifié de chaque zone (inutile s'il n'y a qu'un pays)
const clientProfiles = () => { sync(); return PROFILES.map(p => ({ code: p.code, name: p.name, units: p.units || 'metric', labels: p.labels || {}, hidden: p.hidden || [],
  emergency: p.emergency || {}, rights: p.rights || null, violence: p.violence || null, orders: !!p.orders,
  ...(PROFILES.length > 1 && p.clientArea ? { area: p.clientArea.map(pl => pl[0]), bbox: p.bbox } : {}) })); };

// ---- Admin : liste, activation, corrections ----
const editable = p => Object.fromEntries(EDITABLE.map(k => [k, p[k] ?? null]));
// Profil tel qu'il serait écrit dans profiles/<pays>.json (export à proposer sur le dépôt)
function exportProfile(code) {
  const edits = parse(getMeta('profileEdits'), {}), b = BASE[code];
  if (!b) return null;
  const { polys, clientArea, bbox, point, edited, ...file } = { ...b, ...(edits[code] || {}) };
  return { ...file, code };
}
function adminProfiles() {
  sync(true);
  const edits = parse(getMeta('profileEdits'), {});
  return Object.values(BASE).map(b => {
    const i = PROFILES.findIndex(p => p.code === b.code);
    return { code: b.code, active: i >= 0, main: i === 0, order: i, lang: b.lang || null, point: b.point || null, bbox: b.bbox || null,
      extra: (b.extra || []).map(x => x.id), orders: !!b.orders, edited: !!edits[b.code],
      current: editable({ ...b, ...(edits[b.code] || {}) }), original: editable(b) };
  }).sort((a, b) => (a.active === b.active ? (a.active ? a.order - b.order : a.code.localeCompare(b.code)) : a.active ? -1 : 1));
}
function setActive(codes) {
  const list = [...new Set((codes || []).map(c => String(c).toLowerCase()))].filter(c => BASE[c]);
  if (!list.length) throw Object.assign(new Error('Garde au moins un pays actif.'), { status: 400 });
  setMeta('profiles', JSON.stringify(list)); sync(true);
  return list;
}
function saveEdit(code, body) {
  const edits = parse(getMeta('profileEdits'), {});
  if (body === null) delete edits[code];
  else {
    const e = cleanEdit(code, body), orig = editable(BASE[code]);
    // Seuls les champs vraiment changés sont gardés : le reste suit le fichier livré (et ses mises à jour)
    for (const k of Object.keys(e)) if (JSON.stringify(e[k]) === JSON.stringify(orig[k] ?? (k === 'labels' || k === 'emergency' ? {} : k === 'hidden' ? [] : null))) delete e[k];
    if (Object.keys(e).length) edits[code] = e; else delete edits[code];
  }
  setMeta('profileEdits', JSON.stringify(edits)); sync(true);
}

module.exports = { PROFILES, defaultProfile, profileAt, profileIn, inZone, catAllowed, clientProfiles, activeCategories,
  adminProfiles, setActive, saveEdit, exportProfile, PROFILE_CODES: Object.keys(BASE) };
