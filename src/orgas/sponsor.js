'use strict';

const crypto = require('crypto');
const { sha } = require('../util');
const { q, getMeta } = require('../db');
const { INVITE_MS } = require('./store');

// ---- Parrainage ----
const SPONSOR = { quota: 3, quotaMs: 7 * 24 * 60 * 60_000, banMs: 30 * 24 * 60 * 60_000, readyDays: 7, readyActions: 10, removeMax: 5, annPerDay: 3 };
const DEVICE_MS = 10 * 60_000, DEVICE_MAX = 5;
const banUntil = id => { const v = Number(getMeta('ban:' + id) || 0); return v > Date.now() ? v : 0; };
// Une parrainée est « prête à être confirmée » : assez ancienne, assez active, et rien de suspect dans son journal
function orgaReady(o) {
  const since = o.activated || o.created, days = Math.floor((Date.now() - since) / (24 * 60 * 60_000));
  const rows = q('SELECT action, COUNT(*) n FROM orga_log WHERE oid=? GROUP BY action').all(o.id);
  const actions = rows.filter(x => !/invitation|appareil/.test(x.action)).reduce((s, x) => s + x.n, 0);
  const bursts = rows.filter(x => x.action === 'retrait bloqué (rafale)').reduce((s, x) => s + x.n, 0);
  const restored = q("SELECT COUNT(*) n FROM orga_log WHERE action='restauré' AND detail=?").get('retiré par ' + o.label).n;
  return { ready: !!o.hash && days >= SPONSOR.readyDays && actions >= SPONSOR.readyActions && !bursts && !restored, days, actions, bursts, restored };
}
// Toutes les orgas entrées grâce à celle-ci (filleules, filleules des filleules…)
function descendants(list, id) {
  const out = [], todo = [id];
  while (todo.length) { const cur = todo.pop(); for (const o of list) if (o.by === cur && !out.includes(o.id)) { out.push(o.id); todo.push(o.id); } }
  return out;
}
const newInvite = () => { const token = crypto.randomBytes(18).toString('base64url'); return { token, invite: { h: sha(token), exp: Date.now() + INVITE_MS } }; };

module.exports = { SPONSOR, DEVICE_MS, DEVICE_MAX, banUntil, orgaReady, descendants, newInvite };
