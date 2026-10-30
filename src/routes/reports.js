'use strict';
// Routes des participant·es : digest, envoi d'un signalement, proposition d'arrêté ou d'événement, précision, vote.
const fs = require('fs');
const crypto = require('crypto');
const { ADMIN_KEY, NOTE_MAX, MIN, RATE, MAX_PER_NET_ZONE, MAX_PER_ZONE, MAX_REPORTS } = require('../config');
const { CATEGORIES, GROUPS, CAT, isDanger, CALM_KILL_M, MERGE, ALERT_CATS } = require('../categories');
const { NEXT } = require('./next');
const { abuseOnce, abuseLog, calmSeries, SERIES, snapshotContested } = require('../moderation');
const { cellId } = require('../live/files');
const { clientHash, deviceHash } = require('../privacy');
const { commIndex } = require('../geo/communes');
const { createEvent } = require('../events/create');
const { createOrder } = require('../orders');
const { dayRows, dayCountFr } = require('../digest/day');
const { deviceAge, firstConfirm, repAdd, devRep, TRUST, CONTEST, contestNeed, VOTES } = require('../reports/votes');
const { getPub } = require('../digest/pub');
const { isAdmin, orgaOf } = require('../orgas/auth');
const { listEvents } = require('../events/store');
const { nearby, saveReport, dropReport, getReport } = require('../reports/store');
const { orgaLog } = require('../orgas/log');
const { parisDay, ARCHIVE_DIR } = require('../digest/archive');
const { pausedUntil } = require('../settings');
const { pushNearLater } = require('../push');
const { q, tx } = require('../db');
const { round } = require('../util');
const { send, readJson } = require('../http/respond');
const { strictUntil, allow, bump } = require('../limits');
const { sweep } = require('../sweep');
const { toReport, addTrail, addNote, publicView } = require('../reports/model');

