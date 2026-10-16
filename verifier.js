#!/usr/bin/env node
'use strict';
// Vérifie que l'appli servie en ligne est identique à ce dépôt.
//
//   git clone https://github.com/n-e-r-u/cortege && cd cortege
//   node verifier.js https://cortege.neru.tv
//
// Pour chaque fichier de public/, le script télécharge la version servie par le site et compare son
// empreinte SHA-256 à celle du fichier du dépôt. C'est une vraie vérification : elle ne dépend pas de
// ce que le serveur déclare. C'est ce code-là qui tourne sur les téléphones (carte, position, envois).
//
// Le code du serveur (server.js), lui, ne peut pas être vérifié de l'extérieur : aucun site ne peut
// le prouver. Son empreinte est affichée pour information, telle que le serveur la déclare.
// Aucune dépendance : Node 18 ou plus récent suffit.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const base = (process.argv[2] || 'https://cortege.neru.tv').replace(/\/$/, '');
const root = __dirname;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name), r = rel + '/' + e.name;
    if (e.isDirectory()) out.push(...listFiles(p, r)); else out.push(r);
  }
  return out;
}

(async () => {
  console.log(`Vérification de ${base} contre ce dépôt\n`);
  let ok = 0, diff = 0, err = 0;
  for (const rel of listFiles(path.join(root, 'public'))) {
    const local = sha(fs.readFileSync(path.join(root, 'public', rel)));
    try {
      const res = await fetch(base + rel, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const remote = sha(Buffer.from(await res.arrayBuffer()));
      if (remote === local) { ok++; console.log('  ✓ public' + rel); }
      else { diff++; console.log('  ✗ public' + rel + '  DIFFÉRENT'); }
    } catch (e) { err++; console.log('  ? public' + rel + '  (' + e.message + ')'); }
  }
  try {
    const v = await (await fetch(base + '/api/version', { cache: 'no-store' })).json();
    const localServer = sha(fs.readFileSync(path.join(root, 'server.js')));
    console.log(`\nVersion annoncée en ligne : ${v.version}`);
    console.log(`server.js (déclaré par le serveur, non vérifiable) : ${v.files['server.js'] === localServer ? 'identique' : 'différent'} au dépôt`);
  } catch { console.log('\n/api/version indisponible'); }
  console.log(`\n${ok} identique(s), ${diff} différent(s), ${err} injoignable(s).`);
  if (diff) console.log('Un fichier différent peut venir d\'une version plus récente ou plus ancienne : compare avec le bon commit (git log).');
  process.exit(diff || err ? 1 : 0);
})();
