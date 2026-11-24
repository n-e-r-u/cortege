'use strict';
// Espace orga, le terrain : position en direct (tête ou queue de cortège, medic, legal team, presse) et lieux de repli.
// Appelées par routes/orga.js, une fois la clé d'orga vérifiée.
const crypto = require('crypto');
const { BEACON_ROLES, toReport, BEACON_MAX, BEACON_ZONE_M, publicView, addTrail, BEACON_TTL, TRAIL_CATS, TRAIL_MAX } = require('../reports/model');
const { CAT, MERGE } = require('../categories');
const { NEXT } = require('./next');
const { NOTE_MAX } = require('../config');
const { dropReport, saveReport, nearby } = require('../reports/store');
const { orgaLog } = require('../orgas/log');
const { q, tx } = require('../db');
const { routeDistM } = require('../events/store');
const { send, readJson } = require('../http/respond');
const R = require('../refuges');
const { clean, validLatLng, distM, round } = require('../util');

// Journal des partages de position : l'action et le rôle, jamais la position (protège les orgas même face à l'admin)
const bLog = (orga, action, r) => orgaLog(orga, action, { ref: r.id, r: { id: r.id, cat: r.cat } });
async function orgaTerrainRoutes(req, res, url, pathname, orga) {
  // --- Position en direct (orgas confirmées) : tête ou queue de cortège, street medic, legal team, presse ---
  // Le téléphone de l'orga envoie sa position toutes les 30 s tant que l'appli est ouverte ; le point disparaît 3 min après
  // le dernier envoi, et le partage s'arrête de lui-même au bout de 4 h. Seule la dernière position est gardée
  // (plus la trace récente pour la tête et la queue, jamais pour une personne) ; le journal des orgas n'en garde aucune.
  // Un partage ne (re)démarre que par le bouton (start: true) : après 3 min sans envoi, le point de départ est oublié,
  // et un envoi automatique ne doit jamais ouvrir un nouveau partage ailleurs (métro, téléphone en veille sur le retour).
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
      if (req.method === 'DELETE') { if (cur) { dropReport(cur.id, 'exp'); bLog(orga, 'fin du partage de position', cur); } return [200, { stopped: true }]; }
      if (!cur && b.start !== true) return [410, { error: 'Partage de position arrêté (plus d’envoi depuis 3 min). Relance-le si besoin.', lapsed: true }];
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
      if (cur && now - cur.bk > BEACON_MAX) { dropReport(cur.id, 'exp'); bLog(orga, 'fin du partage de position', cur); return [410, { error: 'Partage arrêté au bout de 4 h. Relance-le si besoin.' }]; }
      // Garde-fou : à plus de 2 km du point de départ (et du parcours d'une manif en cours), le partage s'arrête tout seul
      // et cette position n'est jamais enregistrée (une orga qui oublie de l'arrêter ne révèle pas où elle rentre)
      if (cur && cur.bkla != null && distM({ lat: cur.bkla, lng: cur.bklo }, { lat, lng }) > BEACON_ZONE_M && routeDistM(lat, lng, now) > BEACON_ZONE_M) {
        dropReport(cur.id, 'exp'); bLog(orga, 'fin du partage de position (hors zone)', cur);
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
      saveReport(r); bLog(orga, 'partage de position', r);
      return [201, publicView(r)];
    });
    return send(res, ...out);
  }
  // ---- Lieux de repli : enregistrés une fois, ouverts le jour d'une manif (orgas certifiées) ----
  if (pathname === '/api/orga/refuges' || pathname.startsWith('/api/orga/refuges/') || pathname === '/api/orga/logo') {
    if (orga.trial) return send(res, 403, { error: 'Les lieux de repli sont réservés aux orgas certifiées.' });
    if (req.method === 'GET' && pathname === '/api/orga/refuges') {
      const l = R.getLogo(orga.id);
      return send(res, 200, { refuges: R.mineFor(orga).map(R.refugeView), logo: l ? { status: l.status, img: l.data } : null, max: orga.admin ? R.QUOTA_MAX : R.quotaOf(orga.id) });
    }
    if (req.method === 'POST' && pathname === '/api/orga/logo') {
      const out = R.setLogo(orga, await readJson(req, 64_000));
      if (out[0] < 300) orgaLog(orga, 'logo envoyé');
      return send(res, ...out);
    }
    if (req.method === 'DELETE' && pathname === '/api/orga/logo') { R.dropLogo(orga.id); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && pathname === '/api/orga/refuges') {
      const out = R.createRefuge(orga, await readJson(req, 4096));
      if (out[0] < 300) orgaLog(orga, 'lieu de repli ajouté', { ref: out[1].id, detail: out[1].name });
      return send(res, ...out);
    }
    if (req.method === 'POST' && pathname === '/api/orga/refuges/open') {
      const out = R.openRefuges(orga, await readJson(req, 4096));
      if (out[0] < 300) orgaLog(orga, 'lieux de repli ouverts', { detail: String(out[1].n) });
      return send(res, ...out);
    }
    const rf = pathname.match(/^\/api\/orga\/refuges\/([\w-]{1,16})(\/state)?$/);
    if (rf && req.method === 'POST' && rf[2]) return send(res, ...R.setRefugeState(orga, rf[1], String((await readJson(req)).state || '')));
    if (rf && req.method === 'POST') {
      const out = R.updateRefuge(orga, rf[1], await readJson(req, 4096));
      if (out[0] < 300) orgaLog(orga, 'lieu de repli modifié', { ref: rf[1], detail: out[1].name });
      return send(res, ...out);
    }
    if (rf && req.method === 'DELETE') {
      const out = R.removeRefuge(orga, rf[1]);
      if (out[0] < 300) orgaLog(orga, 'lieu de repli supprimé', { ref: rf[1] });
      return send(res, ...out);
    }
    return send(res, 404, { error: 'Introuvable.' });
  }
  return NEXT;
}

module.exports = { orgaTerrainRoutes };
