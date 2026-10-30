'use strict';
// Routes de la page admin (/api/admin/…) : orgas, réglages, modération, bilans, lieux, arrêtés, annuaire, santé.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { ADMIN_KEY, ORGAS, EVENT_NAME, CENTER, ZOOM, MIN, DATA_DIR } = require('../config');
const { APP_VERSION } = require('../http/version');
const { BASE_TTL, CATEGORIES } = require('../categories');
const { DEPS } = require('../geo/departments');
const { NEXT } = require('./next');
const { activeReports, getReport, saveReport } = require('../reports/store');
const { adminLabel, pausedUntil, settings, cleanSettings, saveSettings, mobsAll, mobToday } = require('../settings');
const { annAll, annView, dropAnn, getAnn, saveAnn } = require('../announcements/store');
const { banUntil, orgaReady, descendants, SPONSOR } = require('../orgas/sponsor');
const { cityIdx } = require('../pages/city-cache');
const { createAnnouncement } = require('../announcements/create');
const { dirty, scheduleFlush } = require('../live/files');
const { getPub, pubSnapshot } = require('../digest/pub');
const { isAdmin } = require('../orgas/auth');
const { labelClash } = require('../orgas/names');
const { legalAlerts, legalAll, legalView, watchStatus, getLegal, cleanLegal, phoneDigits, saveLegal, legalWatch } = require('../legal');
const { listEvents, evView, getEvent, EVENT_KEEP, dropEvent, saveEvent } = require('../events/store');
const { loadStats } = require('../http/saturation');
const { mobsToPublish, cleanMob } = require('../mobs');
const { modQueue } = require('../moderation');
const { ordersAll, orderView, ORDER_KINDS, createOrder, approveOrder, dropOrder } = require('../orders');
const { orgaRequests } = require('../orgas/requests');
const { orgaStats, orgaLog, trashReport, TRASH_MS } = require('../orgas/log');
const { parisDay, archive, ARCHIVE_DIR } = require('../digest/archive');
const { placeOf } = require('../geo/cities');
const { placesRun, POI_KINDS, placesStatus, placesState, PLACES_IMPORT, POI, poiStr, poiRg } = require('../places/osm');
const { placesSource, poiView, placesImport, placesPublish } = require('../places/geofabrik');
const { publicView } = require('../reports/model');
const { pushCount, pushQueue, pushRunningNow, PSTATS } = require('../push');
const { readOrgas, INVITE_MS, writeOrgas } = require('../orgas/store');
const { rebuildAll } = require('../live/publish');
const { repAdd, TRUST, VOTES } = require('../reports/votes');
const { rotateSecret } = require('../privacy');
const { send, readJson } = require('../http/respond');
const { setMeta, q, getMeta, tx, db } = require('../db');
const { sseClients } = require('../live/stream');
const { strictUntil } = require('../limits');
const { withLock, sha, validLatLng } = require('../util');

