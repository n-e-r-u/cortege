'use strict';
// Routes des orgas : invitation (QR code), espace orga et legal team (vérifier, retirer, annonces, événements, position en direct).
const crypto = require('crypto');
const { BEACON_ROLES, toReport, BEACON_MAX, BEACON_ZONE_M, publicView, addTrail, BEACON_TTL, TRAIL_CATS, TRAIL_MAX, addNote } = require('../reports/model');
const { CAT, MERGE } = require('../categories');
const { DEVICE_MAX, banUntil, newInvite, SPONSOR, orgaReady, DEVICE_MS } = require('../orgas/sponsor');
const { NEXT } = require('./next');
const { NOTE_MAX, MIN } = require('../config');
const { abuseLog } = require('../moderation');
const { annAll, annView, getAnn, dropAnn } = require('../announcements/store');
const { createAnnouncement } = require('../announcements/create');
const { dropReport, saveReport, nearby, getReport } = require('../reports/store');
const { firstConfirm, repAdd } = require('../reports/votes');
const { keyLocked, keyFailed, orgaOf } = require('../orgas/auth');
const { labelClash } = require('../orgas/names');
const { orgaLog, trashReport, ORGA_REMOVE_MAX } = require('../orgas/log');
const { ownerTag, canManage } = require('../orgas/owner');
const { q, tx } = require('../db');
const { quota, ORGA_LIMITS, bump } = require('../limits');
const { readOrgas, writeOrgas } = require('../orgas/store');
const { routeDistM, getEvent, EVENT_KEEP, dropEvent } = require('../events/store');
const { send, readJson } = require('../http/respond');
const { sha, withLock, keyEq, clean, validLatLng, distM, round } = require('../util');

