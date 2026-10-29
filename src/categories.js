'use strict';
// Types de signalement, d'événement de l'agenda, fusion, alertes et vibrations : source unique, envoyée telle quelle aux téléphones.

// ---- Catégories (source unique, envoyée au client) — ttl en minutes ----
const CATEGORIES = [
  { id: 'crs',            group: 'fdo',     label: 'CRS / Gendarmes mobiles', glyph: '🛡️', ttl: 20 },
  { id: 'police',         group: 'fdo',     label: 'Police',                  glyph: '🚓', ttl: 20 },
  { id: 'bac',            group: 'fdo',     label: 'BAC / BRAV-M',            glyph: '🏍️', ttl: 15 },
  // Militaires de l'opération Sentinelle : garde statique de bâtiments, pas de maintien de l'ordre (pas d'alerte, ne suspend pas les zones calmes)
  { id: 'militaires',     group: 'fdo',     label: 'Militaires (Sentinelle)', glyph: '🪖', ttl: 60 },
  { id: 'inter',          group: 'fdo',     label: 'Unités d’intervention (BRI, RAID, GIGN)', glyph: '🚨', ttl: 15 },
  { id: 'blinde',         group: 'fdo',     label: 'Blindé (Centaure, VBRG)', glyph: '🚛', ttl: 20 },
  { id: 'nasse',          group: 'fdo',     label: 'Nasse / encerclement',    glyph: '⭕', ttl: 20 },
  { id: 'interpellation', group: 'fdo',     label: 'Interpellations',         glyph: '⛓️', ttl: 20 },
  { id: 'lacrymo',        group: 'danger',  label: 'Lacrymo',                 glyph: '💨', ttl: 15 },
  { id: 'canon',          group: 'danger',  label: 'Canon à eau',             glyph: '🌊', ttl: 15 },
  { id: 'charge',         group: 'danger',  label: 'Charge',                  glyph: '⚡', ttl: 10 },
  { id: 'tirs',           group: 'danger',  label: 'Tirs LBD / grenades',     glyph: '💥', ttl: 10 },
  // Attaques de groupes d'extrême droite contre les cortèges : danger avec alerte, le point suit le groupe
  { id: 'facho',          group: 'danger',  label: 'Milice / groupe fasciste', glyph: '☠️', ttl: 20 },
  { id: 'chaud',          group: 'danger',  label: 'Point chaud',             glyph: '🔥', ttl: 20 },
  { id: 'sommations',     group: 'danger',  label: 'Sommations',              glyph: '📢', ttl: 20 },
  { id: 'medic',          group: 'soutien', label: 'Street medic',            glyph: '⛑️', ttl: 45 },
  { id: 'legal',          group: 'soutien', label: 'Legal team / observateurs', glyph: '⚖️', ttl: 60 },
  { id: 'presse',         group: 'soutien', label: 'Presse',                  glyph: '🎥', ttl: 45 },
  { id: 'calme',          group: 'soutien', label: 'Zone calme / repli',      glyph: '🕊️', ttl: 90 },
  { id: 'eau',            group: 'soutien', label: 'Eau / sérum phy',         glyph: '💧', ttl: 90 },
  // Tête et queue : un seul point chacune, qui suit le cortège (avec sa trace des 30 dernières minutes)
  { id: 'cortege',        group: 'info',    label: 'Tête de cortège',         glyph: '📣', ttl: 10 },
  { id: 'queue',          group: 'info',    label: 'Queue de cortège',        glyph: '🔚', ttl: 10 },
  // Point de l'admin en direct (« viens me voir pour un accès orga ») : jamais signalé par d'autres, seulement partagé par l'admin
  { id: 'contact',        group: 'info',    label: 'Point de rencontre orga', glyph: '★', ttl: 3, beaconOnly: true },
  { id: 'bloque',         group: 'info',    label: 'Rue bloquée',             glyph: '⛔', ttl: 30 },
  { id: 'blocus',         group: 'info',    label: 'Blocus (lycée / fac)',    glyph: '🚧', ttl: 180 },
];
// Agenda : types d'événements publiés par les orgas (ou proposés puis validés par l'admin)
const EVENT_TYPES = [
  { id: 'manif',         label: 'Manifestation',        glyph: '✊' },
  { id: 'blocus',        label: 'Blocus (lycée / fac)', glyph: '🚧' },
  { id: 'rassemblement', label: 'Rassemblement',        glyph: '📍' },
  { id: 'ag',            label: 'Assemblée générale',   glyph: '🗣️' },
];
const EVT = Object.fromEntries(EVENT_TYPES.map(e => [e.id, e]));
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
// Fusion : un signalement du même type dans ce rayon (m) confirme le point existant au lieu d'en créer un.
// « move » : le point glisse vers le signalement le plus récent (unités qui se déplacent).
const MERGE = {
  crs: { r: 100, move: true }, police: { r: 100, move: true }, bac: { r: 100, move: true }, canon: { r: 100, move: true },
  inter: { r: 100, move: true }, blinde: { r: 100, move: true }, tirs: { r: 100 }, militaires: { r: 60 }, facho: { r: 150, move: true },
  nasse: { r: 150 }, interpellation: { r: 80 }, lacrymo: { r: 150 }, charge: { r: 80 }, chaud: { r: 100 }, sommations: { r: 150 },
  medic: { r: 40 }, legal: { r: 40 }, presse: { r: 40 }, eau: { r: 40 }, calme: { r: 80 },
  cortege: { r: 2000, move: true }, queue: { r: 2000, move: true }, bloque: { r: 30 }, blocus: { r: 100 },
};
// Un danger actif à moins de 100 m d’une « zone calme » la suspend (affichage sur le téléphone) et empêche d’en créer une.
const CALM_KILL_M = 100;
// Dangers qui déclenchent une alerte de proximité (dans l'appli et en notification)
const ALERT_CATS = new Set(['sommations', 'lacrymo', 'canon', 'charge', 'tirs', 'facho', 'nasse', 'bac', 'inter', 'blinde', 'crs', 'interpellation']);
// Vibrations par type : on reconnaît le danger sans sortir le téléphone
const VIBES = {
  charge: [100, 60, 100, 60, 100, 60, 100, 60, 100],   // rafale courte : ça arrive vite
  nasse: [900, 200, 900],                              // deux longues : risque d'être bloqué·e
  sommations: [500, 150, 500, 150, 500],               // trois longues : partir
  lacrymo: [400, 150, 400],                            // deux moyennes
  canon: [250, 100, 250, 100, 250],                    // trois moyennes
  bac: [150, 80, 150, 80, 600],                        // deux courtes, une longue
  crs: [200, 100, 200],                                // deux courtes
  interpellation: [200, 100, 200, 100, 200],           // trois courtes
  tirs: [60, 40, 60, 40, 60, 40, 60, 40, 60, 40, 60],  // rafale très rapide : tirs
  inter: [150, 80, 150, 80, 150, 80, 600],             // trois courtes, une longue
  blinde: [700, 150, 250],                             // une longue, une courte
  facho: [600, 100, 150, 100, 150, 100, 600],          // une longue, deux courtes, une longue
};
const isDanger = cat => Object.hasOwn(CAT, cat) && cat !== 'militaires' && (CAT[cat].group === 'fdo' || CAT[cat].group === 'danger');
const GROUPS = [
  { id: 'fdo', label: 'Forces de l’ordre' },
  { id: 'danger', label: 'Danger' },
  { id: 'soutien', label: 'Soutien' },
  { id: 'info', label: 'Infos cortège' },
];
const BASE_TTL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.ttl]));

module.exports = { CATEGORIES, EVENT_TYPES, EVT, CAT, MERGE, CALM_KILL_M, ALERT_CATS, VIBES, isDanger, GROUPS, BASE_TTL };
