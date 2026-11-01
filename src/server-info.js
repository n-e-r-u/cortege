'use strict';
// Onglet Serveur de l'admin : version en ligne et version publiée, disque, mémoire, base, cartes, dernière sauvegarde.
// La version publiée est lue sur le dépôt du code source (GitHub), seulement quand l'admin ouvre l'onglet, au plus toutes les 6 h.
// Rien n'est installé d'ici : la mise à jour reste une commande à lancer sur le serveur.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { ROOT, DATA_DIR } = require('./config');
const { DB_FILE, getMeta } = require('./db');
const { APP_VERSION } = require('./http/version');
const { PMTILES, pmFilesInfo } = require('./geo/pmtiles');
const { instance } = require('./instance');

// Compare deux versions « 2.10.1 » : >0 si a est plus récente
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
// Adresse du package.json publié, depuis le lien du code source (github.com/compte/dépôt)
function rawUrl() {
  const m = String(instance().sourceUrl || '').match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/package.json` : null;
}
let latest = { at: 0, v: null, err: null, url: null };
function fetchLatest() {
  const url = rawUrl();
  if (!url) return Promise.resolve({ v: null, err: 'Le lien du code source ne pointe pas vers un dépôt GitHub.' });
  if (latest.url === url && Date.now() - latest.at < 6 * 3600_000) return Promise.resolve(latest);
  return new Promise(resolve => {
    const done = (v, err) => { latest = { at: Date.now(), v, err, url }; resolve(latest); };
    const rq = https.get(url, { headers: { 'User-Agent': 'Cortege/' + APP_VERSION }, timeout: 6000 }, r => {
      if (r.statusCode !== 200) { r.resume(); return done(null, 'Dépôt injoignable (code ' + r.statusCode + ').'); }
      let s = ''; r.setEncoding('utf8'); r.on('data', c => { if (s.length < 20000) s += c; });
      r.on('end', () => { try { const v = JSON.parse(s).version; done(/^\d+(\.\d+){1,3}$/.test(v) ? v : null, null); } catch { done(null, 'Réponse illisible.'); } });
    });
    rq.on('timeout', () => rq.destroy(new Error('délai dépassé')));
    rq.on('error', e => done(null, 'Dépôt injoignable (' + e.message + ').'));
  });
}
const size = f => { try { return fs.statSync(f).size; } catch { return 0; } };
const disk = dir => { try { const st = fs.statfsSync(dir); return { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch { return null; } };

async function serverInfo({ checkLatest = true } = {}) {
  const lt = checkLatest ? await fetchLatest() : latest;
  let mem = null;
  try { const m = fs.readFileSync('/proc/meminfo', 'utf8'), g = k => +(m.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1] * 1024;
    mem = { free: g('MemAvailable'), total: g('MemTotal') }; } catch { mem = { free: os.freemem(), total: os.totalmem() }; }
  let backup = null; try { const b = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backup-last.json'), 'utf8')); if (b.t) backup = { t: b.t * 1000, bytes: b.bytes || null }; } catch {}
  const tiles = PMTILES ? path.dirname(PMTILES) : null;
  let crash = null; try { crash = JSON.parse(getMeta('crash') || 'null'); } catch {}
  const user = (() => { try { return os.userInfo().username; } catch { return 'cortege'; } })();
  return {
    version: APP_VERSION, latest: lt.v, latestErr: lt.err, latestAt: lt.at || null, newer: !!(lt.v && cmpVer(lt.v, APP_VERSION) > 0),
    changelog: /^https:\/\/github\.com\//.test(instance().sourceUrl || '') ? instance().sourceUrl.replace(/\/$/, '') + '/blob/main/CHANGELOG.md' : null,
    update: `sudo -u ${user} git -C ${ROOT} pull && sudo systemctl restart cortege`,
    node: process.version, uptime: Math.round(process.uptime()), host: { uptime: Math.round(os.uptime()), cpus: os.cpus().length, load: os.loadavg().map(x => Math.round(x * 100) / 100) },
    mem, rss: process.memoryUsage().rss,
    disk: { data: disk(DATA_DIR), ...(tiles && tiles !== DATA_DIR ? { tiles: disk(tiles) } : {}) },
    db: size(DB_FILE) + size(DB_FILE + '-wal'),
    maps: pmFilesInfo().map(({ zones, ...f }) => f),
    backup, crash,
  };
}

module.exports = { serverInfo, cmpVer };
