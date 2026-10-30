'use strict';
// Fichiers servis par Node quand il est seul (VPS, local) : tuiles déjà sur disque et fichiers live/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LIVE_DIR } = require('../live/files');
const { NEXT } = require('./next');
const { TILE_DIR, TILE_DISK, serveTile } = require('../geo/tiles');
const { rebuildAll } = require('../live/publish');
const { send } = require('../http/respond');

async function filesRoutes(req, res, url, pathname) {
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
  return NEXT;
}

module.exports = { filesRoutes };
