'use strict';
// Un signalement : lecture depuis la base, traces de la tête et de la queue, balises en direct, précisions, vue publique.
const { MIN } = require('../config');
const { distM } = require('../util');
const { DIR_CATS, COUNT_CATS } = require('../categories');
// Direction : publiée 5 minutes après avoir été indiquée (ou déduite), puis plus montrée
const DIR_MS = 5 * MIN;
const dirView = r => DIR_CATS.has(r.cat) && r.dir != null && r.dirt > Date.now() - DIR_MS ? { dir: r.dir, dt: Math.round(r.dirt / 1000) } : {};
// Cap entre deux positions, en degrés (0 = nord), arrondi au pas de 45
function bearing45(a, b) {
  const R = Math.PI / 180, y = Math.sin((b.lng - a.lng) * R) * Math.cos(b.lat * R),
    x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lng - a.lng) * R);
  return (Math.round(((Math.atan2(y, x) / R + 360) % 360) / 45) % 8) * 45;
}

const parseNotes = r => { let n = []; try { n = JSON.parse(r.notes || '[]'); } catch {} return n.length || !r.note ? n : [{ x: r.note, t: r.t }]; };
const parseTrail = r => { if (Array.isArray(r.trail)) return r.trail; try { return JSON.parse(r.trail || '[]'); } catch { return []; } };
const toReport = r => r && ({ id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note, notes: parseNotes(r), t: r.t, exp: r.exp, up: r.up, down: r.down,
  dw: r.dw || 0, ct: r.ct || 0, fl: r.fl || 0, ver: r.ver || null, voters: JSON.parse(r.voters || '[]'), downIps: JSON.parse(r.down_ips || '[]'), last: r.last || r.t, cell: r.cell, oid: r.owner || null,
  trail: parseTrail(r), bk: r.bk || 0, bkla: r.bkla ?? null, bklo: r.bklo ?? null, author: r.author ?? null, dir: r.dir ?? null, dirt: r.dirt ?? null, cnt: r.cnt ?? null });
// Auteur d'un signalement. '' = l'auteur a retiré sa voix : plus personne n'est auteur.
// Les points créés avant la colonne author (quelques heures au plus) gardent l'ancien repère, le premier votant.
const authorOf = r => (r.author != null ? r.author : (r.voters || [])[0]) || null;
// Trace d'un point qui suit le cortège : on garde l'ancienne position (si elle a bougé d'au moins 20 m), 30 min et 30 points au plus
// Tête : 60 min de trace (le tracé du cortège suit le chemin réel de la tête jusqu'à la queue) ; queue : 30 min
const TRAIL_CATS = new Set(['cortege', 'queue']), TRAIL_MS = { cortege: 60 * MIN, queue: 30 * MIN }, TRAIL_MAX = { cortege: 60, queue: 30 };
const BEACON_ROLES = new Set(['cortege', 'queue', 'medic', 'legal', 'presse', 'contact']), BEACON_TTL = 3 * MIN, BEACON_MAX = 4 * 60 * MIN, BEACON_ZONE_M = 2000;

function addTrail(r, now) {
  if (!TRAIL_CATS.has(r.cat)) return;
  const tr = (r.trail || []).filter(p => p[2] > now - TRAIL_MS[r.cat]), lastP = tr[tr.length - 1];
  if (!lastP || distM({ lat: lastP[0], lng: lastP[1] }, r) >= 20) tr.push([r.lat, r.lng, r.last || r.t]);
  r.trail = tr.slice(-TRAIL_MAX[r.cat]);
}

const NOTES_KEEP = 3;
// Ajoute (ou remplace) la précision d'un téléphone sur un point ; les plus récentes d'abord
function addNote(r, text, dev, t) {
  const notes = (r.notes || []).filter(n => n.d !== dev && n.x.toLowerCase() !== text.toLowerCase());
  r.notes = [{ x: text, t, d: dev }, ...notes].slice(0, NOTES_KEEP);
}
// tr : trace de la tête ou de la queue (positions arrondies à ~11 m, heures en secondes) ; live : position partagée en direct par une orga
const trailView = r => { if (!TRAIL_CATS.has(r.cat)) return {}; const tr = parseTrail(r); return tr.length ? { tr: tr.map(p => [p[0], p[1], Math.round(p[2] / 1000)]) } : {}; };
const publicView = r => ({ ...trailView(r), ...dirView(r), ...(r.cnt && COUNT_CATS.has(r.cat) ? { n: r.cnt } : {}), ...(r.bk ? { live: 1 } : {}), id: r.id, cat: r.cat, lat: r.lat, lng: r.lng, note: r.note,
  notes: (Array.isArray(r.notes) ? r.notes : parseNotes(r)).map(n => ({ x: n.x, t: n.t })), t: r.t, last: r.last || r.t, exp: r.exp, up: r.up, down: r.down, ver: r.ver || null, ...(r.ct ? { c: 1 } : {}), ...(r.fl === 1 ? { f: 1 } : r.fl === -1 && !r.up ? { nf: 1 } : {}) });

module.exports = { authorOf, parseNotes, parseTrail, toReport, TRAIL_CATS, TRAIL_MS, TRAIL_MAX, BEACON_ROLES, BEACON_TTL, BEACON_MAX, BEACON_ZONE_M, addTrail, NOTES_KEEP, addNote, trailView, publicView, DIR_MS, bearing45 };
