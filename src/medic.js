'use strict';
// ---- Mode medic : une carte privée pour les équipes de street medics ----
// Comptes « équipe medic » (une clé par équipe, comme les orgas, mais sans aucun de leurs droits) et une couche de carte
// que seules ces équipes voient : leurs positions, des points chauds, des barrages filtrants, des appels de renfort.
// Les infos sont ajoutées et retirées à la main par les équipes : pas de votes, pas de fusion, rien ne vient de la foule.
//
// Vie privée, par construction :
// - la couche vit en mémoire seulement : jamais dans la base, les fichiers live/, le temps réel public, l'archive, les bilans
//   ni les sauvegardes ; elle disparaît au retrait, à l'expiration, au redémarrage et à l'effacement d'urgence ;
// - aucune donnée sur une personne blessée : un lieu, un type, un niveau, un état. Ni nom ni texte libre ;
// - l'admin ne voit que des totaux, jamais les positions ;
// - sur le disque : seulement la liste des équipes (nom, ville, empreintes des clés), dans medics.json.
//
// Trois fichiers : medic/store.js (équipes sur le disque, réglage), medic/teams.js (équipes et appareils), medic/layer.js
// (couche privée en mémoire). Celui-ci ne fait que les réunir.
module.exports = { ...require('./medic/store'), ...require('./medic/teams'), ...require('./medic/layer') };
