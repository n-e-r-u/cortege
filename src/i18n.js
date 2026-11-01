'use strict';
// Traductions côté serveur (notifications, messages) : mêmes fichiers que l'appli (public/lang/*.json, construits depuis i18n/*.po).
// Le français sert de clé. Une langue ajoutée (son fichier déposé et construit) est reconnue au démarrage.
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const DIR = path.join(ROOT, 'public', 'lang');
const norm = s => String(s).replace(/\s+/g, ' ').trim();
// Langue de secours de l'instance (téléphones dont la langue n'est pas disponible) : DEFAULT_LANG, sinon la langue
// du premier profil pays (anglais pour une instance américaine), sinon le français
const firstProfileLang = (() => { try { const c = String(process.env.PROFILES || 'fr').split(',')[0].trim();
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', c + '.json'), 'utf8')).lang; } catch { return null; } })();
let INDEX = [];
try { INDEX = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')); } catch {}
if (!INDEX.some(x => x.code === 'fr')) INDEX.unshift({ code: 'fr', base: 'fr', name: 'Français', dir: 'ltr', locale: 'fr-FR', n: 0 });
const LANGS = INDEX.map(x => x.code);
const DEFAULT_LANG = [process.env.DEFAULT_LANG, firstProfileLang, 'fr'].find(l => l && LANGS.includes(l));
const DICT = {};
for (const x of INDEX) {
  DICT[x.code] = {};
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(DIR, x.code + '.json'), 'utf8')))) if (k) DICT[x.code][norm(k)] = v; } catch {}
}
const LOCALE = Object.fromEntries(INDEX.map(x => [x.code, x.locale || x.code]));
const langOf = l => (DICT[l] ? l : DICT[String(l || '').slice(0, 2)] ? String(l).slice(0, 2) : 'fr');
function tr(lang, s, v) {
  const d = DICT[langOf(lang)][norm(s)], out = typeof d === 'string' ? d : Array.isArray(d) ? d[d.length - 1] : s;
  return v ? out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : out;
}
// Liste des langues pour le téléphone (/lang/langs.js), chargée avant i18n.js
const langsJs = () => `window.CORTEGE_LANGS=${JSON.stringify(INDEX.map(({ code, base, name, dir, locale, plural, n }) => ({ code, base, name, dir, locale, plural, n })))};`
  + `window.CORTEGE_DEFAULT_LANG=${JSON.stringify(DEFAULT_LANG)};\n`;

module.exports = { LANGS, LOCALE, DEFAULT_LANG, tr, langOf, langsJs };
