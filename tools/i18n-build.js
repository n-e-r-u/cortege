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
const vars = s => new Set((s.match(/\{[\p{L}\p{N}_]{1,40}\}/gu) || []).map(v => v.slice(1, -1)));
const balanced = s => {
  const st = [];
  for (const m of s.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (m[2] && m[2].trim().endsWith('/')) continue;
    const name = m[1].toLowerCase();
    if (m[0][1] === '/') { if (st.pop() !== name) return false; } else st.push(name);
  }
  return st.length === 0;
};
const dicts = Object.fromEntries(LANGS.map(l => [l, {}]));
let errors = 0, count = 0;
const seen = new Set();
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.tsv')).sort()) {
  fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    const tline = line.replace(/\r$/, '');
    if (!tline.trim() || tline.trim().startsWith('#')) return;
    const cols = tline.split('\t');
    const where = `${f}:${i + 1}`;
    if (cols.length !== 4) { console.error(`${where} : ${cols.length} colonnes au lieu de 4`); errors++; return; }
    const fr = norm(cols[0]);
    if (!fr) { console.error(`${where} : texte français vide`); errors++; return; }
    if (seen.has(fr)) { console.error(`${where} : texte en double « ${fr.slice(0, 60)} »`); errors++; return; }
    seen.add(fr);
    LANGS.forEach((l, j) => {
      const tr = norm(cols[j + 1]);
      if (!tr) { console.error(`${where} : traduction ${l} vide`); errors++; return; }
      if (tags(tr) !== tags(fr)) { console.error(`${where} : balises différentes en ${l}`); errors++; }
      if (!balanced(tr)) { console.error(`${where} : balise non fermée en ${l}`); errors++; }
      const vf = vars(fr), vt = vars(tr);
      for (const v of vt) if (!vf.has(v)) { console.error(`${where} : {${v}} inconnu en ${l}`); errors++; }
      for (const v of vf) if (!vt.has(v)) { console.error(`${where} : {${v}} manquant en ${l}`); errors++; }
      dicts[l][fr] = tr;
    });
    count++;
  });
}
if (process.argv[2]) {
  try {
    const want = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(x => norm(Array.isArray(x) ? x[1] : x.k || x));
    const missing = want.filter(k => /[a-zà-ÿ]{2}/i.test(k) && dicts.en[k] === undefined);
    if (missing.length) console.log(`${missing.length} texte(s) sans traduction :\n` + missing.map(k => '  ' + k.slice(0, 110)).join('\n'));
  } catch (e) { console.error('clés.json invalide : ' + e.message); errors++; }
}
if (errors) { console.error(`${errors} erreur(s), rien n'est écrit.`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
for (const l of LANGS) {
  const f = path.join(OUT, l + '.json');
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(dicts[l]));
  fs.renameSync(tmp, f);
}
console.log(`${count} textes traduits en ${LANGS.join(', ')} → public/lang/`);
