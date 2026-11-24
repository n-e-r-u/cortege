'use strict';
// Espace orga, ce qui est publié : annonces, retrait d'un rendez-vous ou d'une annonce, son propre signalement (prolonger,
// corriger), vérification et retrait des signalements.
// Appelées par routes/orga.js, une fois la clé d'orga vérifiée.
const { authorOf, publicView, addNote } = require('../reports/model');
const { CAT } = require('../categories');
const { SPONSOR } = require('../orgas/sponsor');
const { NEXT } = require('./next');
const { NOTE_MAX, MIN } = require('../config');
const { abuseLog } = require('../moderation');
const { getAnn, dropAnn } = require('../announcements/store');
const { createAnnouncement } = require('../announcements/create');
const { saveReport, getReport } = require('../reports/store');
const { firstConfirm, repAdd } = require('../reports/votes');
const { orgaLog, trashReport, ORGA_REMOVE_MAX } = require('../orgas/log');
const { canManage } = require('../orgas/owner');
const { q, tx } = require('../db');
const { quota, ORGA_LIMITS, bump } = require('../limits');
const { getEvent, EVENT_KEEP, dropEvent } = require('../events/store');
const { send, readJson } = require('../http/respond');

async function orgaPublicationRoutes(req, res, url, pathname, orga) {
  if (req.method === 'POST' && pathname === '/api/announcements') {
    const b = await readJson(req);
    // Annonces : seulement les orgas certifiées (confirmées), et dans un rayon de 3 km au plus (voir createAnnouncement).
    // Une orga en essai ou parrainée peut seulement proposer le numéro de sa legal team, validé par l'admin.
    if (orga.trial && !orga.admin && b.kind !== 'legal')
      return send(res, 403, { error: 'Les annonces sont réservées aux orgas certifiées. Pendant la période d’essai, tu peux vérifier les signalements et proposer le numéro de ta legal team.' });
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
      if (act[2] === 'verify') { if (!r.ver) repAdd(authorOf(r), 'good', 2); r.ver = orga.label; if (r.fl === -1) r.fl = 0; saveReport(r); orgaLog(orga, 'vérifié', { r }); return [200, publicView(r)]; }
      // Période d'essai : « Retirer » compte comme deux « Plus là », sans retrait direct
      // Toute orga en essai (parrainée ou invitée par l'admin) : au plus SPONSOR.removeMax retraits par 5 min
      if ((orga.sponsored || orga.trial) && !orga.admin && !bump('orm:' + orga.id, 'report', SPONSOR.removeMax, Date.now())) {
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
  return NEXT;
}

module.exports = { orgaPublicationRoutes };
