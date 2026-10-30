// Cortège — serveur, zéro dépendance (Node >= 22.13).
// Le code est découpé par domaine dans src/ (voir ARCHITECTURE.md) ; ce fichier assemble le tout et démarre le serveur.
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const { PORT, EVENT_NAME, CENTER, ZOOM, ADMIN_KEY, ARCHIVE_DAYS, ORGAS, TILE_URL, TILE_UA, UNDER_PASSENGER, TRUST_PROXY, DATA_DIR,
  VIOLENCE_URL, CONTACT_EMAIL, HOST_INFO, SOURCE_URL, BRAND, ADMIN_LABEL_ENV, IMPORT_NAMES, PUBLIC_URL, MIN, MAX_REPORTS, MAX_PER_ZONE,
  MAX_PER_NET_ZONE, NOTE_MAX, ANN_MAX, RATE, STATE_FILE, LOCK_FILE } = require('./src/config');
const { CATEGORIES, EVENT_TYPES, EVT, CAT, MERGE, CALM_KILL_M, ALERT_CATS, VIBES, isDanger, GROUPS, BASE_TTL } = require('./src/categories');
const { labelKey, distM, keyEq, sha, sleep, withLock, wait, h8, round, clean, validLatLng, distKm } = require('./src/util');
const { periodKey, pruneKeys, rotateSecret, PRIVATE_IP, ONION_HOST, viaOnion, clientIp, clientHash, dayBucket, ipBucket, deviceHash } = require('./src/privacy');
const { DatabaseSync, db, q, tx, isBusy, getMeta, setMeta } = require('./src/db');
const { send, readJson } = require('./src/http/respond');
const { STREAM_ON, STREAM_MAX, sseClients, streamOpen, streamNotify } = require('./src/live/stream');
const { PUBLIC, TYPES, cspFor, NOINDEX, serveStatic } = require('./src/http/static');
const { APP_VERSION, versionInfo } = require('./src/http/version');
const { PMTILES, PM_ZONES, pmDecomp, pmOpen, pmTile, pmInfo, serveVectorTile } = require('./src/geo/pmtiles');
const { TILE_DIR, TILE_DISK, TILE_ZONES, TILE_PREFETCH, tileInZone, serveTile } = require('./src/geo/tiles');
const { gate, loadStats } = require('./src/http/saturation');
const { cityIdx } = require('./src/pages/city-cache');
const { LIVE_DIR, cellId, regionOfCell, writeAtomic, writeIfChanged, FLUSH_MS, ALL_EVERY, LIVE_LOCK, dirty, pub, setFlusher, scheduleFlush, dirtyCell } = require('./src/live/files');
const { ORGA_FILE, INVITE_MS, readOrgas, writeOrgas } = require('./src/orgas/store');
const { settings, cleanSettings, saveSettings, mobsAll, mobToday, bannerNow, cfgHash, adminLabel, pausedUntil } = require('./src/settings');
const { strictUntil, bump, TABLE_CAPS, capTables, quota, ORGA_LIMITS, allow } = require('./src/limits');
const { parseNotes, parseTrail, toReport, TRAIL_CATS, TRAIL_MS, TRAIL_MAX, BEACON_ROLES, BEACON_TTL, BEACON_MAX, BEACON_ZONE_M, addTrail, NOTES_KEEP, addNote, trailView, publicView } = require('./src/reports/model');
const { ARCHIVE_DIR, parisDay, parisHour, archTrail, archLine, archive, pruneArchive } = require('./src/digest/archive');
const { canManage, ownerTag } = require('./src/orgas/owner');
const { nearby, getReport, activeReports, saveReport, dropReport } = require('./src/reports/store');
const { annAll, annActive, getAnn, saveAnn, dropAnn, annView } = require('./src/announcements/store');
const { getEvent, listEvents, saveEvent, dropEvent, evView, EVENT_KEEP, routeDistM } = require('./src/events/store');
const { KEY_TRIES, keyLocked, keyFailed, isAdmin, orgaOf } = require('./src/orgas/auth');
const { SPONSOR, DEVICE_MS, DEVICE_MAX, banUntil, orgaReady, descendants, newInvite } = require('./src/orgas/sponsor');
const { TRASH_MS, ORGA_REMOVE_MAX, orgaLog, trashReport, orgaStats } = require('./src/orgas/log');
const { CONTEST, VOTES, deviceAge, contestNeed, TRUST, devRep, repAdd, firstConfirm } = require('./src/reports/votes');
const { legalAll, getLegal, saveLegal, legalView, phoneDigits, cleanLegal, seedLegal, watchStatus, legalWatch, legalAlerts } = require('./src/legal');
const { orgaRequest, orgaRequests } = require('./src/orgas/requests');
const { PLACES, placeOf } = require('./src/geo/cities');
const { geoCache, nominatim, placeName } = require('./src/geo/search');
const { PUSH_MAX, PUSH_HOSTS, VAPID, PUSH_NET_MAX, PUSH_LANGS, tr, LOCALE, pushCount, pushAll, pushRunningNow, pushQueue, pushOne, PSTATS, pushStat, pushSendAll, nearKm, pushNearLater, pushBroadcast } = require('./src/push');
const { getJson, parisMs } = require('./src/events/import-17oct');
const { createEvent } = require('./src/events/create');
const { DEPS, depOf, GEO_API, normName, geoPoly } = require('./src/geo/departments');
const { commIndex, commReset, polyHas, inFrance, whereOf } = require('./src/geo/communes');
const { ORDER_KINDS, ORDER_KIND, dropOrder, ordersAll, srcHost, orderView, ordersLive, createOrder, approveOrder } = require('./src/orders');
const { POI_KINDS, POI, PLACES_IMPORT, PLACES_EVERY, poiRg, poiKind, poiStr, poiData, overpassQuery, OVERPASS_URLS, overpass, placeChunks, placesStatus, placesRun, placesState } = require('./src/places/osm');
const { placesSource, download, placesImport, placesPublish, poiView } = require('./src/places/geofabrik');
const { dayRows, dayCountFr } = require('./src/digest/day');
const { ABUSE_KEEP, abuseLog, abuseOnce, SERIES, calmSeries, modQueue, snapshotContested } = require('./src/moderation');
const { sweep } = require('./src/sweep');
const { labelClash, migrateOwners } = require('./src/orgas/names');
const { createAnnouncement } = require('./src/announcements/create');

