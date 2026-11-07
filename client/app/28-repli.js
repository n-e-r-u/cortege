  // ---- Lieux de repli des orgas (ouverts en ce moment seulement) ----
  // Point à anneau vert « soutien », intérieur choisi par l'orga (pictogramme et couleur, ou logo validé par l'admin).
  // Comme une zone calme vérifiée : un danger signalé à moins de 100 m l'affiche en alerte (isolé) ou barré (confirmé).
  var repli = { h: null, p: [], lg: {} }, syncRepli = null, repliDraw = null, repliSafe = null, repliOpen = null;
  {
    const repliLayer = L.layerGroup().addTo(map), REPLI_M = 100, REPLI_Z = 15;
    const SERVICES = { eau: ['💧', t('Eau')], wc: ['🚻', t('Toilettes')], ecoute: ['👂', t('Écoute')], recharge: ['🔋', t('Recharge')], soins: ['🩹', t('Premiers soins')],
      abri: ['☂️', t('À l’abri')], pmr: ['♿', t('Accessible PMR')] };
    const hh = ms => new Date(ms).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });
    // Danger proche : même règle qu'une zone calme vérifiée par une orga
    const repliSt = p => {
      const now = Date.now(); let near = null, d = Infinity, strong = false;
      for (const { data: x } of reports.values()) {
        if (!isDangerCat(x.cat) || x.c || x.nf || x.exp <= now) continue;
        const dx = dist([p.lat, p.lng], [x.lat, x.lng]); if (dx > REPLI_M) continue;
        if (x.up > 0 || x.ver || x.f) strong = true;
        if (dx < d) { d = dx; near = x; }
      }
      return near ? { lvl: strong ? 'sus' : 'warn', near, d } : null;
    };
    repliSafe = p => { const s = repliSt(p); return !s || s.lvl === 'warn'; };
    const marks = new Map();
    repliOpen = id => marks.get(id)?.openPopup();
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function repliIcon(p, st) {
      const logo = p.lg && repli.lg[p.lg];
      const inner = logo ? `<img src="${logo}" alt="">` : esc(p.g || '🕊️');
      const cls = ['pin', 'refuge', logo ? 'logo' : '', p.st === 'full' ? 'full' : '', st ? 'calm-' + st.lvl : ''].join(' ');
      return L.divIcon({ className: 'refuge-mk', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18],
        html: `<div class="${cls}" style="--c:${GROUP_COLOR.soutien};--rbg:${esc(p.c || GROUP_COLOR.soutien)}">${inner}<i class="refuge-ok" aria-hidden="true">✓</i></div>`
          + (p.s ? `<span class="refuge-lbl">${esc(p.s)}</span>` : '') });
    }
    function repliPopup(p, st) {
      const root = el('div', { class: 'refuge-pop' });
      root.append(el('div', { class: 'pop-title' }, (p.lg && repli.lg[p.lg] ? '🕊️' : p.g || '🕊️') + ' ', p.n));
      root.append(el('div', { class: 'pop-ver' }, '✓ ' + t('Lieu de repli vérifié par {who}', { who: p.o })));
      root.append(el('div', { class: 'pop-meta' }, (p.st === 'full' ? t('Complet pour l’instant') : t('Ouvert jusqu’à {h}', { h: hh(p.to) }))
        + (me ? ' · ' + fmtDist(dist(me, [p.lat, p.lng])) : '')));
      if (st) root.append(el('div', { class: 'pop-calm-warn' }, `⚠ ${CAT[st.near.cat].glyph} ` + t(st.lvl === 'warn' ? '{what} à {d} (pas encore confirmé) : zone pas sûre pour l’instant.' : '{what} à {d} : zone pas sûre pour l’instant.',
        { what: CAT[st.near.cat].label, d: fmtDist(st.d) })));
      if (p.sv && p.sv.length) root.append(el('div', { class: 'refuge-sv' }, ...p.sv.filter(s => SERVICES[s]).map(s => el('span', {}, SERVICES[s][0] + ' ' + SERVICES[s][1]))));
      if (p.a) root.append(el('div', { class: 'pop-meta' }, '📍 ' + p.a));
      if (p.m) root.append(el('p', { class: 'pop-note' }, p.m));
      if (p.u) root.append(el('a', { href: p.u, target: '_blank', rel: 'noopener noreferrer', class: 'refuge-link' }, t('En savoir plus')));
      return root;
    }
    // Mise à jour par différence : une fiche ouverte reste ouverte pendant les synchros
    repliDraw = () => {
      // Lieux locaux : visibles seulement au zoom quartier (15 et plus), jamais sur la vue d'une ville ou du pays
      const now = Date.now(), show = hidden.has('soutien') || map.getZoom() < REPLI_Z ? [] : repli.p.filter(p => p.to > now), keep = new Set(show.map(p => p.id));
      for (const [id, m] of marks) if (!keep.has(id)) { repliLayer.removeLayer(m); marks.delete(id); }
      for (const p of show) {
        const st = repliSt(p), key = JSON.stringify([p, st && st.lvl, !!repli.lg[p.lg]]);
        let m = marks.get(p.id);
        if (m && m._rkey === key) continue;
        if (!m) {
          m = L.marker([p.lat, p.lng], { icon: repliIcon(p, st), keyboard: true, title: p.n, zIndexOffset: 200 }).addTo(repliLayer);
          marks.set(p.id, m);
        } else { m.setLatLng([p.lat, p.lng]); m.setIcon(repliIcon(p, st)); }
        m._rkey = key; m._rp = p;
        const wasOpen = m.isPopupOpen?.();
        m.unbindPopup().bindPopup(() => repliPopup(m._rp, repliSt(m._rp)), { maxWidth: 280 });
        if (wasOpen) m.openPopup();
      }
    };
    syncRepli = async h => {
      if (!h) { if (repli.p.length) { repli = { h: null, p: [], lg: {} }; repliDraw(); } return; }
      if (h === repli.h) return;
      try { const d = await getJ('/live/repli.json'); repli = { h, p: d.p || [], lg: d.lg || {} }; repliDraw(); } catch {}
    };
    // Étiquette sous le point au zoom quartier ; fermeture à l'heure prévue même sans nouvelle synchro
    const zoomCls = () => map.getContainer().classList.toggle('z-street', map.getZoom() >= 15);
    map.on('zoomend', () => { zoomCls(); repliDraw(); }); zoomCls();
    setInterval(() => { if (repli.p.some(p => p.to <= Date.now())) { repli.p = repli.p.filter(p => p.to > Date.now()); repliDraw(); } }, 30_000);
  }
