  // ---- Filtres ----
  // ---- Lieux permanents (OpenStreetMap) : préfectures, mairies, commissariats, tribunaux, CRA, hôpitaux ; pharmacies et eau au zoom rue ----
  const PK = Object.fromEntries((cfg.poiKinds || []).map(k => [k.id, k]));
  const POI_Z = 14, POI_STREET_Z = 16, POI_MAX = 350;
  // Zoom à partir duquel chaque type apparaît : les grands lieux d'abord, les mairies et commissariats au zoom quartier, le reste au zoom rue
  const POI_MINZ = { pref: 14, spref: 14, tribunal: 14, cra: 14, hopital: 14, mairie: 15, police: 15, gend: 15, pharma: 16, eau: 16, cam: 17 };
  const POI_CAM_Z = 17;
  // Filtres proposés (préfectures et sous-préfectures ensemble, commissariats et gendarmeries ensemble)
  const POI_FILTERS = [['pref', '🏢 Préfectures et sous-préfectures', ['pref', 'spref']], ['mairie', '🏛 Mairies', ['mairie']], ['police', '👮 Commissariats et gendarmeries', ['police', 'gend']],
    ['tribunal', '🔨 Tribunaux', ['tribunal']], ['cra', '🔒 Centres de rétention', ['cra']], ['hopital', '🏥 Hôpitaux', ['hopital']], ['pharma', '💊 Pharmacies', ['pharma']], ['eau', '🚰 Eau potable', ['eau']], ['cam', '📷 Caméras de surveillance', ['cam']]];
  let poiHidden = false; try { poiHidden = localStorage.getItem('cortege-poi-hidden') === '1'; } catch {}
  let poiOff = new Set(); try { poiOff = new Set(JSON.parse(localStorage.getItem('cortege-poi-off') || '[]')); } catch {}
  const poiShown = kind => { const f = POI_FILTERS.find(x => x[2].includes(kind)); return !f || !poiOff.has(f[0]); };
  let poiHash = null, poiSeq = 0;
  const poiFiles = new Map(), poiDrawn = new Map();
  const poiLayer = L.layerGroup().addTo(map);
  async function poiLoad(file) {
    const c = poiFiles.get(file);
    if (c && (c.h === poiHash || !poiHash)) return c.p;
    try { const p = (await getJ('/live/l/' + file)).p || []; poiFiles.set(file, { h: poiHash, p }); return p; }
    catch (e) { if (e.status === 404) { poiFiles.set(file, { h: poiHash, p: [] }); return []; } return c ? c.p : []; }
  }
  const poiFilesFor = (b, street, cams) => {
    const out = [];
    for (let i = Math.floor(b.getSouth()); i <= Math.floor(b.getNorth()); i++)
      for (let j = Math.floor(b.getWest()); j <= Math.floor(b.getEast()); j++) {
        out.push(`${i}_${j}.json`);
        if (street) out.push(`${i}_${j}-s.json`);
        if (cams && poiShown('cam')) out.push(`${i}_${j}-c.json`);
      }
    return out;
  };
  // Horaires OpenStreetMap (« Mo-Sa 09:00-19:30 ») en français lisible
  const DAYS = { Mo: 'lun', Tu: 'mar', We: 'mer', Th: 'jeu', Fr: 'ven', Sa: 'sam', Su: 'dim', PH: 'fériés' };
  const hoursFr = h => h === '24/7' ? t('Ouvert 24 h/24, 7 j/7') : h.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, d => t(DAYS[d])).replace(/\boff\b/g, t('fermé'))
    .replace(/(\d\d):(\d\d)/g, (_, a, b) => I18N.lang === 'fr' ? (b === '00' ? `${+a} h` : `${+a} h ${b}`) : `${a}:${b}`).replace(/;\s*/g, ' · ').replace(/-/g, '–').replace(/,/g, ', ');
  // Caméra : [id, 'cam', lat, lng, opérateur, publique, direction (-1 inconnue), type]
  const CAM_TYPE = { d: 'Caméra dôme (peut tourner dans tous les sens)', f: 'Caméra fixe', p: 'Caméra orientable' };
  function camPopup(x) {
    const [, , , , op, pub, dir, ct] = x;
    const root = el('div', { class: 'poi-pop' });
    root.append(el('div', { class: 'pop-title' }, '📷 ', pub ? 'Caméra publique' : 'Caméra privée'));
    root.append(el('div', { class: 'pop-meta' }, t(pub ? 'Vidéosurveillance de la voie publique' : 'Caméra privée qui filme la rue') + (me ? ' · ' + fmtDist(dist(me, [x[2], x[3]])) : '')));
    if (op) root.append(el('p', {}, 'Exploitée par : ', op));
    if (ct && CAM_TYPE[ct]) root.append(el('p', {}, t(CAM_TYPE[ct]) + (dir >= 0 && ct !== 'd' ? t(', orientée vers {dir}', { dir: compassFr(dir) }) : '') + '.'));
    else if (dir >= 0) root.append(el('p', {}, t('Orientée vers {dir}.', { dir: compassFr(dir) })));
    root.append(el('p', { class: 'poi-tip' }, t('Recensement fait par des bénévoles d’OpenStreetMap : il est incomplet. Une rue sans caméra sur la carte n’est pas forcément une rue sans caméra.')));
    root.append(el('p', { class: 'fine' }, t('© contributeurs OpenStreetMap')));
    return root;
  }
  const compassFr = d => t(['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'][Math.round(d / 45) % 8]);
  function camIcon(x) {
    const [, , , , , pub, dir, ct] = x, S = 48, c = S / 2, col = pub ? 'cam-pub' : 'cam-priv';
    let cone = '';
    if (dir >= 0 && ct !== 'd') { // cône de 60° dans la direction filmée
      const pt = a => { const r = (a - 90) * Math.PI / 180; return `${(c + 22 * Math.cos(r)).toFixed(1)},${(c + 22 * Math.sin(r)).toFixed(1)}`; };
      cone = `<path class="cam-cone" d="M${c},${c} L${pt(dir - 30)} A22,22 0 0 1 ${pt(dir + 30)} Z"/>`;
    } else if (ct === 'd') cone = `<circle class="cam-cone" cx="${c}" cy="${c}" r="14"/>`;
    const html = `<svg class="cam ${col}" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" aria-hidden="true">${cone}<circle class="cam-dot" cx="${c}" cy="${c}" r="5"/></svg>`;
    return L.divIcon({ className: 'poi-wrap', html, iconSize: [S, S], iconAnchor: [c, c], popupAnchor: [0, -6] });
  }
  function poiPopup(x) {
    if (x[1] === 'cam') return camPopup(x);
    const [, kind, , , name, hours, phone, flag] = x, k = PK[kind] || { label: t('Lieu'), glyph: '📍' };
    const root = el('div', { class: 'poi-pop' });
    root.append(el('div', { class: 'pop-title' }, k.glyph + ' ', name || k.label));
    if (name) root.append(el('div', { class: 'pop-meta' }, k.label + (me ? ' · ' + fmtDist(dist(me, [x[2], x[3]])) : '')));
    if (hours) root.append(el('p', { class: 'poi-h' }, '🕒 ', hoursFr(hours)));
    if (phone) root.append(el('p', {}, el('a', { href: 'tel:' + phone.replace(/[^\d+]/g, '') }, '📞 ' + phone)));
    if (kind === 'pharma') root.append(el('p', { class: 'poi-tip' }, t('Pharmacie de garde (nuit, dimanche, jour férié) : appelle le') + ' ', el('a', { href: 'tel:3237' }, '3237'), '.'));
    if (kind === 'hopital') root.append(el('p', { class: 'poi-tip' }, flag ? t('🚑 Service d’urgences') : t('Urgences : pas indiqué. En cas d’urgence, appelle le 15 ou le 112.')));
    if (kind === 'eau' && flag) root.append(el('p', { class: 'poi-tip' }, t('Fontaine saisonnière : peut être coupée en hiver.')));
    root.append(el('p', { class: 'fine' }, 'Lieu permanent · © contributeurs OpenStreetMap'));
    return root;
  }
  function poiIcon(x, labels) {
    if (x[1] === 'cam') return camIcon(x);
    const k = PK[x[1]] || { glyph: '📍', grp: 'pouvoir' };
    const box = el('div', { class: `poi poi-${k.grp}${k.street ? ' poi-sm' : ''}` }, el('span', { class: 'poi-g', 'aria-hidden': 'true' }, k.glyph));
    if (labels && x[4]) box.append(el('span', { class: 'poi-l' }, x[4].length > 28 ? x[4].slice(0, 27) + '…' : x[4]));
    const s = k.street ? 24 : 30;
    return L.divIcon({ className: 'poi-wrap', html: box, iconSize: [s, s], iconAnchor: [s / 2, s / 2], popupAnchor: [0, -s / 2] });
  }
  async function renderPois() {
    const seq = ++poiSeq, z = map.getZoom();
    if (poiHidden || z < POI_Z || !cfg.poiKinds) { poiLayer.clearLayers(); poiDrawn.clear(); return; }
    const b = map.getBounds(), files = poiFilesFor(b.pad(0.1), z >= POI_STREET_Z, z >= POI_CAM_Z);
    // (les caméras : seulement au zoom rue le plus proche, sinon des milliers de points)
    if (files.length > 12) return;
    const rows = (await Promise.all(files.map(poiLoad))).flat();
    if (seq !== poiSeq) return; // la carte a bougé entre-temps
    const vb = b.pad(0.15), c = map.getCenter();
    // Noms : au zoom quartier pour les grands lieux, seulement au zoom le plus proche pour les pharmacies et l'eau (sinon illisible)
    const labOf = x => x[1] !== 'cam' && z >= ((PK[x[1]] && PK[x[1]].street) ? 18 : 15);
    let want = rows.filter(x => vb.contains([x[2], x[3]]) && z >= (POI_MINZ[x[1]] || POI_STREET_Z) && poiShown(x[1]));
    if (want.length > POI_MAX) want = want.map(x => [x, map.distance(c, [x[2], x[3]])]).sort((a, b2) => a[1] - b2[1]).slice(0, POI_MAX).map(x => x[0]);
    const keep = new Map(want.map(x => [x[0], x]));
    for (const [id, m] of poiDrawn) if (!keep.has(id) || m.options.lab !== labOf(keep.get(id) || []) || m.options.sig !== keep.get(id).join('|')) { poiLayer.removeLayer(m); poiDrawn.delete(id); }
    for (const [id, x] of keep) {
      if (poiDrawn.has(id)) continue;
      const m = L.marker([x[2], x[3]], { icon: poiIcon(x, labOf(x)), zIndexOffset: -1000, keyboard: false, title: x[1] === 'cam' ? t(x[5] ? 'Caméra publique' : 'Caméra privée') : (PK[x[1]]?.label || '') + (x[4] ? ' · ' + x[4] : ''), lab: labOf(x), sig: x.join('|') });
      m.bindPopup(() => poiPopup(x));
      poiLayer.addLayer(m); poiDrawn.set(id, m);
    }
  }
  function syncPois(h) { if (h && h !== poiHash) { poiHash = h; renderPois(); } }
  let poiTimer = null;
  map.on('moveend', () => { clearTimeout(poiTimer); poiTimer = setTimeout(renderPois, 250); });
  // « Prêt pour la manif » : garder aussi les lieux de la zone
  const poiPrefetch = () => Promise.all(poiFilesFor(map.getBounds().pad(0.3), true, true).slice(0, 15).map(f => getJ('/live/l/' + f).catch(() => null)));

  // ---- Calques : ce que montre la carte (familles de signalements, agenda, lieux, caméras) ----
  function renderFilters() {
    const box = $('#filters'); box.textContent = '';
    for (const g of cfg.groups) {
      const n = mode === 'nat' ? natCache.r.reduce((s, z) => s + (z.g[g.id] || 0), 0) : [...reports.values()].filter(x => CAT[x.data.cat].group === g.id && !calmHidden(x.data)).length;
      const b = el('button', { type: 'button', class: 'layer', style: `--c:${GROUP_COLOR[g.id]}`, 'aria-pressed': String(!hidden.has(g.id)) }, g.label, el('span', { class: 'n' }, String(n)));
      b.onclick = () => {
        hidden.has(g.id) ? hidden.delete(g.id) : hidden.add(g.id);
        regroup();
        refreshUI();
      };
      box.append(b);
    }
    // Point sur le bouton Calques : quelque chose est masqué
    $('#layersDot').hidden = !(hidden.size || evHidden);
  }
  renderFilters();
  function layerSwitch(label, sub, on, change, extra) {
    const cb = el('input', { type: 'checkbox' }); cb.checked = on;
    cb.onchange = () => change(cb.checked);
    const txt = el('span', { class: 'switch-txt' }, el('b', {}, label), el('span', {}, sub));
    if (extra) txt.append(extra);
    return el('label', { class: 'switch' }, cb, txt);
  }
  function renderToggles() {
    const box = $('#layerToggles'); box.textContent = '';
    box.append(layerSwitch('📅 Agenda', 'Manifs, blocus et rassemblements du moment, avec leur parcours', !evHidden, on => {
      evHidden = !on;
      try { localStorage.setItem('cortege-ev-hidden', evHidden ? '1' : '0'); } catch {}
      renderEvents();
    }));
    if (cfg.poiKinds) {
      const more = el('button', { type: 'button', class: 'link-btn' }, 'Choisir les types de lieux');
      more.onclick = e => { e.preventDefault(); openPoiSheet(); };
      box.append(layerSwitch('🏛 Lieux utiles', 'Préfectures, commissariats, tribunaux, hôpitaux, pharmacies, eau potable. Ils apparaissent en zoomant.', !poiHidden, on => {
        poiHidden = !on;
        try { localStorage.setItem('cortege-poi-hidden', poiHidden ? '1' : '0'); } catch {}
        renderPois(); renderToggles();
      }, more));
      if (PK.cam) box.append(layerSwitch('📷 Caméras de surveillance', 'Visibles en zoomant au plus près. Recensement bénévole d’OpenStreetMap, il en manque.', !poiHidden && !poiOff.has('cam'), on => {
        if (on && poiHidden) { poiHidden = false; try { localStorage.setItem('cortege-poi-hidden', '0'); } catch {} }
        on ? poiOff.delete('cam') : poiOff.add('cam');
        try { localStorage.setItem('cortege-poi-off', JSON.stringify([...poiOff])); } catch {}
        renderPois(); renderToggles();
        if (on && map.getZoom() < POI_CAM_Z) toast('Caméras affichées : zoome au plus près pour les voir');
      }));
    }
  }
  $('#btnLayers').onclick = () => { closeReport(); closeSheets(); renderFilters(); renderToggles(); $('#sheetLayers').hidden = false; };
  $('#lyClose').onclick = () => closeSheets();
  // Choix des lieux affichés : tout afficher ou masquer, et type par type
  function openPoiSheet() {
    closeReport(); closeSheets();
    const box = $('#poiList'); box.textContent = '';
    $('#poiAll').checked = !poiHidden;
    for (const [key, label, kinds] of POI_FILTERS) {
      const z = Math.min(...kinds.map(k => POI_MINZ[k] || POI_STREET_Z));
      const cb = el('input', { type: 'checkbox' }); cb.checked = !poiOff.has(key); cb.disabled = poiHidden;
      cb.onchange = () => { cb.checked ? poiOff.delete(key) : poiOff.add(key); try { localStorage.setItem('cortege-poi-off', JSON.stringify([...poiOff])); } catch {} renderPois(); };
      box.append(el('label', { class: 'switch' }, cb, el('span', { class: 'switch-txt' }, el('b', {}, label), el('span', {}, key === 'cam' ? 'Visible en zoomant au plus près. Rouge : publique. Orange : privée, filme la rue. Le cône montre la direction filmée quand elle est connue. Recensement bénévole et incomplet.' : z >= 16 ? 'Visible au zoom rue' : z >= 15 ? 'Visible au zoom quartier' : 'Visible au zoom ville'))));
    }
    $('#sheetPoi').hidden = false;
  }
  $('#poiAll').addEventListener('change', e => {
    poiHidden = !e.target.checked;
    try { localStorage.setItem('cortege-poi-hidden', poiHidden ? '1' : '0'); } catch {}
    $('#poiList').querySelectorAll('input').forEach(i => (i.disabled = poiHidden));
    renderPois();
  });
  $('#poiClose').onclick = () => closeSheets();

