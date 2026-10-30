'use strict';
const crypto = require('crypto');
const { MIN } = require('../config');
const { clean } = require('../util');
const { q } = require('../db');

// ---- Demandes d'accès orga (formulaire dans l'appli, au lieu d'un e-mail) ----
const OREQ_DAYS = 30;
function orgaRequest(b) {
  const f = { collective: clean(b.collective, 80), city: clean(b.city, 60), role: clean(b.role, 40), link: String(b.link || '').trim().slice(0, 300),
    since: clean(b.since, 40), contact: clean(b.contact, 120), sponsor: clean(b.sponsor, 120), note: clean(b.note, 600) };
  if (f.collective.length < 2) return [400, { error: 'Indique le nom du collectif.' }];
  if (f.city.length < 2) return [400, { error: 'Indique la ville ou le secteur.' }];
  if (!/^https:\/\/[^\s"<>]{4,300}$/.test(f.link)) return [400, { error: 'Donne le lien public du collectif (site, Instagram…), en https://' }];
  if (f.contact.length < 3) return [400, { error: 'Indique le canal officiel du collectif où te confirmer la demande.' }];
  const now = Date.now();
  q('DELETE FROM orga_req WHERE t<?').run(now - OREQ_DAYS * 24 * 60 * MIN);
  if (q('SELECT COUNT(*) n FROM orga_req').get().n >= 500) return [503, { error: 'Trop de demandes en attente, réessaie dans quelques jours.' }];
  const id = crypto.randomBytes(6).toString('base64url');
  q('INSERT INTO orga_req(id,t,data) VALUES(?,?,?)').run(id, now, JSON.stringify(f));
  return [201, { ok: true }];
}
const orgaRequests = () => { q('DELETE FROM orga_req WHERE t<?').run(Date.now() - OREQ_DAYS * 24 * 60 * MIN);
  return q('SELECT id, t, data FROM orga_req ORDER BY t').all().map(x => ({ id: x.id, t: x.t, ...JSON.parse(x.data) })); };

module.exports = { orgaRequest, orgaRequests };
