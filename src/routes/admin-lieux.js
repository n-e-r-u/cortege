'use strict';
// Routes de l'admin pour les lieux : lieux permanents (import OpenStreetMap) et lieux de repli des orgas (quotas, logos).
// Appelées par routes/admin.js, après la vérification de la clé admin.
const crypto = require('crypto');
const { NEXT } = require('./next');
const { adminLabel } = require('../settings');
const { orgaLog } = require('../orgas/log');
const { placesRun, POI_KINDS, placesStatus, placesState, PLACES_IMPORT, POI, poiStr, poiRg } = require('../places/osm');
const { placesSource, poiView, placesImport, placesPublish } = require('../places/geofabrik');
const { readOrgas } = require('../orgas/store');
const { send, readJson } = require('../http/respond');
const { q } = require('../db');
const { validLatLng } = require('../util');
const R = require('../refuges');

async function adminLieuxRoutes(req, res, url, pathname) {
  // --- Lieux permanents ---
  if (req.method === 'GET' && pathname === '/api/admin/places') {
    const term = String(url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase(), kind = String(url.searchParams.get('kind') || '');
    const filter = url.searchParams.get('filter') || '';
    let rows = [];
    if (term.length >= 2 || filter || kind) {
      const like = '%' + term.replace(/[%_]/g, '') + '%';
      rows = q(`SELECT * FROM pois WHERE (? = '' OR lower(data) LIKE ? OR lower(id)=?) AND (? = '' OR kind=?)
        AND (? = '' OR (?='hidden' AND hid=1) OR (?='edited' AND ed=1) OR (?='admin' AND src='admin')) LIMIT 200`)
        .all(term, like, term, kind, kind, filter, filter, filter, filter);
    }
    const counts = Object.fromEntries(q('SELECT kind, COUNT(*) n FROM pois WHERE hid=0 GROUP BY kind').all().map(x => [x.kind, x.n]));
    const run = placesRun();
    return send(res, 200, { kinds: POI_KINDS, counts, last: placesStatus(), source: placesSource(), running: placesState.running ? run || {} : null, paused: !placesState.running && run ? run : null, auto: PLACES_IMPORT, list: rows.map(poiView) });
  }
  if (req.method === 'POST' && pathname === '/api/admin/places/import') {
    if (placesState.running) return send(res, 409, { error: 'Import déjà en cours.' });
    const resume = !!placesRun() && (await readJson(req)).restart !== true;
    placesImport(resume); orgaLog({ id: 'admin', label: adminLabel() }, resume ? 'import des lieux repris' : 'import des lieux lancé');
    return send(res, 202, { started: true });
  }
  const plR = pathname.match(/^\/api\/admin\/places(?:\/([\w:-]{1,24}))?$/);
  if (plR && req.method === 'POST') {
    const b = await readJson(req, 4096), old = plR[1] ? q('SELECT * FROM pois WHERE id=?').get(plR[1]) : null;
    if (plR[1] && !old) return send(res, 404, { error: 'Lieu introuvable.' });
    const kind = b.kind != null ? String(b.kind) : old?.kind;
    if (!POI[kind]) return send(res, 400, { error: 'Type de lieu inconnu.' });
    const lat = b.lat != null ? Number(b.lat) : old?.lat, lng = b.lng != null ? Number(b.lng) : old?.lng;
    if (!validLatLng(lat, lng)) return send(res, 400, { error: 'Position invalide.' });
    const d = old ? JSON.parse(old.data || '{}') : {};
    if (b.n != null) { const v = poiStr(b.n, 80); if (v) d.n = v; else delete d.n; }
    if (b.h != null) { const v = poiStr(b.h, 120); if (v) d.h = v; else delete d.h; }
    if (b.p != null) { const v = poiStr(b.p, 30); if (v) d.p = v; else delete d.p; }
    if (b.e != null) { if (b.e && kind === 'hopital') d.e = 1; else delete d.e; }
    const onlyHide = old && Object.keys(b).every(k => k === 'hid');
    const id = old ? old.id : 'a' + crypto.randomBytes(5).toString('hex');
    const rgs = new Set([poiRg(lat, lng)]); if (old) rgs.add(old.rg);
    q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,hid,ed,seen) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, lat=excluded.lat,
       lng=excluded.lng, rg=excluded.rg, data=excluded.data, hid=excluded.hid, ed=excluded.ed`)
      .run(id, kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, poiRg(lat, lng), JSON.stringify(d), old ? old.src : 'admin',
        b.hid != null ? (b.hid ? 1 : 0) : old ? old.hid : 0, onlyHide ? old.ed : 1, Date.now());
    placesPublish(rgs);
    orgaLog({ id: 'admin', label: adminLabel() }, old ? (onlyHide ? (b.hid ? 'lieu masqué' : 'lieu réaffiché') : 'lieu corrigé') : 'lieu ajouté', { lat, lng, ref: id, detail: d.n || POI[kind].label });
    return send(res, old ? 200 : 201, poiView(q('SELECT * FROM pois WHERE id=?').get(id)));
  }
  if (plR && plR[1] && req.method === 'DELETE') {
    const old = q('SELECT * FROM pois WHERE id=?').get(plR[1]);
    if (!old) return send(res, 404, { error: 'Lieu introuvable.' });
    // Un lieu d'OpenStreetMap reviendrait au prochain import : on le masque au lieu de l'effacer
    if (old.src === 'osm') q('UPDATE pois SET hid=1 WHERE id=?').run(old.id); else q('DELETE FROM pois WHERE id=?').run(old.id);
    placesPublish([old.rg]);
    return send(res, 200, { removed: true, hidden: old.src === 'osm' });
  }
  // --- Lieux de repli des orgas : liste, retrait, logos à valider ---
  if (req.method === 'GET' && pathname === '/api/admin/refuges') {
    const labels = { admin: adminLabel(), ...Object.fromEntries(readOrgas().map(o => [o.id, o.label])) }, now = Date.now();
    return send(res, 200, {
      refuges: R.all().map(r => ({ ...R.adminView(r), open: r.state !== 'closed' && r.from <= now && r.to > now })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
      logos: R.logosPending().map(l => ({ oid: l.oid, orga: labels[l.oid] || l.oid, t: l.t, img: l.data })),
      quotas: R.quotas(), defaultMax: R.REFUGE_MAX, quotaMax: R.QUOTA_MAX });
  }
  const adm = () => ({ id: 'admin', label: adminLabel(), admin: true, trial: false });
  if (req.method === 'POST' && pathname === '/api/admin/refuges') {
    const out = R.adminSave(await readJson(req, 80_000));
    if (out[0] < 300) orgaLog(adm(), 'lieu de repli créé', { ref: out[1].id, detail: out[1].name });
    return send(res, ...out);
  }
  if (req.method === 'POST' && pathname === '/api/admin/refuges/open') return send(res, ...R.openRefuges(adm(), await readJson(req, 4096)));
  const rfAdm = pathname.match(/^\/api\/admin\/refuges\/([\w-]{1,16})(\/state)?$/);
  if (rfAdm && req.method === 'POST' && rfAdm[2]) return send(res, ...R.setRefugeState(adm(), rfAdm[1], String((await readJson(req)).state || '')));
  if (rfAdm && req.method === 'POST') {
    const out = R.adminSave(await readJson(req, 80_000), rfAdm[1]);
    if (out[0] < 300) orgaLog(adm(), 'lieu de repli modifié', { ref: rfAdm[1], detail: out[1].name });
    return send(res, ...out);
  }
  const quAct = pathname.match(/^\/api\/admin\/refuge-quota\/([\w:-]{1,40})$/);
  if (quAct && req.method === 'POST') {
    if (!readOrgas().some(o => o.id === quAct[1])) return send(res, 404, { error: 'Orga introuvable.' });
    const n = (await readJson(req)).max;
    if (!R.setQuota(quAct[1], n)) return send(res, 400, { error: 'Entre 0 et 30 lieux.' });
    orgaLog(adm(), 'nombre de lieux de repli réglé', { ref: quAct[1], detail: String(n) });
    return send(res, 200, { ok: true, max: R.quotaOf(quAct[1]) });
  }
  const lgAct = pathname.match(/^\/api\/admin\/logos\/([\w:-]{1,40})\/(ok|no)$/);
  if (lgAct && req.method === 'POST') {
    if (!R.judgeLogo(lgAct[1], lgAct[2] === 'ok')) return send(res, 404, { error: 'Introuvable.' });
    orgaLog({ id: 'admin', label: adminLabel() }, lgAct[2] === 'ok' ? 'logo validé' : 'logo refusé', { ref: lgAct[1] });
    return send(res, 200, { ok: true });
  }
  const rfDel = pathname.match(/^\/api\/admin\/refuges\/([\w-]{1,16})$/);
  if (rfDel && req.method === 'DELETE') {
    if (!R.dropRefuge(rfDel[1])) return send(res, 404, { error: 'Introuvable.' });
    orgaLog({ id: 'admin', label: adminLabel() }, 'lieu de repli retiré', { ref: rfDel[1] });
    return send(res, 200, { ok: true });
  }
  return NEXT;
}

module.exports = { adminLieuxRoutes };
