'use strict';
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { MIN, TILE_UA } = require('../config');
const { PLACES } = require('../geo/cities');
const { TILE_ZONES } = require('../geo/tiles');
const { getMeta } = require('../db');

// ---- Lieux permanents : lieux de pouvoir et lieux utiles aux manifestant·es, depuis OpenStreetMap ----
// Importés une fois par mois (Overpass), corrigeables et masquables dans l'admin. Publiés par région de 1° :
// l/<région>.json (pouvoir + hôpitaux, visibles dès le zoom 13) et l/<région>-s.json (pharmacies, eau : zoom rue).
const POI_KINDS = [
  { id: 'mairie', label: 'Mairie', glyph: '🏛', grp: 'pouvoir' },
  { id: 'pref', label: 'Préfecture', glyph: '🏢', grp: 'pouvoir' },
  { id: 'spref', label: 'Sous-préfecture', glyph: '🏢', grp: 'pouvoir' },
  { id: 'police', label: 'Commissariat', glyph: '👮', grp: 'pouvoir' },
  { id: 'gend', label: 'Gendarmerie', glyph: '👮', grp: 'pouvoir' },
  { id: 'tribunal', label: 'Tribunal', glyph: '🔨', grp: 'pouvoir' },
  { id: 'cra', label: 'Centre de rétention (CRA)', glyph: '🔒', grp: 'pouvoir' },
  { id: 'hopital', label: 'Hôpital', glyph: '🏥', grp: 'aide' },
  { id: 'pharma', label: 'Pharmacie', glyph: '💊', grp: 'aide', street: true },
  { id: 'eau', label: 'Eau potable', glyph: '🚰', grp: 'aide', street: true },
  { id: 'cam', label: 'Caméra de surveillance', glyph: '📷', grp: 'surv', cam: true },
];
const POI = Object.fromEntries(POI_KINDS.map(k => [k.id, k]));
const PLACES_IMPORT = process.env.PLACES_IMPORT !== '0';
// overpass.private.coffee d'abord : overpass-api.de met parfois les requêtes en attente jusqu'au délai (et refuse l'IPv6 de certains hébergeurs)
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass.private.coffee/api/interpreter,https://overpass-api.de/api/interpreter';
const PLACES_EVERY = 30 * 24 * 60 * MIN;
const poiRg = (lat, lng) => `${Math.floor(lat)}_${Math.floor(lng)}`;
function poiKind(t) {
  const name = t.name || '';
  // Caméras qui filment la rue (publiques, ou privées tournées vers l'extérieur) ; pas les caméras intérieures ni les vigiles
  if (t.man_made === 'surveillance') return t.surveillance === 'indoor' || /^(guard|mobile)$/.test(t['surveillance:type'] || '') ? null : 'cam';
  if (/r[ée]tention administrative/i.test(name)) return 'cra';
  if (t.office === 'government' && t.government === 'prefecture') return /sous[- ]pr[ée]fecture/i.test(name) ? 'spref' : 'pref';
  if (t.amenity === 'townhall') return /^(village_hall|community_centre)$/.test(t['townhall:type'] || '') ? null : 'mairie';
  if (t.amenity === 'police') return /gendarmerie/i.test(name + ' ' + (t.operator || '') + ' ' + (t['police:FR'] || '')) ? 'gend' : 'police';
  if (t.amenity === 'courthouse') return 'tribunal';
  if (t.amenity === 'hospital') return 'hopital';
  if (t.amenity === 'pharmacy') return 'pharma';
  if (t.amenity === 'drinking_water') return /^(private|no)$/.test(t.access || '') || t.drinking_water === 'no' ? null : 'eau';
  return null;
}
const poiStr = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function poiData(t, kind) {
  const d = {};
  const n = poiStr(t['name:fr'] || t.name, 80); if (n) d.n = n;
  const h = poiStr(t.opening_hours, 120); if (h && kind !== 'eau') d.h = h;
  const p = poiStr(t['contact:phone'] || t.phone, 30); if (p && /^[+\d][\d .()-]{5,}$/.test(p)) d.p = p;
  if (kind === 'hopital' && t.emergency === 'yes') d.e = 1;
  if (kind === 'eau' && t.seasonal === 'yes') d.s = 1;
  if (kind === 'cam') {
    delete d.n; delete d.h; delete d.p;
    if (t.surveillance === 'public') d.c = 1; // police, mairie, transports publics
    const o = poiStr(t.operator, 40); if (o) d.o = o;
    const COMPASS = { N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157, S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337 };
    const rd = String(t['camera:direction'] || t.direction || '').trim().toUpperCase();
    const dir = Object.hasOwn(COMPASS, rd) ? COMPASS[rd] : /^\d{1,3}(\.\d+)?$/.test(rd) ? Math.round(+rd) % 360 : null;
    if (dir != null) d.dir = dir;
    const ct = t['camera:type']; if (/^(dome|fixed|panning)$/.test(ct || '')) d.ct = ct[0];
  }
  return d;
}
// Requête Overpass pour un carré : France, Belgique, Suisse, Luxembourg, Monaco (et l'outre-mer, inclus dans la France)
function overpassQuery(s, w, n, e) {
  // Simple rectangle, sans filtre par pays (le calcul des frontières rendait chaque requête trop lente pour Overpass) :
  // seuls les carrés qui contiennent une ville de France, Belgique, Suisse, Luxembourg ou Monaco sont demandés (voir placeChunks)
  const b = `(${s},${w},${n},${e})`;
  // Valeurs exactes plutôt qu'une expression régulière : Overpass utilise alors son index, bien plus vite
  return `[out:json][timeout:170];
(${['townhall', 'police', 'courthouse', 'hospital', 'pharmacy', 'drinking_water'].map(v => `nwr["amenity"="${v}"]${b};`).join('\n ')}
 nwr["office"="government"]["government"="prefecture"]${b};
 nwr["amenity"="prison"]["name"~"tention",i]${b};
 nwr["office"="government"]["name"~"tention",i]${b};);
out center tags qt;`;
}
// Plusieurs serveurs Overpass possibles (séparés par des virgules) : si l'un refuse ou ne répond pas, on passe au suivant
const OVERPASS_URLS = OVERPASS_URL.split(',').map(x => x.trim()).filter(Boolean);
function overpass(query, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), body = 'data=' + encodeURIComponent(query);
    const req = (u.protocol === 'http:' ? http : https).request({ method: 'POST', hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, timeout: 190_000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': TILE_UA, 'Accept-Encoding': 'gzip' } }, res => {
      const chunks = []; let size = 0;
      const src = /gzip/.test(res.headers['content-encoding'] || '') ? res.pipe(zlib.createGunzip()) : res;
      src.on('data', c => { size += c.length; if (size > 200e6) req.destroy(new Error('réponse trop grosse')); else chunks.push(c); });
      src.on('end', () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error('Overpass ' + res.statusCode), { status: res.statusCode }));
        let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reject(e); }
        // Requête interrompue côté Overpass (trop longue, serveur chargé) : réponse 200 mais incomplète
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) return reject(new Error('Overpass : ' + j.remark.slice(0, 120)));
        resolve(j);
      });
      src.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end(body);
  });
}
// Carrés de 1° couvrant les zones de la carte (petites requêtes : plus rapides, et un échec ne coûte qu'un carré)
function placeChunks() {
  const out = [];
  for (const [la1, la2, lo1, lo2] of TILE_ZONES)
    for (let a = la1; a < la2; a += 1) for (let o = lo1; o < lo2; o += 1)
      out.push([a, o, Math.min(a + 1, la2), Math.min(o + 1, lo2)].map(x => Math.round(x * 100) / 100));
  // Carrés sans aucune ville de la liste (mer, Angleterre, Allemagne, Espagne…) : ignorés
  const near = ([s, w, n, e]) => PLACES.some(([, la, lo]) => la >= s - 0.15 && la <= n + 0.15 && lo >= w - 0.15 && lo <= e + 0.15);
  return PLACES.length ? out.filter(near) : out;
}
const placesStatus = () => { try { return JSON.parse(getMeta('poisimp') || 'null'); } catch { return null; } };
const placesRun = () => { try { return JSON.parse(getMeta('poisrun') || 'null'); } catch { return null; } };
const placesState = { running: null }; // import en cours (partagé entre les modules)

module.exports = { POI_KINDS, POI, PLACES_IMPORT, PLACES_EVERY, poiRg, poiKind, poiStr, poiData, overpassQuery, OVERPASS_URLS, overpass, placeChunks, placesStatus, placesRun, placesState };
