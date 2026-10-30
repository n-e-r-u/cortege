'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { LIVE_DIR, writeIfChanged, dirty, scheduleFlush } = require('../live/files');
const { PMTILES } = require('../geo/pmtiles');
const { TILE_UA, DATA_DIR, ROOT, MIN } = require('../config');
const { commReset } = require('../geo/communes');
const { geoPoly } = require('../geo/departments');
const { mobToday } = require('../settings');
const { poiStr, poiKind, poiRg, poiData, placesState, placeChunks, placesRun, OVERPASS_URLS, overpass, overpassQuery, POI_KINDS, PLACES_IMPORT, placesStatus, PLACES_EVERY } = require('./osm');
const { setMeta, q, tx } = require('../db');
const { validLatLng, sha, wait, h8 } = require('../util');

// ---- Source principale : copie complète d'OpenStreetMap chez Geofabrik (simple fichier, ni API ni quota) ----
// Une fois par mois : téléchargement (~4,5 Go pour la France), extraction des lieux et des caméras avec osmium,
// puis suppression du gros fichier. Donne aussi les horaires, téléphones et services d'urgences.
const GEOFABRIK = (process.env.GEOFABRIK_URLS || 'https://download.geofabrik.de/europe/france-latest.osm.pbf').split(',').map(x => x.trim()).filter(Boolean);
const hasOsmium = (() => { try { return require('child_process').spawnSync('osmium', ['--version'], { timeout: 5000 }).status === 0; } catch { return false; } })();
const placesSource = () => process.env.PLACES_SOURCE || (hasOsmium ? 'osm' : PMTILES && fs.existsSync(PMTILES) ? 'carte' : 'overpass');
function download(url, file, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === 'http:' ? http : https).get(u, { headers: { 'User-Agent': TILE_UA }, timeout: 60_000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, file, onProgress, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${u.hostname} ${res.statusCode}`)); }
      const total = +res.headers['content-length'] || 0, out = fs.createWriteStream(file + '.part');
      let done = 0;
      res.on('data', c => { done += c.length; onProgress(done, total); });
      res.pipe(out);
      out.on('finish', () => { fs.renameSync(file + '.part', file); resolve(); });
      out.on('error', reject); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}
// Lance osmium avec une priorité basse (l'appli reste fluide pendant l'extraction)
function osmium(args) {
  return new Promise((resolve, reject) => {
    const p = require('child_process').spawn('nice', ['-n', '15', 'osmium', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { if (err.length < 2000) err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('osmium : ' + (err.trim().split('\n')[0] || 'code ' + code).slice(0, 160))));
  });
}
// Centre approximatif d'une géométrie GeoJSON (point, ligne, surface)
function geoCenter(g) {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.type === 'LineString' ? g.coordinates : null;
  if (!ring || !ring.length) return null;
  const pts = ring.length > 2 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  let x = 0, y = 0; for (const [a, b] of pts) { x += a; y += b; }
  return [x / pts.length, y / pts.length];
}
async function placesImportOsm() {
  const dir = path.join(DATA_DIR, 'osm'); fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now(), run = { t: t0, src: 'osm', step: 'téléchargement', total: 0, done: 0, n: 0, errs: 0, err: null, part: 1, parts: GEOFABRIK.length };
  let last = 0; const save = (force) => { if (force || Date.now() - last > 2000) { last = Date.now(); setMeta('poisrun', JSON.stringify(run)); } };
  save(true);
  const up = q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,seen) VALUES(?,?,?,?,?,?,'osm',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,
    kind=CASE WHEN ed=1 THEN kind ELSE excluded.kind END, lat=CASE WHEN ed=1 THEN lat ELSE excluded.lat END, lng=CASE WHEN ed=1 THEN lng ELSE excluded.lng END,
    rg=CASE WHEN ed=1 THEN rg ELSE excluded.rg END, data=CASE WHEN ed=1 THEN data ELSE excluded.data END`);
  const clean = () => { for (const f of fs.readdirSync(dir)) try { fs.unlinkSync(path.join(dir, f)); } catch {} };
  const upComm = q('INSERT OR REPLACE INTO communes(id,insee,name,minlat,minlng,maxlat,maxlng,data,seen) VALUES(?,?,?,?,?,?,?,?,?)');
  try {
    for (const [i, url] of GEOFABRIK.entries()) {
      run.part = i + 1; run.step = 'téléchargement'; run.done = run.total = 0; save(true);
      try { const st = fs.statfsSync(dir), free = st.bavail * st.bsize; const need = +(process.env.OSM_MIN_FREE_GB || 6); if (free < need * 1e9) throw new Error(`pas assez de place sur le disque (${(free / 1e9).toFixed(1)} Go libres, il en faut environ ${need})`); } catch (e) { if (/place/.test(e.message)) throw e; }
      console.log(`lieux : téléchargement de ${url}`);
      const src = path.join(dir, 'source.osm.pbf'), flt = path.join(dir, 'lieux.osm.pbf'), out = path.join(dir, 'lieux.geojsonseq');
      await download(url, src, (d, tot) => { run.done = d; run.total = tot; save(); });
      run.step = 'extraction'; save(true); console.log('lieux : extraction avec osmium…');
      // Les limites des communes (niveau administratif 8) sortent dans le même passage : elles servent aux bilans par commune
      await osmium(['tags-filter', src, 'n/man_made=surveillance', 'nwr/amenity=townhall,police,courthouse,hospital,pharmacy,drinking_water,prison', 'nwr/office=government',
        'r/admin_level=8', '-o', flt, '--overwrite']);
      fs.unlinkSync(src); // le gros fichier ne sert plus
      await osmium(['export', flt, '-f', 'geojsonseq', '-o', out, '--overwrite', '-a', 'type,id', '-x', 'print_record_separator=false']);
      run.step = 'enregistrement'; save(true);
      const rl = require('readline').createInterface({ input: fs.createReadStream(out), crlfDelay: Infinity });
      let batch = [], comm = []; const seenIds = new Set();
      const flush = () => { const b = batch; batch = []; tx(() => { for (const r of b) up.run(...r); }); };
      const flushComm = () => { const b = comm; comm = []; tx(() => { for (const r of b) upComm.run(...r); }); };
      for await (const line of rl) {
        if (!line.trim()) continue;
        let f; try { f = JSON.parse(line.replace(/^\x1e/, '')); } catch { continue; }
        const t = f.properties || {};
        if (t.boundary === 'administrative' && String(t.admin_level) === '8' && t.name && f.geometry && /Polygon$/.test(f.geometry.type)) {
          const id = String(t['@type'] || 'r')[0] + t['@id'];
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          const z = geoPoly(f.geometry, 0.0005), insee = /^\d[\dAB]\d{3}$/.test(t['ref:INSEE'] || '') ? t['ref:INSEE'] : null;
          if (z) { comm.push([id, insee, poiStr(t.name, 80), z.b[0], z.b[1], z.b[2], z.b[3], JSON.stringify(z.p), t0]); run.communes = (run.communes || 0) + 1; }
          if (comm.length >= 200) flushComm();
          continue;
        }
        const kind = poiKind(t), c = kind && geoCenter(f.geometry);
        if (!c || !validLatLng(c[1], c[0])) continue;
        const lat = Math.round(c[1] * 1e5) / 1e5, lng = Math.round(c[0] * 1e5) / 1e5;
        const id = String(t['@type'] || 'n')[0] + t['@id'];
        if (seenIds.has(id)) continue; // une surface fermée peut sortir deux fois (ligne et surface)
        seenIds.add(id);
        batch.push([id, kind, lat, lng, poiRg(lat, lng), JSON.stringify(poiData(t, kind)), t0]); run.n++;
        if (batch.length >= 2000) { flush(); save(); await new Promise(go => setImmediate(go)); }
      }
      flush(); flushComm();
    }
    // Communes : on ne remplace les anciens contours que si l'import en a trouvé
    if (run.communes) { q('DELETE FROM communes WHERE seen<?').run(t0); commReset(); console.log(`communes : ${run.communes} contours importés`); }
    // Lieux disparus (et ceux des anciennes sources) : retirés, sauf ceux corrigés ou ajoutés dans l'admin
    q("DELETE FROM pois WHERE src='osm' AND ed=0 AND seen<?").run(t0);
    setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, communes: run.communes || 0, errs: 0, err: null, ms: Date.now() - t0, src: 'osm' }));
    q("DELETE FROM meta WHERE k='poisrun'").run();
    await placesPublish();
    console.log(`lieux : ${run.n} lieux et caméras importés en ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    run.err = e.message; run.errs = 1; save(true);
    setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, errs: 1, err: e.message, ms: Date.now() - t0, src: 'osm' }));
    q("DELETE FROM meta WHERE k='poisrun'").run();
    console.error('lieux :', e.message);
  } finally { clean(); }
}

// Source des lieux : la carte du serveur (fichier PMTiles, aucune requête extérieure) si elle existe, sinon Overpass.
// PLACES_SOURCE=overpass force Overpass (horaires et téléphones en plus, mais services publics parfois saturés).
const placesFromMap = () => placesSource() === 'carte' && !!PMTILES && fs.existsSync(PMTILES);
function placesImportMap() {
  return new Promise((resolve, reject) => {
    const { Worker } = require('worker_threads');
    const t0 = Date.now(), run = { t: t0, total: 0, done: 0, n: 0, errs: 0, err: null, src: 'carte' };
    const save = () => setMeta('poisrun', JSON.stringify(run));
    save(); console.log('lieux : lecture de la carte du serveur…');
    const up = q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,seen) VALUES(?,?,?,?,?,?,'osm',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,
      kind=CASE WHEN ed=1 THEN kind ELSE excluded.kind END, lat=CASE WHEN ed=1 THEN lat ELSE excluded.lat END, lng=CASE WHEN ed=1 THEN lng ELSE excluded.lng END,
      rg=CASE WHEN ed=1 THEN rg ELSE excluded.rg END, data=CASE WHEN ed=1 THEN data ELSE excluded.data END`);
    const w = new Worker(path.join(ROOT, 'tools', 'pois-worker.js'), { workerData: { file: PMTILES, zones: [] } });
    let last = 0;
    w.on('message', m => {
      if (m.type === 'start') { run.total = m.total; save(); }
      else if (m.type === 'progress') { run.done = m.done; if (Date.now() - last > 3000) { last = Date.now(); save(); } if (m.done % 50000 === 0) console.log(`lieux : ${m.done}/${m.total} tuiles lues, ${run.n} lieux`); }
      else if (m.type === 'batch') tx(() => {
        for (const r of m.rows) {
          const lat = Math.round(r.lat * 1e5) / 1e5, lng = Math.round(r.lng * 1e5) / 1e5;
          const id = 'm' + sha(r.kind + '|' + lat + '|' + lng).slice(0, 12);
          up.run(id, r.kind, lat, lng, poiRg(lat, lng), JSON.stringify(r.name ? { n: r.name } : {}), t0); run.n++;
        }
      });
      else if (m.type === 'done') {
        // Lieux disparus de la carte (anciens imports compris) : retirés, sauf ceux corrigés ou ajoutés dans l'admin
        q("DELETE FROM pois WHERE src='osm' AND ed=0 AND seen<?").run(t0);
        setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, errs: 0, err: null, ms: Date.now() - t0, src: 'carte' }));
        q("DELETE FROM meta WHERE k='poisrun'").run();
        placesPublish();
        console.log(`lieux : ${run.n} lieux lus dans la carte en ${Math.round((Date.now() - t0) / 1000)} s`);
        resolve();
      }
    });
    w.on('error', e => { run.err = e.message; run.errs = 1; save(); reject(e); });
    w.on('exit', code => { if (code) reject(new Error('lecture de la carte interrompue (' + code + ')')); });
  });
}
// Import en plusieurs étapes, repris là où il s'était arrêté si le serveur redémarre (mise à jour, panne)
async function placesImport(resume = false) {
  if (placesState.running) return placesState.running;
  if (placesSource() === 'osm') {
    placesState.running = placesImportOsm().finally(() => { placesState.running = null; });
    return placesState.running;
  }
  if (placesFromMap()) {
    placesState.running = placesImportMap().catch(e => console.error('lieux', e.message)).finally(() => { placesState.running = null; });
    return placesState.running;
  }
  placesState.running = (async () => {
    const chunks = placeChunks(), prev = resume ? placesRun() : null;
    const run = prev && prev.total === chunks.length ? prev : { t: Date.now(), total: chunks.length, done: 0, n: 0, errs: 0, err: null };
    run.err = null; console.log(`lieux : import ${prev && run === prev ? 'repris' : 'lancé'} (${run.done}/${chunks.length} zones faites)`);
    const t0 = run.t, save = () => setMeta('poisrun', JSON.stringify(run));
    save();
    const up = q(`INSERT INTO pois(id,kind,lat,lng,rg,data,src,seen) VALUES(?,?,?,?,?,?,'osm',?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen,
      kind=CASE WHEN ed=1 THEN kind ELSE excluded.kind END, lat=CASE WHEN ed=1 THEN lat ELSE excluded.lat END, lng=CASE WHEN ed=1 THEN lng ELSE excluded.lng END,
      rg=CASE WHEN ed=1 THEN rg ELSE excluded.rg END, data=CASE WHEN ed=1 THEN data ELSE excluded.data END`);
    // Une zone : chaque serveur essayé ; si aucun ne répond à temps, la zone est coupée en 4 (zones très denses), deux fois au plus
    const fetchZone = async ([s, w, nn, e], label, depth = 0) => {
      for (let tries = 0; tries < OVERPASS_URLS.length; tries++) {
        const url = OVERPASS_URLS[tries], host = new URL(url).hostname;
        run.cur = { host, since: Date.now(), zone: label }; save();
        console.log(`lieux : zone ${label}, demande à ${host}…`);
        try { const r = await overpass(overpassQuery(s, w, nn, e), url); run.err = null; return r; }
        catch (err) {
          run.err = `${host} · ${err.message}`.slice(0, 160); save();
          console.error(`lieux : zone ${label} : ${run.err}`);
          await wait(err.status === 429 ? 60_000 : Number(process.env.OVERPASS_RETRY ?? 10_000));
        }
      }
      if (depth >= 2) return null;
      const ms = (s + nn) / 2, mw = (w + e) / 2, parts = [[s, w, ms, mw], [s, mw, ms, e], [ms, w, nn, mw], [ms, mw, nn, e]], out = [];
      for (const [i, q4] of parts.entries()) { const r = await fetchZone(q4.map(x => Math.round(x * 1e4) / 1e4), `${label}.${i + 1}`, depth + 1); if (!r) return null; out.push(...(r.elements || [])); }
      return { elements: out };
    };
    run.failed ||= [];
    for (; run.done < chunks.length; run.done++) {
      const [s, w] = chunks[run.done];
      const res = await fetchZone(chunks[run.done], `${run.done + 1}/${chunks.length}`);
      if (!res) { run.errs++; run.failed.push(run.done); }
      else if (Array.isArray(res.elements)) tx(() => {
        for (const el of res.elements) {
          const t = el.tags || {}, kind = poiKind(t), lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
          if (!kind || !validLatLng(lat, lng)) continue;
          up.run(el.type[0] + el.id, kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, poiRg(lat, lng), JSON.stringify(poiData(t, kind)), t0); run.n++;
        }
      });
      save();
      console.log(`lieux : zone ${run.done + 1}/${chunks.length} (${s}, ${w})${res ? '' : ' en échec'} · ${run.n} lieux en tout`);
      if (res && run.done % 10 === 9) placesPublish(); // la carte se remplit au fur et à mesure
      await wait(Number(process.env.OVERPASS_GAP ?? 3000));
    }
    // Zones en échec : une nouvelle tentative à la fin (souvent un serveur momentanément surchargé)
    for (const i of run.failed.splice(0)) {
      const res = await fetchZone(chunks[i], `${i + 1}/${chunks.length} (nouvel essai)`);
      if (!res) { run.failed.push(i); continue; }
      run.errs--;
      tx(() => { for (const el of res.elements || []) { const t = el.tags || {}, kind = poiKind(t), lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (kind && validLatLng(lat, lng)) { up.run(el.type[0] + el.id, kind, Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, poiRg(lat, lng), JSON.stringify(poiData(t, kind)), t0); run.n++; } } });
      save(); await wait(Number(process.env.OVERPASS_GAP ?? 3000));
    }
    // Lieux disparus d'OpenStreetMap : retirés seulement si tout l'import a réussi (sinon on garderait une carte trouée)
    if (!run.errs) q("DELETE FROM pois WHERE src='osm' AND ed=0 AND seen<?").run(t0);
    setMeta('poisimp', JSON.stringify({ t: Date.now(), n: run.n, errs: run.errs, err: run.errs ? run.err : null, ms: Date.now() - t0 }));
    q("DELETE FROM meta WHERE k='poisrun'").run();
    placesPublish();
    console.log(`lieux : ${run.n} lieux importés en ${Math.round((Date.now() - t0) / 1000)} s, ${run.errs} carré(s) en échec`);
  })().catch(e => console.error('lieux', e.message)).finally(() => { placesState.running = null; });
  return placesState.running;
}
const poiRow = x => { const d = JSON.parse(x.data || '{}');
  // Caméra : [id, 'cam', lat, lng, opérateur, publique (1/0), direction en degrés (-1 : inconnue), type (d dôme, f fixe, p mobile)]
  if (x.kind === 'cam') return [x.id, x.kind, x.lat, x.lng, d.o || '', d.c ? 1 : 0, d.dir ?? -1, d.ct || ''];
  const row = [x.id, x.kind, x.lat, x.lng, d.n || '', d.h || '', d.p || '', d.e || d.s || 0];
  while (row.length > 4 && !row[row.length - 1]) row.pop(); return row; };
