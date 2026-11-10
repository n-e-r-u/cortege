'use strict';
// ---- Veille des arrêtés : pages de préfecture et flux surveillés ----
// L'admin indique des pages à surveiller (accueil ou actualités d'une préfecture, page du recueil des actes administratifs,
// flux RSS ou Atom). Toutes les 20 minutes, le serveur relit chaque page et repère les liens apparus depuis la dernière fois.
// Ceux dont le titre ou l'adresse parle de manifestation, d'interdiction, de périmètre, de couvre-feu, de drones… sont proposés
// dans Admin › Arrêtés › Veille, avec le lien. Rien n'est publié tout seul : l'admin ouvre le texte et prépare l'arrêté.
// Première lecture d'une page : tout ce qui s'y trouve déjà est noté comme vu, sans alerte.
// Les préfectures publient parfois leurs arrêtés tard, ou seulement sur leurs réseaux : cette veille aide, elle ne remplace pas la recherche.
const crypto = require('crypto');
const { db, q } = require('./db');
const { MIN } = require('./config');

db.exec(`CREATE TABLE IF NOT EXISTS veille_src(id TEXT PRIMARY KEY, dep TEXT, url TEXT UNIQUE, label TEXT, t INTEGER, last INTEGER, ok INTEGER, err TEXT, n INTEGER, etag TEXT, lastmod TEXT, seen TEXT);
  CREATE TABLE IF NOT EXISTS veille_hit(id TEXT PRIMARY KEY, src TEXT, dep TEXT, t INTEGER, title TEXT, url TEXT, kw TEXT, status TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS veille_hit_u ON veille_hit(src, url);`);

