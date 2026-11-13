'use strict';
// Tableau de bord d'une orga (« Mon orga ») et rappels avant ses rendez-vous de l'agenda.
//  - Chiffres : tirés du journal des actions de l'orga (30 derniers jours et depuis le début). Rien de nouveau n'est enregistré.
//  - Rappels : seulement si l'orga les demande. L'adresse de notification du téléphone est alors gardée avec l'identifiant
//    de l'orga (table orga_push, 5 appareils au plus), retirée dès qu'elle les coupe, quitte le mode orga ou perd son accès,
//    et à l'effacement d'urgence. Deux notifications par rendez-vous publié : la veille et deux heures avant.
const { MIN } = require('../config');
const { db, q, tx, getMeta, setMeta } = require('../db');
const { sha, distKm } = require('../util');
const { listEvents } = require('../events/store');
const { readOrgas, onAccessCut } = require('./store');

db.exec('CREATE TABLE IF NOT EXISTS orga_push(id TEXT PRIMARY KEY, oid TEXT, e TEXT NOT NULL, k TEXT, a TEXT, lang TEXT, t INTEGER)');
const DEVICE_MAX = 5, DAY = 24 * 60 * MIN, ANN_REACH_KM = 11; // 3 km d'annonce + 8 km de marge (zones arrondies), comme pushBroadcast
const ACTS = {
  verified: ['vérifié', 'vérifié (signalement)', 'confirmé (essai)', 'confirmé (parrainée)'],
  removed: ['retiré', 'retrait (essai)'],
  announcements: ['annonce', 'annonce (en attente)', 'legal team (en attente)'],
  events: ['événement', 'événement (en attente)'],
  reports: ['signalement'],
};
function counts(oid, since) {
  const rows = q('SELECT action, COUNT(*) n FROM orga_log WHERE oid=? AND t>=? GROUP BY action').all(oid, since);
  const out = {};
  for (const [k, acts] of Object.entries(ACTS)) out[k] = rows.filter(r => acts.includes(r.action)).reduce((s, r) => s + r.n, 0);
  return out;
}
// Téléphones qui recevraient une annonce urgente publiée à cet endroit (même règle que l'envoi : zone arrondie à ~10 km).
// Un total seulement ; en dessous de 5, on dit « moins de 5 ».
function reach(lat, lng) {
  const d = ANN_REACH_KM / 111;
  const n = q('SELECT lat, lng FROM push WHERE (urg IS NULL OR urg<>0) AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?').all(lat - d, lat + d, lng - d * 1.6, lng + d * 1.6)
    .filter(s => distKm(s.lat, s.lng, lat, lng) <= ANN_REACH_KM).length;
  return n < 5 ? 0 : n;
}
function orgaBoard(orga, now = Date.now()) {
  const oid = orga.admin ? 'admin' : orga.id;
  const first = q('SELECT MIN(t) t FROM orga_log WHERE oid=?').get(oid).t || null;
  const events = listEvents().filter(e => e.oid === oid && e.start > now - 3 * 60 * MIN).sort((a, b) => a.start - b.start).slice(0, 10)
    .map(e => ({ id: e.id, type: e.type, title: e.title, place: e.place, start: e.start, lat: e.lat, lng: e.lng, pending: e.status === 'pending', reach: reach(e.lat, e.lng) }));
  return { month: counts(oid, now - 30 * DAY), total: counts(oid, 0), since: first, events,
    remind: { can: canRemind(orga) } };
}

