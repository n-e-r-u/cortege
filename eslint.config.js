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
}];
