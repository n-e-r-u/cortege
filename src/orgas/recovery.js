'use strict';
// ---- Code de secours : retrouver son accès (orga ou équipe medic) sans dépendre de personne ----
// Donné une seule fois, à l'activation ou à la demande ; le serveur n'en garde que l'empreinte. Saisi sur n'importe quel
// téléphone, il donne une nouvelle clé et un nouveau code (chaque code ne sert qu'une fois), et peut couper les autres appareils
// (téléphone perdu ou saisi). 20 caractères sans lettres ambiguës : environ 98 bits, impossible à deviner.
const crypto = require('crypto');
const { sha } = require('../util');

const ALPHA = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function newCode() {
  let s = '';
  while (s.length < 20) { const b = crypto.randomBytes(1)[0]; if (b < 240) s += ALPHA[b % 30]; } // 240 = 8 × 30 : tirage sans biais
  return s.match(/.{4}/g).join('-');
}
// Saisie tolérante : minuscules, espaces et tirets acceptés
const normCode = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const validCode = v => { const n = normCode(v); return n.length === 20 && [...n].every(c => ALPHA.includes(c)); };
const codeHash = v => sha('secours|' + normCode(v));

module.exports = { newCode, normCode, validCode, codeHash };
