'use strict';
// ---- Mode medic : une carte privée pour les équipes de street medics ----
// Comptes « équipe medic » (une clé par équipe, comme les orgas, mais sans aucun de leurs droits) et une couche de carte
// que seules ces équipes voient : leurs positions, des points chauds, des barrages filtrants, des appels de renfort.
// Les infos sont ajoutées et retirées à la main par les équipes : pas de votes, pas de fusion, rien ne vient de la foule.
//
// Vie privée, par construction :
// - la couche vit en mémoire seulement : jamais dans la base, les fichiers live/, le temps réel public, l'archive, les bilans
//   ni les sauvegardes ; elle disparaît au retrait, à l'expiration, au redémarrage et à l'effacement d'urgence ;
// - aucune donnée sur une personne blessée : un lieu, un type, un niveau, un état. Ni nom ni texte libre ;
// - l'admin ne voit que des totaux, jamais les positions ;
// - sur le disque : seulement la liste des équipes (nom, ville, empreintes des clés), dans medics.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, MIN } = require('./config');
const { sha, keyEq, withLock, validLatLng, distM, round, labelKey } = require('./util');
const { keyFailed } = require('./orgas/auth');
const { DEVICE_MAX, DEVICE_MS, newInvite } = require('./orgas/sponsor');
const { newCode, codeHash } = require('./orgas/recovery');
const { getMeta, setMeta, q, tx } = require('./db');
const { BEACON_TTL, BEACON_ZONE_M, toReport } = require('./reports/model');

