'use strict';
// Pages HTML des bilans publics (/manif/…), carte des villes, données ouvertes (CSV), plan du site.
const fs = require('fs');
const path = require('path');
const { CAT } = require('../categories');
const { CITY_PAGE_MIN } = require('../digest/pub');
const { ORDER_KIND } = require('../orders');
const { ROOT, BRAND, MIN } = require('../config');
const { cityIndex } = require('./cities');
const { distM } = require('../util');

const { q } = require('../db');
const { whereOf } = require('../geo/communes');

let storyMap = null;
const BubbleMap = require('../../public/bubble-map.js');
const { streetRoute } = require('../../tools/street-route.js');
const { parisHour } = require('../time');
const routeCache = new Map();
function mapSvg(cities) {
  try { storyMap ||= JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'story-map.json'), 'utf8')); } catch { return ''; }
  const m = storyMap, b = BubbleMap.svg(cities, m, { fontSize: 26, labels: 14, esc: htmlEsc });
  return `<svg viewBox="0 0 ${m.w} ${m.h}" role="img" aria-label="Carte des signalements par ville"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec9fa4"/><stop offset="1" stop-color="#7d86dc"/></linearGradient></defs>`
    + m.near.map(p => `<path d="${p}" fill="#1c1c20" stroke="#34343c" stroke-width="1.5"/>`).join('') + `<path d="${m.fr}" fill="#26262c" stroke="#5a5866" stroke-width="2"/>${b.dots}${b.labels}</svg>`
    + (b.merged ? '<p class="fine">Sur la carte, les communes très proches sont regroupées sous le nom de la plus active ; le détail est dans la liste.</p>' : '');
}
const htmlEsc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GROUP_COL = { fdo: '#e5484d', danger: '#f5a524', soutien: '#30a46c', info: '#8e8cd8' };
const GROUP_FR = { fdo: 'Forces de l’ordre', danger: 'Danger', info: 'Info', soutien: 'Soutien' };
const frDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const frHour = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const PUB_CSS = `*{box-sizing:border-box}body{margin:0;background:#121214;color:#f2f1f4;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}a{color:#ec9fa4}.top{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.top img{width:44px;height:44px;border-radius:10px}
.top b{display:block;font-size:18px}.top span{color:#a3a1ad;font-size:13px}h1{font-size:clamp(28px,6vw,42px);line-height:1.1;margin:28px 0 6px}.lead{color:#c9c7d1;margin:0 0 20px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}.kpi{background:#1c1c20;border:1px solid #34343c;border-radius:14px;padding:12px 14px}.kpi b{display:block;font-size:30px;font-variant-numeric:tabular-nums}.kpi span{color:#a3a1ad;font-size:13px}
section{background:#1c1c20;border:1px solid #34343c;border-radius:16px;padding:16px;margin:14px 0}h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#ec9fa4;margin:0 0 12px}
svg{width:100%;height:auto;display:block}.row{display:grid;grid-template-columns:minmax(120px,40%) 1fr 48px;gap:10px;align-items:center;margin:6px 0;font-size:14px}.bar{height:14px;border-radius:4px}.n{text-align:right;font-variant-numeric:tabular-nums}
.hours{display:flex;gap:3px;align-items:flex-end;height:160px;border-bottom:1px solid #5a5866}.hours div{flex:1;background:#5b66c4;border-radius:3px 3px 0 0;min-height:1px}.hours .pk{background:#ec9fa4}.ticks{display:flex;gap:3px;color:#a3a1ad;font-size:11px}.ticks span{flex:1;text-align:center}
.fine{color:#a3a1ad;font-size:13px}.cta{display:grid;gap:10px;grid-template-columns:1fr 1fr;margin-top:18px}.cta a{display:block;text-align:center;padding:14px;border-radius:14px;background:#26262c;border:1px solid #34343c;color:#f2f1f4;text-decoration:none;font-weight:700}
.cta a.main{background:linear-gradient(135deg,#ec9fa4,#a191d8 60%,#7d86dc);color:#17121f;border:0}
nav.links{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0 0}nav.links a{padding:6px 10px;border-radius:99px;background:#1c1c20;border:1px solid #34343c;color:#f2f1f4;text-decoration:none;font-size:13px}nav.links a[aria-current]{border-color:#ec9fa4;color:#ec9fa4}
ul.tl{list-style:none;padding:0;margin:0}ul.tl li{padding:6px 0;border-bottom:1px solid #2a2a30}ul.tl time{display:inline-block;min-width:64px;color:#ec9fa4;font-variant-numeric:tabular-nums;font-weight:700}
ul.orders{padding-left:18px}ul.orders>li{margin:10px 0}ul.orders ul{margin:4px 0;padding-left:18px}.rights details{border-bottom:1px solid #2a2a30;padding:8px 0}.rights summary{font-weight:700;cursor:pointer}ul.days{list-style:none;padding:0}ul.days li{margin:8px 0}ul.days a{display:flex;justify-content:space-between;padding:14px 16px;border-radius:14px;background:#1c1c20;border:1px solid #34343c;color:#f2f1f4;text-decoration:none}`;
function pubShell(req, { title, desc, body, ld }) {
  const base = PUBLIC_URL_REAL(req), here = base + String(req.url || '/').split('?')[0].replace(/\/$/, '');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEsc(title)}</title><meta name="description" content="${htmlEsc(desc)}"><link rel="canonical" href="${htmlEsc(here || base + '/')}">${ld ? jsonLd(ld) : ''}
