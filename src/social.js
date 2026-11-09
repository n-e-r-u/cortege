'use strict';
// ---- Partage automatique sur Bluesky et Mastodon ----
// Le serveur publie lui-même, sur les comptes de l'instance, quelques messages utiles : la veille et le matin d'une journée
// de mobilisation, les nouveaux arrêtés (regroupés), le bilan public d'une journée, et les messages écrits dans l'admin.
// Identifiants dans les variables d'environnement seulement (jamais dans la base ni dans l'admin) :
//   BLUESKY_HANDLE + BLUESKY_APP_PASSWORD (mot de passe d'application, pas celui du compte), BLUESKY_PDS (https://bsky.social par défaut)
//   MASTODON_URL (adresse de l'instance) + MASTODON_TOKEN (jeton d'une application, droit write:statuses)
// Réglages dans l'admin : envoi direct ou relecture avant envoi, types de messages, réseaux actifs, mots-clés.
// Chaque message a une clé unique (bilan d'une date, veille d'une journée…) : jamais publié deux fois.
// Aucune donnée de personne n'est envoyée : seulement des totaux, des noms de villes et des liens publics.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, q, getMeta, setMeta } = require('./db');
const { MIN, PUBLIC_URL } = require('./config');
const { tr, defaultLang, LOCALE } = require('./i18n');
const { parisDay, parisHour, parisMs } = require('./time');

db.exec('CREATE TABLE IF NOT EXISTS social(id TEXT PRIMARY KEY, t INTEGER, key TEXT UNIQUE, status TEXT, at INTEGER, data TEXT)');

const ENV = () => ({
  bsky: { handle: (process.env.BLUESKY_HANDLE || '').replace(/^@/, '').trim(), pass: process.env.BLUESKY_APP_PASSWORD || '',
    pds: (process.env.BLUESKY_PDS || 'https://bsky.social').replace(/\/+$/, '') },
  masto: { url: (process.env.MASTODON_URL || '').replace(/\/+$/, ''), token: process.env.MASTODON_TOKEN || '' },
});
const NETS = {
  bsky: { name: 'Bluesky', max: 300, ready: e => !!(e.bsky.handle && e.bsky.pass) },
  masto: { name: 'Mastodon', max: 500, ready: e => !!(e.masto.url && e.masto.token) },
};
const KINDS = ['eve', 'day', 'ord', 'pub', 'idea', 'news', 'man'];
const MAX_TRIES = 5;
const base = () => (process.env.PUBLIC_URL || PUBLIC_URL).replace(/\/+$/, '');

