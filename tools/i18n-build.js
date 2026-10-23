#!/usr/bin/env node
'use strict';
// Construit public/lang/{en,es,ar}.json à partir des fichiers i18n/*.tsv
// (une ligne par texte : français<TAB>anglais<TAB>espagnol<TAB>arabe ; # = commentaire).
// Vérifie que chaque traduction garde les mêmes balises HTML et n'invente pas de {valeur}.
// Usage : node tools/i18n-build.js [clés.json]   (clés.json : liste de textes français à couvrir, pour lister les manques)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'i18n'), OUT = path.join(ROOT, 'public', 'lang');
const LANGS = ['en', 'es', 'ar'];
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const tags = s => (s.match(/<[^>]+>/g) || []).sort().join('');
const vars = s => new Set((s.match(/\{\w+\}/g) || []));
const dicts = Object.fromEntries(LANGS.map(l => [l, {}]));
let errors = 0, count = 0;
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.tsv')).sort()) {
  fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const cols = line.split('\t');
    const where = `${f}:${i + 1}`;
    if (cols.length !== 4) { console.error(`${where} : ${cols.length} colonnes au lieu de 4`); errors++; return; }
    const fr = norm(cols[0]);
    if (dicts.en[fr] !== undefined) { console.error(`${where} : texte en double « ${fr.slice(0, 60)} »`); errors++; }
    LANGS.forEach((l, j) => {
      const tr = norm(cols[j + 1]);
      if (!tr) { console.error(`${where} : traduction ${l} vide`); errors++; return; }
      if (tags(tr) !== tags(fr)) { console.error(`${where} : balises différentes en ${l}`); errors++; }
      for (const v of vars(tr)) if (!vars(fr).has(v)) { console.error(`${where} : ${v} inconnu en ${l}`); errors++; }
      dicts[l][fr] = tr;
    });
    count++;
  });
}
if (process.argv[2]) {
  const want = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(x => norm(Array.isArray(x) ? x[1] : x.k || x));
  const missing = want.filter(k => /[a-zà-ÿ]{2}/i.test(k) && dicts.en[k] === undefined);
  if (missing.length) console.log(`${missing.length} texte(s) sans traduction :\n` + missing.map(k => '  ' + k.slice(0, 110)).join('\n'));
}
if (errors) { console.error(`${errors} erreur(s), rien n'est écrit.`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
for (const l of LANGS) fs.writeFileSync(path.join(OUT, l + '.json'), JSON.stringify(dicts[l]));
console.log(`${count} textes traduits en ${LANGS.join(', ')} → public/lang/`);
