'use strict';
// Routes du mode medic : écran des équipes (/api/medic/…), référent·es, et gestion par l'admin (/api/admin/medics…).
// Rien de ce qui passe ici n'est publié : la couche medic n'est lisible qu'avec une clé d'équipe.
const { NEXT } = require('./next');
const { send, readJson } = require('../http/respond');
const { isAdmin, keyRefusal } = require('../orgas/auth');
const { newCode, codeHash } = require('../orgas/recovery');
const { orgaLog } = require('../orgas/log');
const { quota } = require('../limits');
const { MIN } = require('../config');
const M = require('../medic');

const logAs = t => ({ id: 'm:' + t.id, label: t.label });
async function medicRoutes(req, res, url) {
  const p = url.pathname;
  // ---- Admin : équipes, référent·es, rayon des notifications, totaux (jamais de positions) ----
  if (p.startsWith('/api/admin/medics')) {
    if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    if (req.method === 'GET' && p === '/api/admin/medics') return send(res, 200, { teams: M.readMedics().map(M.teamView), cfg: M.cfg(), stats: M.stats() });
    if (req.method === 'POST' && p === '/api/admin/medics') { const b = await readJson(req); return send(res, ...M.createTeam({ label: b.label, city: b.city, ref: b.ref === true, by: 'admin' })); }
    if (req.method === 'POST' && p === '/api/admin/medics/config') { const c = M.saveCfg(await readJson(req)); return c ? send(res, 200, c) : send(res, 400, { error: 'Rayon entre 0,5 et 30 km.' }); }
    const m = p.match(/^\/api\/admin\/medics\/([\w-]{1,16})(\/invite)?$/);
    if (m && req.method === 'POST' && m[2]) return send(res, ...M.reinviteTeam(m[1]));
    if (m && req.method === 'POST') {
      const b = await readJson(req);
      const o = M.editTeam(m[1], t => ({ ...t, ...(b.ref !== undefined ? { ref: b.ref === true } : {}), ...(b.city !== undefined ? { city: M.cleanLabel(b.city) } : {}) }));
      return o ? send(res, 200, M.teamView(o)) : send(res, 404, { error: 'Équipe introuvable.' });
    }
    if (m && req.method === 'DELETE') return M.removeTeam(m[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Équipe introuvable.' });
    return send(res, 404, { error: 'Introuvable.' });
  }
  if (!p.startsWith('/api/medic/')) return NEXT;
  res.setHeader('Cache-Control', 'no-store');
  const me = M.medicOf(req);
  if (!me) return send(res, ...keyRefusal(req, true));
  const team = () => M.readMedics().find(x => x.id === me.id);

  if (req.method === 'GET' && p === '/api/medic/me') {
    const t = team(), { accessState } = require('./orga');
    return send(res, 200, { label: me.label, city: me.city, ref: me.ref, devices: 1 + (t.keys || []).length, radiusKm: M.cfg().radiusKm, durs: M.POS_DUR, ...accessState(t) });
  }
  // Carte medic : réponse immédiate si quelque chose a changé depuis v, sinon attente (25 s au plus)
  if (req.method === 'GET' && p === '/api/medic/state') {
    const v = Number(url.searchParams.get('v') || 0);
    if (url.searchParams.get('wait') === '1') { const w = M.waitChange(v); req.on('close', w.cancel); await w.promise; if (res.destroyed) return; }
    return send(res, 200, M.state(me));
  }
  if (p === '/api/medic/pos' && req.method === 'POST') return send(res, ...M.posSet(me, await readJson(req)));
  if (p === '/api/medic/pos' && req.method === 'DELETE') { M.posStop(me.id); return send(res, 200, { stopped: true }); }
  if (p === '/api/medic/items' && req.method === 'POST') return send(res, ...M.addItem(me, await readJson(req)));
  const it = p.match(/^\/api\/medic\/items\/([\w-]{1,16})(\/go)?$/);
  if (it && it[2] && req.method === 'POST') return send(res, ...M.goItem(me, it[1], (await readJson(req)).on !== false));
  if (it && !it[2] && req.method === 'DELETE') return send(res, ...M.removeItem(me, it[1]));
  if (p === '/api/medic/push' && req.method === 'POST') return send(res, ...M.subscribe(me, await readJson(req, 4096)));
  if (p === '/api/medic/push' && req.method === 'DELETE') return send(res, ...M.unsubscribe(me, (await readJson(req, 4096)).endpoint));

  // ---- Accès : autre appareil, code de secours ----
  if (p === '/api/medic/device' && req.method === 'POST') {
    const d = M.deviceLink(me.id);
    if (d) orgaLog(logAs(me), 'lien d’appareil créé');
    return d ? send(res, 200, d) : send(res, 404, { error: 'Équipe introuvable.' });
  }
  if (p === '/api/medic/recovery' && req.method === 'POST') {
    if (!quota('rec:m:' + me.id, 5, 60 * MIN)) return send(res, 429, { error: 'Trop de codes demandés, réessaie plus tard.' });
    const rec = newCode();
    M.editTeam(me.id, t => ({ ...t, rec: codeHash(rec) }));
    orgaLog(logAs(me), 'code de secours créé');
    return send(res, 200, { rec });
  }
  // ---- Référent·e : fait entrer des équipes de sa ville, les réinvite (accès perdu), les retire ----
  if (p.startsWith('/api/medic/teams')) {
    if (!me.ref) return send(res, 403, { error: 'Réservé aux référent·es medic.' });
    const mine = id => M.readMedics().find(x => x.id === id && x.by === me.id);
    if (req.method === 'GET' && p === '/api/medic/teams') return send(res, 200, { teams: M.readMedics().filter(x => x.by === me.id).map(M.teamView) });
    if (req.method === 'POST' && p === '/api/medic/teams') {
      const out = M.createTeam({ label: (await readJson(req)).label, city: me.city, ref: false, by: me.id });
      if (out[0] === 201) orgaLog(logAs(me), 'équipe medic invitée', { ref: out[1].id, detail: out[1].label });
      return send(res, ...out);
    }
    const m = p.match(/^\/api\/medic\/teams\/([\w-]{1,16})(\/invite)?$/);
    if (m && !mine(m[1])) return send(res, 404, { error: 'Équipe introuvable parmi celles que tu as invitées.' });
    if (m && m[2] && req.method === 'POST') { orgaLog(logAs(me), 'équipe medic réinvitée', { ref: m[1] }); return send(res, ...M.reinviteTeam(m[1])); }
    if (m && !m[2] && req.method === 'DELETE') { orgaLog(logAs(me), 'équipe medic retirée', { ref: m[1] }); M.removeTeam(m[1]); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'Introuvable.' });
}
module.exports = { medicRoutes };