<meta property="og:title" content="${htmlEsc(title)}"><meta property="og:description" content="${htmlEsc(desc)}"><meta property="og:type" content="article">
<meta property="og:image" content="${base}/icon-512.png"><meta name="twitter:card" content="summary"><link rel="icon" href="/favicon.png"><style>${PUB_CSS}</style></head>
<body><main><a class="top" href="/"><img src="/brand/logo.png" alt=""><span><b>Cortège</b><span>La carte en direct des manifs${BRAND.handle ? ' · par @' + htmlEsc(BRAND.handle) : ''}</span></span></a>
<nav class="links" aria-label="Pages">${[['/', 'Carte'], ['/agenda', 'Agenda'], ['/arretes', 'Arrêtés'], ['/manif', 'Bilans'], ['/villes', 'Villes'], ['/droits', 'Tes droits'], ['/legal-teams', 'Legal teams']]
  .map(([u, l]) => `<a href="${u}"${here.endsWith(u) && u !== '/' ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>${body}
<div class="cta"><a class="main" href="/">Ouvrir la carte</a><a href="${htmlEsc(BRAND.instagram || '/')}" rel="noopener">${BRAND.handle ? 'Suivre @' + htmlEsc(BRAND.handle) : 'Suivre le projet'}</a></div>
<p class="fine">Signalements anonymes envoyés par les manifestant·es : ce ne sont pas des faits vérifiés, ils sont confirmés ou contestés par les autres sur place. Positions à une dizaine de mètres près ; rien sur les personnes qui ont signalé.</p></main></body></html>`;
}
const GOOGLE_VERIFY = /^google[\w-]{6,60}\.html$/.test(process.env.GOOGLE_SITE_VERIFICATION || '') ? process.env.GOOGLE_SITE_VERIFICATION : '';
function sitemapXml(req) {
  const base = PUBLIC_URL_REAL(req), day = t => new Date(t).toISOString().slice(0, 10);
  const pubs = q('SELECT date, t FROM pub ORDER BY date DESC').all();
  const urls = [['/', day(Date.now()), 'always', '1.0'], ['/manif', pubs[0] ? day(pubs[0].t) : null, 'daily', '0.8'], ['/presse', null, 'monthly', '0.6'],
    ['/affiche.html', null, 'monthly', '0.4'], ['/legal.html', null, 'yearly', '0.2'], ...pubs.map(x => ['/manif/' + x.date, day(x.t), 'monthly', '0.7']),
    ['/agenda', day(Date.now()), 'daily', '0.8'], ['/arretes', day(Date.now()), 'daily', '0.7'], ['/droits', null, 'monthly', '0.6'], ['/legal-teams', null, 'weekly', '0.6'], ['/villes', null, 'daily', '0.5'],
    ...[...cityIndex().values()].map(c => ['/ville/' + c.slug, null, 'daily', '0.6']),
    ...pubs.flatMap(x => { try { return (JSON.parse(q('SELECT data FROM pub WHERE date=?').get(x.date).data).cityPages || []).map(c => ['/manif/' + x.date + '/' + c.slug, day(x.t), 'monthly', '0.5']); } catch { return []; } })];
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(([u, m, f, p]) => `<url><loc>${htmlEsc(base + u)}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}<changefreq>${f}</changefreq><priority>${p}</priority></url>`).join('\n')
    + '\n</urlset>\n';
}
// Données structurées (schema.org) : rien n'est exécuté, c'est seulement lu par les moteurs de recherche
const jsonLd = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const PUBLIC_URL_REAL = req => (process.env.PUBLIC_URL || ('https://' + String(req.headers.host || 'localhost').replace(/[^\w.:-]/g, ''))).replace(/\/$/, '');
const cap = s => s[0].toUpperCase() + s.slice(1);
const fmtMin = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;
const fmtLen = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const catTxt = c => CAT[c] ? `${CAT[c].glyph} ${CAT[c].label}` : c;
// Classement de la journée parmi les bilans publiés, et évolution depuis le bilan précédent
function pubRank(d) {
  const all = q('SELECT date, data FROM pub ORDER BY date').all().map(x => ({ date: x.date, total: JSON.parse(x.data).total }));
  if (all.length < 2) return '';
  const rank = all.filter(x => x.total > d.total).length + 1, i = all.findIndex(x => x.date === d.date), prev = i > 0 ? all[i - 1] : null;
  const pct = prev && prev.total ? Math.round((d.total - prev.total) / prev.total * 100) : null;
  return `<p class="fine">${rank === 1 ? 'La journée la plus signalée' : `${rank}<sup>e</sup> journée la plus signalée`} sur ${all.length} bilans publiés${pct !== null ? ` · ${pct >= 0 ? '+' : ''}${pct} % par rapport au <a href="/manif/${prev.date}">${htmlEsc(frDay(prev.date))}</a>` : ''}.</p>`;
}
const ORDER_GLYPH = k => (ORDER_KIND[k] || ORDER_KIND.autre).glyph + ' ' + (ORDER_KIND[k] || ORDER_KIND.autre).label;
function ordersHtml(list) {
  return list.map(o => `<li><b>${htmlEsc(o.name)}</b>${o.scope === 'dep' ? ' (département)' : ''} · du ${htmlEsc(frWhen(o.start))} au ${htmlEsc(frWhen(o.end))}
<ul>${o.items.map(x => `<li>${htmlEsc(ORDER_GLYPH(x.k))} : ${htmlEsc(x.text)}</li>`).join('')}</ul><span class="fine">Source : <a href="${htmlEsc(o.src)}" rel="noopener nofollow">${htmlEsc(o.host || 'lien')}</a></span></li>`).join('');
}
const frWhen = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const momentsHtml = (list, withCity) => `<ul class="tl">${list.map(m => `<li><time>${frHour(m.t)}</time> ${htmlEsc(catTxt(m.c))}${withCity ? ' · ' + htmlEsc(m.city) : ''}${m.up ? ` <span class="fine">(confirmé ${m.up}×)</span>` : ''}${m.v ? ' <span class="fine">✓ vérifié</span>' : ''}</li>`).join('')}</ul>`;

function pubPage(req, d) {
  const maxC = d.cats[0].n, maxH = Math.max(...d.hours), peak = d.hours.indexOf(maxH), top = d.cities.slice(0, 12), maxV = top[0].n;
  const day = cap(frDay(d.date)), pages = new Map((d.cityPages || []).map(c => [c.name, c.slug]));
  const title = `${day} : ${d.total} signalements sur Cortège`;
  const desc = `${d.total} signalements de manifestant·es dans ${d.cities.length} villes, de ${frHour(d.first)} à ${frHour(d.last)}. Carte, moments clés, parcours des cortèges, arrêtés, données ouvertes.`;
  const cityName = c => pages.has(c) ? `<a href="/manif/${d.date}/${pages.get(c)}">${htmlEsc(c)}</a>` : htmlEsc(c);
  const durs = Object.entries(d.durations || {}).slice(0, 12);
  const body = `<h1>${htmlEsc(day)}</h1><p class="lead">Ce que les manifestant·es ont signalé sur Cortège.</p>
<div class="kpis"><div class="kpi"><b>${d.total}</b><span>signalements</span></div><div class="kpi"><b>${d.cities.length}</b><span>villes</span></div>
<div class="kpi"><b>${frHour(d.first)}</b><span>premier signalement</span></div><div class="kpi"><b>${frHour(d.last)}</b><span>dernier signalement</span></div></div>
${pubRank(d)}
<section><h2>Par ville</h2>${mapSvg(d.cities)}${top.map(c => `<div class="row"><span>${cityName(c.name)}</span><span class="bar" style="width:${Math.max(2, c.n / maxV * 100)}%;background:linear-gradient(90deg,#ec9fa4,#a191d8)"></span><span class="n">${c.n}</span></div>`).join('')}
${d.cities.length > 12 ? `<p class="fine">+ ${d.cities.length - 12} autres ${d.communes ? 'communes' : 'villes. Chaque ville compte aussi les communes voisines de son agglomération'}.</p>` : ''}
${pages.size ? `<p class="fine">Page détaillée pour chaque ville d’au moins ${CITY_PAGE_MIN} signalements : ${[...pages].map(([n, s]) => `<a href="/manif/${d.date}/${s}">${htmlEsc(n)}</a>`).join(', ')}.</p>` : ''}
${d.abroad ? `<p class="fine">${d.abroad} ${d.abroad > 1 ? 'signalements envoyés' : 'signalement envoyé'} hors de France, non ${d.abroad > 1 ? 'comptés' : 'compté'} ici.</p>` : ''}</section>
${d.moments && d.moments.length ? `<section><h2>Moments clés</h2><p class="fine">Le premier signalement de chaque danger, ville par ville.</p>${momentsHtml(d.moments.slice(0, 30), true)}</section>` : ''}
${durs.length ? `<section><h2>Combien de temps</h2><p class="fine">Durée pendant laquelle chaque danger est resté signalé (les signalements qui se chevauchent ne comptent qu’une fois).</p>
${durs.map(([c, l]) => `<p><b>${cityName(c)}</b> : ${l.map(([k, m]) => `${htmlEsc(catTxt(k))} ${fmtMin(m)}`).join(' · ')}</p>`).join('')}</section>` : ''}
${d.marches && d.marches.length ? `<section><h2>Parcours des cortèges</h2><p class="fine">D’après le chemin de la tête de cortège, signalée par les manifestant·es ou partagée en direct par le service d’ordre.</p>
${d.marches.map(m => `<p><b>${cityName(m.city)}</b> : ${fmtLen(m.len)} de ${frHour(m.from)} à ${frHour(m.to)}${m.kmh ? `, environ ${String(m.kmh).replace('.', ',')} km/h en moyenne` : ''}</p>`).join('')}</section>` : ''}
${d.orders && d.orders.length ? `<section><h2>Arrêtés en vigueur ce jour-là</h2><ul class="orders">${ordersHtml(d.orders)}</ul></section>` : ''}
<section><h2>Par type</h2><p class="fine">${Object.entries(d.fam).map(([g, n]) => `<span style="color:${GROUP_COL[g]}">●</span> ${GROUP_FR[g]} ${n}`).join(' · ')}</p>
${d.cats.map(c => `<div class="row"><span>${htmlEsc(c.label)}</span><span class="bar" style="width:${Math.max(1.5, c.n / maxC * 100)}%;background:${GROUP_COL[c.group]}"></span><span class="n">${c.n}</span></div>`).join('')}</section>
<section><h2>Par heure</h2><p class="fine">Le plus d’envois entre ${peak} h et ${(peak + 1) % 24} h (${maxH}).</p><div class="hours" role="img" aria-label="Signalements par heure">${d.hours.map((n, i) => `<div class="${i === peak ? 'pk' : ''}" style="height:${n / maxH * 100}%" title="${i} h : ${n}"></div>`).join('')}</div>
<div class="ticks">${d.hours.map((_, i) => `<span>${i % 3 ? '' : i + 'h'}</span>`).join('')}</div></section>
<section><h2>Vérification</h2><div class="kpis"><div class="kpi"><b style="color:#30a46c">${d.confirmed}</b><span>confirmés par au moins une autre personne (${d.confs} confirmations)</span></div>
<div class="kpi"><b style="color:#8e8cd8">${d.verified}</b><span>vérifiés par une orga certifiée</span></div><div class="kpi"><b style="color:#f5a524">${d.removed}</b><span>retirés avant leur expiration (inclus dans les totaux)</span></div></div></section>
<section><h2>Carte d’un créneau</h2><p>Choisis un lieu et une plage horaire : une image avec les signalements de ce moment-là, à télécharger ou partager (presse, legal teams, témoignages).</p>
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/manif/${d.date}/carte">Fabriquer une image d’un créneau</a></div></section>
${dataSection(d)}`;
  const ld = { '@context': 'https://schema.org', '@type': 'Dataset', name: title, description: desc, url: PUBLIC_URL_REAL(req) + '/manif/' + d.date, license: 'https://creativecommons.org/licenses/by/4.0/',
    creator: { '@type': 'Organization', name: 'Cortège' }, temporalCoverage: d.date, spatialCoverage: 'France', isAccessibleForFree: true,
    distribution: d.pts ? [{ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: PUBLIC_URL_REAL(req) + `/manif/${d.date}/donnees.csv` }] : undefined };
  return pubShell(req, { title, desc, body, ld });
}
const dataSection = d => d.pts ? `<section><h2>Données ouvertes</h2><p>Tous les signalements de la journée, un par ligne : type, heures de début et de fin, position (à une dizaine de mètres), commune, confirmations, vérification, devenir.</p>
<div class="cta" style="grid-template-columns:1fr"><a href="/manif/${d.date}/donnees.csv" download>Télécharger les données (CSV)</a></div>
<p class="fine">Licence <a href="https://creativecommons.org/licenses/by/4.0/deed.fr" rel="noopener">CC BY 4.0</a> : réutilisation libre en citant « Cortège ». Ce sont des signalements de manifestant·es, confirmés ou contestés sur place, pas des faits établis.</p></section>` : '';

// Schéma d'une ville (sans fond de carte) : parcours de la tête et signalements de la journée, avec une échelle
function citySvg(c, pts, scale) {
  const near = (pts || []).map(p => ({ c: p[0], lat: p[3] / scale, lng: p[4] / scale })).filter(p => CAT[p.c] && distM(p, c) <= 6000);
  const path = c.march ? c.march.path : [];
  const all = [...near.map(p => [p.lat, p.lng]), ...path.map(p => [p[0], p[1]])];
  if (all.length < 2) return '';
  const k = Math.cos(c.lat * Math.PI / 180), W = 700, H = 460, pad = 24;
  const xs = all.map(p => p[1] * k), ys = all.map(p => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((W - 2 * pad) / Math.max(x1 - x0, 1e-4), (H - 2 * pad) / Math.max(y1 - y0, 1e-4));
  const P = (lat, lng) => [pad + (lng * k - x0) * sc, H - pad - (lat - y0) * sc];
  const line = path.length > 1 ? `<polyline points="${path.map(p => P(p[0], p[1]).map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#ec9fa4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>` : '';
  const dots = near.slice(0, 3000).map(p => { const [x, y] = P(p.lat, p.lng); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${GROUP_COL[CAT[p.c].group]}" fill-opacity=".75"/>`; }).join('');
  // Échelle : 500 m, 1 km ou 2 km selon la taille du schéma
  const mPerPx = 1 / sc * 111320, bar = [200, 500, 1000, 2000].find(v => v / mPerPx >= 80) || 2000, bw = bar / mPerPx;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Schéma des signalements à ${htmlEsc(c.name)}"><rect width="${W}" height="${H}" rx="12" fill="#16161a"/>${line}${dots}
<g fill="#a3a1ad" font-size="13"><rect x="${W - pad - bw}" y="${H - 14}" width="${bw}" height="3"/><text x="${W - pad}" y="${H - 20}" text-anchor="end">${fmtLen(bar)}</text></g></svg>`;
}
function cityDayPage(req, d, c) {
  const day = frDay(d.date), title = `${c.name}, ${day} : ${c.n} signalements sur Cortège`;
  const desc = `${c.n} signalements de manifestant·es à ${c.name} le ${day}, de ${frHour(c.first)} à ${frHour(c.last)}. Moments clés, durées, parcours du cortège.`;
  const maxH = Math.max(...c.hours), peak = c.hours.indexOf(maxH), maxC = c.cats[0][1];
  const pad = n => String(n).padStart(2, '0'), h0 = parisHour(c.first) % 24, h1 = parisHour(c.last) % 24;
  const slot = h1 >= h0 && h1 - h0 < 6 ? `${pad(h0)}:00-${pad(h1)}:59` : `${pad(peak)}:00-${pad(Math.min(23, peak + 2))}:59`;
  const ordersHere = (d.orders || []).filter(o => o.name === c.name || o.scope === 'dep');
  const body = `<p class="fine"><a href="/manif/${d.date}">← Bilan national du ${htmlEsc(day)}</a></p><h1>${htmlEsc(c.name)}</h1><p class="lead">${htmlEsc(cap(day))} : ce que les manifestant·es ont signalé sur Cortège.</p>
<div class="kpis"><div class="kpi"><b>${c.n}</b><span>signalements</span></div><div class="kpi"><b>${frHour(c.first)}</b><span>premier</span></div><div class="kpi"><b>${frHour(c.last)}</b><span>dernier</span></div>
${c.march ? `<div class="kpi"><b>${fmtLen(c.march.len)}</b><span>parcourus par la tête du cortège</span></div>` : ''}</div>
<section><h2>Schéma</h2>${citySvg(c, d.pts, d.ptsS || 1e3)}<p class="fine">${c.march ? 'En rose, le chemin de la tête du cortège. ' : ''}Points : les signalements de la journée à moins de 6 km. Schéma sans fond de carte : pour la vraie carte, fabrique l’image d’un créneau.</p>
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/manif/${d.date}/carte?c=${c.lat},${c.lng}&amp;n=${encodeURIComponent(c.name)}&amp;h=${slot}">Carte d’un créneau à ${htmlEsc(c.name)}</a></div></section>
${c.moments.length ? `<section><h2>Moments clés</h2>${momentsHtml(c.moments, false)}</section>` : ''}
${c.durations.length ? `<section><h2>Combien de temps</h2>${c.durations.map(([k, m]) => `<p>${htmlEsc(catTxt(k))} : <b>${fmtMin(m)}</b></p>`).join('')}</section>` : ''}
${c.march ? `<section><h2>Parcours du cortège</h2><p>${fmtLen(c.march.len)} de ${frHour(c.march.from)} à ${frHour(c.march.to)}${c.march.kmh ? `, environ ${String(c.march.kmh).replace('.', ',')} km/h en moyenne` : ''}.</p></section>` : ''}
${ordersHere.length ? `<section><h2>Arrêtés en vigueur ce jour-là</h2><ul class="orders">${ordersHtml(ordersHere)}</ul></section>` : ''}
<section><h2>Par type</h2>${c.cats.map(([k, n]) => `<div class="row"><span>${htmlEsc(catTxt(k))}</span><span class="bar" style="width:${Math.max(1.5, n / maxC * 100)}%;background:${GROUP_COL[CAT[k] ? CAT[k].group : 'info']}"></span><span class="n">${n}</span></div>`).join('')}</section>
<section><h2>Par heure</h2><div class="hours" role="img" aria-label="Signalements par heure">${c.hours.map((n, i) => `<div class="${i === peak ? 'pk' : ''}" style="height:${maxH ? n / maxH * 100 : 0}%" title="${i} h : ${n}"></div>`).join('')}</div>
<div class="ticks">${c.hours.map((_, i) => `<span>${i % 3 ? '' : i + 'h'}</span>`).join('')}</div></section>
<section><h2>Vérification</h2><p>${c.confirmed} confirmés par au moins une autre personne, ${c.verified} vérifiés par une orga certifiée.</p></section>
${dataSection(d)}`;
  return pubShell(req, { title, desc, body });
}
// Données ouvertes d'un bilan (CSV, gardé en mémoire)
const csvCache = new Map();
function pubCsv(d) {
  const key = d.date + ':' + (d.pts || []).length;
  if (csvCache.has(key)) return csvCache.get(key);
  const OUT = ['', 'contesté', 'retiré par une orga', 'retiré par l’admin', 'évincé (zone saturée)', 'effacé (purge)', 'retiré', 'retiré'];
  const sc = d.ptsS || 1e3, iso = m => new Date(m * MIN).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
  const esc = v => /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = ['type;categorie;famille;debut;fin;latitude;longitude;commune;confirmations;verifie_par_orga;devenir'];
  for (const [c, t, e, la, lo, up, v, o] of d.pts || []) {
    const lat = la / sc, lng = lo / sc;
    lines.push([c, CAT[c] ? CAT[c].label : c, CAT[c] ? GROUP_FR[CAT[c].group] : '', iso(t), iso(e), lat, lng, whereOf(lat, lng).name, up, v ? 'oui' : 'non', OUT[o || 0] || 'expiré normalement'].map(esc).join(';'));
  }
  const out = '﻿' + lines.join('\n') + '\n';
  csvCache.set(key, out); if (csvCache.size > 20) csvCache.delete(csvCache.keys().next().value);
  return out;
}

module.exports = { streetRoute, routeCache, htmlEsc, frDay, pubShell, GOOGLE_VERIFY, sitemapXml, PUBLIC_URL_REAL, ordersHtml, pubPage, cityDayPage, pubCsv };
