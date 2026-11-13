#!/usr/bin/env node
'use strict';
// Traductions : un fichier PO par langue dans i18n/ (en.po, es.po, ar.po, de.po…, et des variantes régionales comme en-US.po
// qui ne contiennent que les différences). Le texte français sert de clé (msgid) ; fr.po peut corriger un texte français
// sans toucher au code. Une langue est ajoutée en déposant son fichier : rien d'autre à changer.
//
//   node tools/i18n-build.js          → public/lang/<langue>.json (lus par l'appli et par le serveur) et public/lang/index.json
//   node tools/i18n-build.js --pot    → met à jour i18n/cortege.pot (tous les textes) et ajoute les textes nouveaux, vides,
//                                       à chaque fichier .po (à traduire)
//   node tools/i18n-build.js clés.json → liste aussi les textes de clés.json sans traduction (clés relevées avec I18N.collect)
//
// Vérifie que chaque traduction garde les mêmes balises HTML (bien fermées) et les mêmes {valeurs}.
// Pluriels : autant de formes que la langue en a (Plural-Forms), dans l'ordre zero, one, two, few, many, other,
// comme le navigateur les choisit (Intl.PluralRules). Aucune dépendance.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'i18n'), OUT = path.join(ROOT, 'public', 'lang');
const { norm, pluralCats, parsePo, headerOf, dictOf: dictOfL, metaOf, LANG_CODE } = require('../src/i18n-po');

// ---- Fichiers de langue ----
const poFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.po') && LANG_CODE.test(f.slice(0, -3))).sort();
let errors = 0, warnings = 0;
const err = m => { console.error(m); errors++; }, warn = m => { console.warn(m); warnings++; };
const langs = {};
for (const f of poFiles) {
  const code = f.slice(0, -3), base = code.split('-')[0];
  let entries;
  try { entries = parsePo(fs.readFileSync(path.join(SRC, f), 'utf8'), f); } catch (e) { err(e.message); continue; }
  langs[code] = { code, base, file: f, entries, header: headerOf(entries) };
}

