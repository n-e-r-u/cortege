'use strict';
// Réglages de l'instance modifiables depuis l'admin : nom de la carte, contact, liens, marque, hébergeur.
// Les variables d'environnement (EVENT_NAME, CONTACT_EMAIL…) ne servent plus que de valeurs de départ :
// un champ laissé vide dans l'admin reprend la valeur du serveur.
const { EVENT_NAME, CONTACT_EMAIL, VIOLENCE_URL, HOST_INFO, SOURCE_URL, BRAND } = require('./config');
const { getMeta, setMeta } = require('./db');

const DEFAULTS = { event: EVENT_NAME, contact: CONTACT_EMAIL, violenceUrl: VIOLENCE_URL, hostInfo: HOST_INFO, sourceUrl: SOURCE_URL, brand: { ...BRAND } };
let C = { at: 0, raw: null, v: null };
function overrides() {
  const now = Date.now();
  if (now - C.at > 3000) {
    const raw = getMeta('instance') || '{}';
    if (raw !== C.raw) { let o = {}; try { o = JSON.parse(raw); } catch {} C = { at: now, raw, o, v: null }; } else C.at = now;
  }
  return C.o;
}
// Valeurs en vigueur (réglages de l'admin, sinon valeurs du serveur)
function instance() {
  const o = overrides();
  if (!C.v) C.v = { ...DEFAULTS, ...o, brand: { ...DEFAULTS.brand, ...(o.brand || {}) } };
  return C.v;
}
const str = (x, n) => String(x ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const url = x => { const s = str(x, 300); if (!s) return ''; try { const u = new URL(s); return /^https?:$/.test(u.protocol) && !/\s/.test(s) ? s : null; } catch { return null; } };
// Contrôle de ce qu'envoie l'admin : erreur lisible, sinon les seules valeurs différentes du serveur
function cleanInstance(b) {
  const out = {}, bad = m => { throw Object.assign(new Error(m), { status: 400 }); };
  const ev = str(b.event, 60); if (ev && ev !== DEFAULTS.event) out.event = ev;
  const ct = str(b.contact, 120);
  if (ct) { if (!/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(ct)) bad('Adresse de contact invalide.'); if (ct !== DEFAULTS.contact) out.contact = ct; }
  const hi = str(b.hostInfo, 300); if (hi && hi !== DEFAULTS.hostInfo) out.hostInfo = hi;
  for (const [k, label] of [['violenceUrl', 'Lien violences policières'], ['sourceUrl', 'Lien du code source']]) {
    const u = url(b[k]); if (u === null) bad(`${label} : adresse invalide (https://…).`); if (u && u !== DEFAULTS[k]) out[k] = u;
  }
  const br = b.brand || {}, ob = {};
  const h = str(br.handle, 30).replace(/^@/, '');
  if (h) { if (!/^[\w.]{1,30}$/.test(h)) bad('Pseudo : lettres, chiffres, points et _ seulement.'); if (h !== DEFAULTS.brand.handle) ob.handle = h; }
  for (const [k, label] of [['instagram', 'Lien Instagram'], ['site', 'Site'], ['kofi', 'Lien de soutien']]) {
    const u = url(br[k]); if (u === null) bad(`${label} : adresse invalide (https://…).`); if (u && u !== DEFAULTS.brand[k]) ob[k] = u;
  }
  if (Object.keys(ob).length) out.brand = ob;
  return out;
}
function saveInstance(o) { setMeta('instance', JSON.stringify(o)); C.at = 0; overrides(); }

module.exports = { instance, cleanInstance, saveInstance, INSTANCE_DEFAULTS: DEFAULTS };
