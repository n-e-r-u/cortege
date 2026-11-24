'use strict';
// Mode medic : la couche privée, en mémoire seulement (positions, points chauds, barrages, appels de renfort), l'attente
// longue, les notifications entre équipes et les totaux pour l'admin. Rien ici n'est écrit sur le disque.
const crypto = require('crypto');
const { MIN } = require('../config');
const { sha, keyEq, validLatLng, distM, round } = require('../util');
const { MEDIC_DEVICE_MAX: DEVICE_MAX } = require('../orgas/sponsor');
const { q, tx } = require('../db');
const { BEACON_TTL, BEACON_ZONE_M, toReport } = require('../reports/model');
const { readMedics, cfg } = require('./store');

// ---- Couche privée, en mémoire ----
// k : pos (position d'une équipe), hot (point chaud), block (barrage filtrant), help (appel de renfort)
const KINDS = new Set(['hot', 'block', 'help']), LEVELS = new Set(['duo', 'vital', 'gear']);
const TTL = { hot: 120 * MIN, block: 120 * MIN, help: 60 * MIN }, POS_MAX = 4 * 60 * MIN, POS_DUR = [30, 60, 120, 240];
const ITEM_MAX = 2000, TEAM_ITEMS = 40;
const items = new Map(), subs = new Map(), rate = new Map(), waiters = new Set();
let ver = 1, helpsToday = { day: '', n: 0 };
const changed = () => { ver++; for (const w of [...waiters]) w(); };
const id8 = () => crypto.randomBytes(6).toString('base64url');
// Limite en mémoire : n ajouts par équipe et par 10 minutes
function allow(tid, max = 40, win = 10 * MIN, now = Date.now()) {
  const r = rate.get(tid); if (!r || now - r.t > win) { rate.set(tid, { t: now, n: 1 }); return true; }
  return ++r.n <= max;
}
const posOf = tid => { for (const x of items.values()) if (x.k === 'pos' && x.tid === tid) return x; return null; };

// Position publique (au choix de l'équipe) : un signalement « Street medic » vérifié, tenu à jour comme la position en direct des orgas
const owner = tid => 'm:' + tid;
const pubCur = (tid, now) => toReport(q("SELECT * FROM reports WHERE owner=? AND cat='medic' AND bk>0 AND exp>?").get(owner(tid), now));
function pubDrop(tid) { try { const { dropReport } = require('../reports/store'); const c = pubCur(tid, Date.now()); if (c) dropReport(c.id, 'exp'); } catch (e) { console.error('medic (position publique)', e.message); } }
function pubSet(team, pos, now) {
  const { saveReport } = require('../reports/store');
  tx(() => {
    const cur = pubCur(team.id, now);
    if (cur) { Object.assign(cur, { lat: pos.lat, lng: pos.lng, last: now, exp: now + BEACON_TTL, down: 0, downIps: [], dw: 0, ct: 0, ver: team.label, fl: 1 }); saveReport(cur); return; }
    saveReport({ id: id8(), cat: 'medic', lat: pos.lat, lng: pos.lng, note: '', notes: [], t: now, last: now, exp: now + BEACON_TTL, up: 0, down: 0, voters: [owner(team.id)], downIps: [],
      ip: null, ver: team.label, fl: 1, oid: owner(team.id), bk: now, trail: [], bkla: pos.lat, bklo: pos.lng });
  });
}

