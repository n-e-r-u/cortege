'use strict';
// Traductions côté serveur (notifications, messages) : mêmes fichiers que l'appli. Le français sert de clé.
// Deux sources : les langues livrées avec le code (public/lang/*.json, construits depuis i18n/*.po) et celles déposées
// dans l'admin (onglet Langues), gardées dans le dossier de données (i18n/*.po et lang/*.json) : une langue déposée
// passe devant la langue livrée du même code. Tout est relu sans redémarrer quand l'admin change quelque chose.
const fs = require('fs');
const path = require('path');
const { ROOT, DATA_DIR } = require('./config');
const { getMeta, setMeta } = require('./db');
const { defaultProfile } = require('./profiles');
const { norm, parsePo, headerOf, dictOf, metaOf, pluralCats, pluralRule, LANG_CODE, potIds } = require('./i18n-po');

const REPO_LANG = path.join(ROOT, 'public', 'lang'), REPO_PO = path.join(ROOT, 'i18n');
const UP_LANG = path.join(DATA_DIR, 'lang'), UP_PO = path.join(DATA_DIR, 'i18n');
const POT = path.join(REPO_PO, 'cortege.pot');
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const FR = { code: 'fr', base: 'fr', name: 'Français', dir: 'ltr', locale: 'fr-FR', plural: pluralCats('fr'), n: 0 };

// État partagé : ces objets gardent leur identité (d'autres modules les ont importés), leur contenu est remplacé
const LANGS = [];      // langues proposées (actives)
const LOCALE = {};     // langue → format des dates
const DICT = {};
let ALL = [];          // toutes les langues connues, actives ou non : { ...meta, src: 'repo' | 'upload', over: bool }
let POT_IDS = null;
const prefs = () => { try { return JSON.parse(getMeta('langs') || '{}'); } catch { return {}; } };

function load() {
  const byCode = new Map();
  for (const x of readJ(path.join(REPO_LANG, 'index.json')) || []) if (x && LANG_CODE.test(x.code)) byCode.set(x.code, { ...x, src: 'repo' });
  let up = [];
  try { up = fs.readdirSync(UP_LANG).filter(f => f.endsWith('.json') && LANG_CODE.test(f.slice(0, -5))); } catch {}
  for (const f of up) {
    const d = readJ(path.join(UP_LANG, f)), m = d && d[''];
    if (m) byCode.set(m.code, { ...m, src: 'upload', over: byCode.has(m.code) });
  }
  if (!byCode.has('fr')) byCode.set('fr', { ...FR, src: 'repo' });
  ALL = [...byCode.values()].sort((a, b) => (a.code === 'fr' ? -1 : b.code === 'fr' ? 1 : a.code.localeCompare(b.code)));
  for (const k of Object.keys(DICT)) delete DICT[k];
  for (const k of Object.keys(LOCALE)) delete LOCALE[k];
  for (const x of ALL) {
    const d = readJ(path.join(x.src === 'upload' ? UP_LANG : REPO_LANG, x.code + '.json')) || {};
    DICT[x.code] = {};
    for (const [k, v] of Object.entries(d)) if (k) DICT[x.code][norm(k)] = v;
    LOCALE[x.code] = x.locale || x.code;
  }
  const off = new Set(prefs().off || []);
  LANGS.length = 0;
  LANGS.push(...ALL.filter(x => x.code === 'fr' || !off.has(x.code)).map(x => x.code));
}
load();
// Une autre copie du serveur (plusieurs processus) a pu changer les langues : relu au plus toutes les 10 s
let seen = getMeta('langs') || '', seenAt = Date.now();
function fresh() {
  const now = Date.now(); if (now - seenAt < 10_000) return; seenAt = now;
  const v = getMeta('langs') || ''; if (v !== seen) { seen = v; load(); }
}
const bump = () => { const p = prefs(); p.rev = Date.now(); setMeta('langs', JSON.stringify(p)); seen = getMeta('langs'); load(); };

