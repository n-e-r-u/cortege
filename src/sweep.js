'use strict';
const { ABUSE_KEEP } = require('./moderation');
const { CONTEST } = require('./reports/votes');
const { EVENT_KEEP } = require('./events/store');
const { MIN, RATE, ARCHIVE_DAYS } = require('./config');
const { TRASH_MS } = require('./orgas/log');
const { archive } = require('./digest/archive');
const { capTables } = require('./limits');
const { dirtyCell, dirty, scheduleFlush } = require('./live/files');
const { pruneKeys } = require('./privacy');
const { q, tx, getMeta, setMeta, isBusy } = require('./db');

// Ménage toutes les 30 s : signalements, annonces et événements expirés, limites périmées, fin de pause.
function sweep() {
  const now = Date.now();
  try { pruneKeys(); } catch {}
  try { q('DELETE FROM quota WHERE t<?').run(now - 2 * 24 * 60 * MIN); capTables(); } catch (e) { console.error('plafonds', e.message); }
  try {
    const expired = tx(() => q('DELETE FROM reports WHERE exp<=? RETURNING *').all(now));
    for (const r of expired) { archive(r, r.ct ? 'cont' : 'exp'); dirtyCell(r.cell); }
    if (q('DELETE FROM ann WHERE exp<=?').run(now).changes) dirty.ann = true;
    if (q('DELETE FROM events WHERE start<=?').run(now - EVENT_KEEP).changes) dirty.events = true;
    // Arrêtés terminés : gardés 8 jours (les bilans citent ceux qui étaient en vigueur ce jour-là), jamais publiés sur la carte
    if (q('DELETE FROM orders WHERE end<=?').run(now - 8 * 24 * 60 * MIN).changes) dirty.ord = true;
    q('DELETE FROM rate WHERE t<?').run(now - RATE.windowMs);
    q('DELETE FROM hidden WHERE until<?').run(now);
    q('DELETE FROM trash WHERE t<?').run(now - TRASH_MS);
    q('DELETE FROM devices WHERE seen<?').run(now - CONTEST.devKeep);
    q('DELETE FROM abuse WHERE t<?').run(now - ABUSE_KEEP);
    q('UPDATE abuse SET dev=NULL, net=NULL WHERE t<? AND (dev IS NOT NULL OR net IS NOT NULL)').run(now - 60 * MIN);
    q('DELETE FROM orga_log WHERE t<?').run(now - ARCHIVE_DAYS * 24 * 60 * MIN);
    const p = Number(getMeta('paused') || 0);
    if (p && p <= now) { setMeta('paused', 0); dirty.global = true; }
    if (expired.length || dirty.ann || dirty.events || dirty.ord || dirty.global) scheduleFlush(0);
  } catch (e) { if (!isBusy(e)) console.error('ménage', e.message); }
}
setInterval(sweep, 30_000).unref();

module.exports = { sweep };
