'use strict';
// Réponses HTTP : JSON ou texte, et lecture d'un corps JSON limité en taille.


function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readJson(req, max = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { let v; try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return reject(new Error('bad json')); } v && typeof v === 'object' && !Array.isArray(v) ? resolve(v) : reject(new Error('bad json')); });
    req.on('error', reject);
  });
}

module.exports = { send, readJson };
