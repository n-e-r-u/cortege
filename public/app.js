'use strict';
(async function () {
  const $ = s => document.querySelector(s);
  const MIN = 60_000;
  const ALERT_RADIUS = 300;                 // mètres
  const ALERT_CATS = new Set(['sommations', 'lacrymo', 'canon', 'charge', 'nasse', 'bac', 'crs', 'interpellation']);
  let orga = null; // { label, admin } quand ce téléphone a un lien orga
  let announcements = [];
  // Économie de batterie : rafraîchissement espacé, GPS moins précis, boussole coupée
  let eco = false; try { eco = localStorage.getItem('cortege-eco') === '1'; } catch {}
  let pushSub = null;               // abonnement aux notifications (annonces urgentes)
  let evCache = { h: null, e: [] }; // agenda (événements publiés)
  let legalCache = { h: null, l: [] }; // annuaire permanent des legal teams (lignes validées par l'admin)

  // Identifiant anonyme de ce téléphone (tiré au hasard, jamais lié à une personne) : sert seulement
  // à limiter le spam par appareil, car en 4G des centaines de personnes partagent la même adresse IP.
  const DEVICE = (() => {
    let d = null; try { d = localStorage.getItem('cortege-dev'); } catch {}
    if (!d || !/^[\w-]{16,64}$/.test(d)) {
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      d = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { localStorage.setItem('cortege-dev', d); } catch {}
    }
    return d;
  })();
  // Réglages du serveur : gardés sur le téléphone pour que l'appli s'ouvre aussi sans réseau
  const cfg = await (async () => {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 8000);
    try {
      const c = await fetch('/api/config', { signal: ac.signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      try { localStorage.setItem('cortege-config', JSON.stringify(c)); } catch {}
      return c;
    } catch (e) {
      let c = null; try { c = JSON.parse(localStorage.getItem('cortege-config') || 'null'); } catch {}
      if (c) return c;
      throw e;
    } finally { clearTimeout(to); }
  })();
  const CAT = Object.fromEntries(cfg.categories.map(c => [c.id, c]));
  const MERGE = cfg.merge || {};              // rayon de fusion par type (m), même règle que le serveur
  const mergeR = cat => (MERGE[cat] && MERGE[cat].r) || 50;
  const GROUP_COLOR = { fdo: 'var(--fdo)', danger: 'var(--danger)', soutien: 'var(--soutien)', info: 'var(--info)' };
  $('#eventName').textContent = cfg.event;
  if (cfg.sourceUrl) $('#githubLink').href = cfg.sourceUrl;
  if (cfg.violenceUrl) document.querySelectorAll('#violenceLink, .violence-inline').forEach(a => (a.href = cfg.violenceUrl));
  if (cfg.brand) {
    document.querySelectorAll('.handle').forEach(n => (n.textContent = '@' + cfg.brand.handle));
    document.querySelectorAll('a[href="https://www.instagram.com/neru/"]').forEach(a => (a.href = cfg.brand.instagram));
    $('#brandLink').href = cfg.brand.instagram;
    if (cfg.brand.kofi) $('#kofiLink').href = $('#btnKofi').href = cfg.brand.kofi; else { $('#kofiLink').hidden = true; $('#btnKofi').hidden = true; }
    const siteLabel = cfg.brand.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    document.querySelectorAll('a[href="https://neru.tv"]').forEach(a => { a.href = cfg.brand.site; if (!a.querySelector('svg')) a.textContent = siteLabel; });
  }

  // Logo absent : on le masque (fait ici et pas dans le HTML, que la politique de sécurité interdit)
  document.querySelectorAll('img[src="/brand/logo.png"]').forEach(img => {
    const fail = () => { img.hidden = true; if (img.classList.contains('logo-img') && img.nextElementSibling) img.nextElementSibling.hidden = false; };
    if (img.complete && !img.naturalWidth) fail(); else img.addEventListener('error', fail);
  });

  // Demande d'accès orga : un e-mail prérempli avec ce qu'il faut pour vérifier le collectif
  if (cfg.contact) {
    const body = ['Bonjour,', '', 'Je souhaite un accès orga certifiée sur Cortège.', '',
      'Collectif ou organisation :', 'Ville ou secteur :', 'Rôle (legal team, street medics, orga de manif, syndicat, autre) :',
      'Site ou compte public du collectif (lien) :', 'Depuis quand le collectif existe :',
      'Canal officiel du collectif où te confirmer la demande (adresse ou compte publié par le collectif, pas un contact personnel) :',
      'Organisation déjà connue qui peut se porter garante (facultatif) :', '', 'Merci !'].join('\n');
    $('#orgaRequest').href = `mailto:${cfg.contact}?subject=${encodeURIComponent('Demande orga')}&body=${encodeURIComponent(body)}`;
    $('#orgaRequestCard').hidden = false;
  }

  // ---- Carte ----
  // Les popups ne doivent pas finir sous l'en-tête ni sous le bouton « Signaler »
  L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(12, 120), autoPanPaddingBottomRight: L.point(12, 150) });
  // Après une mise à jour automatique, on revient exactement là où on était
  let savedView = null; try { savedView = JSON.parse(sessionStorage.getItem('cortege-view') || 'null'); sessionStorage.removeItem('cortege-view'); } catch {}
  // Ouverture depuis une notification « danger près de toi » : /?at=lat,lng
  const atParam = s => { const m = /[?&]at=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s || ''); return m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180 ? [+m[1], +m[2]] : null; };
  { const at = atParam(location.search); if (at) { savedView = { c: at, z: 17 }; history.replaceState(null, '', location.pathname); } }
  const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 19 })
    .setView(savedView ? savedView.c : cfg.center, savedView ? savedView.z : (cfg.zoom || 6));
  // Regroupement des points quand on dézoome (bulle = nombre de signalements, couleur = le plus grave)
  const SEVERITY = ['fdo', 'danger', 'info', 'soutien'];
  const layer = L.markerClusterGroup({
    maxClusterRadius: z => (z >= 15 ? 30 : 60), disableClusteringAtZoom: 16, showCoverageOnHover: false, spiderfyOnMaxZoom: true,
    iconCreateFunction: cluster => {
      const groups = new Set(cluster.getAllChildMarkers().map(m => CAT[m.options.cat].group));
      const g = SEVERITY.find(x => groups.has(x)) || 'info';
      const n = cluster.getChildCount();
      const size = n < 10 ? 38 : n < 100 ? 46 : 54;
      return L.divIcon({ className: '', iconSize: [size, size], html: `<div class="cluster" style="--c:${GROUP_COLOR[g]};width:${size}px;height:${size}px">${n}</div>` });
    },
  }).addTo(map);
  let mapMode = 'raster';
  if (mapMode === 'raster') {
    document.body.classList.add('raster');
    L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  }

  // Popup ouvert : les boutons latéraux s'effacent pour ne pas le recouvrir
  map.on('popupopen', () => document.body.classList.add('pop-open'));
  map.on('popupclose', () => document.body.classList.remove('pop-open'));
  const reports = new Map();   // id -> {data, marker}
  const voted = new Set();     // en mémoire seulement
  const hidden = new Set();    // groupes masqués
  // Événements de l'agenda masqués sur la carte (choix gardé sur ce téléphone)
  let evHidden = false; try { evHidden = localStorage.getItem('cortege-ev-hidden') === '1'; } catch {}
  let evCount = () => 0;       // nombre d'événements affichables, défini avec l'agenda
  let me = null, meMarker = null, watchId = null, meAcc = Infinity, meAt = 0;

  // ---- Utilitaires ----
  const ago = t => { const m = Math.round((Date.now() - t) / MIN); return m < 1 ? 'à l’instant' : `il y a ${m} min`; };
  const left = exp => { const m = Math.max(0, Math.round((exp - Date.now()) / MIN)); return `${m} min`; };
  const dist = (a, b) => map.distance(a, b);
  const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
  }
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === 'style' ? n.style.cssText = v : n.setAttribute(k, v);
    for (const k of kids) n.append(k);
    return n;
  }

  // ---- Zones calmes suspendues ----
  // Un danger actif (forces de l'ordre ou danger, non contesté) à moins de 100 m suspend la zone calme au lieu de l'effacer :
  // - danger isolé (personne d'autre ne l'a confirmé) : zone barrée avec un avertissement ('sus')
  // - danger confirmé ou vérifié : zone masquée ('hid')
  // Une zone vérifiée par une orga résiste mieux : simple avertissement ('warn') pour un danger isolé, barrée sinon.
  const CALM_M = 100;
  const calmSt = new Map();   // id de la zone calme -> { lvl, near: danger le plus proche, d: distance, ids: dangers voisins }
  const isDangerCat = cat => CAT[cat] && (CAT[cat].group === 'fdo' || CAT[cat].group === 'danger');
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
  // « C'est calme ici » : compte comme un « Plus là » fait sur place pour chaque danger voisin
  async function calmHere(st) {
    const todo = st.ids.filter(id => !voted.has(id));
    for (const id of todo) await vote(id, -1, true, true);
    toast('Merci : le danger voisin est signalé comme parti');
    map.closePopup(); sync();
  }

  // ---- Marqueurs ----
  function icon(r, fresh) {
    const c = CAT[r.cat];
    const age = Date.now() - (r.last || r.t), ttl = c.ttl * MIN;
    const cs = calmSt.get(r.id);
    const cls = ['pin', fresh ? 'fresh' : '', age > ttl * 0.6 ? 'old' : '', r.c ? 'contested' : '', cs ? 'calm-' + cs.lvl : ''].join(' ');
    return L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -18],
      html: `<div class="${cls}${r.ver ? ' ver' : ''}" style="--c:${GROUP_COLOR[c.group]}">${c.glyph}</div>` });
  }
  function popup(r) {
    const c = CAT[r.cat];
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, c.glyph + ' ', c.label));
    const revu = r.last && r.last - r.t >= MIN ? ` · revu ${ago(r.last)}` : '';
    const meta = `${ago(r.t)}${revu} · expire dans ${left(r.exp)}` + (me ? ` · ${fmtDist(dist(me, [r.lat, r.lng]))}` : '');
    root.append(el('div', { class: 'pop-meta' }, meta));
    if (r.up > 0) root.append(el('div', { class: 'pop-count' }, `Signalé par ${r.up + 1} personnes`));
    if (r.ver) root.append(el('div', { class: 'pop-ver' }, '✓ Vérifié par ' + r.ver));
    else if (r.f) root.append(el('div', { class: 'pop-fiable' }, '★ Signalé par un téléphone fiable aujourd’hui (ses signalements sont souvent confirmés)'));
    if (r.nf) root.append(el('div', { class: 'pop-contested' }, 'Non confirmé : signalé depuis un téléphone suspect. Confirme si tu le vois.'));
    const cs = calmSt.get(r.id);
    if (cs) {
      root.append(el('div', { class: 'pop-calm-warn' }, `⚠ ${CAT[cs.near.cat].glyph} ${CAT[cs.near.cat].label} à ${fmtDist(cs.d)}` + (cs.lvl === 'warn' ? ' (pas encore confirmé)' : '') + ' : zone pas sûre pour l’instant.'));
      if (onSite(r) === 'here' && cs.ids.some(id => !voted.has(id))) {
        const b = el('button', { class: 'calm-here' }, '🕊️ C’est calme ici');
        b.onclick = () => { b.disabled = true; calmHere(cs); };
        root.append(b);
      }
    }
    if (r.c) root.append(el('div', { class: 'pop-contested' }, `Contesté : ${r.down} personne${r.down > 1 ? 's disent' : ' dit'} que c’est parti. Confirme si c’est toujours là.`));
    const notes = r.notes && r.notes.length ? r.notes : r.note ? [{ x: r.note, t: r.t }] : [];
    for (const n of notes) root.append(el('p', { class: 'pop-note' }, n.x, el('span', { class: 'pop-note-t' }, ' · ' + ago(n.t))));
    // Ajouter une précision à un point déjà signalé
    const addBtn = el('button', { class: 'link-btn pop-add' }, '＋ Ajouter une précision');
    const form = el('form', { class: 'pop-note-form', hidden: '' });
    const input = el('input', { maxlength: '120', placeholder: notePlaceholder(r.cat), 'aria-label': 'Précision' });
    form.append(input, el('button', { type: 'submit' }, 'Ajouter'));
    addBtn.onclick = () => { addBtn.hidden = true; form.hidden = false; input.focus(); };
    form.onsubmit = e => { e.preventDefault(); sendNote(r.id, input.value); };
    root.append(addBtn, form);
    const yes = el('button', { class: 'yes' }, 'Toujours là');
    // « Plus là » : seulement pour qui est sur place (calculé sur le téléphone, la position ne part pas)
    const where = onSite(r);
    const no = where === 'far' ? el('button', { class: 'no', disabled: '', title: 'Seulement sur place' }, 'Pas sur place') : el('button', { class: 'no' }, 'Plus là');
    if (voted.has(r.id)) yes.disabled = no.disabled = true;
    yes.onclick = () => vote(r.id, 1);
    if (where !== 'far') no.onclick = () => vote(r.id, -1, where === 'here');
    root.append(el('div', { class: 'pop-actions' }, yes, no));
    root.append(el('p', { class: 'pop-hint' }, where === 'far'
      ? `Tu es à ${fmtDist(dist(me, [r.lat, r.lng]))} : seules les personnes sur place peuvent dire que c’est parti.`
      : 'Tu es sur place et tu ne vois plus rien\u00a0? Appuie sur «\u00a0Plus\u00a0là\u00a0».'));
    if (orga) {
      const ok = el('button', { class: 'yes' }, r.ver ? '✓ Vérifié' : '✓ Vérifier (orga)');
      const rm = el('button', { class: 'danger' }, 'Retirer (faux)');
      ok.disabled = !!r.ver;
      ok.onclick = () => orgaAction(r.id, 'verify');
      rm.onclick = () => { if (rm.dataset.armed) orgaAction(r.id, 'remove'); else { rm.dataset.armed = '1'; rm.textContent = 'Confirmer le retrait'; } };
      root.append(el('div', { class: 'pop-actions orga' }, ok, rm));
    }
    return root;
  }
  // Quelqu'un écrit une précision dans un popup : on ne le redessine pas (le texte serait perdu)
  const typingInPopup = () => { const f = document.querySelector('.leaflet-popup .pop-note-form:not([hidden])'); return !!(f && (f.contains(document.activeElement) || f.querySelector('input').value)); };
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
  }
  function refreshUI() { renderFilters(); renderNational(); if (!$('#sheetList').hidden) renderList(); }
  // Rafraîchit l'opacité des points vieillissants
  setInterval(() => {
    computeCalm([...reports.values()].map(x => x.data));
    for (const { data, marker } of reports.values()) if (!marker.isPopupOpen()) marker.setIcon(icon(data, false));
    for (const st of stacks.values()) st.sig = ''; regroup();
  }, 60_000);

  // ---- Synchro : interrogation régulière du serveur (robuste sur hébergement mutualisé) ----
  const POLL_MS = 5000;
  let etag = null, firstSync = true, pollTimer = null, lastOk = 0;
  const status = $('#status');
  const setStatus = (state, txt) => { status.dataset.state = state; status.querySelector('.txt').textContent = txt; };
  // Le serveur ne reçoit que des carrés arrondis (≈ 5 km au plus près), jamais la position exacte.
  function snap(s, w, n, e, g) {
    const f = x => Math.round(x * 1000) / 1000;
    return [f(Math.floor(s / g) * g), f(Math.floor(w / g) * g), f(Math.ceil(n / g) * g), f(Math.ceil(e / g) * g)].join(',');
  }
  function zones() {
    const z = map.getZoom(), b = map.getBounds();
    const g = z >= 11 ? 0.05 : z >= 8 ? 0.5 : 2;
    const out = [snap(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), g)];
    if (me) { const around = snap(me[0] - 0.02, me[1] - 0.03, me[0] + 0.02, me[1] + 0.03, 0.05); if (around !== out[0]) out.push(around); }
    return out;
  }
  let lastZoneKey = '';
  // Applique une liste de signalements + annonces à la carte.
  // isFresh(r) dit si un point inconnu est vraiment nouveau (et pas juste découvert en déplaçant la carte).
  function apply(list, anns, isFresh, canAlertAnns) {
    renderAnns(anns, canAlertAnns);
    const ids = new Set(list.map(r => r.id));
    for (const id of [...reports.keys()]) if (!ids.has(id)) drop(id);
    computeCalm(list);
    for (const r of list) {
      const fresh = !reports.has(r.id) && !firstSync && isFresh(r);
      upsert(r, fresh);
      if (fresh) proximity(r);
    }
    firstSync = false;
    regroup();
    refreshUI();
  }

  // --- Mode principal : fichiers statiques live/ (servis par Apache, Node n'est pas sollicité) ---
  const CELL = 0.05;
  const cellOf = r => `${Math.floor(r.lat / CELL)}_${Math.floor(r.lng / CELL)}`;
  const cellCache = new Map();          // case -> { h, r }
  let allCache = { h: null, r: [] }, annCache = { h: null, a: [] };
  let mode = null, knownCells = new Set(), useApi = false, failures = 0;
  // ---- Réseau faible ----
  // L'appli mesure ses propres requêtes (et ce qu'annonce Chrome sur Android) : si ça rame, elle passe en mode léger.
  const net = { lite: false, samples: [], told: false };
  const conn = navigator.connection;
  const slowHint = () => !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '') || conn.rtt > 1500));
  function netSample(ms, ok) {
    net.samples.push({ ms, ok }); if (net.samples.length > 6) net.samples.shift();
    const last4 = net.samples.slice(-4), bad = last4.filter(x => !x.ok || x.ms > 3000).length;
    if (!net.lite && (slowHint() || bad >= 2)) setLite(true);
    else if (net.lite && !slowHint() && net.samples.length >= 5 && net.samples.slice(-5).every(x => x.ok && x.ms < 1200)) setLite(false);
  }
  function setLite(on) {
    net.lite = on;
    navigator.serviceWorker?.controller?.postMessage({ type: 'lite', on });
    if (on && !net.told) { net.told = true; toast('Réseau faible : mode léger activé (seuls les signalements passent)'); }
    freshness();
  }
  conn?.addEventListener?.('change', () => { if (slowHint() && !net.lite) setLite(true); });
  // Fichiers gardés pour le hors-ligne (agenda, annonces) : dernière version reçue
  const KEEP = /\/live\/(events|ann|legal)\.json$/;
  const dataCache = () => caches.open('cortege-data');
  async function cacheGet(key) { try { const r = await (await dataCache()).match(key); return r ? r.json() : null; } catch { return null; } }
  function cachePut(key, obj) { try { dataCache().then(c => c.put(key, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {}); } catch {} }
  const getJ = (url, ms) => {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms || (net.lite ? 6000 : 12000)), t0 = performance.now();
    return fetch(url, { cache: 'no-cache', signal: ac.signal })
      .then(r => { netSample(performance.now() - t0, true); if (!r.ok) throw Object.assign(new Error(r.status), { status: r.status }); return r.json(); },
        e => { netSample(null, false); throw e; })
      .then(j => { if (KEEP.test(url)) cachePut(url, j); return j; })
      .catch(async e => { if (KEEP.test(url) && !e.status) { const c = await cacheGet(url); if (c) return c; } throw e; })
      .finally(() => clearTimeout(to));
  };
  function neededCells() {
    const b = map.getBounds(), ids = new Set();
    const add = (s, w, n, e) => {
      for (let i = Math.floor(s / CELL); i <= Math.floor(n / CELL); i++)
        for (let j = Math.floor(w / CELL); j <= Math.floor(e / CELL); j++) { ids.add(i + '_' + j); if (ids.size > 80) return false; }
      return true;
    };
    if (!add(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())) return null; // trop dézoomé : vue nationale
    if (me) add(me[0] - 0.02, me[1] - 0.03, me[0] + 0.02, me[1] + 0.03);         // toujours la zone autour de soi (alertes)
    return [...ids];
  }
  function annsFor() {
    const b = map.getBounds(), c = b.getCenter(), viewR = map.distance(c, b.getNorthEast());
    return annCache.a.filter(x => x.exp > Date.now() && (x.national ||
      map.distance(c, [x.lat, x.lng]) < x.r * 1000 + viewR || (me && map.distance(me, [x.lat, x.lng]) < x.r * 1000)));
  }
  async function syncLegal(g) {
    if (!('legal' in g) || legalCache.h === g.legal) return;
    try { legalCache = { h: g.legal, l: g.legal ? (await getJ('/live/legal.json')).l || [] : [] }; } catch {}
  }
  // Sans réseau à l'ouverture : derniers numéros connus (annuaire et legal teams des manifs)
  (async () => {
    const [l, a] = await Promise.all([cacheGet('/live/legal.json'), cacheGet('/live/ann.json')]);
    if (l && !legalCache.h && !legalCache.l.length) legalCache = { h: null, l: l.l || [] };
    if (a && !annCache.h && !annCache.a.length) annCache = { h: null, a: a.a || [] };
  })();
  // Format actuel : g.json (annonces, agenda, pause) + un index par région de 1° autour de la zone affichée.
  // Ces petits fichiers changent rarement : le téléphone reçoit presque toujours un « rien de neuf » (304).
  let lastActivity = 0, legacy = false;
  const regionOf = id => { const [i, j] = id.split('_').map(Number); return `${Math.floor(i / 20)}_${Math.floor(j / 20)}`; };
  const getOpt = (url, empty) => getJ(url).catch(e => { if (e.status === 404) return empty; throw e; });
  // Charge les cases demandées (index de région, puis seulement les cases modifiées)
  async function loadCells(need, now) {
    const regions = [...new Set(need.map(regionOf))];
    const idxs = await Promise.all(regions.map(rg => getOpt('/live/r/' + rg + '.json', { c: {} })));
    const hashes = Object.assign({}, ...idxs.map(x => x.c || {}));
    const prev = knownCells; knownCells = new Set(need);
    await Promise.all(need.map(async id => {
      const h = hashes[id];
      const c = cellCache.get(id);
      if (!h) { if (c && prev.has(id)) lastActivity = now; cellCache.delete(id); return; }
      if (!c || c.h !== h) {
        if (prev.has(id)) lastActivity = now;
        cellCache.set(id, { h, r: (await getOpt('/live/c/' + id + '.json', { r: [] })).r });
      }
    }));
    for (const id of [...cellCache.keys()]) if (!knownCells.has(id)) cellCache.delete(id);
    return { list: need.flatMap(id => cellCache.get(id)?.r || []), prev };
  }
  // Cases autour de soi (≈ 4 km) : toujours chargées, même dézoomé
  function meCells() {
    if (!me) return [];
    const ids = [];
    for (let i = Math.floor((me[0] - 0.02) / CELL); i <= Math.floor((me[0] + 0.02) / CELL); i++)
      for (let j = Math.floor((me[1] - 0.03) / CELL); j <= Math.floor((me[1] + 0.03) / CELL); j++) ids.push(i + '_' + j);
    return ids;
  }
  // Bulles de la vue nationale : une par région d'environ 100 km
  let natCache = { r: [] };
  const natLayer = L.layerGroup().addTo(map);
  function renderNational() {
    natLayer.clearLayers();
    if (mode !== 'nat') return;
    for (const z of natCache.r) {
      const groups = SEVERITY.filter(g => !hidden.has(g) && z.g[g]);
      const n = groups.reduce((s, g) => s + z.g[g], 0);
      if (!n) continue;
      const size = n < 10 ? 40 : n < 100 ? 50 : 60;
      const label = groups.map(g => `${z.g[g]} ${cfg.groups.find(x => x.id === g)?.label.toLowerCase() || g}`).join(' · ');
      const m = L.marker([z.lat, z.lng], { title: label, keyboard: true, zIndexOffset: 200,
        icon: L.divIcon({ className: '', iconSize: [size, size], html: `<div class="cluster nat" style="--c:${GROUP_COLOR[groups[0]]};width:${size}px;height:${size}px">${n}</div>` }) });
      // Zoom sur le cœur de l'activité de la région, assez près pour afficher les vrais points
      m.on('click', () => map.setView([z.lat, z.lng], 12));
      natLayer.addLayer(m);
    }
  }
  // Mode léger : un seul petit fichier par région (≈ 100 km) au lieu de plusieurs requêtes ; l'état général une fois par minute
  const lite = { g: null, gAt: 0 };
  async function syncLite() {
    navigator.serviceWorker?.controller?.postMessage({ type: 'lite', on: true }); // le service worker a pu redémarrer
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    const rgs = new Set([`${Math.floor(ref[0])}_${Math.floor(ref[1])}`, `${Math.floor(c.lat)}_${Math.floor(c.lng)}`]);
    if (!lite.g || now - lite.gAt > 60000) { try { lite.g = await getJ('/live/g.json'); lite.gAt = now; } catch {} }
    const res = await Promise.allSettled([...rgs].map(rg => getJ(`/live/p/${rg}.json`)));
    if (!res.some(x => x.status === 'fulfilled')) throw res[0].reason;
    const list = res.flatMap(x => x.status === 'fulfilled' ? x.value.r || [] : []);
    const wasLite = mode === 'lite'; mode = 'lite';
    if (list.some(r => now - r.t < 15 * MIN)) lastActivity = now;
    let annChanged = false;
    const g = lite.g;
    if (g) {
      setPaused(g.paused); checkBuild(g.build);
      if (g.events && evCache.h !== g.events) { try { evCache = { h: g.events, e: (await getJ('/live/events.json')).e || [] }; renderEvents(); } catch {} }
      if (annCache.h !== g.ann) { try { annCache = { h: g.ann, a: g.ann ? (await getJ('/live/ann.json')).a : [] }; annChanged = true; } catch {} }
      await syncLegal(g);
    }
    apply(list.filter(r => r.exp > now), annsFor(), () => wasLite, annChanged && !firstSync);
  }
  async function syncLive() {
    if (net.lite) return syncLite();
    if (legacy) return syncLegacy();
    let g;
    try { g = await getJ('/live/g.json'); }
    catch (e) { if (e.status === 404) { legacy = true; return syncLegacy(); } throw e; }
    const need = neededCells(), now = Date.now();
    let list, isFresh;
    // Vue nationale : des compteurs par région (n.json, quelques Ko) au lieu de tous les points,
    // plus les vrais points autour de toi pour que les alertes de proximité continuent de marcher.
    const nat = need === null ? await getOpt('/live/n.json', null) : null;
    if (need === null && nat && Array.isArray(nat.r)) {
      natCache = nat;
      const wasNat = mode === 'nat';
      const out = await loadCells(meCells(), now);
      list = out.list; isFresh = r => wasNat && out.prev.has(cellOf(r)); mode = 'nat';
    } else if (need === null) {
      // ancien serveur : tous les points
      const all = (await getJ('/live/all.json')).r || [];
      const sig = all.length + ':' + all.reduce((m, r) => Math.max(m, r.t), 0);
      if (allCache.h !== sig) { if (allCache.h) lastActivity = now; allCache = { h: sig, r: all }; }
      const wasAll = mode === 'all';
      list = allCache.r; isFresh = () => wasAll; mode = 'all';
    } else {
      const wasCells = mode === 'cells';
      const out = await loadCells(need, now);
      list = out.list; isFresh = r => wasCells && out.prev.has(cellOf(r)); mode = 'cells';
      // Un signalement de moins de 15 min autour de toi : ça bouge, on reste au rythme rapide
      if (list.some(r => now - r.t < 15 * 60_000)) lastActivity = now;
    }
    setPaused(g.paused); checkBuild(g.build);
    if (g.events && evCache.h !== g.events) { evCache = { h: g.events, e: (await getJ('/live/events.json')).e || [] }; renderEvents(); }
    const annChanged = annCache.h !== g.ann;
    if (annChanged) { if (annCache.h) lastActivity = now; annCache = { h: g.ann, a: g.ann ? (await getJ('/live/ann.json')).a : [] }; }
    await syncLegal(g);
    apply(list.filter(r => r.exp > now), annsFor(), isFresh, annChanged && !firstSync);
  }

  // Ancien format (serveur pas encore mis à jour)
  async function syncLegacy() {
    const idx = await getJ('/live/index.json');
    if (!idx || !idx.cells) throw Object.assign(new Error('index'), { status: 404 });
    const need = neededCells(), now = Date.now();
    let list, isFresh;
    if (need === null) {
      if (allCache.h !== idx.all) allCache = { h: idx.all, r: (await getJ('/live/all.json')).r };
      const wasAll = mode === 'all';
      list = allCache.r; isFresh = () => wasAll; mode = 'all';
    } else {
      const prev = knownCells; knownCells = new Set(need);
      await Promise.all(need.map(async id => {
        const h = idx.cells[id];
        if (!h) { cellCache.delete(id); return; }
        const c = cellCache.get(id);
        if (!c || c.h !== h) cellCache.set(id, { h, r: (await getJ('/live/c/' + id + '.json')).r });
      }));
      for (const id of [...cellCache.keys()]) if (!knownCells.has(id)) cellCache.delete(id);
      list = need.flatMap(id => cellCache.get(id)?.r || []);
      isFresh = r => mode === 'cells' && prev.has(cellOf(r)); mode = 'cells';
    }
    setPaused(idx.paused); checkBuild(idx.build);
    if (idx.events && evCache.h !== idx.events) { evCache = { h: idx.events, e: (await getJ('/live/events.json')).e || [] }; renderEvents(); }
    const annChanged = annCache.h !== idx.ann;
    if (annChanged) annCache = { h: idx.ann, a: (await getJ('/live/ann.json')).a };
    apply(list.filter(r => r.exp > now), annsFor(), isFresh, annChanged && !firstSync);
  }

  // --- Repli : ancienne API (si live/ n'est pas disponible) ---
  async function syncApi() {
    const zs = zones(), key = zs.join('|');
    const sameZone = key === lastZoneKey;
    if (!sameZone) etag = null;
    const res = await fetch('/api/reports?' + zs.map(z => 'bbox=' + z).join('&'), { headers: etag ? { 'If-None-Match': etag } : {}, cache: 'no-store' });
    if (res.status === 304) return;
    if (!res.ok) throw new Error(res.status);
    etag = res.headers.get('ETag');
    const { reports: list, announcements: anns = [] } = await res.json();
    if (anns.length) annCache = { h: annCache.h, a: [...annCache.a.filter(x => !anns.some(y => y.id === x.id)), ...anns] };
    lastZoneKey = key;
    apply(list, anns, () => sameZone, sameZone);
  }

  // ---- Mise à jour automatique : nouvelle version publiée (fichiers + Restart) ----
  // Si la personne est en train de signaler ou d'écrire, on ne l'interrompt pas : bandeau, puis mise à jour dès qu'elle a fini.
  let buildSeen = null, updating = false;
  function busyNow() {
    const a = document.activeElement;
    return !$('#crosshair').hidden || !$('#noteCard').hidden || typingInPopup() || !!(a && a.matches && a.matches('input, textarea, select'))
      || sheets.some(s => s !== '#sheetInfo' && !$(s).hidden);
  }
  function reloadForUpdate() {
    try { const c = map.getCenter(); sessionStorage.setItem('cortege-view', JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() })); } catch {}
    location.reload();
  }
  function checkBuild(b) {
    if (!b) return;
    if (!buildSeen) { buildSeen = b; return; }
    if (b === buildSeen || updating) return;
    updating = true;
    navigator.serviceWorker?.getRegistration?.().then(r => r && r.update()).catch(() => {});
    const bar = el('div', { class: 'update-bar', role: 'status' }, 'Nouvelle version de Cortège');
    const btn = el('button', {}, 'Mettre à jour');
    btn.onclick = reloadForUpdate; bar.append(btn); document.body.append(bar);
    // Dès que la personne ne fait rien de particulier (ou passe l'appli en arrière-plan), on met à jour
    const tryNow = () => { if (document.hidden || !busyNow()) { bar.textContent = 'Mise à jour de Cortège…'; setTimeout(reloadForUpdate, 1200); return true; } return false; };
    if (!tryNow()) { const t = setInterval(() => { if (tryNow()) clearInterval(t); }, 4000); document.addEventListener('visibilitychange', () => { if (document.hidden) reloadForUpdate(); }); }
  }

  // Pause décidée par l'admin (afflux de faux signalements) : on le dit et on bloque le bouton
  let pausedUntil = 0;
  function setPaused(until) {
    pausedUntil = until || 0;
    const on = pausedUntil > Date.now();
    $('#pauseBanner').hidden = !on;
    const btn = $('#btnReport');
    btn.disabled = on;
    if (on) { closeReport(); btn.textContent = 'Signalements en pause'; }
    else if ($('#crosshair').hidden) btn.textContent = 'Signaler';
  }
  let syncing = false, again = false;
  async function sync() {
    clearTimeout(pollTimer);
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      if (useApi) await syncApi();
      else {
        try { await syncLive(); }
        catch (e) { if (e.status === 404) { useApi = true; await syncApi(); } else throw e; }
      }
      failures = 0; lastOk = Date.now(); dataAt = lastOk; saveSnapshot();
      setStatus('live', net.lite ? 'En direct · mode léger' : 'En direct');
      if (!$('#queueChip').hidden) setTimeout(() => flushQueue(), 0);
    } catch {
      failures++;
      setStatus('offline', Date.now() - lastOk > 15000 ? 'Hors ligne — nouvel essai…' : 'Connexion instable…');
      if (!fallbackTried) { fallbackTried = true; useFallback(); }
    }
    syncing = false;
    if (again) { again = false; return sync(); }
    // Rythme : 5 s s'il s'est passé quelque chose autour de toi dans les 2 dernières minutes, 12 s sinon,
    // 20 s en vue nationale (×3 en économie de batterie) ; on espace en cas d'échec, et on décale au hasard
    // pour que des milliers de téléphones ne demandent pas tous à la même seconde.
    const active = Date.now() - lastActivity < 120_000;
    const base = (mode === 'all' || mode === 'nat' ? 20000 : active ? POLL_MS : 12000) * (eco ? 3 : 1);
    const delay = (failures ? Math.min(60000, base * 2 ** Math.min(failures, 3)) : base) * (0.85 + Math.random() * 0.3);
    if (!document.hidden) pollTimer = setTimeout(sync, delay);
  }
  // ---- Dernière situation connue (hors ligne) ----
  // Après chaque synchro réussie, on garde les points affichés sur le téléphone. Sans réseau à l'ouverture,
  // l'appli les remontre (ceux qui ne sont pas expirés), avec l'heure, et y ajoute ceux reçus par notification.
  let dataAt = 0, fallbackTried = false, snapAt = 0;
  function saveSnapshot() {
    if (Date.now() - snapAt < 30000) return; snapAt = Date.now();
    cachePut('/__snap', { at: Date.now(), r: [...reports.values()].map(x => x.data).slice(0, 500) });
  }
  const unpack = d => d.r.map(([id, cat, lat, lng, t, last, exp, up, fl]) => ({ id, cat, lat, lng, t: t * 1000, last: last * 1000, exp: exp * 1000, up, down: 0,
    ver: fl & 1 ? 'une orga' : null, notes: [], note: '', ...(fl & 2 ? { c: 1 } : {}), ...(fl & 4 ? { f: 1 } : {}), ...(fl & 8 ? { nf: 1 } : {}) })).filter(r => CAT[r.cat]);
  function mergeIn(rows, at) {
    if (!rows.length || at <= dataAt) return;
    const now = Date.now(), cur = new Map([...reports.values()].map(x => [x.data.id, x.data]));
    for (const r of rows) cur.set(r.id, r);
    dataAt = at;
    apply([...cur.values()].filter(r => r.exp > now), annsFor(), () => false, false);
    freshness();
  }
  async function useFallback() {
    const snap = await cacheGet('/__snap'), push = await cacheGet('/__push');
    if (snap && snap.r) mergeIn(snap.r, snap.at);
    if (push && push.r) mergeIn(unpack(push), push.at * 1000);
  }
  // Données arrivées avec une notification pendant que l'appli est ouverte mais sans réseau
  navigator.serviceWorker?.addEventListener?.('message', async e => {
    if (e.data && e.data.type === 'push-data' && Date.now() - lastOk > 20000) { const p = await cacheGet('/__push'); if (p && p.r) mergeIn(unpack(p), p.at * 1000); }
  });
  // Bandeau : mode léger, ou âge de la dernière situation connue
  const agoTxt = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  function freshness() {
    const bar = $('#netBar'); if (!bar) return;
    const stale = dataAt && Date.now() - dataAt > 60000;
    if (stale) { bar.hidden = false; bar.textContent = `${navigator.onLine === false || !net.lite ? '📴 Pas de réseau' : '📶 Réseau très faible'} · dernière situation connue ${agoTxt(dataAt)}`; }
    else if (net.lite) { bar.hidden = false; bar.textContent = `📶 Réseau faible : mode léger · mis à jour ${dataAt ? agoTxt(dataAt) : '…'}`; }
    else bar.hidden = true;
    bar.classList.toggle('stale', !!stale);
  }
  setInterval(freshness, 15000);

  let moveTimer = null;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(sync, 400); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); else clearTimeout(pollTimer); });
  sync();

  // ---- Alerte de proximité ----
  function proximity(r) {
    if (!me || !ALERT_CATS.has(r.cat) || hidden.has(CAT[r.cat].group)) return;
    const d = dist(me, [r.lat, r.lng]);
    const somm = r.cat === 'sommations';
    if (d > (somm ? 1000 : ALERT_RADIUS)) return; // les sommations alertent dans un rayon d'1 km
    const c = CAT[r.cat];
    const box = $('#alert');
    box.className = 'alert' + (c.group === 'fdo' || somm ? ' fdo' : '');
    box.textContent = somm ? `${c.glyph} Sommations à ${fmtDist(d)} : rester devient un délit. Éloigne-toi par une rue dégagée.` : `${c.glyph} ${c.label} à ${fmtDist(d)} de toi`;
    box.hidden = false;
    box.onclick = () => { box.hidden = true; const m = markerOf(r.id); if (m) layer.zoomToShowLayer(m, () => m.openPopup()); };
    // Chaque danger a sa vibration (même motif que dans les notifications)
    try { navigator.vibrate?.((cfg.vibes && cfg.vibes[r.cat]) || [200, 100, 200]); } catch {}
    clearTimeout(proximity.t); proximity.t = setTimeout(() => (box.hidden = true), 9000);
  }

  // ---- Géolocalisation + suivi + boussole (tout reste sur l'appareil) ----
  // ◎ gris : pas localisé · ◎ plein : la carte te suit · ◎ contour : localisé, carte libre (appuie pour te recentrer)
  let follow = false, heading = null, compassOn = false, gpsHeading = null, accCircle = null;
  const btnLoc = $('#btnLocate');
  function setFollow(on) {
    follow = on;
    btnLoc.dataset.state = !me ? (watchId != null ? 'searching' : 'off') : on ? 'follow' : 'free';
    btnLoc.setAttribute('aria-pressed', String(on));
    btnLoc.title = on ? 'La carte te suit' : 'Me recentrer';
  }
  function meIcon() {
    return L.divIcon({ className: '', iconSize: [64, 64], iconAnchor: [32, 32],
      html: '<div class="me-wrap"><div class="me-cone" hidden></div><div class="me"></div></div>' });
  }
  function drawHeading() {
    const cone = meMarker?.getElement()?.querySelector('.me-cone');
    if (!cone) return;
    const h = heading ?? gpsHeading;
    cone.hidden = h == null;
    if (h != null) cone.style.transform = `rotate(${h}deg)`;
  }
  // Boussole : iPhone (webkitCompassHeading, autorisation requise), Android (deviceorientationabsolute)
  let rawHeading = null, rafPending = false;
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading;
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    h = (h + so + 360) % 360;
    // lissage circulaire pour éviter que le cône tremble
    if (rawHeading == null) rawHeading = h;
    else { const d = ((h - rawHeading + 540) % 360) - 180; rawHeading = (rawHeading + d * 0.25 + 360) % 360; }
    heading = Math.round(rawHeading);
    if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; drawHeading(); }); }
  }
  async function enableCompass() {
    if (eco || compassOn || typeof DeviceOrientationEvent === 'undefined') return;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') { // iPhone : doit venir d'un appui
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch { return; }
    }
    compassOn = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient, true);
    else window.addEventListener('deviceorientation', onOrient, true);
  }
  function onPosition(p) {
    const first = !me;
    me = [p.coords.latitude, p.coords.longitude]; meAcc = Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : Infinity; meAt = Date.now();
    // Cap GPS quand on marche (secours si pas de boussole)
    gpsHeading = p.coords.speed > 0.8 && p.coords.heading != null && !isNaN(p.coords.heading) ? p.coords.heading : gpsHeading;
    if (!meMarker) meMarker = L.marker(me, { icon: meIcon(), interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map);
    else meMarker.setLatLng(me);
    const acc = Math.min(p.coords.accuracy || 0, 500);
    if (!accCircle) accCircle = L.circle(me, { radius: acc, interactive: false, className: 'me-acc' }).addTo(map);
    else accCircle.setLatLng(me).setRadius(acc);
    drawHeading();
    if (pushSub) pushSend(pushSub).catch(() => {});
    if (first) { map.setView(me, Math.max(map.getZoom(), 17)); setFollow(true); }
    else if (follow && $('#sheetReport').hidden && !popupOpen && !drawing && !picking) map.panTo(me, { animate: true, duration: 0.6, noMoveStart: true });
    else setFollow(follow);
  }
  function locate() {
    enableCompass(); // appelé depuis un appui : l'iPhone peut demander l'autorisation
    if (!navigator.geolocation) return toast('Géolocalisation indisponible sur cet appareil.');
    if (watchId != null) {
      if (me) { map.setView(me, Math.max(map.getZoom(), 16)); setFollow(true); }
      return;
    }
    watchId = navigator.geolocation.watchPosition(onPosition, err => {
      // Seul un refus coupe la localisation ; une perte de signal passagère (fréquente dehors) ne change rien.
      if (err.code === 1) {
        toast('Localisation refusée. Tu peux quand même signaler avec le viseur.');
        navigator.geolocation.clearWatch(watchId); watchId = null; setFollow(false);
      } else if (!me && !locate.warned) { locate.warned = true; toast('Recherche de ta position…'); }
    }, eco ? { enableHighAccuracy: false, maximumAge: 30_000, timeout: 60_000 } : { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
    setFollow(false);
  }
  // Déplacer la carte au doigt arrête le suivi ; une fiche de signalement ouverte le met en pause
  let popupOpen = false;
  map.on('popupopen', () => (popupOpen = true)); map.on('popupclose', () => (popupOpen = false));
  map.on('dragstart', () => { if (follow) setFollow(false); });
  btnLoc.onclick = locate;
  setFollow(false);
  // Si l'autorisation a déjà été donnée, on centre directement sur toi
  try { navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') locate(); }).catch(() => {}); } catch {}
  // Android n'a pas besoin d'autorisation pour la boussole : on l'allume dès le premier appui n'importe où
  document.addEventListener('pointerdown', () => { if (me) enableCompass(); }, { once: true, passive: true });

  // ---- Recherche de ville ----
  let searchTimer = null;
  $('#btnSearch').onclick = () => { closeReport(); closeSheets(); $('#sheetSearch').hidden = false; setTimeout(() => $('#searchInput').focus(), 50); };
  $('#ssClose').onclick = () => closeSheets();
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch(); });
  $('#searchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 600); });
  async function runSearch() {
    const q = $('#searchInput').value.trim(), out = $('#searchResults');
    if (q.length < 2) { out.textContent = ''; return; }
    out.textContent = 'Recherche…';
    try {
      const res = await fetch('/api/geocode?q=' + encodeURIComponent(q));
      const list = await res.json();
      out.textContent = '';
      if (!res.ok) { out.textContent = list.error || 'Recherche indisponible.'; return; }
      if (!list.length) { out.textContent = 'Aucun lieu trouvé en France.'; return; }
      for (const p of list) {
        const b = el('button', { class: 'result' }, p.name);
        b.onclick = () => {
          closeSheets();
          if (p.bbox) map.fitBounds([[p.bbox[0], p.bbox[2]], [p.bbox[1], p.bbox[3]]], { maxZoom: 15 });
          else map.setView([p.lat, p.lng], 14);
        };
        out.append(el('li', {}, b));
      }
    } catch { out.textContent = 'Pas de réseau.'; }
  }

  // ---- Filtres ----
  function renderFilters() {
    const box = $('#filters'); box.textContent = '';
    for (const g of cfg.groups) {
      const n = mode === 'nat' ? natCache.r.reduce((s, z) => s + (z.g[g.id] || 0), 0) : [...reports.values()].filter(x => CAT[x.data.cat].group === g.id && !calmHidden(x.data)).length;
      const b = el('button', { class: 'chip', style: `--c:${GROUP_COLOR[g.id]}`, 'aria-pressed': String(!hidden.has(g.id)) }, g.label, ' ', el('span', { class: 'n' }, String(n)));
      b.onclick = () => {
        hidden.has(g.id) ? hidden.delete(g.id) : hidden.add(g.id);
        regroup();
        refreshUI();
      };
      box.append(b);
    }
    // Agenda : manifs, blocus, AG… affichés sur la carte
    const ev = el('button', { class: 'chip chip-ev', style: '--c:var(--accent)', 'aria-pressed': String(!evHidden), title: 'Afficher ou masquer les événements de l’agenda sur la carte' },
      '📅 Agenda ', el('span', { class: 'n' }, String(evCount())));
    ev.onclick = () => {
      evHidden = !evHidden;
      try { localStorage.setItem('cortege-ev-hidden', evHidden ? '1' : '0'); } catch {}
      renderEvents(); renderFilters();
      toast(evHidden ? 'Événements de l’agenda masqués sur la carte' : 'Événements de l’agenda affichés');
    };
    box.append(ev);
  }
  renderFilters();

  // ---- Signaler ----
  const sheets = ['#sheetReport', '#sheetList', '#sheetInfo', '#sheetSearch', '#sheetShare', '#sheetRights', '#sheetOrga', '#sheetAgenda', '#sheetEvent', '#sheetSos', '#sheetPrep', '#sheetQueue', '#sheetNotif'];
  const closeSheets = () => sheets.forEach(s => ($(s).hidden = true));
  // Fond assombri derrière les feuilles : un appui dessus ferme la feuille (sauf « Signaler », qui a besoin de la carte)
  const backdrop = $('#backdrop');
  const syncBackdrop = () => {
    backdrop.hidden = !sheets.some(s => s !== '#sheetReport' && !$(s).hidden);
    if ($('#sheetEvent').hidden && !drawing) drawLayer.clearLayers();
  };
  const sheetWatch = new MutationObserver(syncBackdrop);
  sheets.forEach(s => sheetWatch.observe($(s), { attributes: true, attributeFilter: ['hidden'] }));
  backdrop.addEventListener('click', () => closeSheets());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { map.closePopup(); closeSheets(); if (!$('#crosshair').hidden) closeReport(); } });
  function openReport() {
    if (!me && map.getZoom() < 14) {
      toast('Zoome sur l’endroit exact (ou active ta position) avant de signaler.');
      $('#btnSearch').focus();
      return;
    }
    closeSheets();
    $('#crosshair').hidden = false;
    $('#btnReport').classList.add('active');
    $('#btnReport').textContent = 'Annuler';
    $('#srHint').textContent = me ? 'Le viseur est sur ta position. Déplace la carte si c’est ailleurs.' : 'Place le viseur au bon endroit sur la carte, puis choisis.';
    $('#sheetReport').hidden = false;
    // Le viseur se place au milieu de la zone de carte encore visible au-dessus de la feuille
    const y = aimY();
    $('#crosshair').style.top = y + 'px';
    if (me) { map.setView(me, Math.max(map.getZoom(), 17), { animate: false }); map.panBy([0, map.getSize().y / 2 - y], { animate: false }); }
    catHints();
  }
  // Sous le viseur, un point du même type existe déjà : le bouton l'indique, et l'envoyer le confirmera
  function catHints() {
    if ($('#crosshair').hidden) return;
    const p = target(), list = [...reports.values()].map(x => x.data);
    document.querySelectorAll('#catGrid .cat').forEach(b => {
      const cat = b.dataset.cat, R = mergeR(cat);
      const hit = list.filter(r => r.cat === cat && r.exp > Date.now()).map(r => ({ r, d: dist(p, [r.lat, r.lng]) })).filter(x => x.d <= R).sort((a, b) => a.d - b.d)[0];
      b.classList.toggle('exists', !!hit);
      b.querySelector('.sub').textContent = hit ? `déjà là · ${ago(hit.r.last || hit.r.t).replace('il y a ', '')} · confirmer` : '';
      b.setAttribute('aria-label', CAT[cat].label + (hit ? ', déjà signalé, appuyer pour confirmer' : ''));
    });
  }
  map.on('move', () => { if (!$('#crosshair').hidden) { cancelAnimationFrame(catHints.f); catHints.f = requestAnimationFrame(catHints); } });
  function aimY() {
    const top = 60, sheetTop = $('#sheetReport').getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
    return Math.round(top + (Math.min(sheetTop, map.getSize().y) - top) / 2);
  }
  function closeReport() {
    $('#crosshair').hidden = true; $('#sheetReport').hidden = true;
    $('#btnReport').classList.remove('active'); $('#btnReport').textContent = 'Signaler';
  }
  $('#btnReport').onclick = () => ($('#crosshair').hidden ? openReport() : closeReport());
  $('#srClose').onclick = closeReport;

  (function buildGrid() {
    const grid = $('#catGrid');
    for (const g of cfg.groups) {
      grid.append(el('div', { class: 'group-title' }, g.label));
      const row = el('div', { class: 'row' });
      for (const c of cfg.categories.filter(c => c.group === g.id)) {
        const b = el('button', { class: 'cat', 'data-cat': c.id, style: `--c:${GROUP_COLOR[g.id]}` }, el('span', { class: 'g', 'aria-hidden': 'true' }, c.glyph), c.label, el('span', { class: 'sub' }));
        b.onclick = () => submit(c.id);
        row.append(b);
      }
      grid.append(row);
    }
  })();

  // Point visé = position du viseur à l'écran
  const target = () => map.containerPointToLatLng([map.getSize().x / 2, aimY()]);
  // ---- File d'attente hors ligne ----
  // Un signalement fait sans réseau est gardé sur le téléphone avec son heure, puis envoyé dès que ça capte.
  // Le serveur le fusionne s'il existe déjà, et le refuse s'il a dépassé sa durée de vie.
  const queue = (() => {
    let mem = [], dbp = null;
    const open = () => dbp ||= new Promise((res, rej) => {
      const o = indexedDB.open('cortege', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('queue', { keyPath: 'k' });
      o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error);
    });
    const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('queue', mode), r = fn(t.objectStore('queue'));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    }));
    return {
      all: () => run('readonly', st => st.getAll()).then(x => x || []).catch(() => mem.slice()),
      add: it => run('readwrite', st => st.put(it)).catch(() => { mem.push(it); }),
      del: k => run('readwrite', st => st.delete(k)).catch(() => { mem = mem.filter(x => x.k !== k); }),
    };
  })();
  const rid = () => { const b = new Uint8Array(9); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); };
  // Réponse inexploitable (pas de réseau, serveur hôte saturé sans message) : on garde pour plus tard
  async function postReport(it) {
    const res = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE },
      body: JSON.stringify({ cat: it.cat, lat: it.lat, lng: it.lng, note: it.note, t: it.t }) });
    const body = await res.json().catch(() => null);
    if (!body && res.status >= 500) throw new Error('indisponible');
    return { status: res.status, body: body || {} };
  }
  function resultText(it, { status, body }) {
    const label = CAT[it.cat].label;
    if (status === 201) return `${label} signalé`;
    if (status === 200 && body.merged) return body.self ? 'Tu l’avais déjà signalé : point mis à jour' : `Déjà signalé : ta confirmation est ajoutée (${body.up + 1} personnes)`;
    return body.error || 'Envoi impossible. Réessaie.';
  }
  async function updateQueueChip() {
    const n = (await queue.all()).length, chip = $('#queueChip');
    chip.hidden = !n; chip.textContent = `⏳ ${n}`;
    chip.setAttribute('aria-label', `${n} signalement${n > 1 ? 's' : ''} en attente de réseau`);
    if (!$('#sheetQueue').hidden) renderQueue();
    return n;
  }
  async function renderQueue() {
    const ol = $('#queueList'); ol.textContent = '';
    const items = (await queue.all()).sort((a, b) => a.t - b.t);
    $('#queueEmpty').hidden = items.length > 0;
    for (const it of items) {
      const c = CAT[it.cat], expired = it.t + c.ttl * MIN <= Date.now();
      const cancel = el('button', { class: 'q-cancel', 'aria-label': 'Annuler ce signalement' }, 'Annuler');
      cancel.onclick = async () => { await queue.del(it.k); updateQueueChip(); };
      ol.append(el('li', {}, el('span', { class: 'g', style: `--c:${GROUP_COLOR[c.group]}` }, c.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, c.label), el('div', { class: 's' }, expired ? 'Trop ancien, ne sera pas publié' : `fait ${ago(it.t)}`)), cancel));
    }
  }
  let flushing = false;
  async function flushQueue(manual = false) {
    if (flushing) return;
    flushing = true;
    let sent = 0, stale = 0, msg = '';
    try {
      for (const it of (await queue.all()).sort((a, b) => a.t - b.t)) {
        if (it.t + CAT[it.cat].ttl * MIN <= Date.now()) { await queue.del(it.k); stale++; continue; }
        let out;
        try { out = await postReport(it); } catch { if (manual) msg = 'Toujours pas de réseau.'; break; }
        await queue.del(it.k);
        if (out.status === 410) stale++;
        else if (out.status < 300) { sent++; voted.add(out.body.id); }
        else msg = out.body.error || '';
      }
    } finally { flushing = false; }
    const n = await updateQueueChip();
    const parts = [];
    if (sent) parts.push(sent > 1 ? `${sent} signalements en attente envoyés` : 'Signalement en attente envoyé');
    if (stale) parts.push(stale > 1 ? `${stale} trop anciens, pas publiés` : '1 trop ancien, pas publié');
    if (parts.length || msg) toast(parts.join(' · ') || msg);
    if (sent) { lastActivity = Date.now(); sync(); }
    return n;
  }
  async function submit(cat) {
    const p = target();
    const it = { k: rid(), cat, lat: p.lat, lng: p.lng, note: '', t: Date.now(), dev: DEVICE, ttl: CAT[cat].ttl * MIN };
    let out;
    try { out = await postReport(it); }
    catch {
      await queue.add(it);
      closeReport();
      updateQueueChip();
      // Android : le téléphone l'enverra même appli fermée ; ailleurs, au retour du réseau ou à la réouverture
      try { (await navigator.serviceWorker?.ready)?.sync?.register('cortege-queue').catch(() => {}); } catch {}
      return toast('Pas de réseau : signalement gardé, il partira dès que ça capte.');
    }
    if (out.status >= 300) return toast(resultText(it, out));
    voted.add(out.body.id);
    closeReport();
    lastActivity = Date.now();
    sync();
    openNoteCard(out.body.id, cat, resultText(it, out));
  }
  // ---- Précisions ----
  const NOTE_HINTS = { fdo: 'ex. : une vingtaine, remontent vers la gare', danger: 'ex. : le nuage s’étend vers la place',
    soutien: 'ex. : sous l’abribus, côté nord', info: 'ex. : barrières, passage par la rue d’à côté' };
  function notePlaceholder(cat) { return NOTE_HINTS[CAT[cat]?.group] || 'Ajouter une précision'; }
  async function sendNote(id, text) {
    text = String(text || '').trim();
    if (text.length < 2) return toast('Écris une précision.');
    try {
      const res = await fetch(`/api/reports/${id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify({ note: text }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return toast(body.error || 'Envoi impossible.');
      toast('Précision ajoutée'); map.closePopup(); closeNoteCard(); sync();
    } catch { toast('Pas de réseau.'); }
  }
  // Carte « Ajouter une précision ? » juste après un signalement : l'envoi n'attend pas qu'on écrive
  let noteFor = null;
  function openNoteCard(id, cat, title) {
    noteFor = id;
    $('#noteTitle').textContent = '✓ ' + title;
    $('#noteInput').value = ''; $('#noteInput').placeholder = notePlaceholder(cat);
    $('#noteCard').hidden = false;
    clearTimeout(openNoteCard.t);
    openNoteCard.t = setTimeout(() => { if (document.activeElement !== $('#noteInput') && !$('#noteInput').value) closeNoteCard(); }, 12000);
  }
  function closeNoteCard() { $('#noteCard').hidden = true; noteFor = null; clearTimeout(openNoteCard.t); }
  $('#noteClose').onclick = closeNoteCard;
  $('#noteCard').addEventListener('submit', e => { e.preventDefault(); if (noteFor) sendNote(noteFor, $('#noteInput').value); });
  $('#queueChip').onclick = () => { closeReport(); closeSheets(); renderQueue(); $('#sheetQueue').hidden = false; };
  $('#sqClose').onclick = () => closeSheets();
  $('#btnQueueRetry').onclick = () => flushQueue(true);
  addEventListener('online', () => flushQueue());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  navigator.serviceWorker?.addEventListener?.('message', e => {
    if (e.data && e.data.type === 'queue-flushed') { updateQueueChip(); sync(); }
    if (e.data && e.data.type === 'goto') { const at = atParam(e.data.url); if (at) { setFollow(false); map.setView(at, 17); sync(); } }
  });
  updateQueueChip().then(n => { if (n) flushQueue(); });

  // Sur place ? 'here' (position récente et précise, à moins de 400 m), 'far' (nettement plus loin), sinon null (on ne sait pas)
  const NEAR_M = 400;
  function onSite(r) {
    if (!me || Date.now() - meAt > 5 * MIN) return null;
    const d = dist(me, [r.lat, r.lng]), acc = Math.min(meAcc, 300);
    if (d - acc > NEAR_M) return 'far';
    return d <= NEAR_M && meAcc <= 300 ? 'here' : null;
  }
  async function vote(id, v, here = false, quiet = false) {
    voted.add(id);
    try {
      const res = await fetch(`/api/reports/${id}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE }, body: JSON.stringify(v === 1 ? { v } : { v, here }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) { voted.delete(id); return quiet || toast(body.error || 'Vote impossible.'); }
      if (quiet) return;
      toast(v === 1 ? 'Merci, signalement prolongé' : 'Merci, c’est noté');
      map.closePopup();
      sync();
    } catch { voted.delete(id); if (!quiet) toast('Pas de réseau.'); }
  }

  // ---- Liste ----
  function renderList() {
    const ol = $('#list'); ol.textContent = '';
    const view = map.getBounds();
    const items = [...reports.values()].map(x => x.data).filter(r => !hidden.has(CAT[r.cat].group) && !calmHidden(r) && view.contains([r.lat, r.lng]));
    items.sort(me ? (a, b) => dist(me, [a.lat, a.lng]) - dist(me, [b.lat, b.lng]) : (a, b) => b.t - a.t);
    $('#listEmpty').hidden = items.length > 0;
    for (const r of items) {
      const c = CAT[r.cat];
      const btn = el('button', { 'aria-label': c.label },
        el('span', { class: 'g', style: `--c:${GROUP_COLOR[c.group]}` }, c.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, c.label), el('div', { class: 's' }, r.note || (r.up ? `${ago(r.last || r.t)} · ${r.up + 1} personnes` : ago(r.t)))),
        el('span', { class: 'd' }, me ? fmtDist(dist(me, [r.lat, r.lng])) : ago(r.last || r.t).replace('il y a ', '')));
      btn.onclick = () => { closeSheets(); const m = markerOf(r.id); if (m) layer.zoomToShowLayer(m, () => m.openPopup()); };
      ol.append(el('li', {}, btn));
    }
  }
  $('#btnList').onclick = () => { closeReport(); closeSheets(); renderList(); $('#sheetList').hidden = false; };
  $('#slClose').onclick = () => closeSheets();
  $('#btnInfo').onclick = () => { closeReport(); closeSheets(); $('#sheetInfo').hidden = false; };
  $('#siClose').onclick = () => closeSheets();

  // ---- Installation sur l'écran d'accueil (PWA) ----
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Twitter|LinkedInApp|Snapchat/i.test(ua);
  let installEvent = null;
  function showInstall(withTool) {
    if (standalone) return;
    $('#installBox').hidden = false;
    if (withTool) $('#btnInstallTool').hidden = false;
  }
  function hideInstall() { $('#installBox').hidden = true; $('#btnInstallTool').hidden = true; }
  function installHelp(html) { const p = $('#installHelp'); p.innerHTML = html; p.hidden = false; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; showInstall(true); });
  window.addEventListener('appinstalled', () => { installEvent = null; hideInstall(); toast('Appli installée sur ton écran d’accueil'); });
  if (!standalone) showInstall(isIOS || inApp);
  async function doInstall() {
    closeReport(); closeSheets(); $('#sheetInfo').hidden = false;
    if (installEvent) {
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice.catch(() => ({}));
      installEvent = null;
      if (outcome === 'accepted') hideInstall(); else $('#btnInstallTool').hidden = true;
      return;
    }
    if (inApp) return installHelp('Tu es dans le navigateur d’une appli (Instagram, TikTok…), qui ne peut pas installer Cortège. Touche le menu <b>⋯</b> en haut à droite puis <b>Ouvrir dans le navigateur</b>, et recommence depuis là.');
    if (isIOS) return installHelp('Sur iPhone, dans <b>Safari</b> : touche le bouton <b>Partager</b> (le carré avec une flèche vers le haut), puis <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.');
    installHelp('Ouvre le menu de ton navigateur (<b>⋮</b>) puis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.');
  }
  $('#btnInstall').onclick = doInstall;
  $('#btnInstallTool').onclick = doInstall;

  // ---- Annonces orga (bandeaux) ----
  let dismissed = new Set();
  try { dismissed = new Set(JSON.parse(localStorage.getItem('cortege-dismissed') || '[]')); } catch {}
  const seenAnns = new Set();
  function renderAnns(list, canAlert) {
    announcements = list;
    const box = $('#anns'); box.textContent = '';
    const shown = list.filter(a => a.kind === 'info' && !dismissed.has(a.id))
      .sort((a, b) => (b.level === 'urgent') - (a.level === 'urgent') || b.t - a.t);
    const maxBanners = innerHeight < 760 ? 2 : 3; // petits écrans : ne pas masquer les boutons
    for (const a of shown.slice(0, maxBanners)) {
      const close = el('button', { class: 'ann-x', 'aria-label': 'Masquer cette annonce' }, '×');
      close.onclick = () => { dismissed.add(a.id); try { localStorage.setItem('cortege-dismissed', JSON.stringify([...dismissed].slice(-200))); } catch {} renderAnns(announcements, false); };
      box.append(el('div', { class: 'ann ' + a.level },
        el('div', { class: 'ann-meta' }, '📣 ' + a.by + (a.national ? ' · toute la France' : '') + ' · ' + ago(a.t)),
        el('div', { class: 'ann-text' }, a.text),
        a.link ? el('a', { class: 'ann-link', href: a.link, target: '_blank', rel: 'noopener noreferrer' }, 'En savoir plus →') : '', close));
      if (canAlert && !seenAnns.has(a.id) && a.level === 'urgent') { try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch {} }
    }
    if (shown.length > maxBanners) box.append(el('div', { class: 'ann-more' }, `+ ${shown.length - maxBanners} autre(s) annonce(s)`));
    list.forEach(a => seenAnns.add(a.id));
    renderLegal();
    if (!$('#sheetOrga').hidden) renderOrgaList();
  }

  // ---- Mes droits : numéros des legal teams ----
  // Deux sources : l'annuaire permanent (vérifié par l'admin) et les numéros publiés par les orgas pour une manif.
  // Regroupés par ville, la plus proche de toi (ou du centre de la carte) en premier ; les autres villes en dessous.
  const normCity = c => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const dayFr = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const kmTxt = m => m < 1000 ? 'ici' : m < 10000 ? 'à ' + (m / 1000).toFixed(1).replace('.', ',') + ' km' : 'à ' + Math.round(m / 1000) + ' km';
  function legalGroups() {
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    const rows = [
      ...legalCache.l.map(e => ({ ...e, dir: true })),
      ...annCache.a.filter(a => a.kind === 'legal' && a.exp > now && !a.pending)
        .map(a => ({ id: a.id, city: a.city || '', lat: a.lat, lng: a.lng, name: a.by, phone: a.phone, text: a.text, t: a.t, dir: false })),
    ];
    const groups = new Map();
    for (const e of rows) {
      const d = map.distance(ref, [e.lat, e.lng]);
      const key = normCity(e.city) || '@' + e.id;
      const g = groups.get(key) || { city: e.city || 'Autour de ce point', d: Infinity, items: [] };
      g.items.push({ ...e, d }); groups.set(key, g);
    }
    // Distance d'une ville : celle de l'annuaire s'il la connaît (un numéro de manif peut avoir été posé loin de sa ville)
    for (const g of groups.values()) { const ref = g.items.some(x => x.dir) ? g.items.filter(x => x.dir) : g.items; g.d = Math.min(...ref.map(x => x.d)); }
    // Dans une ville : l'annuaire d'abord, puis les numéros de manif (les plus récents en premier)
    for (const g of groups.values()) g.items.sort((a, b) => (b.dir - a.dir) || (b.t || 0) - (a.t || 0));
    return [...groups.values()].sort((a, b) => a.d - b.d);
  }
  function legalRow(a, compact) {
    const num = a.phone;
    const call = el('a', { class: 'legal-call', href: 'tel:' + num.replace(/[^\d+]/g, '') }, 'Appeler');
    const copy = el('button', { class: 'legal-copy' }, 'Copier');
    copy.onclick = async () => { try { await navigator.clipboard.writeText(num); toast('Numéro copié'); } catch { toast(num); } };
    const meta = a.dir
      ? el('span', { class: 'legal-meta' }, 'Annuaire' + (a.checked ? ' · vérifié le ' + dayFr(a.checked) : ''),
          a.src ? el('a', { href: a.src, target: '_blank', rel: 'noopener noreferrer' }, ' · source') : '')
      : el('span', { class: 'legal-meta' }, 'Pour la mobilisation · publié ' + ago(a.t));
    return el('div', { class: 'legal-row' + (compact ? ' compact' : '') },
      el('div', { class: 'legal-who' }, el('b', {}, a.name), a.text ? el('span', {}, a.text) : '', meta),
      el('div', { class: 'legal-num' }, num, a.signal ? el('span', { class: 'legal-sig', title: 'Joignable sur Signal' }, 'Signal') : ''),
      el('div', { class: 'legal-actions' }, call, copy));
  }
  function renderLegal() {
    const box = $('#legalList'), other = $('#legalOtherList'); box.textContent = ''; other.textContent = '';
    const groups = legalGroups(), first = groups[0];
    $('#legalNone').hidden = !!first;
    $('#legalOther').hidden = groups.length < 2;
    if (!first) { $('#legalTitle').textContent = 'Legal team'; return; }
    const far = first.d > 80000;
    $('#legalTitle').textContent = far ? `Aucune legal team connue près de toi · la plus proche : ${first.city} (${kmTxt(first.d)})`
      : `Legal team · ${first.city}${first.d >= 5000 ? ' (' + kmTxt(first.d) + ')' : ''}`;
    for (const a of first.items) box.append(legalRow(a, false));
    $('#legalOtherSum').textContent = `Autres villes (${groups.length - 1})`;
    for (const g of groups.slice(1)) {
      other.append(el('div', { class: 'legal-city' }, g.city, el('span', {}, kmTxt(g.d))));
      for (const a of g.items) other.append(legalRow(a, true));
    }
  }
  const nearestLegal = () => legalGroups()[0]?.items[0] || null;
  $('#btnRights').onclick = () => { closeReport(); closeSheets(); renderLegal(); $('#sheetRights').hidden = false; };
  $('#rgClose').onclick = () => closeSheets();

  // ---- Partage par QR code (généré sur le téléphone, marche hors ligne) ----
  const shareUrl = location.origin + '/';
  function openShare() {
    closeReport(); closeSheets();
    if (!openShare.done && window.qrcode) {
      const q = qrcode(0, 'M'); q.addData(shareUrl); q.make();
      $('#qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
      openShare.done = true;
    }
    $('#qrUrl').textContent = shareUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('#btnNativeShare').hidden = !navigator.share;
    $('#sheetShare').hidden = false;
    try { navigator.wakeLock?.request('screen').catch(() => {}); } catch {}
  }
  $('#btnShare').onclick = openShare;
  $('#btnShareTop').onclick = openShare;
  $('#shClose').onclick = () => closeSheets();
  $('#btnNativeShare').onclick = () => navigator.share?.({ title: 'Cortège', text: 'La carte en direct des manifs, par @' + (cfg.brand?.handle || 'neru'), url: shareUrl }).catch(() => {});
  $('#btnCopyLink').onclick = async () => { try { await navigator.clipboard.writeText(shareUrl); toast('Lien copié'); } catch { toast(shareUrl); } };

  // ---- Espace orga / legal team ----
  // Le lien orga ressemble à https://cortege.neru.tv/?orga=CLÉ : la clé est gardée sur ce téléphone et retirée de l'adresse.
  const orgaKey = () => { try { return localStorage.getItem('cortege-orga') || ''; } catch { return ''; } };
  async function orgaFetch(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Orga-Key': orgaKey(), ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) { setOrga(null); try { localStorage.removeItem('cortege-orga'); } catch {} }
    if (!res.ok) throw new Error(body.error || 'Action impossible.');
    return body;
  }
  function setOrga(o) {
    orga = o;
    $('#btnOrga').hidden = !o;
    $('#orgaChip').hidden = !o;
    if (o) { $('#orgaChip').textContent = o.admin ? 'ADMIN' : o.trial ? 'ORGA · essai' : 'ORGA'; $('#orgaChip').title = o.label; $('#orgaName').textContent = o.label; }
    $('#orgaTrial').hidden = !(o && o.trial);
    $('#annNationalWrap').hidden = !(o && o.admin);
    $('#btnPropose').textContent = o ? 'Publier une manif ou un blocus' : 'Proposer un blocus ou une manif';
    $('#agFine').hidden = !!o;
  }
  (async () => {
    const params = new URLSearchParams(location.search);
    if (params.has('orga')) {
      try { localStorage.setItem('cortege-orga', params.get('orga')); } catch {}
      history.replaceState(null, '', location.pathname);
    }
    var justJoined = false;
    // Invitation par QR code : échangée une seule fois contre une clé, créée et gardée sur ce téléphone
    if (params.has('invite')) {
      const token = params.get('invite');
      history.replaceState(null, '', location.pathname);
      try {
        const res = await fetch('/api/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { toast(body.error || 'Invitation impossible.'); }
        else { try { localStorage.setItem('cortege-orga', body.key); } catch {} toast(body.device ? 'Appareil ajouté à l’espace orga ' + body.label : 'Bienvenue ' + body.label + ' : ton accès orga est activé sur ce téléphone'); justJoined = !body.device; }
      } catch { toast('Pas de réseau : rouvre l’invitation quand ça capte.'); }
    }
    if (!orgaKey()) return;
    try {
      const who = await orgaFetch('/api/orga/me'); setOrga(who);
      // Premier accès : on ouvre l'espace orga pour que l'avertissement sur la perte d'accès soit lu
      if (justJoined) setTimeout(() => $('#btnOrga').click(), 600); else toast('Mode orga : ' + who.label);
    }
    catch (e) { toast(e.message); }
  })();
  async function orgaAction(id, action) {
    try {
      const out = await orgaFetch(`/api/reports/${id}/${action}`, { method: 'POST', body: '{}' });
      toast(action === 'verify' ? 'Signalement marqué vérifié' : out && out.removed ? 'Signalement retiré' : 'Pris en compte : vaut deux « Plus là » (période d’essai)');
      map.closePopup(); etag = null; sync();
    } catch (e) { toast(e.message); }
  }
  // Mes annonces (l'admin voit tout), y compris les numéros en attente de validation
  let mineAnns = null;
  async function loadMine() {
    if (!orga) return;
    try { mineAnns = (await orgaFetch('/api/orga/mine')).a || []; } catch { mineAnns = null; }
    if (!$('#sheetOrga').hidden) renderOrgaList();
  }
  function renderOrgaList() {
    const ol = $('#annList'); ol.textContent = '';
    const list = mineAnns || announcements;
    $('#annListTitle').textContent = mineAnns ? (orga && orga.admin ? 'Toutes les annonces actives' : 'Tes annonces actives') : 'Annonces actives ici';
    if (!list.length) { ol.append(el('li', { class: 'empty' }, mineAnns ? 'Aucune annonce publiée.' : 'Aucune annonce active ici.')); return; }
    for (const a of list) {
      const mine = orga && (orga.admin || a.by === orga.label);
      const del = el('button', { class: 'ghost' }, 'Retirer');
      del.disabled = !mine;
      del.onclick = async () => { try { await orgaFetch('/api/announcements/' + a.id, { method: 'DELETE' }); toast('Annonce retirée'); etag = null; sync(); loadMine(); } catch (e) { toast(e.message); } };
      ol.append(el('li', { class: 'ann-row' },
        el('div', { class: 't' }, el('div', { class: 'l' }, (a.pending ? '⏳ ' : '') + (a.kind === 'legal' ? '⚖ ' + (a.city ? a.city + ' · ' : '') + a.phone : (a.level === 'urgent' ? '⚠ ' : '') + a.text)),
          el('div', { class: 's' }, a.pending ? 'En attente de validation par l’admin : pas encore visible dans « Mes droits »'
            : `${a.by} · ${a.national ? 'toute la France' : (a.kind === 'legal' ? 'visible partout, rangé par ville' : a.r + ' km')} · ${a.permanent ? 'permanent' : 'expire dans ' + left(a.exp)}`)), del));
    }
  }
  $('#btnOrga').onclick = () => { closeReport(); closeSheets(); renderOrgaList(); renderOrgaExtras(); loadMine(); $('#sheetOrga').hidden = false; };
  // ---- Parrainage, appareils, avertissement sur l'accès ----
  const fmtExp = t => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function showInviteOut(title, token, exp, fine) {
    const url = location.origin + '/?invite=' + token;
    $('#inviteTitle').textContent = title + ' (valable jusqu’au ' + fmtExp(exp) + ', une seule fois)';
    $('#inviteUrl').textContent = url; $('#inviteQr').textContent = '';
    if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#inviteQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
    $('#inviteFine').textContent = fine;
    $('#inviteShare').hidden = !navigator.share;
    $('#inviteOut').hidden = false; $('#inviteOut').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('#inviteCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#inviteUrl').textContent); toast('Lien copié'); } catch { toast($('#inviteUrl').textContent); } };
  $('#inviteShare').onclick = () => navigator.share?.({ title: 'Cortège', text: 'Lien à usage unique, à ouvrir sur le bon appareil :', url: $('#inviteUrl').textContent }).catch(() => {});
  async function renderOrgaExtras() {
    $('#inviteOut').hidden = true;
    let me = orga;
    try { me = await orgaFetch('/api/orga/me'); setOrga({ ...orga, ...me }); } catch { return; }
    $('#orgaRecover').textContent = me.sponsor
      ? `Pour retrouver un accès, il faudra une nouvelle invitation de ${me.sponsor} ou de l’admin, ce qui coupe l’ancien.`
      : 'Pour retrouver un accès, il faudra une nouvelle invitation de l’admin, ce qui coupe l’ancien.';
    $('#orgaAccessWarn').hidden = !!me.admin;
    $('#orgaSponsored').hidden = !me.sponsored;
    if (me.sponsored) $('#orgaSponsored').textContent = `Orga parrainée par ${me.sponsor || 'une autre orga'} : surveillance renforcée jusqu’à ta confirmation. « Vérifier » compte comme une confirmation forte (le point reste contestable), 5 retraits par 5 minutes et 3 annonces par jour au maximum. Après 7 jours et 10 actions sans incident, ${me.sponsor || 'ta marraine'} ou l’admin pourra te confirmer.`;
    // Appareils
    $('#btnAddDevice').hidden = !me.canAddDevice;
    $('#deviceState').textContent = me.canAddDevice
      ? `${me.devices || 1} appareil(s) ont accès à cet espace orga (5 au plus). Ajouter un appareil crée un lien valable 10 minutes, à ouvrir sur l’autre appareil (ordinateur, deuxième téléphone…). Cet appareil-ci garde son accès.`
      : 'Ton accès est défini directement dans les réglages du serveur : demande à l’admin pour un autre appareil.';
    // Invitations
    const box = $('#orgaInviteBox');
    box.hidden = !!me.trial;
    if (me.trial) return;
    $('#orgaInviteForm').hidden = !me.canInvite;
    renderFilleules(me);
  }
  async function renderFilleules(me) {
    const ul = $('#filleulList'); ul.textContent = '';
    if (me && me.ban) ul.append(el('li', {}, '⛔ Invitations suspendues jusqu’au ' + fmtExp(me.ban) + ' : une orga que tu as invitée a été révoquée pour abus.'));
    let d; try { d = await orgaFetch('/api/orga/filleules'); } catch (e) { return; }
    if (!d.orgas.length && !(me && me.ban)) { ul.append(el('li', { class: 'st' }, 'Aucune orga invitée pour l’instant.')); return; }
    for (const o of d.orgas) {
      const status = !o.trial ? '✓ confirmée' : !o.active ? (o.invite ? 'invitation en attente' : 'invitation expirée') : o.ready ? 'prête à être confirmée' : `parrainée · ${o.days} j · ${o.actions} action(s)`;
      const li = el('li', {}, el('b', {}, o.label), el('span', { class: o.ready && o.trial ? 'ready' : 'st' }, status
        + (o.trial && o.active && !o.ready ? ` (il faut 7 j et 10 actions${o.bursts || o.restored ? ', et aucun incident : ' + (o.bursts ? o.bursts + ' rafale(s) bloquée(s) ' : '') + (o.restored ? o.restored + ' retrait(s) annulé(s) par l’admin' : '') : ''})` : '')));
      if (o.recent.length) {
        const det = el('details', {}, el('summary', {}, 'Dernières actions'));
        for (const x of o.recent) det.append(el('div', {}, new Date(x.t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + x.action + (x.cat && CAT[x.cat] ? ' ' + CAT[x.cat].glyph : '')));
        li.append(det);
      }
      const btns = el('div', { class: 'row-btns' });
      if (o.trial && o.ready) {
        const c = el('button', { class: 'secondary' }, 'Confirmer cette orga');
        c.onclick = async () => { try { await orgaFetch(`/api/orga/filleules/${o.id}/confirm`, { method: 'POST', body: '{}' }); toast(o.label + ' est confirmée'); renderFilleules(me); } catch (e) { toast(e.message); } };
        btns.append(c);
      }
      const inv = el('button', { class: 'secondary' }, o.active ? 'Nouvelle invitation (accès perdu)' : 'Nouvelle invitation');
      inv.onclick = async () => {
        if (o.active && !inv.dataset.armed) { inv.dataset.armed = '1'; inv.textContent = 'Confirmer : son accès actuel sera coupé'; return; }
        try { const r = await orgaFetch(`/api/orga/filleules/${o.id}/invite`, { method: 'POST', body: '{}' }); showInviteOut('Invitation pour ' + r.label, r.invite, r.exp, 'Envoie-la par une messagerie chiffrée (Signal). L’ancien accès de cette orga est coupé.'); renderFilleules(me); } catch (e) { toast(e.message); }
      };
      btns.append(inv); li.append(btns); ul.append(li);
    }
  }
  $('#orgaInviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await orgaFetch('/api/orga/invite', { method: 'POST', body: JSON.stringify({ label: $('#orgaInviteLabel').value }) });
      $('#orgaInviteLabel').value = '';
      showInviteOut('Invitation pour ' + r.label, r.invite, r.exp, 'L’orga scanne ce QR code ou ouvre le lien sur son téléphone. Envoie le lien par une messagerie chiffrée (Signal), jamais publiquement.');
      renderFilleules(orga);
    } catch (err) { toast(err.message); }
  });
  $('#btnAddDevice').onclick = async () => {
    try { const r = await orgaFetch('/api/orga/device', { method: 'POST', body: '{}' }); showInviteOut('Ajouter un appareil', r.invite, r.exp, 'Scanne ce QR code avec l’autre appareil (ou ouvre-y le lien). Ne l’envoie à personne d’autre : il donne accès à ton espace orga.'); }
    catch (e) { toast(e.message); }
  };
  $('#orClose').onclick = () => closeSheets();
  document.querySelectorAll('input[name="kind"]').forEach(r => r.addEventListener('change', () => {
    const legal = document.querySelector('input[name="kind"]:checked').value === 'legal';
    $('#annInfoFields').hidden = legal; $('#annLegalFields').hidden = !legal;
    $('#annMinutesWrap').hidden = legal; $('#annLegalHint').hidden = !legal;
    annZoneUI();
  }));
  // Annonce nationale (admin) : pas de rayon
  const annZoneUI = () => { $('#annRadiusWrap').hidden = $('#annInfoFields').hidden || $('#annNational').checked; };
  $('#annNational').addEventListener('change', annZoneUI);
  $('#annForm').addEventListener('submit', async e => {
    e.preventDefault();
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const c = map.getCenter();
    const body = { kind, lat: c.lat, lng: c.lng, radiusKm: +$('#annRadius').value, minutes: +$('#annMinutes').value };
    if (kind === 'legal') Object.assign(body, { phone: $('#annPhone').value, text: $('#annLegalText').value, city: $('#annCity').value });
    else Object.assign(body, { text: $('#annText').value, level: document.querySelector('input[name="level"]:checked').value,
      national: !!(orga && orga.admin && $('#annNational').checked) });
    try {
      const out = await orgaFetch('/api/announcements', { method: 'POST', body: JSON.stringify(body) });
      toast(out && out.pending ? 'Numéro envoyé : il s’affichera après validation par l’admin' : 'Annonce publiée');
      $('#annText').value = ''; $('#annPhone').value = ''; $('#annLegalText').value = ''; $('#annCity').value = ''; $('#annNational').checked = false; annZoneUI();
      etag = null; sync(); loadMine();
    } catch (err) { toast(err.message); }
  });
  $('#btnOrgaLogout').onclick = () => {
    const b = $('#btnOrgaLogout');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirmer : l’accès sera perdu sur cet appareil (il faudra une nouvelle invitation)'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Quitter le mode orga sur ce téléphone'; }, 6000); return; }
    try { localStorage.removeItem('cortege-orga'); } catch {} setOrga(null); closeSheets(); toast('Mode orga désactivé sur ce téléphone');
  };

  // ---- Agenda : manifs, blocus, rassemblements, AG ----
  const EVT = Object.fromEntries((cfg.eventTypes || []).map(t => [t.id, t]));
  const evLayer = L.layerGroup().addTo(map);
  const evMarkers = new Map();
  let selectedEv = null;
  const fmtWhen = t => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtHour = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Sur la carte : les événements du moment (de 12 h avant à 10 h après le départ), plus celui choisi dans l'agenda
  // Masqués par le filtre « Agenda » sauf celui que la personne vient d'ouvrir dans l'agenda
  const evOnMap = e => e.id === selectedEv || (!evHidden && map.getZoom() >= 9 && e.start - 12 * 60 * MIN < Date.now() && e.start + 10 * 60 * MIN > Date.now());
  evCount = () => evCache.e.filter(e => map.getZoom() >= 9 && e.start - 12 * 60 * MIN < Date.now() && e.start + 10 * 60 * MIN > Date.now()).length;
  map.on('zoomend', () => { const z = map.getZoom() >= 9; if (z !== evOnMap.z) { evOnMap.z = z; renderEvents(); } });
  function evPopup(e) {
    const t = EVT[e.type] || { glyph: '📍', label: '' };
    const root = el('div');
    root.append(el('div', { class: 'pop-title' }, t.glyph + ' ', e.title));
    root.append(el('div', { class: 'pop-meta' }, `${t.label} · ${fmtWhen(e.start)}`));
    root.append(el('div', { class: 'pop-meta' }, '📍 ' + e.place + (me ? ' · ' + fmtDist(dist(me, [e.lat, e.lng])) : '')));
    if (e.note) root.append(el('p', { class: 'pop-note' }, e.note));
    root.append(el('div', { class: 'pop-meta' }, 'Publié par ' + e.by));
    if (e.link) root.append(el('a', { class: 'ann-link', href: e.link, target: '_blank', rel: 'noopener noreferrer' }, 'Voir la carte d’origine →'));
    if (orga && (orga.admin || e.by === orga.label)) {
      const rm = el('button', { class: 'danger' }, 'Retirer cet événement');
      rm.onclick = async () => {
        if (!rm.dataset.armed) { rm.dataset.armed = '1'; rm.textContent = 'Confirmer le retrait'; return; }
        try { await orgaFetch('/api/events/' + e.id, { method: 'DELETE' }); toast('Événement retiré'); map.closePopup(); sync(); } catch (err) { toast(err.message); }
      };
      root.append(el('div', { class: 'pop-actions orga', style: 'grid-template-columns:1fr' }, rm));
    }
    return root;
  }
  function renderEvents() {
    evLayer.clearLayers(); evMarkers.clear();
    for (const e of evCache.e.filter(evOnMap)) {
      const t = EVT[e.type] || { glyph: '📍' };
      if (e.route) {
        L.polyline(e.route, { color: '#ec9fa4', weight: 5, opacity: .9, dashArray: '10 8', interactive: false }).addTo(evLayer);
        if (e.end) L.marker(e.route[e.route.length - 1], { icon: L.divIcon({ className: '', iconSize: [30, 30], html: '<div class="ev-end">🏁</div>' }), title: 'Dispersion prévue', keyboard: false })
          .bindPopup(() => el('div', {}, 'Dispersion prévue : ' + e.title)).addTo(evLayer);
      }
      const m = L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18], html: `<div class="ev-pin">${t.glyph}</div>` }),
        title: e.title, zIndexOffset: 500 }).bindPopup(() => evPopup(e)).addTo(evLayer);
      evMarkers.set(e.id, m);
    }
    if (!$('#sheetAgenda').hidden) renderAgenda();
    renderFilters();
  }
  function renderAgenda() {
    const scope = document.querySelector('input[name="agScope"]:checked').value;
    const c = map.getCenter(), ref = me || [c.lat, c.lng], now = Date.now();
    let list = evCache.e.filter(e => e.start + 3 * 60 * MIN > now);
    if (scope === 'near') list = list.filter(e => dist(ref, [e.lat, e.lng]) <= 50_000);
    list.sort((a, b) => a.start - b.start);
    const ol = $('#agList'); ol.textContent = '';
    $('#agEmpty').hidden = list.length > 0;
    $('#agEmpty').textContent = scope === 'all' ? 'Aucune mobilisation annoncée pour l’instant.'
      : me ? 'Rien d’annoncé à moins de 50 km de toi. Regarde « Toute la France ».' : 'Rien d’annoncé à moins de 50 km du centre de la carte. Active ta position ou regarde « Toute la France ».';
    let day = '';
    if (list.length > 200) ol.append(el('li', { class: 'ag-day' }, `${list.length} événements : les 200 premiers`));
    for (const e of list.slice(0, 200)) {
      const d = e.start < now ? 'En cours' : new Date(e.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (d !== day) { day = d; ol.append(el('li', { class: 'ag-day' }, d)); }
      const t = EVT[e.type] || { glyph: '📍' };
      const btn = el('button', { 'aria-label': e.title },
        el('span', { class: 'g', style: '--c:var(--accent)' }, t.glyph),
        el('span', { class: 't' }, el('div', { class: 'l' }, e.title), el('div', { class: 's' }, `${fmtHour(e.start)} · ${e.place} · ${e.by}`)),
        el('span', { class: 'd' }, fmtDist(dist(ref, [e.lat, e.lng]))));
      btn.onclick = () => showEvent(e);
      ol.append(el('li', {}, btn));
    }
  }
  function showEvent(e) {
    closeSheets(); setFollow(false);
    selectedEv = e.id; renderEvents();
    if (e.route) map.fitBounds(L.latLngBounds(e.route.concat([[e.lat, e.lng]])), { padding: [40, 40], maxZoom: 16 });
    else map.setView([e.lat, e.lng], 16);
    setTimeout(() => evMarkers.get(e.id)?.openPopup(), 350);
  }
  $('#btnAgenda').onclick = () => { closeReport(); closeSheets(); renderAgenda(); $('#sheetAgenda').hidden = false; };
  $('#agClose').onclick = () => closeSheets();
  document.querySelectorAll('input[name="agScope"]').forEach(r => r.addEventListener('change', renderAgenda));

  // ---- Publier (orga) ou proposer (tout le monde) un événement, avec parcours tracé sur la carte ----
  const draft = { route: [] };
  let evAsOrga = false, drawing = false;
  const drawLayer = L.layerGroup().addTo(map);
  (function buildEvTypes() {
    const box = $('#evTypes');
    (cfg.eventTypes || []).forEach((t, i) => {
      const input = el('input', { type: 'radio', name: 'evType', value: t.id }); input.checked = i === 0;
      box.append(el('label', {}, input, ' ' + t.glyph + ' ' + t.label));
    });
  })();
  const localInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function routeLength(r) { let m = 0; for (let i = 1; i < r.length; i++) m += map.distance(r[i - 1], r[i]); return m; }
  function redrawDraft() {
    drawLayer.clearLayers();
    const r = draft.route, n = r.length;
    if (n > 1) L.polyline(r, { color: '#ec9fa4', weight: 5, interactive: false }).addTo(drawLayer);
    r.forEach((p, i) => L.marker(p, { interactive: false, keyboard: false,
      icon: i === 0 ? L.divIcon({ className: '', iconSize: [38, 38], html: '<div class="ev-pin">📍</div>' }) : L.divIcon({ className: '', iconSize: [14, 14], html: '<div class="draw-pt"></div>' }) }).addTo(drawLayer));
    $('#drawCount').textContent = !n ? 'Aucun point' : n === 1 ? 'Rendez-vous placé' : `Rendez-vous + ${n - 1} point${n > 2 ? 's' : ''} de parcours`;
    $('#evRouteState').textContent = !n ? 'Touche la carte pour placer le rendez-vous, puis, si tu veux, les points du parcours.'
      : n === 1 ? 'Rendez-vous placé, sans parcours.' : `Rendez-vous placé, parcours de ${fmtDist(routeLength(r))}.`;
    $('#btnDraw').textContent = n ? 'Modifier sur la carte' : 'Placer le rendez-vous sur la carte';
  }
  function openEventForm(asOrga) {
    closeReport(); closeSheets();
    evAsOrga = asOrga;
    $('#evTitle').textContent = asOrga ? 'Publier un événement' : 'Proposer une mobilisation';
    $('#evSubmit').textContent = asOrga ? 'Publier' : 'Envoyer la proposition';
    if (!$('#evStart').value) { const d = new Date(Date.now() + 60 * MIN); d.setMinutes(0, 0, 0); $('#evStart').value = localInput(d); }
    redrawDraft();
    $('#sheetEvent').hidden = false;
  }
  function startDraw() {
    closeSheets(); setFollow(false); map.closePopup();
    drawing = true; document.body.classList.add('drawing'); $('#drawBar').hidden = false;
    if (!draft.route.length && me) map.setView(me, Math.max(map.getZoom(), 16));
    redrawDraft();
  }
  function stopDraw() { drawing = false; document.body.classList.remove('drawing'); $('#drawBar').hidden = true; $('#sheetEvent').hidden = false; redrawDraft(); }
  map.on('click', e => { if (!drawing) return; if (draft.route.length < 300) draft.route.push([e.latlng.lat, e.latlng.lng]); redrawDraft(); });
  $('#btnDraw').onclick = startDraw;
  $('#drawUndo').onclick = () => { draft.route.pop(); redrawDraft(); };
  $('#drawClear').onclick = () => { draft.route = []; redrawDraft(); };
  $('#drawDone').onclick = stopDraw;
  $('#evClose').onclick = () => closeSheets();
  $('#btnPropose').onclick = () => openEventForm(!!orga);
  $('#btnOrgaEvent').onclick = () => openEventForm(true);
  $('#evForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!draft.route.length) { toast('Place d’abord le rendez-vous sur la carte.'); return; }
    const start = new Date($('#evStart').value).getTime();
    if (!start) { toast('Choisis la date et l’heure.'); return; }
    const [lat, lng] = draft.route[0];
    const body = { type: document.querySelector('input[name="evType"]:checked').value, title: $('#evTitleIn').value, place: $('#evPlace').value,
      note: $('#evNote').value, start, lat, lng, route: draft.route.length >= 2 ? draft.route : null, end: $('#evEnd').checked };
    const headers = { 'Content-Type': 'application/json', 'X-Device': DEVICE };
    if (evAsOrga) headers['X-Orga-Key'] = orgaKey();
    try {
      const res = await fetch('/api/events', { method: 'POST', headers, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return toast(out.error || 'Envoi impossible.');
      toast(out.status === 'ok' ? 'Événement publié' : 'Proposition envoyée : elle apparaîtra après vérification');
      $('#evForm').reset(); $('#evStart').value = ''; draft.route = []; drawLayer.clearLayers();
      document.querySelector('input[name="evType"]').checked = true;
      closeSheets();
      if (out.status === 'ok') { selectedEv = out.id; sync(); }
    } catch { toast('Pas de réseau. Rien n’est parti.'); }
  });

  // ---- Interpellation : prévenir un proche (le message part du téléphone, rien ne passe par le serveur) ----
  const sosGet = () => { try { return JSON.parse(localStorage.getItem('cortege-sos') || 'null'); } catch { return null; } };
  function sosMessage() {
    const who = document.querySelector('input[name="sosWho"]:checked').value;
    const hour = fmtHour(Date.now()).replace(':', ' h ');
    let s = who === 'me' ? `Je viens d’être interpellé·e (${hour})` : `Quelqu’un de mon groupe vient d’être interpellé·e (${hour})`;
    if (me) { const la = me[0].toFixed(4), lo = me[1].toFixed(4); s += ` ici : https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`; }
    const legal = nearestLegal();
    s += legal && legal.d < 80000 ? `. Préviens la legal team : ${legal.phone} (${legal.name}).` : '. Préviens la legal team de la manif.';
    s += ' Message envoyé avec Cortège.';
    return s;
  }
  function sosLink() {
    const c = sosGet(); if (!c) return;
    const num = c.phone.replace(/[^\d+]/g, '');
    $('#sosSms').href = `sms:${num}${isIOS ? '&' : '?'}body=${encodeURIComponent($('#sosMsg').value)}`;
  }
  function openSos() {
    closeReport(); closeSheets();
    const c = sosGet();
    $('#sosSetup').hidden = !!c; $('#sosReady').hidden = !c;
    if (c) { $('#sosTo').textContent = c.name || c.phone; $('#sosMsg').value = sosMessage(); sosLink(); }
    else { $('#sosName').value = ''; $('#sosPhone').value = ''; }
    $('#sheetSos').hidden = false;
  }
  $('#btnSos').onclick = openSos;
  $('#btnSosRights').onclick = openSos;
  $('#sosClose').onclick = () => closeSheets();
  $('#sosForm').addEventListener('submit', e => {
    e.preventDefault();
    const phone = $('#sosPhone').value.trim();
    if (phone.replace(/\D/g, '').length < 6) return toast('Numéro invalide.');
    try { localStorage.setItem('cortege-sos', JSON.stringify({ name: $('#sosName').value.trim().slice(0, 30), phone })); } catch { return toast('Impossible d’enregistrer sur ce téléphone.'); }
    toast('Contact enregistré sur ce téléphone'); openSos();
  });
  $('#sosEdit').onclick = () => { const c = sosGet() || {}; $('#sosSetup').hidden = false; $('#sosReady').hidden = true; $('#sosName').value = c.name || ''; $('#sosPhone').value = c.phone || ''; };
  $('#sosMsg').addEventListener('input', sosLink);
  document.querySelectorAll('input[name="sosWho"]').forEach(r => r.addEventListener('change', () => { $('#sosMsg').value = sosMessage(); sosLink(); }));
  $('#sosShare').onclick = () => {
    const text = $('#sosMsg').value;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('Message copié : colle-le dans ta messagerie'), () => toast(text));
  };

  // ---- Économie de batterie ----
  const ecoBadge = el('span', { class: 'eco', title: 'Économie de batterie', 'aria-label': 'Économie de batterie' }, '🔋');
  $('#status').append(ecoBadge);
  function applyEco() {
    ecoBadge.hidden = !eco;
    $('#optEco').checked = eco;
    if (eco && compassOn) {
      window.removeEventListener('deviceorientationabsolute', onOrient, true); window.removeEventListener('deviceorientation', onOrient, true);
      compassOn = false; heading = null; rawHeading = null; drawHeading();
    }
    // relance le GPS avec les nouveaux réglages
    if (watchId != null) { const f = follow; navigator.geolocation.clearWatch(watchId); watchId = null; locate(); setFollow(f); }
  }
  $('#optEco').addEventListener('change', e => {
    eco = e.target.checked;
    try { localStorage.setItem('cortege-eco', eco ? '1' : '0'); } catch {}
    applyEco(); sync();
    toast(eco ? 'Économie de batterie activée' : 'Économie de batterie désactivée');
  });
  ecoBadge.hidden = !eco; $('#optEco').checked = eco;
  try {
    navigator.getBattery?.().then(b => {
      const check = () => { if (!eco && !b.charging && b.level <= 0.2 && !check.done) { check.done = true; toast('Batterie faible : active l’économie de batterie dans « ? »'); } };
      check(); b.addEventListener('levelchange', check);
    }).catch(() => {});
  } catch {}

  // ---- Notifications : annonces urgentes et dangers près de toi, même appli fermée ----
  const pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!cfg.pushKey;
  const b64u = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  let pushZone = null; try { pushZone = localStorage.getItem('cortege-push-zone'); } catch {}
  // Réglages : annonces urgentes (oui par défaut, comme avant) et dangers près de toi
  let pushOpts = { urgent: true, near: false }; try { pushOpts = { ...pushOpts, ...JSON.parse(localStorage.getItem('cortege-push-opts') || '{}') }; } catch {}
  const savePushOpts = () => { try { localStorage.setItem('cortege-push-opts', JSON.stringify(pushOpts)); } catch {} };
  function bellState() {
    const on = !!pushSub; $('#btnNotif').dataset.on = on ? '1' : '0';
    $('#btnNotif .ico').textContent = on ? '🔔' : '🔕'; $('#notifSub').textContent = on ? 'Activées sur ce téléphone' : 'Pas encore activées';
  }
  // Le serveur ne reçoit qu'une zone arrondie à 0,1° (≈ 10 km), mise à jour quand tu changes de zone
  async function pushSend(sub, force) {
    const c = map.getCenter(), ref = me || [c.lat, c.lng];
    const z = ref.map(x => Math.round(x * 10) / 10), key = z.join(',') + (pushOpts.urgent ? 'u' : '') + (pushOpts.near ? 'n' : '');
    if (!force && key === pushZone) return;
    pushZone = key;
    const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: sub.toJSON(), lat: z[0], lng: z[1], urgent: pushOpts.urgent, near: pushOpts.near }) });
    if (!res.ok) { pushZone = null; throw new Error((await res.json().catch(() => ({}))).error || 'Abonnement impossible.'); }
    try { localStorage.setItem('cortege-push-zone', key); } catch {}
  }
  if (isIOS && !standalone) $('#pushHelp').textContent += ' Sur iPhone, installe d’abord l’appli sur l’écran d’accueil, puis active les alertes depuis l’appli installée.';
  function syncSwitches() { $('#optPush').checked = !!pushSub && pushOpts.urgent; $('#optNear').checked = !!pushSub && pushOpts.near; bellState(); }
  if (pushOK) navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
    if (sub && Notification.permission === 'granted') {
      pushSub = sub; syncSwitches();
      // Réinscription au plus deux fois par jour (le serveur a pu tout effacer entre-temps)
      let at = 0; try { at = +localStorage.getItem('cortege-push-at') || 0; } catch {}
      pushSend(sub, Date.now() - at > 12 * 3600e3).then(() => { try { localStorage.setItem('cortege-push-at', String(Date.now())); } catch {} }).catch(() => {});
    }
  }).catch(() => {});
  async function pushEnable() {
    if (!pushOK) throw new Error(isIOS && !standalone ? 'Sur iPhone : installe d’abord l’appli sur l’écran d’accueil.' : 'Notifications non prises en charge par ce navigateur.');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du téléphone.');
    const reg = await navigator.serviceWorker.ready;
    pushSub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(cfg.pushKey) });
    await pushSend(pushSub, true);
  }
  async function pushDisable() {
    const sub = pushSub; pushSub = null; pushZone = null;
    try { localStorage.removeItem('cortege-push-zone'); } catch {}
    try {
      if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: { endpoint: sub.endpoint } }) }); await sub.unsubscribe(); }
    } catch {}
  }
  async function pushToggle(which, on) {
    const before = { ...pushOpts };
    if (!pushSub) pushOpts = { urgent: false, near: false }; // première activation : seulement ce qui a été choisi
    pushOpts[which] = on;
    try {
      if (!pushOpts.urgent && !pushOpts.near) { await pushDisable(); toast('Notifications désactivées'); }
      else if (!pushSub) { await pushEnable(); toast(which === 'near' ? 'Alertes « danger près de toi » activées' : 'Annonces urgentes activées'); }
      else { await pushSend(pushSub, true); toast(on ? 'Activé' : 'Désactivé'); }
      savePushOpts();
    } catch (err) { pushOpts = before; toast(err.message || 'Activation impossible.'); }
    syncSwitches();
  }
  $('#optPush').addEventListener('change', e => pushToggle('urgent', e.target.checked));
  $('#optNear').addEventListener('change', e => pushToggle('near', e.target.checked));
  // Légende des vibrations, avec un bouton pour les essayer
  const VIBE_TXT = { charge: 'rafale de petites vibrations', nasse: 'deux longues', sommations: 'trois longues', lacrymo: 'deux moyennes',
    canon: 'trois moyennes', bac: 'deux courtes puis une longue', crs: 'deux courtes', interpellation: 'trois courtes' };
  for (const id of Object.keys(VIBE_TXT)) {
    if (!CAT[id]) continue;
    const b = el('button', { type: 'button' }, 'Essayer');
    b.onclick = () => { try { navigator.vibrate?.(cfg.vibes?.[id] || [200]); } catch {} };
    $('#vibeList').append(el('li', {}, el('span', {}, CAT[id].glyph + ' ' + CAT[id].label, el('small', {}, VIBE_TXT[id])), ...(navigator.vibrate ? [b] : [])));
  }
  if (!navigator.vibrate) $('#vibeNote').textContent = 'Ce téléphone ne permet pas de vibrations personnalisées (c’est le cas des iPhone). Sur iPhone, installe d’abord l’appli sur l’écran d’accueil pour recevoir les notifications.';
  function openNotif() { closeReport(); closeSheets(); syncSwitches(); $('#sheetNotif').hidden = false; }
  $('#btnNotif').onclick = openNotif;
  $('#btnNotifInfo').onclick = openNotif;
  $('#ntClose').onclick = () => closeSheets();
  bellState();

  // ---- Bien se préparer : checklist gardée sur le téléphone ----
  const prepKey = 'cortege-prep';
  const prepGet = () => { try { return JSON.parse(localStorage.getItem(prepKey) || '{}'); } catch { return {}; } };
  const prepBoxes = [...document.querySelectorAll('#sheetPrep .checklist input[type=checkbox]')];
  function prepRender() {
    const st = prepGet();
    prepBoxes.forEach(b => (b.checked = !!st[b.dataset.k]));
    const done = prepBoxes.filter(b => b.checked).length;
    $('#prepCount').textContent = `${done} / ${prepBoxes.length} prêt${done > 1 ? 's' : ''}`;
  }
  prepBoxes.forEach(b => b.addEventListener('change', () => {
    const st = prepGet(); st[b.dataset.k] = b.checked;
    try { localStorage.setItem(prepKey, JSON.stringify(st)); } catch {}
    prepRender();
  }));
  function openPrep() { closeReport(); closeSheets(); prepRender(); rallyRender(); $('#sheetPrep').hidden = false; }
  $('#btnPrep').onclick = openPrep;
  $('#btnPrepInfo').onclick = openPrep;
  $('#prClose').onclick = () => closeSheets();
  $('#prepReset').onclick = () => { try { localStorage.removeItem(prepKey); } catch {} prepRender(); toast('Checklist remise à zéro'); };
  $('#prepRights').onclick = () => { closeSheets(); renderLegal(); $('#sheetRights').hidden = false; };
  $('#prepSos').onclick = e => { e.preventDefault(); openSos(); };
  $('#prepOffline').onclick = e => { e.preventDefault(); closeSheets(); $('#sheetInfo').hidden = false; $('#btnPrefetch').scrollIntoView({ block: 'center' }); $('#btnPrefetch').focus(); };

  // ---- Point de ralliement du groupe (privé : reste sur le téléphone, partagé seulement si on le décide) ----
  const rallyGet = () => { try { return JSON.parse(localStorage.getItem('cortege-rally') || 'null'); } catch { return null; } };
  let rallyMarker = null, picking = false;
  const rallyLink = p => `https://www.openstreetmap.org/?mlat=${p[0].toFixed(5)}&mlon=${p[1].toFixed(5)}#map=18/${p[0].toFixed(5)}/${p[1].toFixed(5)}`;
  function rallyShare() {
    const p = rallyGet(); if (!p) return;
    const text = `Point de ralliement si on se perd en manif : ${rallyLink(p)}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('Lien copié : colle-le dans ton groupe'), () => toast(text));
  }
  function rallyRender() {
    const p = rallyGet();
    if (rallyMarker) { map.removeLayer(rallyMarker); rallyMarker = null; }
    if (p) {
      rallyMarker = L.marker(p, { icon: L.divIcon({ className: '', iconSize: [36, 36], iconAnchor: [8, 34], html: '<div class="rally-pin">🚩</div>' }), title: 'Point de ralliement', zIndexOffset: 600 })
        .bindPopup(() => {
          const root = el('div', {}, el('div', { class: 'pop-title' }, '🚩 Point de ralliement'),
            el('div', { class: 'pop-meta' }, 'Visible seulement sur ton téléphone' + (me ? ' · ' + fmtDist(dist(me, p)) : '')));
          const share = el('button', { class: 'yes' }, 'Partager');
          const rm = el('button', { class: 'danger' }, 'Retirer');
          share.onclick = rallyShare;
          rm.onclick = () => { try { localStorage.removeItem('cortege-rally'); } catch {} map.closePopup(); rallyRender(); };
          root.append(el('div', { class: 'pop-actions' }, share, rm));
          return root;
        }).addTo(map);
    }
    $('#rallyState').textContent = p ? `Point de ralliement placé${me ? ', à ' + fmtDist(dist(me, p)) + ' de toi' : ''}.` : 'Aucun point de ralliement.';
    $('#rallyShare').disabled = !p;
  }
  function startPick() {
    closeSheets(); setFollow(false); map.closePopup();
    picking = true; document.body.classList.add('drawing');
    const p = rallyGet(); if (p) map.setView(p, Math.max(map.getZoom(), 17));
    $('#crosshair').style.top = '45%'; $('#crosshair').hidden = false; $('#pickBar').hidden = false;
  }
  function endPick(save) {
    if (save) {
      const pt = map.containerPointToLatLng([map.getSize().x / 2, map.getSize().y * 0.45]);
      try { localStorage.setItem('cortege-rally', JSON.stringify([pt.lat, pt.lng])); } catch {}
      toast('Point de ralliement enregistré');
    }
    picking = false; document.body.classList.remove('drawing');
    $('#crosshair').hidden = true; $('#pickBar').hidden = true;
    const ck = prepBoxes.find(b => b.dataset.k === 'ralliement');
    if (save && ck && !ck.checked) { ck.checked = true; ck.dispatchEvent(new Event('change')); }
    openPrep();
  }
  $('#rallySet').onclick = startPick;
  $('#rallyShare').onclick = rallyShare;
  $('#pickOk').onclick = () => endPick(true);
  $('#pickCancel').onclick = () => endPick(false);
  rallyRender();

  // Premier lancement : on montre les réflexes (et la carte @neru) une fois
  try { if (!localStorage.getItem('cortege-seen')) { $('#sheetInfo').hidden = false; localStorage.setItem('cortege-seen', '1'); } } catch {}

  // ---- Hors ligne : PWA + pré-chargement des tuiles de la zone ----
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Mise à jour en arrière-plan (Chrome Android, appli installée) : agenda, annonces et interface restent frais pour le hors-ligne
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(async reg => {
    if (!reg.periodicSync) return;
    try { const st = await navigator.permissions.query({ name: 'periodic-background-sync' }); if (st.state !== 'granted') return; } catch { return; }
    reg.periodicSync.register('cortege-refresh', { minInterval: 6 * 3600e3 }).catch(() => {});
  }).catch(() => {});
  // Préchargement désactivé tant que les tuiles viennent d'OpenStreetMap (leur politique l'interdit)
  if (!cfg.offlineTiles) {
    ['#btnPrefetch', '#prefetchState', '.tip-prefetch'].forEach(s => { const n = $(s); if (n) n.hidden = true; });
    const tip = $('.tip-browse'); if (tip) tip.hidden = false;
    $('#prepOffline')?.closest('li')?.remove();
    prepRender();
  }
  $('#btnPrefetch').onclick = async () => {
    const state = $('#prefetchState');
    const b = map.getBounds(), z0 = Math.max(13, map.getZoom() - 1), z1 = Math.min(18, z0 + 3);
    const urls = [];
    for (let z = z0; z <= z1; z++) {
      const nw = map.project(b.getNorthWest(), z).divideBy(256).floor();
      const se = map.project(b.getSouthEast(), z).divideBy(256).floor();
      for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) urls.push(`/tiles/${z}/${x}/${y}.png`);
    }
    if (urls.length > 1500) return (state.textContent = 'Zone trop grande : zoome sur le parcours puis réessaie.');
    let done = 0;
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(urls.slice(i, i + 6).map(u => fetch(u).then(() => done++).catch(() => {})));
      state.textContent = `${done} / ${urls.length} morceaux de carte gardés`;
    }
    state.textContent = `Zone gardée (${done} morceaux). La carte s’affichera même si le réseau sature.`;
  };
})();
