'use strict';
// Photos jointes aux signalements (2.21). Chaque photo passe par le Flouteur sur le téléphone (visages masqués, nouvelle image
// sans métadonnées) avant d'être envoyée ; le serveur retire encore toute métadonnée qui resterait.
//  - Visible du public seulement quand le point est vérifié par une orga ou vient d'un téléphone fiable, et tant qu'il est actif.
//    Avant : seulement les orgas et l'admin. « Signaler la photo » par 2 téléphones la cache jusqu'à ce qu'une orga la remette.
//  - Effacée du serveur 3 jours après l'envoi (PHOTO_KEEP_DAYS), sauf si l'admin la garde pour le bilan public du jour :
//    elle passe alors dans bilan-photos/ (sauvegardé) et reste publique sur la page du bilan.
//  - Gardé avec la photo : le point, son type, l'heure, la position arrondie à ~100 m et le jour. Jamais l'identifiant du
//    téléphone qui l'a envoyée (seulement, le temps de la photo, les empreintes de ceux qui l'ont signalée).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, MIN } = require('./config');
const { db, q } = require('./db');
const { parisDay } = require('./time');
const { removeJpegMetadata } = require('../public/flouter-lib.js');

const TMP_DIR = path.join(DATA_DIR, 'photos'), KEEP_DIR = path.join(DATA_DIR, 'bilan-photos');
for (const d of [TMP_DIR, KEEP_DIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
db.exec(`CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, rid TEXT, cat TEXT, lat REAL, lng REAL, t INTEGER, day TEXT, st TEXT,
  flags TEXT, w INTEGER, h INTEGER, sz INTEGER);
  CREATE INDEX IF NOT EXISTS photos_rid ON photos(rid); CREATE INDEX IF NOT EXISTS photos_day ON photos(day);`);

const KEEP_MS = (Number(process.env.PHOTO_KEEP_DAYS) || 3) * 24 * 60 * MIN;
const MAX_BYTES = 900 * 1024, MAX_SIDE = 2560, PER_REPORT = 3, PER_DEV_HOUR = 6, TMP_MAX = Number(process.env.PHOTO_MAX) || 3000, FLAGS_HIDE = 2;
const ID_RE = /^[\w-]{12}$/;
const fileOf = p => path.join(p.st === 'kept' ? KEEP_DIR : TMP_DIR, p.id + '.jpg');
const isPublicReport = r => !!r && (!!r.ver || r.fl === 1);
const getPhoto = id => ID_RE.test(String(id)) ? q('SELECT * FROM photos WHERE id=?').get(String(id)) : null;

// Largeur et hauteur d'un JPEG (premier marqueur SOFn) ; null si illisible
function jpegSize(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;
    const len = (b[o + 2] << 8) | b[o + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8] };
    o += 2 + len;
  }
  return null;
}

// Photos d'un point, pour la vue publique : { id, p } (p = visible du public), f = signalée (cachée au public)
function phView(r) {
  const rows = q("SELECT id, st FROM photos WHERE rid=? AND st IN ('ok','flag','kept') ORDER BY t").all(r.id);
  if (!rows.length) return {};
  const pub = isPublicReport(r);
  return { ph: rows.map(x => ({ id: x.id, ...(pub && x.st !== 'flag' ? { p: 1 } : {}), ...(x.st === 'flag' ? { f: 1 } : {}) })) };
}

