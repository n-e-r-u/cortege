'use strict';
// ---- Lieux de repli tenus par les orgas ----
// Un lieu de repli (commerce, local associatif, point d'écoute) est enregistré une fois par une orga certifiée, avec
// l'accord du lieu, puis ouvert le jour d'une manif pour un créneau (24 h au plus). Il n'apparaît sur la carte que
// pendant ce créneau : aucune liste consultable hors manif, pour ne pas exposer les lieux solidaires.
// Le point garde l'anneau vert « soutien » ; l'orga choisit l'intérieur (pictogramme et couleur) ou son logo,
// affiché seulement après validation par l'admin.
// L'admin gère aussi les lieux (2.13.5) : il en crée, les associe à une ou plusieurs orgas (qui peuvent toutes les
// ouvrir et les modifier), leur donne un logo propre et règle le nombre de lieux permis à chaque orga.
const crypto = require('crypto');
const { MIN } = require('./config');
const { clean, round, validLatLng } = require('./util');
const { dirty, scheduleFlush } = require('./live/files');
const { q, db } = require('./db');
const { readOrgas } = require('./orgas/store');
const { adminLabel } = require('./settings');

db.exec(`CREATE TABLE IF NOT EXISTS refuges(id TEXT PRIMARY KEY, oid TEXT, data TEXT);
  CREATE TABLE IF NOT EXISTS refuge_logo(oid TEXT PRIMARY KEY, status TEXT, t INTEGER, data TEXT);
  CREATE TABLE IF NOT EXISTS refuge_quota(oid TEXT PRIMARY KEY, n INTEGER);`);

const REFUGE_SERVICES = ['eau', 'wc', 'ecoute', 'recharge', 'soins', 'abri', 'pmr'];
const REFUGE_GLYPHS = ['🕊️', '☕', '🫖', '🛋️', '💧', '🩹', '🎧', '🏠', '📚', '🍞', '🌿', '💜', '🤝', '🎨'];
// Pas de rouge ni d'orange : ces couleurs veulent dire forces de l'ordre et danger sur la carte
const REFUGE_COLORS = ['#30a46c', '#2f9e8f', '#3a4db2', '#4b8bff', '#9576a8', '#c2569b', '#4a4f7a'];
// Nombre de lieux par orga : REFUGE_MAX (1 par défaut) sauf réglage de l'admin pour une orga (0 à 30)
const REFUGE_MAX = Math.max(1, Math.min(30, Number(process.env.REFUGE_MAX) || 1)), QUOTA_MAX = 30, REFUGE_TOTAL = 3000, OPEN_MAX = 24 * 60 * MIN;
const LOGO_MAX = 40_000, LOGO_PX = [48, 256];