// ---- Équipes (fichier medics.json, même forme que orgas.json) ----
const FILE = () => path.join(DATA_DIR, 'medics.json');
let cache = { mtime: -1, list: [] };
function readMedics() {
  try {
    const st = fs.statSync(FILE());
    if (st.mtimeMs !== cache.mtime) cache = { mtime: st.mtimeMs, list: JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
  } catch { cache = { mtime: -1, list: [] }; }
  return cache.list;
}
function writeMedics(list) {
  const tmp = FILE() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
  cache.mtime = -1;
}
// Modifie une équipe sous verrou ; fn reçoit l'équipe et renvoie la nouvelle (ou null pour ne rien changer)
function editTeam(id, fn) {
  return withLock(() => {
    const l = readMedics().slice(), i = l.findIndex(x => x.id === id);
    if (i < 0) return null;
    const n = fn(l[i]); if (!n) return null;
    l[i] = n; writeMedics(l); return n;
  });
}
const TEAM_MAX = 2000, REF_TEAMS = 40;
const cfg = () => { let c = {}; try { c = JSON.parse(getMeta('medic') || '{}'); } catch {} return { radiusKm: c.radiusKm >= 0.5 && c.radiusKm <= 30 ? c.radiusKm : 2 }; };
const saveCfg = b => { const r = Number(b.radiusKm); if (!(r >= 0.5 && r <= 30)) return null; const c = { radiusKm: Math.round(r * 10) / 10 }; setMeta('medic', JSON.stringify(c)); return c; };

// Clé d'équipe : tirée au hasard (144 bits), jamais soumise au verrou par réseau (voir orgas/auth.js)
function medicOf(req) {
  const k = String(req.headers['x-medic-key'] || '');
  if (!k) return null;
  const h = sha(k);
  const o = readMedics().find(o => keyEq(h, o.hash) || (o.keys || []).some(x => keyEq(h, x)));
  if (o) return { id: o.id, label: o.label, city: o.city || '', ref: o.ref === true };
  keyFailed(req); return null;
}
const cleanLabel = v => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
function createTeam({ label, city, ref, by }) {
  label = cleanLabel(label); city = cleanLabel(city).slice(0, 40);
  if (label.length < 2) return [400, { error: 'Donne un nom à l’équipe.' }];
  const { token, invite } = newInvite();
  const out = withLock(() => {
    const l = readMedics().slice();
    if (l.length >= TEAM_MAX) return 'full';
    if (l.some(o => labelKey(o.label) === labelKey(label))) return 'dup';
    if (by !== 'admin' && l.filter(o => o.by === by).length >= REF_TEAMS) return 'quota';
    const o = { id: crypto.randomBytes(5).toString('base64url'), label, city, ref: ref === true, hash: null, keys: [], created: Date.now(), by, invite };
    l.push(o); writeMedics(l); return o;
  });
  if (out === 'full') return [503, { error: 'Trop d’équipes enregistrées sur ce serveur.' }];
  if (out === 'dup') return [409, { error: 'Une équipe porte déjà ce nom.' }];
  if (out === 'quota') return [429, { error: '40 équipes au plus par référent·e.' }];
  return [201, { id: out.id, label: out.label, invite: token, exp: invite.exp }];
}
// Nouvelle invitation : l'ancien accès (clés, code de secours) est coupé, la couche oublie l'équipe
function reinviteTeam(id) {
  const { token, invite } = newInvite();
  const o = editTeam(id, t => ({ ...t, hash: null, keys: [], devInv: undefined, rec: undefined, recAt: undefined, invite }));
  if (!o) return [404, { error: 'Équipe introuvable.' }];
  forgetTeam(id);
  return [200, { id: o.id, label: o.label, invite: token, exp: invite.exp }];
}
function removeTeam(id) {
  const ok = withLock(() => { const l = readMedics(), n = l.filter(o => o.id !== id); if (n.length === l.length) return false; writeMedics(n); return true; });
  if (ok) forgetTeam(id);
  return ok;
}
// Échange d'une invitation contre une clé (appelé par /api/invite après les orgas). Première activation : code de secours donné.
function redeem(tokenHash, key) {
  return withLock(() => {
    const l = readMedics().slice(), now = Date.now();
    let i = l.findIndex(x => x.invite && keyEq(x.invite.h, tokenHash) && x.invite.exp > now);
    if (i >= 0) {
      const { invite, ...rest } = l[i], rec = newCode();
      l[i] = { ...rest, hash: sha(key), keys: [], rec: codeHash(rec), activated: rest.activated || now }; writeMedics(l);
      return { o: l[i], device: false, rec };
    }
    i = l.findIndex(x => x.devInv && keyEq(x.devInv.h, tokenHash) && x.devInv.exp > now);
    if (i >= 0) { const { devInv, ...rest } = l[i]; l[i] = { ...rest, keys: [...(rest.keys || []), sha(key)].slice(-(DEVICE_MAX - 1)) }; writeMedics(l); return { o: l[i], device: true }; }
    return null;
  });
}
function deviceLink(id) {
  const token = crypto.randomBytes(18).toString('base64url');
  return editTeam(id, t => ({ ...t, devInv: { h: sha(token), exp: Date.now() + DEVICE_MS } })) ? { invite: token, exp: Date.now() + DEVICE_MS } : null;
}
const teamView = o => ({ id: o.id, label: o.label, city: o.city || '', ref: o.ref === true, by: o.by || 'admin', created: o.created, active: !!o.hash,
  invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, devices: o.hash ? 1 + (o.keys || []).length : 0, rec: !!o.rec });

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
function pubDrop(tid) { try { const { dropReport } = require('./reports/store'); const c = pubCur(tid, Date.now()); if (c) dropReport(c.id, 'exp'); } catch (e) { console.error('medic (position publique)', e.message); } }
function pubSet(team, pos, now) {
  const { saveReport } = require('./reports/store');
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
  let done; const promise = new Promise(r => { done = r; });
  const fin = () => { clearTimeout(to); waiters.delete(fin); done(); };
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
  const { PUSH_HOSTS, PUSH_LANGS } = require('./push');
  const sub = b.sub || {}, endpoint = String(sub.endpoint || '');
  let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
  if (!PUSH_HOSTS.test(host) || endpoint.length > 1000) return [400, { error: 'Service de notification non pris en charge.' }];
  const k = String(sub.keys?.p256dh || '').replace(/=+$/, ''), a = String(sub.keys?.auth || '').replace(/=+$/, '');
  if (!/^[\w-]{86,88}$/.test(k) || !/^[\w-]{20,24}$/.test(a)) return [400, { error: 'Abonnement invalide.' }];
  let m = subs.get(team.id); if (!m) subs.set(team.id, (m = new Map()));
  const key = sha(endpoint).slice(0, 24);
  if (!m.has(key) && m.size >= DEVICE_MAX) m.delete(m.keys().next().value);
  const lat = Number(b.lat), lng = Number(b.lng);
  m.set(key, { e: endpoint, k, a, t: now, lang: PUSH_LANGS.includes(b.lang) ? b.lang : 'fr', ...(validLatLng(lat, lng) ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 } : {}) });
  return [200, { ok: true }];
}
function unsubscribe(team, endpoint) { subs.get(team.id)?.delete(sha(String(endpoint || '')).slice(0, 24)); return [200, { ok: true }]; }
// Urgence vitale : les autres équipes dans le rayon réglé par l'admin (position partagée, sinon zone de l'abonnement ;
// une équipe dont on ne sait rien est prévenue aussi : mieux vaut une notification de trop)
function vitalTargets(x) {
  const R = cfg().radiusKm * 1000, out = [];
  for (const [tid, m] of subs) {
    if (tid === x.tid) continue;
    const p = posOf(tid);
    for (const [key, s] of m) {
      const at = p || (s.lat != null ? s : null), d = at ? distM(at, x) : null;
      if (d == null || d <= R) out.push({ tid, key, s, d });
    }
  }
  return out;
}
async function notifyVital(x) {
  const { pushOne, tr } = require('./push');
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

module.exports = { readMedics, writeMedics, editTeam, medicOf, createTeam, reinviteTeam, removeTeam, redeem, deviceLink, teamView, cfg, saveCfg, cleanLabel,
  posSet, posStop, posOf, addItem, removeItem, goItem, state, waitChange, forgetTeam, wipe, subscribe, unsubscribe, vitalTargets, stats, sweep, POS_DUR };