// Langue de secours de l'instance (téléphones dont la langue n'est pas proposée) : celle choisie dans l'admin,
// sinon DEFAULT_LANG, sinon la langue du pays principal (anglais pour une instance américaine), sinon le français
function defaultLang() {
  fresh();
  let pl = null; try { pl = defaultProfile().lang; } catch {}
  return [prefs().def, process.env.DEFAULT_LANG, pl, 'fr'].find(l => l && LANGS.includes(l));
}
const langOf = l => { fresh(); return LANGS.includes(l) ? l : LANGS.includes(String(l || '').slice(0, 2)) ? String(l).slice(0, 2) : 'fr'; };
function tr(lang, s, v) {
  const d = (DICT[langOf(lang)] || {})[norm(s)], out = typeof d === 'string' ? d : Array.isArray(d) ? d[d.length - 1] : s;
  return v ? out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : out;
}
// Liste des langues pour le téléphone (/lang/langs.js), chargée avant i18n.js
const langsJs = () => { fresh(); return `window.CORTEGE_LANGS=${JSON.stringify(ALL.filter(x => LANGS.includes(x.code)).map(({ code, base, name, dir, locale, plural, n }) => ({ code, base, name, dir, locale, plural, n })))};`
  + `window.CORTEGE_DEFAULT_LANG=${JSON.stringify(defaultLang())};\n`; };
// Fichier d'une langue déposée dans l'admin (sinon le fichier livré, servi comme les autres fichiers de public/)
function uploadedJson(code) {
  if (!LANG_CODE.test(code)) return null;
  try { return fs.readFileSync(path.join(UP_LANG, code + '.json')); } catch { return null; }
}

