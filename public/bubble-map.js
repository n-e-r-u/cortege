'use strict';
// Carte de France des signalements par ville (bilans publics et stories) : cercles et étiquettes lisibles.
// 1. Les communes très proches (un cercle posé sur un autre) sont regroupées sous le nom de la plus active.
// 2. Taille des cercles relative à la ville la plus active, plafonnée : un gros cercle ne recouvre plus ses voisines.
// 3. Étiquettes placées autour de leur cercle (8 positions essayées), sans chevaucher une autre étiquette ni un autre cercle ;
//    s'il n'y a pas de place, pas d'étiquette (le détail est dans la liste sous la carte).
// Utilisé par le serveur (require) et par le navigateur de l'admin (window.BubbleMap).
(function (root) {
  function projector(m) {
    const rad = Math.PI / 180, p0 = 44 * rad, p1 = 49 * rad, tany = y => Math.tan((Math.PI / 2 + y) / 2);
    const n = Math.log(Math.cos(p0) / Math.cos(p1)) / Math.log(tany(p1) / tany(p0)), f = Math.cos(p0) * Math.pow(tany(p0), n) / n;
    return (lon, lat) => { const x = (lon - 3) * rad, r = f / Math.pow(tany(lat * rad), n); return [r * Math.sin(n * x) * m.k + m.t[0], m.t[1] - (f - r * Math.cos(n * x)) * m.k]; };
  }
  const escD = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function layout(cities, m, o = {}) {
    const P = projector(m), maxR = o.maxR || 30, minR = o.minR || 5;
    const pts = cities.filter(c => c.n > 0 && Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map(c => { const [x, y] = P(c.lng, c.lat); return { name: c.name, n: c.n, x, y, k: 1, lat: c.lat, lng: c.lng }; })
      .filter(p => p.x > 0 && p.x < m.w && p.y > 0 && p.y < m.h)
      .sort((a, b) => b.n - a.n);
    if (!pts.length) return [];
    let top = pts[0].n;
    const rad = n => minR + (maxR - minR) * Math.sqrt(Math.min(1, n / top));
    // Distance réelle : on ne regroupe que des communes d'une même agglomération (Nîmes ne rejoint jamais Montpellier)
    const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180));
    // Regroupement : une commune proche dont le centre tombe sur (ou tout contre) le cercle d'une plus active la rejoint
    const cl = [];
    for (const p of pts) {
      const near = cl.find(c => km(c, p) <= (o.groupKm || 15) && Math.hypot(c.x - p.x, c.y - p.y) < rad(c.n) + rad(p.n) * 0.5 + 3);
      if (near) { near.n += p.n; near.k++; } else cl.push({ ...p });
    }
    // Puis les cercles qui se recouvrent nettement fusionnent, jusqu'à ce que tout soit lisible
    for (let changed = true; changed;) {
      changed = false;
      top = Math.max(...cl.map(c => c.n));
      cl.sort((a, b) => b.n - a.n);
      outer: for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
        const a = cl[i], b = cl[j];
        if (km(a, b) <= (o.mergeKm || 25) && Math.hypot(a.x - b.x, a.y - b.y) < (rad(a.n) + rad(b.n)) * 0.72) { a.n += b.n; a.k += b.k; cl.splice(j, 1); changed = true; break outer; }
      }
    }
    top = Math.max(...cl.map(c => c.n));
    for (const c of cl) c.r = rad(c.n);
    return cl.sort((a, b) => b.n - a.n);
  }

  // Rectangle [x, y, w, h] qui touche un cercle ?
  const hitsCircle = (q, c, pad) => { const dx = c.x - Math.max(q[0], Math.min(c.x, q[0] + q[2])), dy = c.y - Math.max(q[1], Math.min(c.y, q[1] + q[3])); return dx * dx + dy * dy < (c.r + pad) * (c.r + pad); };
  const hitsRect = (q, p) => q[0] < p[0] + p[2] && q[0] + q[2] > p[0] && q[1] < p[1] + p[3] && q[1] + q[3] > p[1];

  // Contenu SVG (cercles puis étiquettes). o : fontSize, labels (nombre max), font, numFont, numFmt, esc
  function svg(cities, m, o = {}) {
    const esc = o.esc || escD, fmt = o.numFmt || String, fs = o.fontSize || 26, cw = o.charW || fs * 0.62, h = fs * 1.2;
    const cl = layout(cities, m, o);
    const dots = cl.map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.r.toFixed(1)}" fill="url(#gr)" fill-opacity=".8" stroke="#121214" stroke-width="2">`
      + `<title>${esc(c.name)}${c.k > 1 ? ' et ' + (c.k - 1) + ' commune' + (c.k > 2 ? 's' : '') + ' voisine' + (c.k > 2 ? 's' : '') : ''} : ${fmt(c.n)}</title></circle>`).join('');
    const placed = [], labels = [];
    // Les villes les plus actives ont toujours leur étiquette : si tout est pris, on s'éloigne un peu du cercle,
    // puis on accepte de passer au-dessus des petits cercles voisins (jamais d'une autre étiquette ni d'un plus gros cercle)
    const must = o.mustLabel || 5;
    for (const [rank, c] of cl.slice(0, o.labels || 12).entries()) {
      const txt = c.name + ' ' + fmt(c.n), w = txt.length * cw + 6;
      const spots = gap => { const g = c.r + gap, d = g * 0.72;
        return [[c.x + g, c.y - h / 2, 'start'], [c.x - g - w, c.y - h / 2, 'end'], [c.x - w / 2, c.y - g - h, 'middle'], [c.x - w / 2, c.y + g, 'middle'],
          [c.x + d, c.y - d - h, 'start'], [c.x - d - w, c.y - d - h, 'end'], [c.x + d, c.y + d, 'start'], [c.x - d - w, c.y + d, 'end']]; };
      const free = (bx, by, small) => { const q = [bx, by, w, h];
        return bx > 2 && by > 2 && bx + w < m.w - 2 && by + h < m.h - 2 && !placed.some(p => hitsRect(q, p))
          && !cl.some(o2 => o2 !== c && (!small || o2.r > c.r * 0.6) && hitsCircle(q, o2, 2)); };
      const tries = [[5, false]].concat(rank < must ? [[18, false], [5, true], [18, true]] : []);
      let ok = null;
      for (const [gap, small] of tries) { ok = spots(gap).find(([bx, by]) => free(bx, by, small)); if (ok) break; }
      if (!ok) continue;
      const [bx, by, anchor] = ok; placed.push([bx, by, w, h]);
      const tx = anchor === 'start' ? bx + 3 : anchor === 'end' ? bx + w - 3 : bx + w / 2;
      labels.push(`<text x="${tx.toFixed(1)}" y="${(by + fs * 0.92).toFixed(1)}" text-anchor="${anchor}"${o.font ? ` font-family="${o.font}"` : ''} font-weight="800" font-size="${fs}" fill="#f2f1f4" paint-order="stroke" stroke="#121214" stroke-width="${Math.round(fs / 4)}" stroke-linejoin="round">`
        + `${esc(c.name)} <tspan${o.numFont ? ` font-family="${o.numFont}"` : ''} fill="#ec9fa4">${esc(fmt(c.n))}</tspan></text>`);
    }
    return { dots, labels: labels.join(''), merged: cl.some(c => c.k > 1), count: cl.length };
  }

  const api = { projector, layout, svg };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BubbleMap = api;
})(typeof window !== 'undefined' ? window : this);
