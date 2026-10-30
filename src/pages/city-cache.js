'use strict';
// Index des pages de villes, gardé 5 min : remis à zéro (at = 0) quand un événement, une legal team ou un bilan change.
const cityIdx = { at: 0, map: new Map() };

module.exports = { cityIdx };
