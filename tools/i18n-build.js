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
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const tags = s => (s.match(/<[^>]+>/g) || []).sort().join('');
const vars = s => new Set((s.match(/\{[\p{L}\p{N}_]{1,40}\}/gu) || []).map(v => v.slice(1, -1)));
const balanced = s => {
  const st = [];
  for (const m of s.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if ((m[2] && m[2].trim().endsWith('/')) || /^(br|img|hr|input)$/i.test(m[1])) continue;
    const name = m[1].toLowerCase();
    if (m[0][1] === '/') { if (st.pop() !== name) return false; } else st.push(name);
  }
  return st.length === 0;
};
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'ku', 'yi']);
const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];
// Formes du pluriel utilisées pour les nombres entiers, dans l'ordre de Plural-Forms
function pluralCats(lang) {
  try { const pr = new Intl.PluralRules(lang), seen = new Set(); for (let n = 0; n <= 200; n++) seen.add(pr.select(n)); return ORDER.filter(c => seen.has(c)); }
  catch { return ['one', 'other']; }
}

// ---- Lecture d'un fichier PO ----
function unq(s) {
  return s.slice(1, -1).replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[c] ?? c));
}
function parsePo(text, file) {
  const entries = [], lines = text.replace(/\r\n?/g, '\n').split('\n');
  let e = null, key = null;
  const flush = () => { if (e && e.msgid !== undefined) entries.push(e); e = null; key = null; };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    if (line.startsWith('#')) {
      if (e && e.msgid !== undefined) flush();
      e ||= { comments: [], line: i + 1 };
      if (line.startsWith('#,') && /\bfuzzy\b/.test(line)) e.fuzzy = true;
      e.comments.push(raw);
      return;
    }
    const m = line.match(/^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")$/);
    if (m) {
      if (m[1] === 'msgid' && e && e.msgid !== undefined) flush();
      e ||= { comments: [], line: i + 1 };
      key = m[1].startsWith('msgstr[') ? 'msgstr' + m[2] : m[1];
      e[key] = unq(m[3]);
      return;
    }
    if (line.startsWith('"') && e && key) { e[key] += unq(line); return; }
    throw new Error(`${file}:${i + 1} : ligne illisible « ${line.slice(0, 60)} »`);
  });
  flush();
  return entries;
}
const headerOf = entries => {
  const h = entries.find(x => x.msgid === '');
  return Object.fromEntries(String(h ? h.msgstr || '' : '').split('\n').map(l => l.split(/:\s*/)).filter(x => x.length > 1).map(([k, ...v]) => [k, v.join(':').trim()]));
};

// ---- Fichiers de langue ----
const poFiles = fs.readdirSync(SRC).filter(f => /^[a-z]{2,3}(-[A-Za-z]{2,4})?\.po$/.test(f)).sort();
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
  for (const file of [...walk(path.join(ROOT, 'client', 'app')), ...walk(path.join(ROOT, 'src'))]) {
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
function dictOf(L) {
  const cats = pluralCats(L.base), d = {};
  for (const e of L.entries) {
    if (!e.msgid || e.fuzzy) continue;
    const where = `${L.file}:${e.line}`, fr = norm(e.msgid);
    const check = (tr, ref) => {
      if (tags(tr) !== tags(ref)) err(`${where} : balises différentes`);
      if (!balanced(tr)) err(`${where} : balise non fermée`);
      for (const v of vars(tr)) if (!vars(ref).has(v)) err(`${where} : {${v}} inconnu`);
    };
    if (e.msgid_plural !== undefined) {
      const forms = cats.map((_, i) => norm(e['msgstr' + i] || ''));
      if (!forms.some(Boolean)) continue;
      if (forms.some(x => !x)) { err(`${where} : ${cats.length} formes du pluriel attendues (${cats.join(', ')})`); continue; }
      const all = new Set([...vars(e.msgid), ...vars(e.msgid_plural)]);
      forms.forEach(x => { check(x, e.msgid_plural); });
      for (const v of all) if (!forms.some(x => vars(x).has(v))) warn(`${where} : {${v}} absent de toutes les formes`);
      d[fr] = forms;
    } else {
      const tr = norm(e.msgstr || '');
      if (!tr) continue;
      check(tr, e.msgid);
      for (const v of vars(e.msgid)) if (!vars(tr).has(v)) warn(`${where} : {${v}} absent (vérifie que c'est voulu)`);
      d[fr] = tr;
    }
  }
  return d;
}
const built = {};
for (const L of Object.values(langs)) {
  const own = dictOf(L);
  const baseL = L.code !== L.base ? langs[L.base] : null;
  if (L.code !== L.base && !baseL && L.base !== 'fr') warn(`${L.file} : pas de ${L.base}.po, la variante est utilisée seule`);
  const dict = { ...(baseL ? dictOf(baseL) : {}), ...own };
  const h = { ...(baseL ? baseL.header : {}), ...L.header };
  const meta = { code: L.code, base: L.base, name: h['X-Language-Name'] || L.code, dir: RTL.has(L.base) ? 'rtl' : 'ltr',
    locale: h['X-Locale'] || L.code, plural: pluralCats(L.base), n: Object.keys(dict).length };
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
