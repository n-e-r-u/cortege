'use strict';
// Routes de l'admin pour configurer l'instance sans toucher au serveur : réglages de l'instance, pays, langues, état du serveur.
// Appelées par routes/admin.js, après la vérification de la clé admin.
const { NEXT } = require('./next');
const { send, readJson } = require('../http/respond');
const { CATEGORIES } = require('../categories');
const { instance, cleanInstance, saveInstance, INSTANCE_DEFAULTS } = require('../instance');
const { adminProfiles, setActive, saveEdit, exportProfile } = require('../profiles');
const { adminLangs, uploadPo, removeUpload, setLangPrefs, poFor, potText } = require('../i18n');
const { pmFilesInfo } = require('../geo/pmtiles');
const { serverInfo } = require('../server-info');
const { dirty, scheduleFlush } = require('../live/files');
const { orgaLog } = require('../orgas/log');
const { adminLabel } = require('../settings');
const { getMeta } = require('../db');

const changed = what => { dirty.global = true; scheduleFlush(); orgaLog({ id: 'admin', label: adminLabel() }, what); };
// Erreur levée par un module (message lisible, code 400) ; une autre erreur reste une erreur du serveur
async function guard(res, fn) {
  try { return await fn(); }
  catch (e) { if (e && e.status) return send(res, e.status, { error: e.message, ...(e.problems ? { problems: e.problems } : {}) }); throw e; }
}
const download = (res, name, body, type) => send(res, 200, body, { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"` });

// Carte d'un pays : détaillée (une carte régionale couvre son centre), monde seulement, ou fond OpenStreetMap
function mapStatus(point) {
  const files = pmFilesInfo(), world = files.find(f => f.world);
  const hit = point && files.find(f => !f.world && (f.zones || []).some(([s, n, w, e]) => point[0] >= s && point[0] <= n && point[1] >= w && point[1] <= e));
  if (hit) return { kind: 'detail', file: hit.name };
  if (world) return { kind: 'world', file: world.name, maxz: world.maxz };
  return { kind: 'osm' };
}

async function adminConfigRoutes(req, res, url, pathname) {
  const m = req.method;
  // ---- Réglages de l'instance ----
  if (m === 'GET' && pathname === '/api/admin/instance') {
    let set = {}; try { set = JSON.parse(getMeta('instance') || '{}'); } catch {}
    return send(res, 200, { values: instance(), set, defaults: INSTANCE_DEFAULTS });
  }
  if (m === 'POST' && pathname === '/api/admin/instance') return guard(res, async () => {
    const o = cleanInstance(await readJson(req, 8192));
    saveInstance(o); changed('réglages de l’instance modifiés');
    return send(res, 200, { values: instance(), set: o });
  });

  // ---- Pays ----
  if (m === 'GET' && pathname === '/api/admin/countries')
    return send(res, 200, { list: adminProfiles().map(p => ({ ...p, map: mapStatus(p.point) })),
      categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, glyph: c.glyph, group: c.group, profiles: c.profiles || null })) });
  if (m === 'POST' && pathname === '/api/admin/countries/active') return guard(res, async () => {
    const list = setActive((await readJson(req, 1024)).codes); changed('pays actifs : ' + list.join(', '));
    return send(res, 200, { active: list });
  });
  const cR = pathname.match(/^\/api\/admin\/countries\/([a-z]{2,8})(\/export)?$/);
  if (cR && m === 'GET' && cR[2]) {
    const p = exportProfile(cR[1]);
    return p ? download(res, cR[1] + '.json', JSON.stringify(p, null, 2) + '\n', 'application/json; charset=utf-8') : send(res, 404, { error: 'Pays inconnu.' });
  }
  if (cR && !cR[2] && m === 'POST') return guard(res, async () => {
    saveEdit(cR[1], await readJson(req, 32768)); changed('profil pays modifié : ' + cR[1]);
    return send(res, 200, { ok: true });
  });
  if (cR && !cR[2] && m === 'DELETE') return guard(res, async () => {
    saveEdit(cR[1], null); changed('profil pays remis d’origine : ' + cR[1]);
    return send(res, 200, { ok: true });
  });

  // ---- Langues ----
  if (m === 'GET' && pathname === '/api/admin/langs') return send(res, 200, adminLangs());
  if (m === 'POST' && pathname === '/api/admin/langs/upload') return guard(res, async () => {
    const b = await readJson(req, 3_000_000), r = uploadPo(b.text, b.file);
    changed(`traduction déposée : ${r.name} (${r.n} textes)`);
    return send(res, 200, r);
  });
  if (m === 'POST' && pathname === '/api/admin/langs/prefs') return guard(res, async () => {
    setLangPrefs(await readJson(req, 2048)); changed('langues proposées modifiées');
    return send(res, 200, adminLangs());
  });
  if (m === 'GET' && pathname === '/api/admin/langs/cortege.pot') {
    const t = potText(); return t ? download(res, 'cortege.pot', t, 'text/x-gettext-translation; charset=utf-8') : send(res, 404, { error: 'Modèle introuvable.' });
  }
  const lR = pathname.match(/^\/api\/admin\/langs\/([a-z]{2,3}(?:-[A-Za-z]{2,4})?)(\.po)?$/);
  if (lR && m === 'GET' && lR[2]) {
    const t = poFor(lR[1], url.searchParams.get('name'));
    return t ? download(res, lR[1] + '.po', t, 'text/x-gettext-translation; charset=utf-8') : send(res, 404, { error: 'Modèle introuvable.' });
  }
  if (lR && !lR[2] && m === 'DELETE') return guard(res, async () => {
    removeUpload(lR[1]); changed('traduction déposée retirée : ' + lR[1]);
    return send(res, 200, adminLangs());
  });

  // ---- Serveur ----
  if (m === 'GET' && pathname === '/api/admin/server') return send(res, 200, await serverInfo({ checkLatest: url.searchParams.get('check') !== '0' }));
  return NEXT;
}

module.exports = { adminConfigRoutes };
