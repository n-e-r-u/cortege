'use strict';
// ---- Veille : repérage automatique des pages utiles d'un site de préfecture ----
// Les sites des préfectures (www.<département>.gouv.fr) partagent le même moteur, mais pas la même arborescence :
// recueil des actes administratifs (RAA) rangé par année, parfois par mois ; communiqués de presse par année, parfois par mois.
// À partir de l'accueil, on suit les liens du site dont le titre parle de RAA ou de communiqués, puis l'année et le mois en cours
// (et le mois précédent, les premiers jours). Refait chaque jour : les pages du nouveau mois sont prises dès qu'elles existent.
// Fonction pure (le lecteur de pages est fourni), pour pouvoir la tester sans réseau.
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const unent = s => String(s).replace(/&amp;/g, '&').replace(/&#0*39;|&apos;/g, '\'').replace(/&quot;/g, '"');
// Liens d'une page HTML, adresses absolues, même site seulement ; textes sans balises
function siteLinks(html, base) {
  const out = [], origin = new URL(base).origin;
  const body = String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(unent(m[2] ?? m[3] ?? ''), base); } catch { continue; }
    u.hash = '';
    if (u.origin !== origin) continue;
    const t = unent(m[4].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t.length >= 3) out.push({ t, u: u.href, p: decodeURIComponentSafe(u.pathname) });
  }
  return out;
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }
// Enfants d'une page (adresse plus longue qui la prolonge), qui parlent de l'année ou du mois voulus
const under = (links, parent) => { const p = new URL(parent).pathname.replace(/\/$/, ''); return links.filter(l => l.p !== p && l.p.toLowerCase().startsWith(p.toLowerCase() + '/')); };
function periods(now) {
  const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
  const out = [{ y: String(y), m: MOIS[m] }];
  if (d.getDate() <= 5) out.push(m ? { y: String(y), m: MOIS[m - 1] } : { y: String(y - 1), m: 'decembre' });
  return out;
}
const mentions = (l, re) => re.test(fold(l.t + ' ' + l.p));
// Descend depuis une rubrique (RAA ou communiqués) vers l'année puis le mois en cours ; garde chaque page traversée.
// Certains sites ajoutent un niveau (« RAA du département », à côté de « RAA de la région ») : on le suit s'il n'y a pas d'année.
const MID = /departement|prefecture|raa du|recueils? (du|de la prefecture)/;
async function descend(get, root, now) {
  const pages = new Set();
  let links; try { links = siteLinks(await get(root), root); } catch { return []; }
  pages.add(root);
  let base = root, list = links;
  const yearIn = (ls, b, y) => under(ls, b).find(l => mentions(l, new RegExp('\\b' + y + '\\b')));
  if (!yearIn(list, base, periods(now)[0].y)) {
    const mid = under(list, base).find(l => mentions(l, MID) && !/region/.test(fold(l.t)));
    if (mid) { try { list = siteLinks(await get(mid.u), mid.u); base = mid.u; pages.add(mid.u); } catch {} }
  }
  for (const { y, m } of periods(now)) {
    const yl = yearIn(list, base, y);
    if (!yl) continue;
    pages.add(yl.u);
    let yLinks; try { yLinks = siteLinks(await get(yl.u), yl.u); } catch { continue; }
    const ml = under(yLinks, yl.u).find(l => mentions(l, new RegExp('\\b' + m + '\\b')));
    if (ml) pages.add(ml.u);
  }
  return [...pages];
}
// Pages à surveiller pour un site de préfecture : accueil, actualités, communiqués (année, mois), RAA (année, mois)
async function discoverPref(get, origin, now = Date.now()) {
  const home = origin.replace(/\/+$/, '') + '/';
  const links = siteLinks(await get(home), home);
  const find = (re, pathRe) => links.find(l => re.test(fold(l.t))) || (pathRe && links.find(l => pathRe.test(l.p)));
  const out = [{ url: home, kind: 'news' }];
  const add = (url, kind) => { if (url && !out.some(x => x.url === url)) out.push({ url, kind }); };
  // Actualités : la rubrique « Infos » ou « Actualités » (liste d'articles)
  const news = links.find(l => /\/actualites\/infos\/?$/i.test(l.p)) || find(/^(toutes les )?actualites$/, /\/actualites\/?$/i);
  if (news) add(news.u, 'news');
  // Communiqués de presse
  const cp = find(/communiques? de presse/, /communiques?-de-presse/i);
  if (cp) for (const u of await descend(get, cp.u, now)) add(u, 'news');
  // Recueil des actes administratifs
  const raa = find(/recueils? (des|de) actes administratifs|^raa$|^recueils? des actes/, /recueil-des-actes|\/raa\b/i);
  if (raa) for (const u of await descend(get, raa.u, now)) add(u, 'raa');
  return out;
}
module.exports = { discoverPref, siteLinks, periods, MOIS };
