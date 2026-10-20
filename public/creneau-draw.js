'use strict';
// Carte d'un créneau : image PNG des signalements actifs pendant un créneau, autour d'un lieu.
// Tout est dessiné dans le navigateur (aucun calcul sur le serveur). Partagé par l'admin et les pages publiques des manifs.
(() => {
const SLOT_COL = { fdo: '#e5484d', danger: '#f5a524', soutien: '#30a46c', info: '#8e8cd8' };
const SLOT_FAM = { fdo: 'Forces de l’ordre', danger: 'Danger', soutien: 'Soutien', info: 'Infos cortège' };
const hm = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const hmFr = t => hm(t).replace(':', ' h ');
async function slotGeocode(q) {
  const m = q.match(/^\s*(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)\s*$/);
  if (m) return { lat: +m[1], lng: +m[2], name: null };
  const res = await fetch('/api/geocode?q=' + encodeURIComponent(q)); const out = await res.json().catch(() => []);
  if (!res.ok || !out.length) throw new Error(out.error || 'Lieu introuvable : essaie une autre adresse, ou « latitude, longitude ».');
  return { lat: out[0].lat, lng: out[0].lng, name: out[0].name };
}
// rows : [{ t, end, lat, lng, cat: { label, group }, up, v, status? }] ; garde ceux actifs pendant le créneau, à moins de R m
// Bornes du créneau en vraies heures (heure de Paris) : un signalement qui déborde sur le lendemain reste compté
function parisMs(date, hhmm) {
  const noon = Date.parse(date + 'T12:00:00Z'), h = +new Date(noon).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false });
  return Date.parse(date + 'T' + hhmm + ':00Z') - (h - 12) * 3600e3;
}
function slotSelect(rows, c, R, from, to, date) {
  const k = Math.cos(c.lat * Math.PI / 180);
  const inSlot = date ? (a => r => r.t <= a[1] && r.end >= a[0])([parisMs(date, from), parisMs(date, to) + 59999])
    : r => hm(r.t) <= to && hm(r.end) >= from;
  return rows.map(r => ({ ...r, dist: Math.hypot((r.lat - c.lat) * 111320, (r.lng - c.lng) * 111320 * k) }))
    .filter(r => r.cat && r.dist <= R && inSlot(r))
    .sort((a, b) => a.t - b.t);
}
function slotTile(z, x, y) {
  return new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `/tiles/${z}/${x}/${y}.png`; });
}
// Fond de carte de Cortège (tuiles vectorielles du serveur, même style que l'appli), dessiné hors écran puis recopié
let slotCfg = null;
async function slotVector(c, mPerPx, W, H) {
  slotCfg = slotCfg || await fetch('/api/config').then(r => r.json()).catch(() => ({}));
  if (!slotCfg.vector || !window.protomapsL || !window.cortegeVectorLayer) return null;
  await window.cortegeMapFonts?.();
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-${W + 200}px;top:0;width:${W}px;height:${H}px;background:#141519`;
  document.body.append(box);
  const z = Math.log2(156543.03 * Math.cos(c.lat * Math.PI / 180) / mPerPx);
  const map = L.map(box, { zoomControl: false, attributionControl: false, zoomSnap: 0, fadeAnimation: false, zoomAnimation: false, inertia: false }).setView([c.lat, c.lng], z, { animate: false });
  const vl = window.cortegeVectorLayer(window.protomapsL, { url: slotCfg.vector.url, lang: 'fr', maxDataZoom: slotCfg.vector.maxzoom, maxZoom: 20 });
  await new Promise(ok => { vl.once('load', ok); vl.addTo(map); setTimeout(ok, 12000); });
  await new Promise(ok => setTimeout(ok, 600)); // derniers dessins (noms de rues)
  const base = box.getBoundingClientRect(), out = [];
  for (const t of box.querySelectorAll('canvas.leaflet-tile, .leaflet-tile canvas, canvas')) {
    const r = t.getBoundingClientRect(); if (!r.width || !t.width || !t.height) continue;
    const copy = document.createElement('canvas'); copy.width = t.width; copy.height = t.height; copy.getContext('2d').drawImage(t, 0, 0); // copie avant de fermer la carte
    out.push([copy, r.left - base.left, r.top - base.top, r.width, r.height]);
  }
  map.remove(); box.remove();
  return out.length ? out : null;
}
async function slotDraw(cv, { date, c, R, from, to, rows, brand = {}, more = 'voir le fichier CSV' }) {
  const W = 1600, MH = 1500, TOP = 130, lines = Math.min(rows.length, 24), cols = rows.length > 8 ? 2 : 1;
  const listH = 70 + 34 * (Math.ceil(lines / cols) + 1) + (rows.length > lines ? 34 : 0) + 110;
  cv.width = W; cv.height = TOP + MH + listH;
  const g = cv.getContext('2d');
  // Échelle : le cercle du rayon tient dans la carte, tuiles du zoom juste au-dessus (réduites, donc nettes)
  const want = 2 * R * 1.25 / MH, base = 156543.03 * Math.cos(c.lat * Math.PI / 180);
  const Z = Math.min(18, Math.max(10, Math.ceil(Math.log2(base / want)))), K = base / 2 ** Z / want, T = 256 * K, mPerPx = want;
  const world = (lat, lng) => { const s = T * 2 ** Z, r = lat * Math.PI / 180; return [(lng + 180) / 360 * s, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s]; };
  const [cx, cy] = world(c.lat, c.lng), ox = cx - W / 2, oy = cy - MH / 2;
  const px = (lat, lng) => { const [x, y] = world(lat, lng); return [x - ox, y - oy + TOP]; };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.fillStyle = '#121214'; g.fillRect(0, 0, W, cv.height);
  g.fillStyle = '#141519'; g.fillRect(0, TOP, W, MH);
  const vec = await slotVector(c, mPerPx, W, MH).catch(() => null);
  const jobs = [];
  if (!vec) for (let x = Math.floor(ox / T); x <= Math.floor((ox + W) / T); x++) for (let y = Math.floor(oy / T); y <= Math.floor((oy + MH) / T); y++) jobs.push(slotTile(Z, x, y).then(im => im && [im, x, y]));
  const tiles = (await Promise.all(jobs)).filter(Boolean);
  g.save(); g.beginPath(); g.rect(0, TOP, W, MH); g.clip();
  if (vec) for (const [el, x, y, w, h] of vec) g.drawImage(el, x, y + TOP, w, h);
  else { g.fillStyle = '#e8e6e1'; g.fillRect(0, TOP, W, MH); for (const [im, x, y] of tiles) g.drawImage(im, x * T - ox, y * T - oy + TOP, T + 0.5, T + 0.5); g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, TOP, W, MH); }
  const [rx, ry] = px(c.lat, c.lng);
  // Points regroupés par position (archive arrondie à ~100 m)
  const groups = new Map();
  rows.forEach((r, i) => { r.n = i + 1; const k = r.lat + ',' + r.lng; if (!groups.has(k)) groups.set(k, { lat: r.lat, lng: r.lng, rows: [] }); groups.get(k).rows.push(r); });
  const G = [...groups.values()].map(gr => { const [x, y] = px(gr.lat, gr.lng); return { ...gr, x, y, col: SLOT_COL[gr.rows[0].cat.group] || '#888' }; });
  const useLabels = G.length <= 12, MR = useLabels ? 15 : 21;
  // Placement des étiquettes : ni sur un point, ni sur l'étoile, ni sur une autre étiquette, ni sur un trait
  const obst = [{ x: rx - 28, y: ry - 28, w: 56, h: 56 }, ...G.map(p => ({ x: p.x - MR - 6, y: p.y - MR - 6, w: 2 * MR + 12, h: 2 * MR + 12 }))];
  const boxes = [], segs = [];
  const hit = (a, b, m = 10) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
  const anchor = (p, b) => [Math.min(Math.max(p.x, b.x), b.x + b.w), Math.min(Math.max(p.y, b.y), b.y + b.h)];
  const segHits = (x1, y1, x2, y2, b) => { for (let t = 0.12; t < 0.95; t += 0.08) { const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; if (x > b.x - 4 && x < b.x + b.w + 4 && y > b.y - 4 && y < b.y + b.h + 4) return true; } return false; };
  if (useLabels) for (const p of G.sort((a, b) => a.y - b.y)) {
    p.L1 = p.rows.map(r => `${hmFr(r.t)} · ${r.cat.label}`);
    p.L2 = p.rows.map(r => `jusqu’à ${hmFr(r.end)}` + (r.up ? ` · ${r.up} confirmation${r.up > 1 ? 's' : ''}` : '') + (r.v ? ' · vérifié' : '') + (r.status ? ' · ' + r.status : ''));
    g.font = '700 23px system-ui, sans-serif'; const w1 = Math.max(...p.L1.map(t => g.measureText(t).width));
    g.font = '500 18px system-ui, sans-serif'; const w2 = Math.max(...p.L2.map(t => g.measureText(t).width));
    const w = Math.max(w1, w2) + 28, h = p.L1.length * 54 + 10;
    let best = null, bestScore = Infinity;
    for (const d of [40, 80, 130, 190, 260, 340]) {
      for (const [dx, dy] of [[d, -h / 2], [-d - w, -h / 2], [-w / 2, -d - h], [-w / 2, d], [d, -d - h], [-d - w, -d - h], [d, d], [-d - w, d]]) {
        const b = { x: p.x + dx, y: p.y + dy, w, h };
        if (b.x < 8 || b.x + w > W - 8 || b.y < TOP + 8 || b.y + h > TOP + MH - 70) continue;
        if (obst.some(o => !(o.x === p.x - MR - 6 && o.y === p.y - MR - 6) && hit(b, o, 4)) || boxes.some(o => hit(b, o))) continue;
        const [ax, ay] = anchor(p, b);
        if (boxes.some(o => segHits(p.x, p.y, ax, ay, o)) || segs.some(([x1, y1, x2, y2]) => segHits(x1, y1, x2, y2, b))) continue;
        const score = Math.hypot(ax - p.x, ay - p.y); if (score < bestScore) { best = b; bestScore = score; }
      }
      if (best) break;
    }
    if (!best) best = { x: Math.min(Math.max(p.x + 40, 8), W - w - 8), y: Math.min(Math.max(p.y - h / 2, TOP + 8), TOP + MH - h - 70), w, h };
    p.box = best; boxes.push(best); segs.push([p.x, p.y, ...anchor(p, best)]);
  }
  // Traits, puis étiquettes, puis points (toujours au-dessus)
  for (const p of G) if (p.box) { const [ax, ay] = anchor(p, p.box); g.strokeStyle = '#f2f1f4'; g.lineWidth = 3; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(ax, ay); g.stroke(); }
  for (const p of G) if (p.box) {
    const b = p.box; g.fillStyle = 'rgba(255,255,255,.97)'; g.strokeStyle = p.col; g.lineWidth = 4; rr(b.x, b.y, b.w, b.h, 10); g.fill(); g.stroke();
    p.L1.forEach((t, i) => { g.fillStyle = '#17121f'; g.font = '700 23px system-ui, sans-serif'; g.fillText(t, b.x + 14, b.y + 32 + i * 54);
      g.fillStyle = '#55535f'; g.font = '500 18px system-ui, sans-serif'; g.fillText(p.L2[i], b.x + 14, b.y + 54 + i * 54); });
  }
  for (const p of G) {
    // Rond vide : tous les signalements de cet endroit ont été retirés ou contestés
    const gone = p.rows.every(r => r.status);
    g.fillStyle = gone ? '#141519' : p.col; g.strokeStyle = gone ? p.col : '#fff'; g.lineWidth = gone ? 5 : 4; g.beginPath(); g.arc(p.x, p.y, useLabels ? 13 : 19, 0, 2 * Math.PI); g.fill(); g.stroke();
    if (!useLabels) { g.fillStyle = '#fff'; g.font = '800 17px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(p.rows.map(r => r.n).slice(0, 2).join(',') + (p.rows.length > 2 ? '…' : ''), p.x, p.y + 6); g.textAlign = 'left'; }
  }
  // Lieu (étoile), au-dessus de tout
  g.fillStyle = '#5b66c4'; g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 9 : 22; g.lineTo(rx + r * Math.cos(a), ry + r * Math.sin(a)); } g.closePath(); g.stroke(); g.fill();
  g.restore();
  // Échelle
  const step = [50, 100, 200, 250, 500, 1000, 2000].find(v => v / mPerPx > 120) || 2000, sl = step / mPerPx, sx = 40, sy = TOP + MH - 36;
  g.fillStyle = 'rgba(255,255,255,.9)'; rr(sx - 14, sy - 34, sl + 28, 50, 8); g.fill();
  g.strokeStyle = '#17121f'; g.lineWidth = 4; g.beginPath(); g.moveTo(sx, sy - 6); g.lineTo(sx, sy); g.lineTo(sx + sl, sy); g.lineTo(sx + sl, sy - 6); g.stroke();
  g.fillStyle = '#17121f'; g.font = '600 20px system-ui, sans-serif'; g.fillText(step >= 1000 ? step / 1000 + ' km' : step + ' m', sx, sy - 12);
  // Titre
  const day = new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Logo, site de l'appli et compte Instagram, à droite du titre
  let right = W - 40;
  const logo = await new Promise(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = '/brand/logo.png'; });
  if (logo) { g.drawImage(logo, right - 92, 19, 92, 92); right -= 112; }
  g.textAlign = 'right';
  g.fillStyle = '#f2f1f4'; g.font = '700 26px system-ui, sans-serif'; g.fillText(location.host, right, 58);
  if (brand.handle) { g.fillStyle = '#ec9fa4'; g.font = '600 24px system-ui, sans-serif'; g.fillText('Instagram @' + brand.handle, right, 98); }
  g.textAlign = 'left';
  const maxW = right - 40 - Math.max(g.measureText(location.host).width, 260) - 30;
  const fitTxt = (t, f) => { g.font = f; if (g.measureText(t).width <= maxW) return t; while (t.length > 4 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; };
  g.fillStyle = '#f2f1f4'; g.fillText(fitTxt('Signalements Cortège · ' + day, '800 38px system-ui, sans-serif'), 40, 58);
  g.fillStyle = '#ec9fa4';
  g.fillText(fitTxt(`Actifs entre ${from.replace(':', ' h ')} et ${to.replace(':', ' h ')} · ${R} m autour de ${c.label}`, '600 24px system-ui, sans-serif'), 40, 100);
  // Chronologie
  let y = TOP + MH + 52;
  g.fillStyle = '#f2f1f4'; g.font = '700 26px system-ui, sans-serif'; g.fillText(rows.length ? 'Chronologie (début · type · fin)' : 'Aucun signalement sur ce créneau dans cette zone.', 40, y);
  let lx = W - 40; g.font = '600 20px system-ui, sans-serif';
  for (const f of [...new Set(rows.map(r => r.cat.group))].reverse()) { const t = SLOT_FAM[f] || f, w = g.measureText(t).width; lx -= w; g.fillStyle = '#f2f1f4'; g.fillText(t, lx, y); lx -= 26; g.fillStyle = SLOT_COL[f]; g.beginPath(); g.arc(lx + 10, y - 7, 9, 0, 2 * Math.PI); g.fill(); lx -= 24; }
  y += 18; g.font = '500 22px system-ui, sans-serif';
  const per = Math.ceil(lines / cols), cw = (W - 80) / cols;
  rows.slice(0, lines).forEach((r, k) => {
    const xx = 40 + Math.floor(k / per) * cw, yy = y + 34 * (k % per + 1);
    const cc = SLOT_COL[r.cat.group] || '#888'; g.beginPath(); g.arc(xx + 9, yy - 8, 8, 0, 2 * Math.PI);
    if (r.status) { g.strokeStyle = cc; g.lineWidth = 3; g.stroke(); } else { g.fillStyle = cc; g.fill(); }
    g.fillStyle = '#f2f1f4'; g.fillText(`${useLabels ? '' : r.n + '. '}${hmFr(r.t)}  ${r.cat.label}${r.up ? ` (${r.up} conf.)` : ''}${r.v ? ' ✓' : ''}`, xx + 28, yy);
    if (r.status) { const w0 = g.measureText(`${useLabels ? '' : r.n + '. '}${hmFr(r.t)}  ${r.cat.label}${r.up ? ` (${r.up} conf.)` : ''}${r.v ? ' ✓' : ''}`).width; g.fillStyle = '#f5a524'; g.font = '500 18px system-ui, sans-serif'; g.fillText(' · ' + (cols > 1 ? r.status.replace(/ \(.*\)| par .*/, '') : r.status), xx + 28 + w0, yy); g.font = '500 22px system-ui, sans-serif'; }
    g.fillStyle = '#a3a1ad'; const e = `→ ${hmFr(r.end)}`; g.fillText(e, xx + cw - 30 - g.measureText(e).width, yy);
  });
  y += 34 * (per + 1);
  if (rows.length > lines) { g.fillStyle = '#a3a1ad'; g.fillText(`… et ${rows.length - lines} autres (${more})`, 40, y); y += 34; }
  g.font = '500 19px system-ui, sans-serif'; g.fillStyle = '#a3a1ad';
  [`Signalements faits par des participant·es sur l’appli Cortège ; ${rows.some(r => r.v) ? '✓ = vérifié par une orga ; les autres ne sont pas vérifiés' : 'aucun n’a été vérifié par une orga'} : à recouper.`,
   rows.some(r => r.status) ? 'Rond vide : signalement retiré ou contesté (la mention précise par qui) ; il reste affiché. Positions arrondies à ~100 m. Fin = disparition de la carte.' : 'Positions arrondies à environ 100 m. Fin = moment où le signalement a disparu de la carte.',
   `Étoile : le lieu demandé ; signalements à moins de ${R} m. Fond de carte © les contributeur·ices d’OpenStreetMap (ODbL)${slotCfg && slotCfg.vector ? ', Protomaps' : ''}.`].forEach((t, i) => g.fillText(t, 40, y + 4 + i * 28));
  return vec ? vec.length : tiles.length;
}
window.cortegeCreneau = { select: slotSelect, parisMs, draw: slotDraw, geocode: slotGeocode, COL: SLOT_COL, FAM: SLOT_FAM, hm };
})();
