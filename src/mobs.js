'use strict';
const crypto = require('crypto');
const { MIN } = require('./config');
const { dirty, scheduleFlush } = require('./live/files');
const { getPub } = require('./digest/pub');
const { mobsAll, adminLabel } = require('./settings');
const { orgaLog } = require('./orgas/log');
const { parisDay, parisHour } = require('./digest/archive');
const { parisMs } = require('./events/import-17oct');
const { pushAll, LOCALE, tr, pushSendAll } = require('./push');
const { setMeta, getMeta } = require('./db');
const { strictUntil } = require('./limits');

// ---- Journées de mobilisation prévues ----
// La veille à 20 h : notification à tous les abonné·es aux annonces urgentes. Le jour J dès 7 h : mode renforcé jusqu'à 2 h du matin
// et titre de la journée en bandeau. Le lendemain : l'admin est invité·e à publier le bilan public.
const nextDay = d => parisDay(parisMs(d, '12:00') + 24 * 60 * MIN);
function cleanMob(b, old = {}) {
  const str = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const date = String(b.date || old.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Date invalide.' };
  const title = str(b.title ?? old.title, 80);
  if (title.length < 3) return { error: 'Donne un titre à la journée (affiché en bandeau).' };
  return { id: old.id || crypto.randomBytes(5).toString('base64url'), date, title, eve: str(b.eve ?? old.eve, 160),
    push: (b.push ?? old.push) !== false, strict: (b.strict ?? old.strict) !== false };
}
async function mobEve(m) {
  const targets = pushAll().filter(s => s.urg !== 0);
  if (!targets.length) return;
  // Le titre et le texte de la journée sont écrits par l'admin (en français) ; le reste suit la langue du téléphone
  const day = l => new Date(parisMs(m.date, '12:00')).toLocaleDateString(LOCALE[l], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const payload = l => JSON.stringify({ title: '📣 ' + tr(l, 'Demain : {t}', { t: m.title }),
    body: m.eve || tr(l, 'Journée de mobilisation {d}. Ouvre Cortège pour voir l’agenda et les numéros utiles.', { d: day(l) }),
    tag: 'mob-' + m.id, url: '/', vibrate: [300, 100, 300] });
  await pushSendAll(targets, payload, true, 'veille de mobilisation');
}
function mobTick() {
  const now = Date.now(), today = parisDay(now), h = parisHour(now) % 24;
  if (mobTick.day !== today) { mobTick.day = today; dirty.global = true; scheduleFlush(); } // bandeau du jour
  let list = mobsAll();
  if (!list.length) return;
  const old = parisDay(now - 30 * 24 * 60 * MIN), kept = list.filter(m => m.date >= old);
  if (kept.length !== list.length) { setMeta('mobs', JSON.stringify(kept)); list = kept; }
  for (const m of list) {
    if (m.push && m.date === nextDay(today) && h >= 20 && h < 23 && !getMeta('mob:eve:' + m.id)) {
      setMeta('mob:eve:' + m.id, now);
      mobEve(m).catch(e => console.error('veille de mobilisation', e.message));
    }
    if (m.strict && m.date === today && h >= 7 && !getMeta('mob:strict:' + m.id)) {
      setMeta('mob:strict:' + m.id, now);
      const until = parisMs(nextDay(today), '02:00');
      if (strictUntil(now) < until) { setMeta('strict', until); orgaLog({ id: 'admin', label: adminLabel() }, 'mode manif renforcé (journée prévue)', { detail: m.title }); }
    }
  }
}
setInterval(() => { try { mobTick(); } catch (e) { console.error('journées', e.message); } }, 60_000).unref();
// Bilans à publier : journées passées depuis moins de 7 jours, pas encore publiées
const mobsToPublish = (now = Date.now()) => { const today = parisDay(now), from = parisDay(now - 7 * 24 * 60 * MIN);
  return mobsAll().filter(m => m.date < today && m.date >= from && !getPub(m.date)).map(m => ({ date: m.date, title: m.title })); };

module.exports = { cleanMob, mobsToPublish };
