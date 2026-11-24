'use strict';
// Envoi d'un signalement par un·e participant·e (POST /api/reports) : limites, fusion avec un point proche, alertes.
// Appelée par routes/reports.js.
const crypto = require('crypto');
const { NOTE_MAX, MIN, RATE, MAX_PER_NET_ZONE, MAX_PER_ZONE, MAX_REPORTS } = require('../config');
const { CATEGORIES, CAT, isDanger, CALM_KILL_M, MERGE, ALERT_CATS, DIR_CATS } = require('../categories');
const { NEXT } = require('./next');
const { catAllowed } = require('../profiles');
const { abuseOnce, abuseLog, calmSeries, SERIES } = require('../moderation');
const { cellId } = require('../live/files');
const { clientHash, deviceHash } = require('../privacy');
const { deviceAge, firstConfirm, repAdd, devRep, TRUST, CONTEST, contestNeed } = require('../reports/votes');
const { orgaOf } = require('../orgas/auth');
const { nearby, saveReport, dropReport } = require('../reports/store');
const { orgaLog } = require('../orgas/log');
const { pausedUntil } = require('../settings');
const { pushNearLater } = require('../push');
const { q, tx } = require('../db');
const { round, distM } = require('../util');
const { send, readJson } = require('../http/respond');
const { strictUntil, allow } = require('../limits');
const { toReport, addTrail, addNote, publicView, authorOf, bearing45 } = require('../reports/model');

