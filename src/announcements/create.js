'use strict';
const crypto = require('crypto');
const { ANN_MAX, CENTER, MIN } = require('../config');
const { clean, validLatLng, round } = require('../util');
const { pushBroadcast } = require('../push');
const { saveAnn, annView } = require('./store');

// Création d'annonce, partagée par l'espace orga et la page admin.
//  - numéro de legal team : permanent, jusqu'à ce que l'orga (ou l'admin) le retire ;
//  - annonce nationale : réservée à l'admin, visible partout en France.
function createAnnouncement(b, by, admin, pending = false, oid = admin ? 'admin' : null) {
  const kind = b.kind === 'legal' ? 'legal' : 'info';
  const national = kind === 'info' && !!b.national && admin;
  const level = kind === 'info' && b.level === 'urgent' ? 'urgent' : 'info';
  const text = clean(b.text, ANN_MAX);
  // Lien « En savoir plus » : réservé à l'admin (évite les liens piégés)
  const link = admin && kind === 'info' && /^https:\/\/[^\s"<>]{4,300}$/.test(String(b.link || '').trim()) ? String(b.link).trim() : '';
  const phone = kind === 'legal' ? String(b.phone || '').replace(/[^\d+ .]/g, '').trim().slice(0, 20) : '';
  const city = kind === 'legal' ? clean(b.city, 40) : '';
  const lat = Number(b.lat), lng = Number(b.lng);
  const r = national ? 0 : Math.min(Math.max(Number(b.radiusKm) || 3, 0.5), 50);
  const minutes = Math.min(Math.max(Number(b.minutes) || 60, 10), 24 * 60);
  if (kind === 'info' && text.length < 3) return [400, { error: 'Écris le message de l’annonce.' }];
  if (kind === 'legal' && phone.replace(/\D/g, '').length < 6) return [400, { error: 'Numéro de téléphone invalide.' }];
  if (kind === 'legal' && city.length < 2) return [400, { error: 'Indique la ville de la legal team.' }];
  if (!national && !validLatLng(lat, lng)) return [400, { error: 'Position invalide.' }];
  const now = Date.now();
  const a = { id: crypto.randomBytes(6).toString('base64url'), kind, level, text, phone, ...(city ? { city } : {}), by, oid, link,
    lat: national ? CENTER[0] : round(lat), lng: national ? CENTER[1] : round(lng), r, national, permanent: kind === 'legal',
    t: now, exp: kind === 'legal' ? now + 3650 * 24 * 60 * MIN : now + minutes * MIN };
  if (pending) a.pending = true; // annonce d'une orga en essai : affichée après validation par l'admin
  saveAnn(a);
  if (a.level === 'urgent' && !a.pending) pushBroadcast(a).catch(e => console.error('push', e.message));
  return [201, annView(a)];
}

module.exports = { createAnnouncement };
