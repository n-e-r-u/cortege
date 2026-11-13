'use strict';
// Vérification du code du serveur (intégration continue : npx eslint, sans rien ajouter aux dépendances de l'appli).
// Règles choisies pour attraper de vraies erreurs (nom inconnu, constante réaffectée, clé en double, code jamais atteint), pas le style.
const names = ['require', 'module', 'exports', '__dirname', '__filename', 'process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'fetch', 'AbortSignal', 'AbortController',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask', 'TextEncoder', 'TextDecoder', 'Intl', 'structuredClone', 'performance',
  'Response', 'Request', 'Headers', 'FormData', 'Blob', 'crypto', 'globalThis', 'PhusionPassenger', 'WebAssembly', 'atob', 'btoa'];
module.exports = [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: Object.fromEntries(names.map(n => [n, 'readonly'])) },
  rules: { 'no-undef': 'error', 'no-const-assign': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-unreachable': 'error', 'no-redeclare': 'error',
    'no-self-assign': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-func-assign': 'error', 'no-import-assign': 'error', 'no-unsafe-negation': 'error',
    'use-isnan': 'error', 'valid-typeof': 'error', 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }] },
}, {
  // Parties du téléphone chargées à la demande (client/parts) : elles ne partagent pas les variables du reste de l'appli.
  // Un nom qu'elles utilisent sans le recevoir (« core ») est une erreur, attrapée ici plutôt que sur le terrain.
  files: ['client/parts/*.js'],
  languageOptions: { sourceType: 'script', globals: Object.fromEntries(['window', 'document', 'location', 'history', 'localStorage', 'navigator', 'Option', 'L'].map(n => [n, 'readonly'])) },
}, {
  // Scripts assemblés du téléphone et de l'admin : un nom inconnu (fonction déplacée dans une partie à la demande, faute de frappe)
  // casserait l'appli sur le terrain. Seuls les noms du navigateur et des bibliothèques de public/vendor sont admis.
  files: ['public/app.js', 'public/admin.js'],
  languageOptions: { sourceType: 'script', globals: Object.fromEntries(['window', 'document', 'location', 'history', 'localStorage', 'sessionStorage', 'navigator', 'screen', 'caches', 'indexedDB',
    'Option', 'Image', 'File', 'Event', 'CustomEvent', 'EventSource', 'MutationObserver', 'Notification', 'DeviceOrientationEvent', 'SpeechSynthesisUtterance', 'speechSynthesis',
    'addEventListener', 'removeEventListener', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'getSelection', 'matchMedia', 'innerHeight', 'confirm', 'print',
    'L', 'qrcode'].map(n => [n, 'readonly'])) },
  rules: { 'no-unused-vars': 'off' },
}];
