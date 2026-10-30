'use strict';

const { sha } = require('../util');

// Qui peut retirer une annonce ou un événement : l'admin, ou l'orga qui l'a publié (par son identifiant, jamais par son nom)
const canManage = (orga, x) => !!orga && (orga.admin || (!!x.oid && x.oid === orga.id));
// Empreinte publique de l'auteur (l'appli sait ainsi afficher « retirer » sur ses propres annonces), sans révéler l'identifiant
const ownerTag = oid => oid ? sha('owner|' + oid).slice(0, 12) : null;

module.exports = { canManage, ownerTag };