// Nouvelle photo pour un point actif. buf : le JPEG reçu. [statut, corps]
function addPhoto(r, buf, { dev, quota }, now = Date.now()) {
  if (!r) return [404, { error: 'Signalement expiré.' }];
  if (!buf || buf.length > MAX_BYTES) return [413, { error: 'Photo trop lourde : passe-la par le flouteur de Cortège.' }];
  if (buf.length < 100) return [400, { error: 'Ce n’est pas une photo JPEG.' }];
  let clean;
  try { clean = Buffer.from(removeJpegMetadata(new Uint8Array(buf))); } catch { return [400, { error: 'Ce n’est pas une photo JPEG.' }]; }
  const size = jpegSize(clean);
  if (!size || !size.w || !size.h || size.w > MAX_SIDE || size.h > MAX_SIDE) return [400, { error: 'Photo illisible ou trop grande.' }];
  if (q("SELECT COUNT(*) n FROM photos WHERE rid=? AND st<>'gone'").get(r.id).n >= PER_REPORT) return [429, { error: 'Ce point a déjà 3 photos.' }];
  if (q("SELECT COUNT(*) n FROM photos WHERE st IN ('ok','flag')").get().n >= TMP_MAX) return [503, { error: 'Trop de photos en ce moment, réessaie plus tard.' }];
  if (!quota('photo:' + dev, PER_DEV_HOUR, 60 * MIN, now)) return [429, { error: 'Trop de photos envoyées depuis ce téléphone, patiente un peu.' }];
  const id = crypto.randomBytes(9).toString('base64url');
  const p = { id, st: 'ok' };
  fs.writeFileSync(fileOf(p), clean, { mode: 0o600 });
  q('INSERT INTO photos(id,rid,cat,lat,lng,t,day,st,flags,w,h,sz) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, r.id, r.cat, Math.round(r.lat * 1e3) / 1e3, Math.round(r.lng * 1e3) / 1e3, now, parisDay(now), 'ok', '[]', size.w, size.h, clean.length);
  return [201, { id, p: isPublicReport(r) ? 1 : 0 }];
}

// Qui peut voir la photo : 'public', 'staff' (orgas et admin seulement), ou null (plus là)
function photoAccess(p, r) {
  if (!p || p.st === 'gone') return null;
  if (p.st === 'kept') return 'public';
  return r && isPublicReport(r) && p.st === 'ok' ? 'public' : 'staff';
}
const photoFile = p => { try { return fs.readFileSync(fileOf(p)); } catch { return null; } };

// « Signaler la photo » : une fois par téléphone ; à partir de 2, cachée au public jusqu'à ce qu'une orga la remette
function flagPhoto(p, devH) {
  if (!p || p.st === 'gone') return [404, { error: 'Photo introuvable.' }];
  if (p.st === 'kept') return [200, { ok: true }];
  let flags = []; try { flags = JSON.parse(p.flags || '[]'); } catch {}
  if (!flags.includes(devH)) flags.push(devH);
  const st = p.st === 'ok' && flags.length >= FLAGS_HIDE ? 'flag' : p.st;
  q('UPDATE photos SET flags=?, st=? WHERE id=?').run(JSON.stringify(flags.slice(-20)), st, p.id);
  return [200, { ok: true, hidden: st === 'flag' }];
}
function removePhoto(p) {
  if (!p || p.st === 'gone') return false;
  try { fs.unlinkSync(fileOf(p)); } catch {}
  q("UPDATE photos SET st='gone', flags='[]' WHERE id=?").run(p.id);
  return true;
}
const restorePhoto = p => !!p && p.st === 'flag' && q("UPDATE photos SET st='ok', flags='[]' WHERE id=?").run(p.id).changes > 0;
// Gardée pour le bilan public (permanente) ou rendue au délai normal
function keepPhoto(p, keep) {
  if (!p || p.st === 'gone') return false;
  if (keep === (p.st === 'kept')) return true;
  const from = fileOf(p), to = fileOf({ ...p, st: keep ? 'kept' : 'ok' });
  try { fs.renameSync(from, to); } catch { return false; }
  q("UPDATE photos SET st=?, flags='[]' WHERE id=?").run(keep ? 'kept' : 'ok', p.id);
  return true;
}
// Photos d'un jour pour le digest de l'admin (toutes sauf retirées), et celles gardées pour le bilan public
const dayPhotos = day => q("SELECT id, rid, cat, lat, lng, t, st, w, h FROM photos WHERE day=? AND st<>'gone' ORDER BY t").all(day);
const keptPhotos = day => q("SELECT id, cat, lat, lng, t, w, h FROM photos WHERE day=? AND st='kept' ORDER BY t").all(day);
// Point retiré par son auteur (posé par erreur) : ses photos partent avec lui
function dropFor(rid) { for (const p of q("SELECT * FROM photos WHERE rid=? AND st IN ('ok','flag')").all(rid)) removePhoto(p); }

// Ménage : photos de plus de 3 jours (sauf gardées pour un bilan), lignes retirées, fichiers orphelins
function prunePhotos(now = Date.now()) {
  for (const p of q("SELECT * FROM photos WHERE st IN ('ok','flag') AND t<?").all(now - KEEP_MS)) removePhoto(p);
  q("DELETE FROM photos WHERE st='gone' AND t<?").run(now - KEEP_MS);
  const known = new Set(q('SELECT id FROM photos').all().map(x => x.id + '.jpg'));
  for (const d of [TMP_DIR, KEEP_DIR]) try { for (const f of fs.readdirSync(d)) if (!known.has(f)) try { fs.unlinkSync(path.join(d, f)); } catch {} } catch {}
}
// Effacement d'urgence : toutes les photos du délai de 3 jours ; celles des bilans seulement si les bilans partent aussi
function wipePhotos(withKept) {
  for (const p of q(`SELECT * FROM photos${withKept ? '' : " WHERE st<>'kept'"}`).all()) { try { fs.unlinkSync(fileOf(p)); } catch {} }
  q(`DELETE FROM photos${withKept ? '' : " WHERE st<>'kept'"}`).run();
  prunePhotos();
}
if (process.env.PHOTO_PRUNE !== '0') { try { prunePhotos(); } catch (e) { console.error('photos', e.message); } setInterval(() => { try { prunePhotos(); } catch (e) { console.error('photos', e.message); } }, 10 * MIN).unref(); }

module.exports = { phView, addPhoto, getPhoto, photoAccess, photoFile, flagPhoto, removePhoto, restorePhoto, keepPhoto, dayPhotos, keptPhotos, dropFor,
  prunePhotos, wipePhotos, jpegSize, KEEP_MS, MAX_BYTES, ID_RE };
