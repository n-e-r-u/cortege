'use strict';
// Ce qu'un·e participant·e fait sur un signalement existant : direction ou nombre, précision, retrait ou déplacement du
// sien, vote (« Toujours là », « Plus là »).
// Appelées par routes/reports.js.
const crypto = require('crypto');
const { NOTE_MAX, MIN, RATE } = require('../config');
const { CAT, DIR_CATS, COUNT_CATS } = require('../categories');
const { NEXT } = require('./next');
const { abuseOnce, abuseLog, snapshotContested } = require('../moderation');
const { clientHash, deviceHash, netHash } = require('../privacy');
const { deviceAge, firstConfirm, repAdd, devRep, TRUST, CONTEST, contestNeed, VOTES } = require('../reports/votes');
const { saveReport, discardReport, getReport } = require('../reports/store');
const { orgaLog } = require('../orgas/log');
const { q, tx } = require('../db');
const { round, validLatLng, distM } = require('../util');
const { send, readJson } = require('../http/respond');
const { strictUntil, allow, bump, quota } = require('../limits');
const { addNote, publicView, authorOf } = require('../reports/model');

// Empreinte courte (entier) du téléphone qui a posé une direction ou un nombre, gardée 30 s avec le verrou
const setBy = dev => crypto.createHash('sha256').update(dev).digest().readUInt32BE(0);
async function reportsActionsRoutes(req, res, url, pathname) {
  // Direction d'un véhicule (pompiers, police, blindé…) : 0 à 7 (nord, nord-est… nord-ouest), ou null pour l'effacer.
  // Nombre d'un groupe (fascistes, forces de l'ordre) : 1 à 4 (environ 1-5, 5-15, 15-30, plus de 30), ou null.
  // N'importe quel téléphone peut les indiquer ou les corriger ; la direction s'affiche 5 minutes, le nombre tant que le point vit.
  const setRoute = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(dir|count)$/);
  if (req.method === 'POST' && setRoute) {
    const isDir = setRoute[2] === 'dir', b = await readJson(req), raw = isDir ? b.d : b.c, v = raw === null ? null : Number(raw);
    if (v !== null && !(Number.isInteger(v) && (isDir ? v >= 0 && v <= 7 : v >= 1 && v <= 4))) return send(res, 400, { error: isDir ? 'Direction invalide.' : 'Nombre invalide.' });
    const ipH = clientHash(req), dev = deviceHash(req);
    const result = tx(() => {
      const now = Date.now(), r = getReport(setRoute[1], now);
      if (!r) return [404, { error: 'Signalement expiré.' }];
      if (!(isDir ? DIR_CATS : COUNT_CATS).has(r.cat)) return [400, { error: isDir ? 'Pas de direction pour ce type.' : 'Pas de nombre pour ce type.' }];
      if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop d’envois, patiente un peu.' }];
      // Un même téléphone : 2 saisies par point en 10 minutes (une erreur se corrige, pas plus). Entre deux téléphones : la valeur
      // posée par un autre tient 30 s avant de pouvoir être changée, pour qu'un seul appareil ne la fasse pas clignoter.
      const kind = isDir ? 'dir' : 'cnt', cur = isDir ? (r.dir == null ? null : r.dir / 45) : (r.cnt ?? null);
      if (cur === v) return [200, publicView(r)];
      const lock = q('SELECT t, n FROM quota WHERE k=?').get(`${kind}l:${r.id}`);
      if (lock && now - lock.t < 30_000 && lock.n !== setBy(dev)) return [429, { error: 'Quelqu’un vient de l’indiquer : réessaie dans un instant si ce n’est plus exact.' }];
      if (!quota(`${kind}:${r.id}:${dev}`, 2, 10 * MIN, now)) return [429, { error: 'Tu l’as déjà indiqué pour ce point.' }];
      q('INSERT OR REPLACE INTO quota(k,t,n) VALUES(?,?,?)').run(`${kind}l:${r.id}`, now, setBy(dev));
      if (isDir) { if (v === null) { r.dir = null; r.dirt = null; } else { r.dir = v * 45; r.dirt = now; } }
      else r.cnt = v;
      saveReport(r);
      return [200, publicView(r)];
    });
    return send(res, ...result);
  }

  // Ajouter une précision à un point existant (une par téléphone, la sienne peut être corrigée)
  const noteRoute = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/note$/);
  if (req.method === 'POST' && noteRoute) {
    const b = await readJson(req);
    const text = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    if (text.length < 2) return send(res, 400, { error: 'Écris une précision.' });
    const ipH = clientHash(req), dev = deviceHash(req);
    const result = tx(() => {
      const now = Date.now(), r = getReport(noteRoute[1], now);
      if (!r) return [404, { error: 'Signalement expiré.' }];
      if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop d’envois, patiente un peu.' }];
      addNote(r, text, dev, now);
      saveReport(r);
      return [200, publicView(r)];
    });
    return send(res, ...result);
  }
  
  // Son propre signalement (le téléphone qui l'a envoyé, reconnu à son empreinte du jour) :
  // - retirer un point posé par erreur, tant que personne d'autre ne l'a confirmé (supprimé sans trace dans les bilans) ;
  //   s'il a été confirmé, l'auteur retire seulement sa voix : le point reste pour les autres ;
  // - le déplacer s'il est mal placé : dans les 10 premières minutes, de 150 m au plus, tant que personne ne l'a confirmé.
  const own = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/self$/);
  if (req.method === 'POST' && own) {
    const b = await readJson(req);
    const dev = deviceHash(req);
    const result = tx(() => {
      const now = Date.now();
      const r = getReport(own[1], now);
      if (!r) return [404, { error: 'Signalement expiré.' }];
      if (authorOf(r) !== dev) return [403, { error: 'Seul le téléphone qui l’a envoyé peut le retirer ou le déplacer, et seulement le jour même.' }];
      if (!quota('self:' + dev, 20, 10 * MIN, now)) return [429, { error: 'Trop d’essais, patiente un peu.' }];
      if (b.action === 'remove') {
        if (!r.up && !r.ver) { discardReport(r.id); return [200, { removed: true }]; }
        if (!r.up) return [409, { error: 'Vérifié par une orga : le point reste sur la carte.' }];
        // L'auteur retire sa voix : plus personne n'est auteur (personne d'autre ne peut retirer ou déplacer le point).
        // Son envoi n'a jamais compté dans « up » : les confirmations des autres restent. Il reste dans voters (pas de second vote).
        r.author = '';
        r.notes = (r.notes || []).filter(n => n.d !== dev);
        saveReport(r);
        return [200, { ...publicView(r), withdrawn: true }];
      }
      if (b.action === 'move') {
        if (r.up || r.ver || r.bk) return [409, { error: 'D’autres l’ont déjà confirmé : il ne peut plus être déplacé.' }];
        if (now - r.t > 10 * MIN) return [409, { error: 'Trop tard : un point ne se déplace que dans les 10 minutes.' }];
        const lat = Number(b.lat), lng = Number(b.lng);
        if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
        if (distM({ lat, lng }, r) > 150) return [400, { error: 'Trop loin : 150 m au plus. Retire-le et signale-le au bon endroit.' }];
        r.lat = round(lat); r.lng = round(lng);
        saveReport(r);
        return [200, publicView(r)];
      }
      return [400, { error: 'Action inconnue.' }];
    });
    return send(res, ...result);
  }
  const vote = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/vote$/);
  if (req.method === 'POST' && vote) {
    const b = await readJson(req);
    // netH : réseau pour la contestation (tout Tor = un seul réseau : la règle « 2 réseaux » ne se contourne pas en changeant d'identifiant)
    const ipH = clientHash(req), netH = netHash(req), dev = deviceHash(req);
    const result = tx(() => {
      const now = Date.now();
      const r = getReport(vote[1], now);
      if (!r) return [404, { error: 'Signalement expiré.' }];
      if (r.voters.includes(dev)) return [409, { error: 'Déjà pris en compte.' }];
      if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop de votes, patiente un peu.' }];
      const age = deviceAge(dev, now), strict = strictUntil(now) > 0, trusted = devRep(dev) >= TRUST;
      r.voters.push(dev);
      if (b.v === 1) {
        r.up++; r.last = now; firstConfirm(r);
        const ttl = CAT[r.cat].ttl * MIN;
        // Prolonge, plafonné à 4× la durée de base. Jamais une position d'orga en direct : seule l'orga la fait vivre.
        if (!r.bk) r.exp = Math.min(Math.max(r.exp, now + ttl), r.t + 4 * ttl);
        if (r.ct && (r.dw || 0) < contestNeed(r)) r.ct = 0; // confirmé : plus contesté
      } else {
        // Un téléphone ou un réseau qui conteste beaucoup de points d'affilée n'est plus compté. On ne le lui dit pas.
        const k = strict ? 2 / 3 : 1;
        const devOk = bump('dn:' + dev, 'vote', Math.ceil(CONTEST.devBurst * k), now), netOk = bump('dnn:' + netH, 'vote', Math.ceil(CONTEST.netBurst * k), now);
        if (!devOk || !netOk) { abuseOnce('« Plus là » en rafale', dev, RATE.windowMs, { lat: r.lat, lng: r.lng }); saveReport(r); return [200, { ...publicView(r), down: r.down + 1 }]; }
        const before = { ...r, voters: r.voters.slice(0, -1) };
        r.down++;
        const aged = age >= CONTEST.newDev;
        // Poids : sur place ×2, identifiant pas tout neuf ×2, téléphone fiable +2 ; en mode renforcé un identifiant neuf ne compte pas
        let w = (b.here === true ? CONTEST.near : 1) * (aged ? CONTEST.aged : 1) + (trusted ? 2 : 0);
        if (strict && !aged && !trusted) w = 0;
        r.dw = (r.dw || 0) + w;
        (r.downIps ||= []).push(netH);
        // Un signalement vérifié par une orga ne peut pas être contesté par les votes.
        const nets = new Set(r.downIps).size, need = contestNeed(r);
        if (!r.ver && r.dw >= need && nets >= 2) {
          if (!r.ct) { r.ct = now; snapshotContested(before, now); orgaLog(VOTES, 'contesté', { r, detail: nets + ' réseaux' }); repAdd(authorOf(r), 'bad'); abuseLog('point contesté', { lat: r.lat, lng: r.lng, ref: r.id }); }
          r.exp = Math.min(r.exp, now + (r.dw >= need + CONTEST.more && nets >= 3 ? CONTEST.short : CONTEST.soft));
        }
      }
      saveReport(r);
      return [200, publicView(r)];
    });
    return send(res, ...result);
  }
  return NEXT;
}

module.exports = { reportsActionsRoutes };
