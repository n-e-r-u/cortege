'use strict';
// Base de données : SQLite intégré à Node, en mode WAL, et toutes les tables (créées ou complétées au démarrage).
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { sleep } = require('./util');

// ---- Base de données : SQLite intégré à Node (22.13 ou plus), en mode WAL ----
// Chaque action n'écrit que sa propre ligne, et plusieurs processus Passenger écrivent sans se bloquer.
{
  const emit = process.emitWarning;
  process.emitWarning = function (w, ...rest) { if (/sqlite/i.test(String((w && w.message) || w))) return; return emit.call(process, w, ...rest); };
}
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch { console.error('Cortège a besoin de Node 22.13 ou plus récent (module node:sqlite) : choisis Node 24 dans cPanel.'); process.exit(1); }
const DB_FILE = path.join(DATA_DIR, 'cortege.db');
const db = new DatabaseSync(DB_FILE);
// Plusieurs processus démarrent parfois en même temps : on attend que la base soit libre (8 s max par opération).
db.exec('PRAGMA busy_timeout=8000');
for (let i = 0; ; i++) {
  try { db.exec('PRAGMA journal_mode=WAL'); break; }
  catch (e) { if (i > 50 || !/locked|busy/i.test(e.message)) throw e; sleep(100); }
}
db.exec(`PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, cat TEXT NOT NULL, lat REAL, lng REAL, cell TEXT, note TEXT, t INTEGER, exp INTEGER,
    up INTEGER DEFAULT 0, down INTEGER DEFAULT 0, ver TEXT, voters TEXT DEFAULT '[]', down_ips TEXT DEFAULT '[]');
  CREATE INDEX IF NOT EXISTS reports_cell ON reports(cell);
  CREATE INDEX IF NOT EXISTS reports_exp ON reports(exp);
  CREATE TABLE IF NOT EXISTS ann(id TEXT PRIMARY KEY, exp INTEGER, data TEXT);
  CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, status TEXT, src TEXT, start INTEGER, dev TEXT, data TEXT);
  CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, status TEXT, end INTEGER, dev TEXT, data TEXT);
  CREATE TABLE IF NOT EXISTS rate(k TEXT PRIMARY KEY, t INTEGER, reports INTEGER DEFAULT 0, votes INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS hidden(id TEXT PRIMARY KEY, until INTEGER);
  CREATE TABLE IF NOT EXISTS cells(cell TEXT PRIMARY KEY, region TEXT, h TEXT);
  CREATE INDEX IF NOT EXISTS cells_region ON cells(region);
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);`);
for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) try { fs.chmodSync(f, 0o600); } catch {}
const stmts = new Map();
const q = sql => { let st = stmts.get(sql); if (!st) stmts.set(sql, (st = db.prepare(sql))); return st; };
const isBusy = e => e && (e.message === 'busy' || /locked|busy/i.test(e.message || ''));
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
const getMeta = k => q('SELECT v FROM meta WHERE k=?').get(k)?.v;
const setMeta = (k, v) => q('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

// ---- Tables et colonnes ajoutées au fil des versions (sans effet si elles existent déjà) ----
// Signalements
// Empreinte du réseau de l'auteur (même HMAC tournant que l'anti-spam), effacée avec le signalement.
try { db.exec('ALTER TABLE reports ADD COLUMN ip TEXT'); } catch {}
// Heure de la dernière confirmation ou du dernier signalement fusionné
try { db.exec('ALTER TABLE reports ADD COLUMN last INTEGER'); } catch {}
// Précisions écrites (les 3 plus récentes, une par téléphone) : [{ x: texte, t: heure, d: empreinte du téléphone }]
try { db.exec("ALTER TABLE reports ADD COLUMN notes TEXT DEFAULT '[]'"); } catch {}
// « Plus là » pondérés (dw) et heure à laquelle le point est devenu contesté (ct)
try { db.exec('ALTER TABLE reports ADD COLUMN dw INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE reports ADD COLUMN ct INTEGER DEFAULT 0'); } catch {}
// Orga qui a créé le point (pour qu'elle puisse le prolonger ou le corriger), jamais publié
try { db.exec('ALTER TABLE reports ADD COLUMN oid TEXT'); } catch {}
// Trace (tête et queue de cortège) : positions des 30 dernières minutes [[lat, lng, heure]] ;
// bk : heure de début du partage de position en direct d'une orga (0 sinon)
try { db.exec('ALTER TABLE reports ADD COLUMN trail TEXT'); } catch {}
try { db.exec('ALTER TABLE reports ADD COLUMN bk INTEGER DEFAULT 0'); } catch {}
// Point de départ du partage de position en direct (jamais publié) : le partage s'arrête si l'orga s'en éloigne de plus de 2 km
try { db.exec('ALTER TABLE reports ADD COLUMN bkla REAL'); } catch {}
try { db.exec('ALTER TABLE reports ADD COLUMN bklo REAL'); } catch {}
// Depuis quand le serveur voit chaque téléphone (empreinte seulement), oublié 26 h après sa dernière action (l’empreinte change de toute façon chaque jour).
// Sert à ne pas compter les « Plus là » d'un identifiant tout juste créé.
db.exec('CREATE TABLE IF NOT EXISTS devices(h TEXT PRIMARY KEY, first INTEGER, seen INTEGER)');
// Fiabilité du jour : signalements confirmés par d'autres (good) ou contestés (bad). Repart de zéro chaque jour (empreinte quotidienne).
try { db.exec('ALTER TABLE devices ADD COLUMN good INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE devices ADD COLUMN bad INTEGER DEFAULT 0'); } catch {}
// Fiabilité du signalement à sa création : 1 = téléphone fiable, -1 = non fiable (série suspecte, mode renforcé)
try { db.exec('ALTER TABLE reports ADD COLUMN fl INTEGER DEFAULT 0'); } catch {}
// Tableau des abus : 48 h, position arrondie à ~1 km ; les empreintes (dev, net) sont effacées au bout d'une heure
db.exec(`CREATE TABLE IF NOT EXISTS abuse(id INTEGER PRIMARY KEY, t INTEGER, kind TEXT, lat REAL, lng REAL, dev TEXT, net TEXT, ref TEXT);
  CREATE INDEX IF NOT EXISTS abuse_t ON abuse(t);
  CREATE INDEX IF NOT EXISTS abuse_kind_dev ON abuse(kind, dev, t);`);
db.exec('CREATE INDEX IF NOT EXISTS reports_cell_ip ON reports(cell, ip)');
db.exec('CREATE INDEX IF NOT EXISTS reports_cat_lat ON reports(cat, lat)');
// Journal : heure, orga, action, type de signalement, position arrondie à ~100 m. Jamais d'IP.
db.exec(`CREATE TABLE IF NOT EXISTS orga_log(id INTEGER PRIMARY KEY, t INTEGER, oid TEXT, orga TEXT, action TEXT, cat TEXT, lat REAL, lng REAL, ref TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS orga_log_t ON orga_log(t);
  CREATE INDEX IF NOT EXISTS orga_log_oid ON orga_log(oid, t);
  CREATE TABLE IF NOT EXISTS trash(id TEXT PRIMARY KEY, t INTEGER, oid TEXT, orga TEXT, data TEXT);`);
// Quotas sur une période plus longue (une heure, un jour…) : notifications urgentes par orga, abonnements par réseau…
db.exec('CREATE TABLE IF NOT EXISTS quota(k TEXT PRIMARY KEY, t INTEGER, n INTEGER)');
// Rempli par l'admin (à partir d'une liste de départ non validée). Seules les lignes validées sont publiées
// (live/legal.json). Une veille quotidienne relit la page source de chaque ligne et prévient l'admin si le
// numéro n'y figure plus ou si d'autres numéros apparaissent. Elle ne publie et ne modifie jamais rien.
db.exec('CREATE TABLE IF NOT EXISTS legal_dir(id TEXT PRIMARY KEY, data TEXT)');
// Gardé : nom du collectif, ville, rôle, lien public, canal officiel du collectif, garant éventuel, message.
// Supprimé dès que l'admin a traité la demande, et au plus tard au bout de 30 jours. Ni IP ni identifiant du téléphone.
db.exec('CREATE TABLE IF NOT EXISTS orga_req(id TEXT PRIMARY KEY, t INTEGER, data TEXT)');
// Gardés dans la base (simplifiés à ~50 m) : un point est rattaché à la commune qui le contient, sans aucun service extérieur.
db.exec('CREATE TABLE IF NOT EXISTS communes(id TEXT PRIMARY KEY, insee TEXT, name TEXT, minlat REAL, minlng REAL, maxlat REAL, maxlng REAL, data TEXT, seen INTEGER)');
// Publiées à la main par l'admin. On fige alors un résumé agrégé (la page n'affiche que le centre de chaque ville et des totaux),
// plus les points arrondis à ~11 m pour la carte d’un créneau, gardés même quand l'archive détaillée est effacée.
db.exec('CREATE TABLE IF NOT EXISTS pub(date TEXT PRIMARY KEY, t INTEGER, data TEXT)');
// Abonnements dans la base (avant : un fichier réécrit en entier à chaque abonnement, de plus en plus lent)
db.exec('CREATE TABLE IF NOT EXISTS push(id TEXT PRIMARY KEY, e TEXT NOT NULL, k TEXT, a TEXT, lat REAL, lng REAL, t INTEGER)');
// urg : annonces urgentes ; near : dangers signalés dans la zone ; last : dernier envoi « danger » (anti-avalanche)
try { db.exec('ALTER TABLE push ADD COLUMN urg INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE push ADD COLUMN near INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE push ADD COLUMN last INTEGER'); } catch {}
// lang : langue de l'appli sur ce téléphone (textes des notifications) ; ord : nouveaux arrêtés dans la zone
try { db.exec("ALTER TABLE push ADD COLUMN lang TEXT DEFAULT 'fr'"); } catch {}
try { db.exec('ALTER TABLE push ADD COLUMN ord INTEGER DEFAULT 1'); } catch {}
// fails : refus d'envoi consécutifs du service de notification (abonnement supprimé au 5e)
try { db.exec('ALTER TABLE push ADD COLUMN fails INTEGER DEFAULT 0'); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS pois(id TEXT PRIMARY KEY, kind TEXT, lat REAL, lng REAL, rg TEXT, data TEXT, src TEXT, hid INTEGER DEFAULT 0, ed INTEGER DEFAULT 0, seen INTEGER);
  CREATE INDEX IF NOT EXISTS pois_rg ON pois(rg);`);

module.exports = { DatabaseSync, db, q, tx, isBusy, getMeta, setMeta, DB_FILE };
