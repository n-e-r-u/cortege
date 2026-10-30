'use strict';
const fs = require('fs');
const path = require('path');
const { EVT } = require('../categories');
const { PUBLIC } = require('../http/static');
const { PUBLIC_URL_REAL, htmlEsc, pubShell, ordersHtml, frDay } = require('./bilans');
const { depOf } = require('../geo/departments');
const { legalAll } = require('../legal');
const { ordersLive } = require('../orders');
const { q } = require('../db');
const { slugOf } = require('../digest/pub');
const { upcoming, cityIndex } = require('./cities');
const { whereOf, polyHas } = require('../geo/communes');

// ---- Pages de contenu (référencement) : agenda, arrêtés, villes, droits, legal teams ----
const whenLong = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const eventLd = (req, list) => {
  if (!list.length) return null;
  const base = PUBLIC_URL_REAL(req);
  return { '@context': 'https://schema.org', '@graph': list.map(e => {
    const who = e.by && e.by !== 'Proposition de participant·e' ? e.by : 'Mobilisation locale', url = `${base}/?at=${e.lat},${e.lng}`;
    const org = { '@type': 'Organization', name: who, url: base + '/agenda' };
    return { '@type': 'Event', name: e.title, startDate: new Date(e.start).toISOString(), endDate: new Date(e.start + 3 * 3600e3).toISOString(),
      eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', isAccessibleForFree: true,
      location: { '@type': 'Place', name: e.place || e.title, address: e.place || whereOf(e.lat, e.lng).name, geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } },
      image: [base + '/og.png'], organizer: org, performer: org,
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR', availability: 'https://schema.org/InStock', url, validFrom: new Date(e.t || e.start).toISOString() },
      url, description: (EVT[e.type] || EVT.manif).label + (e.place ? ' · ' + e.place : '') + (e.note ? ' · ' + e.note : '') };
  }) };
};
const eventsHtml = list => `<ul class="days">${list.map(e => `<li><a href="/?at=${e.lat},${e.lng}"><span>${htmlEsc((EVT[e.type] || EVT.manif).glyph + ' ' + e.title)}${e.place ? `<br><small class="fine">${htmlEsc(e.place)}</small>` : ''}</span><span>${htmlEsc(whenLong(e.start))}</span></a></li>`).join('')}</ul>`;
const legalHtml = list => `<ul class="days">${list.map(e => `<li><a href="tel:${htmlEsc(String(e.phone).replace(/[^\d+]/g, ''))}"><span>⚖️ ${htmlEsc(e.name)}</span><span>${htmlEsc(e.phone)}</span></a></li>`).join('')}</ul>`;

