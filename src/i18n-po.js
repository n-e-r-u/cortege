'use strict';
// Lecture et vérification des fichiers de traduction PO, partagées par tools/i18n-build.js et par l'admin (onglet Langues).
// Vérifie que chaque traduction garde les mêmes balises HTML (bien fermées) et les mêmes {valeurs}.
// Pluriels : autant de formes que la langue en a, dans l'ordre zero, one, two, few, many, other,
// comme le navigateur les choisit (Intl.PluralRules). Aucune dépendance.
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
// Règle gettext à écrire dans l'en-tête (Poedit la demande) : les cas courants, sinon à compléter dans Poedit
const PLURAL_RULES = {
  1: 'nplurals=1; plural=0;',
  fr: 'nplurals=2; plural=(n > 1);', pt: 'nplurals=2; plural=(n > 1);',
  2: 'nplurals=2; plural=(n != 1);',
  ru: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  uk: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  pl: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
  ar: 'nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5);',
};
const pluralRule = lang => { const b = String(lang).split('-')[0], n = pluralCats(b).length; return PLURAL_RULES[b] || PLURAL_RULES[n] || `nplurals=${n}; plural=EXPRESSION;`; };

// ---- Lecture d'un fichier PO ----
function unq(s) {
  return s.slice(1, -1).replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[c] ?? c));
}
function parsePo(text, file) {
  const entries = [], lines = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
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

// ---- Dictionnaire d'une langue : { texte français → traduction } ; les problèmes passent par err et warn ----
function dictOf(L, err, warn) {
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
// Informations d'une langue, gardées en tête de son fichier construit et dans la liste des langues
const metaOf = (code, base, h, n) => ({ code, base, name: h['X-Language-Name'] || code, dir: RTL.has(base) ? 'rtl' : 'ltr',
  locale: h['X-Locale'] || code, plural: pluralCats(base), n });
const LANG_CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
// Textes du modèle (cortege.pot) : sert à calculer la part traduite d'une langue
const potIds = text => parsePo(text, 'cortege.pot').filter(e => e.msgid).map(e => norm(e.msgid));

module.exports = { norm, tags, vars, balanced, RTL, ORDER, pluralCats, pluralRule, unq, parsePo, headerOf, dictOf, metaOf, LANG_CODE, potIds };
