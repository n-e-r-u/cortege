  // ---- Zones calmes suspendues ----
  // Un danger actif (forces de l'ordre ou danger, non contesté) à moins de 100 m suspend la zone calme au lieu de l'effacer :
  // - danger isolé (personne d'autre ne l'a confirmé) : zone barrée avec un avertissement ('sus')
  // - danger confirmé ou vérifié : zone masquée ('hid')
  // Une zone vérifiée par une orga résiste mieux : simple avertissement ('warn') pour un danger isolé, barrée sinon.
  const CALM_M = 100;
  const calmSt = new Map();   // id de la zone calme -> { lvl, near: danger le plus proche, d: distance, ids: dangers voisins }
  const isDangerCat = cat => CAT[cat] && cat !== 'militaires' && (CAT[cat].group === 'fdo' || CAT[cat].group === 'danger');
  function computeCalm(list) {
    calmSt.clear();
    const now = Date.now();
    const dangers = list.filter(r => isDangerCat(r.cat) && !r.c && !r.nf && r.exp > now);
    for (const c of list) {
      if (c.cat !== 'calme') continue;
      let near = null, d = Infinity, strong = false; const ids = [];
      for (const x of dangers) {
        const dx = dist([c.lat, c.lng], [x.lat, x.lng]);
        if (dx > CALM_M) continue;
        ids.push(x.id); if (x.up > 0 || x.ver || x.f) strong = true;
        if (dx < d) { d = dx; near = x; }
      }
      if (!near) continue;
      const lvl = c.ver ? (strong ? 'sus' : 'warn') : (strong ? 'hid' : 'sus');
      calmSt.set(c.id, { lvl, near, d, ids });
    }
  }
  const calmHidden = r => calmSt.get(r.id)?.lvl === 'hid';
  // ---- Flèche vers la zone calme la plus proche (marche aussi hors ligne, avec les points déjà reçus) ----
  let calmTarget = null;
  const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r),
    x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r); return (Math.atan2(y, x) / r + 360) % 360; };
  function calmNav() {
    const btn = $('#calmNav'); if (!btn) return;
    calmTarget = null;
    if (me) {
      let best = null, bd = 2000;
      for (const { data: r } of reports.values()) {
        if (r.cat !== 'calme' || r.c || r.exp < Date.now()) continue;
        const st = calmSt.get(r.id); if (st && (st.lvl === 'hid' || st.lvl === 'sus')) continue;
        const d = dist(me, [r.lat, r.lng]); if (d < bd) { bd = d; best = r; }
      }
      if (best) calmTarget = { r: best, d: bd };
    }
    btn.hidden = !calmTarget;
    if (!calmTarget) return;
    const h = heading ?? gpsHeading, b = bearing(me, [calmTarget.r.lat, calmTarget.r.lng]);
    $('#calmArrow').style.transform = `rotate(${(b - (h ?? 0) + 360) % 360}deg)`;
    const m = calmTarget.d < 1000 ? Math.round(calmTarget.d / 10) * 10 + ' m' : (calmTarget.d / 1000).toFixed(1).replace('.', ',') + ' km';
    $('#calmTxt').textContent = '🕊 ' + t('Zone calme · {d}', { d: m }) + (h == null ? ' ' + t('(flèche : nord en haut)') : '');
    btn.setAttribute('aria-label', t('Zone calme la plus proche à {d}. Afficher sur la carte.', { d: m }));
  }
  // « C'est calme ici » : compte comme un « Plus là » fait sur place pour chaque danger voisin
  async function calmHere(st) {
    const todo = st.ids.filter(id => !voted.has(id));
    for (const id of todo) await vote(id, -1, true, true);
    toast(t('Merci : le danger voisin est signalé comme parti'));
    map.closePopup(); sync();
  }

