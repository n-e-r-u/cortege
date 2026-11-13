#!/usr/bin/env node
'use strict';
// Assemble les scripts du téléphone et de l'admin à partir de leurs morceaux, rangés par fonction dans client/ :
//   client/app/*.js   → public/app.js   (dans l'ordre des numéros, à l'intérieur d'une seule fonction : le code partage ses variables)
//   client/admin/*.js → public/admin.js
//   client/parts/x.js → public/app-x.js  (copié tel quel : une partie chargée à la demande, qui reçoit du reste de l'appli ce dont elle a besoin)
// Les fichiers assemblés sont gardés dans le dépôt : le serveur les sert tels quels, sans étape de construction au déploiement.
// Usage : node tools/build-client.js          (assemble)
//         node tools/build-client.js --check  (vérifie que public/ est à jour, sans rien écrire ; utilisé par les tests)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const BUNDLES = [
  { dir: 'client/app', out: 'public/app.js', head: "'use strict';\n(async function () {\n", foot: '})();\n' },
  { dir: 'client/admin', out: 'public/admin.js', head: '', foot: '' },
];
const check = process.argv.includes('--check');
let stale = 0;
const put = (rel, code, what) => {
  const out = path.join(ROOT, rel);
  let cur = null; try { cur = fs.readFileSync(out, 'utf8'); } catch {}
  if (cur === code) return console.log(`${rel} : à jour (${what})`);
  if (check) { console.error(`${rel} : pas à jour, lance node tools/build-client.js`); stale++; return; }
  fs.writeFileSync(out, code);
  console.log(`${rel} : assemblé (${what})`);
};
for (const b of BUNDLES) {
  const dir = path.join(ROOT, b.dir);
  const parts = fs.readdirSync(dir).filter(f => /^\d{2}-[\w-]+\.js$/.test(f)).sort();
  const code = b.head + parts.map(f => {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    return s.endsWith('\n') ? s : s + '\n';
  }).join('') + b.foot;
  put(b.out, code, `${parts.length} morceaux`);
}
for (const f of fs.readdirSync(path.join(ROOT, 'client/parts')).filter(f => /^[\w-]+\.js$/.test(f)).sort())
  put('public/app-' + f, fs.readFileSync(path.join(ROOT, 'client/parts', f), 'utf8'), 'partie à la demande');
process.exit(stale ? 1 : 0);
