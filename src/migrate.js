'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { EVENT_KEEP, saveEvent } = require('./events/store');
const { getMeta, tx, q, setMeta } = require('./db');
const { saveReport } = require('./reports/store');

// Reprise des données de l'ancienne version (fichier state.json), une seule fois.
function migrateJson() {
  const f = path.join(DATA_DIR, 'state.json');
  if (!fs.existsSync(f) || getMeta('migrated')) return;
  let s; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  const now = Date.now();
  const done = tx(() => {
    if (getMeta('migrated')) return false;
    for (const r of Object.values(s.reports || {})) if (r.exp > now) saveReport(r);
    for (const a of Object.values(s.ann || {})) if (a.exp > now) q('INSERT OR REPLACE INTO ann(id,exp,data) VALUES(?,?,?)').run(a.id, a.exp, JSON.stringify(a));
    for (const e of Object.values(s.events || {})) if (e.start + EVENT_KEEP > now) saveEvent(e);
    for (const [id, t] of Object.entries(s.importHidden || {})) q('INSERT OR REPLACE INTO hidden(id,until) VALUES(?,?)').run(id, t + EVENT_KEEP);
    if (s.paused > now) setMeta('paused', s.paused);
    setMeta('migrated', now);
    return true;
  });
  if (done) { try { fs.renameSync(f, f + '.repris-' + now); } catch {} console.log('Données reprises de state.json'); }
}

module.exports = { migrateJson };