// Publie les fichiers de lieux (toutes les régions, ou seulement celles indiquées)
const placesPublish = (regions = null) => placesPublishRun(regions).catch(e => console.error('lieux : publication', e.message));
async function placesPublishRun(regions) {
  const dir = path.join(LIVE_DIR, 'l');
  fs.mkdirSync(dir, { recursive: true });
  const rgs = regions ? [...regions] : q('SELECT DISTINCT rg FROM pois').all().map(x => x.rg);
  const street = new Set(POI_KINDS.filter(k => k.street).map(k => k.id)), cams = new Set(POI_KINDS.filter(k => k.cam).map(k => k.id));
  const written = new Set();
  for (const rg of rgs) {
    if (!regions) await new Promise(go => setImmediate(go)); // publication complète : on rend la main entre deux zones
    const rows = q('SELECT id, kind, lat, lng, data FROM pois WHERE rg=? AND hid=0').all(rg);
    for (const [suffix, list] of [['', rows.filter(x => !street.has(x.kind) && !cams.has(x.kind))], ['-s', rows.filter(x => street.has(x.kind))], ['-c', rows.filter(x => cams.has(x.kind))]]) {
      const f = path.join(dir, rg + suffix + '.json');
      if (list.length) { writeIfChanged(f, JSON.stringify({ p: list.map(poiRow) })); written.add(rg + suffix + '.json'); }
      else try { fs.unlinkSync(f); } catch {}
    }
  }
  if (!regions) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !written.has(f)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
  setMeta('poish', h8(String(Date.now()) + q('SELECT COUNT(*) n FROM pois').get().n));
  dirty.global = true; scheduleFlush();
}
// Import automatique : au premier démarrage (base vide), puis tous les 30 jours ; jamais un jour de mobilisation
function placesMaybe() {
  if (!PLACES_IMPORT || placesState.running || mobToday()) return;
  if (placesRun()) return placesImport(true); // import interrompu (redémarrage) : on reprend (depuis le début pour Geofabrik)
  const last = placesStatus();
  // Depuis la carte du serveur : relu seulement quand le fichier de carte a changé (nouvelle extraction)
  if (placesFromMap()) { if (!last || last.src !== 'carte' || fs.statSync(PMTILES).mtimeMs > last.t) placesImport(); return; }
  if (!last || (last.src || 'overpass') !== placesSource() || Date.now() - last.t > PLACES_EVERY) placesImport();
}
if (PLACES_IMPORT) { setTimeout(placesMaybe, 2 * MIN).unref(); setInterval(placesMaybe, 60 * MIN).unref(); }
const poiView = x => { const d = JSON.parse(x.data || '{}'); return { id: x.id, kind: x.kind, lat: x.lat, lng: x.lng, n: d.n || '', h: d.h || '', p: d.p || '', e: !!d.e, src: x.src, hid: !!x.hid, ed: !!x.ed }; };

module.exports = { placesSource, download, placesImport, placesPublish, poiView };
