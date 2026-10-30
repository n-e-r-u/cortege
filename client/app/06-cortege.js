  // ---- Tête et queue de cortège : trace, direction, longueur du cortège, avancée sur le parcours annoncé ----
  // Tout est calculé sur le téléphone, à partir des points publics (ta position ne part jamais).
  const flowLayer = L.layerGroup().addTo(map), flowInfo = new Map();
  const FLOW_CATS = ['cortege', 'queue'];
  // Projection locale en mètres, suffisante à l'échelle d'une manif
  const xy = (p, lat0) => [p[1] * 111320 * Math.cos(lat0 * Math.PI / 180), p[0] * 110540];
  // Point le plus proche sur un parcours : distance au parcours (m), distance parcourue depuis le départ (m), longueur totale (m)
  function onRoute(route, p) {
    const lat0 = route[0][0], P = xy(p, lat0);
    let best = { d: Infinity, at: 0, i: 0, q: route[0] }, acc = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const A = xy(route[i], lat0), Bp = xy(route[i + 1], lat0), dx = Bp[0] - A[0], dy = Bp[1] - A[1], L2 = dx * dx + dy * dy, seg = Math.sqrt(L2);
      const k = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
      const d = Math.hypot(P[0] - (A[0] + k * dx), P[1] - (A[1] + k * dy));
      if (d < best.d) best = { d, at: acc + k * seg, i, q: [route[i][0] + k * (route[i + 1][0] - route[i][0]), route[i][1] + k * (route[i + 1][1] - route[i][1])] };
      acc += seg;
    }
    return { ...best, total: acc };
  }
  // Morceau du parcours entre deux distances depuis le départ
  function routeSlice(route, a, b) {
    const lat0 = route[0][0], out = []; let acc = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const A = xy(route[i], lat0), Bp = xy(route[i + 1], lat0), seg = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
      const at = k => [route[i][0] + k * (route[i + 1][0] - route[i][0]), route[i][1] + k * (route[i + 1][1] - route[i][1])];
      if (acc + seg >= a && acc <= b) {
        if (!out.length) out.push(at(seg ? Math.max(0, (a - acc) / seg) : 0));
        if (acc + seg <= b) out.push(route[i + 1]); else { out.push(at(seg ? (b - acc) / seg : 0)); break; }
      }
      acc += seg;
    }
    return out;
  }
  // Direction et vitesse d'après la trace des 10 dernières minutes
  function motion(r) {
    const now = Date.now() / 1000, pts = (r.tr || []).filter(p => p[2] > now - 600);
    if (!pts.length) return null;
    const from = pts[0], d = dist([from[0], from[1]], [r.lat, r.lng]), dt = ((r.last || r.t) / 1000) - from[2];
    if (d < 30 || dt < 60) return null;
    return { b: bearing([from[0], from[1]], [r.lat, r.lng]), kmh: d / dt * 3.6 };
  }
  const CARD = ['vers le nord', 'vers le nord-est', 'vers l’est', 'vers le sud-est', 'vers le sud', 'vers le sud-ouest', 'vers l’ouest', 'vers le nord-ouest'];
  const cardinal = b => t(CARD[Math.round(((b % 360) + 360) % 360 / 45) % 8]);
  const mins = m => m < 60 ? t('{n} min', { n: Math.max(1, Math.round(m)) }) : t('{h} h {m}', { h: Math.floor(m / 60), m: String(Math.round(m % 60)).padStart(2, '0') });
  // Tracé par les rues entre la queue et la tête (positions publiques), gardé en mémoire tant qu'elles ne bougent pas
  const streetCache = new Map();
  function streetFetch(key, q, h) {
    if (!cfg.vector) { streetCache.set(key, { none: true }); return; }
    streetCache.set(key, { pending: true });
    if (streetCache.size > 50) streetCache.delete(streetCache.keys().next().value);
    fetch(`/api/cortege-route?a=${q.lat},${q.lng}&b=${h.lat},${h.lng}`).then(r => r.ok ? r.json() : null)
      .then(x => { streetCache.set(key, x && x.path ? x : { none: true }); if (x && x.path) drawFlow(); })
      .catch(() => streetCache.delete(key));
  }
  function drawFlow() {
    flowLayer.clearLayers(); flowInfo.clear();
    if (hidden.has('info')) return;
    const all = [...reports.values()].map(x => x.data).filter(r => FLOW_CATS.includes(r.cat) && !r.c);
    const now = Date.now(), routes = evCache.e.filter(e => e.route && e.route.length > 1 && e.start < now + 60 * MIN && e.start > now - 12 * 60 * MIN);
    const info = id => { if (!flowInfo.has(id)) flowInfo.set(id, { lines: [] }); return flowInfo.get(id); };
    const fix = {}; // parcours sur lequel se trouve chaque point
    for (const r of all) {
      const col = GROUP_COLOR.info;
      // Trace des 30 dernières minutes
      if (r.tr && r.tr.length) L.polyline([...r.tr.map(p => [p[0], p[1]]), [r.lat, r.lng]], { color: col, weight: 4, opacity: .7, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(flowLayer);
      const mo = motion(r);
      if (mo) {
        L.marker([r.lat, r.lng], { interactive: false, keyboard: false, zIndexOffset: -10,
          icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="flow-arrow" style="transform:rotate(${mo.b}deg) translateY(-30px)">▲</div>` }) }).addTo(flowLayer);
        info(r.id).lines.push(t('Avance {dir}, environ {v} km/h', { dir: cardinal(mo.b), v: mo.kmh < 10 ? mo.kmh.toFixed(1).replace('.', I18N.lang === 'en' ? '.' : ',') : Math.round(mo.kmh) }));
      }
      // Sur un parcours annoncé dans l'agenda ?
      let best = null;
      for (const e of routes) { const o = onRoute(e.route, [r.lat, r.lng]); if (o.d <= 300 && (!best || o.d < best.o.d)) best = { e, o }; }
      if (best) {
        fix[r.id] = best;
        if (r.cat === 'cortege') {
          const { e, o } = best, pct = Math.round(o.at / o.total * 100);
          L.polyline(routeSlice(e.route, 0, o.at), { color: '#ec9fa4', weight: 7, opacity: .9, interactive: false }).addTo(flowLayer);
          const left = o.total - o.at, sp = mo && mo.kmh > 0.3 ? mo.kmh * 1000 / 60 : null; // mètres par minute
          info(r.id).lines.push(t('Parcours « {title} » : {p} % fait', { title: e.title, p: pct }) + (sp ? ' · ' + t('fin dans environ {d}', { d: mins(left / sp) }) : ''));
          if (me && sp) { const mine = onRoute(e.route, me); if (mine.d <= 200 && mine.at > o.at) info(r.id).lines.push(t('Arrive près de toi dans environ {d}', { d: mins((mine.at - o.at) / sp) })); }
        }
      }
    }
    // Tête et queue : le cortège entre les deux, avec sa longueur
    const heads = all.filter(r => r.cat === 'cortege');
    for (const q of all.filter(r => r.cat === 'queue')) {
      let h = null, hd = Infinity;
      for (const x of heads) { const d = dist([x.lat, x.lng], [q.lat, q.lng]); if (d < hd && d <= 5000) { h = x; hd = d; } }
      if (!h) continue;
      const fh = fix[h.id], fq = fix[q.id];
      let line, len, air = false;
      const lenOf = l => l.reduce((t2, p, i) => i ? t2 + dist(l[i - 1], p) : 0, 0);
      // 1. Sur le parcours annoncé : le morceau entre la queue et la tête
      if (fh && fq && fh.e.id === fq.e.id && fh.o.at >= fq.o.at) { line = routeSlice(fh.e.route, fq.o.at, fh.o.at); len = fh.o.at - fq.o.at; }
      else {
        // 2. Sinon, le chemin réellement suivi par la tête : la queue passe là où la tête est passée
        const tr = [...(h.tr || []).map(p => [p[0], p[1]]), [h.lat, h.lng]];
        let bi = -1, bd = Infinity;
        tr.forEach((p, i) => { const d = dist(p, [q.lat, q.lng]); if (d < bd) { bd = d; bi = i; } });
        if (bi >= 0 && bi < tr.length - 1 && bd <= 150) { line = [[q.lat, q.lng], ...tr.slice(bi)]; len = lenOf(line); }
        else {
          // 3. Sinon, par les rues de la carte (calculé par le serveur), et en attendant ou à défaut : à vol d'oiseau
          const key = `${q.lat},${q.lng}|${h.lat},${h.lng}`, st = streetCache.get(key);
          if (st && st.path) { line = st.path; len = st.len; }
          else { if (!st) streetFetch(key, q, h); line = [[q.lat, q.lng], [h.lat, h.lng]]; len = hd; air = true; }
        }
      }
      if (line.length < 2) continue;
      L.polyline(line, air ? { color: GROUP_COLOR.info, weight: 3, opacity: .7, dashArray: '4 8', interactive: false }
        : { color: GROUP_COLOR.info, weight: 12, opacity: .35, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(flowLayer);
      const mid = line[Math.floor(line.length / 2)];
      const txt = t(air ? 'Cortège : environ {d} à vol d’oiseau' : 'Cortège : environ {d}', { d: fmtDist(len) });
      L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [170, 22], iconAnchor: [85, 11], html: `<div class="flow-len${air ? ' air' : ''}">${txt.replace(/[<&]/g, '')}</div>` }) }).addTo(flowLayer);
      info(h.id).lines.push(txt); info(q.id).lines.push(txt);
    }
  }
  function refreshUI() { renderFilters(); renderNational(); feedBadge(); if (!$('#sheetList').hidden) renderList(); }
  // Rafraîchit l'opacité des points vieillissants
  setInterval(() => {
    computeCalm([...reports.values()].map(x => x.data));
    for (const { data, marker } of reports.values()) if (!marker.isPopupOpen()) marker.setIcon(icon(data, false));
    for (const st of stacks.values()) st.sig = ''; regroup();
  }, 60_000);