function agendaPage(req) {
  const list = upcoming().slice(0, 200), by = new Map();
  for (const e of list) { const c = whereOf(e.lat, e.lng).name; if (!by.has(c)) by.set(c, []); by.get(c).push(e); }
  const cities = [...by].sort((a, b) => a[1][0].start - b[1][0].start);
  const body = `<h1>Agenda des manifs</h1><p class="lead">Les prochaines manifestations, rassemblements, blocus et assemblées annoncés sur Cortège, ville par ville.</p>
${cities.length ? cities.map(([c, l]) => `<section><h2>${cityLink(c)}</h2>${eventsHtml(l)}</section>`).join('') : '<p class="fine">Rien d’annoncé pour l’instant. Une orga ou un collectif peut annoncer une manif depuis l’appli (onglet Infos).</p>'}`;
  return pubShell(req, { title: 'Agenda des manifs en France · Cortège', desc: 'Les prochaines manifs, rassemblements et blocus annoncés en France, ville par ville, sur Cortège, la carte en direct des manifs.', body, ld: eventLd(req, list.slice(0, 60)) });
}
function ordersPage(req) {
  const now = Date.now(), list = ordersLive(now), by = new Map();
  for (const o of list) { const dn = (depOf(o.dep) || { n: o.dep }).n; if (!by.has(dn)) by.set(dn, []); by.get(dn).push({ name: o.name, scope: o.scope, start: o.start, end: o.end, items: o.items, src: o.src, host: o.host }); }
  const body = `<h1>Arrêtés et interdictions en cours</h1><p class="lead">Manifestations interdites, périmètres, couvre-feux et restrictions de transport, avec la source officielle de chaque mesure.</p>
${by.size ? [...by].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([dn, l]) => `<section><h2>${htmlEsc(dn)}</h2><ul class="orders">${ordersHtml(l)}</ul></section>`).join('') : '<p class="fine">Aucun arrêté connu en ce moment.</p>'}
<p class="fine">Une mesure manque ? Propose-la depuis l’appli (onglet Infos, « Tous les arrêtés »), avec le lien de la source : elle est vérifiée avant d’être publiée.</p>`;
  return pubShell(req, { title: 'Arrêtés anti-manif en cours : interdictions, périmètres, couvre-feux · Cortège', desc: 'Les arrêtés en cours contre les manifestations en France, département par département, avec leurs sources officielles.', body });
}
function legalTeamsPage(req) {
  const by = new Map();
  for (const e of legalAll().filter(e => e.ok)) { if (!by.has(e.city)) by.set(e.city, []); by.get(e.city).push(e); }
  const body = `<h1>Legal teams en France</h1><p class="lead">Les numéros des legal teams, ville par ville. Écris le numéro de ta ville au stylo sur ton bras avant la manif : en garde à vue, ton téléphone te sera retiré.</p>
${by.size ? [...by].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([c, l]) => `<section><h2>${cityLink(c)}</h2>${legalHtml(l)}</section>`).join('') : '<p class="fine">Annuaire en cours de constitution.</p>'}
<p class="fine">Chaque numéro est vérifié auprès de la source publique du collectif. Une erreur, un numéro qui manque ? Écris via la page <a href="/legal.html#retrait">contact</a>.</p>`;
  return pubShell(req, { title: 'Legal teams : les numéros, ville par ville · Cortège', desc: 'Annuaire des legal teams en France : le numéro à noter avant une manif, ville par ville.', body });
}
// Page « Tes droits » : le contenu de l'onglet Droits de l'appli (une seule source : index.html)
let rightsCache = null;
function rightsPage(req) {
  if (!rightsCache) {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const a = html.indexOf('<h3 class="menu-group">En cas de</h3>'), sheet = html.indexOf('id="sheetRights"'), b = html.indexOf('</section>', a);
    // Seulement les rubriques (details) et l'avertissement juridique, pas les boutons ni les liens propres à l'appli
    const part = a > sheet && b > a ? html.slice(a, b) : '', end = part.lastIndexOf('</details>');
    const warn = (part.slice(end).match(/<p[^>]*>[^<]*Informations générales[\s\S]*?<\/p>/) || [''])[0];
    rightsCache = end > 0 ? (part.slice(0, end + 10) + warn).replace(/<h3 class="menu-group">En cas de<\/h3>/, '').replace(/\s(id|class|data-[\w-]+)="[^"]*"/g, '').replace(/<button[\s\S]*?<\/button>/g, '') : '';
  }
  const body = `<h1>Tes droits en manif</h1><p class="lead">Sommations, contrôle d’identité, garde à vue, téléphone, attaque d’un groupe fasciste : l’essentiel à savoir avant de partir. Le même contenu est dans l’appli, onglet Droits, même sans réseau.</p>
<section class="rights">${rightsCache}</section><p class="fine">Trouve le numéro de la legal team de ta ville dans <a href="/legal-teams">l’annuaire</a>.</p>`;
  return pubShell(req, { title: 'Tes droits en manif : sommations, garde à vue, contrôle d’identité · Cortège', desc: 'Ce qu’il faut savoir avant une manif : sommations, contrôle d’identité, garde à vue, téléphone, attaque fasciste.', body });
}
// Villes qui ont du contenu (manif à venir, legal team, ou ville d'un bilan publié) : une page chacune
const cityLink = name => { const s = slugOf(name); return cityIndex().has(s) ? `<a href="/ville/${s}">${htmlEsc(name)}</a>` : htmlEsc(name); };
function cityPage(req, c) {
  const now = Date.now(), orders = ordersLive(now).filter(o => c.lat != null && o.p && (o.scope === 'dep' || o.name === c.name) && polyHas(o.p, c.lat, c.lng));
  const body = `<h1>Manifs à ${htmlEsc(c.name)}</h1><p class="lead">Prochaines manifs, arrêtés en cours, legal team et bilans des dernières mobilisations à ${htmlEsc(c.name)}.</p>
<section><h2>À venir</h2>${c.events.length ? eventsHtml(c.events) : '<p class="fine">Rien d’annoncé pour l’instant.</p>'}</section>
${orders.length ? `<section><h2>Arrêtés en cours</h2><ul class="orders">${ordersHtml(orders)}</ul></section>` : ''}
${c.legal.length ? `<section><h2>Legal team</h2>${legalHtml(c.legal)}<p class="fine">Note le numéro au stylo sur ton bras avant de partir.</p></section>` : ''}
${c.bilans.length ? `<section><h2>Bilans des manifs</h2><ul class="days">${c.bilans.map(b => `<li><a href="/manif/${b.date}${b.page ? '/' + b.page : ''}"><span>${htmlEsc(frDay(b.date))}</span><span>${b.n} signalements</span></a></li>`).join('')}</ul></section>` : ''}
<div class="cta" style="grid-template-columns:1fr"><a class="main" href="/?at=${c.lat},${c.lng}">Voir la carte en direct à ${htmlEsc(c.name)}</a></div>`;
  return pubShell(req, { title: `Manifs à ${c.name} : agenda, arrêtés, legal team · Cortège`, desc: `Les prochaines manifs à ${c.name}, les arrêtés en cours, le numéro de la legal team et les bilans des dernières mobilisations.`, body, ld: eventLd(req, c.events) });
}
function citiesPage(req) {
  const list = [...cityIndex().values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const body = `<h1>Les manifs, ville par ville</h1><p class="lead">Agenda, arrêtés, legal teams et bilans pour chaque ville.</p>
<section><p>${list.map(c => `<a href="/ville/${c.slug}">${htmlEsc(c.name)}</a>`).join(' · ') || 'Aucune ville pour l’instant.'}</p></section>`;
  return pubShell(req, { title: 'Les manifs ville par ville · Cortège', desc: 'Agenda des manifs, arrêtés, legal teams et bilans, ville par ville, sur Cortège.', body });
}

function pubIndex(req) {
  const list = q('SELECT date, data FROM pub ORDER BY date DESC').all().map(x => { const d = JSON.parse(x.data); return { date: x.date, total: d.total, cities: d.cities.length }; });
  const next = upcoming().length;
  const body = `<h1>Bilans des manifs</h1><p class="lead">Ce que les manifestant·es ont signalé sur Cortège, journée par journée.${next ? ` Les prochaines manifs sont dans <a href="/agenda">l’agenda</a>.` : ''}</p>
<section><h2>Bilans</h2>${list.length ? `<ul class="days">${list.map(x => `<li><a href="/manif/${x.date}"><span>${htmlEsc(frDay(x.date))}</span><span>${x.total} signalements · ${x.cities} villes</span></a></li>`).join('')}</ul>` : '<p class="fine">Aucun bilan publié pour l’instant.</p>'}</section>`;
  return pubShell(req, { title: 'Bilans des manifs · Cortège', desc: 'Les bilans des mobilisations signalées sur Cortège, la carte en direct des manifs : chiffres, moments clés, parcours, données ouvertes.', body });
}
function sendPage(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
  res.end(html);
}

module.exports = { agendaPage, ordersPage, legalTeamsPage, rightsPage, cityPage, citiesPage, pubIndex, sendPage };
