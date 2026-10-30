'use strict';
const crypto = require('crypto');
const { GEO_API, normName, geoPoly, depOf } = require('./geo/departments');
const { LOCALE, tr, pushSendAll } = require('./push');
const { MIN } = require('./config');
const { allow } = require('./limits');
const { clean, distKm } = require('./util');
const { dirty, scheduleFlush } = require('./live/files');

const { polyHas } = require('./geo/communes');
const { q } = require('./db');
const { getJson } = require('./net');
const { parisMs } = require('./time');

// ---- Arrêtés et restrictions (interdiction de manif, couvre-feu, transports…) ----
// N'importe qui peut proposer, avec une source fiable ; seul l'admin valide. La zone est une commune ou un département :
// son contour officiel est envoyé aux téléphones, qui affichent un bandeau quand on regarde la zone ou qu'on s'y trouve.
const ORDER_KINDS = [
  { id: 'manif', glyph: '🚫', label: 'Manifestation interdite' }, { id: 'perimetre', glyph: '⛔', label: 'Périmètre interdit' },
  { id: 'couvre', glyph: '🌙', label: 'Couvre-feu' }, { id: 'transport', glyph: '🚋', label: 'Transports' },
  { id: 'consigne', glyph: '⚠', label: 'Consigne' }, { id: 'autre', glyph: 'ℹ', label: 'Information' },
];
const ORDER_KIND = Object.fromEntries(ORDER_KINDS.map(k => [k.id, k]));
// Départements : contours simplifiés (≈ 400 m) d'après france-geojson (IGN, licence ouverte) ; outre-mer : par commune seulement
async function communeZone(dep, name, insee) {
  const f = 'fields=nom,code,codeDepartement,population,contour&format=json';
  let list;
  if (/^\d[\dAB]\d{3}$/.test(insee || '')) list = [await getJson(`${GEO_API}/communes/${insee}?${f}`, 15_000)];
  else list = await getJson(`${GEO_API}/communes?nom=${encodeURIComponent(name)}&codeDepartement=${encodeURIComponent(dep)}&boost=population&limit=10&${f}`, 15_000);
  list = (Array.isArray(list) ? list : []).filter(c => c && c.contour);
  const c = list.find(c => normName(c.nom) === normName(name)) || (insee ? list[0] : null);
  if (!c) throw new Error(`commune « ${name} » introuvable dans le département ${dep}${list.length ? ` (proches : ${list.slice(0, 3).map(x => x.nom).join(', ')})` : ''}`);
  const z = geoPoly(c.contour);
  if (!z) throw new Error('contour de la commune illisible');
  return { scope: 'commune', name: c.nom, insee: c.code, dep: c.codeDepartement, ...z };
}
async function orderZone(o) {
  const d = depOf(o.dep);
  if (!d) throw new Error('département inconnu');
  if (o.commune) return communeZone(d.c, o.commune, o.insee);
  if (!d.p) throw new Error(`pour ${d.n}, indique la commune`);
  return { scope: 'dep', name: d.n, insee: null, dep: d.c, p: d.p, b: d.b };
}
const getOrder = id => { const x = q('SELECT data FROM orders WHERE id=?').get(id); return x ? JSON.parse(x.data) : null; };
function saveOrder(o) { q('INSERT OR REPLACE INTO orders(id,status,end,dev,data) VALUES(?,?,?,?,?)').run(o.id, o.status, o.end, o.dev || null, JSON.stringify(o)); dirty.ord = true; scheduleFlush(); }
function dropOrder(id) { const n = q('DELETE FROM orders WHERE id=?').run(id).changes; if (n) { dirty.ord = true; scheduleFlush(); } return n > 0; }
const ordersAll = () => q('SELECT data FROM orders ORDER BY end').all().map(x => JSON.parse(x.data));
const srcHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const orderView = o => ({ id: o.id, status: o.status, dep: o.dep, commune: o.commune || '', start: o.start, end: o.end, items: o.items, src: o.src, host: srcHost(o.src),
  by: o.by, t: o.t, ok: o.ok || null, zone: o.zone ? { scope: o.zone.scope, name: o.zone.name, insee: o.zone.insee, dep: o.zone.dep } : null });
