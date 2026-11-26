'use strict';
// Espace orga, l'accès : état du compte, code de secours, tableau de bord, rappels, ses annonces, parrainage, ajout d'un appareil.
// Appelées par routes/orga.js, une fois la clé d'orga vérifiée.
const crypto = require('crypto');
const { banUntil, newInvite, SPONSOR, orgaReady, DEVICE_MS } = require('../orgas/sponsor');
const { NEXT } = require('./next');
const { MIN } = require('../config');
const { annAll, annView } = require('../announcements/store');
const { newCode, codeHash, validCode } = require('../orgas/recovery');
const { mobsAll } = require('../settings');
const { labelClash } = require('../orgas/names');
const { orgaLog } = require('../orgas/log');
const { ownerTag } = require('../orgas/owner');
const { q } = require('../db');
const { quota } = require('../limits');
const { readOrgas, writeOrgas } = require('../orgas/store');
const { send, readJson } = require('../http/respond');
const { orgaBoard, remindSet, remindDrop } = require('../orgas/board');
const { sha, withLock, keyEq } = require('../util');

// État de l'accès, pour l'espace orga et l'écran medic : code de secours présent, dernière récupération (14 jours),
// et rappel la veille et le jour d'une mobilisation tant qu'il n'y a ni code de secours ni deuxième appareil
function accessState(me, now = Date.now()) {
  if (!me) return { rec: false, recAt: null, warn: false };
  const day = d => new Date(now + d * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const soon = mobsAll().some(m => m.date === day(0) || m.date === day(1));
  return { rec: !!me.rec, recAt: me.recAt && now - me.recAt < 14 * 864e5 ? me.recAt : null, warn: soon && !me.rec && !(me.keys || []).length };
}
async function orgaAccesRoutes(req, res, url, pathname, orga) {
  if (req.method === 'GET' && pathname === '/api/orga/me') {
    const me = readOrgas().find(x => x.id === orga.id);
    return send(res, 200, { label: orga.label, ob: ownerTag(orga.admin ? 'admin' : orga.id), admin: orga.admin, trial: orga.trial, sponsored: !!orga.sponsored,
      sponsor: me && me.by ? (readOrgas().find(x => x.id === me.by)?.label || me.byLabel || null) : null,
      canInvite: !orga.trial && !banUntil(orga.id), ban: banUntil(orga.id), canAddDevice: !!me, devices: me && me.hash ? 1 + (me.keys || []).length : 0,
      ...accessState(me) });
  }
  // Nouveau code de secours (le précédent ne sert plus) : montré une seule fois
  if (req.method === 'POST' && pathname === '/api/orga/recovery') {
    const me = readOrgas().find(x => x.id === orga.id);
    if (!me) return send(res, 400, { error: 'Pas possible pour un accès défini par l’admin dans les réglages du serveur.' });
    // Avec un code déjà créé, il faut le présenter : une clé volée seule ne peut pas le remplacer (et mettre l'orga dehors)
    const b = await readJson(req);
    if (me.rec && !(validCode(b.code) && keyEq(me.rec, codeHash(b.code)))) return send(res, 409, { error: 'Pour créer un nouveau code, saisis le code de secours actuel. Tu l’as perdu : demande à l’admin ou à ta marraine une nouvelle invitation.', needCode: true });
    if (!quota('rec:' + orga.id, 5, 60 * MIN)) return send(res, 429, { error: 'Trop de codes demandés, réessaie plus tard.' });
    const rec = newCode();
    withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === orga.id); if (i >= 0) { l[i] = { ...l[i], rec: codeHash(rec) }; writeOrgas(l); } });
    orgaLog(orga, 'code de secours créé');
    return send(res, 200, { rec });
  }

  // Couper des appareils : sans option, la clé de CE téléphone ; { others: true }, tous les AUTRES (téléphone perdu ou saisi).
  // Le code de secours reste valable : une clé coupée est remplacée par une clé que personne ne connaît, pas par un accès vide.
  if (req.method === 'POST' && pathname === '/api/orga/revoke') {
    const b = await readJson(req);
    const dead = () => sha(crypto.randomBytes(18).toString('base64url'));
    const out = withLock(() => {
      const l = readOrgas().slice(), i = l.findIndex(x => x.id === orga.id);
      if (i < 0 || !orga.kh) return false;
      const o = l[i], all = [o.hash, ...(o.keys || [])].filter(Boolean);
      const left = b.others === true ? all.filter(k => keyEq(k, orga.kh)) : all.filter(k => !keyEq(k, orga.kh));
      l[i] = { ...o, hash: left[0] || dead(), keys: left.slice(1), devInv: undefined }; writeOrgas(l); return true;
    });
    if (!out) return send(res, 400, { error: 'Pas possible pour un accès défini par l’admin dans les réglages du serveur.' });
    orgaLog(orga, b.others === true ? 'autres appareils coupés' : 'appareil coupé');
    return send(res, 200, { ok: true });
  }

  // Tableau de bord (« Mon orga ») : chiffres tirés du journal, prochains rendez-vous
  if (req.method === 'GET' && pathname === '/api/orga/board') return send(res, 200, orgaBoard(orga));
  // Rappels avant ses rendez-vous de l'agenda : l'adresse de notification de ce téléphone, gardée seulement si l'orga le demande
  if (pathname === '/api/orga/remind' && (req.method === 'POST' || req.method === 'DELETE')) {
    const b = await readJson(req);
    if (req.method === 'DELETE') { remindDrop(orga.id, String(b.endpoint || '')); return send(res, 200, { ok: true, on: false }); }
    return send(res, ...remindSet(orga, b));
  }

  // Ses propres annonces, y compris les numéros en attente de validation
  if (req.method === 'GET' && pathname === '/api/orga/mine') {
    return send(res, 200, { a: annAll(Date.now()).filter(a => orga.admin ? true : a.oid === orga.id).sort((a, b) => b.t - a.t).map(annView) });
  }

  // --- Parrainage : une orga confirmée invite une autre orga (QR code / lien à usage unique, 24 h) ---
  if (req.method === 'POST' && pathname === '/api/orga/invite') {
    if (orga.trial) return send(res, 400, { error: 'Seules les orgas confirmées peuvent inviter.' });
    const ban = banUntil(orga.id);
    if (ban) return send(res, 400, { error: 'Invitations suspendues jusqu’au ' + new Date(ban).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' (une orga que tu as invitée a été révoquée).' });
    const b = await readJson(req);
    const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga invitée.' });
    const { token, invite } = newInvite();
    const out = withLock(() => {
      const list = readOrgas().slice();
      if (labelClash(label, { sponsor: true })) return 'dup';
      if (!orga.admin && list.filter(o => o.by === orga.id && o.created > Date.now() - SPONSOR.quotaMs).length >= SPONSOR.quota) return 'quota';
      const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, sponsored: true, by: orga.id, byLabel: orga.label, invite };
      list.push(o); writeOrgas(list); return o;
    });
    if (out === 'dup') return send(res, 409, { error: labelClash(label, { sponsor: true }) || 'Une orga porte déjà ce nom.' });
    if (out === 'quota') return send(res, 429, { error: `${SPONSOR.quota} invitations par semaine au maximum. Réessaie dans quelques jours.` });
    orgaLog(orga, 'invitation (parrainage)', { ref: out.id, detail: out.label });
    return send(res, 201, { id: out.id, label: out.label, invite: token, exp: invite.exp });
  }
  if (req.method === 'GET' && pathname === '/api/orga/filleules') {
    const list = readOrgas().filter(o => o.by === orga.id);
    return send(res, 200, { orgas: list.map(o => ({ id: o.id, label: o.label, created: o.created, active: !!o.hash, trial: o.trial === true,
      invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, ...orgaReady(o),
      recent: q('SELECT t, action, cat FROM orga_log WHERE oid=? ORDER BY t DESC LIMIT 15').all(o.id) })) });
  }
  const fil = pathname.match(/^\/api\/orga\/filleules\/([\w-]{1,16})\/(confirm|invite)$/);
  if (req.method === 'POST' && fil) {
    const target = readOrgas().find(o => o.id === fil[1] && o.by === orga.id);
    if (!target) return send(res, 404, { error: 'Orga introuvable parmi tes invitées.' });
    if (fil[2] === 'confirm') {
      // Une marraine elle-même en essai ou suspendue (après le retrait d'une de ses filleules) ne confirme personne
      if (orga.trial || banUntil(orga.id) > Date.now()) return send(res, 403, { error: 'Tu ne peux pas confirmer d’orga pour le moment.' });
      if (!target.trial) return send(res, 400, { error: 'Déjà confirmée.' });
      if (!orgaReady(target).ready) return send(res, 400, { error: 'Pas encore prête : il faut au moins 7 jours, 10 actions et aucun incident. Seul·e l’admin peut la confirmer avant.' });
      withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], trial: false }; writeOrgas(l); } });
      orgaLog(orga, 'confirmée (parrainage)', { ref: target.id, detail: target.label });
      return send(res, 200, { id: target.id, trial: false });
    }
    // Nouvelle invitation (la filleule a perdu son accès) : l'ancien accès est coupé
    const { token, invite } = newInvite();
    withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], hash: null, keys: [], devInv: null, rec: undefined, recAt: undefined, invite }; writeOrgas(l); } });
    orgaLog(orga, 'nouvelle invitation (parrainage)', { ref: target.id, detail: target.label });
    return send(res, 200, { id: target.id, label: target.label, invite: token, exp: invite.exp });
  }
  // --- Ajouter un appareil : lien à usage unique, 10 minutes, la clé actuelle reste valable ---
  if (req.method === 'POST' && pathname === '/api/orga/device') {
    const token = crypto.randomBytes(18).toString('base64url');
    const ok = withLock(() => {
      const l = readOrgas().slice(), i = l.findIndex(x => x.id === orga.id);
      if (i < 0) return false;
      l[i] = { ...l[i], devInv: { h: sha(token), exp: Date.now() + DEVICE_MS } }; writeOrgas(l); return true;
    });
    if (!ok) return send(res, 400, { error: 'Pas possible pour un accès défini par l’admin dans les réglages du serveur.' });
    orgaLog(orga, 'lien d’appareil créé');
    return send(res, 200, { invite: token, exp: Date.now() + DEVICE_MS });
  }

  return NEXT;
}

module.exports = { orgaAccesRoutes, accessState };
