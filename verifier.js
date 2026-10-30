#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const base = process.argv[2] || 'http://127.0.0.1:8080';
const root = __dirname;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const encPath = rel => rel.split('/').map(encodeURIComponent).join('/');

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push('/' + path.relative(path.join(root, 'public'), p).split(path.sep).join('/'));
  }
  return out;
}

(async () => {
  console.log(`Vérification de ${base} contre ce dépôt\n`);
  let files;
  try { files = listFiles(path.join(root, 'public')); }
  catch (e) { console.error('public/ introuvable : ' + e.message); process.exit(2); }

  let ok = 0, diff = 0, err = 0;
  for (const rel of files) {
    const local = sha(fs.readFileSync(path.join(root, 'public', rel)));
    try {
      const res = await fetch(base + encPath(rel) + '?v=' + Date.now(), {
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const remote = sha(Buffer.from(await res.arrayBuffer()));
      if (remote === local) { ok++; console.log('  ✓ public' + rel); }
      else { diff++; console.log('  ✗ public' + rel + '  DIFFÉRENT'); }
    } catch (e) { err++; console.log('  ? public' + rel + '  (' + e.message + ')'); }
  }

  try {
    const r = await fetch(base + '/api/version?v=' + Date.now(),
      { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const v = await r.json();
    const declared = v && v.files && v.files['server.js'];
    const localServer = sha(fs.readFileSync(path.join(root, 'server.js')));
    console.log(`\nVersion annoncée en ligne : ${v && v.version}`);
    console.log(`server.js (déclaré par le serveur, non vérifiable) : ${declared === localServer ? 'identique' : 'différent'} au dépôt`);
  } catch (e) { console.log('\n/api/version indisponible : ' + e.message); }

  console.log(`\n${ok} identique(s), ${diff} différent(s), ${err} injoignable(s).`);
  if (diff) console.log('Un fichier différent peut venir d\'une version plus récente ou plus ancienne : compare avec le bon commit (git log).');
  process.exit(diff ? 1 : err ? 2 : 0);
})().catch(e => { console.error(e); process.exit(2); });
