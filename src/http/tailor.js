'use strict';
// Page d'accueil et manifeste : écrits pour l'instance d'origine (adresse et pseudo en dur, lus par les moteurs de recherche
// et les aperçus de partage, qui n'exécutent pas le script). Une autre instance les sert avec sa propre adresse et son pseudo.
// La mention d'origine (auteur du logiciel, liens du pied de page) ne change pas.
// Fonction pure, sans dépendance : elle sert au serveur (http/static.js) et au vérificateur (verifier.js), qui doit pouvoir
// refaire exactement la même adaptation pour comparer une instance à ce dépôt.
const HOME = 'https://cortege.neru.tv', HOME_HANDLE = 'neru';
const TAILORED = new Set(['/', '/index.html', '/manifest.webmanifest']);
const cleanBase = base => String(base || '').replace(/\/$/, '');
const cleanHandle = handle => String(handle || '').replace(/[^\w.]/g, '');
const isHome = (base, handle) => cleanBase(base) === HOME && cleanHandle(handle) === HOME_HANDLE;
function tailorText(text, base, handle) {
  const b = cleanBase(base), h = cleanHandle(handle);
  return String(text).split('</head>').map((part, i) => i ? part : part.replaceAll(HOME, b)
    .replaceAll(' Par @neru.', h ? ` Par @${h}.` : '').replaceAll(', par @neru', h ? `, par @${h}` : '')).join('</head>')
    .replace('"Cortège par @neru"', h ? `"Cortège par @${h}"` : '"Cortège"');
}

module.exports = { HOME, TAILORED, cleanHandle, isHome, tailorText };