async function orgaRoutes(req, res, url, pathname) {
  // ---- Invitation d'orga : le jeton du QR code est échangé une seule fois contre une clé ----
  if (req.method === 'POST' && pathname === '/api/invite') {
    if (keyLocked(req)) return send(res, 429, { error: 'Trop d’essais, réessaie dans quelques minutes.' });
    const b = await readJson(req);
    const token = String(b.token || '');
    if (!/^[\w-]{20,40}$/.test(token)) { keyFailed(req); return send(res, 400, { error: 'Invitation invalide.' }); }
    const key = crypto.randomBytes(18).toString('base64url'), h = sha(token);
    let device = false;
    const o = withLock(() => {
      const list = readOrgas().slice(), now = Date.now();
      let i = list.findIndex(x => x.invite && keyEq(x.invite.h, h) && x.invite.exp > now);
      if (i >= 0) { const { invite, ...rest } = list[i]; list[i] = { ...rest, hash: sha(key), keys: [], activated: rest.activated || now }; writeOrgas(list); return list[i]; }
      // Ajout d'un appareil : la clé principale reste valable, on en ajoute une (5 appareils au plus)
      i = list.findIndex(x => x.devInv && keyEq(x.devInv.h, h) && x.devInv.exp > now);
      if (i >= 0) { const { devInv, ...rest } = list[i]; list[i] = { ...rest, keys: [...(rest.keys || []), sha(key)].slice(-(DEVICE_MAX - 1)) }; writeOrgas(list); device = true; return list[i]; }
      return null;
    });
    if (!o) { keyFailed(req); return send(res, 404, { error: 'Lien expiré ou déjà utilisé. Demande-en un nouveau.' }); }
    orgaLog({ id: o.id, label: o.label }, device ? 'appareil ajouté' : 'invitation utilisée');
    return send(res, 200, { key, label: o.label, device });
  }
  
  // ---- Espace orga / legal team ----
  if (pathname.startsWith('/api/orga') || pathname.startsWith('/api/announcements') || /^\/api\/events\/[\w-]{1,16}$/.test(pathname)
    || /^\/api\/reports\/[\w-]{1,16}\/(verify|remove|extend|edit)$/.test(pathname)) {
    const orga = orgaOf(req);
    if (!orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });
  
    if (req.method === 'GET' && pathname === '/api/orga/me') {
      const me = readOrgas().find(x => x.id === orga.id);
      return send(res, 200, { label: orga.label, ob: ownerTag(orga.admin ? 'admin' : orga.id), admin: orga.admin, trial: orga.trial, sponsored: !!orga.sponsored,
        sponsor: me && me.by ? (readOrgas().find(x => x.id === me.by)?.label || me.byLabel || null) : null,
        canInvite: !orga.trial && !banUntil(orga.id), ban: banUntil(orga.id), canAddDevice: !!me, devices: me && me.hash ? 1 + (me.keys || []).length : 0 });
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
        if (!target.trial) return send(res, 400, { error: 'Déjà confirmée.' });
        if (!orgaReady(target).ready) return send(res, 400, { error: 'Pas encore prête : il faut au moins 7 jours, 10 actions et aucun incident. Seul·e l’admin peut la confirmer avant.' });
        withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], trial: false }; writeOrgas(l); } });
        orgaLog(orga, 'confirmée (parrainage)', { ref: target.id, detail: target.label });
        return send(res, 200, { id: target.id, trial: false });
      }
      // Nouvelle invitation (la filleule a perdu son accès) : l'ancien accès est coupé
      const { token, invite } = newInvite();
      withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], hash: null, keys: [], invite }; writeOrgas(l); } });
      orgaLog(orga, 'nouvelle invitation (parrainage)', { ref: target.id, detail: target.label });
      return send(res, 200, { id: target.id, label: target.label, invite: token, exp: invite.exp });
    }
    // --- Ajouter un appareil : lien à usage unique, 10 minutes, la clé actuelle reste valable ---
    // --- Position en direct (orgas confirmées) : tête ou queue de cortège, street medic, legal team, presse ---
    // Le téléphone de l'orga envoie sa position toutes les 30 s tant que l'appli est ouverte ; le point disparaît 3 min après
    // le dernier envoi, et le partage s'arrête de lui-même au bout de 8 h. Seule la dernière position est gardée
    // (plus la trace des 30 dernières minutes pour la tête et la queue, jamais pour une personne).
    if (pathname === '/api/orga/beacon' && (req.method === 'POST' || req.method === 'DELETE')) {
      const b = await readJson(req);
      const role = String(b.role || '');
      if (!BEACON_ROLES.has(role) || !CAT[role]) return send(res, 400, { error: 'Rôle inconnu.' });
      if (orga.trial) return send(res, 403, { error: 'Le partage de position est réservé aux orgas confirmées.' });
      if (role === 'contact' && !orga.admin) return send(res, 403, { error: 'Réservé à l’admin.' });
      // Phrase libre au démarrage (« je suis près de la fontaine… ») : publique, comme une précision
      const bnote = clean(b.note, NOTE_MAX);
      const out = tx(() => {
        const now = Date.now();
        const cur = toReport(q('SELECT * FROM reports WHERE owner=? AND cat=? AND bk>0 AND exp>?').get(orga.id, role, now));
        if (req.method === 'DELETE') { if (cur) { dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position', { r: cur }); } return [200, { stopped: true }]; }
        const lat = Number(b.lat), lng = Number(b.lng);
        if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
        if (cur && now - cur.bk > BEACON_MAX) { dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position', { r: cur }); return [410, { error: 'Partage arrêté au bout de 4 h. Relance-le si besoin.' }]; }
        // Garde-fou : à plus de 2 km du point de départ (et du parcours d'une manif en cours), le partage s'arrête tout seul
        // et cette position n'est jamais enregistrée (une orga qui oublie de l'arrêter ne révèle pas où elle rentre)
        if (cur && cur.bkla != null && distM({ lat: cur.bkla, lng: cur.bklo }, { lat, lng }) > BEACON_ZONE_M && routeDistM(lat, lng, now) > BEACON_ZONE_M) {
          dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position (hors zone)', { r: cur });
          return [410, { error: 'Tu t’es éloigné·e de plus de 2 km de la manif : partage de position arrêté.', zone: true }];
        }
        if (cur && now - (cur.last || cur.t) < 10_000) return [200, publicView(cur)];
        const pos = { lat: round(lat), lng: round(lng) };
        if (cur) {
          if (cur.lat !== pos.lat || cur.lng !== pos.lng) { addTrail(cur, now); cur.lat = pos.lat; cur.lng = pos.lng; }
          Object.assign(cur, { last: now, exp: now + BEACON_TTL, down: 0, downIps: [], dw: 0, ct: 0, ver: orga.label, fl: 1 });
          saveReport(cur); return [200, publicView(cur)];
        }
        const r = { id: crypto.randomBytes(6).toString('base64url'), cat: role, lat: pos.lat, lng: pos.lng, note: bnote, notes: bnote ? [{ x: bnote, t: now, d: 'o:' + orga.id }] : [], t: now, last: now, exp: now + BEACON_TTL,
          up: 0, down: 0, voters: ['o:' + orga.id], downIps: [], ip: null, ver: orga.label, fl: 1, oid: orga.id, bk: now, trail: [], bkla: pos.lat, bklo: pos.lng };
        // Tête ou queue déjà signalée tout près par des participant·es : la position de l'orga prend le relais (avec la trace)
        if (TRAIL_CATS.has(role)) for (const x of nearby(role, pos.lat, pos.lng, MERGE[role].r, now).filter(x => !x.r.bk)) {
          const old = toReport(x.r); r.trail = [...(old.trail || []), [old.lat, old.lng, old.last || old.t]].slice(-TRAIL_MAX[role]); r.up += old.up || 0; dropReport(old.id, 'exp');
        }
        saveReport(r); orgaLog(orga, 'partage de position', { r });
        return [201, publicView(r)];
      });
      return send(res, ...out);
    }
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
  
    if (req.method === 'POST' && pathname === '/api/announcements') {
      const b = await readJson(req);
      // Période d'essai : pas d'annonce urgente (notification à toute la zone), numéro de legal team validé par l'admin
      if (orga.trial && b.kind !== 'legal' && b.level === 'urgent')
        return send(res, 400, { error: 'Pendant la période d’essai, les annonces urgentes ne sont pas possibles. Publie-la en « info ».' });
      if (orga.sponsored && b.kind !== 'legal' && q("SELECT COUNT(*) n FROM orga_log WHERE oid=? AND action IN ('annonce', 'annonce (en attente)') AND t>?").get(orga.id, Date.now() - 24 * 60 * 60_000).n >= SPONSOR.annPerDay)
        return send(res, 400, { error: `Orga parrainée : ${SPONSOR.annPerDay} annonces par jour au maximum jusqu’à ta confirmation.` });
      if (!orga.admin && !quota('ann:' + orga.id, ORGA_LIMITS.annPerDay, 24 * 60 * MIN))
        return send(res, 429, { error: `${ORGA_LIMITS.annPerDay} annonces par jour au maximum.` });
      // Notifications urgentes : au plus quelques-unes par heure et par orga (une orga piratée ne peut pas inonder les téléphones)
      if (!orga.admin && b.kind !== 'legal' && b.level === 'urgent' && !quota('urg:' + orga.id, ORGA_LIMITS.urgentPerHour, 60 * MIN)) {
        abuseLog('orga en rafale', { ref: orga.id });
        return send(res, 429, { error: `${ORGA_LIMITS.urgentPerHour} annonces urgentes par heure au maximum. Publie celle-ci en « info ».` });
      }
      // Période d'essai : toute annonce (info ou numéro de legal team) n'est visible qu'après validation par l'admin
      const out = createAnnouncement(b, orga.label, orga.admin, orga.trial, orga.admin ? 'admin' : orga.id);
      if (out[0] === 201) orgaLog(orga, out[1].pending ? (out[1].kind === 'legal' ? 'legal team (en attente)' : 'annonce (en attente)') : 'annonce', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id,
        detail: (out[1].kind === 'legal' ? out[1].phone + ' ' : '') + (out[1].level === 'urgent' ? '[urgent] ' : '') + (out[1].national ? '[nationale] ' : '') + (out[1].text || '') });
      return send(res, ...out);
    }
  
    const delEv = pathname.match(/^\/api\/events\/([\w-]{1,16})$/);
    if (req.method === 'DELETE' && delEv) {
      const out = tx(() => {
        const e = getEvent(delEv[1]);
        if (!e) return [404, { error: 'Événement déjà retiré.' }];
        if (!canManage(orga, e)) return [403, { error: 'Seule l’orga qui l’a publié peut le retirer.' }];
        if (e.src) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(e.id, e.start + EVENT_KEEP);
        dropEvent(e.id); orgaLog(orga, 'événement retiré', { lat: e.lat, lng: e.lng, ref: e.id, detail: e.title }); return [200, { removed: true }];
      });
      return send(res, ...out);
    }
  
    const delAnn = pathname.match(/^\/api\/announcements\/([\w-]{1,16})$/);
    if (req.method === 'DELETE' && delAnn) {
      const out = tx(() => {
        const a = getAnn(delAnn[1]);
        if (!a) return [404, { error: 'Annonce déjà retirée.' }];
        if (!canManage(orga, a)) return [403, { error: 'Seul·e l’auteur·ice peut retirer cette annonce.' }];
        dropAnn(a.id); orgaLog(orga, 'annonce retirée', { lat: a.lat, lng: a.lng, ref: a.id, detail: a.phone || a.text }); return [200, { removed: true }];
      });
      return send(res, ...out);
    }
  
    // Son propre signalement : le prolonger (une durée de plus, au plus 4 fois la durée normale à partir de maintenant) ou le corriger
    const own = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(extend|edit)$/);
    if (req.method === 'POST' && own) {
      const b = own[2] === 'edit' ? await readJson(req) : {};
      const out = tx(() => {
        const now = Date.now(), r = getReport(own[1], now);
        if (!r) return [404, { error: 'Signalement expiré.' }];
        if (!orga.admin && r.oid !== orga.id) return [403, { error: 'Seule l’orga qui l’a signalé peut le modifier.' }];
        if (own[2] === 'extend') {
          const base = CAT[r.cat].ttl * MIN;
          const exp = Math.min(Math.max(r.exp, now) + base, now + 4 * base);
          if (exp <= r.exp + MIN) return [409, { error: 'Déjà prolongé au maximum.' }];
          r.exp = exp; r.last = now; saveReport(r); orgaLog(orga, 'prolongé', { r });
          return [200, { ...publicView(r), mine: true }];
        }
        const cat = b.cat != null && Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
        if (b.cat != null && (!cat || cat.off || cat.beaconOnly)) return [400, { error: 'Catégorie inconnue.' }];
        const note = b.note == null ? null : String(b.note).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
        if (cat && cat.id !== r.cat) r.cat = cat.id;
        if (note != null) {
          const mark = 'o:' + orga.id;
          r.notes = (r.notes || []).filter(n => n.d !== mark);
          if (note) addNote(r, note, mark, now);
        }
        saveReport(r); orgaLog(orga, 'corrigé', { r, detail: note || null });
        return [200, { ...publicView(r), mine: true }];
      });
      return send(res, ...out);
    }
    const act = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/(verify|remove)$/);
    if (req.method === 'POST' && act) {
      const out = tx(() => {
        const r = getReport(act[1], Date.now());
        if (!r) return [404, { error: 'Signalement expiré.' }];
        // Vérifications en rafale : bloquées quelques minutes, et l'admin le voit dans le tableau des abus
        if (act[2] === 'verify' && !orga.admin && !bump('orv:' + orga.id, 'report', ORGA_LIMITS.verify, Date.now())) {
          orgaLog(orga, 'vérification bloquée (rafale)', { r }); abuseLog('orga en rafale', { lat: r.lat, lng: r.lng, ref: orga.id });
          return [429, { error: 'Trop de vérifications d’un coup : c’est suspendu quelques minutes. L’admin est prévenu·e.' }];
        }
        // Période d'essai (parrainée ou non) : « Vérifier » vaut une confirmation forte, sans la coche « vérifié », le point reste contestable
        if (act[2] === 'verify' && (orga.sponsored || orga.trial)) {
          const mark = 'o:' + orga.id;
          if (r.voters.includes(mark)) return [409, { error: 'Déjà confirmé.' }];
          r.voters.push(mark); r.up++; r.last = Date.now(); firstConfirm(r);
          const ttl = CAT[r.cat].ttl * MIN; r.exp = Math.min(Math.max(r.exp, Date.now() + ttl), r.t + 4 * ttl);
          saveReport(r); orgaLog(orga, orga.sponsored ? 'confirmé (parrainée)' : 'confirmé (essai)', { r }); return [200, { ...publicView(r), sponsored: true }];
        }
        if (act[2] === 'verify') { if (!r.ver) repAdd(r.voters[0], 'good', 2); r.ver = orga.label; if (r.fl === -1) r.fl = 0; saveReport(r); orgaLog(orga, 'vérifié', { r }); return [200, publicView(r)]; }
        // Période d'essai : « Retirer » compte comme deux « Plus là », sans retrait direct
        if (orga.sponsored && !bump('orm:' + orga.id, 'report', SPONSOR.removeMax, Date.now())) {
          orgaLog(orga, 'retrait bloqué (rafale)', { r }); abuseLog('orga en rafale', { lat: r.lat, lng: r.lng, ref: orga.id });
          return [429, { error: 'Trop de retraits d’un coup : le retrait est suspendu quelques minutes.' }];
        }
        if (orga.trial) {
          r.down += 2; (r.downIps ||= []).push('o1:' + orga.id, 'o2:' + orga.id);
          orgaLog(orga, 'retrait (essai)', { r });
          if (!r.ver && r.down > r.up) { trashReport(r, orga); return [200, { removed: true }]; }
          saveReport(r); return [200, { ...publicView(r), trial: true }];
        }
        // Garde-fou : des retraits en rafale bloquent le retrait pour cette orga quelques minutes
        if (!orga.admin && !bump('orm:' + orga.id, 'report', ORGA_REMOVE_MAX, Date.now())) {
          orgaLog(orga, 'retrait bloqué (rafale)', { r }); abuseLog('orga en rafale', { lat: r.lat, lng: r.lng, ref: orga.id });
          return [429, { error: 'Trop de retraits d’un coup : le retrait est suspendu quelques minutes. L’admin est prévenu·e.' }];
        }
        trashReport(r, orga); orgaLog(orga, 'retiré', { r }); return [200, { removed: true }];
      });
      return send(res, ...out);
    }
    return send(res, 404, { error: 'Inconnu.' });
  }
  return NEXT;
}

module.exports = { orgaRoutes };
