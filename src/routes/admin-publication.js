'use strict';
// Routes de l'admin pour ce qui est publié : réglages, journées de mobilisation, annonces, bilans publics, annuaire des
// legal teams, arrêtés, agenda.
// Appelées par routes/admin.js, après la vérification de la clé admin.
const crypto = require('crypto');
const { CENTER, ZOOM } = require('../config');
const { instance } = require('../instance');
const { activeCategories } = require('../profiles');
const { BASE_TTL } = require('../categories');
const { DEPS } = require('../geo/departments');
const { NEXT } = require('./next');
const { adminLabel, settings, cleanSettings, saveSettings, mobsAll } = require('../settings');
const { annView, dropAnn, getAnn, saveAnn } = require('../announcements/store');
const { cityIdx } = require('../pages/city-cache');
const { createAnnouncement } = require('../announcements/create');
const { dirty, scheduleFlush } = require('../live/files');
const { getPub, pubSnapshot } = require('../digest/pub');
const { legalAll, legalView, watchStatus, getLegal, cleanLegal, phoneDigits, saveLegal, legalWatch } = require('../legal');
const { listEvents, evView, getEvent, EVENT_KEEP, dropEvent, saveEvent } = require('../events/store');
const { mobsToPublish, cleanMob } = require('../mobs');
const { ordersAll, orderView, ORDER_KINDS, createOrder, approveOrder, dropOrder } = require('../orders');
const { orgaLog } = require('../orgas/log');
const { feedTick, feedState, feedCfg, EVERY_DEF, DAYS_DEF } = require('../events/import');
const { send, readJson } = require('../http/respond');
const { setMeta, q, getMeta, tx } = require('../db');
const { parisDay } = require('../time');

async function adminPublicationRoutes(req, res, url, pathname) {
  // --- Réglages modifiables (bandeau, vue d'ouverture, catégories, seuils) ---
  if (req.method === 'GET' && pathname === '/api/admin/settings')
    return send(res, 200, { settings: settings(), feed: feedState(),
      defaults: { event: instance().event, center: CENTER, zoom: ZOOM, alertRadius: 300, nearKm: 10, ttl: BASE_TTL, feedEvery: EVERY_DEF, feedDays: DAYS_DEF },
      categories: activeCategories().map(c => ({ id: c.id, label: c.label, glyph: c.glyph, group: c.group, ttl: c.ttl, base: BASE_TTL[c.id], off: !!c.off })) });
  // --- Agenda d'un site partenaire : lecture à la demande (le reste du temps, la boucle de ménage s'en charge) ---
  if (req.method === 'POST' && pathname === '/api/admin/feed') {
    if (!feedCfg()) return send(res, 400, { error: 'Aucune adresse de site partenaire réglée, ou import coupé.' });
    await feedTick(Date.now(), true);
    const st = feedState();
    orgaLog({ id: 'admin', label: adminLabel() }, 'agenda partenaire relu', { detail: st.last && st.last.ok ? `${st.last.added} ajouté(s), ${st.last.gone} retiré(s)` : (st.last && st.last.error) || '' });
    return send(res, 200, { feed: st });
  }
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
    // Bilan publié : message sur Bluesky et Mastodon (une seule fois par date, même si le bilan est republié)
    try { require('../social').onPub(pubA[1], snap); } catch (e) { console.error('réseaux (bilan)', e.message); }
    return send(res, 200, { url: '/manif/' + pubA[1], total: snap.total });
  }
  if (pubA && req.method === 'DELETE') { q('DELETE FROM pub WHERE date=?').run(pubA[1]); return send(res, 200, { removed: true }); }
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
  const annOk = pathname.match(/^\/api\/admin\/announcements\/([\w-]{1,16})\/approve$/);
  if (req.method === 'POST' && annOk) {
    const a = getAnn(annOk[1]);
    if (!a) return send(res, 404, { error: 'Annonce introuvable.' });
    delete a.pending; saveAnn(a);
    orgaLog({ id: 'admin', label: adminLabel() }, 'annonce validée', { ref: a.id, detail: a.by + ' · ' + (a.phone || a.text) });
    return send(res, 200, annView(a));
  }
  return NEXT;
}

module.exports = { adminPublicationRoutes };
