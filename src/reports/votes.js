'use strict';

const { MIN } = require('../config');
const { q } = require('../db');

// ---- « Plus là » : un point n'est jamais effacé par des votes, il devient « contesté » ----
// Contesté = grisé, et il ne lui reste que quelques minutes ; une confirmation le remet en état normal.
// Poids d'un « Plus là » : ×2 si le téléphone dit être sur place (calcul fait sur le téléphone, la position
// ne part jamais), ×2 si l'identifiant n'est pas tout neuf. Il en faut davantage pour chaque confirmation.
const CONTEST = { near: 2, aged: 2, need: 8, perUp: 4, more: 8, soft: 10 * MIN, short: 2 * MIN, newDev: 10 * MIN,
  devKeep: 26 * 60 * MIN, devBurst: 6, netBurst: 60 };
const VOTES = { id: 'votes', label: 'Votes « Plus là »' };
// Âge de l'identifiant du téléphone (0 si inconnu ou sans identifiant), et note qu'il vient d'agir
function deviceAge(dev, now) {
  if (!dev.startsWith('d:')) return 0;
  const row = q('SELECT first FROM devices WHERE h=?').get(dev);
  q('INSERT INTO devices(h,first,seen) VALUES(?,?,?) ON CONFLICT(h) DO UPDATE SET seen=excluded.seen').run(dev, now, now);
  return row ? now - row.first : 0;
}
// Un signalement d'un téléphone fiable demande une personne de plus pour être contesté
const contestNeed = r => CONTEST.need + CONTEST.perUp * (r.up || 0) + (r.fl === 1 ? CONTEST.perUp : 0);
// ---- Fiabilité du jour ----
const TRUST = 2; // fiable : (confirmés par d'autres) − 2 × (contestés) ≥ 2
function devRep(dev) { const x = dev.startsWith('d:') && q('SELECT good, bad FROM devices WHERE h=?').get(dev); return x ? (x.good || 0) - 2 * (x.bad || 0) : 0; }
function repAdd(dev, field, n = 1) {
  if (!dev || !dev.startsWith('d:') || (field !== 'good' && field !== 'bad')) return;
  q(`UPDATE devices SET ${field}=COALESCE(${field},0)+? WHERE h=?`).run(n, dev);
}
// Première confirmation par quelqu'un d'autre : l'auteur gagne en fiabilité, le point n'est plus « non fiable »
function firstConfirm(r) { if (r.up === 1) { repAdd(r.voters[0], 'good'); if (r.fl === -1) r.fl = 0; } }

module.exports = { CONTEST, VOTES, deviceAge, contestNeed, TRUST, devRep, repAdd, firstConfirm };
