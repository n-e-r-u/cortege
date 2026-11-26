'use strict';
// Routes des orgas : l'invitation et le code de secours (sans clé), puis l'espace orga. Ce fichier vérifie la clé d'orga
// et passe la main au fichier du thème : accès, terrain, publication.
const crypto = require('crypto');
const { DEVICE_MAX, MEDIC_DEVICE_MAX } = require('../orgas/sponsor');
const { NEXT } = require('./next');
const { keyLocked, keyFailed, orgaOf, keyRefusal } = require('../orgas/auth');
const { newCode, validCode, codeHash } = require('../orgas/recovery');
const M = require('../medic');
const { clientHash } = require('../privacy');
const { orgaLog } = require('../orgas/log');
const { abuseLog } = require('../moderation');
const { bump } = require('../limits');
const { readOrgas, writeOrgas } = require('../orgas/store');
const { send, readJson } = require('../http/respond');
const { sha, withLock, keyEq } = require('../util');
const THEMES = [
  require('./orga-acces').orgaAccesRoutes,             // compte, code de secours, tableau de bord, parrainage, appareils
  require('./orga-terrain').orgaTerrainRoutes,         // position en direct, lieux de repli
  require('./orga-publication').orgaPublicationRoutes, // annonces, rendez-vous, signalements
];

async function orgaRoutes(req, res, url, pathname) {
  // ---- Invitation d'orga : le jeton du QR code est échangé une seule fois contre une clé ----
  if (req.method === 'POST' && pathname === '/api/invite') {
    if (keyLocked(req)) return send(res, 429, { error: 'Trop d’essais, réessaie dans quelques minutes.' });
    const b = await readJson(req);
    const token = String(b.token || '');
    if (!/^[\w-]{20,40}$/.test(token)) { keyFailed(req); return send(res, 400, { error: 'Invitation invalide.' }); }
    const key = crypto.randomBytes(18).toString('base64url'), h = sha(token);
    let device = false, rec = null, medic = false;
    let o = withLock(() => {
      const list = readOrgas().slice(), now = Date.now();
      let i = list.findIndex(x => x.invite && keyEq(x.invite.h, h) && x.invite.exp > now);
      // Première activation : le code de secours est créé et montré une seule fois (le serveur n'en garde que l'empreinte)
      if (i >= 0) { const { invite, ...rest } = list[i]; rec = newCode(); list[i] = { ...rest, hash: sha(key), keys: [], rec: codeHash(rec), recAt: undefined, activated: rest.activated || now }; writeOrgas(list); return list[i]; }
      // Ajout d'un appareil : la clé principale reste valable, on en ajoute une (5 appareils au plus)
      i = list.findIndex(x => x.devInv && keyEq(x.devInv.h, h) && x.devInv.exp > now);
      if (i >= 0) { const { devInv, ...rest } = list[i]; list[i] = { ...rest, keys: [...(rest.keys || []), sha(key)].slice(-(DEVICE_MAX - 1)) }; writeOrgas(list); device = true; return list[i]; }
      return null;
    });
    // Invitation d'une équipe medic : même échange, autre liste (une équipe medic n'a aucun droit d'orga)
    if (!o) { const m = M.redeem(h, key); if (m) { o = m.o; device = m.device; rec = m.rec || null; medic = true; } }
    if (!o) { keyFailed(req); return send(res, 404, { error: 'Lien expiré ou déjà utilisé. Demande-en un nouveau.' }); }
    orgaLog({ id: (medic ? 'm:' : '') + o.id, label: o.label }, device ? 'appareil ajouté' : 'invitation utilisée');
    if (device) abuseLog('orga : appareil ajouté', { ref: (medic ? 'm:' : '') + o.id });
    return send(res, 200, { key, label: o.label, device, ...(medic ? { medic: true } : {}), ...(rec ? { rec } : {}) });
  }

  // ---- Accès perdu : le code de secours donne une nouvelle clé et un nouveau code (l'ancien ne sert plus) ----
  // cut (par défaut) : tous les autres appareils sont coupés, pour un téléphone perdu ou saisi.
  if (req.method === 'POST' && pathname === '/api/recover') {
    // Pas de verrou par réseau ici (un code fait 98 bits, et il doit rester utilisable au milieu d'une foule) : seulement un débit
    if (!bump('recv:' + clientHash(req), 'vote', 30, Date.now())) return send(res, 429, { error: 'Trop d’essais, réessaie dans quelques minutes.' });
    const b = await readJson(req);
    if (!validCode(b.code)) return send(res, 400, { error: 'Code de secours invalide : 20 caractères, par groupes de 4.' });
    const h = codeHash(b.code), key = crypto.randomBytes(18).toString('base64url'), rec = newCode(), cut = b.cut !== false, now = Date.now();
    const renew = (t, max = DEVICE_MAX) => ({ ...t, ...(cut || !t.hash ? { hash: sha(key), keys: [] } : { keys: [...(t.keys || []), sha(key)].slice(-(max - 1)) }), devInv: undefined, rec: codeHash(rec), recAt: now });
    let medic = false;
    let o = withLock(() => {
      const list = readOrgas().slice(), i = list.findIndex(x => x.rec && x.hash && keyEq(x.rec, h));
      if (i < 0) return null;
      list[i] = renew(list[i]); writeOrgas(list); return list[i];
    });
    if (!o) { const t = M.readMedics().find(x => x.rec && x.hash && keyEq(x.rec, h)); if (t) { o = M.editTeam(t.id, cur => cur.rec && keyEq(cur.rec, h) ? renew(cur, MEDIC_DEVICE_MAX) : null); medic = !!o; if (o && cut) M.forgetTeam(o.id); } }
    if (!o) { keyFailed(req); return send(res, 404, { error: 'Code de secours inconnu ou déjà utilisé.' }); }
    orgaLog({ id: (medic ? 'm:' : '') + o.id, label: o.label }, 'accès récupéré (code de secours)', { detail: cut ? 'autres appareils coupés' : 'appareil ajouté' });
    abuseLog('orga : code de secours utilisé', { ref: (medic ? 'm:' : '') + o.id });
    return send(res, 200, { key, label: o.label, rec, cut, ...(medic ? { medic: true } : {}) });
  }
  
  // ---- Espace orga / legal team ----
  if (pathname.startsWith('/api/orga') || pathname.startsWith('/api/announcements') || /^\/api\/events\/[\w-]{1,16}$/.test(pathname)
    || /^\/api\/reports\/[\w-]{1,16}\/(verify|remove|extend|edit)$/.test(pathname)) {
    const orga = orgaOf(req);
    if (!orga) return send(res, ...keyRefusal(req));
  
    for (const theme of THEMES) {
      const out = await theme(req, res, url, pathname, orga);
      if (out !== NEXT) return out;
    }
    return send(res, 404, { error: 'Inconnu.' });
  }
  return NEXT;
}

module.exports = { orgaRoutes };
