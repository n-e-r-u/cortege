'use strict';
// Valeur renvoyée par un module de routes quand la requête ne le concerne pas : server.js passe au suivant.
const NEXT = Symbol('route suivante');

module.exports = { NEXT };
