'use strict';
// Routes de l'admin pour la modération : signalements, tableau de bord en direct, file de modération, purge et effacement
// d'urgence, abus, mode renforcé, pause, journal des orgas et corbeille.
// Appelées par routes/admin.js, après la vérification de la clé admin.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MIN, DATA_DIR } = require('../config');
const { APP_VERSION } = require('../http/version');
const { NEXT } = require('./next');
const { activeReports, getReport, saveReport } = require('../reports/store');
const { adminLabel, pausedUntil, mobToday } = require('../settings');
const { annAll, annView } = require('../announcements/store');
const { dirty, scheduleFlush } = require('../live/files');
const { legalAlerts } = require('../legal');
const { listEvents, saveEvent } = require('../events/store');
const { loadStats } = require('../http/saturation');
const { mobsToPublish } = require('../mobs');
const { modQueue } = require('../moderation');
const { orgaRequests } = require('../orgas/requests');
const { orgaLog, trashReport, TRASH_MS } = require('../orgas/log');
const { archive, ARCHIVE_DIR } = require('../digest/archive');
const { placeOf } = require('../geo/cities');
const { publicView, authorOf } = require('../reports/model');
const { pushCount, pushQueue, pushRunningNow, PSTATS } = require('../push');
const { rebuildAll } = require('../live/publish');
const { repAdd, TRUST, VOTES } = require('../reports/votes');
const { rotateSecret } = require('../privacy');
const { send, readJson } = require('../http/respond');
const { setMeta, q, getMeta, tx, db } = require('../db');
const { sseClients } = require('../live/stream');
const { strictUntil } = require('../limits');

async function adminModerationRoutes(req, res, url, pathname) {
  // --- Urgences : liste, suppression, purge, pause ---
  if (req.method === 'GET' && pathname === '/api/admin/reports') {
    const now = Date.now();
    return send(res, 200, { paused: pausedUntil(now),
      reports: activeReports(now).map(publicView),
      announcements: annAll(now).sort((a, b) => b.t - a.t).map(annView),
      pending: annAll(now).filter(a => a.pending).length, legalAlerts: legalAlerts(), orgaRequests: orgaRequests().length, ordersPending: q("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n,
      pushSubs: pushCount(), moderation: modQueue(now).filter(x => !x.low).length, photos: require('../photos').reviewPhotos(getReport, now).length, toPublish: mobsToPublish(now) });
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
      if (modR[2] === 'verify') { if (!r.ver) repAdd(authorOf(r), 'good', 2); r.ver = adminLabel(); }
      saveReport(r); orgaLog({ id: 'admin', label: adminLabel() }, modR[2] === 'verify' ? 'vérifié (modération)' : 'gardé (modération)', { r });
      return [200, publicView(r)];
    });
    return send(res, ...out);
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
      for (const t of ['ann', 'orga_log', 'trash', 'devices', 'rate', 'quota', 'hidden', 'push', 'orga_push', 'abuse', 'orga_req']) q('DELETE FROM ' + t).run();
      for (const e of listEvents()) if (e.dev || e.net) { delete e.dev; delete e.net; saveEvent(e); }
      q("UPDATE events SET dev=NULL").run();
      // Arrêtés proposés par des participant·es : l'empreinte du téléphone disparaît aussi (colonne et données)
      for (const x of q('SELECT id, data FROM orders').all()) { const o = JSON.parse(x.data); if ('dev' in o || 'net' in o) { delete o.dev; delete o.net; q('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o), x.id); } }
      q('UPDATE orders SET dev=NULL').run();
      // Bilans publics : seulement si l'admin le demande (ils ne contiennent que des totaux et des points arrondis)
      if (b.pub === true) q('DELETE FROM pub').run();
      return n;
    });
    // Archive du digest : chaque fichier séparément (un fichier qui résiste n'empêche pas d'effacer les autres)
    const left = [];
    try { for (const f of fs.readdirSync(ARCHIVE_DIR)) try { fs.unlinkSync(path.join(ARCHIVE_DIR, f)); } catch { left.push(f); } } catch {}
    // Anciens fichiers des versions d'avant SQLite (state.json, push.json et leurs copies « .repris-… »)
    try { for (const f of fs.readdirSync(DATA_DIR)) if (/^(state|push)\.json(\.repris-\d+)?$/.test(f)) try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch { left.push(f); } } catch {}
    const rotated = (() => { try { return rotateSecret(); } catch { return false; } })();
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    rebuildAll();
    try { require('../medic').wipe(); } catch {} // couche medic (en mémoire) : oubliée aussi
    try { require('../photos').wipePhotos(b.pub === true); } catch (e) { left.push('photos'); console.error('photos', e.message); } // celles des bilans seulement avec eux
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
  // --- Journal des orgas et corbeille ---
  // Journal complet : filtre par orga (o = identifiant, ou « label:Nom » pour un accès défini dans les variables),
  // pages de 300 lignes en remontant le temps (before = date de la dernière ligne reçue), ou tout en CSV
  if (req.method === 'GET' && (pathname === '/api/admin/journal' || pathname === '/api/admin/journal.csv')) {
    const o = url.searchParams.get('o') || '', before = Number(url.searchParams.get('before')) || 8.64e15;
    const where = o.startsWith('label:') ? 'orga=?' : o ? 'oid=?' : '1=1', args = o ? [o.startsWith('label:') ? o.slice(6) : o] : [];
    if (pathname.endsWith('.csv')) {
      const esc = v => { let x = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return /[",;\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      const all = q(`SELECT * FROM orga_log WHERE ${where} ORDER BY t`).all(...args);
      const lines = ['date;orga;action;type;latitude;longitude;reference;detail', ...all.map(x => [new Date(x.t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }), x.orga, x.action, x.cat, x.lat, x.lng, x.ref, x.detail].map(esc).join(';'))];
      return send(res, 200, '\ufeff' + lines.join('\n') + '\n', { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="journal-orgas${o ? '-' + (o.replace(/^label:/, '').replace(/[^\w-]/g, '_').slice(0, 40)) : ''}.csv"` });
    }
    const rows = q(`SELECT * FROM orga_log WHERE ${where} AND t<? ORDER BY t DESC LIMIT 300`).all(...args, before);
    const orgaList = q("SELECT oid, orga, COUNT(*) n, MAX(t) last FROM orga_log WHERE oid IS NOT 'votes' GROUP BY COALESCE(oid, orga) ORDER BY orga").all();
    if (before < 8.64e15) return send(res, 200, { log: rows, more: rows.length === 300 });
    const trash = q('SELECT id, t, orga, data FROM trash WHERE t>? ORDER BY t DESC').all(Date.now() - TRASH_MS)
      .map(x => { const r = JSON.parse(x.data); return { id: x.id, t: x.t, orga: x.orga, cat: r.cat, lat: r.lat, lng: r.lng, up: r.up, note: r.note }; });
    return send(res, 200, { log: rows, trash, more: rows.length === 300, orgas: orgaList.map(x => ({ o: x.oid || 'label:' + x.orga, label: x.orga, n: x.n, last: x.last })) });
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
  return NEXT;
}

module.exports = { adminModerationRoutes };
