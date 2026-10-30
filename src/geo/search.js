'use strict';
const https = require('https');
const { TILE_UA } = require('../config');

// ---- Recherche de lieux (OpenStreetMap Nominatim, via le serveur : rien ne part du téléphone) ----
const geoCache = new Map();
let geoChain = Promise.resolve(), geoLast = 0;
let geoPending = 0;
const GEO_QUEUE_MAX = 20; // au-delà, on répond « réessaie » plutôt que d'empiler (1 requête/s chez Nominatim)
function nominatim(pathAndQuery) {
  if (geoCache.has(pathAndQuery)) return Promise.resolve(geoCache.get(pathAndQuery));
  if (geoPending >= GEO_QUEUE_MAX) return Promise.resolve(null);
  geoPending++;
  // Politique Nominatim : 1 requête par seconde maximum
  const run = () => new Promise(resolve => {
    const wait = Math.max(0, geoLast + 1100 - Date.now());
    setTimeout(() => {
      geoLast = Date.now();
      const rq = https.get('https://nominatim.openstreetmap.org' + pathAndQuery, { headers: { 'User-Agent': TILE_UA, 'Accept-Language': 'fr' }, timeout: 8000 }, up => {
        const chunks = []; up.on('data', c => chunks.push(c));
        up.on('end', () => {
          let data = null; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
          if (up.statusCode === 200 && data) { geoCache.set(pathAndQuery, data); if (geoCache.size > 3000) geoCache.delete(geoCache.keys().next().value); }
          resolve(data);
        });
      });
      rq.on('timeout', () => rq.destroy(new Error('timeout')));
      rq.on('error', () => resolve(null));
    }, wait);
  });
  const p = geoChain.then(run).finally(() => { geoPending--; }); geoChain = p.catch(() => {}); return p;
}
const placeName = a => a && (a.city || a.town || a.village || a.municipality || a.suburb || a.county || a.state) || null;

module.exports = { geoCache, nominatim, placeName };