function posStop(tid) { const p = posOf(tid); if (p) { items.delete(p.id); changed(); } pubDrop(tid); return !!p; }
// Position de l'équipe : démarrée par le bouton seulement (start), tenue par les envois du téléphone, arrêtée après 3 min sans
// envoi, à la fin de la durée choisie, ou à plus de 2 km du point de départ (une équipe qui rentre ne révèle pas où elle va).
function posSet(team, b, now = Date.now()) {
  const cur = posOf(team.id);
  if (!cur && b.start !== true) return [410, { error: 'Partage de position arrêté. Relance-le si besoin.', lapsed: true }];
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  if (cur && (now >= cur.until || distM({ lat: cur.la0, lng: cur.lo0 }, { lat, lng }) > BEACON_ZONE_M)) {
    const far = now < cur.until; posStop(team.id);
    if (far) return [410, { error: 'Tu t’es éloigné·e de plus de 2 km : partage de position arrêté.', zone: true }];
    return [410, { error: 'Partage de position terminé. Relance-le si besoin.', zone: false }];
  }
  const pos = { lat: round(lat), lng: round(lng) };
  if (cur) {
    const moved = cur.lat !== pos.lat || cur.lng !== pos.lng;
    Object.assign(cur, pos, { up: now });
    if (cur.pub) pubSet(team, pos, now);
    if (moved) changed();
    return [200, { ok: true, until: cur.until }];
  }
  if (items.size >= ITEM_MAX) return [503, { error: 'Carte medic saturée, réessaie plus tard.' }];
  const dur = POS_DUR.includes(Number(b.dur)) ? Number(b.dur) : 120, pub = b.pub === true;
  const p = { id: id8(), k: 'pos', tid: team.id, team: team.label, ...pos, t: now, up: now, until: Math.min(now + dur * MIN, now + POS_MAX), la0: pos.lat, lo0: pos.lng, pub };
  items.set(p.id, p);
  if (pub) pubSet(team, pos, now);
  changed();
  return [201, { ok: true, until: p.until }];
}
function addItem(team, b, now = Date.now()) {
  const k = String(b.k || '');
  if (!KINDS.has(k)) return [400, { error: 'Type inconnu.' }];
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  const lvl = k === 'help' ? String(b.lvl || '') : null;
  if (k === 'help' && !LEVELS.has(lvl)) return [400, { error: 'Niveau inconnu.' }];
  if (!allow(team.id)) return [429, { error: 'Trop d’ajouts d’un coup, patiente un peu.' }];
  if (items.size >= ITEM_MAX || [...items.values()].filter(x => x.tid === team.id && x.k !== 'pos').length >= TEAM_ITEMS) return [503, { error: 'Trop d’infos en cours : retire celles qui ne sont plus vraies.' }];
  const x = { id: id8(), k, tid: team.id, team: team.label, lat: round(lat), lng: round(lng), t: now, up: now, exp: now + TTL[k], ...(lvl ? { lvl, go: [] } : {}) };
  items.set(x.id, x); changed();
  if (k === 'help') {
    const d = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    helpsToday = helpsToday.day === d ? { day: d, n: helpsToday.n + 1 } : { day: d, n: 1 };
    if (lvl === 'vital' && process.env.MEDIC_PUSH !== '0') notifyVital(x).catch(e => console.error('medic (notification)', e.message));
  }
  return [201, view(x, team)];
}
// Retirer une info : toute équipe le peut (c'est le terrain qui fait foi) ; une position, seulement l'équipe elle-même
function removeItem(team, id) {
  const x = items.get(id);
  if (!x || x.k === 'pos') return [404, { error: 'Déjà retiré.' }];
  items.delete(id); changed();
  return [200, { ok: true }];
}
// « J'y vais » sur un appel de renfort : les autres équipes voient qui est en route
function goItem(team, id, on, now = Date.now()) {
  const x = items.get(id);
  if (!x || x.k !== 'help') return [404, { error: 'Appel déjà réglé ou retiré.' }];
  x.go = x.go.filter(g => g.tid !== team.id);
  if (on) x.go.push({ tid: team.id, team: team.label, t: now });
  x.up = now; changed();
  return [200, view(x, team)];
}
const view = (x, me) => ({ id: x.id, k: x.k, lat: x.lat, lng: x.lng, t: x.t, team: x.team, mine: x.tid === me.id,
  ...(x.k === 'pos' ? { until: x.until, pub: !!x.pub } : { exp: x.exp }),
  ...(x.k === 'help' ? { lvl: x.lvl, go: x.go.map(g => g.team), iGo: x.go.some(g => g.tid === me.id) } : {}) });
function sweep(now = Date.now()) {
  let n = 0;
  for (const x of [...items.values()]) {
    const dead = x.k === 'pos' ? now - x.up > BEACON_TTL || now >= x.until : now >= x.exp;
    if (dead) { items.delete(x.id); if (x.k === 'pos' && x.pub) pubDrop(x.tid); n++; }
  }
  for (const [tid, m] of subs) { for (const [k, s] of m) if (now - s.t > 24 * 60 * MIN) m.delete(k); if (!m.size) subs.delete(tid); }
  for (const [k, r] of rate) if (now - r.t > 10 * MIN) rate.delete(k);
  if (n) changed();
}
setInterval(sweep, 15_000).unref();
function state(me, now = Date.now()) {
  sweep(now);
  return { v: ver, t: now, items: [...items.values()].map(x => view(x, me)) };
}
// Attente longue : la réponse part dès qu'une info change (au plus 25 s), sans rien publier nulle part
const WAIT_MAX = 3000;
function waitChange(v, ms = 25_000) {
  if (v !== ver || waiters.size >= WAIT_MAX) return { promise: Promise.resolve(), cancel() {} };
  const { promise, resolve } = Promise.withResolvers();
  const fin = () => { clearTimeout(to); waiters.delete(fin); resolve(); };
  const to = setTimeout(fin, ms); waiters.add(fin);
  return { promise, cancel: fin };
}
function forgetTeam(tid) {
  for (const x of [...items.values()]) {
    if (x.tid === tid) items.delete(x.id);
    else if (x.k === 'help' && x.go.some(g => g.tid === tid)) x.go = x.go.filter(g => g.tid !== tid);
  }
  subs.delete(tid); pubDrop(tid);
  changed(); // même sans info à retirer : les écrans de l'équipe relisent, et apprennent que leur clé ne vaut plus
}
// Effacement d'urgence, tests : tout oublier
function wipe() { for (const x of items.values()) if (x.k === 'pos' && x.pub) pubDrop(x.tid); items.clear(); subs.clear(); rate.clear(); helpsToday = { day: '', n: 0 }; changed(); }

