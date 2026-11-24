'use strict';
// Routes de la page admin (/api/admin/…). Ce fichier vérifie la clé admin, puis passe la main au fichier du thème :
// orgas, modération, lieux, publication, configuration de l'instance.
const { ADMIN_KEY } = require('../config');
const { NEXT } = require('./next');
const { isAdmin } = require('../orgas/auth');
const { send } = require('../http/respond');
const THEMES = [
  require('./admin-orgas').adminOrgasRoutes,             // accès, invitations, révocation, demandes
  require('./admin-moderation').adminModerationRoutes,   // signalements, direct, modération, abus, journal, corbeille
  require('./admin-lieux').adminLieuxRoutes,             // lieux permanents, lieux de repli
  require('./admin-publication').adminPublicationRoutes, // réglages, mobilisations, annonces, bilans, annuaire, arrêtés, agenda
  require('./admin-config').adminConfigRoutes,           // instance, pays, langues, serveur
];

async function adminRoutes(req, res, url, pathname) {
  if (!pathname.startsWith('/api/admin/')) return NEXT;
  if (!ADMIN_KEY) return send(res, 404, { error: 'Admin désactivé : ajoute ADMIN_KEY dans les variables du serveur.' });
  if (!isAdmin(req)) return send(res, 403, { error: 'Clé incorrecte.' });
  for (const theme of THEMES) {
    const out = await theme(req, res, url, pathname);
    if (out !== NEXT) return out;
  }
  return send(res, 404, { error: 'Inconnu.' });
}

module.exports = { adminRoutes };