// ---- Rappels ----
const canRemind = orga => !orga.admin && readOrgas().some(o => o.id === orga.id);
function remindSet(orga, b, now = Date.now()) {
  const { PUSH_HOSTS, PUSH_LANGS } = require('../push');
  if (!canRemind(orga)) return [400, { error: 'Pas de rappel pour un accès défini dans les réglages du serveur.' }];
  const sub = b.sub || {}, endpoint = String(sub.endpoint || '');
  let host = ''; try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
  if (!PUSH_HOSTS.test(host) || endpoint.length > 1000) return [400, { error: 'Service de notification non pris en charge.' }];
  const k = String(sub.keys?.p256dh || '').replace(/=+$/, ''), a = String(sub.keys?.auth || '').replace(/=+$/, '');
  if (!/^[\w-]{86,88}$/.test(k) || !/^[\w-]{20,24}$/.test(a)) return [400, { error: 'Abonnement invalide.' }];
  const id = sha(endpoint).slice(0, 24);
  tx(() => {
    q('INSERT OR REPLACE INTO orga_push(id,oid,e,k,a,lang,t) VALUES(?,?,?,?,?,?,?)').run(id, orga.id, endpoint, k, a, PUSH_LANGS.includes(b.lang) ? b.lang : 'fr', now);
    // Au-delà de 5 appareils, les plus anciens sortent
    for (const x of q('SELECT id FROM orga_push WHERE oid=? ORDER BY t DESC LIMIT -1 OFFSET ?').all(orga.id, DEVICE_MAX)) q('DELETE FROM orga_push WHERE id=?').run(x.id);
  });
  return [200, { ok: true, on: true }];
}
// Sans adresse : tous les appareils de l'orga (accès coupé, orga supprimée)
function remindDrop(oid, endpoint) {
  if (!oid) return 0;
  return endpoint ? q('DELETE FROM orga_push WHERE oid=? AND id=?').run(oid, sha(String(endpoint)).slice(0, 24)).changes : q('DELETE FROM orga_push WHERE oid=?').run(oid).changes;
}
onAccessCut(id => remindDrop(id));
const remindHas = (oid, endpoint) => !!q('SELECT 1 FROM orga_push WHERE oid=? AND id=?').get(oid, sha(String(endpoint || '')).slice(0, 24));

// Rappels à envoyer maintenant : [{ key, kind, e (rendez-vous), subs }]. Chaque rappel ne part qu'une fois (clé gardée 3 jours).
function remindDue(now = Date.now()) {
  let sent = {}; try { sent = JSON.parse(getMeta('orgaRemind') || '{}'); } catch {}
  const alive = new Set(readOrgas().filter(o => o.hash).map(o => o.id)), out = [];
  for (const e of listEvents()) {
    if (!e.oid || e.status !== 'ok' || !alive.has(e.oid)) continue;
    const left = e.start - now;
    const kind = left <= 2 * 60 * MIN && left > 10 * MIN ? 'soon' : left <= DAY && left > 6 * 60 * MIN ? 'eve' : null;
    if (!kind || sent[kind + ':' + e.id]) continue;
    out.push({ key: kind + ':' + e.id, kind, e, subs: q('SELECT * FROM orga_push WHERE oid=?').all(e.oid) });
  }
  return out;
}
function remindPayload(kind, e, lang) {
  const { tr, LOCALE } = require('../push');
  const hour = new Date(e.start).toLocaleTimeString(LOCALE[lang] || 'fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  const day = new Date(e.start).toLocaleDateString(LOCALE[lang] || 'fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
  return JSON.stringify({ title: '📅 ' + (kind === 'soon' ? tr(lang, 'Ton rendez-vous commence à {h}', { h: hour }) : tr(lang, 'Ton rendez-vous : {day} à {h}', { day, h: hour })),
    body: e.title + (e.place ? ' · ' + e.place : '') + '\n' + (kind === 'soon' ? tr(lang, 'Annonces, position en direct et point de ralliement sont dans l’espace orga.')
      : tr(lang, 'Vérifie l’heure, le lieu et le parcours dans l’agenda. L’affiche à imprimer est dans « Mon orga ».')),
    tag: 'orga-rdv-' + e.id, url: '/?espace=orga', vibrate: [200, 100, 200] });
}
let busy = false;
async function remindTick(now = Date.now(), send = null) {
  if (busy) return 0; busy = true;
  let n = 0;
  try {
    const due = remindDue(now);
    if (!due.length) return 0;
    // Marqués avant l'envoi : un redémarrage au milieu ne renvoie pas deux fois le même rappel
    let sent = {}; try { sent = JSON.parse(getMeta('orgaRemind') || '{}'); } catch {}
    for (const k of Object.keys(sent)) if (now - sent[k] > 3 * DAY) delete sent[k];
    for (const d of due) sent[d.key] = now;
    setMeta('orgaRemind', JSON.stringify(sent));
    const one = send || ((s, p) => require('../push').pushOne(s, p, false));
    for (const d of due) for (const s of d.subs) {
      const code = await one(s, remindPayload(d.kind, d.e, s.lang || 'fr'));
      if (code === 404 || code === 410) q('DELETE FROM orga_push WHERE id=?').run(s.id); else n++;
    }
  } catch (e) { console.error('rappels orga', e.message); } finally { busy = false; }
  return n;
}
if (process.env.ORGA_REMIND !== '0') setInterval(() => remindTick(), 5 * MIN).unref();

module.exports = { orgaBoard, remindSet, remindDrop, remindHas, remindDue, remindPayload, remindTick };