// ---- Mise à jour du modèle (--pot) ----
function scanCode() {
  const found = new Map(); // msgid → { plural, ref }
  const add = (id, plural, ref) => { id = norm(id); if (id && !id.includes('}, ') && /\p{L}{2}/u.test(id) && !found.has(id)) found.set(id, { plural: plural && norm(plural), ref }); };
  const lit = `'((?:[^'\\\\\\n]|\\\\.)*)'`;
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(d, x.name)) : x.name.endsWith('.js') ? [path.join(d, x.name)] : []);
  for (const file of [...walk(path.join(ROOT, 'client', 'app')), ...walk(path.join(ROOT, 'client', 'parts')), ...walk(path.join(ROOT, 'src'))]) {
    const s = fs.readFileSync(file, 'utf8'), ref = path.relative(ROOT, file);
    const un = x => x.replace(/\\'/g, "'");
    for (const m of s.matchAll(new RegExp(`\\btn\\([^,()]+(?:\\([^()]*\\))?, ${lit}, ${lit}`, 'g'))) add(un(m[1]), un(m[2]), ref);
    for (const m of s.matchAll(new RegExp(`(?<![\\w.])(?:t|toast|tr\\([^,()\\n]{1,30},)\\s*\\(?${lit}`, 'g'))) add(un(m[1]), null, ref);
    if (ref.startsWith('src') && !ref.includes('admin')) for (const m of s.matchAll(new RegExp(`error: ${lit}`, 'g'))) add(un(m[1]), null, ref);
  }
  // Profils pays : noms des types, droits, liens (textes en français, traduits comme le reste)
  const pdir = path.join(ROOT, 'profiles');
  if (fs.existsSync(pdir)) for (const f of fs.readdirSync(pdir).filter(f => f.endsWith('.json')).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(pdir, f), 'utf8')), ref = 'profiles/' + f;
    for (const v of Object.values(p.labels || {})) add(v, null, ref);
    for (const x of p.extra || []) add(x.label, null, ref);
    for (const sec of p.rights || []) { add(sec.title, null, ref); for (const it of sec.items || []) add(it, null, ref); }
    if (p.violence) { add(p.violence.label, null, ref); if (p.violence.desc) add(p.violence.desc, null, ref); }
  }
  return found;
}
if (process.argv.includes('--pot')) {
  const all = new Map();
  const fr = langs.fr ? langs.fr.entries : [];
  for (const e of fr) if (e.msgid) all.set(e.msgid, e);
  for (const L of Object.values(langs)) for (const e of L.entries) if (e.msgid && !all.has(e.msgid)) all.set(e.msgid, e);
  const fromCode = scanCode();
  let added = 0;
  for (const [id, x] of fromCode) if (!all.has(id) && ![...all.values()].some(e => e.msgid_plural === id)) {
    all.set(id, { msgid: id, ...(x.plural ? { msgid_plural: x.plural } : {}), comments: [`#: ${x.ref}`], added: true }); added++;
  }
  const q = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
  const keepComments = e => (e.comments || []).filter(c => /^#[.:]/.test(c));
  const block = (e, nforms, fill) => [...keepComments(e), 'msgid ' + q(e.msgid),
    ...(e.msgid_plural ? ['msgid_plural ' + q(e.msgid_plural), ...Array.from({ length: nforms }, (_, i) => `msgstr[${i}] ${q(fill ? fill(i) : '')}`)] : ['msgstr ' + q(fill ? fill() : '')])].join('\n');
  const head = 'msgid ""\nmsgstr ""\n"Project-Id-Version: Cortège\\n"\n"MIME-Version: 1.0\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Content-Transfer-Encoding: 8bit\\n"\n"Plural-Forms: nplurals=INTEGER; plural=EXPRESSION;\\n"\n';
  fs.writeFileSync(path.join(SRC, 'cortege.pot'), head + '\n' + [...all.values()].map(e => block(e, 2)).join('\n\n') + '\n');
  // Textes nouveaux ajoutés, vides, à chaque langue
  for (const L of Object.values(langs)) {
    const have = new Set(L.entries.map(e => e.msgid)), missing = [...all.values()].filter(e => e.msgid && !have.has(e.msgid));
    if (L.code !== L.base) continue; // une variante ne contient que ses différences
    if (missing.length) fs.appendFileSync(path.join(SRC, L.file), '\n# --- textes à traduire ---\n' + missing.map(e => block(e, pluralCats(L.base).length)).join('\n\n') + '\n');
    if (missing.length) console.log(`${L.file} : ${missing.length} texte(s) nouveau(x) à traduire`);
  }
  console.log(`cortege.pot : ${all.size} textes (${added} nouveau(x) trouvé(s) dans le code)`);
  process.exit(0);
}

// ---- Construction ----
const dictOf = L => dictOfL(L, err, warn);
const built = {};
for (const L of Object.values(langs)) {
  const own = dictOf(L);
  const baseL = L.code !== L.base ? langs[L.base] : null;
  if (L.code !== L.base && !baseL && L.base !== 'fr') warn(`${L.file} : pas de ${L.base}.po, la variante est utilisée seule`);
  const dict = { ...(baseL ? dictOf(baseL) : {}), ...own };
  const h = { ...(baseL ? baseL.header : {}), ...L.header };
  const meta = metaOf(L.code, L.base, h, Object.keys(dict).length);
  built[L.code] = { meta, dict };
}
if (process.argv[2] && !process.argv[2].startsWith('--')) {
  try {
    const want = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).map(x => norm(Array.isArray(x) ? x[1] : x.k || x));
    const en = built.en ? built.en.dict : {};
    const missing = want.filter(k => /[a-zà-ÿ]{2}/i.test(k) && en[k] === undefined);
    if (missing.length) console.log(`${missing.length} texte(s) sans traduction :\n` + missing.map(k => '  ' + k.slice(0, 110)).join('\n'));
  } catch (e) { err('clés.json invalide : ' + e.message); }
}
if (errors) { console.error(`${errors} erreur(s), rien n'est écrit.`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const writeAtomic = (f, s) => { const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, s); fs.renameSync(tmp, f); };
for (const [code, b] of Object.entries(built)) writeAtomic(path.join(OUT, code + '.json'), JSON.stringify({ '': b.meta, ...b.dict }));
// Anciens fichiers d'une langue retirée
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json') && f !== 'index.json' && !built[f.slice(0, -5)]) fs.unlinkSync(path.join(OUT, f));
const index = Object.values(built).map(b => b.meta).sort((a, b) => (a.code === 'fr' ? -1 : b.code === 'fr' ? 1 : a.code.localeCompare(b.code)));
if (!index.some(x => x.code === 'fr')) index.unshift({ code: 'fr', base: 'fr', name: 'Français', dir: 'ltr', locale: 'fr-FR', plural: pluralCats('fr'), n: 0 });
writeAtomic(path.join(OUT, 'index.json'), JSON.stringify(index));
const main = Object.values(built).filter(b => b.meta.code !== 'fr').map(b => `${b.meta.code} ${b.meta.n}`).join(', ');
console.log(`${index.length} langues, textes traduits : ${main} → public/lang/` + (warnings ? ` (${warnings} avertissement(s))` : ''));
