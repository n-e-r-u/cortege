'use strict';
// ---- Cartes hébergées : téléchargement depuis l'admin ----
// Chaque carte est découpée dans le dernier build quotidien de Protomaps (données OpenStreetMap) avec l'outil pmtiles,
// installé une fois sur le serveur. Une estimation de la taille est faite d'abord (aucun téléchargement si le disque
// ne suffit pas), puis l'extraction tourne en arrière-plan avec une priorité basse. Le fichier n'entre en service
// qu'une fois complet : la carte en place continue d'être servie jusque-là, et l'appli recharge la liste sans redémarrer.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const { DATA_DIR, ROOT, TILE_UA } = require('../config');
const { getMeta, setMeta } = require('../db');
const { pmReload, pmFilesInfo } = require('./pmtiles');

const MAP_DIR = process.env.MAP_DIR || path.join(DATA_DIR, 'cartes');
const PMTILES_BIN = process.env.PMTILES_BIN || 'pmtiles';
const BUILDS_URL = process.env.MAP_BUILDS_URL || 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_BASE = (process.env.MAP_BUILD_BASE || 'https://build.protomaps.com/').replace(/\/?$/, '/');
const MAX_ZOOM = Math.min(15, Math.max(10, Number(process.env.MAP_MAXZOOM) || 15));
const WORLD_ZOOM = Math.min(8, Math.max(4, Number(process.env.MAP_WORLD_MAXZOOM) || 6));
const PMTILES_VERSION = '1.31.2';
// Fichier de zone livré pour certains pays (contour soigné, outre-mer compris) ; sinon le contour du profil
const REGION_FILES = { fr: 'france', de: 'germany' };

const downloaded = () => { try { return JSON.parse(getMeta('maps') || '[]'); } catch { return []; } };
const saveDownloaded = list => setMeta('maps', JSON.stringify(list));

// Outil pmtiles : présent ? (vérifié au plus une fois par minute)
let toolCache = { t: 0, v: null };
function tool() {
  if (Date.now() - toolCache.t < 60_000) return toolCache.v;
  let v = null;
  try { const r = spawnSync(PMTILES_BIN, ['version'], { timeout: 5000, encoding: 'utf8' }); if (r.status === 0) v = (r.stdout.match(/pmtiles\s+([\d.]+)/) || [])[1] || 'inconnue'; } catch {}
  toolCache = { t: Date.now(), v };
  return v;
}
const installCmd = () => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  return `curl -fsSL https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${arch}.tar.gz | sudo tar xz -C /usr/local/bin pmtiles`;
};

// Cartes proposées : un fichier par pays actif, plus la carte du monde (zooms éloignés)
function targets() {
  const { adminProfiles } = require('../profiles');
  const list = adminProfiles().filter(p => p.active).map(p => ({ code: p.code, name: (p.current && p.current.name) || p.code, file: (REGION_FILES[p.code] || p.code) + '.pmtiles' }));
  list.push({ code: 'monde', name: 'Monde (zooms éloignés)', file: 'monde.pmtiles', world: true });
  return list;
}
// Zone à extraire (GeoJSON) : fichier livré, sinon rectangles autour des morceaux du pays (marge de 0,3° : les contours
// simplifiés coupent parfois une ville côtière)
function regionGeojson(code) {
  const f = REGION_FILES[code] && path.join(ROOT, 'tools', REGION_FILES[code] + '.geojson');
  if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const { PROFILES } = require('../profiles');
  const p = (PROFILES || []).find(x => x.code === code) || null;
  let polys = p && p.polys;
  if (!polys && p && p.area) {
    try { const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo', 'countries', `${p.area}-50m.json`), 'utf8')).geometry; polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; } catch {}
  }
  if (!polys || !polys.length) return null;
  const m = 0.3, rects = polys.map(pl => {
    const xs = pl[0].map(c => c[0]), ys = pl[0].map(c => c[1]);
    const w = Math.max(-180, Math.min(...xs) - m), e = Math.min(180, Math.max(...xs) + m), s = Math.max(-85, Math.min(...ys) - m), n = Math.min(85, Math.max(...ys) + m);
    return [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
  });
  return JSON.stringify({ type: 'Feature', properties: { name: code }, geometry: { type: 'MultiPolygon', coordinates: rects } });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('http:') ? require('http') : https).get(url, { headers: { 'User-Agent': TILE_UA }, timeout: 20_000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('liste des cartes : HTTP ' + res.statusCode)); }
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; if (b.length > 5e6) req.destroy(new Error('réponse trop grosse')); });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', e => reject(new Error('liste des cartes : ' + e.message)));
  });
}
// Dernier build (« AAAAMMJJ.pmtiles ») du schéma de carte que l'appli sait dessiner (version 4)
async function latestBuild() {
  if (process.env.MAP_SOURCE) return { key: path.basename(process.env.MAP_SOURCE), src: process.env.MAP_SOURCE };
  const list = await getJson(BUILDS_URL);
  const ok = (Array.isArray(list) ? list : []).filter(b => b && /^\d{8}\.pmtiles$/.test(b.key || ''));
  const v4 = ok.filter(b => /^4\./.test(String(b.version || '')));
  const best = (v4.length ? v4 : ok).sort((a, b) => (a.key < b.key ? 1 : -1))[0];
  if (!best) throw new Error('aucune carte disponible chez Protomaps pour l’instant');
  return { key: best.key, src: BUILD_BASE + best.key };
}