const ordersLive = now => ordersAll().filter(o => o.status === 'ok' && o.end > now && o.zone)
  .map(o => ({ id: o.id, start: o.start, end: o.end, items: o.items, src: o.src, host: srcHost(o.src), ok: o.ok, scope: o.zone.scope, name: o.zone.name, dep: o.zone.dep, b: o.zone.b, p: o.zone.p }));
// Heure de Paris : « 2026-10-24 20:00 », « 2026-10-24T20:00 », ou horodatage en millisecondes
const whenMs = v => typeof v === 'number' ? v : /^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?$/.test(String(v || '').trim())
  ? parisMs(String(v).trim().slice(0, 10), String(v).trim().slice(11) || '00:00') : NaN;
function cleanOrder(b) {
  const d = depOf(b.dep ?? b.departement);
  if (!d) return [null, 'Choisis le département.'];
  const commune = clean(b.commune, 80), insee = clean(b.insee, 5);
  const start = whenMs(b.start ?? b.debut), end = whenMs(b.end ?? b.fin), now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [null, 'Indique le début et la fin.'];
  if (end <= start) return [null, 'La fin doit être après le début.'];
  if (end <= now) return [null, 'Cette mesure est déjà terminée.'];
  if (start > now + 60 * 24 * 60 * MIN || end - start > 62 * 24 * 60 * MIN) return [null, 'Dates trop lointaines (2 mois au plus).'];
  const raw = Array.isArray(b.items ?? b.mesures) ? (b.items ?? b.mesures) : [];
  const items = raw.slice(0, 8).map(x => Array.isArray(x) ? { k: x[0], text: x[1] } : { k: x && (x.k ?? x.type), text: x && (x.text ?? x.texte) })
    .map(x => ({ k: Object.hasOwn(ORDER_KIND, String(x.k)) ? String(x.k) : 'autre', text: clean(x.text, 220) })).filter(x => x.text.length >= 3);
  if (!items.length) return [null, 'Décris au moins une mesure.'];
  const src = clean(b.src ?? b.source, 400);
  let u; try { u = new URL(src); } catch {}
  if (!u || !/^https?:$/.test(u.protocol)) return [null, 'Donne le lien de la source (site de la préfecture, compte officiel ou article de presse).'];
  return [{ dep: d.c, commune, insee: /^\d[\dAB]\d{3}$/.test(insee) ? insee : '', start, end, items, src: u.href }, null];
}
// Proposition (téléphone) : en attente de validation ; admin : publiée tout de suite (après calcul de la zone)
async function createOrder(b, { admin = false, dev = null, ipH = null } = {}) {
  const [o, err] = cleanOrder(b);
  if (err) return [400, { error: err }];
  const now = Date.now();
  if (!admin) {
    if (!allow(dev, ipH, 'report', now)) return [429, { error: 'Trop d’envois d’un coup. Réessaie dans quelques minutes.' }];
    if (q("SELECT COUNT(*) n FROM orders WHERE status='pending' AND dev=?").get(dev).n >= 3) return [429, { error: 'Tu as déjà 3 propositions en attente de validation.' }];
    if (q("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n >= 200) return [503, { error: 'Trop de propositions en attente, réessaie plus tard.' }];
    const p = { id: crypto.randomBytes(6).toString('base64url'), ...o, status: 'pending', by: 'Proposition de participant·e', dev, t: now };
    saveOrder(p);
    return [201, orderView(p)];
  }
  let zone; try { zone = await orderZone(o); } catch (e) { return [400, { error: 'Zone : ' + e.message }]; }
  const p = { id: crypto.randomBytes(6).toString('base64url'), ...o, zone, status: 'ok', by: 'admin', t: now, ok: now };
  saveOrder(p); orderPushLater(p);
  return [201, orderView(p)];
}
async function approveOrder(id) {
  const o = getOrder(id);
  if (!o) return [404, { error: 'Introuvable.' }];
  let zone; try { zone = await orderZone(o); } catch (e) { return [400, { error: 'Zone : ' + e.message }]; }
  const p = { ...o, zone, status: 'ok', ok: Date.now() }; delete p.dev;
  saveOrder(p); if (o.status !== 'ok') orderPushLater(p);
  return [200, orderView(p)];
}
// Nouvel arrêté validé : notification aux abonné·es dont la zone (arrondie à ~10 km) touche la zone de l'arrêté.
// Les arrêtés validés à quelques secondes d'écart (import de plusieurs arrêtés) partent ensemble : une seule notification.
const ORDER_PUSH_WAIT = +(process.env.ORDER_PUSH_WAIT_MS || 60_000);
let orderPushQ = [], orderPushT = null;
function orderPushLater(o) {
  orderPushQ.push(o.id);
  clearTimeout(orderPushT);
  orderPushT = setTimeout(() => { const ids = orderPushQ; orderPushQ = []; orderPush(ids).catch(e => console.error('push arrêtés', e.message)); }, ORDER_PUSH_WAIT);
}
// La zone de l'abonné·e est arrondie à 0,1° : on compte aussi les arrêtés à moins de ~8 km de ce point
function orderTouches(o, lat, lng) {
  const z = o.zone, m = 0.07;
  if (!z || !z.b || lat < z.b[0] - m || lat > z.b[2] + m || lng < z.b[1] - m * 1.5 || lng > z.b[3] + m * 1.5) return false;
  if (polyHas(z.p, lat, lng)) return true;
  for (const [dy, dx] of [[m, 0], [-m, 0], [0, m * 1.5], [0, -m * 1.5]]) if (polyHas(z.p, lat + dy, lng + dx)) return true;
  return z.scope === 'commune' && distKm(lat, lng, (z.b[0] + z.b[2]) / 2, (z.b[1] + z.b[3]) / 2) <= 8;
}
async function orderPush(ids) {
  const now = Date.now(), list = ids.map(getOrder).filter(o => o && o.status === 'ok' && o.end > now && o.zone && o.zone.p);
  if (!list.length) return;
  const groups = new Map();
  for (const s of q('SELECT * FROM push WHERE ord=1 AND lat IS NOT NULL').all()) {
    const mine = list.filter(o => orderTouches(o, s.lat, s.lng));
    if (!mine.length) continue;
    const k = mine.map(o => o.id).join(',');
    if (!groups.has(k)) groups.set(k, { mine, subs: [] });
    groups.get(k).subs.push(s);
  }
  for (const { mine, subs } of groups.values()) {
    const o = mine[0], k = ORDER_KIND[o.items[0].k] || ORDER_KIND.autre, z = o.zone;
    const when = l => new Date(o.start).toLocaleDateString(LOCALE[l], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
    const payload = l => JSON.stringify(mine.length === 1
      ? { title: `${k.glyph} ${tr(l, k.label)} · ${z.name}`, body: tr(l, 'Nouvel arrêté à partir du {d}. Ouvre Cortège pour voir la zone et la source.', { d: when(l) }),
          tag: 'ord-' + o.id, url: `/?at=${((z.b[0] + z.b[2]) / 2).toFixed(4)},${((z.b[1] + z.b[3]) / 2).toFixed(4)}`, vibrate: [200, 100, 200] }
      : { title: '⛔ ' + tr(l, '{n} nouveaux arrêtés dans ta zone', { n: mine.length }), body: [...new Set(mine.map(x => x.zone.name))].slice(0, 4).join(', '),
          tag: 'ord-' + o.id, url: '/', vibrate: [200, 100, 200] });
    await pushSendAll(subs, payload, false, 'arrêté');
  }
}

module.exports = { ORDER_KINDS, ORDER_KIND, dropOrder, ordersAll, srcHost, orderView, ordersLive, createOrder, approveOrder };