// ---- Pages publiques par manif (/manif/AAAA-MM-JJ) ----
// Bilans figés par la 2.6.0 avec le code INSEE à la place du nom de la commune : nom retrouvé à la lecture
const INSEE_RE = /^\d[\dAB]\d{3}$/;
const fixPubNames = d => { if (d && Array.isArray(d.cities)) for (const c of d.cities) if (INSEE_RE.test(c.name)) { const x = q('SELECT name FROM communes WHERE insee=?').get(c.name); if (x) c.name = x.name; } return d; };
const getPub = date => { const x = q('SELECT data FROM pub WHERE date=?').get(date); return x ? fixPubNames(JSON.parse(x.data)) : null; };
const REMOVED_O = new Set(['cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old']);
function pubSnapshot(date) {
  const { rows: all, abroad, zones } = dayRows(date);
  const rows = all.filter(r => CAT[r.c]);
  if (!rows.length) return null;
  const cats = {}, fam = {}, hours = Array(24).fill(0), cities = {};
  for (const r of rows) {
    cats[r.c] = (cats[r.c] || 0) + 1; const g = CAT[r.c].group; fam[g] = (fam[g] || 0) + 1; hours[parisHour(r.t) % 24]++;
    const c = (cities[r.z] ||= { name: zones[r.z] ? zones[r.z].name : r.z, n: 0, lat: 0, lng: 0 }); c.n++; c.lat += r.lat; c.lng += r.lng;
  }
  const ts = rows.map(r => r.t);
  return { date, total: rows.length, fam, hours,
    cats: Object.entries(cats).map(([id, n]) => ({ id, label: CAT[id].label, glyph: CAT[id].glyph, group: CAT[id].group, n })).sort((a, b) => b.n - a.n),
    cities: Object.values(cities).map(c => ({ name: c.name, n: c.n, lat: Math.round(c.lat / c.n * 100) / 100, lng: Math.round(c.lng / c.n * 100) / 100 })).sort((a, b) => b.n - a.n),
    first: Math.min(...ts), last: Math.max(...ts), confirmed: rows.filter(r => r.up > 0).length, confs: rows.reduce((t, r) => t + (r.up || 0), 0),
    verified: rows.filter(r => r.v).length, removed: rows.filter(r => REMOVED_O.has(r.o)).length, abroad, communes: commIndex().rows.length > 0, pts: pubPts(rows), ptsV: PTS_V, ptsS: PTS_SCALE,
    ...pubExtras(date, rows, zones) };
}
// ---- Bilans détaillés (2.8) : moments clés, durées, parcours des cortèges, arrêtés du jour, pages par ville ----
const EXT_V = 1, CITY_PAGE_MIN = 20;
// Dangers dont on suit le premier signalement et la durée, ville par ville
const KEY_DANGERS = ['charge', 'tirs', 'nasse', 'lacrymo', 'canon', 'sommations', 'facho', 'interpellation', 'inter', 'blinde', 'bac', 'crs'];
const slugOf = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
// Total en minutes d'intervalles qui se chevauchent
function unionMin(iv) {
  let tot = 0, cs = null, ce = null;
  for (const [a, b] of iv.sort((x, y) => x[0] - y[0])) { if (cs === null || a > ce) { if (cs !== null) tot += ce - cs; cs = a; ce = b; } else ce = Math.max(ce, b); }
  if (cs !== null) tot += ce - cs;
  return Math.round(tot / MIN);
}
// Parcours réel du cortège d'une ville, d'après le chemin de sa tête : longueur, heures, vitesse moyenne
function marchOf(heads) {
  const pts = [];
  for (const r of heads) { for (const p of r.tr || []) pts.push([p[0], p[1], p[2] * MIN]); pts.push([r.lat, r.lng, r.e || r.t]); }
  pts.sort((a, b) => a[2] - b[2]);
  let len = 0, from = null, to = null; const path = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q2 = path[path.length - 1];
    if (q2) { const d = distM({ lat: q2[0], lng: q2[1] }, { lat: p[0], lng: p[1] }); if (d < 5) continue; if (p[2] - q2[2] <= 20 * MIN && d <= 1500) { len += d; to = p[2]; } }
    if (from === null) from = to = p[2];
    path.push(p);
  }
  if (len < 100) return null;
  const h = (to - from) / 3600e3, step = Math.max(1, Math.ceil(path.length / 200));
  return { len: Math.round(len), from, to, kmh: h >= 1 / 6 ? Math.round(len / 1000 / h * 10) / 10 : null,
    path: path.filter((_, i) => i % step === 0 || i === path.length - 1).map(p => [p[0], p[1], Math.floor(p[2] / MIN)]) };
}
// Arrêtés en vigueur pendant la journée (même terminés depuis, ils sont gardés 8 jours)
function ordersOfDay(date) {
  const a = parisMs(date, '00:00'), b = a + 24 * 60 * MIN;
  return ordersAll().filter(o => o.status === 'ok' && o.zone && o.start < b && o.end > a).map(o => ({ name: o.zone.name, dep: o.zone.dep, scope: o.zone.scope, start: o.start, end: o.end,
    items: (o.items || []).map(x => ({ k: x.k, text: x.text })), src: o.src, host: srcHost(o.src) }));
}
function pubExtras(date, rows, zones) {
  const name = z => (zones[z] ? zones[z].name : z), byCity = new Map();
  for (const r of rows) { if (!byCity.has(r.z)) byCity.set(r.z, []); byCity.get(r.z).push(r); }
  // Moments clés : premier signalement de chaque danger, ville par ville
  const firsts = new Map();
  for (const r of rows.filter(r => KEY_DANGERS.includes(r.c)).sort((a, b) => a.t - b.t)) { const k = r.z + '|' + r.c; if (!firsts.has(k)) firsts.set(k, r); }
  const moments = [...firsts.values()].sort((a, b) => a.t - b.t).map(r => ({ t: r.t, c: r.c, city: name(r.z), up: r.up || 0, v: r.v ? 1 : 0, lat: r.lat, lng: r.lng }));
  const cityPages = [], durations = {}, marches = [];
  for (const [z, list] of byCity) {
    const dur = {};
    for (const c of KEY_DANGERS) { const iv = list.filter(r => r.c === c).map(r => [r.t, r.e || r.t + 10 * MIN]); if (iv.length) dur[c] = unionMin(iv); }
    const top = Object.entries(dur).filter(([, m]) => m >= 5).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (top.length) durations[name(z)] = top;
    const march = marchOf(list.filter(r => r.c === 'cortege'));
    if (march) marches.push({ city: name(z), len: march.len, from: march.from, to: march.to, kmh: march.kmh });
    if (list.length >= CITY_PAGE_MIN) {
      const cats = {}, hours = Array(24).fill(0);
      for (const r of list) { cats[r.c] = (cats[r.c] || 0) + 1; hours[parisHour(r.t) % 24]++; }
      const ts = list.map(r => r.t), lat = list.reduce((t, r) => t + r.lat, 0) / list.length, lng = list.reduce((t, r) => t + r.lng, 0) / list.length;
      cityPages.push({ slug: slugOf(name(z)), name: name(z), n: list.length, cats: Object.entries(cats).sort((a, b) => b[1] - a[1]), hours, first: Math.min(...ts), last: Math.max(...ts),
        lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, confirmed: list.filter(r => r.up > 0).length, verified: list.filter(r => r.v).length,
        moments: moments.filter(m => m.city === name(z)), durations: top, march });
    }
  }
  // Deux villes au même nom simplifié : le second reçoit un suffixe
  const seen = new Set(); for (const c of cityPages) { while (seen.has(c.slug)) c.slug += '-2'; seen.add(c.slug); }
  return { ext: EXT_V, moments: moments.slice(0, 60), durations, marches: marches.sort((a, b) => b.len - a.len), orders: ordersOfDay(date), cityPages };
}
// Bilans publiés avant la 2.8 : détails ajoutés à la première lecture, tant que l'archive du jour existe
function pubFull(date) {
  const d = pubWithPts(date);
  if (!d || d.ext === EXT_V) return d;
  const { rows: all, zones } = dayRows(date), rows = all.filter(r => CAT[r.c]);
  if (!rows.length) return d;
  Object.assign(d, pubExtras(date, rows, zones));
  q('UPDATE pub SET data=? WHERE date=?').run(JSON.stringify(d), date);
  return d;
}
// Points de la journée pour la carte d'un créneau (page publique) : position arrondie à ~11 m (dix-millième de degré), heures à la minute,
// nombre de confirmations, vérifié ou non, et ce qu'est devenu le point. Les points retirés ou contestés restent,
// avec la mention : un retrait (même par une orga, ou en masse par des votes) ne doit pas faire disparaître ce qui a été signalé.
const PUB_PTS_MAX = 30000, PTS_V = 4, PTS_SCALE = 1e4; // PTS_V : format des points (2 = heures de fin corrigées, 3 = devenir du point, 4 = précision ~11 m)
const PTS_O = ['', 'cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old'];
function pubPts(rows) {
  return rows.filter(r => CAT[r.c]).slice(0, PUB_PTS_MAX)
    .map(r => { const o = REMOVED_O.has(r.o) ? Math.max(1, PTS_O.indexOf(r.o)) : 0;
      return [r.c, Math.floor(r.t / MIN), Math.floor(Math.min(r.e || Date.now(), r.t + 24 * 60 * MIN) / MIN), Math.round(r.lat * PTS_SCALE), Math.round(r.lng * PTS_SCALE), r.up || 0, r.v ? 1 : 0, ...(o ? [o] : [])]; });
}
// Bilans publiés avant la 2.3.3 : points ajoutés à la première demande, tant que l'archive du jour existe
function pubWithPts(date) {
  const d = getPub(date);
  if (!d || (d.pts && d.ptsV === PTS_V)) return d;
  const { rows } = dayRows(date);
  if (!rows.length) return d;
  d.pts = pubPts(rows); d.ptsV = PTS_V; d.ptsS = PTS_SCALE;
  q('UPDATE pub SET data=? WHERE date=?').run(JSON.stringify(d), date);
  return d;
}
let storyMap = null;
const BubbleMap = require('./public/bubble-map.js');
const { streetRoute } = require('./tools/street-route.js');
const routeCache = new Map();
function mapSvg(cities) {
  try { storyMap ||= JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'story-map.json'), 'utf8')); } catch { return ''; }
  const m = storyMap, b = BubbleMap.svg(cities, m, { fontSize: 26, labels: 14, esc: htmlEsc });
  return `<svg viewBox="0 0 ${m.w} ${m.h}" role="img" aria-label="Carte des signalements par ville"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec9fa4"/><stop offset="1" stop-color="#7d86dc"/></linearGradient></defs>`
    + m.near.map(p => `<path d="${p}" fill="#1c1c20" stroke="#34343c" stroke-width="1.5"/>`).join('') + `<path d="${m.fr}" fill="#26262c" stroke="#5a5866" stroke-width="2"/>${b.dots}${b.labels}</svg>`
    + (b.merged ? '<p class="fine">Sur la carte, les communes très proches sont regroupées sous le nom de la plus active ; le détail est dans la liste.</p>' : '');
}
const htmlEsc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GROUP_COL = { fdo: '#e5484d', danger: '#f5a524', soutien: '#30a46c', info: '#8e8cd8' };
const GROUP_FR = { fdo: 'Forces de l’ordre', danger: 'Danger', info: 'Info', soutien: 'Soutien' };
const frDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const frHour = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const PUB_CSS = `*{box-sizing:border-box}body{margin:0;background:#121214;color:#f2f1f4;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}a{color:#ec9fa4}.top{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.top img{width:44px;height:44px;border-radius:10px}
.top b{display:block;font-size:18px}.top span{color:#a3a1ad;font-size:13px}h1{font-size:clamp(28px,6vw,42px);line-height:1.1;margin:28px 0 6px}.lead{color:#c9c7d1;margin:0 0 20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.kpi{background:#1c1c20;border:1px solid #34343c;border-radius:14px;padding:12px 14px}.kpi b{display:block;font-size:30px;font-variant-numeric:tabular-nums}.kpi span{color:#a3a1ad;font-size:13px}
section{background:#1c1c20;border:1px solid #34343c;border-radius:16px;padding:16px;margin:14px 0}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ec9fa4;margin:0 0 12px}
svg{width:100%;height:auto;display:block}.row{display:grid;grid-template-columns:minmax(120px,40%) 1fr 48px;gap:10px;align-items:center;margin:6px 0;font-size:14px}.bar{height:14px;border-radius:4px}.n{text-align:right;font-variant-numeric:tabular-nums}
.hours{display:flex;gap:3px;align-items:flex-end;height:160px;border-bottom:1px solid #5a5866}.hours div{flex:1;background:#5b66c4;border-radius:3px 3px 0 0;min-height:1px}.hours .pk{background:#ec9fa4}.ticks{display:flex;gap:3px;color:#a3a1ad;font-size:11px}.ticks span{flex:1;text-align:center}
.fine{color:#a3a1ad;font-size:13px}.cta{display:grid;gap:10px;grid-template-columns:1fr 1fr;margin-top:18px}.cta a{display:block;text-align:center;padding:14px;border-radius:14px;background:#26262c;border:1px solid #34343c;color:#f2f1f4;text-decoration:none;font-weight:700}
.cta a.main{background:linear-gradient(135deg,#ec9fa4,#a191d8 60%,#7d86dc);color:#17121f;border:0}
nav.links{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 0}nav.links a{padding:6px 10px;border-radius:99px;background:#1c1c20;border:1px solid #34343c;color:#f2f1f4;text-decoration:none;font-size:13px}nav.links a[aria-current]{border-color:#ec9fa4;color:#ec9fa4}
ul.tl{list-style:none;padding:0;margin:0}ul.tl li{padding:6px 0;border-bottom:1px solid #2a2a30}ul.tl time{display:inline-block;min-width:64px;color:#ec9fa4;font-variant-numeric:tabular-nums;font-weight:700}
ul.orders{padding-left:18px}ul.orders>li{margin:10px 0}ul.orders ul{margin:4px 0;padding-left:18px}.rights details{border-bottom:1px solid #2a2a30;padding:8px 0}.rights summary{font-weight:700;cursor:pointer}ul.days{list-style:none;padding:0}ul.days li{margin:8px 0}ul.days a{display:flex;justify-content:space-between;padding:14px 16px;border-radius:14px;background:#1c1c20;border:1px solid #34343c;color:#f2f1f4;text-decoration:none}`;
function pubShell(req, { title, desc, body, ld }) {
  const base = PUBLIC_URL_REAL(req), here = base + String(req.url || '/').split('?')[0].replace(/\/$/, '');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEsc(title)}</title><meta name="description" content="${htmlEsc(desc)}"><link rel="canonical" href="${htmlEsc(here || base + '/')}">${ld ? jsonLd(ld) : ''}
