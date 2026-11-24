'use strict';
// Mode medic : les équipes et leurs appareils (clé d'équipe, invitation, code de secours, ajout et retrait d'un appareil).
const crypto = require('crypto');
const { sha, keyEq, withLock, labelKey } = require('../util');
const { keyFailed } = require('../orgas/auth');
const { MEDIC_DEVICE_MAX: DEVICE_MAX, DEVICE_MS, newInvite } = require('../orgas/sponsor');
const { newCode, codeHash } = require('../orgas/recovery');
const { readMedics, writeMedics, editTeam, TEAM_MAX, REF_TEAMS } = require('./store');
const { subs, changed, forgetTeam } = require('./layer');

// Clé d'équipe : tirée au hasard (144 bits), jamais soumise au verrou par réseau (voir orgas/auth.js)
function medicOf(req) {
  const k = String(req.headers['x-medic-key'] || '');
  if (!k) return null;
  const h = sha(k);
  const o = readMedics().find(o => keyEq(h, o.hash) || (o.keys || []).some(x => keyEq(h, x)));
  if (o) { devSeen(o, h, req); return { id: o.id, label: o.label, city: o.city || '', ref: o.ref === true, h }; }
  keyFailed(req); return null;
}

// ---- Appareils d'une équipe ----
// Pour qu'une équipe (ou son ou sa référent·e) reconnaisse et retire un appareil : le type d'appareil (iPhone, Android,
// ordinateur…, tiré du navigateur, jamais le modèle ni la version) et la date à laquelle il est apparu, gardés avec l'équipe.
// La dernière activité reste en mémoire seulement. Un appareil retiré perd l'accès à sa requête suivante.
const seen = new Map();
function devKind(ua) {
  ua = String(ua || '');
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux|CrOS/.test(ua) ? 'Linux' : '';
}
function devSeen(o, h, req) {
  const now = Date.now(), last = seen.get(h);
  if (!last || now - last > 60_000) { if (seen.size > 2000) seen.clear(); seen.set(h, now); }
  if (o.devs && o.devs[h]) return;
  const kind = devKind(req.headers['user-agent']);
  editTeam(o.id, t => {
    const live = new Set([t.hash, ...(t.keys || [])].filter(Boolean)), devs = {};
    for (const [k, v] of Object.entries(t.devs || {})) if (live.has(k)) devs[k] = v;
    if (live.has(h) && !devs[h]) devs[h] = { t: now, ua: kind };
    return { ...t, devs };
  });
}
const devId = h => String(h).slice(0, 12);
function devices(teamId, myHash) {
  const o = readMedics().find(x => x.id === teamId);
  if (!o) return null;
  return [o.hash, ...(o.keys || [])].filter(Boolean).map((h, i) => ({ id: devId(h), first: i === 0, me: !!myHash && keyEq(h, myHash),
    since: o.devs?.[h]?.t || null, kind: o.devs?.[h]?.ua || '', active: seen.get(h) || null }));
}
// Retire un appareil : sa clé ne vaut plus rien, ses notifications d'urgence s'arrêtent. Jamais le dernier, ni celui qui demande.
function removeDevice(teamId, id, myHash) {
  let out = 'none', gone = null;
  editTeam(teamId, t => {
    const all = [t.hash, ...(t.keys || [])].filter(Boolean), h = all.find(x => devId(x) === String(id));
    if (!h) return null;
    if (myHash && keyEq(h, myHash)) { out = 'self'; return null; }
    if (all.length < 2) { out = 'last'; return null; }
    const rest = all.filter(x => x !== h), devs = { ...(t.devs || {}) }; delete devs[h];
    out = 'ok'; gone = h;
    return { ...t, hash: rest[0], keys: rest.slice(1), devs };
  });
  if (out === 'self') return [400, { error: 'Pour retirer ce téléphone, utilise « Quitter le mode medic sur ce téléphone ».' }];
  if (out === 'last') return [400, { error: 'C’est le seul appareil de l’équipe : pour couper l’accès, réinvite l’équipe.' }];
  if (out !== 'ok') return [404, { error: 'Appareil introuvable.' }];
  seen.delete(gone);
  for (const [key, s] of subs.get(teamId) || []) if (s.h && keyEq(s.h, gone)) subs.get(teamId).delete(key);
  changed(); // l'écran ouvert sur l'appareil retiré relit tout de suite, et apprend que sa clé ne vaut plus
  return [200, { ok: true }];
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
  const o = editTeam(id, t => ({ ...t, hash: null, keys: [], devs: {}, devInv: undefined, rec: undefined, recAt: undefined, invite }));
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

module.exports = { medicOf, seen, devKind, devSeen, devId, devices, removeDevice, cleanLabel, createTeam, reinviteTeam, removeTeam, redeem, deviceLink, teamView };
