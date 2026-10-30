'use strict';
// Lecture d'un JSON distant (sources publiques : import, contours officiels), avec délai maximal.
const http = require('http');
const https = require('https');
const { TILE_UA } = require('./config');

function getJson(url, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('http:') ? http : https).get(url, { headers: { 'User-Agent': TILE_UA, Accept: 'application/json' }, timeout }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
  });
}

module.exports = { getJson };