<meta property="og:title" content="${htmlEsc(title)}"><meta property="og:description" content="${htmlEsc(desc)}"><meta property="og:type" content="article">
<meta property="og:image" content="${base}/icon-512.png"><meta name="twitter:card" content="summary"><link rel="icon" href="/favicon.png"><style>${PUB_CSS}</style></head>
<body><main><a class="top" href="/"><img src="/brand/logo.png" alt=""><span><b>Cortège</b><span>La carte en direct des manifs${BRAND.handle ? ' · par @' + htmlEsc(BRAND.handle) : ''}</span></span></a>
<nav class="links" aria-label="Pages">${[['/', 'Carte'], ['/agenda', 'Agenda'], ['/arretes', 'Arrêtés'], ['/manif', 'Bilans'], ['/villes', 'Villes'], ['/droits', 'Tes droits'], ['/legal-teams', 'Legal teams']]
  .map(([u, l]) => `<a href="${u}"${here.endsWith(u) && u !== '/' ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>${body}
<div class="cta"><a class="main" href="/">Ouvrir la carte</a><a href="${htmlEsc(BRAND.instagram || '/')}" rel="noopener">${BRAND.handle ? 'Suivre @' + htmlEsc(BRAND.handle) : 'Suivre le projet'}</a></div>
<p class="fine">Signalements anonymes envoyés par les manifestant·es : ce ne sont pas des faits vérifiés, ils sont confirmés ou contestés par les autres sur place. Positions à une dizaine de mètres près ; rien sur les personnes qui ont signalé.</p></main></body></html>`;
}
const GOOGLE_VERIFY = /^google[\w-]{6,60}\.html$/.test(process.env.GOOGLE_SITE_VERIFICATION || '') ? process.env.GOOGLE_SITE_VERIFICATION : '';
function sitemapXml(req) {
  const base = PUBLIC_URL_REAL(req), day = t => new Date(t).toISOString().slice(0, 10);
  const pubs = q('SELECT date, t FROM pub ORDER BY date DESC').all();
  const urls = [['/', day(Date.now()), 'always', '1.0'], ['/manif', pubs[0] ? day(pubs[0].t) : null, 'daily', '0.8'], ['/presse', null, 'monthly', '0.6'],
    ['/affiche.html', null, 'monthly', '0.4'], ['/legal.html', null, 'yearly', '0.2'], ...pubs.map(x => ['/manif/' + x.date, day(x.t), 'monthly', '0.7']),
    ['/agenda', day(Date.now()), 'daily', '0.8'], ['/arretes', day(Date.now()), 'daily', '0.7'], ['/droits', null, 'monthly', '0.6'], ['/legal-teams', null, 'weekly', '0.6'], ['/villes', null, 'daily', '0.5'],
    ...[...cityIndex().values()].map(c => ['/ville/' + c.slug, null, 'daily', '0.6']),
    ...pubs.flatMap(x => { try { return (JSON.parse(q('SELECT data FROM pub WHERE date=?').get(x.date).data).cityPages || []).map(c => ['/manif/' + x.date + '/' + c.slug, day(x.t), 'monthly', '0.5']); } catch { return []; } })];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(([u, m, f, p]) => `<url><loc>${htmlEsc(base + u)}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}<changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')
    + '\n</urlset>\n';
}
// Données structurées (schema.org) : rien n'est exécuté, c'est seulement lu par les moteurs de recherche
const jsonLd = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const PUBLIC_URL_REAL = req => (process.env.PUBLIC_URL || ('https://' + String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, ''))).replace(/\/$/, '');
const cap = s => s[0].toUpperCase() + s.slice(1);
const fmtMin = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;
const fmtLen = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const catTxt = c => CAT[c] ? `${CAT[c].glyph} ${CAT[c].label}` : c;
// Classement de la journée parmi les bilans publiés, et évolution depuis le bilan précédent
function pubRank(d) {
  const all = q('SELECT date, data FROM pub ORDER BY date').all().map(x => ({ date: x.date, total: JSON.parse(x.data).total }));
  if (all.length < 2) return '';
  const rank = all.filter(x => x.total > d.total).length + 1, i = all.findIndex(x => x.date === d.date), prev = i > 0 ? all[i - 1] : null;
  const pct = prev && prev.total ? Math.round((d.total - prev.total) / prev.total * 100) : null;
  return `<p class="fine">${rank === 1 ? 'La journée la plus signalée' : `${rank}<sup>e</sup> journée la plus signalée`} sur ${all.length} bilans publiés${pct !== null ? ` · ${pct >= 0 ? '+' : ''}${pct} % par rapport au <a href="/manif/${prev.date}">${htmlEsc(frDay(prev.date))}</a>` : ''}.</p>`;
}
const ORDER_GLYPH = k => (ORDER_KIND[k] || ORDER_KIND.autre).glyph + ' ' + (ORDER_KIND[k] || ORDER_KIND.autre).label;
function ordersHtml(list) {
  return list.map(o => `<li><b>${htmlEsc(o.name)}</b>${o.scope === 'dep' ? ' (département)' : ''} · du ${htmlEsc(frWhen(o.start))} au ${htmlEsc(frWhen(o.end))}
<ul>${o.items.map(x => `<li>${htmlEsc(ORDER_GLYPH(x.k))} : ${htmlEsc(x.text)}</li>`).join('')}</ul><span class="fine">Source : <a href="${htmlEsc(o.src)}" rel="noopener nofollow">${htmlEsc(o.host || 'lien')}</a></span></li>`).join('');
}
const frWhen = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const momentsHtml = (list, withCity) => `<ul class="tl">${list.map(m => `<li><time>${frHour(m.t)}</time> ${htmlEsc(catTxt(m.c))}${withCity ? ' · ' + htmlEsc(m.city) : ''}${m.up ? ` <span class="fine">(confirmé ${m.up}×)</span>` : ''}${m.v ? ' <span class="fine">✓ vérifié</span>' : ''}</li>`).join('')}</ul>`;

function pubPage(req, d) {
  const maxC = d.cats[0].n, maxH = Math.max(...d.hours), peak = d.hours.indexOf(maxH), top = d.cities.slice(0, 12), maxV = top[0].n;
  const day = cap(frDay(d.date)), pages = new Map((d.cityPages || []).map(c => [c.name, c.slug]));
  const title = `${day} : ${d.total} signalements sur Cortège`;
  const desc = `${d.total} signalements de manifestant·es dans ${d.cities.length} villes, de ${frHour(d.first)} à ${frHour(d.last)}. Carte, moments clés, parcours des cortèges, arrêtés, données ouvertes.`;
  const cityName = c => pages.has(c) ? `<a href="/manif/${d.date}/${pages.get(c)}">${htmlEsc(c)}</a>` : htmlEsc(c);
  const durs = Object.entries(d.durations || {}).slice(0, 12);
  const body = `<h1>${htmlEsc(day)}</h1><p class="lead">Ce que les manifestant·es ont signalé sur Cortège.</p>
<div class="kpis"><div class="kpi"><b>${d.total}</b><span>signalements</span></div><div class="kpi"><b>${d.cities.length}</b><span>villes</span></div>
<div class="kpi"><b>${frHour(d.first)}</b><span>premier signalement</span></div><div class="kpi"><b>${frHour(d.last)}</b><span>dernier signalement</span></div></div>
${pubRank(d)}
<section><h2>Par ville</h2>${mapSvg(d.cities)}${top.map(c => `<div class="row"><span>${cityName(c.name)}</span><span class="bar" style="width:${Math.max(2, c.n / maxV * 100)}%;background:linear-gradient(90deg,#ec9fa4,#a191d8)"></span><span class="n">${c.n}</span></div>`).join('')}
${d.cities.length > 12 ? `<p class="fine">+ ${d.cities.length - 12} autres ${d.communes ? 'communes' : 'villes. Chaque ville compte aussi les communes voisines de son agglomération'}.</p>` : ''}
${pages.size ? `<p class="fine">Page détaillée pour chaque ville d’au moins ${CITY_PAGE_MIN} signalements : ${[...pages].map(([n, s]) => `<a href="/manif/${d.date}/${s}">${htmlEsc(n)}</a>`).join(', ')}.</p>` : ''}
${d.abroad ? `<p class="fine">${d.abroad} ${d.abroad > 1 ? 'signalements envoyés' : 'signalement envoyé'} hors de France, non ${d.abroad > 1 ? 'comptés' : 'compté'} ici.</p>` : ''}</section>
${d.moments && d.moments.length ? `<section><h2>Moments clés</h2><p class="fine">Le premier signalement de chaque danger, ville par ville.</p>${momentsHtml(d.moments.slice(0, 30), true)}</section>` : ''}
${durs.length ? `<section><h2>Combien de temps</h2><p class="fine">Durée pendant laquelle chaque danger est resté signalé (les signalements qui se chevauchent ne comptent qu’une fois).</p>
${durs.map(([c, l]) => `<p><b>${cityName(c)}</b> : ${l.map(([k, m]) => `${htmlEsc(catTxt(k))} ${fmtMin(m)}`).join(' · ')}</p>`).join('')}</section>` : ''}
${d.marches && d.marches.length ? `<section><h2>Parcours des cortèges</h2><p class="fine">D’après le chemin de la tête de cortège, signalée par les manifestant·es ou partagée en direct par le service d’ordre.</p>
${d.marches.map(m => `<p><b>${cityName(m.city)}</b> : ${fmtLen(m.len)} de ${frHour(m.from)} à ${frHour(m.to)}${m.kmh ? `, environ ${String(m.kmh).replace('.', ',')} km/h en moyenne` : ''}</p>`).join('')}</section>` : ''}
${d.orders && d.orders.length ? `<section><h2>Arrêtés en vigueur ce jour-là</h2><ul class="orders">${ordersHtml(d.orders)}</ul></section>` : ''}
<section><h2>Par type</h2><p class="fine">${Object.entries(d.fam).map(([g, n]) => `<span style="color:${GROUP_COL[g]}">●</span> ${GROUP_FR[g]} ${n}`).join(' · ')}</p>
${d.cats.map(c => `<div class="row"><span>${htmlEsc(c.label)}</span><span class="bar" style="width:${Math.max(1.5, c.n / maxC * 100)}%;background:${GROUP_COL[c.group]}"></span><span class="n">${c.n}</span></div>`).join('')}</section>
<section><h2>Par heure</h2><p class="fine">Le plus d’envois entre ${peak} h et ${(peak + 1) % 24} h (${maxH}).</p><div class="hours" role="img" aria-label="Signalements par heure">${d.hours.map((n, i) => `<div class="${i === peak ? 'pk' : ''}" style="height:${n / maxH * 100}%" title="${i} h : ${n}"></div>`).join('')}</div>
<div class="ticks">${d.hours.map((_, i) => `<span>${i % 3 ? '' : i + 'h'}</span>`).join('')}</div></section>
<section><h2>Vérification</h2><div class="kpis"><div class="kpi"><b style="color:#30a46c">${d.confirmed}</b><span>confirmés par au moins une autre personne (${d.confs} confirmations)</span></div>
<div class="kpi"><b style="color:#8e8cd8">${d.verified}</b><span>vérifiés par une orga certifiée</span></div><div class="kpi"><b style="color:#f5a524">${d.removed}</b><span>retirés avant leur expiration (inclus dans les totaux)</span></div></div></section>
<section><h2>Carte d’un créneau</h2><p>Choisis un lieu et une plage horaire : une image avec les signalements de ce moment-là, à télécharger ou partager (presse, legal teams, témoignages).</p>
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/manif/${d.date}/carte">Fabriquer une image d’un créneau</a></div></section>
${dataSection(d)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'Dataset', name: title, description: desc, url: PUBLIC_URL_REAL(req) + '/manif/' + d.date, license: 'https://creativecommons.org/licenses/by/4.0/',
    creator: { '@type': 'Organization', name: 'Cortège' }, temporalCoverage: d.date, spatialCoverage: 'France', isAccessibleForFree: true,
    distribution: d.pts ? [{ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: PUBLIC_URL_REAL(req) + `/manif/${d.date}/donnees.csv` }] : undefined };
  return pubShell(req, { title, desc, body, ld });
}
const dataSection = d => d.pts ? `<section><h2>Données ouvertes</h2><p>Tous les signalements de la journée, un par ligne : type, heures de début et de fin, position (à une dizaine de mètres), commune, confirmations, vérification, devenir.</p>
<div class="cta" style="grid-template-columns:1fr"><a href="/manif/${d.date}/donnees.csv" download>Télécharger les données (CSV)</a></div>
<p class="fine">Licence <a href="https://creativecommons.org/licenses/by/4.0/deed.fr" rel="noopener">CC BY 4.0</a> : réutilisation libre en citant « Cortège ». Ce sont des signalements de manifestant·es, confirmés ou contestés sur place, pas des faits établis.</p></section>` : '';

// Schéma d'une ville (sans fond de carte) : parcours de la tête et signalements de la journée, avec une échelle
function citySvg(c, pts, scale) {
  const near = (pts || []).map(p => ({ c: p[0], lat: p[3] / scale, lng: p[4] / scale })).filter(p => CAT[p.c] && distM(p, c) <= 6000);
  const path = c.march ? c.march.path : [];
  const all = [...near.map(p => [p.lat, p.lng]), ...path.map(p => [p[0], p[1]])];
  if (all.length < 2) return '';
  const k = Math.cos(c.lat * Math.PI / 180), W = 700, H = 460, pad = 24;
  const xs = all.map(p => p[1] * k), ys = all.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((W - 2 * pad) / Math.max(x1 - x0, 1e-4), (H - 2 * pad) / Math.max(y1 - y0, 1e-4));
  const P = (lat, lng) => [pad + (lng * k - x0) * sc, H - pad - (lat - y0) * sc];
  const line = path.length > 1 ? `<polyline points="${path.map(p => P(p[0], p[1]).map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#ec9fa4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>` : '';
  const dots = near.slice(0, 3000).map(p => { const [x, y] = P(p.lat, p.lng); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${GROUP_COL[CAT[p.c].group]}" fill-opacity=".75"/>`; }).join('');
  // Échelle : 500 m, 1 km ou 2 km selon la taille du schéma
  const mPerPx = 1 / sc * 111320, bar = [200, 500, 1000, 2000].find(v => v / mPerPx >= 80) || 2000, bw = bar / mPerPx;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schéma des signalements à ${htmlEsc(c.name)}"><rect width="${W}" height="${H}" rx="12" fill="#16161a"/>${line}${dots}
<g fill="#a3a1ad" font-size="13"><rect x="${W - pad - bw}" y="${H - 14}" width="${bw}" height="3"/><text x="${W - pad}" y="${H - 20}" text-anchor="end">${fmtLen(bar)}</text></g></svg>`;
}
function cityDayPage(req, d, c) {
  const day = frDay(d.date), title = `${c.name}, ${day} : ${c.n} signalements sur Cortège`;
  const desc = `${c.n} signalements de manifestant·es à ${c.name} le ${day}, de ${frHour(c.first)} à ${frHour(c.last)}. Moments clés, durées, parcours du cortège.`;
  const maxH = Math.max(...c.hours), peak = c.hours.indexOf(maxH), maxC = c.cats[0][1];
  const pad = n => String(n).padStart(2, '0'), h0 = parisHour(c.first) % 24, h1 = parisHour(c.last) % 24;
  const slot = h1 >= h0 && h1 - h0 < 6 ? `${pad(h0)}:00-${pad(h1)}:59` : `${pad(peak)}:00-${pad(Math.min(23, peak + 2))}:59`;
  const ordersHere = (d.orders || []).filter(o => o.name === c.name || o.scope === 'dep');
  const body = `<p class="fine"><a href="/manif/${d.date}">← Bilan national du ${htmlEsc(day)}</a></p><h1>${htmlEsc(c.name)}</h1><p class="lead">${htmlEsc(cap(day))} : ce que les manifestant·es ont signalé sur Cortège.</p>
<div class="kpis"><div class="kpi"><b>${c.n}</b><span>signalements</span></div><div class="kpi"><b>${frHour(c.first)}</b><span>premier</span></div><div class="kpi"><b>${frHour(c.last)}</b><span>dernier</span></div>
${c.march ? `<div class="kpi"><b>${fmtLen(c.march.len)}</b><span>parcourus par la tête du cortège</span></div>` : ''}</div>
<section><h2>Schéma</h2>${citySvg(c, d.pts, d.ptsS || 1e3)}<p class="fine">${c.march ? 'En rose, le chemin de la tête du cortège. ' : ''}Points : les signalements de la journée à moins de 6 km. Schéma sans fond de carte : pour la vraie carte, fabrique l’image d’un créneau.</p>
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/manif/${d.date}/carte?c=${c.lat},${c.lng}&amp;n=${encodeURIComponent(c.name)}&amp;h=${slot}">Carte d’un créneau à ${htmlEsc(c.name)}</a></div></section>
${c.moments.length ? `<section><h2>Moments clés</h2>${momentsHtml(c.moments, false)}</section>` : ''}
${c.durations.length ? `<section><h2>Combien de temps</h2>${c.durations.map(([k, m]) => `<p>${htmlEsc(catTxt(k))} : <b>${fmtMin(m)}</b></p>`).join('')}</section>` : ''}
${c.march ? `<section><h2>Parcours du cortège</h2><p>${fmtLen(c.march.len)} de ${frHour(c.march.from)} à ${frHour(c.march.to)}${c.march.kmh ? `, environ ${String(c.march.kmh).replace('.', ',')} km/h en moyenne` : ''}.</p></section>` : ''}
${ordersHere.length ? `<section><h2>Arrêtés en vigueur ce jour-là</h2><ul class="orders">${ordersHtml(ordersHere)}</ul></section>` : ''}
<section><h2>Par type</h2>${c.cats.map(([k, n]) => `<div class="row"><span>${htmlEsc(catTxt(k))}</span><span class="bar" style="width:${Math.max(1.5, n / maxC * 100)}%;background:${GROUP_COL[CAT[k] ? CAT[k].group : 'info']}"></span><span class="n">${n}</span></div>`).join('')}</section>
<section><h2>Par heure</h2><div class="hours" role="img" aria-label="Signalements par heure">${c.hours.map((n, i) => `<div class="${i === peak ? 'pk' : ''}" style="height:${maxH ? n / maxH * 100 : 0}%" title="${i} h : ${n}"></div>`).join('')}</div>
<div class="ticks">${c.hours.map((_, i) => `<span>${i % 3 ? '' : i + 'h'}</span>`).join('')}</div></section>
<section><h2>Vérification</h2><p>${c.confirmed} confirmés par au moins une autre personne, ${c.verified} vérifiés par une orga certifiée.</p></section>
${dataSection(d)}`;
  return pubShell(req, { title, desc, body });
}
// Données ouvertes d'un bilan (CSV, gardé en mémoire)
const csvCache = new Map();
function pubCsv(d) {
  const key = d.date + ':' + (d.pts || []).length;
  if (csvCache.has(key)) return csvCache.get(key);
  const OUT = ['', 'contesté', 'retiré par une orga', 'retiré par l’admin', 'évincé (zone saturée)', 'effacé (purge)', 'retiré', 'retiré'];
  const sc = d.ptsS || 1e3, iso = m => new Date(m * MIN).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
  const esc = v => /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = ['type;categorie;famille;debut;fin;latitude;longitude;commune;confirmations;verifie_par_orga;devenir'];
  for (const [c, t, e, la, lo, up, v, o] of d.pts || []) {
    const lat = la / sc, lng = lo / sc;
    lines.push([c, CAT[c] ? CAT[c].label : c, CAT[c] ? GROUP_FR[CAT[c].group] : '', iso(t), iso(e), lat, lng, whereOf(lat, lng).name, up, v ? 'oui' : 'non', OUT[o || 0] || 'expiré normalement'].map(esc).join(';'));
  }
  const out = '﻿' + lines.join('\n') + '\n';
  csvCache.set(key, out); if (csvCache.size > 20) csvCache.delete(csvCache.keys().next().value);
  return out;
}

// ---- Pages de contenu (référencement) : agenda, arrêtés, villes, droits, legal teams ----
const whenLong = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const upcoming = (now = Date.now()) => listEvents().filter(e => e.status !== 'pending' && e.lat != null && e.start > now - 2 * 3600e3).sort((a, b) => a.start - b.start);
// Données structurées des événements (schema.org Event) : gratuit, organisé par l'orga qui l'a publié, fin estimée à 3 h après le début
const eventLd = (req, list) => {
  if (!list.length) return null;
  const base = PUBLIC_URL_REAL(req);
  return { '@context': 'https://schema.org', '@graph': list.map(e => {
    const who = e.by && e.by !== 'Proposition de participant·e' ? e.by : 'Mobilisation locale', url = `${base}/?at=${e.lat},${e.lng}`;
    const org = { '@type': 'Organization', name: who, url: base + '/agenda' };
    return { '@type': 'Event', name: e.title, startDate: new Date(e.start).toISOString(), endDate: new Date(e.start + 3 * 3600e3).toISOString(),
      eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', isAccessibleForFree: true,
      location: { '@type': 'Place', name: e.place || e.title, address: e.place || whereOf(e.lat, e.lng).name, geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } },
      image: [base + '/og.png'], organizer: org, performer: org,
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url, validFrom: new Date(e.t || e.start).toISOString() },
      url, description: (EVT[e.type] || EVT.manif).label + (e.place ? ' · ' + e.place : '') + (e.note ? ' · ' + e.note : '') };
  }) };
};
const eventsHtml = list => `<ul class="days">${list.map(e => `<li><a href="/?at=${e.lat},${e.lng}"><span>${htmlEsc((EVT[e.type] || EVT.manif).glyph + ' ' + e.title)}${e.place ? `<br><small class="fine">${htmlEsc(e.place)}</small>` : ''}</span><span>${htmlEsc(whenLong(e.start))}</span></a></li>`).join('')}</ul>`;
const legalHtml = list => `<ul class="days">${list.map(e => `<li><a href="tel:${htmlEsc(String(e.phone).replace(/[^\d+]/g, ''))}"><span>⚖️ ${htmlEsc(e.name)}</span><span>${htmlEsc(e.phone)}</span></a></li>`).join('')}</ul>`;

function agendaPage(req) {
  const list = upcoming().slice(0, 200), by = new Map();
  for (const e of list) { const c = whereOf(e.lat, e.lng).name; if (!by.has(c)) by.set(c, []); by.get(c).push(e); }
  const cities = [...by].sort((a, b) => a[1][0].start - b[1][0].start);
  const body = `<h1>Agenda des manifs</h1><p class="lead">Les prochaines manifestations, rassemblements, blocus et assemblées annoncés sur Cortège, ville par ville.</p>
${cities.length ? cities.map(([c, l]) => `<section><h2>${cityLink(c)}</h2>${eventsHtml(l)}</section>`).join('') : '<p class="fine">Rien d’annoncé pour l’instant. Une orga ou un collectif peut annoncer une manif depuis l’appli (onglet Infos).</p>'}`;
  return pubShell(req, { title: 'Agenda des manifs en France · Cortège', desc: 'Les prochaines manifs, rassemblements et blocus annoncés en France, ville par ville, sur Cortège, la carte en direct des manifs.', body, ld: eventLd(req, list.slice(0, 60)) });
}
function ordersPage(req) {
  const now = Date.now(), list = ordersLive(now), by = new Map();
  for (const o of list) { const dn = (depOf(o.dep) || { n: o.dep }).n; if (!by.has(dn)) by.set(dn, []); by.get(dn).push({ name: o.name, scope: o.scope, start: o.start, end: o.end, items: o.items, src: o.src, host: o.host }); }
  const body = `<h1>Arrêtés et interdictions en cours</h1><p class="lead">Manifestations interdites, périmètres, couvre-feux et restrictions de transport, avec la source officielle de chaque mesure.</p>
${by.size ? [...by].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([dn, l]) => `<section><h2>${htmlEsc(dn)}</h2><ul class="orders">${ordersHtml(l)}</ul></section>`).join('') : '<p class="fine">Aucun arrêté connu en ce moment.</p>'}
<p class="fine">Une mesure manque ? Propose-la depuis l’appli (onglet Infos, « Tous les arrêtés »), avec le lien de la source : elle est vérifiée avant d’être publiée.</p>`;
  return pubShell(req, { title: 'Arrêtés anti-manif en cours : interdictions, périmètres, couvre-feux · Cortège', desc: 'Les arrêtés en cours contre les manifestations en France, département par département, avec leurs sources officielles.', body });
}
function legalTeamsPage(req) {
  const by = new Map();
  for (const e of legalAll().filter(e => e.ok)) { if (!by.has(e.city)) by.set(e.city, []); by.get(e.city).push(e); }
  const body = `<h1>Legal teams en France</h1><p class="lead">Les numéros des legal teams, ville par ville. Écris le numéro de ta ville au stylo sur ton bras avant la manif : en garde à vue, ton téléphone te sera retiré.</p>
${by.size ? [...by].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([c, l]) => `<section><h2>${cityLink(c)}</h2>${legalHtml(l)}</section>`).join('') : '<p class="fine">Annuaire en cours de constitution.</p>'}
<p class="fine">Chaque numéro est vérifié auprès de la source publique du collectif. Une erreur, un numéro qui manque ? Écris via la page <a href="/legal.html#retrait">contact</a>.</p>`;
  return pubShell(req, { title: 'Legal teams : les numéros, ville par ville · Cortège', desc: 'Annuaire des legal teams en France : le numéro à noter avant une manif, ville par ville.', body });
}
// Page « Tes droits » : le contenu de l'onglet Droits de l'appli (une seule source : index.html)
let rightsCache = null;
function rightsPage(req) {
  if (!rightsCache) {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const a = html.indexOf('<h3 class="menu-group">En cas de</h3>'), sheet = html.indexOf('id="sheetRights"'), b = html.indexOf('</section>', a);
    // Seulement les rubriques (details) et l'avertissement juridique, pas les boutons ni les liens propres à l'appli
    const part = a > sheet && b > a ? html.slice(a, b) : '', end = part.lastIndexOf('</details>');
    const warn = (part.slice(end).match(/<p[^>]*>[^<]*Informations générales[\s\S]*?<\/p>/) || [''])[0];
    rightsCache = end > 0 ? (part.slice(0, end + 10) + warn).replace(/<h3 class="menu-group">En cas de<\/h3>/, '').replace(/\s(id|class|data-[\w-]+)="[^"]*"/g, '').replace(/<button[\s\S]*?<\/button>/g, '') : '';
  }
  const body = `<h1>Tes droits en manif</h1><p class="lead">Sommations, contrôle d’identité, garde à vue, téléphone, attaque d’un groupe fasciste : l’essentiel à savoir avant de partir. Le même contenu est dans l’appli, onglet Droits, même sans réseau.</p>
<section class="rights">${rightsCache}</section><p class="fine">Trouve le numéro de la legal team de ta ville dans <a href="/legal-teams">l’annuaire</a>.</p>`;
  return pubShell(req, { title: 'Tes droits en manif : sommations, garde à vue, contrôle d’identité · Cortège', desc: 'Ce qu’il faut savoir avant une manif : sommations, contrôle d’identité, garde à vue, téléphone, attaque fasciste.', body });
}
// Villes qui ont du contenu (manif à venir, legal team, ou ville d'un bilan publié) : une page chacune
function cityIndex() {
  if (Date.now() - cityIdx.at < 5 * MIN) return cityIdx.map;
  const map = new Map(), get = (name, lat, lng) => { const s = slugOf(name); if (!s) return null; if (!map.has(s)) map.set(s, { slug: s, name, lat, lng, events: [], legal: [], bilans: [] }); return map.get(s); };
  for (const e of upcoming()) { const w = whereOf(e.lat, e.lng), c = get(w.name, e.lat, e.lng); if (c) c.events.push(e); }
  for (const e of legalAll().filter(e => e.ok)) { const c = get(e.city, e.lat, e.lng); if (c) c.legal.push(e); }
  for (const x of q('SELECT date, data FROM pub ORDER BY date DESC').all()) {
    const d = JSON.parse(x.data), pages = new Map((d.cityPages || []).map(p => [p.name, p.slug]));
    for (const c2 of d.cities || []) if (c2.n >= 10) { const c = get(c2.name, c2.lat, c2.lng); if (c) c.bilans.push({ date: x.date, n: c2.n, page: pages.get(c2.name) || null }); }
  }
  cityIdx.at = Date.now(); cityIdx.map = map;
  return map;
}
const cityLink = name => { const s = slugOf(name); return cityIndex().has(s) ? `<a href="/ville/${s}">${htmlEsc(name)}</a>` : htmlEsc(name); };
function cityPage(req, c) {
  const now = Date.now(), orders = ordersLive(now).filter(o => c.lat != null && o.p && (o.scope === 'dep' || o.name === c.name) && polyHas(o.p, c.lat, c.lng));
  const body = `<h1>Manifs à ${htmlEsc(c.name)}</h1><p class="lead">Prochaines manifs, arrêtés en cours, legal team et bilans des dernières mobilisations à ${htmlEsc(c.name)}.</p>
<section><h2>À venir</h2>${c.events.length ? eventsHtml(c.events) : '<p class="fine">Rien d’annoncé pour l’instant.</p>'}</section>
${orders.length ? `<section><h2>Arrêtés en cours</h2><ul class="orders">${ordersHtml(orders)}</ul></section>` : ''}
${c.legal.length ? `<section><h2>Legal team</h2>${legalHtml(c.legal)}<p class="fine">Note le numéro au stylo sur ton bras avant de partir.</p></section>` : ''}
${c.bilans.length ? `<section><h2>Bilans des manifs</h2><ul class="days">${c.bilans.map(b => `<li><a href="/manif/${b.date}${b.page ? '/' + b.page : ''}"><span>${htmlEsc(frDay(b.date))}</span><span>${b.n} signalements</span></a></li>`).join('')}</ul></section>` : ''}
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/?at=${c.lat},${c.lng}">Voir la carte en direct à ${htmlEsc(c.name)}</a></div>`;
  return pubShell(req, { title: `Manifs à ${c.name} : agenda, arrêtés, legal team · Cortège`, desc: `Les prochaines manifs à ${c.name}, les arrêtés en cours, le numéro de la legal team et les bilans des dernières mobilisations.`, body, ld: eventLd(req, c.events) });
}
function citiesPage(req) {
  const list = [...cityIndex().values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const body = `<h1>Les manifs, ville par ville</h1><p class="lead">Agenda, arrêtés, legal teams et bilans pour chaque ville.</p>
<section><p>${list.map(c => `<a href="/ville/${c.slug}">${htmlEsc(c.name)}</a>`).join(' · ') || 'Aucune ville pour l’instant.'}</p></section>`;
  return pubShell(req, { title: 'Les manifs ville par ville · Cortège', desc: 'Agenda des manifs, arrêtés, legal teams et bilans, ville par ville, sur Cortège.', body });
}

function pubIndex(req) {
  const list = q('SELECT date, data FROM pub ORDER BY date DESC').all().map(x => { const d = JSON.parse(x.data); return { date: x.date, total: d.total, cities: d.cities.length }; });
  const next = upcoming().length;
  const body = `<h1>Bilans des manifs</h1><p class="lead">Ce que les manifestant·es ont signalé sur Cortège, journée par journée.${next ? ` Les prochaines manifs sont dans <a href="/agenda">l’agenda</a>.` : ''}</p>
<section><h2>Bilans</h2>${list.length ? `<ul class="days">${list.map(x => `<li><a href="/manif/${x.date}"><span>${htmlEsc(frDay(x.date))}</span><span>${x.total} signalements · ${x.cities} villes</span></a></li>`).join('')}</ul>` : '<p class="fine">Aucun bilan publié pour l’instant.</p>'}</section>`;
  return pubShell(req, { title: 'Bilans des manifs · Cortège', desc: 'Les bilans des mobilisations signalées sur Cortège, la carte en direct des manifs : chiffres, moments clés, parcours, données ouvertes.', body });
}
function sendPage(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
  res.end(html);
}

// ---- Journées de mobilisation prévues ----
// La veille à 20 h : notification à tous les abonné·es aux annonces urgentes. Le jour J dès 7 h : mode renforcé jusqu'à 2 h du matin
// et titre de la journée en bandeau. Le lendemain : l'admin est invité·e à publier le bilan public.
const nextDay = d => parisDay(parisMs(d, '12:00') + 24 * 60 * MIN);
function cleanMob(b, old = {}) {
  const str = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const date = String(b.date || old.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Date invalide.' };
  const title = str(b.title ?? old.title, 80);
  if (title.length < 3) return { error: 'Donne un titre à la journée (affiché en bandeau).' };
  return { id: old.id || crypto.randomBytes(5).toString('base64url'), date, title, eve: str(b.eve ?? old.eve, 160),
    push: (b.push ?? old.push) !== false, strict: (b.strict ?? old.strict) !== false };
}
async function mobEve(m) {
  const targets = pushAll().filter(s => s.urg !== 0);
  if (!targets.length) return;
  // Le titre et le texte de la journée sont écrits par l'admin (en français) ; le reste suit la langue du téléphone
  const day = l => new Date(parisMs(m.date, '12:00')).toLocaleDateString(LOCALE[l], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const payload = l => JSON.stringify({ title: '📣 ' + tr(l, 'Demain : {t}', { t: m.title }),
    body: m.eve || tr(l, 'Journée de mobilisation {d}. Ouvre Cortège pour voir l’agenda et les numéros utiles.', { d: day(l) }),
    tag: 'mob-' + m.id, url: '/', vibrate: [300, 100, 300] });
  await pushSendAll(targets, payload, true, 'veille de mobilisation');
}
function mobTick() {
  const now = Date.now(), today = parisDay(now), h = parisHour(now) % 24;
  if (mobTick.day !== today) { mobTick.day = today; dirty.global = true; scheduleFlush(); } // bandeau du jour
  let list = mobsAll();
  if (!list.length) return;
  const old = parisDay(now - 30 * 24 * 60 * MIN), kept = list.filter(m => m.date >= old);
  if (kept.length !== list.length) { setMeta('mobs', JSON.stringify(kept)); list = kept; }
  for (const m of list) {
    if (m.push && m.date === nextDay(today) && h >= 20 && h < 23 && !getMeta('mob:eve:' + m.id)) {
      setMeta('mob:eve:' + m.id, now);
      mobEve(m).catch(e => console.error('veille de mobilisation', e.message));
    }
    if (m.strict && m.date === today && h >= 7 && !getMeta('mob:strict:' + m.id)) {
      setMeta('mob:strict:' + m.id, now);
      const until = parisMs(nextDay(today), '02:00');
      if (strictUntil(now) < until) { setMeta('strict', until); orgaLog({ id: 'admin', label: adminLabel() }, 'mode manif renforcé (journée prévue)', { detail: m.title }); }
    }
  }
}
setInterval(() => { try { mobTick(); } catch (e) { console.error('journées', e.message); } }, 60_000).unref();
// Bilans à publier : journées passées depuis moins de 7 jours, pas encore publiées
const mobsToPublish = (now = Date.now()) => { const today = parisDay(now), from = parisDay(now - 7 * 24 * 60 * MIN);
  return mobsAll().filter(m => m.date < today && m.date >= from && !getPub(m.date)).map(m => ({ date: m.date, title: m.title })); };

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
// Reprise des données de l'ancienne version (fichier state.json), une seule fois.
function migrateJson() {
  const f = path.join(DATA_DIR, 'state.json');
  if (!fs.existsSync(f) || getMeta('migrated')) return;
  let s; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  const now = Date.now();
  const done = tx(() => {
    if (getMeta('migrated')) return false;
    for (const r of Object.values(s.reports || {})) if (r.exp > now) saveReport(r);
    for (const a of Object.values(s.ann || {})) if (a.exp > now) q('INSERT OR REPLACE INTO ann(id,exp,data) VALUES(?,?,?)').run(a.id, a.exp, JSON.stringify(a));
    for (const e of Object.values(s.events || {})) if (e.start + EVENT_KEEP > now) saveEvent(e);
    for (const [id, t] of Object.entries(s.importHidden || {})) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(id, t + EVENT_KEEP);
    if (s.paused > now) setMeta('paused', s.paused);
    setMeta('migrated', now);
    return true;
  });
  if (done) { try { fs.renameSync(f, f + '.repris-' + now); } catch {} console.log('Données reprises de state.json'); }
}
setTimeout(() => {
  try { migrateJson(); } catch (e) { console.error('reprise state.json', e.message); }
  try { seedLegal(); } catch (e) { console.error('annuaire', e.message); }
  try { settings(); sweep(); rebuildAll(); } catch (e) { console.error('publication initiale', e.message); }
  try { if (!fs.existsSync(path.join(LIVE_DIR, 'l')) && q('SELECT 1 FROM pois LIMIT 1').get()) placesPublish(); } catch (e) { console.error('lieux', e.message); }
}, 200);
// Veille de l'annuaire : vérifiée toutes les heures, faite une fois par jour (désactivable : LEGAL_WATCH=0)
if (process.env.LEGAL_WATCH !== '0') setInterval(() => legalWatch().catch(e => console.error('veille annuaire', e.message)), 60 * MIN).unref();

// ---- Routes ----
// Filet de sécurité : une erreur imprévue dans une requête est notée dans le journal, elle n'arrête plus le serveur
process.on('unhandledRejection', e => console.error('erreur non gérée :', e && e.stack || e));
// Plantage vraiment imprévu : la cause est gardée pour l'onglet Direct de l'admin, puis systemd relance le serveur
process.on('uncaughtException', e => {
  console.error('plantage :', e && e.stack || e);
  try { setMeta('crash', JSON.stringify({ t: Date.now(), msg: String(e && e.message || e).slice(0, 200), at: String(e && e.stack || '').split('\n')[1]?.trim().slice(0, 160) || '' })); } catch {}
  process.exit(1);
});
const server = http.createServer(async (req, res) => {
  // Adresse lue sans jamais planter : « //%5c.. » et autres chemins piégés des robots d'attaque donnent une erreur 400
  let url; try { url = new URL('http://x' + (String(req.url || '/').startsWith('/') ? req.url : '/' + req.url)); } catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Requête invalide'); }
  const { pathname } = url;
  if (!gate(req, res, pathname)) return;
  try { settings(); } catch {}
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Écritures acceptées seulement depuis l'appli elle-même : un autre site ne peut pas faire poster
  // de faux signalements par les navigateurs de ses visiteurs (CSRF).
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'Requête refusée.' });
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, { error: 'Format refusé.' });
  }

  try {
    if (req.method === 'GET' && pathname === '/api/stream') return streamOpen(req, res, url);
    if (req.method === 'GET' && (pathname === '/presse' || pathname === '/presse/')) return serveStatic(req, res, '/presse.html');
    // Référencement : robots.txt, plan du site, et fichier de validation de Google Search Console (GOOGLE_SITE_VERIFICATION=google0123….html)
    if (req.method === 'GET' && pathname === '/robots.txt')
      return send(res, 200, `User-agent: *\nDisallow: /api/\nAllow: /\n\nSitemap: ${PUBLIC_URL_REAL(req)}/sitemap.xml\n`, { 'Cache-Control': 'public, max-age=3600' });
    if (req.method === 'GET' && pathname === '/sitemap.xml') return send(res, 200, sitemapXml(req), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    if (req.method === 'GET' && GOOGLE_VERIFY && pathname === '/' + GOOGLE_VERIFY) return send(res, 200, 'google-site-verification: ' + GOOGLE_VERIFY);
    if (req.method === 'GET' && (pathname === '/manif' || pathname === '/manif/')) return sendPage(res, pubIndex(req));
    const pubM = req.method === 'GET' && pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})$/);
    if (pubM) { const d = pubFull(pubM[1]); return d ? sendPage(res, pubPage(req, d)) : send(res, 404, 'Bilan non publié'); }
    // Pages de contenu : agenda, arrêtés, villes, droits, legal teams (HTML léger fabriqué par le serveur, sans script)
    if (req.method === 'GET') {
      const pg = { '/agenda': agendaPage, '/arretes': ordersPage, '/droits': rightsPage, '/legal-teams': legalTeamsPage, '/villes': citiesPage }[pathname.replace(/\/$/, '')];
      if (pg) return sendPage(res, pg(req));
      const vm = pathname.match(/^\/ville\/([a-z0-9-]{1,60})\/?$/);
      if (vm) { const c = cityIndex().get(vm[1]); return c ? sendPage(res, cityPage(req, c)) : send(res, 404, 'Ville inconnue'); }
      const dm = pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/donnees\.csv$/);
      if (dm) {
        const d = pubFull(dm[1]);
        if (!d || !d.pts) return send(res, 404, 'Données indisponibles');
        if (!tx(() => bump('csv:' + clientHash(req), 'vote', 30, Date.now()))) return send(res, 429, 'Trop de demandes : réessaie dans quelques minutes.');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cortege-${d.date}.csv"`, 'Cache-Control': 'public, max-age=600' });
        return res.end(pubCsv(d));
      }
      const cm = pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/([a-z0-9-]{1,64})$/);
      if (cm && cm[2] !== 'carte') {
        const d = pubFull(cm[1]), c = d && (d.cityPages || []).find(x => x.slug === cm[2]);
        if (c) return sendPage(res, cityDayPage(req, d, c));
      }
    }
    // Carte d'un créneau, ouverte à tous pour les bilans publiés : la page et ses points (l'image est fabriquée dans le navigateur)
    const pubC = req.method === 'GET' && pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/(carte|points\.json)$/);
    if (pubC) {
      if (!getPub(pubC[1])) return send(res, 404, pubC[2] === 'carte' ? 'Bilan non publié' : { error: 'Bilan non publié.' });
      if (pubC[2] === 'carte') return serveStatic(req, res, '/creneau.html');
      if (!tx(() => bump('pts:' + clientHash(req), 'vote', 150, Date.now()))) return send(res, 429, { error: 'Trop de demandes : réessaie dans quelques minutes.' }, { 'Retry-After': '120' });
      const d = pubWithPts(pubC[1]);
      if (!d.pts) return send(res, 404, { error: 'Les points de cette journée ne sont plus disponibles.' });
      const body = JSON.stringify({ date: d.date, ps: d.ptsS || 1e3, pts: d.pts, cats: CATEGORIES.map(c => ({ id: c.id, label: c.label, group: c.group })) });
      const etag = '"' + h8(body) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120', ETag: etag }); return res.end(body);
    }
    if (req.method === 'POST' && pathname === '/api/orga-requests') {
      if (!tx(() => bump('oreq:' + clientHash(req), 'report', 3, Date.now()))) return send(res, 429, { error: 'Trop de demandes d’un coup. Réessaie plus tard.' });
      return send(res, ...orgaRequest(await readJson(req)));
    }
    const vt = PMTILES && req.method === 'GET' && pathname.match(/^\/vt\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.mvt$/);
    if (vt) return serveVectorTile(req, res, +vt[1], +vt[2], +vt[3]);
    // Tracé du cortège entre la queue et la tête, par les rues de la carte hébergée (positions publiques, rien sur la personne qui demande)
    if (req.method === 'GET' && pathname === '/api/cortege-route') {
      const pt = v => { const m = String(v || '').match(/^(-?\d{1,2}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/); return m && validLatLng(+m[1], +m[2]) ? [+m[1], +m[2]] : null; };
      const a = pt(url.searchParams.get('a')), b = pt(url.searchParams.get('b'));
      if (!a || !b) return send(res, 400, { error: 'Points invalides.' });
      if (!PMTILES) return send(res, 404, { error: 'Pas de carte hébergée.' });
      if (distM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) > 5000) return send(res, 404, { error: 'Trop loin.' });
      const k = a.map(x => x.toFixed(4)).join(',') + '|' + b.map(x => x.toFixed(4)).join(',');
      if (!routeCache.has(k)) {
        if (!quota('route:' + clientHash(req), 120, 5 * MIN)) return send(res, 429, { error: 'Trop de demandes.' });
        let r = null;
        try { const h = await pmOpen(); r = await streetRoute(async (z, x, y) => { const t = await pmTile(z, x, y); return t ? pmDecomp(t, h.tileC) : null; }, Math.min(h.maxz, 15), a, b); }
        catch (e) { console.error('tracé du cortège', e.message); }
        routeCache.set(k, r); if (routeCache.size > 300) routeCache.delete(routeCache.keys().next().value);
      }
      const r = routeCache.get(k);
      return r ? send(res, 200, r, { 'Cache-Control': 'public, max-age=60' }) : send(res, 404, { error: 'Pas de chemin trouvé.' });
    }
    if (req.method === 'GET' && pathname === '/api/config')
      { const S = settings(), banner = bannerNow();
      return send(res, 200, { event: banner || EVENT_NAME, banner: !!banner, center: S.view ? [S.view.lat, S.view.lng] : CENTER, zoom: S.view ? S.view.zoom : ZOOM,
        alertRadius: S.alertRadius || 300, nearKm: nearKm(), poiKinds: POI_KINDS, orderKinds: ORDER_KINDS, deps: DEPS.map(d => [d.c, d.n]), cfgh: cfgHash(),
        brand: BRAND, violenceUrl: VIOLENCE_URL, contact: CONTACT_EMAIL, hostInfo: HOST_INFO, sourceUrl: SOURCE_URL, categories: CATEGORIES, merge: MERGE, offlineTiles: TILE_PREFETCH || !!pmInfo(), groups: GROUPS, eventTypes: EVENT_TYPES, pushKey: VAPID.pub, vibes: VIBES, alertCats: [...ALERT_CATS], stream: STREAM_ON, vector: pmInfo(), version: APP_VERSION, onion: /^[a-z2-7]{56}\.onion$/.test(ONION_HOST) ? ONION_HOST : null, accessLogs: process.env.ACCESS_LOGS === 'none' ? 'none' : '' }, { 'Cache-Control': 'no-cache' }); }

    // ---- Notifications : abonnement / désabonnement (zone arrondie à ≈ 10 km) ----
    if (req.method === 'POST' && (pathname === '/api/push/subscribe' || pathname === '/api/push/unsubscribe')) {
      const b = await readJson(req, 4096);
      const sub = b.sub || {};
      const endpoint = String(sub.endpoint || '');
      let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
      if (!PUSH_HOSTS.test(host) || endpoint.length > 1000) return send(res, 400, { error: 'Service de notification non pris en charge.' });
      const id = sha(endpoint).slice(0, 24);
      if (pathname.endsWith('/unsubscribe')) {
        if (!quota('unsub:' + clientHash(req), 60, 5 * MIN)) return send(res, 429, { error: 'Trop de demandes, réessaie plus tard.' });
        q('DELETE FROM push WHERE id=?').run(id);
        return send(res, 200, { ok: true });
      }
      const k = String(sub.keys?.p256dh || '').replace(/=+$/, ''), a = String(sub.keys?.auth || '').replace(/=+$/, '');
      if (!/^[\w-]{86,88}$/.test(k) || !/^[\w-]{20,24}$/.test(a)) return send(res, 400, { error: 'Abonnement invalide.' });
      const lat = Number(b.lat), lng = Number(b.lng), hasZone = validLatLng(lat, lng);
      const out = tx(() => {
        // limite par réseau : empêche de remplir la liste avec de faux abonnements
        if (!bump('push:' + clientHash(req), 'vote', 10, Date.now())) return 'rate';
        const known = !!q('SELECT 1 FROM push WHERE id=?').get(id);
        if (!known && pushCount() >= PUSH_MAX) return false;
        // Nouveaux abonnements : au plus PUSH_NET_MAX par réseau et par 6 h (une machine ne peut pas remplir la liste)
        if (!known && !quota('pushnet:' + clientHash(req), PUSH_NET_MAX, 6 * 60 * MIN)) { abuseOnce('abonnements en rafale', deviceHash(req), 60 * MIN, { net: clientHash(req) }); return 'rate'; }
        const urg = b.urgent === false ? 0 : 1, near = b.near === true && hasZone ? 1 : 0, ord = b.orders === false || !hasZone ? 0 : 1;
        const lang = PUSH_LANGS.includes(b.lang) ? b.lang : 'fr';
        q(`INSERT INTO push(id,e,k,a,lat,lng,t,urg,near,lang,ord) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET e=excluded.e, k=excluded.k, a=excluded.a,
           lat=excluded.lat, lng=excluded.lng, t=excluded.t, urg=excluded.urg, near=excluded.near, lang=excluded.lang, ord=excluded.ord`).run(id, endpoint, k, a,
          hasZone ? Math.round(lat * 10) / 10 : null, hasZone ? Math.round(lng * 10) / 10 : null, Date.now(), urg, near, lang, ord);
        return true;
      });
      if (out === 'rate') return send(res, 429, { error: 'Trop de demandes, réessaie plus tard.' });
      return out ? send(res, 200, { ok: true }) : send(res, 503, { error: 'Trop d’abonnements, réessaie plus tard.' });
    }

    // Notification de test envoyée par le serveur à ce seul téléphone : vérifie toute la chaîne (serveur → Google/Apple/Mozilla → téléphone)
    if (req.method === 'POST' && pathname === '/api/push/test') {
      const b = await readJson(req, 4096);
      const endpoint = String(b.endpoint || '');
      const row = endpoint && q('SELECT * FROM push WHERE id=?').get(sha(endpoint).slice(0, 24));
      if (!row) return send(res, 404, { error: 'Ce téléphone n’est pas abonné sur le serveur. Désactive puis réactive les notifications.' });
      if (!tx(() => bump('ptest:' + deviceHash(req), 'report', 3, Date.now()) && quota('ptestnet:' + clientHash(req), 20, 5 * MIN))) return send(res, 429, { error: 'Trois essais au plus toutes les 5 minutes.' });
      const l = PUSH_LANGS.includes(row.lang) ? row.lang : 'fr';
      const code = await pushOne(row, JSON.stringify({ title: '🔔 ' + tr(l, 'Test Cortège'), body: tr(l, 'Les notifications marchent : tu seras prévenu·e ici.'), tag: 'test', url: '/',
        vibrate: [200, 100, 200, 100, 600] }), true);
      pushStat('test', [code]);
      if (code === 404 || code === 410) q('DELETE FROM push WHERE id=?').run(row.id);
      const ok = code >= 200 && code < 300;
      return send(res, ok ? 200 : 502, ok ? { ok: true, code }
        : { error: code === 404 || code === 410 ? 'Abonnement expiré chez le service de notification : réactive les notifications.'
          : code === 0 ? 'Le serveur n’arrive pas à joindre le service de notification. Réessaie plus tard.' : `Le service de notification a refusé l’envoi (code ${code}).`, code });
    }

    // Vérification d'installation : ne renvoie jamais d'IP, seulement si un en-tête a été trouvé.
    if (req.method === 'GET' && pathname === '/api/health') {
      let writable = true; try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch { writable = false; }
      // Pour la surveillance (UptimeRobot, mot-clé "ok":true) : ok passe à false si le disque ou la mémoire saturent
      let diskFree = null, memFree = null;
      try { const st = fs.statfsSync(DATA_DIR); diskFree = Math.round(st.bavail / st.blocks * 100); } catch {}
      try { const m = fs.readFileSync('/proc/meminfo', 'utf8'), g = k => +(m.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1];
        memFree = Math.round(g('MemAvailable') / g('MemTotal') * 100); } catch {}
      const healthy = writable && (diskFree == null || diskFree >= 5) && (memFree == null || !Number.isFinite(memFree) || memFree >= 5);
      return send(res, 200, { ok: healthy, diskFreePct: diskFree, memFreePct: Number.isFinite(memFree) ? memFree : null, streams: sseClients.size, nodeOk: !!DatabaseSync, passenger: UNDER_PASSENGER, trustProxy: TRUST_PROXY,
        ipHeaderSeen: !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip']),
        cdn: !!req.headers['cf-connecting-ip'], ipIsPublic: !PRIVATE_IP.test(clientIp(req)), storageWritable: writable,
        database: 'sqlite', activeReports: q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(Date.now()).n });
    }

    if (req.method === 'GET' && pathname === '/api/reports') {
      // Zones demandées : jusqu'à 2 rectangles « s,w,n,e » (zone affichée + zone autour de soi, arrondies côté téléphone).
      const boxes = url.searchParams.getAll('bbox').slice(0, 2).map(b => b.split(',').map(Number))
        .filter(b => b.length === 4 && b.every(Number.isFinite));
      const now = Date.now(), seen = new Map();
      if (boxes.length) for (const [so, w, n, e] of boxes)
        for (const r of q('SELECT * FROM reports WHERE exp>? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 1500').all(now, so, n, w, e)) seen.set(r.id, r);
      else for (const r of activeReports(now, 1500)) seen.set(r.id, r);
      const list = [...seen.values()].slice(0, 1500).map(publicView);
      // Annonce visible si son cercle touche une des zones demandées
      const annIn = a => a.national || !boxes.length || boxes.some(([so, w, n, e]) => {
        const dLat = a.r / 111, dLng = a.r / (111 * Math.cos(a.lat * Math.PI / 180));
        return a.lat + dLat >= so && a.lat - dLat <= n && a.lng + dLng >= w && a.lng - dLng <= e;
      });
      const anns = annActive(now).filter(annIn).map(annView);
      const etag = '"' + h8(JSON.stringify([list, anns])) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      return send(res, 200, { now, reports: list, announcements: anns }, { ETag: etag, 'Cache-Control': 'no-cache' });
    }

    if (req.method === 'GET' && pathname === '/api/version') return send(res, 200, versionInfo(), { 'Cache-Control': 'no-cache' });

    if (req.method === 'GET' && pathname === '/api/geocode') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
      if (q.length < 2) return send(res, 400, { error: 'Tape au moins 2 lettres.' });
      const gk = 'geo:' + clientHash(req);
      if (!geoCache.has('/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=fr&q=' + encodeURIComponent(q)) && !tx(() => bump(gk, 'vote', 30, Date.now())))
        return send(res, 429, { error: 'Trop de recherches, patiente un peu.' });
      const data = await nominatim('/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=fr&q=' + encodeURIComponent(q));
      if (!data) return send(res, 502, { error: 'Recherche indisponible pour l’instant.' });
      return send(res, 200, data.map(d => ({ name: d.display_name.split(',').slice(0, 2).join(','), place: placeName(d.address),
        lat: +d.lat, lng: +d.lon, bbox: d.boundingbox && d.boundingbox.map(Number) })), { 'Cache-Control': 'public, max-age=86400' });
    }

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

    if (req.method === 'GET' && pathname === '/api/digest') {
      if (!ADMIN_KEY) return send(res, 404, { error: 'Digest désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
      if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
      const date = String(url.searchParams.get('date') || parisDay(Date.now()));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Date invalide.' });
      sweep(); // archive ce qui vient d'expirer
      const { rows, zones, abroad } = dayRows(date);
      // Activité des orgas et anti-abus ce jour-là
      const day0 = Date.parse(date + 'T00:00:00+02:00'), lo = day0 - 2 * 3600e3, hi = day0 + 26 * 3600e3;
      const logs = q('SELECT t, oid, action, detail FROM orga_log WHERE t BETWEEN ? AND ?').all(lo, hi).filter(x => parisDay(x.t) === date);
      const cnt = f => logs.filter(f).length;
      const orga = { verified: cnt(x => /^vérifié|^confirmé \(parrainée\)/.test(x.action)), removed: cnt(x => x.oid !== 'admin' && /^retiré|^retrait \(essai\)/.test(x.action)), adminRemoved: cnt(x => x.oid === 'admin' && x.action === 'retiré'),
        announcements: cnt(x => x.action === 'annonce'), urgent: cnt(x => x.action === 'annonce' && /\[urgent\]/.test(x.detail || '')),
        legal: cnt(x => /^legal team/.test(x.action)), restored: cnt(x => x.action === 'restauré'), contested: cnt(x => x.action === 'contesté') };
      const abuse = {};
      for (const x of q('SELECT t, kind FROM abuse WHERE t BETWEEN ? AND ?').all(lo, hi)) if (parisDay(x.t) === date) abuse[x.kind] = (abuse[x.kind] || 0) + 1;
      // Comparaison : les 14 jours précédents
      const history = [];
      for (let i = 14; i >= 0; i--) { const d = parisDay(Date.parse(date + 'T12:00:00+02:00') - i * 86400e3); history.push({ date: d, total: i ? dayCountFr(d) : rows.length }); }
      const events = listEvents().filter(e => parisDay(e.start) === date && e.status !== 'pending').map(e => ({ title: e.title, type: e.type, place: e.place, start: e.start }));
      return send(res, 200, { date, rows, zones, abroad, communes: commIndex().rows.length > 0, orga, abuse, history, events, published: !!getPub(date),
        categories: CATEGORIES.map(({ id, label, glyph, group, ttl }) => ({ id, label, glyph, group, ttl })), groups: GROUPS,
        days: fs.readdirSync(ARCHIVE_DIR).map(f => f.slice(0, 10)).sort().reverse() });
    }

    if (req.method === 'POST' && pathname === '/api/reports') {
      const b = await readJson(req);
      const cat = Object.hasOwn(CAT, String(b.cat)) ? CAT[b.cat] : null;
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!cat) return send(res, 400, { error: 'Catégorie inconnue.' });
      if (cat.off) return send(res, 400, { error: 'Ce type de signalement est désactivé pour l’instant.' });
      if (cat.beaconOnly) return send(res, 400, { error: 'Type inconnu.' });
      if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return send(res, 400, { error: 'Position invalide.' });
      const note = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX);
      const ipH = clientHash(req), dev = deviceHash(req);
      // Orga confirmée (ni en essai, ni parrainée en attente) : son signalement est vérifié d'office et dure deux fois plus longtemps
      const orga = req.headers['x-orga-key'] ? orgaOf(req) : null, sure = !!(orga && !orga.trial && !orga.sponsored);
      const result = tx(() => {
        const base = cat.ttl * MIN, now = Date.now(), ttl = sure ? 2 * base : base;
        const strict = strictUntil(now) > 0;
        // Heure où le signalement a été fait (file d'attente hors ligne). Jamais dans le futur ;
        // mentir dessus ne peut que raccourcir la vie du point.
        const t0 = Math.min(now, Number(b.t) || now);
        if (t0 + ttl <= now) return [410, { error: 'Signalement trop ancien, il n’a pas été publié.', stale: true }];
        if (pausedUntil(now)) return [503, { error: 'Les signalements sont en pause quelques minutes (afflux de faux signalements). Réessaie bientôt.' }];
        if (!allow(dev, ipH, 'report', now)) { abuseOnce('signalements en rafale', dev, RATE.windowMs, { lat, lng }); return [429, { error: 'Trop de signalements d’un coup. Réessaie dans quelques minutes.' }]; }
        // Après la limite d'envois : un identifiant inventé à chaque requête refusée ne remplit pas la table
        const age = deviceAge(dev, now);
        const pos = { lat: round(lat), lng: round(lng) };
        // Un danger n'efface plus une zone calme voisine : le téléphone l'affiche « suspendue » tant que le danger est actif
        // (un faux danger ne peut donc plus faire disparaître une zone calme).

        if (cat.id === 'calme' && CATEGORIES.some(c => isDanger(c.id) && nearby(c.id, pos.lat, pos.lng, CALM_KILL_M, now).some(x => !x.r.ct)))
          return [409, { error: 'Un danger est signalé à moins de 100 m : la zone ne peut pas être marquée calme.' }];
        // Même type tout près : on confirme le point existant au lieu d'en créer un deuxième
        const m = MERGE[cat.id] || { r: 50 };
        const hit = nearby(cat.id, pos.lat, pos.lng, m.r, now)[0];
        if (hit) {
          const r = toReport(hit.r), self = r.voters.includes(dev);
          if (!self) { r.voters.push(dev); r.up++; firstConfirm(r); }
          // Preuve plus fraîche que les « Plus là » : on les efface
          if (t0 >= (r.last || r.t)) { r.down = 0; r.downIps = []; r.dw = 0; r.ct = 0; }
          // Point qui suit (forces mobiles, tête, queue) : il se déplace, sauf s'il est partagé en direct par une orga (sa position fait foi)
          if (m.move && !r.bk && t0 >= (r.last || r.t) && (r.lat !== pos.lat || r.lng !== pos.lng)) { addTrail(r, now); r.lat = pos.lat; r.lng = pos.lng; }
          if (note) addNote(r, note, dev, t0);
          r.last = Math.max(r.last || r.t, t0);
          r.exp = Math.max(r.exp, t0 + ttl);
          if (sure) {
            r.exp = Math.min(r.exp, Math.max(r.t + 4 * base, t0 + ttl));
            if (!r.ver) { repAdd(r.voters[0], 'good', 2); r.ver = orga.label; orgaLog(orga, 'vérifié (signalement)', { r }); }
            if (r.fl === -1) r.fl = 0;
          }
          saveReport(r);
          return [200, { ...publicView(r), merged: true, self }];
        }

        const cell = cellId(pos.lat, pos.lng);
        if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND ip=? AND exp>?').get(cell, ipH, now).n >= (strict ? Math.ceil(MAX_PER_NET_ZONE / 2) : MAX_PER_NET_ZONE))
          return [429, { error: 'Trop de signalements depuis ton réseau dans cette zone. Confirme plutôt ceux qui existent.' }];
        if (q('SELECT COUNT(*) n FROM reports WHERE cell=? AND exp>?').get(cell, now).n >= MAX_PER_ZONE) {
          // Zone pleine : on fait de la place en retirant le plus ancien point que personne n'a confirmé ni vérifié
          const old = q('SELECT id FROM reports WHERE cell=? AND exp>? AND ver IS NULL AND up=0 ORDER BY t LIMIT 1').get(cell, now);
          if (!old) return [503, { error: 'Zone saturée, réessaie dans quelques minutes.' }];
          dropReport(old.id, 'full');
        }
        if (q('SELECT COUNT(*) n FROM reports WHERE exp>?').get(now).n >= MAX_REPORTS) return [503, { error: 'Carte saturée, réessaie plus tard.' }];
        const r = { id: crypto.randomBytes(6).toString('base64url'), cat: cat.id, lat: pos.lat, lng: pos.lng, note, notes: note ? [{ x: note, t: t0, d: dev }] : [],
          t: t0, last: t0, exp: t0 + ttl, up: 0, down: 0, voters: [dev], downIps: [], ip: ipH };
        // Fiabilité : téléphone fiable aujourd'hui, ou au contraire série suspecte près des zones calmes / téléphone neuf en mode renforcé
        const trusted = devRep(dev) >= TRUST;
        if (isDanger(cat.id)) {
          const calms = nearby('calme', pos.lat, pos.lng, CALM_KILL_M, now).filter(x => !x.r.ct);
          for (const x of calms) abuseLog('danger près zone calme', { lat: pos.lat, lng: pos.lng, dev, net: ipH, ref: x.r.id });
          if (calms.length && !trusted && calmSeries(dev, ipH, now)) { r.fl = -1; abuseOnce('série de dangers près des zones calmes', dev, SERIES.win, { lat: pos.lat, lng: pos.lng }); }
        }
        if (!r.fl && strict && !trusted && age < CONTEST.newDev) r.fl = -1;
        if (!r.fl && trusted) r.fl = 1;
        if (sure) { r.ver = orga.label; r.fl = 1; r.oid = orga.id; r.notes.forEach(n => { n.d = 'o:' + orga.id; }); }
        saveReport(r);
        if (sure) orgaLog(orga, 'signalement', { r });
        // Notification « danger près de toi » : seulement pour un téléphone qui n'est pas tout neuf (ou fiable), jamais pour un signalement non fiable
        if (ALERT_CATS.has(cat.id) && r.fl !== -1 && (age >= CONTEST.newDev || trusted || sure)) pushNearLater(r);
        if (sure) return [201, { ...publicView(r), mine: true }];
        return [201, publicView(r)];
      });
      return send(res, ...result);
    }

    // Agenda : une orga publie directement, un·e participant·e propose (validé ensuite par l'admin)
    // Proposer un arrêté ou une restriction (validé par l'admin avant d'apparaître)
    if (req.method === 'POST' && pathname === '/api/orders') return send(res, ...await createOrder(await readJson(req, 8192), { dev: deviceHash(req), ipH: clientHash(req) }));

    if (req.method === 'POST' && pathname === '/api/events') {
      const b = await readJson(req, 16384);
      const orga = req.headers['x-orga-key'] ? orgaOf(req) : null;
      if (req.headers['x-orga-key'] && !orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });
      const out = createEvent(b, orga, deviceHash(req), clientHash(req));
      if (orga && out[0] < 300) orgaLog(orga, out[1].status === 'pending' ? 'événement (en attente)' : 'événement', { lat: out[1].lat, lng: out[1].lng, ref: out[1].id, detail: out[1].title });
      return send(res, ...out);
    }

    // Ajouter une précision à un point existant (une par téléphone, la sienne peut être corrigée)
    const noteRoute = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/note$/);
    if (req.method === 'POST' && noteRoute) {
      const b = await readJson(req);
      const text = String(b.note || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
      if (text.length < 2) return send(res, 400, { error: 'Écris une précision.' });
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = tx(() => {
        const now = Date.now(), r = getReport(noteRoute[1], now);
        if (!r) return [404, { error: 'Signalement expiré.' }];
        if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop d’envois, patiente un peu.' }];
        addNote(r, text, dev, now);
        saveReport(r);
        return [200, publicView(r)];
      });
      return send(res, ...result);
    }

    const vote = pathname.match(/^\/api\/reports\/([\w-]{1,16})\/vote$/);
    if (req.method === 'POST' && vote) {
      const b = await readJson(req);
      const ipH = clientHash(req), dev = deviceHash(req);
      const result = tx(() => {
        const now = Date.now();
        const r = getReport(vote[1], now);
        if (!r) return [404, { error: 'Signalement expiré.' }];
        if (r.voters.includes(dev)) return [409, { error: 'Déjà pris en compte.' }];
        if (!allow(dev, ipH, 'vote', now)) return [429, { error: 'Trop de votes, patiente un peu.' }];
        const age = deviceAge(dev, now), strict = strictUntil(now) > 0, trusted = devRep(dev) >= TRUST;
        r.voters.push(dev);
        if (b.v === 1) {
          r.up++; r.last = now; firstConfirm(r);
          const ttl = CAT[r.cat].ttl * MIN;
          r.exp = Math.min(Math.max(r.exp, now + ttl), r.t + 4 * ttl); // prolonge, plafonné à 4× la durée de base
          if (r.ct && (r.dw || 0) < contestNeed(r)) r.ct = 0; // confirmé : plus contesté
        } else {
          // Un téléphone ou un réseau qui conteste beaucoup de points d'affilée n'est plus compté. On ne le lui dit pas.
          const k = strict ? 2 / 3 : 1;
          const devOk = bump('dn:' + dev, 'vote', Math.ceil(CONTEST.devBurst * k), now), netOk = bump('dnn:' + ipH, 'vote', Math.ceil(CONTEST.netBurst * k), now);
          if (!devOk || !netOk) { abuseOnce('« Plus là » en rafale', dev, RATE.windowMs, { lat: r.lat, lng: r.lng }); saveReport(r); return [200, { ...publicView(r), down: r.down + 1 }]; }
          const before = { ...r, voters: r.voters.slice(0, -1) };
          r.down++;
          const aged = age >= CONTEST.newDev;
          // Poids : sur place ×2, identifiant pas tout neuf ×2, téléphone fiable +2 ; en mode renforcé un identifiant neuf ne compte pas
          let w = (b.here === true ? CONTEST.near : 1) * (aged ? CONTEST.aged : 1) + (trusted ? 2 : 0);
          if (strict && !aged && !trusted) w = 0;
          r.dw = (r.dw || 0) + w;
          (r.downIps ||= []).push(ipH);
          // Un signalement vérifié par une orga ne peut pas être contesté par les votes.
          const nets = new Set(r.downIps).size, need = contestNeed(r);
          if (!r.ver && r.dw >= need && nets >= 2) {
            if (!r.ct) { r.ct = now; snapshotContested(before, now); orgaLog(VOTES, 'contesté', { r, detail: nets + ' réseaux' }); repAdd(r.voters[0], 'bad'); abuseLog('point contesté', { lat: r.lat, lng: r.lng, ref: r.id }); }
            r.exp = Math.min(r.exp, now + (r.dw >= need + CONTEST.more && nets >= 3 ? CONTEST.short : CONTEST.soft));
          }
        }
        saveReport(r);
        return [200, publicView(r)];
      });
      return send(res, ...result);
    }

    // ---- Invitation d'orga : le jeton du QR code est échangé une seule fois contre une clé ----
    if (req.method === 'POST' && pathname === '/api/invite') {
      if (keyLocked(req)) return send(res, 429, { error: 'Trop d’essais, réessaie dans quelques minutes.' });
      const b = await readJson(req);
      const token = String(b.token || '');
      if (!/^[\w-]{20,40}$/.test(token)) { keyFailed(req); return send(res, 400, { error: 'Invitation invalide.' }); }
      const key = crypto.randomBytes(18).toString('base64url'), h = sha(token);
      let device = false;
      const o = withLock(() => {
        const list = readOrgas().slice(), now = Date.now();
        let i = list.findIndex(x => x.invite && keyEq(x.invite.h, h) && x.invite.exp > now);
        if (i >= 0) { const { invite, ...rest } = list[i]; list[i] = { ...rest, hash: sha(key), keys: [], activated: rest.activated || now }; writeOrgas(list); return list[i]; }
        // Ajout d'un appareil : la clé principale reste valable, on en ajoute une (5 appareils au plus)
        i = list.findIndex(x => x.devInv && keyEq(x.devInv.h, h) && x.devInv.exp > now);
        if (i >= 0) { const { devInv, ...rest } = list[i]; list[i] = { ...rest, keys: [...(rest.keys || []), sha(key)].slice(-(DEVICE_MAX - 1)) }; writeOrgas(list); device = true; return list[i]; }
        return null;
      });
      if (!o) { keyFailed(req); return send(res, 404, { error: 'Lien expiré ou déjà utilisé. Demande-en un nouveau.' }); }
      orgaLog({ id: o.id, label: o.label }, device ? 'appareil ajouté' : 'invitation utilisée');
      return send(res, 200, { key, label: o.label, device });
    }

    // ---- Espace orga / legal team ----
    if (pathname.startsWith('/api/orga') || pathname.startsWith('/api/announcements') || /^\/api\/events\/[\w-]{1,16}$/.test(pathname)
      || /^\/api\/reports\/[\w-]{1,16}\/(verify|remove|extend|edit)$/.test(pathname)) {
      const orga = orgaOf(req);
      if (!orga) return send(res, 403, { error: 'Lien orga invalide ou expiré.' });

      if (req.method === 'GET' && pathname === '/api/orga/me') {
        const me = readOrgas().find(x => x.id === orga.id);
        return send(res, 200, { label: orga.label, ob: ownerTag(orga.admin ? 'admin' : orga.id), admin: orga.admin, trial: orga.trial, sponsored: !!orga.sponsored,
          sponsor: me && me.by ? (readOrgas().find(x => x.id === me.by)?.label || me.byLabel || null) : null,
          canInvite: !orga.trial && !banUntil(orga.id), ban: banUntil(orga.id), canAddDevice: !!me, devices: me && me.hash ? 1 + (me.keys || []).length : 0 });
      }

      // Ses propres annonces, y compris les numéros en attente de validation
      if (req.method === 'GET' && pathname === '/api/orga/mine') {
        return send(res, 200, { a: annAll(Date.now()).filter(a => orga.admin ? true : a.oid === orga.id).sort((a, b) => b.t - a.t).map(annView) });
      }

      // --- Parrainage : une orga confirmée invite une autre orga (QR code / lien à usage unique, 24 h) ---
      if (req.method === 'POST' && pathname === '/api/orga/invite') {
        if (orga.trial) return send(res, 400, { error: 'Seules les orgas confirmées peuvent inviter.' });
        const ban = banUntil(orga.id);
        if (ban) return send(res, 400, { error: 'Invitations suspendues jusqu’au ' + new Date(ban).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' (une orga que tu as invitée a été révoquée).' });
        const b = await readJson(req);
        const label = String(b.label || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
        if (label.length < 2) return send(res, 400, { error: 'Donne un nom à l’orga invitée.' });
        const { token, invite } = newInvite();
        const out = withLock(() => {
          const list = readOrgas().slice();
          if (labelClash(label, { sponsor: true })) return 'dup';
          if (!orga.admin && list.filter(o => o.by === orga.id && o.created > Date.now() - SPONSOR.quotaMs).length >= SPONSOR.quota) return 'quota';
          const o = { id: crypto.randomBytes(5).toString('base64url'), label, hash: null, created: Date.now(), trial: true, sponsored: true, by: orga.id, byLabel: orga.label, invite };
          list.push(o); writeOrgas(list); return o;
        });
        if (out === 'dup') return send(res, 409, { error: labelClash(label, { sponsor: true }) || 'Une orga porte déjà ce nom.' });
        if (out === 'quota') return send(res, 429, { error: `${SPONSOR.quota} invitations par semaine au maximum. Réessaie dans quelques jours.` });
        orgaLog(orga, 'invitation (parrainage)', { ref: out.id, detail: out.label });
        return send(res, 201, { id: out.id, label: out.label, invite: token, exp: invite.exp });
      }
      if (req.method === 'GET' && pathname === '/api/orga/filleules') {
        const list = readOrgas().filter(o => o.by === orga.id);
        return send(res, 200, { orgas: list.map(o => ({ id: o.id, label: o.label, created: o.created, active: !!o.hash, trial: o.trial === true,
          invite: o.invite && o.invite.exp > Date.now() ? o.invite.exp : null, ...orgaReady(o),
          recent: q('SELECT t, action, cat FROM orga_log WHERE oid=? ORDER BY t DESC LIMIT 15').all(o.id) })) });
      }
      const fil = pathname.match(/^\/api\/orga\/filleules\/([\w-]{1,16})\/(confirm|invite)$/);
      if (req.method === 'POST' && fil) {
        const target = readOrgas().find(o => o.id === fil[1] && o.by === orga.id);
        if (!target) return send(res, 404, { error: 'Orga introuvable parmi tes invitées.' });
        if (fil[2] === 'confirm') {
          if (!target.trial) return send(res, 400, { error: 'Déjà confirmée.' });
          if (!orgaReady(target).ready) return send(res, 400, { error: 'Pas encore prête : il faut au moins 7 jours, 10 actions et aucun incident. Seul·e l’admin peut la confirmer avant.' });
          withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], trial: false }; writeOrgas(l); } });
          orgaLog(orga, 'confirmée (parrainage)', { ref: target.id, detail: target.label });
          return send(res, 200, { id: target.id, trial: false });
        }
        // Nouvelle invitation (la filleule a perdu son accès) : l'ancien accès est coupé
        const { token, invite } = newInvite();
        withLock(() => { const l = readOrgas().slice(), i = l.findIndex(x => x.id === target.id); if (i >= 0) { l[i] = { ...l[i], hash: null, keys: [], invite }; writeOrgas(l); } });
        orgaLog(orga, 'nouvelle invitation (parrainage)', { ref: target.id, detail: target.label });
        return send(res, 200, { id: target.id, label: target.label, invite: token, exp: invite.exp });
      }
      // --- Ajouter un appareil : lien à usage unique, 10 minutes, la clé actuelle reste valable ---
      // --- Position en direct (orgas confirmées) : tête ou queue de cortège, street medic, legal team, presse ---
      // Le téléphone de l'orga envoie sa position toutes les 30 s tant que l'appli est ouverte ; le point disparaît 3 min après
      // le dernier envoi, et le partage s'arrête de lui-même au bout de 8 h. Seule la dernière position est gardée
      // (plus la trace des 30 dernières minutes pour la tête et la queue, jamais pour une personne).
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
          const cur = toReport(q('SELECT * FROM reports WHERE oid=? AND cat=? AND bk>0 AND exp>?').get(orga.id, role, now));
          if (req.method === 'DELETE') { if (cur) { dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position', { r: cur }); } return [200, { stopped: true }]; }
          const lat = Number(b.lat), lng = Number(b.lng);
          if (!validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
          if (cur && now - cur.bk > BEACON_MAX) { dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position', { r: cur }); return [410, { error: 'Partage arrêté au bout de 4 h. Relance-le si besoin.' }]; }
          // Garde-fou : à plus de 2 km du point de départ (et du parcours d'une manif en cours), le partage s'arrête tout seul
          // et cette position n'est jamais enregistrée (une orga qui oublie de l'arrêter ne révèle pas où elle rentre)
          if (cur && cur.bkla != null && distM({ lat: cur.bkla, lng: cur.bklo }, { lat, lng }) > BEACON_ZONE_M && routeDistM(lat, lng, now) > BEACON_ZONE_M) {
            dropReport(cur.id, 'exp'); orgaLog(orga, 'fin du partage de position (hors zone)', { r: cur });
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
          saveReport(r); orgaLog(orga, 'partage de position', { r });
          return [201, publicView(r)];
        });
        return send(res, ...out);
      }
      if (req.method === 'POST' && pathname === '/api/orga/device') {
        const token = crypto.randomBytes(18).toString('base64url');
        const ok = withLock(() => {
          const l = readOrgas().slice(), i = l.findIndex(x => x.id === orga.id);
          if (i < 0) return false;
          l[i] = { ...l[i], devInv: { h: sha(token), exp: Date.now() + DEVICE_MS } }; writeOrgas(l); return true;
        });
        if (!ok) return send(res, 400, { error: 'Pas possible pour un accès défini par l’admin dans les réglages du serveur.' });
        orgaLog(orga, 'lien d’appareil créé');
        return send(res, 200, { invite: token, exp: Date.now() + DEVICE_MS });
      }

      if (req.method === 'POST' && pathname === '/api/announcements') {
        const b = await readJson(req);
        // Période d'essai : pas d'annonce urgente (notification à toute la zone), numéro de legal team validé par l'admin
        if (orga.trial && b.kind !== 'legal' && b.level === 'urgent')
          return send(res, 400, { error: 'Pendant la période d’essai, les annonces urgentes ne sont pas possibles. Publie-la en « info ».' });
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
          if (act[2] === 'verify') { if (!r.ver) repAdd(r.voters[0], 'good', 2); r.ver = orga.label; if (r.fl === -1) r.fl = 0; saveReport(r); orgaLog(orga, 'vérifié', { r }); return [200, publicView(r)]; }
          // Période d'essai : « Retirer » compte comme deux « Plus là », sans retrait direct
          if (orga.sponsored && !bump('orm:' + orga.id, 'report', SPONSOR.removeMax, Date.now())) {
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
      return send(res, 404, { error: 'Inconnu.' });
    }

    const tile = pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (req.method === 'GET' && tile) {
      // Hors cPanel (pas d'Apache devant), Node sert lui-même la tuile déjà sur disque
      const f = path.join(TILE_DIR, tile[1], tile[2], tile[3] + '.png');
      if (TILE_DISK) try { const buf = fs.readFileSync(f); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' }); return res.end(buf); } catch {}
      return serveTile(req, res, tile[1], tile[2], tile[3]);
    }

    // Fichiers live/ : servis par Apache sur cPanel ; Node ne les sert que s'il est seul (VPS, local).
    const live = pathname.match(/^\/live\/((?:[crpl]\/)?[\w-]{1,40}\.json)$/);
    if (req.method === 'GET' && live) {
      const f = path.join(LIVE_DIR, live[1]);
      if ((live[1] === 'index.json' || live[1] === 'g.json') && !fs.existsSync(f)) try { rebuildAll(); } catch {}
      fs.readFile(f, (err, buf) => {
        if (err) return send(res, 200, live[1].startsWith('l/') ? { p: [] } : live[1].startsWith('c/') || live[1].startsWith('p/') ? { r: [] } : live[1].startsWith('r/') ? { c: {} } : {}, { 'Cache-Control': 'no-cache' });
        const etag = '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16) + '"';
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag }); res.end(buf);
      });
      return;
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname);
    send(res, 405, 'Method not allowed');
  } catch (e) {
    const busy = isBusy(e);
    if (!busy && !/bad json|too large/.test(e.message)) console.error('requête', req.method, pathname, e.message);
    send(res, busy ? 503 : 400, { error: busy ? 'Serveur occupé, réessaie.' : 'Requête invalide.' });
  }
});

// Connexions lentes ou abandonnées : on ne les garde pas indéfiniment
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;
try { migrateOwners(); } catch (e) { console.error('auteurs', e.message); }
server.listen(PORT, process.env.HOST || undefined, () => console.log(`Cortège en écoute — ${EVENT_NAME} — données : ${DATA_DIR}`));
