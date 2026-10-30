'use strict';
// Publication : écrit les fichiers live/ modifiés (cases, régions, vue nationale, annonces, agenda, arrêtés, legal teams).
const fs = require('fs');
const path = require('path');
const { CAT } = require('../categories');
const { EVENT_KEEP, evView } = require('../events/store');
const { LIVE_DIR, writeIfChanged, dirty, scheduleFlush, writeAtomic, pub, ALL_EVERY, regionOfCell, LIVE_LOCK, FLUSH_MS, setFlusher } = require('./files');
const { TILE_ZONES } = require('../geo/tiles');
const { activeReports } = require('../reports/store');
const { annActive, annView } = require('../announcements/store');
const { h8, withLock } = require('../util');
const { legalAll, legalView } = require('../legal');
const { ordersLive } = require('../orders');
const { pausedUntil, cfgHash } = require('../settings');
const { publicView } = require('../reports/model');
const { q, getMeta, setMeta, isBusy } = require('../db');
const { streamNotify } = require('./stream');
const { versionInfo } = require('../http/version');

// ---- Publication en fichiers statiques (voir src/live/files.js) ----
function writeRegion(rg) {
  const rows = q('SELECT cell, h FROM cells WHERE region=?').all(rg);
  const f = path.join(LIVE_DIR, 'r', rg + '.json');
  // Une région vide reste publiée (fichier vide) : sinon Apache ne trouve rien et chaque téléphone de la zone réveille Node.
  writeIfChanged(f, JSON.stringify({ c: Object.fromEntries(rows.map(x => [x.cell, x.h])) }));
  // Réseau faible : une seule requête pour tous les signalements de la région (≈ 100 km), compressée par Apache
  const [a, b] = rg.split('_').map(Number), now = Date.now();
  const pts = q('SELECT * FROM reports WHERE exp>? AND lat>=? AND lat<? AND lng>=? AND lng<? ORDER BY t DESC LIMIT 600').all(now, a, a + 1, b, b + 1).map(publicView);
  writeIfChanged(path.join(LIVE_DIR, 'p', rg + '.json'), JSON.stringify({ r: pts }));
}
// Vue nationale : par région d'environ 100 km, le nombre de signalements par famille et leur position moyenne
function writeNational(now) {
  const agg = new Map();
  for (const r of q('SELECT cat, lat, lng, t, last FROM reports WHERE exp>?').all(now)) {
    const k = `${Math.floor(r.lat)}_${Math.floor(r.lng)}`;
    let a = agg.get(k);
    if (!a) agg.set(k, (a = { k, la: 0, lo: 0, n: 0, g: {}, t: 0 }));
    const grp = Object.hasOwn(CAT, r.cat) ? CAT[r.cat].group : 'info';
    a.la += r.lat; a.lo += r.lng; a.n++; a.g[grp] = (a.g[grp] || 0) + 1; a.t = Math.max(a.t, r.last || r.t);
  }
  const r3 = x => Math.round(x * 1000) / 1000;
  writeIfChanged(path.join(LIVE_DIR, 'n.json'), JSON.stringify({ r: [...agg.values()].map(a => ({ k: a.k, lat: r3(a.la / a.n), lng: r3(a.lo / a.n), g: a.g, t: a.t })) }));
}
// Empreinte de la version servie, calculée au démarrage : après une mise à jour (fichiers + Restart),
// elle change et les téléphones se rechargent d'eux-mêmes.
let BUILD = null;
const buildId = () => BUILD || (BUILD = h8(JSON.stringify(versionInfo().files)));
function writeGlobal(now) {
  const g = { ann: getMeta('annh') || null, events: getMeta('evh') || null, legal: getMeta('legalh') || null, ord: getMeta('ordh') || null, paused: pausedUntil(now), build: buildId(), cfg: cfgHash(), pois: getMeta('poish') || null };
  writeIfChanged(path.join(LIVE_DIR, 'g.json'), JSON.stringify(g));
  // Ancien format, pour les téléphones pas encore mis à jour : réécrit au plus toutes les 5 s (il liste toutes les cases)
  if (now - (writeGlobal.last || 0) < 5000 && fs.existsSync(path.join(LIVE_DIR, 'index.json'))) { dirty.global = true; return scheduleFlush(5000 - (now - writeGlobal.last)); }
  writeGlobal.last = now;
  const cells = q('SELECT cell, h FROM cells').all();
  writeAtomic(path.join(LIVE_DIR, 'index.json'), JSON.stringify({ v: now, t: now, cells: Object.fromEntries(cells.map(x => [x.cell, x.h])),
    ann: g.ann, events: g.events, all: getMeta('allh') || null, paused: g.paused, build: g.build }));
}
function flush() {
  pub.timer = null;
  const now = Date.now();
  const cells = [...dirty.cells], doAnn = dirty.ann, doEv = dirty.events, doLegal = dirty.legal, doOrd = dirty.ord, doAll = dirty.all && now - pub.lastAll >= ALL_EVERY;
  const doGlobal = cells.length || doAnn || doEv || doLegal || doOrd || doAll || dirty.global;
  dirty.cells.clear(); dirty.ann = dirty.events = dirty.legal = dirty.ord = dirty.global = false; if (doAll) dirty.all = false;
  const changed = new Set();
  if (doGlobal) try {
    withLock(() => {
      const regions = changed;
      for (const c of cells) {
        const rows = q('SELECT * FROM reports WHERE cell=? AND exp>? ORDER BY t').all(c, now).map(publicView);
        const f = path.join(LIVE_DIR, 'c', c + '.json');
        if (rows.length) {
          const str = JSON.stringify({ r: rows });
          writeAtomic(f, str);
          q('INSERT OR REPLACE INTO cells(cell,region,h) VALUES(?,?,?)').run(c, regionOfCell(c), h8(str));
        } else { try { fs.unlinkSync(f); } catch {} q('DELETE FROM cells WHERE cell=?').run(c); }
        regions.add(regionOfCell(c));
      }
      for (const rg of regions) writeRegion(rg);
      if (doAnn) { const str = JSON.stringify({ a: annActive(now).map(annView) }); writeIfChanged(path.join(LIVE_DIR, 'ann.json'), str); setMeta('annh', h8(str)); }
      if (doOrd) { const str = JSON.stringify({ o: ordersLive(now) }); writeIfChanged(path.join(LIVE_DIR, 'ord.json'), str); setMeta('ordh', h8(str)); }
      if (doLegal) { const str = JSON.stringify({ l: legalAll().filter(e => e.ok).map(legalView) }); writeIfChanged(path.join(LIVE_DIR, 'legal.json'), str); setMeta('legalh', h8(str)); }
      if (doEv) {
        const str = JSON.stringify({ e: q("SELECT data FROM events WHERE status='ok' AND start>? ORDER BY start LIMIT 3000").all(now - EVENT_KEEP).map(x => evView(JSON.parse(x.data))) });
        writeIfChanged(path.join(LIVE_DIR, 'events.json'), str); setMeta('evh', h8(str));
      }
      if (doAll) { pub.lastAll = now; const str = JSON.stringify({ r: activeReports(now).map(publicView) }); writeIfChanged(path.join(LIVE_DIR, 'all.json'), str); setMeta('allh', h8(str)); writeNational(now); }
      writeGlobal(now);
    }, LIVE_LOCK);
  } catch (e) {
    // occupé : les changements retournent dans la file, nouvel essai dans une demi-seconde
    cells.forEach(c => dirty.cells.add(c));
    if (doAnn) dirty.ann = true; if (doEv) dirty.events = true; if (doLegal) dirty.legal = true; if (doOrd) dirty.ord = true; if (doAll) dirty.all = true; if (doGlobal) dirty.global = true;
    if (!isBusy(e)) console.error('publication', e.message);
    return scheduleFlush(500);
  }
  if (dirty.all && !pub.timer) scheduleFlush(Math.max(FLUSH_MS, ALL_EVERY - (Date.now() - pub.lastAll)));
  if (doGlobal) streamNotify(changed, doAnn || doEv || doLegal || doOrd || dirty.global);
}
setFlusher(flush);
// Tout republier (démarrage, purge) : chaque case active, chaque fichier existant, annonces, agenda.
function rebuildAll() {
  const now = Date.now();
  const all = new Set(q('SELECT DISTINCT cell FROM reports WHERE exp>?').all(now).map(x => x.cell));
  q('SELECT cell FROM cells').all().forEach(x => all.add(x.cell));
  try { fs.readdirSync(path.join(LIVE_DIR, 'c')).forEach(f => f.endsWith('.json') && all.add(f.slice(0, -5))); } catch {}
  all.forEach(c => dirty.cells.add(c));
  dirty.ann = dirty.events = dirty.legal = dirty.ord = dirty.global = dirty.all = true; pub.lastAll = 0;
  clearTimeout(pub.timer); pub.timer = null;
  flush();
  ensureRegions();
}
// Fichiers de région publiés d'avance (vides) pour la France et l'outre-mer : un téléphone dans une zone
// sans aucun signalement reçoit un fichier statique d'Apache, sans réveiller Node.
function ensureRegions() {
  try {
    for (const [la1, la2, lo1, lo2] of TILE_ZONES)
      for (let i = Math.floor(la1); i <= Math.floor(la2); i++)
        for (let j = Math.floor(lo1); j <= Math.floor(lo2); j++) {
          const f = path.join(LIVE_DIR, 'r', `${i}_${j}.json`);
          if (!fs.existsSync(f)) writeAtomic(f, '{"c":{}}');
          const pf = path.join(LIVE_DIR, 'p', `${i}_${j}.json`);
          if (!fs.existsSync(pf)) writeAtomic(pf, '{"r":[]}');
        }
  } catch (e) { console.error('régions', e.message); }
}

module.exports = { rebuildAll };