async function reportsRoutes(req, res, url, pathname) {
  if (req.method === 'GET' && pathname === '/api/digest') {
    if (!ADMIN_KEY) return send(res, 404, { error: 'Digest désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
    if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    const date = String(url.searchParams.get('date') || parisDay(Date.now()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Date invalide.' });
    sweep(); // archive ce qui vient d'expirer
    const { rows, zones, abroad } = dayRows(date);
    // Activité des orgas et anti-abus ce jour-là
    const day0 = Date.parse(date + 'T00:00:00+02:00'), lo = day0 - 2 * 3600e3, hi = day0 + 26 * 3600e3;
    const logs = q('SELECT t, oid, action, detail FROM orga_log WHERE t BETWEEN ? AND ?').all(lo, hi).filter(x => parisDay(x.t) === date);
    const cnt = f => logs.filter(f).length;
    const orga = { verified: cnt(x => /^vérifié|^confirmé \(parrainée\)/.test(x.action)), removed: cnt(x => x.oid !== 'admin' && /^retiré|^retrait \(essai\)/.test(x.action)), adminRemoved: cnt(x => x.oid === 'admin' && x.action === 'retiré'),
      announcements: cnt(x => x.action === 'annonce'), urgent: cnt(x => x.action === 'annonce' && /\[urgent\]/.test(x.detail || '')),
      legal: cnt(x => /^legal team/.test(x.action)), restored: cnt(x => x.action === 'restauré'), contested: cnt(x => x.action === 'contesté') };
    const abuse = {};
    for (const x of q('SELECT t, kind FROM abuse WHERE t BETWEEN ? AND ?').all(lo, hi)) if (parisDay(x.t) === date) abuse[x.kind] = (abuse[x.kind] || 0) + 1;
    // Comparaison : les 14 jours précédents
    const history = [];
    for (let i = 14; i >= 0; i--) { const d = parisDay(Date.parse(date + 'T12:00:00+02:00') - i * 86400e3); history.push({ date: d, total: i ? dayCountFr(d) : rows.length }); }
    const events = listEvents().filter(e => parisDay(e.start) === date && e.status !== 'pending').map(e => ({ title: e.title, type: e.type, place: e.place, start: e.start }));
    return send(res, 200, { date, rows, zones, abroad, communes: commIndex().rows.length > 0, orga, abuse, history, events, published: !!getPub(date),
      categories: CATEGORIES.map(({ id, label, glyph, group, ttl }) => ({ id, label, glyph, group, ttl })), groups: GROUPS,
      days: fs.readdirSync(ARCHIVE_DIR).map(f => f.slice(0, 10)).sort().reverse() });
  }
  
  if (req.method === 'POST' && pathname === '/api/reports') {
    const b = await readJson(req);
    const cat = Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!cat) return send(res, 400, { error: 'Catégorie inconnue.' });
    if (cat.off) return send(res, 400, { error: 'Ce type de signalement est désactivé pour l’instant.' });
    if (cat.beaconOnly) return send(res, 400, { error: 'Type inconnu.' });
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
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
        // Preuve plus fraîche que les « Plus là » : on les efface
        if (t0 >= (r.last || r.t)) { r.down = 0; r.downIps = []; r.dw = 0; r.ct = 0; }
        // Point qui suit (forces mobiles, tête, queue) : il se déplace, sauf s'il est partagé en direct par une orga (sa position fait foi)
        if (m.move && !r.bk && t0 >= (r.last || r.t) && (r.lat !== pos.lat || r.lng !== pos.lng)) { addTrail(r, now); r.lat = pos.lat; r.lng = pos.lng; }
        if (note) addNote(r, note, dev, t0);
        r.last = Math.max(r.last || r.t, t0);
        r.exp = Math.max(r.exp, t0 + ttl);
        if (sure) {
          r.exp = Math.min(r.exp, Math.max(r.t + 4 * base, t0 + ttl));
          if (!r.ver) { repAdd(r.voters[0], 'good', 2); r.ver = orga.label; orgaLog(orga, 'vérifié (signalement)', { r }); }
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
        t: t0, last: t0, exp: t0 + ttl, up: 0, down: 0, voters: [dev], downIps: [], ip: ipH };
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
  if (req.method === 'POST' && pathname === '/api/orders') return send(res, ...await createOrder(await readJson(req, 8192), { dev: deviceHash(req), ipH: clientHash(req) }));
  
  if (req.method === 'POST' && pathname === '/api/events') {
    const b = await readJson(req, 16384);
    const orga = req.headers['x-orga-key'] ? orgaOf(req) : null;
    if (req.headers['x-orga-key'] && !orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });
    const out = createEvent(b, orga, deviceHash(req), clientHash(req));
    if (orga && out[0] < 300) orgaLog(orga, out[1].status === 'pending' ? 'événement (en attente)' : 'événement', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id, detail: out[1].title });
    return send(res, ...out);
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
  
  const vote = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/vote$/);
  if (req.method === 'POST' && vote) {
    const b = await readJson(req);
    const ipH = clientHash(req), dev = deviceHash(req);
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
        r.exp = Math.min(Math.max(r.exp, now + ttl), r.t + 4 * ttl); // prolonge, plafonné à 4× la durée de base
        if (r.ct && (r.dw || 0) < contestNeed(r)) r.ct = 0; // confirmé : plus contesté
      } else {
        // Un téléphone ou un réseau qui conteste beaucoup de points d'affilée n'est plus compté. On ne le lui dit pas.
        const k = strict ? 2 / 3 : 1;
        const devOk = bump('dn:' + dev, 'vote', Math.ceil(CONTEST.devBurst * k), now), netOk = bump('dnn:' + ipH, 'vote', Math.ceil(CONTEST.netBurst * k), now);
        if (!devOk || !netOk) { abuseOnce('« Plus là » en rafale', dev, RATE.windowMs, { lat: r.lat, lng: r.lng }); saveReport(r); return [200, { ...publicView(r), down: r.down + 1 }]; }
        const before = { ...r, voters: r.voters.slice(0, -1) };
        r.down++;
        const aged = age >= CONTEST.newDev;
        // Poids : sur place ×2, identifiant pas tout neuf ×2, téléphone fiable +2 ; en mode renforcé un identifiant neuf ne compte pas
        let w = (b.here === true ? CONTEST.near : 1) * (aged ? CONTEST.aged : 1) + (trusted ? 2 : 0);
        if (strict && !aged && !trusted) w = 0;
        r.dw = (r.dw || 0) + w;
        (r.downIps ||= []).push(ipH);
        // Un signalement vérifié par une orga ne peut pas être contesté par les votes.
        const nets = new Set(r.downIps).size, need = contestNeed(r);
        if (!r.ver && r.dw >= need && nets >= 2) {
          if (!r.ct) { r.ct = now; snapshotContested(before, now); orgaLog(VOTES, 'contesté', { r, detail: nets + ' réseaux' }); repAdd(r.voters[0], 'bad'); abuseLog('point contesté', { lat: r.lat, lng: r.lng, ref: r.id }); }
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

module.exports = { reportsRoutes };