const all = () => q('SELECT data FROM refuges').all().map(x => JSON.parse(x.data));
// Orgas associées à un lieu (les lieux d'avant 2.13.5 n'ont que leur orga d'origine)
const orgasOf = r => Array.isArray(r.orgas) ? r.orgas : (r.oid ? [r.oid] : []);
const canManage = (orga, r) => !!r && (orga.admin || orgasOf(r).includes(orga.id));
const mine = oid => all().filter(r => orgasOf(r).includes(oid)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
const quotaOf = oid => { const x = q('SELECT n FROM refuge_quota WHERE oid=?').get(oid); return x ? x.n : REFUGE_MAX; };
function setQuota(oid, n) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n) || n < 0 || n > QUOTA_MAX) return false;
  q('INSERT OR REPLACE INTO refuge_quota(oid,n) VALUES(?,?)').run(oid, n);
  return true;
}
const getRefuge = id => { const x = q('SELECT data FROM refuges WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveRefuge(r) { q('INSERT OR REPLACE INTO refuges(id,oid,data) VALUES(?,?,?)').run(r.id, r.oid, JSON.stringify(r)); dirty.repli = true; scheduleFlush(); }
function dropRefuge(id) { const n = q('DELETE FROM refuges WHERE id=?').run(id).changes; if (n) { dirty.repli = true; scheduleFlush(); } return n > 0; }
const getLogo = oid => q('SELECT oid, status, t, data FROM refuge_logo WHERE oid=?').get(oid) || null;

function cleanRefuge(b, old) {
  const r = { ...(old || {}) };
  r.name = clean(b.name ?? r.name, 60);
  r.short = clean(b.short ?? r.short ?? '', 24);
  r.addr = clean(b.addr ?? r.addr ?? '', 120);
  r.msg = clean(b.msg ?? r.msg ?? '', 200);
  const url = String(b.url ?? r.url ?? '').trim();
  r.url = /^https:\/\/[^\s"<>]{4,300}$/.test(url) ? url : '';
  if (b.lat !== undefined || b.lng !== undefined) { r.lat = round(Number(b.lat)); r.lng = round(Number(b.lng)); }
  const sv = Array.isArray(b.services) ? b.services : r.services || [];
  r.services = REFUGE_SERVICES.filter(s => sv.includes(s));
  r.glyph = REFUGE_GLYPHS.includes(b.glyph) ? b.glyph : (REFUGE_GLYPHS.includes(r.glyph) ? r.glyph : REFUGE_GLYPHS[0]);
  r.color = REFUGE_COLORS.includes(b.color) ? b.color : (REFUGE_COLORS.includes(r.color) ? r.color : REFUGE_COLORS[0]);
  r.useLogo = b.useLogo === undefined ? !!r.useLogo : !!b.useLogo;
  if (b.consent !== undefined) r.consent = b.consent === true;
  if (r.name.length < 2) return [400, 'Indique le nom du lieu.'];
  if (!validLatLng(r.lat, r.lng)) return [400, 'Place le lieu sur la carte.'];
  if (!r.consent) return [400, 'Le lieu doit avoir donné son accord pour apparaître sur Cortège.'];
  return [200, r];
}

function createRefuge(orga, b) {
  const max = orga.admin ? QUOTA_MAX : quotaOf(orga.id);
  if (mine(orga.id).length >= max) return [400, { error: max === 1 ? 'Une orga enregistre un seul lieu de repli pour le moment.' : 'Ton orga a atteint le nombre maximal de lieux.' }];
  if (q('SELECT COUNT(*) n FROM refuges').get().n >= REFUGE_TOTAL) return [503, { error: 'Trop de lieux enregistrés sur ce serveur.' }];
  const [st, r] = cleanRefuge(b, { id: crypto.randomBytes(6).toString('base64url'), oid: orga.id, orgas: [orga.id], owner: orga.id, created: Date.now(), state: 'closed', from: 0, to: 0 });
  if (st !== 200) return [st, { error: r }];
  r.orga = orga.label; r.updated = Date.now();
  saveRefuge(r);
  return [201, refugeView(r)];
}
function updateRefuge(orga, id, b) {
  const old = getRefuge(id);
  if (!canManage(orga, old)) return [404, { error: 'Lieu introuvable.' }];
  const [st, r] = cleanRefuge(b, old);
  if (st !== 200) return [st, { error: r }];
  r.updated = Date.now(); if (old.oid === orga.id) r.orga = orga.label;
  saveRefuge(r);
  return [200, refugeView(r)];
}
function removeRefuge(orga, id) {
  const old = getRefuge(id);
  if (!canManage(orga, old)) return [404, { error: 'Lieu introuvable.' }];
  dropRefuge(id);
  return [200, { ok: true }];
}
// Ouverture pour un créneau (de maintenant ou plus tard, jusqu'à 24 h), pour une liste de lieux de l'orga
function openRefuges(orga, b, now = Date.now()) {
  const from = Number(b.from) || now, to = Number(b.to);
  if (!Number.isFinite(to) || to <= now) return [400, { error: 'Choisis une heure de fermeture à venir.' }];
  if (from >= to) return [400, { error: 'L’ouverture doit précéder la fermeture.' }];
  if (from < now - 60 * MIN || to - Math.max(from, now) > OPEN_MAX || from > now + OPEN_MAX) return [400, { error: 'Un créneau dure 24 h au plus et commence dans les 24 h.' }];
  const ids = Array.isArray(b.ids) ? new Set(b.ids.map(String)) : null;
  const list = (orga.admin && ids ? all() : mine(orga.id)).filter(r => !ids || ids.has(r.id));
  if (!list.length) return [400, { error: 'Aucun lieu choisi.' }];
  for (const r of list) { r.from = Math.max(from, now - 60 * MIN); r.to = to; r.state = 'open'; saveRefuge(r); }
  return [200, { n: list.length, refuges: mine(orga.id).map(refugeView) }];
}
// Pendant la manif : complet, rouvert, ou fermé (fin du créneau tout de suite)
function setRefugeState(orga, id, state, now = Date.now()) {
  const r = getRefuge(id);
  if (!canManage(orga, r)) return [404, { error: 'Lieu introuvable.' }];
  if (!['open', 'full', 'closed'].includes(state)) return [400, { error: 'État inconnu.' }];
  if (state === 'closed') { r.state = 'closed'; r.to = Math.min(r.to || now, now); }
  else { if (!(r.to > now)) return [400, { error: 'Ouvre d’abord le lieu pour un créneau.' }]; r.state = state; }
  saveRefuge(r);
  return [200, refugeView(r)];
}
const isOpen = (r, now) => r.state !== 'closed' && r.from <= now && r.to > now;
const orgaNames = () => ({ admin: adminLabel(), ...Object.fromEntries(readOrgas().map(o => [o.id, o.label])) });
const labelOf = (r, names = orgaNames()) => {
  const l = orgasOf(r).map(id => names[id] || (id.startsWith('env:') ? id.slice(4) : null)).filter(Boolean);
  return l.length ? l.join(', ') : (r.orga && r.owner !== 'admin' ? r.orga : adminLabel());
};
const refugeView = r => ({ id: r.id, name: r.name, short: r.short, addr: r.addr, msg: r.msg, url: r.url, lat: r.lat, lng: r.lng, services: r.services, glyph: r.glyph, color: r.color,
  useLogo: !!r.useLogo, hasLogo: !!r.logo, consent: !!r.consent, state: r.state, from: r.from || 0, to: r.to || 0, orga: labelOf(r), updated: r.updated });

// ---- Gestion par l'admin : orgas associées, logo propre au lieu ----
function adminSave(b, id) {
  const old = id ? getRefuge(id) : null;
  if (id && !old) return [404, { error: 'Lieu introuvable.' }];
  if (!id && all().length >= REFUGE_TOTAL) return [503, { error: 'Trop de lieux enregistrés sur ce serveur.' }];
  const base = old || { id: crypto.randomBytes(6).toString('base64url'), oid: 'admin', owner: 'admin', created: Date.now(), state: 'closed', from: 0, to: 0 };
  const [st, r] = cleanRefuge(b, base);
  if (st !== 200) return [st, { error: r }];
  if (Array.isArray(b.orgas)) {
    const known = new Set(readOrgas().map(o => o.id));
    r.orgas = [...new Set(b.orgas.map(String))].filter(x => known.has(x)).slice(0, 20);
    r.oid = r.orgas[0] || 'admin';
  }
  if (b.logo === null || b.logo === '') delete r.logo;
  else if (b.logo !== undefined) { const v = checkPng(b.logo); if (v.error) return [400, v]; r.logo = v.png; }
  r.updated = Date.now();
  saveRefuge(r);
  return [old ? 200 : 201, adminView(r)];
}
const adminView = r => ({ ...refugeView(r), orgas: orgasOf(r), owner: r.owner || r.oid, logo: r.logo || null });
function quotas() {
  const counts = {};
  for (const r of all()) for (const id of orgasOf(r)) counts[id] = (counts[id] || 0) + 1;
  return readOrgas().map(o => ({ id: o.id, label: o.label, trial: o.trial === true, max: quotaOf(o.id), count: counts[o.id] || 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
// Orga supprimée : retirée de ses lieux ; un lieu qui n'a plus d'orga disparaît, sauf s'il a été créé par l'admin
function forgetOrga(oid) {
  for (const r of all()) {
    const list = orgasOf(r); if (!list.includes(oid)) continue;
    r.orgas = list.filter(x => x !== oid); r.oid = r.orgas[0] || 'admin';
    if (!r.orgas.length && (r.owner || '') !== 'admin') dropRefuge(r.id); else saveRefuge(r);
  }
  q('DELETE FROM refuge_quota WHERE oid=?').run(oid);
  dropLogo(oid);
}

// ---- Logo de l'orga : PNG carré préparé par le téléphone (redimensionné), vérifié ici, validé par l'admin ----
function pngSize(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function checkPng(png) {
  const m = String(png || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: 'Logo illisible : choisis une image.' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > LOGO_MAX) return { error: 'Logo trop lourd (40 Ko au plus).' };
  const sz = pngSize(buf);
  if (!sz || sz[0] !== sz[1] || sz[0] < LOGO_PX[0] || sz[0] > LOGO_PX[1]) return { error: 'Le logo doit être une image PNG carrée.' };
  return { png: 'data:image/png;base64,' + buf.toString('base64') };
}
function setLogo(orga, b) {
  const v = checkPng(b.png); if (v.error) return [400, v];
  // Le logo de l'admin n'a pas besoin de sa propre validation
  const status = orga.admin ? 'ok' : 'pending';
  q('INSERT OR REPLACE INTO refuge_logo(oid,status,t,data) VALUES(?,?,?,?)').run(orga.id, status, Date.now(), v.png);
  dirty.repli = true; scheduleFlush();
  return [200, { status }];
}
function dropLogo(oid) { const n = q('DELETE FROM refuge_logo WHERE oid=?').run(oid).changes; if (n) { dirty.repli = true; scheduleFlush(); } return n > 0; }
function judgeLogo(oid, ok) {
  if (!getLogo(oid)) return false;
  if (ok) q("UPDATE refuge_logo SET status='ok' WHERE oid=?").run(oid); else q('DELETE FROM refuge_logo WHERE oid=?').run(oid);
  dirty.repli = true; scheduleFlush();
  return true;
}
const logosPending = () => q("SELECT oid, t, data FROM refuge_logo WHERE status='pending' ORDER BY t").all();

// ---- Ce que voient les téléphones : seulement les lieux ouverts en ce moment ----
function refugesLive(now = Date.now()) {
  const open = all().filter(r => isOpen(r, now));
  // Noms d'orgas à jour (une orga renommée garde ses lieux)
  const names = orgaNames();
  // Logo : celui du lieu (posé par l'admin) d'abord, sinon celui de la première orga associée qui en a un validé
  const logos = {}, key = s => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 8);
  const logoOf = r => {
    if (r.logo) { const k = key('lieu:' + r.logo); logos[k] = r.logo; return k; }
    if (!r.useLogo) return null;
    for (const oid of orgasOf(r)) { const l = getLogo(oid); if (l && l.status === 'ok') { const k = key('logo:' + oid); logos[k] = l.data; return k; } }
    return null;
  };
  return {
    p: open.map(r => ({ id: r.id, o: labelOf(r, names), n: r.name, s: r.short || '', a: r.addr || '', m: r.msg || '', u: r.url || '', lat: r.lat, lng: r.lng, sv: r.services,
      g: r.glyph, c: r.color, lg: logoOf(r), st: r.state === 'full' ? 'full' : 'open', to: r.to })),
    lg: logos,
  };
}
// Ouvertures et fermetures à heure fixe : la balayeuse republie quand la liste des lieux ouverts change
let lastKey = null;
function refugesTick(now = Date.now()) {
  const key = all().filter(r => isOpen(r, now)).map(r => r.id).sort().join(',');
  if (key !== lastKey) { lastKey = key; dirty.repli = true; return true; }
  return false;
}

module.exports = { REFUGE_SERVICES, REFUGE_GLYPHS, REFUGE_COLORS, REFUGE_MAX, QUOTA_MAX, quotaOf, setQuota, quotas, adminSave, adminView, forgetOrga, orgasOf, mine, all, getRefuge, createRefuge, updateRefuge, removeRefuge, dropRefuge, openRefuges, setRefugeState,
  refugeView, setLogo, dropLogo, judgeLogo, getLogo, logosPending, refugesLive, refugesTick, pngSize };