async function reportsCreateRoutes(req, res, url, pathname) {
  if (req.method === 'POST' && pathname === '/api/reports') {
    const b = await readJson(req);
    const cat = Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!cat) return send(res, 400, { error: 'Catégorie inconnue.' });
    if (cat.off) return send(res, 400, { error: 'Ce type de signalement est désactivé pour l’instant.' });
    if (cat.beaconOnly) return send(res, 400, { error: 'Type inconnu.' });
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
    if (!catAllowed(cat.id, lat, lng)) return send(res, 400, { error: 'Ce type de signalement n’existe pas ici.' });
    const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX);
    const ipH = clientHash(req), dev = deviceHash(req);
    // Orga confirmée (ni en essai, ni parrainée en attente) : son signalement est vérifié d'office et dure deux fois plus longtemps
    const orga = req.headers['x-orga-key'] ? orgaOf(req) : null, sure = !!(orga && !orga.trial && !orga.sponsored);
    const result = tx(() => {
      const base = cat.ttl * MIN, now = Date.now(), ttl = sure ? 2 * base : base;
      const strict = strictUntil(now) > 0;
      // Heure où le signalement a été fait (file d'attente hors ligne). Jamais dans le futur ;
      // mentir dessus ne peut que raccourcir la vie du point.
      const t0 = Math.min(now, Number(b.t) || now);
      if (t0 + ttl <= now) return [410, { error: 'Signalement trop ancien, il n’a pas été publié.', stale: true }];
      if (pausedUntil(now)) return [503, { error: 'Les signalements sont en pause quelques minutes (afflux de faux signalements). Réessaie bientôt.' }];
      if (!allow(dev, ipH, 'report', now)) { abuseOnce('signalements en rafale', dev, RATE.windowMs, { lat, lng }); return [429, { error: 'Trop de signalements d’un coup. Réessaie dans quelques minutes.' }]; }
      // Après la limite d'envois : un identifiant inventé à chaque requête refusée ne remplit pas la table
      const age = deviceAge(dev, now);
      const pos = { lat: round(lat), lng: round(lng) };
      // Un danger n'efface plus une zone calme voisine : le téléphone l'affiche « suspendue » tant que le danger est actif
      // (un faux danger ne peut donc plus faire disparaître une zone calme).
  
      if (cat.id === 'calme' && CATEGORIES.some(c => isDanger(c.id) && nearby(c.id, pos.lat, pos.lng, CALM_KILL_M, now).some(x => !x.r.ct)))
        return [409, { error: 'Un danger est signalé à moins de 100 m : la zone ne peut pas être marquée calme.' }];
      // Même type tout près : on confirme le point existant au lieu d'en créer un deuxième
      const m = MERGE[cat.id] || { r: 50 };
      const hit = nearby(cat.id, pos.lat, pos.lng, m.r, now)[0];
      if (hit) {
        const r = toReport(hit.r), self = r.voters.includes(dev);
        if (!self) { r.voters.push(dev); r.up++; firstConfirm(r); }
        // Preuve plus fraîche que les « Plus là », venue d'un autre téléphone : comme pour un vote « Toujours là »,
        // un point contesté ne redevient normal que si la contestation est faible. L'auteur qui renvoie son point n'efface rien.
        if (!self && t0 >= (r.last || r.t)) {
          if (!r.ct) { r.down = 0; r.downIps = []; r.dw = 0; }
          else if ((r.dw || 0) < contestNeed(r)) { r.ct = 0; r.down = 0; r.downIps = []; r.dw = 0; }
        }
        // Point qui suit (forces mobiles, tête, queue) : il se déplace, sauf s'il est partagé en direct par une orga (sa position fait foi)
        if (m.move && !r.bk && t0 >= (r.last || r.t) && (r.lat !== pos.lat || r.lng !== pos.lng)) {
          // Véhicule revu 40 m plus loin : sa direction est déduite du déplacement
          if (DIR_CATS.has(r.cat) && distM(r, pos) >= 40) { r.dir = bearing45(r, pos); r.dirt = now; }
          addTrail(r, now); r.lat = pos.lat; r.lng = pos.lng;
        }
        if (note) addNote(r, note, dev, t0);
        // Seul un autre téléphone prolonge le point, plafonné à 4× la durée de base (une orga confirmée peut aller jusqu'à sa propre durée).
        // Une position d'orga en direct est seulement confirmée : seule l'orga fait vivre sa durée.
        if (!self && !r.bk) {
          r.last = Math.max(r.last || r.t, t0);
          r.exp = Math.min(Math.max(r.exp, t0 + ttl), sure ? Math.max(r.t + 4 * base, t0 + ttl) : r.t + 4 * base);
        }
        if (sure) {
          if (!r.ver) { repAdd(authorOf(r), 'good', 2); r.ver = orga.label; orgaLog(orga, 'vérifié (signalement)', { r }); }
          if (r.fl === -1) r.fl = 0;
        }
        saveReport(r);
        return [200, { ...publicView(r), merged: true, self }];
      }
  
      const cell = cellId(pos.lat, pos.lng);
      if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND ip=? AND exp>?').get(cell, ipH, now).n >= (strict ? Math.ceil(MAX_PER_NET_ZONE / 2) : MAX_PER_NET_ZONE))
        return [429, { error: 'Trop de signalements depuis ton réseau dans cette zone. Confirme plutôt ceux qui existent.' }];
      if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND exp>?').get(cell, now).n >= MAX_PER_ZONE) {
        // Zone pleine : on fait de la place en retirant le plus ancien point que personne n'a confirmé ni vérifié
        const old = q('SELECT id FROM reports WHERE cell=? AND exp>? AND ver IS NULL AND up=0 ORDER BY t LIMIT 1').get(cell, now);
        if (!old) return [503, { error: 'Zone saturée, réessaie dans quelques minutes.' }];
        dropReport(old.id, 'full');
      }
      if (q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(now).n >= MAX_REPORTS) return [503, { error: 'Carte saturée, réessaie plus tard.' }];
      const r = { id: crypto.randomBytes(6).toString('base64url'), cat: cat.id, lat: pos.lat, lng: pos.lng, note, notes: note ? [{ x: note, t: t0, d: dev }] : [],
        t: t0, last: t0, exp: t0 + ttl, up: 0, down: 0, voters: [dev], author: dev, downIps: [], ip: ipH };
      // Fiabilité : téléphone fiable aujourd'hui, ou au contraire série suspecte près des zones calmes / téléphone neuf en mode renforcé
      const trusted = devRep(dev) >= TRUST;
      if (isDanger(cat.id)) {
        const calms = nearby('calme', pos.lat, pos.lng, CALM_KILL_M, now).filter(x => !x.r.ct);
        for (const x of calms) abuseLog('danger près zone calme', { lat: pos.lat, lng: pos.lng, dev, net: ipH, ref: x.r.id });
        if (calms.length && !trusted && calmSeries(dev, ipH, now)) { r.fl = -1; abuseOnce('série de dangers près des zones calmes', dev, SERIES.win, { lat: pos.lat, lng: pos.lng }); }
      }
      if (!r.fl && strict && !trusted && age < CONTEST.newDev) r.fl = -1;
      if (!r.fl && trusted) r.fl = 1;
      if (sure) { r.ver = orga.label; r.fl = 1; r.oid = orga.id; r.notes.forEach(n => { n.d = 'o:' + orga.id; }); }
      saveReport(r);
      if (sure) orgaLog(orga, 'signalement', { r });
      // Notification « danger près de toi » : seulement pour un téléphone qui n'est pas tout neuf (ou fiable), jamais pour un signalement non fiable
      if (ALERT_CATS.has(cat.id) && r.fl !== -1 && (age >= CONTEST.newDev || trusted || sure)) pushNearLater(r);
      if (sure) return [201, { ...publicView(r), mine: true }];
      return [201, publicView(r)];
    });
    return send(res, ...result);
  }
  
  // Agenda : une orga publie directement, un·e participant·e propose (validé ensuite par l'admin)
  // Proposer un arrêté ou une restriction (validé par l'admin avant d'apparaître)
  return NEXT;
}

module.exports = { reportsCreateRoutes };
