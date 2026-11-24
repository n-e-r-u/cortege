'use strict';
// Routes de l'admin pour les orgas : accès, invitations (une ou en série), révocation, demandes d'accès, essai, suppression.
// Appelées par routes/admin.js, après la vérification de la clé admin.
const crypto = require('crypto');
const { ORGAS, MIN } = require('../config');
const { NEXT } = require('./next');
const { adminLabel } = require('../settings');
const { banUntil, orgaReady, descendants, SPONSOR } = require('../orgas/sponsor');
const { labelClash } = require('../orgas/names');
const { orgaRequests } = require('../orgas/requests');
const { orgaStats, orgaLog } = require('../orgas/log');
const { readOrgas, INVITE_MS, writeOrgas } = require('../orgas/store');
const { send, readJson } = require('../http/respond');
const { setMeta, q } = require('../db');
const { withLock, sha } = require('../util');
const R = require('../refuges');

async function adminOrgasRoutes(req, res, url, pathname) {
  if (req.method === 'GET' && pathname === '/api/admin/orgas') {
    return send(res, 200, {
      orgas: (() => { const list = readOrgas(); return list.map(o => ({ id: o.id, label: o.label, created: o.created, trial: o.trial === true, source: 'page',
        active: !!o.hash, invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, devices: o.hash ? 1 + (o.keys || []).length : 0, rec: !!o.rec,
        by: o.by || null, byLabel: o.by ? (list.find(x => x.id === o.by)?.label || o.byLabel || 'orga supprimée') : null, sponsored: o.sponsored === true,
        children: list.filter(x => x.by === o.id).length, ban: banUntil(o.id), clash: !!labelClash(o.label, { except: o.id }), ...(o.sponsored && o.trial ? { readiness: orgaReady(o) } : {}), ...orgaStats(o.id) })); })()
        .concat(ORGAS.map(o => ({ id: null, label: o.label, created: null, trial: false, source: 'variable', ...orgaStats('env:' + o.label) }))),
    });
  }
  if (req.method === 'POST' && pathname === '/api/admin/orgas') {
    const b = await readJson(req);
    const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga (il sera affiché sur ses annonces).' });
    // Invitation à usage unique (24 h) : la clé n'est créée que sur le téléphone de l'orga, au moment où elle scanne le QR code.
    const token = crypto.randomBytes(18).toString('base64url');
    const out = withLock(() => {
      const list = readOrgas().slice();
      if (labelClash(label)) return null;
      const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, invite: { h: sha(token), exp: Date.now() + INVITE_MS } };
      list.push(o); writeOrgas(list); return o;
    });
    if (!out) return send(res, 409, { error: labelClash(label) || 'Une orga porte déjà ce nom.' });
    orgaLog({ id: 'admin', label: adminLabel() }, 'invitation', { ref: out.id, detail: out.label });
    return send(res, 201, { id: out.id, label: out.label, created: out.created, invite: token, exp: out.invite.exp });
  }
  // Invitations en série (démarchage des collectifs, syndicats, legal teams) : une invitation par nom, valable plus longtemps
  // (le temps que le message arrive à la bonne personne). Chaque orga reste en essai jusqu'à ce que l'admin la certifie.
  if (req.method === 'POST' && pathname === '/api/admin/orgas/bulk') {
    const b = await readJson(req, 65536);
    const days = Math.min(Math.max(Math.round(Number(b.days) || 30), 1), 60);
    const names = (Array.isArray(b.labels) ? b.labels : []).map(x => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60)).filter(x => x.length >= 2);
    if (!names.length) return send(res, 400, { error: 'Mets un nom d’orga par ligne.' });
    if (names.length > 100) return send(res, 400, { error: '100 invitations au plus d’un coup.' });
    const out = [], skipped = [];
    withLock(() => {
      const list = readOrgas().slice(), seen = new Set();
      for (const label of names) {
        const key = label.toLowerCase();
        const clash = seen.has(key) ? 'en double dans la liste' : labelClash(label);
        if (clash) { skipped.push({ label, error: clash === true ? 'Une orga porte déjà ce nom.' : clash }); continue; }
        seen.add(key);
        const token = crypto.randomBytes(18).toString('base64url');
        const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, invite: { h: sha(token), exp: Date.now() + days * 24 * 60 * MIN } };
        list.push(o); out.push({ id: o.id, label, invite: token, exp: o.invite.exp });
      }
      writeOrgas(list);
    });
    if (out.length) orgaLog({ id: 'admin', label: adminLabel() }, `invitations en série (${out.length})`, { detail: out.map(o => o.label).join(', ').slice(0, 400) });
    return send(res, 201, { created: out, skipped, days });
  }
  // Révocation pour abus : l'orga et toutes celles qu'elle a fait entrer ; sa marraine perd le droit d'inviter 30 jours
  const revoke = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/revoke$/);
  if (req.method === 'POST' && revoke) {
    const out = withLock(() => {
      const list = readOrgas(), root = list.find(x => x.id === revoke[1]);
      if (!root) return null;
      const ids = [root.id, ...descendants(list, root.id)];
      writeOrgas(list.filter(x => !ids.includes(x.id)));
      return { root, removed: list.filter(x => ids.includes(x.id)).map(x => x.label) };
    });
    if (!out) return send(res, 404, { error: 'Orga introuvable.' });
    if (out.root.by) setMeta('ban:' + out.root.by, Date.now() + SPONSOR.banMs);
    orgaLog({ id: 'admin', label: adminLabel() }, 'révoquée pour abus', { ref: out.root.id, detail: out.removed.join(', ') + (out.root.by ? ' · marraine privée d’invitations 30 j' : '') });
    return send(res, 200, { removed: out.removed, sponsorBanned: !!out.root.by });
  }
  // Nouvelle invitation pour une orga existante : l'ancienne clé est révoquée immédiatement
  const reinv = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/invite$/);
  if (req.method === 'POST' && reinv) {
    const token = crypto.randomBytes(18).toString('base64url');
    const o = withLock(() => {
      const list = readOrgas().slice(), i = list.findIndex(x => x.id === reinv[1]);
      if (i < 0) return null;
      list[i] = { ...list[i], hash: null, keys: [], devInv: undefined, rec: undefined, recAt: undefined, invite: { h: sha(token), exp: Date.now() + INVITE_MS } }; writeOrgas(list); return list[i];
    });
    if (!o) return send(res, 404, { error: 'Orga introuvable.' });
    orgaLog({ id: 'admin', label: adminLabel() }, 'nouvelle invitation (ancienne clé révoquée)', { ref: o.id, detail: o.label });
    return send(res, 200, { id: o.id, label: o.label, invite: token, exp: o.invite.exp });
  }
  // --- Demandes d'accès orga ---
  if (req.method === 'GET' && pathname === '/api/admin/orga-requests') return send(res, 200, { list: orgaRequests() });
  const oreq = pathname.match(/^\/api\/admin\/orga-requests\/([\w-]{1,16})$/);
  if (oreq && req.method === 'DELETE') {
    const n = q('DELETE FROM orga_req WHERE id=?').run(oreq[1]).changes;
    return n ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Demande déjà traitée.' });
  }
  const promo = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/trial$/);
  if (req.method === 'POST' && promo) {
    const b = await readJson(req);
    const o = withLock(() => {
      const list = readOrgas().slice(); const i = list.findIndex(x => x.id === promo[1]);
      if (i < 0) return null; list[i] = { ...list[i], trial: !!b.trial }; writeOrgas(list); return list[i];
    });
    if (!o) return send(res, 404, { error: 'Orga introuvable.' });
    orgaLog({ id: 'admin', label: adminLabel() }, o.trial ? 'essai' : 'confirmée', { ref: o.id, detail: o.label });
    return send(res, 200, { id: o.id, trial: o.trial });
  }
  const del = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})$/);
  if (req.method === 'DELETE' && del) {
    const ok = withLock(() => {
      const list = readOrgas(); const next = list.filter(o => o.id !== del[1]);
      if (next.length === list.length) return false; writeOrgas(next); return true;
    });
    // Ses lieux de repli et son logo partent avec elle
    if (ok) R.forgetOrga(del[1]);
    return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Orga introuvable.' });
  }
  return NEXT;
}

module.exports = { adminOrgasRoutes };