// « 3.2 GB », « 820 MB » (unités décimales de l'outil) → octets
const SI = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
const parseSize = txt => { const m = String(txt).match(/archive size of ([\d.]+)\s*([kKMGT]?B)/); return m ? Math.round(+m[1] * SI[m[2]]) : null; };

// ---- Travail en cours (un seul à la fois) ----
let job = null, child = null;
const saveJob = () => setMeta('mapjob', JSON.stringify(job));
{ // Redémarrage pendant un téléchargement : le fichier partiel est effacé, la carte en place n'a pas bougé
  let j = null; try { j = JSON.parse(getMeta('mapjob') || 'null'); } catch {}
  if (j && !j.end) {
    try { fs.unlinkSync(path.join(MAP_DIR, j.file + '.part')); } catch {}
    job = { ...j, end: Date.now(), err: 'interrompu par un redémarrage du serveur (relance-le)' }; saveJob();
  } else job = j;
}
function run(args, onLine) {
  return new Promise((resolve, reject) => {
    child = spawn('nice', ['-n', '15', PMTILES_BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = d => { const s = String(d); out = (out + s).slice(-20000); if (onLine) onLine(s); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('error', e => { child = null; reject(e); });
    child.on('close', (code, sig) => {
      child = null;
      if (code === 0) return resolve(out);
      const last = out.replace(/\r/g, '\n').split('\n').map(x => x.trim()).filter(Boolean).filter(x => !/^fetching chunks/.test(x)).pop() || '';
      reject(new Error(sig ? 'arrêté' : ('pmtiles : ' + last.replace(/^\S+ \S+ \S+\.go:\d+: /, '')).slice(0, 200)));
    });
  });
}
function freeBytes(dir) { try { const st = fs.statfsSync(dir); return st.bavail * st.bsize; } catch { return null; } }

async function startDownload(code) {
  if (job && !job.end) throw Object.assign(new Error('Un téléchargement de carte est déjà en cours.'), { status: 409 });
  if (!tool()) throw Object.assign(new Error('L’outil pmtiles n’est pas installé sur le serveur (voir la commande dans l’onglet).'), { status: 400 });
  const tg = targets().find(t => t.code === code);
  if (!tg) throw Object.assign(new Error('Carte inconnue (le pays doit être coché dans la liste).'), { status: 404 });
  const region = tg.world ? null : regionGeojson(code);
  if (!tg.world && !region) throw Object.assign(new Error('Pas de contour connu pour ce pays.'), { status: 400 });
  fs.mkdirSync(MAP_DIR, { recursive: true });
  job = { code, name: tg.name, file: tg.file, step: 'recherche', t: Date.now(), est: null, end: null, err: null, build: null };
  saveJob();
  const dest = path.join(MAP_DIR, tg.file), part = dest + '.part', side = dest.replace(/\.pmtiles$/, '.geojson');
  (async () => {
    try {
      const b = await latestBuild();
      job.build = b.key.slice(0, 8); job.step = 'estimation'; saveJob();
      const zoneArgs = tg.world ? ['--bbox=-180,-85,180,85', '--maxzoom=' + WORLD_ZOOM] : ['--region=' + side + '.part', '--maxzoom=' + MAX_ZOOM];
      if (region) fs.writeFileSync(side + '.part', region);
      const dry = await run(['extract', b.src, part, ...zoneArgs, '--dry-run']);
      job.est = parseSize(dry);
      const free = freeBytes(MAP_DIR), need = (job.est || 0) * 1.05 + 1e9;
      if (job.est && free != null && free < need) throw new Error(`pas assez de place : la carte fait environ ${(job.est / 1e9).toFixed(1)} Go, il reste ${(free / 1e9).toFixed(1)} Go libres`);
      job.step = 'téléchargement'; job.dl = Date.now(); saveJob();
      console.log(`carte ${tg.file} : téléchargement du build ${job.build} (environ ${job.est ? (job.est / 1e9).toFixed(1) + ' Go' : 'taille inconnue'})`);
      await run(['extract', b.src, part, ...zoneArgs, '--download-threads=4']);
      // Vérification minimale : en-tête PMTiles v3 écrit à la fin par l'outil
      const fd = fs.openSync(part, 'r'), h = Buffer.alloc(8); fs.readSync(fd, h, 0, 8, 0); fs.closeSync(fd);
      if (h.toString('latin1', 0, 7) !== 'PMTiles' || h[7] !== 3) throw new Error('fichier incomplet');
      if (region) fs.renameSync(side + '.part', side);
      fs.renameSync(part, dest);
      const list = downloaded().filter(m => m.file !== dest);
      list.push({ file: dest, code, world: !!tg.world, build: job.build, t: Date.now(), bytes: fs.statSync(dest).size });
      saveDownloaded(list);
      await pmReload();
      job.step = 'terminé'; job.end = Date.now(); saveJob();
      afterChange(`carte ${tg.name} téléchargée (build ${job.build})`);
      console.log(`carte ${tg.file} : en service`);
    } catch (e) {
      for (const f of [part, side + '.part']) try { fs.unlinkSync(f); } catch {}
      job.err = e.message === 'arrêté' ? 'arrêté depuis l’admin' : e.message; job.end = Date.now(); saveJob();
      console.error(`carte ${tg.file} :`, e.message);
    }
  })();
  return status();
}
function cancelDownload() {
  if (!job || job.end) return false;
  if (child) try { child.kill('SIGTERM'); } catch {}
  return true;
}
async function removeMap(name) {
  const list = downloaded(), m = list.find(x => path.basename(x.file) === name);
  if (!m) throw Object.assign(new Error('Seule une carte téléchargée depuis l’admin peut être supprimée ici.'), { status: 404 });
  if (job && !job.end && job.file === name) throw Object.assign(new Error('Téléchargement en cours pour cette carte.'), { status: 409 });
  saveDownloaded(list.filter(x => x !== m));
  await pmReload();
  for (const f of [m.file, m.file.replace(/\.pmtiles$/, '.geojson')]) try { fs.unlinkSync(f); } catch {}
  afterChange('carte ' + name + ' supprimée');
}
// Les téléphones rechargent leur configuration (adresse et zones de la carte) ; journal de l'admin
function afterChange(what) {
  const { dirty, scheduleFlush } = require('../live/files');
  dirty.global = true; scheduleFlush();
  try { const { orgaLog } = require('../orgas/log'); const { adminLabel } = require('../settings'); orgaLog({ id: 'admin', label: adminLabel() }, what); } catch {}
}

function status() {
  const dl = downloaded(), files = pmFilesInfo();
  let j = job;
  if (j && !j.end && j.step === 'téléchargement') {
    // Progression : place réellement occupée par le fichier en cours (l'outil réserve toute la taille d'un coup)
    try { const st = fs.statSync(path.join(MAP_DIR, j.file + '.part')); j = { ...j, done: st.blocks * 512 }; } catch {}
  }
  return {
    tool: tool(), install: installCmd(), dir: MAP_DIR, free: freeBytes(fs.existsSync(MAP_DIR) ? MAP_DIR : DATA_DIR), maxzoom: MAX_ZOOM, worldZoom: WORLD_ZOOM,
    targets: targets().map(t => {
      const d = dl.find(m => path.basename(m.file) === t.file), f = files.find(x => x.name === t.file);
      return { ...t, inUse: !!f, downloaded: !!d, build: d ? d.build : null, bytes: f ? f.bytes : d ? d.bytes : null, path: f ? f.file : null };
    }),
    others: files.filter(f => !targets().some(t => t.file === f.name)).map(f => ({ name: f.name, bytes: f.bytes, world: f.world, downloaded: dl.some(m => m.file === f.file) })),
    job: j,
  };
}

module.exports = { MAP_DIR, startDownload, cancelDownload, removeMap, mapsStatus: status, parseSize, regionGeojson };