const EVERY = +(process.env.VEILLE_EVERY_MS || 20 * MIN);
const SEEN_MAX = 3000;
// Mots qui signalent un arrêté utile aux manifestant·es (accents et majuscules ignorés)
const KEYWORDS = [
  ['manifestation', /manifestation|manifester|cortege|defile/], ['rassemblement', /rassemblement|attroupement/],
  ['interdiction', /interdi(t|ction|sant)/], ['périmètre', /perimetre|zone de protection|zone protegee/],
  ['couvre-feu', /couvre[- ]?feu/], ['drones', /drone|aeronef|captation|camera(s)? aeroportee/],
  ['objets interdits', /artifice|objets? pouvant constituer une arme|port et (le )?transport|carburant|acide/],
  ['mesures de police', /mesures? de police|ordre public|maintien de l.ordre/],
  ['circulation', /circulation et (le )?stationnement|restriction(s)? de circulation/],
];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
// Mots-clés trouvés. Un thème fort (manifestation, périmètre, couvre-feu, drones…) suffit ; les thèmes larges
// (interdiction, mesures de police, circulation) seulement à deux, sinon chaque « interdiction de pêche » sortirait.
const WEAK = new Set(['interdiction', 'mesures de police', 'circulation']);
function keywords(title, url) {
  let u = String(url); try { u = decodeURIComponent(u); } catch {}
  const s = norm(title + ' ' + u.replace(/[-_/.]+/g, ' '));
  const kw = KEYWORDS.filter(([, re]) => re.test(s)).map(([k]) => k);
  return kw.some(k => !WEAK.has(k)) || kw.length >= 2 ? kw : [];
}
const h12 = s => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 12);
const decode = s => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;|&rsquo;/g, '’').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, ' ').trim();
// Liens d'une page : flux RSS/Atom (titre + lien de chaque article) ou page HTML (texte + adresse de chaque lien)
function extractLinks(body, base) {
  const out = [], abs = u => { try { const x = new URL(decode(u).trim(), base); x.hash = ''; return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  if (/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000))) {
    for (const m of body.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
      const it = m[0], title = decode((it.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
      const link = (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || (it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || (it.match(/<guid[^>]*>(https?:[^<]+)<\/guid>/i) || [])[1];
      const desc = decode((it.match(/<(description|summary)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || '').slice(0, 300);
      const u = link && abs(link); if (u && title) out.push({ title: title.slice(0, 300), url: u, more: desc });
    }
    return out;
  }
  const html = body.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = abs(m[2] ?? m[3] ?? ''); if (!u) continue;
    const title = decode(m[4]) || decode((m[0].match(/title\s*=\s*"([^"]+)"/i) || [])[1] || '');
    if (title.length < 4) continue;
    out.push({ title: title.slice(0, 300), url: u });
  }
  return out;
}
async function fetchPage(s) {
  const headers = { 'User-Agent': 'Cortege-veille (carte des manifestations ; relit cette page toutes les 20 minutes)', Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,*/*;q=0.5' };
  if (s.etag) headers['If-None-Match'] = s.etag;
  if (s.lastmod) headers['If-Modified-Since'] = s.lastmod;
  const r = await fetch(s.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
  if (r.status === 304) return { same: true };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const len = +(r.headers.get('content-length') || 0); if (len > 5e6) throw new Error('page trop lourde');
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 5e6) throw new Error('page trop lourde');
  let text = buf.toString('utf8');
  if (/charset=(iso-8859-1|latin1|windows-1252)/i.test(r.headers.get('content-type') || '') || /<meta[^>]+charset=["']?(iso-8859-1|windows-1252)/i.test(text.slice(0, 3000))) text = buf.toString('latin1');
  return { text, etag: r.headers.get('etag') || '', lastmod: r.headers.get('last-modified') || '', final: r.url || s.url };
}
const srcRow = id => q('SELECT * FROM veille_src WHERE id=?').get(id);
// Relit une source ; renvoie le nombre de nouveaux liens intéressants
async function checkSource(s, now = Date.now()) {
  let res;
  try { res = await fetchPage(s); }
  catch (e) { q('UPDATE veille_src SET last=?, ok=0, err=? WHERE id=?').run(now, String(e.message || e).slice(0, 160), s.id); return { error: e.message }; }
  if (res.same) { q('UPDATE veille_src SET last=?, ok=1, err=NULL WHERE id=?').run(now, s.id); return { hits: 0, same: true }; }
  const links = extractLinks(res.text, res.final);
  let seen = []; try { seen = JSON.parse(s.seen || '[]'); } catch {}
  const first = !s.seen, known = new Set(seen), fresh = [];
  for (const l of links) { const k = h12(l.url); if (known.has(k)) continue; known.add(k); seen.push(k); fresh.push(l); }
  let hits = 0;
  if (!first) for (const l of fresh) {
    const kw = keywords(l.title + ' ' + (l.more || ''), l.url);
    if (!kw.length) continue;
    const r = q('INSERT OR IGNORE INTO veille_hit(id,src,dep,t,title,url,kw,status) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomBytes(6).toString('base64url'), s.id, s.dep, now, l.title, l.url, kw.join(', '), 'new');
    hits += r.changes;
  }
  q('UPDATE veille_src SET last=?, ok=1, err=NULL, n=?, etag=?, lastmod=?, seen=? WHERE id=?')
    .run(now, links.length, res.etag, res.lastmod, JSON.stringify(seen.slice(-SEEN_MAX)), s.id);
  return { hits, links: links.length, first };
}
// Tour de veille : les sources dues, une à la fois, étalées (pas de rafale vers les sites des préfectures)
let running = false;
async function veilleTick() {
  if (running) return; running = true;
  try {
    const now = Date.now();
    for (const s of q('SELECT * FROM veille_src WHERE last IS NULL OR last<? ORDER BY last LIMIT 30').all(now - EVERY)) {
      await checkSource(s);
      await new Promise(r => setTimeout(r, +(process.env.VEILLE_GAP_MS || 3000)));
    }
    q("DELETE FROM veille_hit WHERE status!='new' AND t<?").run(now - 30 * 24 * 60 * MIN);
  } catch (e) { console.error('veille', e.message); }
  finally { running = false; }
}
if (process.env.VEILLE !== '0') setInterval(veilleTick, +(process.env.VEILLE_TICK_MS || 60_000)).unref();

// ---- Admin ----
const srcView = s => ({ id: s.id, dep: s.dep, url: s.url, label: s.label || '', last: s.last, ok: !!s.ok, err: s.err || '', n: s.n || 0 });
function veilleAdmin() {
  return { sources: q('SELECT * FROM veille_src ORDER BY dep, url').all().map(srcView),
    hits: q("SELECT * FROM veille_hit WHERE status='new' ORDER BY t DESC LIMIT 200").all(),
    done: q("SELECT * FROM veille_hit WHERE status!='new' ORDER BY t DESC LIMIT 30").all(), every: EVERY };
}
async function veilleAdd(b) {
  const url = String(b.url || '').trim(), dep = String(b.dep || '').trim().toUpperCase();
  if (!/^https?:\/\/[^\s"<>]{4,400}$/.test(url)) return [400, { error: 'Adresse invalide (elle doit commencer par https://).' }];
  if (dep && !/^(\d{2}|97\d|2A|2B)$/.test(dep)) return [400, { error: 'Département invalide.' }];
  if (q('SELECT 1 FROM veille_src WHERE url=?').get(url)) return [409, { error: 'Cette page est déjà surveillée.' }];
  if (q('SELECT COUNT(*) n FROM veille_src').get().n >= 400) return [400, { error: '400 pages surveillées au plus.' }];
  const s = { id: crypto.randomBytes(6).toString('base64url'), dep, url, label: String(b.label || '').trim().slice(0, 60), t: Date.now() };
  q('INSERT INTO veille_src(id,dep,url,label,t) VALUES(?,?,?,?,?)').run(s.id, s.dep, s.url, s.label, s.t);
  // Première lecture tout de suite : l'admin voit si la page répond et combien de liens elle contient
  const r = await checkSource(srcRow(s.id));
  return [201, { ...srcView(srcRow(s.id)), ...(r.error ? { error: r.error } : {}) }];
}
async function veilleTest(id) {
  const s = srcRow(id); if (!s) return [404, { error: 'Source introuvable.' }];
  const r = await checkSource(s);
  return [200, { ...srcView(srcRow(id)), hits: r.hits || 0, ...(r.error ? { error: r.error } : {}) }];
}
function veilleDel(id) { q('DELETE FROM veille_src WHERE id=?').run(id); q("DELETE FROM veille_hit WHERE src=? AND status='new'").run(id); return [200, { ok: true }]; }
function veilleHit(id, status) {
  if (!['done', 'skip', 'new'].includes(status)) return [400, { error: 'État invalide.' }];
  const r = q('UPDATE veille_hit SET status=? WHERE id=?').run(status, id);
  return r.changes ? [200, { ok: true }] : [404, { error: 'Introuvable.' }];
}
const veilleCount = () => q("SELECT COUNT(*) n FROM veille_hit WHERE status='new'").get().n;

module.exports = { extractLinks, keywords, checkSource, veilleTick, veilleAdmin, veilleAdd, veilleTest, veilleDel, veilleHit, veilleCount };
