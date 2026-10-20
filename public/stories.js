'use strict';
// Stories Instagram (1080 × 1920) à partir du digest d'une journée : tout est calculé et dessiné dans le navigateur
// de l'admin (HTML dans un SVG, puis image PNG). Aucune donnée ne part ailleurs. Photos facultatives, choisies sur l'appareil.
(() => {
  const W = 1080, H = 1920;
  const COL = { fdo: '#e5484d', danger: '#f5a524', soutien: '#30a46c', info: '#8e8cd8' };
  const FAM = { fdo: 'Forces de l’ordre', danger: 'Danger', info: 'Info', soutien: 'Soutien' };
  const REMOVED = new Set(['cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old']);
  const nf = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hh = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  const hourOf = t => +new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }) % 24;
  const longDay = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const toDataUrl = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  const fetchData = async url => toDataUrl(await (await fetch(url)).blob());
  const loadImg = src => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });

  // Photo plein écran, recadrée en 9:16, avec le bas flouté (le texte s'y pose, et les visages y deviennent illisibles)
  async function photoBg(file, blurFrom = 0.58) {
    const img = await loadImg(await toDataUrl(file));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), s = Math.max(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s, dx = (W - dw) / 2, dy = (H - dh) / 2;
    x.drawImage(img, dx, dy, dw, dh);
    const b = document.createElement('canvas'); b.width = W; b.height = H;
    const bx = b.getContext('2d'); bx.filter = 'blur(28px)'; bx.drawImage(img, dx - 40, dy - 40, dw + 80, dh + 80);
    const g = x.createLinearGradient(0, H * blurFrom, 0, H * (blurFrom + 0.12));
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mx = m.getContext('2d'); mx.drawImage(b, 0, 0); mx.globalCompositeOperation = 'destination-in';
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); mx.fillStyle = g; mx.fillRect(0, 0, W, H);
    x.drawImage(m, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }

  let assets = null;
  async function loadAssets() {
    if (assets) return assets;
    const f = n => fetchData('/vendor/fonts/' + n + '.woff2');
    const [i4, i7, i8, i9, mono, logo, map] = await Promise.all([f('inter-400'), f('inter-700'), f('inter-800'), f('inter-900'), f('jetbrains-mono-700'),
      fetchData('/brand/logo.png').catch(() => ''), fetch('/story-map.json').then(r => r.json())]);
    assets = { logo, map, css: `
@font-face { font-family: Inter; font-weight: 400; src: url(${i4}); } @font-face { font-family: Inter; font-weight: 700; src: url(${i7}); }
@font-face { font-family: Inter; font-weight: 800; src: url(${i8}); } @font-face { font-family: Inter; font-weight: 900; src: url(${i9}); }
@font-face { font-family: Mono; font-weight: 700; src: url(${mono}); }` };
    return assets;
  }

  const CSS = `
* { box-sizing: border-box; margin: 0; }
.root { width: ${W}px; height: ${H}px; overflow: hidden; position: relative; background: #121214; color: #f2f1f4; font-family: Inter, sans-serif; }
.bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
.shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(18,18,20,.55) 0%, rgba(18,18,20,0) 22%, rgba(18,18,20,0) 45%, rgba(18,18,20,.88) 66%, #121214 100%); }
.page { position: absolute; inset: 0; padding: 230px 80px 260px; display: flex; flex-direction: column; }
.kicker { font-size: 30px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #ec9fa4; }
h2 { font-size: 64px; line-height: 1.05; font-weight: 900; letter-spacing: -.02em; margin-top: 14px; }
.sub { font-size: 34px; line-height: 1.3; color: #c9c7d1; margin-top: 18px; }
.big { font-weight: 900; font-size: 210px; line-height: .9; letter-spacing: -.04em; color: #ec9fa4; }
.foot { position: absolute; left: 80px; right: 80px; bottom: 150px; display: flex; align-items: center; justify-content: space-between; font-size: 28px; color: #a3a1ad; }
.brand { display: flex; align-items: center; gap: 16px; color: #f2f1f4; font-weight: 800; font-size: 30px; }
.brand img { width: 58px; height: 58px; border-radius: 12px; }
.num { font-family: Mono, monospace; }
.legend { display: flex; flex-wrap: wrap; gap: 14px 30px; margin-top: 22px; font-size: 27px; }
.legend span { display: inline-flex; align-items: center; gap: 12px; }
.legend i { width: 22px; height: 22px; border-radius: 50%; display: inline-block; }
.legend b { font-family: Mono, monospace; }
.note { font-size: 25px; color: #a3a1ad; line-height: 1.35; margin-top: 22px; }
.row { display: grid; align-items: center; gap: 18px; }
.bar { border-radius: 6px; display: block; }
.stat { padding: 34px 0; border-top: 2px solid #34343c; }
.stat .num { font-size: 110px; line-height: 1; }
.stat div + div { font-size: 34px; line-height: 1.3; margin-top: 12px; }
.link { margin-top: 40px; height: 120px; border: 3px dashed rgba(242,241,244,.35); border-radius: 22px; display: flex; align-items: center; justify-content: center; font-size: 30px; color: #a3a1ad; }`;

  // Projection conique conforme (identique à celle qui a servi à dessiner le fond de carte)
  function projector(m) {
    const rad = Math.PI / 180, p0 = 44 * rad, p1 = 49 * rad, tany = y => Math.tan((Math.PI / 2 + y) / 2);
    const n = Math.log(Math.cos(p0) / Math.cos(p1)) / Math.log(tany(p1) / tany(p0)), f = Math.cos(p0) * Math.pow(tany(p0), n) / n;
    return (lon, lat) => { const x = (lon - 3) * rad, r = f / Math.pow(tany(lat * rad), n); return [r * Math.sin(n * x) * m.k + m.t[0], m.t[1] - (f - r * Math.cos(n * x)) * m.k]; };
  }

  function stats(d) {
    const cat = Object.fromEntries(d.categories.map(c => [c.id, c]));
    const rows = d.rows.filter(r => cat[r.c]);
    const byCat = {}, fam = { fdo: 0, danger: 0, info: 0, soutien: 0 }, hours = Array(24).fill(0), cities = {};
    for (const r of rows) {
      byCat[r.c] = (byCat[r.c] || 0) + 1; fam[cat[r.c].group]++; hours[hourOf(r.t)]++;
      const z = d.zones[r.z]; const name = z ? z.name : r.z;
      (cities[name] ||= { name, n: 0, lat: 0, lng: 0 }); cities[name].n++; cities[name].lat += r.lat; cities[name].lng += r.lng;
    }
    const cats = Object.entries(byCat).map(([id, n]) => ({ label: cat[id].label, group: cat[id].group, n })).sort((a, b) => b.n - a.n);
    const city = Object.values(cities).map(c => ({ ...c, lat: c.lat / c.n, lng: c.lng / c.n })).sort((a, b) => b.n - a.n);
    const ts = rows.map(r => r.t);
    return { total: rows.length, cats, fam, hours, city, first: Math.min(...ts), last: Math.max(...ts),
      confirmed: rows.filter(r => r.up > 0).length, confs: rows.reduce((s, r) => s + (r.up || 0), 0),
      verified: rows.filter(r => r.v).length, removed: rows.filter(r => REMOVED.has(r.o)).length };
  }

  function pages(d, s, a, photos, brand) {
    const foot = i => `<div class="foot"><span class="brand">${a.logo ? `<img src="${a.logo}"/>` : ''}Cortège${brand ? ' · @' + esc(brand) : ''}</span><span class="num">${i}/7</span></div>`;
    const out = [];
    // 1. Couverture
    out.push(`${photos.cover ? `<div class="bg" style="background-image:url(${photos.cover})"></div><div class="shade"></div>` : ''}
<div class="page" style="justify-content:flex-end"><div class="kicker">${esc(longDay(d.date))}</div>
<div class="big" style="margin-top:22px">${nf(s.total)}</div><h2 style="margin-top:6px">signalement${s.total > 1 ? 's' : ''}</h2>
<p class="sub">envoyés par des manifestant·es sur Cortège, dans ${s.city.length} ville${s.city.length > 1 ? 's' : ''}, de ${hh(s.first)} à ${hh(s.last)}.</p></div>${foot(1)}`);
    // 2. Carte
    const m = a.map, P = projector(m), R = n => 4 + Math.sqrt(n) * 3.3;
    const dots = s.city.map(c => { const [x, y] = P(c.lng, c.lat); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R(c.n).toFixed(1)}" fill="url(#gr)" fill-opacity=".78" stroke="#121214" stroke-width="2"/>`; }).join('');
    // Étiquettes des grandes villes : on essaie à droite, à gauche, au-dessus puis en dessous, sans chevaucher les autres
    const placed = [], labels = [];
    for (const c of s.city.slice(0, 10)) {
      const [x, y] = P(c.lng, c.lat), r = R(c.n) + 10, w = (c.name.length + String(c.n).length + 1) * 16.5, h = 34;
      const opts = [[x + r, y - h / 2, 'start'], [x - r - w, y - h / 2, 'end'], [x - w / 2, y - r - h, 'middle'], [x - w / 2, y + r, 'middle']];
      const ok = opts.find(([bx, by]) => bx > 0 && by > 0 && bx + w < m.w && by + h < m.h && !placed.some(q => bx < q[0] + q[2] && bx + w > q[0] && by < q[1] + q[3] && by + h > q[1]));
      if (!ok) continue;
      const [bx, by, anchor] = ok; placed.push([bx, by, w, h]);
      const tx = anchor === 'start' ? bx : anchor === 'end' ? bx + w : bx + w / 2;
      labels.push(`<text x="${tx.toFixed(1)}" y="${(by + 26).toFixed(1)}" text-anchor="${anchor}" font-family="Inter" font-weight="800" font-size="29" fill="#f2f1f4" paint-order="stroke" stroke="#121214" stroke-width="7">${esc(c.name)} <tspan font-family="Mono" fill="#ec9fa4">${nf(c.n)}</tspan></text>`);
    }
    out.push(`<div class="page"><div class="kicker">Où ?</div><h2>Signalements par ville</h2>
<p class="sub">Plus le cercle est grand, plus il y a de signalements. ${s.city.length} ville${s.city.length > 1 ? 's' : ''} en tout.</p>
<svg xmlns="http://www.w3.org/2000/svg" width="${m.w}" height="${m.h}" viewBox="0 0 ${m.w} ${m.h}" style="margin-top:34px">
<defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec9fa4"/><stop offset="1" stop-color="#7d86dc"/></linearGradient><clipPath id="c"><rect width="${m.w}" height="${m.h}"/></clipPath></defs>
<g clip-path="url(#c)">${m.near.map(p => `<path d="${p}" fill="#1c1c20" stroke="#34343c" stroke-width="1.5"/>`).join('')}<path d="${m.fr}" fill="#26262c" stroke="#5a5866" stroke-width="2"/>${dots}${labels.join('')}</g></svg></div>${foot(2)}`);
    // 3. Par type
    const maxC = s.cats[0]?.n || 1, rh = s.cats.length > 16 ? 58 : 66;
    out.push(`<div class="page"><div class="kicker">Quoi ?</div><h2>Les ${nf(s.total)} signalements, par type</h2>
<div class="legend">${['fdo', 'danger', 'info', 'soutien'].filter(f => s.fam[f]).map(f => `<span><i style="background:${COL[f]}"></i>${FAM[f]} <b>${nf(s.fam[f])}</b></span>`).join('')}</div>
<div style="margin-top:28px">${s.cats.slice(0, 20).map(c => `<div class="row" style="grid-template-columns:380px 1fr 92px;height:${rh}px"><span style="font-size:27px;font-weight:700;line-height:1.1">${esc(c.label)}</span>
<span class="bar" style="height:30px;background:${COL[c.group]};width:${Math.max(1.2, c.n / maxC * 100)}%"></span><span class="num" style="font-size:30px;text-align:right">${nf(c.n)}</span></div>`).join('')}</div></div>${foot(3)}`);
    // 4. Heure par heure
    const maxH = Math.max(...s.hours), peak = s.hours.indexOf(maxH), BH = 980;
    out.push(`<div class="page"><div class="kicker">Quand ?</div><h2>Signalements par heure</h2>
<p class="sub">Premier à ${hh(s.first)}, dernier à ${hh(s.last)}. Le plus d’envois : entre ${peak} h et ${(peak + 1) % 24} h (${maxH}).</p>
<div style="display:flex;gap:7px;margin-top:70px;border-bottom:2px solid #5a5866">${s.hours.map((n, i) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:${BH}px">
${i === peak ? `<span class="num" style="font-size:28px;margin-bottom:10px;color:#ec9fa4">${n}</span>` : ''}<div style="width:100%;height:${n / maxH * (BH - 60)}px;min-height:${n ? 3 : 0}px;border-radius:5px 5px 0 0;background:${i === peak ? '#ec9fa4' : '#5b66c4'}"></div></div>`).join('')}</div>
<div class="num" style="display:flex;gap:7px;margin-top:14px;font-size:24px;color:#a3a1ad">${s.hours.map((_, i) => `<span style="flex:1;text-align:center">${i % 3 === 0 ? i + 'h' : ''}</span>`).join('')}</div></div>${foot(4)}`);
    // 5. Villes
    const top = s.city.slice(0, 12), maxV = top[0]?.n || 1, rest = s.city.slice(12), restN = rest.reduce((t, c) => t + c.n, 0);
    out.push(`<div class="page"><div class="kicker">Dans quelles villes ?</div><h2>Les ${top.length} villes les plus actives</h2>
<div style="margin-top:40px">${top.map(c => `<div class="row" style="grid-template-columns:420px 1fr 92px;height:74px"><span style="font-size:30px;font-weight:700;line-height:1.1">${esc(c.name)}</span>
<span class="bar" style="height:32px;background:linear-gradient(90deg,#ec9fa4,#a191d8);width:${Math.max(1.5, c.n / maxV * 100)}%"></span><span class="num" style="font-size:32px;text-align:right">${nf(c.n)}</span></div>`).join('')}</div>
${rest.length ? `<p class="sub" style="font-size:30px;margin-top:20px">+ ${rest.length} autre${rest.length > 1 ? 's' : ''} ville${rest.length > 1 ? 's' : ''} : ${nf(restN)} signalement${restN > 1 ? 's' : ''}.</p>` : ''}
<p class="note">Chaque ville compte aussi les communes voisines de son agglomération.</p></div>${foot(5)}`);
    // 6. Vérification
    const stat = (n, t, c) => `<div class="stat"><div class="num" style="color:${c}">${nf(n)}</div><div>${t}</div></div>`;
    out.push(`<div class="page"><div class="kicker">Vérification</div><h2>Qui a confirmé quoi</h2><div style="margin-top:50px">
${stat(s.confirmed, `signalements confirmés par au moins une autre personne (${nf(s.confs)} confirmations en tout)`, '#30a46c')}
${stat(s.verified, 'signalements vérifiés par une orga certifiée (legal team, street medics, collectif)', '#8e8cd8')}
${stat(s.removed, 'signalements retirés de la carte avant leur expiration', '#f5a524')}</div>
<p class="note">Les ${nf(s.total)} signalements de cette série incluent les ${nf(s.removed)} retirés.</p></div>${foot(6)}`);
    // 7. Source
    out.push(`${photos.end ? `<div class="bg" style="background-image:url(${photos.end})"></div><div class="shade"></div>` : ''}
<div class="page" style="justify-content:flex-end"><div class="kicker">Source</div><h2 style="font-size:58px">Cortège, la carte en direct des manifs</h2>
<p class="sub">Signalements anonymes envoyés par les manifestant·es. Un signalement n’est pas un fait vérifié : il est confirmé ou contesté par les autres sur place.</p>
<div class="link">${esc(location.host)}</div></div>${foot(7)}`);
    return out;
  }

  async function render(html, a) {
    const div = document.createElement('div');
    div.innerHTML = `<style>${a.css}${CSS}</style><div class="root">${html}</div>`;
    div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const xhtml = new XMLSerializer().serializeToString(div);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const img = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    await new Promise(r => setTimeout(r, 60)); // laisse le temps aux polices intégrées
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, 0, 0);
    return new Promise(ok => c.toBlob(ok, 'image/png'));
  }

  window.makeStories = async function (d, { cover, end, brand } = {}) {
    const a = await loadAssets();
    const s = stats(d);
    if (!s.total) throw new Error('Aucun signalement ce jour-là.');
    const photos = { cover: cover ? await photoBg(cover) : null, end: end ? await photoBg(end, 0.62) : null };
    const blobs = [];
    for (const html of pages(d, s, a, photos, brand)) blobs.push(await render(html, a));
    return blobs;
  };
})();