// ---- Réglages (admin) ----
function socialCfg() {
  let c = {}; try { c = JSON.parse(getMeta('social') || '{}'); } catch {}
  return { mode: c.mode === 'review' ? 'review' : 'auto', kinds: Object.fromEntries(KINDS.map(k => [k, c.kinds?.[k] !== false])),
    off: { bsky: !!c.off?.bsky, masto: !!c.off?.masto }, tags: typeof c.tags === 'string' ? c.tags : '' };
}
function saveSocialCfg(b) {
  const cur = socialCfg();
  const tags = String(b.tags ?? cur.tags).replace(/[\u0000-\u001f]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => '#' + w.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(w => w.length > 1).slice(0, 5).join(' ');
  const c = { mode: b.mode === 'review' ? 'review' : b.mode === 'auto' ? 'auto' : cur.mode,
    kinds: Object.fromEntries(KINDS.map(k => [k, b.kinds && k in b.kinds ? b.kinds[k] !== false : cur.kinds[k]])),
    off: { bsky: b.off && 'bsky' in b.off ? !!b.off.bsky : cur.off.bsky, masto: b.off && 'masto' in b.off ? !!b.off.masto : cur.off.masto }, tags };
  setMeta('social', JSON.stringify(c));
  return c;
}
// Réseaux qui recevront un message : identifiants présents et pas coupés dans l'admin
const liveNets = () => { const e = ENV(), c = socialCfg(); return Object.keys(NETS).filter(n => NETS[n].ready(e) && !c.off[n]); };

// ---- Texte : coupé pour tenir dans la limite du réseau (graphèmes pour Bluesky), lien et mots-clés gardés ----
const seg = new Intl.Segmenter('fr', { granularity: 'grapheme' });
const glen = s => [...seg.segment(s)].length;
function fit(text, link, tags, max) {
  const tail = (link ? '\n\n' + link : '') + (tags ? '\n' + tags : '');
  let body = String(text).trim();
  if (glen(body) + glen(tail) > max) {
    const parts = [...seg.segment(body)].map(x => x.segment);
    body = parts.slice(0, Math.max(0, max - glen(tail) - 1)).join('').trimEnd() + '…';
  }
  return body + tail;
}
// Liens et mots-clés de Bluesky : positions en octets UTF-8
function facets(text) {
  const out = [], at = i => Buffer.byteLength(text.slice(0, i));
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) out.push({ index: { byteStart: at(m.index), byteEnd: at(m.index + m[0].length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const s = m.index + m[1].length;
    out.push({ index: { byteStart: at(s), byteEnd: at(s + 1 + m[2].length) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return out;
}

// ---- Appels aux réseaux ----
async function call(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'Cortege (+' + base() + ')', ...(opts.headers || {}) } });
  const txt = await r.text(); let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch {}
  if (!r.ok) throw Object.assign(new Error((j.error_description || j.message || j.error || 'HTTP ' + r.status).toString().slice(0, 200)), { status: r.status, code: j.error });
  return j;
}
const json = (method, body, h = {}) => ({ method, headers: { 'Content-Type': 'application/json', ...h }, body: body && JSON.stringify(body) });
// Bluesky : session gardée 30 min, refaite si le jeton a expiré
let sess = null;
async function bskySession(force) {
  const e = ENV().bsky;
  if (!force && sess && sess.t > Date.now() - 30 * MIN && sess.handle === e.handle) return sess;
  const j = await call(e.pds + '/xrpc/com.atproto.server.createSession', json('POST', { identifier: e.handle, password: e.pass }));
  sess = { t: Date.now(), handle: e.handle, did: j.did, jwt: j.accessJwt, shown: j.handle || e.handle };
  return sess;
}
async function bsky(path_, body, raw) {
  const e = ENV().bsky;
  for (let i = 0; i < 2; i++) {
    const s = await bskySession(i > 0);
    try {
      if (raw) return await call(e.pds + '/xrpc/' + path_, { method: 'POST', headers: { 'Content-Type': raw, Authorization: 'Bearer ' + s.jwt }, body });
      return await call(e.pds + '/xrpc/' + path_, json('POST', typeof body === 'function' ? body(s) : body, { Authorization: 'Bearer ' + s.jwt }));
    } catch (err) { if (i === 0 && (err.status === 401 || err.code === 'ExpiredToken' || err.code === 'InvalidToken')) continue; throw err; }
  }
}
const OG = path.join(__dirname, '..', 'public', 'og.png');
async function sendBsky(p, text) {
  const lang = p.lang || defaultLang();
  let embed;
  if (p.link) {
    let thumb; try { thumb = (await bsky('com.atproto.repo.uploadBlob', fs.readFileSync(OG), 'image/png')).blob; } catch {}
    embed = { $type: 'app.bsky.embed.external', external: { uri: p.link, title: p.title || 'Cortège', description: p.desc || '', ...(thumb ? { thumb } : {}) } };
  }
  const j = await bsky('com.atproto.repo.createRecord', s => ({ repo: s.did, collection: 'app.bsky.feed.post',
    record: { $type: 'app.bsky.feed.post', text, facets: facets(text), createdAt: new Date().toISOString(), langs: [lang], ...(embed ? { embed } : {}) } }));
  const rkey = String(j.uri || '').split('/').pop();
  return { id: j.uri, url: `https://bsky.app/profile/${sess.shown}/post/${rkey}` };
}
async function sendMasto(p, text, key) {
  const e = ENV().masto;
  const j = await call(e.url + '/api/v1/statuses', json('POST', { status: text, visibility: 'public', language: p.lang || defaultLang() },
    { Authorization: 'Bearer ' + e.token, 'Idempotency-Key': key }));
  return { id: String(j.id), url: j.url || '' };
}
async function deleteRemote(net, id) {
  if (net === 'bsky') return bsky('com.atproto.repo.deleteRecord', s => ({ repo: s.did, collection: 'app.bsky.feed.post', rkey: String(id).split('/').pop() }));
  const e = ENV().masto;
  return call(e.url + '/api/v1/statuses/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + e.token } });
}
// Vérification des identifiants depuis l'admin, sans rien publier
async function socialTest() {
  const e = ENV(), out = {};
  if (NETS.bsky.ready(e)) { try { const s = await bskySession(true); out.bsky = { ok: true, who: '@' + s.shown }; } catch (err) { out.bsky = { ok: false, error: err.message }; } }
  if (NETS.masto.ready(e)) {
    try { const j = await call(e.masto.url + '/api/v1/accounts/verify_credentials', { headers: { Authorization: 'Bearer ' + e.masto.token } }); out.masto = { ok: true, who: '@' + j.acct, url: j.url }; }
    catch (err) { out.masto = { ok: false, error: err.message }; }
  }
  return out;
}

// ---- File de messages ----
const rowOf = r => ({ ...JSON.parse(r.data), id: r.id, t: r.t, key: r.key, status: r.status, at: r.at });
function save(p) {
  const { id, t, key, status, at, ...data } = p;
  q('INSERT OR REPLACE INTO social(id,t,key,status,at,data) VALUES(?,?,?,?,?,?)').run(id, t, key, status, at, JSON.stringify(data));
}
// Nouveau message : ignoré si ce type est coupé, si aucun réseau n'est prêt, ou si la clé a déjà servi
// short : version courte facultative, prise quand le texte complet ne tient pas (Bluesky)
function queuePost(kind, key, { text, short = '', link = '', title = '', desc = '' }, { force = false, review } = {}) {
  const c = socialCfg(), nets = liveNets();
  if (!nets.length || (!force && !c.kinds[kind])) return null;
  if (q('SELECT 1 FROM social WHERE key=?').get(key)) return null;
  const now = Date.now();
  const p = { id: crypto.randomBytes(6).toString('base64url'), t: now, key, status: (review ?? c.mode === 'review') ? 'review' : 'queued', at: now,
    kind, text: String(text).trim().slice(0, 1000), ...(short ? { short: String(short).trim().slice(0, 1000) } : {}), link, title, desc, lang: defaultLang(), nets: Object.fromEntries(nets.map(n => [n, { st: 'wait', tries: 0 }])) };
  save(p); kick();
  return p;
}
// Envoi : chaque réseau à part ; en cas d'erreur, nouvel essai 2, 4, 8, 16 min plus tard, puis abandon pour ce réseau
let running = false, kickT = null;
const kick = () => { clearTimeout(kickT); kickT = setTimeout(() => socialSend().catch(e => console.error('réseaux', e.message)), 1500); kickT.unref?.(); };
async function socialSend() {
  if (running) return; running = true;
  try {
    const now = Date.now(), c = socialCfg(), tags = c.tags, e = ENV();
    for (const r of q("SELECT * FROM social WHERE status='queued' AND at<=? ORDER BY t LIMIT 10").all(now)) {
      const p = rowOf(r);
      for (const [n, s] of Object.entries(p.nets)) {
        if (s.st !== 'wait' || (s.next && s.next > now)) continue;
        if (!NETS[n].ready(e) || c.off[n]) { s.st = 'off'; continue; }
        const full = fit(p.text, p.link, tags, Infinity), text = fit(p.short && glen(full) > NETS[n].max ? p.short : p.text, p.link, tags, NETS[n].max);
        try {
          Object.assign(s, n === 'bsky' ? await sendBsky(p, text) : await sendMasto(p, text, p.id), { st: 'ok', sent: Date.now(), err: '' });
        } catch (err) {
          s.tries = (s.tries || 0) + 1; s.err = err.message;
          if (s.tries >= MAX_TRIES || (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429)) s.st = 'err';
          else s.next = Date.now() + 2 ** s.tries * MIN;
          console.error('réseaux', NETS[n].name, err.message);
        }
      }
      const sts = Object.values(p.nets).map(s => s.st);
      if (!sts.includes('wait')) p.status = sts.includes('ok') ? 'done' : 'error';
      save(p);
    }
  } finally { running = false; }
}

// ---- Messages automatiques ----
const L = () => defaultLang();
const nf = n => Number(n).toLocaleString(LOCALE[L()] || 'fr-FR');
const dayName = d => new Date(parisMs(d, '12:00')).toLocaleDateString(LOCALE[L()] || 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
// Bilan public d'une journée (au moment où l'admin le publie)
function onPub(date, snap) {
  const l = L(), mob = require('./settings').mobsAll().find(m => m.date === date);
  const top = (snap.cities || []).slice(0, 3).map(c => `${c.name} (${nf(c.n)})`).join(', ');
  const nc = (snap.cities || []).length;
  const head = mob ? '📊 ' + tr(l, 'Bilan · {t}', { t: mob.title }) : '📊 ' + tr(l, 'Bilan du {d}', { d: dayName(date) });
  const vn = { n: nf(snap.total) }, vc = { n: nf(nc) };
  const sig = snap.total > 1 ? tr(l, '{n} signalements', vn) : tr(l, '{n} signalement', vn), vil = nc > 1 ? tr(l, '{n} villes', vc) : tr(l, '{n} ville', vc);
  const text = head + '\n' + tr(l, '{what} dans {where}.', { what: sig, where: vil })
    + (top ? ' ' + tr(l, 'En tête : {list}.', { list: top }) : '') + '\n' + tr(l, 'Parcours, heures fortes, arrêtés et données ouvertes :');
  return queuePost('pub', 'pub:' + date, { text, link: base() + '/manif/' + date, title: head.replace(/^📊 /, ''), desc: tr(l, 'Le bilan public de la journée sur Cortège.') });
}
// Idée mise au vote par l'admin : titre et début du texte, lien qui ouvre l'idée dans l'appli
function onIdea(i) {
  const l = L(), body = String(i.body || '').trim();
  const text = '💡 ' + tr(l, 'Idée au vote sur Cortège :') + '\n« ' + i.title + ' »' + (body ? '\n' + (body.length > 140 ? body.slice(0, 139).trimEnd() + '…' : body) : '')
    + '\n' + tr(l, 'Pour ou contre ? Ton vote compte :');
  return queuePost('idea', 'idea:' + i.id, { text, link: base() + '/?idee=' + encodeURIComponent(i.id), title: i.title, desc: tr(l, 'Propose et vote pour les prochaines fonctions de Cortège.') });
}
// Nouvelle version en ligne : ses nouveautés (public/nouveautes.json, celles que l'appli montre), une fois par version.
// Texte complet (titre et phrase de chaque nouveauté) pour Mastodon ; seulement les titres s'il ne tient pas (Bluesky).
const NEWS = path.join(__dirname, '..', 'public', 'nouveautes.json');
function newsPost() {
  let n; try { n = JSON.parse(fs.readFileSync(NEWS, 'utf8')); } catch { return null; }
  if (!n || !n.version || q('SELECT 1 FROM social WHERE key=?').get('news:' + n.version)) return null;
  const l = L(), items = n['items_' + l] || n.items || [];
  if (!items.length) return null;
  const head = '🆕 ' + tr(l, 'Cortège {v} est en ligne :', { v: n.version }), link = base() + '/?nouveautes', tags = socialCfg().tags;
  // Version courte (300 caractères) : chaque nouveauté en entier tant que ça tient, puis seulement son titre
  const room = 300 - glen('\n\n' + link + (tags ? '\n' + tags : '')), lines = [head];
  items.forEach(([ti, d], k) => {
    const rest = items.slice(k + 1).reduce((s2, [t2]) => s2 + 1 + glen(t2), 0), cur = lines.reduce((s2, x) => s2 + glen(x) + 1, -1);
    lines.push(cur + 1 + glen(ti + ' : ' + d) + rest <= room ? ti + ' : ' + d : ti);
  });
  return queuePost('news', 'news:' + n.version, { text: head + '\n' + items.map(([ti, d]) => ti + ' : ' + d).join('\n'),
    short: lines.join('\n'), link, title: tr(l, 'Nouveautés de Cortège {v}', { v: n.version }), desc: items.map(([ti]) => ti).join(' · ') });
}
// Arrêtés validés : notés ici, publiés ensemble une fois que plus rien n'arrive depuis 10 minutes
const ORD_QUIET = +(process.env.SOCIAL_ORDER_WAIT_MS || 10 * MIN);
function noteOrder(o) {
  if (!liveNets().length || !socialCfg().kinds.ord) return;
  let l = []; try { l = JSON.parse(getMeta('social:ordq') || '[]'); } catch {}
  if (!l.includes(o.id)) l.push(o.id);
  setMeta('social:ordq', JSON.stringify(l.slice(-200))); setMeta('social:ordt', String(Date.now()));
}
function flushOrders(now) {
  const last = Number(getMeta('social:ordt') || 0);
  if (!last || now - last < ORD_QUIET) return;
  let ids = []; try { ids = JSON.parse(getMeta('social:ordq') || '[]'); } catch {}
  setMeta('social:ordq', '[]'); setMeta('social:ordt', '0');
  const { ordersAll, ORDER_KIND } = require('./orders');
  const want = new Set(ids), list = ordersAll().filter(o => want.has(o.id) && o.status === 'ok' && o.end > now && o.zone);
  if (!list.length) return;
  const l = L(), names = [...new Set(list.map(o => o.zone.name))];
  let text, link = base() + '/';
  if (list.length === 1) {
    const o = list[0], k = ORDER_KIND[o.items[0].k] || ORDER_KIND.autre, z = o.zone;
    text = `${k.glyph} ${tr(l, k.label)} · ${z.name}\n` + tr(l, 'Nouvel arrêté à partir du {d}. La zone, les horaires et la source sont sur la carte :', { d: dayName(parisDay(o.start)) });
    if (z.b) link = base() + `/?at=${((z.b[0] + z.b[2]) / 2).toFixed(4)},${((z.b[1] + z.b[3]) / 2).toFixed(4)}`;
  } else {
    const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ' ' + tr(l, 'et {n} autres', { n: names.length - 5 }) : '');
    text = '⛔ ' + tr(l, '{n} nouveaux arrêtés', { n: list.length }) + ' : ' + shown + '.\n' + tr(l, 'Zones, horaires et sources sur la carte :');
  }
  queuePost('ord', 'ord:' + list.map(o => o.id).sort().join(',').slice(0, 200), { text, link, title: tr(l, 'Arrêtés en cours'), desc: names.slice(0, 8).join(', ') });
}
// Journées de mobilisation : la veille dès 19 h, et le jour J dès 8 h (une seule fois chacun)
function mobPosts(now) {
  const today = parisDay(now), tomorrow = parisDay(parisMs(today, '12:00') + 24 * 60 * MIN), h = parisHour(now) % 24, l = L();
  for (const m of require('./settings').mobsAll()) {
    if (m.date === tomorrow && h >= 19 && h < 23)
      queuePost('eve', 'eve:' + m.id + ':' + m.date, { text: '📣 ' + tr(l, 'Demain : {t}', { t: m.title }) + '\n' + (m.eve || tr(l, 'Rendez-vous, arrêtés et numéros utiles : prépare-toi sur Cortège, et signale ce que tu vois le jour J.')),
        link: base() + '/', title: m.title, desc: tr(l, 'La carte des manifs en direct.') });
    if (m.date === today && h >= 8 && h < 13) {
      const from = parisMs(today, '00:00'), to = from + 24 * 60 * MIN;
      const n = q("SELECT COUNT(*) n FROM events WHERE status!='pending' AND start>=? AND start<?").get(from, to).n;
      queuePost('day', 'day:' + m.id + ':' + m.date, { text: '✊ ' + tr(l, 'C’est aujourd’hui : {t}', { t: m.title }) + '\n'
        + (n ? tr(l, '{n} rendez-vous dans l’agenda.', { n: nf(n) }) + ' ' : '') + tr(l, 'Regarde ce que les autres signalent, signale ce que tu vois :'),
        link: base() + '/', title: m.title, desc: tr(l, 'La carte des manifs en direct.') });
    }
  }
}
function socialTick() {
  const now = Date.now();
  try { if (liveNets().length) { mobPosts(now); flushOrders(now); newsPost(); } } catch (e) { console.error('réseaux (journées, arrêtés, nouveautés)', e.message); }
  q('DELETE FROM social WHERE t<?').run(now - 90 * 24 * 60 * MIN);
  // Veille, jour J, arrêtés : plus d'actualité 12 h après, ils ne partent plus s'ils attendent encore une relecture
  q("UPDATE social SET status='skip' WHERE status='review' AND t<? AND json_extract(data,'$.kind') IN ('eve','day','ord')").run(now - 12 * 60 * MIN);
  socialSend().catch(e => console.error('réseaux', e.message));
}
if (process.env.SOCIAL !== '0') setInterval(socialTick, +(process.env.SOCIAL_TICK_MS || 60_000)).unref();

// ---- Admin ----
function socialAdmin() {
  const e = ENV(), c = socialCfg();
  return { cfg: c, nets: { bsky: { ready: NETS.bsky.ready(e), who: e.bsky.handle ? '@' + e.bsky.handle : '', pds: e.bsky.pds },
    masto: { ready: NETS.masto.ready(e), who: e.masto.url } },
    posts: q('SELECT * FROM social ORDER BY t DESC LIMIT 60').all().map(rowOf), review: q("SELECT COUNT(*) n FROM social WHERE status='review'").get().n };
}
function socialManual(b) {
  const text = String(b.text || '').replace(/\r/g, '').trim(), link = String(b.link || '').trim();
  if (text.length < 3) return [400, { error: 'Écris le message.' }];
  if (link && !/^https:\/\/[^\s]{4,300}$/.test(link)) return [400, { error: 'Le lien doit commencer par https://' }];
  if (!liveNets().length) return [409, { error: 'Aucun réseau prêt : ajoute les identifiants dans les variables du serveur, ou réactive un réseau.' }];
  const p = queuePost('man', 'man:' + crypto.randomBytes(6).toString('base64url'), { text, link, title: 'Cortège' }, { force: true, review: false });
  return [201, p];
}
function socialAct(id, act, b = {}) {
  const r = q('SELECT * FROM social WHERE id=?').get(id);
  if (!r) return [404, { error: 'Message introuvable.' }];
  const p = rowOf(r);
  if (act === 'send') {
    if (p.status !== 'review') return [409, { error: 'Ce message n’attend pas de relecture.' }];
    if (typeof b.text === 'string' && b.text.trim().length >= 3) p.text = b.text.replace(/\r/g, '').trim().slice(0, 1000);
    p.status = 'queued'; p.at = Date.now(); save(p); kick(); return [200, p];
  }
  if (act === 'skip') { if (p.status !== 'review' && p.status !== 'queued') return [409, { error: 'Déjà envoyé.' }]; p.status = 'skip'; save(p); return [200, p]; }
  if (act === 'retry') {
    for (const s of Object.values(p.nets)) if (s.st === 'err') { s.st = 'wait'; s.tries = 0; s.next = 0; }
    p.status = 'queued'; p.at = Date.now(); save(p); kick(); return [200, p];
  }
  return [400, { error: 'Action inconnue.' }];
}
// Retrait d'un message déjà publié, sur chaque réseau où il est en ligne
async function socialDelete(id) {
  const r = q('SELECT * FROM social WHERE id=?').get(id);
  if (!r) return [404, { error: 'Message introuvable.' }];
  const p = rowOf(r), errors = [];
  for (const [n, s] of Object.entries(p.nets)) {
    if (s.st !== 'ok' || !s.id) continue;
    try { await deleteRemote(n, s.id); s.st = 'del'; } catch (err) { if (err.status === 404) s.st = 'del'; else errors.push(NETS[n].name + ' : ' + err.message); }
  }
  if (!errors.length) p.status = 'deleted';
  save(p);
  return errors.length ? [502, { error: errors.join(' · ') }] : [200, p];
}

module.exports = { socialCfg, saveSocialCfg, queuePost, socialSend, socialTick, onPub, onIdea, newsPost, noteOrder, flushOrders, socialAdmin, socialManual, socialAct, socialDelete, socialTest, fit, facets };