// ---- Admin : liste, dépôt d'un fichier PO, choix des langues proposées ----
function potTotal() {
  if (!POT_IDS) { try { POT_IDS = new Set(potIds(fs.readFileSync(POT, 'utf8'))); } catch { POT_IDS = new Set(); } }
  return POT_IDS.size;
}
function adminLangs() {
  fresh();
  const p = prefs(), total = potTotal();
  return { total, def: defaultLang(), langs: ALL.map(x => ({ code: x.code, name: x.name, locale: x.locale, dir: x.dir, src: x.src, over: !!x.over, n: x.n || 0,
    pct: x.code === 'fr' ? 100 : total ? Math.min(100, Math.round((x.n || 0) / total * 100)) : null, active: LANGS.includes(x.code),
    hasPo: x.src === 'upload' || fs.existsSync(path.join(REPO_PO, x.code + '.po')) })) , chosenDef: p.def || null };
}
const fail = (m, extra) => { throw Object.assign(new Error(m), { status: 400, ...extra }); };
const writeAtomic = (f, data) => { const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };
// Vérifie un fichier PO comme tools/i18n-build.js, puis le met en ligne. Renvoie la langue et les avertissements.
function uploadPo(text, fileName) {
  if (typeof text !== 'string' || !text.trim()) fail('Fichier vide.');
  let entries;
  try { entries = parsePo(text, 'fichier'); } catch (e) { fail(e.message.replace(/^fichier:/, 'Ligne ')); }
  const h = headerOf(entries);
  // Le code vient de l'en-tête du fichier (Language), sinon de son nom (de.po, pt_BR.po)
  const fromFile = (String(fileName || '').match(/^([a-z]{2,3}(?:[-_][A-Z]{2}|[-_][A-Z][a-z]{3})?)\.po$/) || [])[1];
  const code = String(h.Language || fromFile || '').trim().replace('_', '-');
  if (!LANG_CODE.test(code)) fail('Code de la langue introuvable : renseigne « Language: de » dans l’en-tête (Poedit, Catalogue › Propriétés), ou nomme le fichier de.po.');
  const base = code.split('-')[0], errors = [], warnings = [];
  const dict = dictOf({ code, base, file: code + '.po', entries }, m => errors.push(m.replace(/^[\w-]+\.po:/, 'ligne ')), m => warnings.push(m.replace(/^[\w-]+\.po:/, 'ligne ')));
  if (errors.length) fail(`${errors.length} problème(s) : rien n’a été mis en ligne.`, { problems: errors.slice(0, 30) });
  if (!Object.keys(dict).length && code !== 'fr') fail('Aucun texte traduit dans ce fichier.');
  // Variante régionale (en-US) : ses textes passent devant ceux de sa langue
  const merged = code !== base && DICT[base] ? { ...DICT[base], ...dict } : dict;
  const prev = ALL.find(x => x.code === base && code !== base);
  const meta = metaOf(code, base, { ...(prev ? { 'X-Language-Name': prev.name } : {}), ...h }, Object.keys(merged).length);
  // Langue nouvelle : cachée tant que l'admin ne la propose pas (une traduction commencée n'apparaît pas toute seule)
  if (!ALL.some(x => x.code === code)) { const p = prefs(); p.off = [...new Set([...(p.off || []), code])]; setMeta('langs', JSON.stringify(p)); }
  fs.mkdirSync(UP_LANG, { recursive: true, mode: 0o700 }); fs.mkdirSync(UP_PO, { recursive: true, mode: 0o700 });
  writeAtomic(path.join(UP_PO, code + '.po'), text);
  writeAtomic(path.join(UP_LANG, code + '.json'), JSON.stringify({ '': meta, ...merged }));
  bump();
  return { code, name: meta.name, n: meta.n, active: LANGS.includes(code), warnings: warnings.slice(0, 30) };
}
// Retire la version déposée : la langue livrée avec le code (s'il y en a une) reprend sa place
function removeUpload(code) {
  if (!LANG_CODE.test(code)) fail('Langue inconnue.');
  let found = false;
  for (const f of [path.join(UP_LANG, code + '.json'), path.join(UP_PO, code + '.po')]) { try { fs.unlinkSync(f); found = true; } catch {} }
  if (!found) fail('Aucun fichier déposé pour cette langue.');
  bump();
}
function setLangPrefs(b) {
  const p = prefs(), known = new Set(ALL.map(x => x.code));
  if (Array.isArray(b.off)) p.off = [...new Set(b.off.filter(c => known.has(c) && c !== 'fr'))];
  if (b.def !== undefined) {
    if (b.def && (!known.has(b.def) || (p.off || []).includes(b.def))) fail('La langue par défaut doit être proposée.');
    if (b.def) p.def = b.def; else delete p.def;
  }
  if (p.def && (p.off || []).includes(p.def)) fail('La langue par défaut doit être proposée.');
  p.rev = Date.now(); setMeta('langs', JSON.stringify(p)); seen = getMeta('langs'); load();
}
// Fichier PO à télécharger : celui déposé, sinon celui livré, sinon un fichier neuf prêt à traduire (en-tête rempli)
function poFor(code, name) {
  if (!LANG_CODE.test(code)) return null;
  for (const f of [path.join(UP_PO, code + '.po'), path.join(REPO_PO, code + '.po')]) { try { return fs.readFileSync(f, 'utf8'); } catch {} }
  let pot; try { pot = fs.readFileSync(POT, 'utf8'); } catch { return null; }
  const base = code.split('-')[0], n = pluralCats(base).length, nm = String(name || code).replace(/["\\\n]/g, '').slice(0, 40);
  const head = `msgid ""\nmsgstr ""\n"Project-Id-Version: Cortège\\n"\n"Language: ${code}\\n"\n"X-Language-Name: ${nm}\\n"\n"X-Locale: ${code}\\n"\n`
    + `"MIME-Version: 1.0\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Content-Transfer-Encoding: 8bit\\n"\n"Plural-Forms: ${pluralRule(base)}\\n"\n`;
  // Corps du modèle sans son en-tête ; les pluriels reçoivent le bon nombre de formes
  const body = pot.replace(/^msgid ""\nmsgstr ""\n(?:".*"\n)*/, '').replace(/(msgid_plural ".*"\n)msgstr\[0\] ""\nmsgstr\[1\] ""/g, (m, p1) => p1 + Array.from({ length: n }, (_, i) => `msgstr[${i}] ""`).join('\n'));
  return head + body;
}
const potText = () => { try { return fs.readFileSync(POT, 'utf8'); } catch { return null; } };

module.exports = { LANGS, LOCALE, tr, langOf, langsJs, defaultLang, uploadedJson, adminLangs, uploadPo, removeUpload, setLangPrefs, poFor, potText };
