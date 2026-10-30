  // ---- Marqueurs ----
  function icon(r, fresh) {
    const c = CAT[r.cat];
    const age = Date.now() - (r.last || r.t), ttl = c.ttl * MIN;
    const cs = calmSt.get(r.id);
    const cls = ['pin', fresh ? 'fresh' : '', age > ttl * 0.6 ? 'old' : '', r.c ? 'contested' : '', cs ? 'calm-' + cs.lvl : ''].join(' ');
    return L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18],
      html: r.cat === 'contact' ? `<div class="pin admin live" style="--c:#a191d8"><img src="/brand/logo.png" alt=""></div>`
        : `<div class="${cls}${r.ver ? ' ver' : ''}${r.live ? ' live' : ''}" style="--c:${GROUP_COLOR[c.group]}">${c.glyph}</div>` });
  }
  function popup(r) {
    const c = CAT[r.cat];
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, c.glyph + ' ', c.label));
    const revu = r.last && r.last - r.t >= MIN ? ' · ' + t('revu {ago}', { ago: ago(r.last) }) : '';
    const meta = ago(r.t) + revu + ' · ' + t('expire dans {d}', { d: left(r.exp) }) + (me ? ` · ${fmtDist(dist(me, [r.lat, r.lng]))}` : '');
    root.append(el('div', { class: 'pop-meta' }, meta));
    if (r.live) root.append(el('div', { class: 'pop-live' }, t('En direct : position partagée par {who}', { who: r.ver || t('une orga') })));
    // Point de l'admin : on vient le voir pour devenir orga certifiée
    if (r.cat === 'contact') { const jb = el('button', { class: 'secondary', style: 'margin:6px 0' }, t('Demander un accès orga')); jb.onclick = () => { map.closePopup(); openJoin(); }; root.append(jb); }
    const fl = flowInfo.get(r.id);
    if (fl && fl.lines.length) root.append(el('div', { class: 'pop-flow', style: `--c:${GROUP_COLOR[c.group]}` }, ...fl.lines.flatMap((x, i) => i ? [el('br'), x] : [x])));
    if (r.up > 0) root.append(el('div', { class: 'pop-count' }, t('Signalé par {n} personnes', { n: r.up + 1 })));
    if (r.ver) root.append(el('div', { class: 'pop-ver' }, '✓ ' + t('Vérifié par {who}', { who: r.ver === 'une orga' ? t('une orga') : r.ver })));
    else if (r.f) root.append(el('div', { class: 'pop-fiable' }, '★ ' + t('Signalé par un téléphone fiable aujourd’hui (ses signalements sont souvent confirmés)')));
    if (r.nf) root.append(el('div', { class: 'pop-unconf' }, t('Pas encore confirmé. Confirme si tu le vois.')));
    const cs = calmSt.get(r.id);
    if (cs) {
      root.append(el('div', { class: 'pop-calm-warn' }, `⚠ ${CAT[cs.near.cat].glyph} ` + t(cs.lvl === 'warn' ? '{what} à {d} (pas encore confirmé) : zone pas sûre pour l’instant.' : '{what} à {d} : zone pas sûre pour l’instant.', { what: CAT[cs.near.cat].label, d: fmtDist(cs.d) })));
      if (onSite(r) === 'here' && cs.ids.some(id => !voted.has(id))) {
        const b = el('button', { class: 'calm-here' }, '🕊️ ' + t('C’est calme ici'));
        b.onclick = () => { b.disabled = true; calmHere(cs); };
        root.append(b);
      }
    }
    if (r.c) root.append(el('div', { class: 'pop-contested' }, tn(r.down, 'Contesté : {n} personne dit que c’est parti. Confirme si c’est toujours là.', 'Contesté : {n} personnes disent que c’est parti. Confirme si c’est toujours là.')));
    const notes = r.notes && r.notes.length ? r.notes : r.note ? [{ x: r.note, t: r.t }] : [];
    for (const n of notes) root.append(el('p', { class: 'pop-note' }, n.x, el('span', { class: 'pop-note-t' }, ' · ' + ago(n.t))));
    if (r.cat === 'contact') return root; // point de l'admin : ni précision, ni vote
    // Ajouter une précision à un point déjà signalé
    const addBtn = el('button', { class: 'link-btn pop-add' }, '＋ ' + t('Ajouter une précision'));
    const form = el('form', { class: 'pop-note-form', hidden: '' });
    const input = el('input', { maxlength: '120', placeholder: notePlaceholder(r.cat), 'aria-label': t('Précision') });
    form.append(input, el('button', { type: 'submit' }, t('Ajouter')));
    addBtn.onclick = () => { addBtn.hidden = true; form.hidden = false; input.focus(); };
    form.onsubmit = e => { e.preventDefault(); sendNote(r.id, input.value); };
    root.append(addBtn, form);
    const yes = el('button', { class: 'yes' }, t('Toujours là'));
    // « Plus là » : seulement pour qui est sur place (calculé sur le téléphone, la position ne part pas)
    const where = onSite(r);
    const no = where === 'far' ? el('button', { class: 'no', disabled: '', title: t('Seulement sur place') }, t('Pas sur place')) : el('button', { class: 'no' }, t('Plus là'));
    if (voted.has(r.id)) yes.disabled = no.disabled = true;
    yes.onclick = () => vote(r.id, 1);
    if (where !== 'far') no.onclick = () => vote(r.id, -1, where === 'here');
    root.append(el('div', { class: 'pop-actions' }, yes, no));
    root.append(el('p', { class: 'pop-hint' }, where === 'far'
      ? t('Tu es à {d} : seules les personnes sur place peuvent dire que c’est parti.', { d: fmtDist(dist(me, [r.lat, r.lng])) })
      : t('Tu es sur place et tu ne vois plus rien ? Appuie sur « Plus là ».')));
    if (orga) {
      const ok = el('button', { class: 'yes' }, '✓ ' + t(r.ver ? 'Vérifié' : 'Vérifier (orga)'));
      const rm = el('button', { class: 'danger' }, t('Retirer (faux)'));
      ok.disabled = !!r.ver;
      ok.onclick = () => orgaAction(r.id, 'verify');
      rm.onclick = () => { if (rm.dataset.armed) orgaAction(r.id, 'remove'); else { rm.dataset.armed = '1'; rm.textContent = t('Confirmer le retrait'); } };
      root.append(el('div', { class: 'pop-actions orga' }, ok, rm));
      // Son propre signalement : prolonger ou corriger (type, précision)
      if (mine.has(r.id) || orga.admin) {
        const ext = el('button', { class: 'secondary' }, '⏱ ' + t('Prolonger'));
        const edit = el('button', { class: 'secondary' }, '✎ ' + t('Modifier'));
        ext.onclick = () => ownAction(r.id, 'extend');
        const form = el('form', { class: 'pop-edit', hidden: '' });
        const sel = el('select', { 'aria-label': t('Type') });
        for (const c of cfg.categories.filter(c => !c.off && !c.beaconOnly)) { const o = el('option', { value: c.id }, c.glyph + ' ' + c.label); if (c.id === r.cat) o.selected = true; sel.append(o); }
        const mineNote = (r.notes || [])[0]?.x || '';
        const inp = el('input', { maxlength: '120', placeholder: t('Précision (vide = aucune)'), 'aria-label': t('Précision'), value: mineNote });
        form.append(sel, inp, el('button', { type: 'submit' }, t('Enregistrer')));
        edit.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) inp.focus(); };
        form.onsubmit = e => { e.preventDefault(); ownAction(r.id, 'edit', { cat: sel.value, note: inp.value }); };
        root.append(el('div', { class: 'pop-actions orga' }, ext, edit), form);
      }
    }
    return root;
  }
  // Quelqu'un écrit une précision dans un popup : on ne le redessine pas (le texte serait perdu)
  const typingInPopup = () => { const f = document.querySelector('.leaflet-popup .pop-note-form:not([hidden])'), e = document.querySelector('.leaflet-popup .pop-edit:not([hidden])');
    return !!e || !!(f && (f.contains(document.activeElement) || f.querySelector('input').value)); };
  function upsert(r, fresh = false) {
    const cur = reports.get(r.id);
    if (cur) {
      const moved = cur.data.lat !== r.lat || cur.data.lng !== r.lng;
      cur.data = r;
      if (moved) cur.marker.setLatLng([r.lat, r.lng]); // point de forces de l'ordre qui s'est déplacé
      cur.marker.setIcon(icon(r, false));
      if (cur.marker.isPopupOpen() && !typingInPopup()) cur.marker.setPopupContent(popup(r));
    } else {
      const marker = L.marker([r.lat, r.lng], { icon: icon(r, fresh), keyboard: true, title: CAT[r.cat].label, cat: r.cat });
      marker.bindPopup(() => popup(reports.get(r.id).data));
      reports.set(r.id, { data: r, marker }); // affiché par regroup()
    }
  }
  function drop(id) {
    const cur = reports.get(id);
    if (cur) { layer.removeLayer(cur.marker); reports.delete(id); }
  }

  // ---- Piles : des types différents à moins de 30 m s'affichent en une seule pastille ----
  // Les données restent séparées (chaque type garde ses votes et sa durée), seul l'affichage est regroupé.
  const STACK_M = 30;
  const stacks = new Map();   // clé -> { marker, ids, sig }
  const stackOf = new Map();  // id -> clé de sa pile
  const sev = r => SEVERITY.indexOf(CAT[r.cat].group);
  const markerOf = id => { const k = stackOf.get(id); return k ? stacks.get(k)?.marker : reports.get(id)?.marker; };
  function stackIcon(g) {
    const glyphs = g.slice(0, 3).map(r => `<span>${CAT[r.cat].glyph}</span>`).join('') + (g.length > 3 ? `<b>+${g.length - 3}</b>` : '');
    const fresh = g.some(r => Date.now() - (r.last || r.t) < CAT[r.cat].ttl * MIN * 0.6);
    return L.divIcon({ className: '', iconSize: [30 + 20 * Math.min(g.length, 3), 40], iconAnchor: [15 + 10 * Math.min(g.length, 3), 20], popupAnchor: [0, -18],
      html: `<div class="pin stack${fresh ? '' : ' old'}${g.some(r => r.ver) ? ' ver' : ''}" style="--c:${GROUP_COLOR[CAT[g[0].cat].group]}">${glyphs}</div>` });
  }
  function stackPopup(ids) {
    const root = el('div', { class: 'pop-stack' });
    ids.map(id => reports.get(id)?.data).filter(Boolean).forEach((r, i) => { if (i) root.append(el('hr')); root.append(popup(r)); });
    return root;
  }
  function regroup() {
    const vis = [...reports.values()].map(x => x.data).filter(r => !hidden.has(CAT[r.cat].group) && !calmHidden(r));
    // Seaux de ~30 m pour ne comparer que les voisins (rapide même avec des milliers de points)
    const B = 0.0003, bk = (i, j) => i + '_' + j, buckets = new Map();
    const bi = r => Math.floor(r.lat / B), bj = r => Math.floor(r.lng / (B * 1.4));
    for (const r of vis) { const k = bk(bi(r), bj(r)); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(r); }
    vis.sort((a, b) => sev(a) - sev(b) || (b.last || b.t) - (a.last || a.t));
    const taken = new Set(), want = new Map();
    for (const r of vis) {
      if (taken.has(r.id)) continue;
      taken.add(r.id);
      const g = [r];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++)
        for (const o of buckets.get(bk(bi(r) + di, bj(r) + dj)) || [])
          if (!taken.has(o.id) && dist([r.lat, r.lng], [o.lat, o.lng]) <= STACK_M) { g.push(o); taken.add(o.id); }
      if (g.length > 1) { g.sort((a, b) => sev(a) - sev(b)); want.set(g.map(x => x.id).sort().join('|'), g); }
    }
    for (const [k, st] of stacks) if (!want.has(k)) { layer.removeLayer(st.marker); stacks.delete(k); }
    stackOf.clear();
    for (const [k, g] of want) {
      const sig = g.map(r => `${r.id}:${r.up}:${r.ver || ''}:${r.lat}:${r.lng}:${r.c || ''}:${calmSt.get(r.id)?.lvl || ''}`).join(',');
      let st = stacks.get(k);
      if (!st) {
        const m = L.marker([g[0].lat, g[0].lng], { icon: stackIcon(g), keyboard: true, title: g.map(r => CAT[r.cat].label).join(', '), cat: g[0].cat });
        m.bindPopup(() => stackPopup(stacks.get(k)?.ids || []), { maxHeight: Math.round(innerHeight * 0.55) });
        st = { marker: m, ids: g.map(r => r.id), sig };
        stacks.set(k, st); layer.addLayer(m);
      } else if (st.sig !== sig) {
        st.sig = sig; st.ids = g.map(r => r.id);
        st.marker.setLatLng([g[0].lat, g[0].lng]); st.marker.setIcon(stackIcon(g));
        if (st.marker.isPopupOpen() && !typingInPopup()) st.marker.setPopupContent(stackPopup(st.ids));
      }
      for (const r of g) stackOf.set(r.id, k);
    }
    for (const [id, { data, marker }] of reports) {
      const show = !hidden.has(CAT[data.cat].group) && !stackOf.has(id) && !calmHidden(data), on = layer.hasLayer(marker);
      if (show && !on) layer.addLayer(marker); else if (!show && on) layer.removeLayer(marker);
    }
    try { drawFlow(); } catch (e) { console.error('cortège', e); }
  }