async function adminRoutes(req, res, url, pathname) {
  // ---- Admin : gestion des orgas ----
  if (pathname.startsWith('/api/admin/')) {
    if (!ADMIN_KEY) return send(res, 404, { error: 'Admin désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
    if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
    if (req.method === 'GET' && pathname === '/api/admin/orgas') {
      return send(res, 200, {
        orgas: (() => { const list = readOrgas(); return list.map(o => ({ id: o.id, label: o.label, created: o.created, trial: o.trial === true, source: 'page',
          active: !!o.hash, invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, devices: o.hash ? 1 + (o.keys || []).length : 0,
          by: o.by || null, byLabel: o.by ? (list.find(x => x.id === o.by)?.label || o.byLabel || 'orga supprimée') : null, sponsored: o.sponsored === true,
          children: list.filter(x => x.by === o.id).length, ban: banUntil(o.id), clash: !!labelClash(o.label, { except: o.id }), ...(o.sponsored && o.trial ? { readiness: orgaReady(o) } : {}), ...orgaStats(o.id) })); })()
          .concat(ORGAS.map(o => ({ id: null, label: o.label, created: null, trial: false, source: 'variable', ...orgaStats('env:' + o.label) }))),
      });
    }
    if (req.method === 'POST' && pathname === '/api/admin/orgas') {
      const b = await readJson(req);
      const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
      if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga (il sera affiché sur ses annonces).' });
      // Invitation à usage unique (24 h) : la clé n'est créée que sur le téléphone de l'orga, au moment où elle scanne le QR code.
      const token = crypto.randomBytes(18).toString('base64url');
      const out = withLock(() => {
        const list = readOrgas().slice();
        if (labelClash(label)) return null;
        const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, invite: { h: sha(token), exp: Date.now() + INVITE_MS } };
        list.push(o); writeOrgas(list); return o;
      });
      if (!out) return send(res, 409, { error: labelClash(label) || 'Une orga porte déjà ce nom.' });
      orgaLog({ id: 'admin', label: adminLabel() }, 'invitation', { ref: out.id, detail: out.label });
      return send(res, 201, { id: out.id, label: out.label, created: out.created, invite: token, exp: out.invite.exp });
    }
    // Révocation pour abus : l'orga et toutes celles qu'elle a fait entrer ; sa marraine perd le droit d'inviter 30 jours
    const revoke = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/revoke$/);
    if (req.method === 'POST' && revoke) {
      const out = withLock(() => {
        const list = readOrgas(), root = list.find(x => x.id === revoke[1]);
        if (!root) return null;
        const ids = [root.id, ...descendants(list, root.id)];
        writeOrgas(list.filter(x => !ids.includes(x.id)));
        return { root, removed: list.filter(x => ids.includes(x.id)).map(x => x.label) };
      });
      if (!out) return send(res, 404, { error: 'Orga introuvable.' });
      if (out.root.by) setMeta('ban:' + out.root.by, Date.now() + SPONSOR.banMs);
      orgaLog({ id: 'admin', label: adminLabel() }, 'révoquée pour abus', { ref: out.root.id, detail: out.removed.join(', ') + (out.root.by ? ' · marraine privée d’invitations 30 j' : '') });
      return send(res, 200, { removed: out.removed, sponsorBanned: !!out.root.by });
    }
    // Nouvelle invitation pour une orga existante : l'ancienne clé est révoquée immédiatement
    const reinv = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/invite$/);
    if (req.method === 'POST' && reinv) {
      const token = crypto.randomBytes(18).toString('base64url');
      const o = withLock(() => {
        const list = readOrgas().slice(), i = list.findIndex(x => x.id === reinv[1]);
        if (i < 0) return null;
        list[i] = { ...list[i], hash: null, keys: [], devInv: undefined, invite: { h: sha(token), exp: Date.now() + INVITE_MS } }; writeOrgas(list); return list[i];
      });
      if (!o) return send(res, 404, { error: 'Orga introuvable.' });
      orgaLog({ id: 'admin', label: adminLabel() }, 'nouvelle invitation (ancienne clé révoquée)', { ref: o.id, detail: o.label });
      return send(res, 200, { id: o.id, label: o.label, invite: token, exp: o.invite.exp });
    }
    // --- Urgences : liste, suppression, purge, pause ---
    if (req.method === 'GET' && pathname === '/api/admin/reports') {
      const now = Date.now();
      return send(res, 200, { paused: pausedUntil(now),
        reports: activeReports(now).map(publicView),
        announcements: annAll(now).sort((a, b) => b.t - a.t).map(annView),
        pending: annAll(now).filter(a => a.pending).length, legalAlerts: legalAlerts(), orgaRequests: orgaRequests().length, ordersPending: q("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n,
        pushSubs: pushCount(), moderation: modQueue(now).filter(x => !x.low).length, toPublish: mobsToPublish(now) });
    }
    // --- Réglages modifiables (bandeau, vue d'ouverture, catégories, seuils) ---
    if (req.method === 'GET' && pathname === '/api/admin/settings')
      return send(res, 200, { settings: settings(), defaults: { event: EVENT_NAME, center: CENTER, zoom: ZOOM, alertRadius: 300, nearKm: 10, ttl: BASE_TTL },
        categories: CATEGORIES.map(c => ({ id: c.id, label: c.label, glyph: c.glyph, group: c.group, ttl: c.ttl, base: BASE_TTL[c.id], off: !!c.off })) });
    if (req.method === 'POST' && pathname === '/api/admin/settings') {
      const s = cleanSettings(await readJson(req, 8192));
      saveSettings(s);
      orgaLog({ id: 'admin', label: adminLabel() }, 'réglages modifiés');
      return send(res, 200, { settings: s });
    }
    // --- Journées de mobilisation prévues ---
    if (req.method === 'GET' && pathname === '/api/admin/mobs')
      return send(res, 200, { list: mobsAll().sort((a, b) => a.date.localeCompare(b.date)).map(m => ({ ...m, eveSent: !!getMeta('mob:eve:' + m.id), strictSet: !!getMeta('mob:strict:' + m.id), published: !!getPub(m.date) })),
        toPublish: mobsToPublish(), today: parisDay(Date.now()) });
    const mobR = pathname.match(/^\/api\/admin\/mobs(?:\/([\w-]{1,16}))?$/);
    if (mobR && req.method === 'POST') {
      const b = await readJson(req, 4096), list = mobsAll(), i = mobR[1] ? list.findIndex(m => m.id === mobR[1]) : -1;
      if (mobR[1] && i < 0) return send(res, 404, { error: 'Journée introuvable.' });
      const m = cleanMob(b, i >= 0 ? list[i] : {});
      if (m.error) return send(res, 400, m);
      if (i < 0 && m.date < parisDay(Date.now())) return send(res, 400, { error: 'Cette date est passée.' });
      if (list.some((x, j) => j !== i && x.date === m.date)) return send(res, 409, { error: 'Une journée est déjà prévue ce jour-là.' });
      if (i >= 0) list[i] = m; else list.push(m);
      setMeta('mobs', JSON.stringify(list)); dirty.global = true; scheduleFlush();
      orgaLog({ id: 'admin', label: adminLabel() }, i >= 0 ? 'journée modifiée' : 'journée prévue', { detail: m.date + ' ' + m.title });
      return send(res, i >= 0 ? 200 : 201, m);
    }
    if (mobR && mobR[1] && req.method === 'DELETE') {
      const list = mobsAll(), next = list.filter(m => m.id !== mobR[1]);
      if (next.length === list.length) return send(res, 404, { error: 'Journée introuvable.' });
      setMeta('mobs', JSON.stringify(next)); dirty.global = true; scheduleFlush();
      return send(res, 200, { removed: true });
    }
    // --- Tableau de bord en direct ---
    if (req.method === 'GET' && pathname === '/api/admin/live') {
      const now = Date.now(), perMin = Array(15).fill(0);
      for (const x of q('SELECT t FROM reports WHERE t>?').all(now - 15 * MIN)) { const i = Math.floor((now - x.t) / MIN); if (i >= 0 && i < 15) perMin[14 - i]++; }
      let disk = null, mem = null;
      try { const st = fs.statfsSync(DATA_DIR); disk = { free: Math.round(st.bavail / st.blocks * 100), gb: Math.round(st.bavail * st.bsize / 1e9 * 10) / 10 }; } catch {}
      try { const m = fs.readFileSync('/proc/meminfo', 'utf8'), g = k => +(m.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1];
        mem = { free: Math.round(g('MemAvailable') / g('MemTotal') * 100), mb: Math.round(g('MemAvailable') / 1024) }; } catch {}
      const subs = q('SELECT COUNT(*) n, SUM(urg=1) urg, SUM(near=1) near FROM push').get();
      return send(res, 200, { now, perMin, active: q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(now).n,
        contested: q('SELECT COUNT(*) n FROM reports WHERE exp>? AND (ct>0 OR fl=-1)').get(now).n,
        streams: sseClients.size, strict: strictUntil(now), paused: pausedUntil(now), mob: mobToday(now),
        push: { subs: subs.n, urg: subs.urg || 0, near: subs.near || 0, queue: pushQueue.hi.length + pushQueue.lo.length, running: pushRunningNow(),
          since: PSTATS.since, sent: PSTATS.sent, ok: PSTATS.ok, gone: PSTATS.gone, fail: PSTATS.fail, codes: PSTATS.codes, batches: PSTATS.batches.slice(0, 8), lastErr: PSTATS.lastErr || null },
        sys: { disk, mem, load: os.loadavg().map(x => Math.round(x * 100) / 100), cpus: os.cpus().length, uptime: Math.round(process.uptime()), rss: Math.round(process.memoryUsage().rss / 1e6) },
        load: loadStats(), crash: (() => { try { return JSON.parse(getMeta('crash') || 'null'); } catch { return null; } })(), up: Math.round(process.uptime()), version: APP_VERSION });
    }
    // --- File de modération : points contestés ou non fiables ---
    if (req.method === 'GET' && pathname === '/api/admin/moderation') {
      const now = Date.now();
      return send(res, 200, { list: modQueue(now) });
    }
    const modR = pathname.match(/^\/api\/admin\/reports\/([\w-]{1,16})\/(keep|verify)$/);
    if (modR && req.method === 'POST') {
      const out = tx(() => {
        const r = getReport(modR[1], Date.now());
        if (!r) return [404, { error: 'Signalement expiré.' }];
        r.down = 0; r.downIps = []; r.dw = 0; r.ct = 0; if (r.fl === -1) r.fl = 0;
        if (modR[2] === 'verify') { if (!r.ver) repAdd(r.voters[0], 'good', 2); r.ver = adminLabel(); }
        saveReport(r); orgaLog({ id: 'admin', label: adminLabel() }, modR[2] === 'verify' ? 'vérifié (modération)' : 'gardé (modération)', { r });
        return [200, publicView(r)];
      });
      return send(res, ...out);
    }
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
    // --- Annonces de l'admin (nationales ou locales) ---
    if (req.method === 'POST' && pathname === '/api/admin/announcements') {
      const b = await readJson(req);
      return send(res, ...createAnnouncement(b, adminLabel(), true));
    }
    const delA = pathname.match(/^\/api\/admin\/announcements\/([\w-]{1,16})$/);
    if (req.method === 'DELETE' && delA) {
      const ok = dropAnn(delA[1]);
      return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Annonce déjà retirée.' });
    }
    // --- Pages publiques par manif ---
    const pubA = pathname.match(/^\/api\/admin\/publish\/(\d{4}-\d{2}-\d{2})$/);
    if (pubA && req.method === 'POST') {
      const snap = pubSnapshot(pubA[1]);
      if (!snap) return send(res, 404, { error: 'Aucun signalement ce jour-là.' });
      q('INSERT OR REPLACE INTO pub(date,t,data) VALUES(?,?,?)').run(pubA[1], Date.now(), JSON.stringify(snap)); cityIdx.at = 0;
      return send(res, 200, { url: '/manif/' + pubA[1], total: snap.total });
    }
    if (pubA && req.method === 'DELETE') { q('DELETE FROM pub WHERE date=?').run(pubA[1]); return send(res, 200, { removed: true }); }
    // --- Demandes d'accès orga ---
    if (req.method === 'GET' && pathname === '/api/admin/orga-requests') return send(res, 200, { list: orgaRequests() });
    const oreq = pathname.match(/^\/api\/admin\/orga-requests\/([\w-]{1,16})$/);
    if (oreq && req.method === 'DELETE') {
      const n = q('DELETE FROM orga_req WHERE id=?').run(oreq[1]).changes;
      return n ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Demande déjà traitée.' });
    }
    // --- Annuaire des legal teams ---
    if (req.method === 'GET' && pathname === '/api/admin/legal') {
      return send(res, 200, { lastWatch: +getMeta('legalwatch') || null,
        list: legalAll().map(e => ({ ...legalView(e), ok: !!e.ok, srcDate: e.srcDate || null, seed: !!e.seed, status: watchStatus(e),
          watch: e.watch ? { at: e.watch.at, err: e.watch.err || null, found: !!e.watch.found, phones: e.watch.phones || [] } : null, base: e.base || null })) });
    }
    if (req.method === 'POST' && pathname === '/api/admin/legal') {
      const b = await readJson(req);
      const old = b.id ? getLegal(String(b.id)) : null;
      if (b.id && !old) return send(res, 404, { error: 'Ligne introuvable.' });
      const [st, e] = cleanLegal(b, old || { id: crypto.randomBytes(5).toString('base64url'), ok: false, added: Date.now() });
      if (st !== 200) return send(res, st, { error: e });
      // Numéro ou source modifiés : la ligne doit être revalidée et la référence de la veille est refaite
      if (old && (phoneDigits(old.phone) !== phoneDigits(e.phone) || old.src !== e.src)) { e.ok = false; delete e.base; delete e.watch; }
      saveLegal(e); orgaLog({ id: 'admin', label: adminLabel() }, old ? 'annuaire modifié' : 'annuaire ajouté', { ref: e.id, detail: e.city + ' ' + e.phone });
      return send(res, 200, legalView(e));
    }
    const legalAct = pathname.match(/^\/api\/admin\/legal\/([\w-]{1,16})(?:\/(validate|unvalidate|ack))?$/);
    if (legalAct && req.method === 'DELETE' && !legalAct[2]) {
      const e = getLegal(legalAct[1]); if (!e) return send(res, 404, { error: 'Ligne introuvable.' });
      q('DELETE FROM legal_dir WHERE id=?').run(e.id); dirty.legal = true; scheduleFlush();
      orgaLog({ id: 'admin', label: adminLabel() }, 'annuaire retiré', { ref: e.id, detail: e.city + ' ' + e.phone });
      return send(res, 200, { removed: true });
    }
    if (legalAct && req.method === 'POST' && legalAct[2]) {
      const e = getLegal(legalAct[1]); if (!e) return send(res, 404, { error: 'Ligne introuvable.' });
      if (legalAct[2] === 'validate') { e.ok = true; e.checked = Date.now(); delete e.seed; }
      if (legalAct[2] === 'unvalidate') e.ok = false;
      // « Vu » : la page source a changé mais le numéro est toujours bon → nouvelle référence
      if (legalAct[2] === 'ack') { if (e.watch && e.watch.phones) e.base = e.watch.phones; e.checked = Date.now(); }
      saveLegal(e); orgaLog({ id: 'admin', label: adminLabel() }, 'annuaire ' + { validate: 'validé', unvalidate: 'dépublié', ack: 'source revue' }[legalAct[2]], { ref: e.id, detail: e.city + ' ' + e.phone });
      return send(res, 200, legalView(e));
    }
    if (req.method === 'POST' && pathname === '/api/admin/legal-watch') {
      await legalWatch(true);
      return send(res, 200, { done: true });
    }
    // --- Arrêtés : propositions à valider, publiés, import d'un bloc préparé ---
    if (req.method === 'GET' && pathname === '/api/admin/orders') return send(res, 200, { orders: ordersAll().map(orderView), kinds: ORDER_KINDS, deps: DEPS.map(d => [d.c, d.n]) });
    if (req.method === 'POST' && pathname === '/api/admin/orders') {
      const out = await createOrder(await readJson(req, 16384), { admin: true });
      if (out[0] < 300) orgaLog({ id: 'admin', label: adminLabel() }, 'arrêté publié', { ref: out[1].id, detail: out[1].zone && out[1].zone.name });
      return send(res, ...out);
    }
    if (req.method === 'POST' && pathname === '/api/admin/orders/import') {
      const b = await readJson(req, 65536);
      let list; try { list = JSON.parse(String(b.text || '')); } catch { return send(res, 400, { error: 'Bloc illisible : colle-le en entier, du premier [ au dernier ].' }); }
      if (list && !Array.isArray(list)) list = list.arretes || list.orders || [list];
      if (!Array.isArray(list) || !list.length || list.length > 30) return send(res, 400, { error: 'Le bloc doit contenir entre 1 et 30 arrêtés.' });
      const results = [];
      for (const x of list) { const [st, out] = await createOrder(x || {}, { admin: true }); results.push(st < 300 ? { ok: true, name: out.zone.name, id: out.id } : { ok: false, error: out.error, name: (x && (x.commune || x.departement || x.dep)) || '?' }); }
      orgaLog({ id: 'admin', label: adminLabel() }, 'arrêtés importés', { detail: `${results.filter(r => r.ok).length} / ${results.length}` });
      return send(res, 200, { results });
    }
    const ordAct = pathname.match(/^\/api\/admin\/orders\/([\w-]{1,16})(\/approve)?$/);
    if (ordAct && req.method === 'POST' && ordAct[2]) return send(res, ...await approveOrder(ordAct[1]));
    if (ordAct && req.method === 'DELETE' && !ordAct[2]) return dropOrder(ordAct[1]) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Introuvable.' });
    // --- Agenda : propositions à valider + événements publiés ---
    if (req.method === 'GET' && pathname === '/api/admin/events') {
      return send(res, 200, { events: listEvents().map(evView) });
    }
    const evAct = pathname.match(/^\/api\/admin\/events\/([\w-]{1,16})(\/approve)?$/);
    if (evAct && (req.method === 'DELETE' || (req.method === 'POST' && evAct[2]))) {
      const ok = tx(() => {
        const e = getEvent(evAct[1]); if (!e) return false;
        if (req.method === 'DELETE') {
          // un événement importé retiré par l'admin ne revient pas au prochain import
          if (e.src) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(e.id, e.start + EVENT_KEEP);
          dropEvent(e.id);
        } else { e.status = 'ok'; delete e.dev; saveEvent(e); }
        return true;
      });
      return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Événement introuvable.' });
    }
    const delRep = pathname.match(/^\/api\/admin\/reports\/([\w-]{1,16})$/);
    if (req.method === 'DELETE' && delRep) {
      const ok = tx(() => { const r = getReport(delRep[1], Date.now()); if (!r) return false;
        const admin = { id: 'admin', label: adminLabel() }; trashReport(r, admin); orgaLog(admin, 'retiré', { r }); return true; });
      return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Déjà expiré.' });
    }
    if (req.method === 'POST' && pathname === '/api/admin/purge') {
      const b = await readJson(req);
      const list = tx(() => {
        const list = q('DELETE FROM reports RETURNING *').all();
        if (b.announcements) q('DELETE FROM ann').run();
        return list;
      });
      list.forEach(r => archive(r, 'purge'));
      rebuildAll();
      const n = list.length;
      return send(res, 200, { removed: n });
    }
    // Effacement d'urgence : toutes les traces liées aux personnes, d'un coup (signalements, journal, corbeille,
    // empreintes, abonnements aux notifications, archive du digest), et nouvelle clé de hachage.
    // On garde : les orgas, l'agenda public (sans empreinte), les réglages.
    if (req.method === 'POST' && pathname === '/api/admin/wipe') {
      const b = await readJson(req);
      if (b.confirm !== 'EFFACER') return send(res, 400, { error: 'Tape EFFACER pour confirmer.' });
      const n = tx(() => {
        const n = q('DELETE FROM reports').run().changes;
        for (const t of ['ann', 'orga_log', 'trash', 'devices', 'rate', 'quota', 'hidden', 'push', 'abuse', 'orga_req']) q('DELETE FROM ' + t).run();
        for (const e of listEvents()) if (e.dev) { delete e.dev; saveEvent(e); }
        q("UPDATE events SET dev=NULL").run();
        // Arrêtés proposés par des participant·es : l'empreinte du téléphone disparaît aussi (colonne et données)
        for (const x of q('SELECT id, data FROM orders').all()) { const o = JSON.parse(x.data); if ('dev' in o) { delete o.dev; q('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o), x.id); } }
        q('UPDATE orders SET dev=NULL').run();
        // Bilans publics : seulement si l'admin le demande (ils ne contiennent que des totaux et des points arrondis)
        if (b.pub === true) q('DELETE FROM pub').run();
        return n;
      });
      // Archive du digest : chaque fichier séparément (un fichier qui résiste n'empêche pas d'effacer les autres)
      const left = [];
      try { for (const f of fs.readdirSync(ARCHIVE_DIR)) try { fs.unlinkSync(path.join(ARCHIVE_DIR, f)); } catch { left.push(f); } } catch {}
      const rotated = (() => { try { return rotateSecret(); } catch { return false; } })();
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
      rebuildAll();
      console.log('effacement d’urgence effectué' + (left.length ? ` (${left.length} fichier(s) d’archive non effacé(s))` : ''));
      return send(res, left.length ? 500 : 200, { removed: n, rotated, pub: b.pub === true, left: left.length, ...(left.length ? { error: `${left.length} fichier(s) de l’archive n’ont pas pu être effacés : vérifie les droits du dossier.` } : {}) });
    }
    // --- Tableau des abus (24 h) et mode manif renforcé ---
    if (req.method === 'GET' && pathname === '/api/admin/abuse') {
      const now = Date.now(), since = now - 24 * 60 * MIN;
      const rows = q('SELECT t, kind, lat, lng FROM abuse WHERE t>? ORDER BY t').all(since);
      const kinds = {}, hours = {}, zones = new Map();
      for (const x of rows) {
        kinds[x.kind] = (kinds[x.kind] || 0) + 1;
        const h = Math.floor((now - x.t) / (60 * MIN)); // 0 = dernière heure
        (hours[x.kind] ||= Array(24).fill(0))[Math.min(23, h)]++;
        if (x.lat != null) {
          const k = (Math.round(x.lat * 20) / 20).toFixed(2) + ',' + (Math.round(x.lng * 20) / 20).toFixed(2); // ≈ 5 km
          const z = zones.get(k) || { lat: +k.split(',')[0], lng: +k.split(',')[1], n: 0, kinds: {} };
          z.n++; z.kinds[x.kind] = (z.kinds[x.kind] || 0) + 1; zones.set(k, z);
        }
      }
      const top = [...zones.values()].sort((a, b) => b.n - a.n).slice(0, 10);
      for (const z of top) z.name = placeOf(z.lat, z.lng);
      return send(res, 200, { kinds, hours, zones: top, strict: strictUntil(now), paused: pausedUntil(now),
        trusted: q('SELECT COUNT(*) n FROM devices WHERE COALESCE(good,0) - 2 * COALESCE(bad,0) >= ?').get(TRUST).n,
        unreliable: q('SELECT COUNT(*) n FROM reports WHERE fl=-1 AND up=0 AND exp>?').get(now).n });
    }
    if (req.method === 'POST' && pathname === '/api/admin/strict') {
      const b = await readJson(req);
      const minutes = Math.min(Math.max(Number(b.minutes) || 0, 0), 24 * 60);
      const until = minutes ? Date.now() + minutes * MIN : 0;
      setMeta('strict', until);
      orgaLog({ id: 'admin', label: adminLabel() }, until ? 'mode manif renforcé' : 'fin du mode renforcé', { detail: until ? minutes + ' min' : null });
      return send(res, 200, { strict: until });
    }
    if (req.method === 'POST' && pathname === '/api/admin/pause') {
      const b = await readJson(req);
      const minutes = Math.min(Math.max(Number(b.minutes) || 0, 0), 24 * 60);
      const until = minutes ? Date.now() + minutes * MIN : 0;
      setMeta('paused', until); dirty.global = true; scheduleFlush(0);
      return send(res, 200, { paused: until });
    }
  
    const promo = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})\/trial$/);
    if (req.method === 'POST' && promo) {
      const b = await readJson(req);
      const o = withLock(() => {
        const list = readOrgas().slice(); const i = list.findIndex(x => x.id === promo[1]);
        if (i < 0) return null; list[i] = { ...list[i], trial: !!b.trial }; writeOrgas(list); return list[i];
      });
      if (!o) return send(res, 404, { error: 'Orga introuvable.' });
      orgaLog({ id: 'admin', label: adminLabel() }, o.trial ? 'essai' : 'confirmée', { ref: o.id, detail: o.label });
      return send(res, 200, { id: o.id, trial: o.trial });
    }
    // --- Journal des orgas et corbeille ---
    if (req.method === 'GET' && pathname === '/api/admin/journal') {
      const rows = q('SELECT * FROM orga_log ORDER BY t DESC LIMIT 300').all();
      const trash = q('SELECT id, t, orga, data FROM trash WHERE t>? ORDER BY t DESC').all(Date.now() - TRASH_MS)
        .map(x => { const r = JSON.parse(x.data); return { id: x.id, t: x.t, orga: x.orga, cat: r.cat, lat: r.lat, lng: r.lng, up: r.up, note: r.note }; });
      return send(res, 200, { log: rows, trash });
    }
    const rest = pathname.match(/^\/api\/admin\/trash\/([\w-]{1,16})\/restore$/);
    if (req.method === 'POST' && rest) {
      const out = tx(() => {
        const x = q('SELECT * FROM trash WHERE id=?').get(rest[1]);
        if (!x) return [404, { error: 'Plus dans la corbeille.' }];
        const r = JSON.parse(x.data), now = Date.now();
        r.exp = now + Math.max(5 * MIN, r.left || 0); // il retrouve le temps qu'il lui restait
        delete r.left; delete r.cell;
        if (x.oid === VOTES.id) { r.down = 0; r.dw = 0; r.ct = 0; r.downIps = []; } // contestation annulée
        saveReport(r); q('DELETE FROM trash WHERE id=?').run(x.id);
        orgaLog({ id: 'admin', label: adminLabel() }, 'restauré', { r, detail: 'retiré par ' + x.orga });
        return [200, publicView(r)];
      });
      return send(res, ...out);
    }
    const annOk = pathname.match(/^\/api\/admin\/announcements\/([\w-]{1,16})\/approve$/);
    if (req.method === 'POST' && annOk) {
      const a = getAnn(annOk[1]);
      if (!a) return send(res, 404, { error: 'Annonce introuvable.' });
      delete a.pending; saveAnn(a);
      orgaLog({ id: 'admin', label: adminLabel() }, 'annonce validée', { ref: a.id, detail: a.by + ' · ' + (a.phone || a.text) });
      return send(res, 200, annView(a));
    }
  
    const del = pathname.match(/^\/api\/admin\/orgas\/([\w-]{1,16})$/);
    if (req.method === 'DELETE' && del) {
      const ok = withLock(() => {
        const list = readOrgas(); const next = list.filter(o => o.id !== del[1]);
        if (next.length === list.length) return false; writeOrgas(next); return true;
      });
      return ok ? send(res, 200, { removed: true }) : send(res, 404, { error: 'Orga introuvable.' });
    }
    return send(res, 404, { error: 'Inconnu.' });
  }
  return NEXT;
}

module.exports = { adminRoutes };
