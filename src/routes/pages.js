'use strict';
// Routes des pages publiques : plan du site, bilans (/manif/…), pages de contenu, carte d'un créneau, tuiles vectorielles.
const { CATEGORIES } = require('../categories');
const { NEXT } = require('./next');
const { PMTILES, serveVectorTile } = require('../geo/pmtiles');
const { PUBLIC_URL_REAL, sitemapXml, GOOGLE_VERIFY, pubPage, pubCsv, cityDayPage } = require('../pages/bilans');
const { bump } = require('../limits');
const { cityIndex } = require('../pages/cities');
const { clientHash } = require('../privacy');
const { h8 } = require('../util');
const { orgaRequest } = require('../orgas/requests');
const { pubFull, getPub, pubWithPts } = require('../digest/pub');
const { send, readJson } = require('../http/respond');
const { sendPage, pubIndex, agendaPage, ordersPage, rightsPage, legalTeamsPage, citiesPage, cityPage } = require('../pages/content');
const { serveStatic } = require('../http/static');
const { tx } = require('../db');

async function pagesRoutes(req, res, url, pathname) {
  if (req.method === 'GET' && (pathname === '/presse' || pathname === '/presse/')) return serveStatic(req, res, '/presse.html');
  // Référencement : robots.txt, plan du site, et fichier de validation de Google Search Console (GOOGLE_SITE_VERIFICATION=google0123….html)
  if (req.method === 'GET' && pathname === '/robots.txt')
    return send(res, 200, `User-agent: *\nDisallow: /api/\nAllow: /\n\nSitemap: ${PUBLIC_URL_REAL(req)}/sitemap.xml\n`, { 'Cache-Control': 'public, max-age=3600' });
  if (req.method === 'GET' && pathname === '/sitemap.xml') return send(res, 200, sitemapXml(req), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  if (req.method === 'GET' && GOOGLE_VERIFY && pathname === '/' + GOOGLE_VERIFY) return send(res, 200, 'google-site-verification: ' + GOOGLE_VERIFY);
  if (req.method === 'GET' && (pathname === '/manif' || pathname === '/manif/')) return sendPage(res, pubIndex(req));
  const pubM = req.method === 'GET' && pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})$/);
  if (pubM) { const d = pubFull(pubM[1]); return d ? sendPage(res, pubPage(req, d)) : send(res, 404, 'Bilan non publié'); }
  // Pages de contenu : agenda, arrêtés, villes, droits, legal teams (HTML léger fabriqué par le serveur, sans script)
  if (req.method === 'GET') {
    const pg = { '/agenda': agendaPage, '/arretes': ordersPage, '/droits': rightsPage, '/legal-teams': legalTeamsPage, '/villes': citiesPage }[pathname.replace(/\/$/, '')];
    if (pg) return sendPage(res, pg(req));
    const vm = pathname.match(/^\/ville\/([a-z0-9-]{1,60})\/?$/);
    if (vm) { const c = cityIndex().get(vm[1]); return c ? sendPage(res, cityPage(req, c)) : send(res, 404, 'Ville inconnue'); }
    const dm = pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/donnees\.csv$/);
    if (dm) {
      const d = pubFull(dm[1]);
      if (!d || !d.pts) return send(res, 404, 'Données indisponibles');
      if (!tx(() => bump('csv:' + clientHash(req), 'vote', 30, Date.now()))) return send(res, 429, 'Trop de demandes : réessaie dans quelques minutes.');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cortege-${d.date}.csv"`, 'Cache-Control': 'public, max-age=600' });
      return res.end(pubCsv(d));
    }
    const cm = pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/([a-z0-9-]{1,64})$/);
    if (cm && cm[2] !== 'carte') {
      const d = pubFull(cm[1]), c = d && (d.cityPages || []).find(x => x.slug === cm[2]);
      if (c) return sendPage(res, cityDayPage(req, d, c));
    }
  }
  // Carte d'un créneau, ouverte à tous pour les bilans publiés : la page et ses points (l'image est fabriquée dans le navigateur)
  const pubC = req.method === 'GET' && pathname.match(/^\/manif\/(\d{4}-\d{2}-\d{2})\/(carte|points\.json)$/);
  if (pubC) {
    if (!getPub(pubC[1])) return send(res, 404, pubC[2] === 'carte' ? 'Bilan non publié' : { error: 'Bilan non publié.' });
    if (pubC[2] === 'carte') return serveStatic(req, res, '/creneau.html');
    if (!tx(() => bump('pts:' + clientHash(req), 'vote', 150, Date.now()))) return send(res, 429, { error: 'Trop de demandes : réessaie dans quelques minutes.' }, { 'Retry-After': '120' });
    const d = pubWithPts(pubC[1]);
    if (!d.pts) return send(res, 404, { error: 'Les points de cette journée ne sont plus disponibles.' });
    const body = JSON.stringify({ date: d.date, ps: d.ptsS || 1e3, pts: d.pts, cats: CATEGORIES.map(c => ({ id: c.id, label: c.label, group: c.group })) });
    const etag = '"' + h8(body) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120', ETag: etag }); return res.end(body);
  }
  if (req.method === 'POST' && pathname === '/api/orga-requests') {
    if (!tx(() => bump('oreq:' + clientHash(req), 'report', 3, Date.now()))) return send(res, 429, { error: 'Trop de demandes d’un coup. Réessaie plus tard.' });
    return send(res, ...orgaRequest(await readJson(req)));
  }
  const vt = PMTILES && req.method === 'GET' && pathname.match(/^\/vt\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.mvt$/);
  if (vt) return serveVectorTile(req, res, +vt[1], +vt[2], +vt[3]);
  return NEXT;
}

module.exports = { pagesRoutes };