// ---- Notifications aux équipes (abonnements gardés en mémoire, réenregistrés par le téléphone à chaque ouverture) ----
function subscribe(team, b, now = Date.now()) {
  const { PUSH_HOSTS, PUSH_LANGS } = require('../push');
  const sub = b.sub || {}, endpoint = String(sub.endpoint || '');
  let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
  if (!PUSH_HOSTS.test(host) || endpoint.length > 1000) return [400, { error: 'Service de notification non pris en charge.' }];
  const k = String(sub.keys?.p256dh || '').replace(/=+$/, ''), a = String(sub.keys?.auth || '').replace(/=+$/, '');
  if (!/^[\w-]{86,88}$/.test(k) || !/^[\w-]{20,24}$/.test(a)) return [400, { error: 'Abonnement invalide.' }];
  let m = subs.get(team.id); if (!m) subs.set(team.id, (m = new Map()));
  const key = sha(endpoint).slice(0, 24);
  if (!m.has(key) && m.size >= DEVICE_MAX) m.delete(m.keys().next().value);
  const lat = Number(b.lat), lng = Number(b.lng);
  m.set(key, { e: endpoint, k, a, t: now, h: team.h || null, lang: PUSH_LANGS.includes(b.lang) ? b.lang : 'fr', ...(validLatLng(lat, lng) ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 } : {}) });
  return [200, { ok: true }];
}
function unsubscribe(team, endpoint) { subs.get(team.id)?.delete(sha(String(endpoint || '')).slice(0, 24)); return [200, { ok: true }]; }
// Urgence vitale : les autres équipes dans le rayon réglé par l'admin (position partagée, sinon zone de l'abonnement ;
// une équipe dont on ne sait rien est prévenue aussi : mieux vaut une notification de trop)
function vitalTargets(x) {
  const R = cfg().radiusKm * 1000, out = [], teams = new Map(readMedics().map(o => [o.id, [o.hash, ...(o.keys || [])].filter(Boolean)]));
  for (const [tid, m] of subs) {
    if (tid === x.tid) continue;
    const p = posOf(tid), live = teams.get(tid) || [];
    for (const [key, s] of m) {
      if (s.h && !live.some(h => keyEq(h, s.h))) { m.delete(key); continue; }
      const at = p || (s.lat != null ? s : null), d = at ? distM(at, x) : null;
      if (d == null || d <= R) out.push({ tid, key, s, d });
    }
  }
  return out;
}
async function notifyVital(x) {
  const { pushOne, tr } = require('../push');
  for (const { tid, key, s, d } of vitalTargets(x)) {
    const where = d == null ? '' : ' ' + tr(s.lang, 'à {d}', { d: d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km' });
    const code = await pushOne(s, JSON.stringify({ title: '🆘 ' + tr(s.lang, 'Renfort medic : urgence vitale'), body: tr(s.lang, 'Demandé par {team}', { team: x.team }) + where,
      tag: 'medic-' + x.id, url: '/?medic=' + x.id, vibrate: [400, 100, 400, 100, 400, 100, 400] }), true);
    if (code === 404 || code === 410) subs.get(tid)?.delete(key);
  }
}
// Totaux pour l'admin : jamais de position ni de nom d'équipe par info
function stats(now = Date.now()) {
  sweep(now);
  const n = k => [...items.values()].filter(x => x.k === k).length;
  const d = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  return { pos: n('pos'), hot: n('hot'), block: n('block'), help: n('help'), helpsToday: helpsToday.day === d ? helpsToday.n : 0, listening: waiters.size };
}

module.exports = { KINDS, LEVELS, TTL, POS_MAX, POS_DUR, ITEM_MAX, TEAM_ITEMS, items, subs, rate, waiters, changed, id8, allow, posOf, owner, pubCur, pubDrop, pubSet, posStop, posSet, addItem, removeItem, goItem, view, sweep, state, WAIT_MAX, waitChange, forgetTeam, wipe, subscribe, unsubscribe, vitalTargets, notifyVital, stats };
