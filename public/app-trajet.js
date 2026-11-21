(window.cortegeHtml = window.cortegeHtml || {}).trajet = "<div class=\"trajet-chip\" id=\"trajetChip\" hidden role=\"status\">\n<div class=\"trajet-txt\"><b id=\"trajetMain\"></b><span id=\"trajetSub\"></span></div>\n<button type=\"button\" class=\"x\" id=\"trajetX\" aria-label=\"Arrêter l’itinéraire\">×</button>\n</div>";
'use strict';
// ---- Itinéraire à pied vers un point (zone calme, point de ralliement, lieu de repli, secours…) qui contourne les dangers signalés ----
// Chargé au premier « Y aller » (public/app-trajet.js) : voir client/app/35-trajet.js. Tout est calculé sur le téléphone, avec les
// rues de la carte déjà affichée (public/street-route.js) : ni la position ni la destination ne sont envoyées au serveur. Les seules
// requêtes sont celles des morceaux de carte autour du trajet, les mêmes que pour regarder la carte à cet endroit.
// Un danger signalé rend les rues autour de lui plus chères : le trajet les contourne s'il existe un détour raisonnable, sinon il
// les traverse et le dit. Un point contesté est ignoré, un point vérifié pèse plus, un point pas encore confirmé pèse moins.
// Seuls les dangers SIGNALÉS sont évités : les textes le disent, sans jamais parler de trajet « sûr ».
window.cortegeTrajet = function (core) {
  const { $, t, tn, toast, map, CAT, cfg, reports, dist, fmtDist } = core;
  const S = window.cortegeStreets;
  core.addSheet(window.cortegeHtml.trajet);
  const MAX_M = 3000, WALK = 75; // 3 km au plus ; 4,5 km/h
  // Ce qui est évité : [rayon (m), coût d'un mètre dans la zone]. Les types inconnus d'un autre pays suivent leur groupe.
  const AVOID = {
    nasse: [200, 12], charge: [150, 10], tirs: [150, 10], facho: [200, 10], lacrymo: [180, 8], canon: [150, 8], chaud: [150, 8], sommations: [150, 6],
    crs: [120, 6], police: [120, 6], bac: [120, 6], inter: [120, 6], blinde: [120, 6], interpellation: [100, 6], civil: [80, 4],
    bloque: [40, 20], filtrage: [60, 8],
  };
  const GROUP_AVOID = { danger: [150, 8], fdo: [120, 6] }, SKIP = new Set(['militaires']);
  function zones() {
    const now = Date.now(), out = [];
    for (const { data: r } of reports.values()) {
      if (r.c || r.exp <= now || SKIP.has(r.cat)) continue; // contesté ou expiré : ignoré
      const c = CAT[r.cat], a = AVOID[r.cat] || (c && GROUP_AVOID[c.group]);
      if (!a) continue;
      const k = 1 + (a[1] - 1) * (r.ver ? 1.25 : r.nf ? 0.5 : 1);
      out.push({ lat: r.lat, lng: r.lng, r: a[0], k, id: r.id, cat: r.cat });
    }
    return out;
  }
  // Morceaux de carte : gardés en mémoire le temps de la session (les mêmes servent à chaque recalcul)
  const tiles = new Map();
  async function getTile(z, x, y) {
    const k = z + '/' + x + '/' + y;
    if (tiles.has(k)) return tiles.get(k);
    const res = await fetch(cfg.vector.url.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    const buf = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    if (res.ok || res.status === 404 || res.status === 204) { tiles.set(k, buf); if (tiles.size > 120) tiles.delete(tiles.keys().next().value); }
    return buf;
  }

  const layer = L.layerGroup().addTo(map);
  let cur = null;    // trajet en cours : { dest: [lat, lng], name, g (graphe), gFrom, sig, busy, again }
  function stop() { cur = null; layer.clearLayers(); $('#trajetChip').hidden = true; document.body.classList.remove('has-trajet'); }
  $('#trajetX').onclick = stop;
  const sigOf = z => z.map(x => x.id + ':' + x.lat.toFixed(4) + ',' + x.lng.toFixed(4) + ':' + x.k.toFixed(1)).sort().join('|');

  async function compute() {
    const c = cur, me = core.me;
    if (!c || !me) return;
    if (c.busy) { c.again = true; return; }
    c.busy = true;
    try {
      if (dist(me, c.dest) < 30) { stop(); toast('Tu es arrivé·e.'); return; }
      // Graphe des rues : refait quand on s'est éloigné de plus de 200 m du point d'où il a été construit
      if (!c.g || dist(me, c.gFrom) > 200) {
        const g = await S.buildGraph(getTile, Math.min(cfg.vector.maxzoom, 15), [me, c.dest], { margin: 400, maxTiles: 60 });
        if (cur !== c) return;
        if (!g) { if (!c.shown) { stop(); toast(navigator.onLine === false ? 'Pas de réseau : la carte de ce secteur n’est pas sur le téléphone.' : 'Pas de chemin trouvé par les rues.'); } return; }
        c.g = g; c.gFrom = me;
      }
      const z = zones(), r = S.routeOn(c.g, me, c.dest, { profile: 'pied', avoid: z });
      if (!r) { if (!c.shown) { stop(); toast('Pas de chemin trouvé par les rues.'); } return; }
      // Le même trajet sans rien éviter : dit combien de dangers le détour contourne
      const plain = z.length ? S.routeOn(c.g, me, c.dest, { profile: 'pied', avoid: z.map(x => ({ ...x, k: 1 })) }) : null;
      const dodged = plain ? plain.through.filter(i => !r.through.includes(i)).length : 0;
      c.sig = sigOf(z); c.at = me; c.shown = true;
      layer.clearLayers();
      L.polyline(r.path, { color: '#fff', weight: 9, opacity: .9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
      L.polyline(r.path, { color: '#1f9d6b', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layer);
      L.circleMarker(c.dest, { radius: 9, color: '#fff', weight: 3, fillColor: '#1f9d6b', fillOpacity: 1, interactive: false }).addTo(layer);
      $('#trajetMain').textContent = '🧭 ' + fmtDist(r.len) + ' · ' + t('{n} min', { n: Math.max(1, Math.round(r.len / WALK)) }) + (c.name ? ' · ' + c.name : '');
      const sub = $('#trajetSub');
      sub.className = r.through.length ? 'warn' : '';
      sub.textContent = r.through.length ? tn(r.through.length, '⚠ Passe par {n} danger signalé : pas d’autre chemin', '⚠ Passe par {n} dangers signalés : pas d’autre chemin')
        : dodged ? tn(dodged, 'Contourne {n} danger signalé', 'Contourne {n} dangers signalés') : t('Aucun danger signalé sur le chemin');
      $('#trajetChip').hidden = false; document.body.classList.add('has-trajet');
      if (c.fit) { c.fit = false; map.fitBounds(L.latLngBounds(r.path), { padding: [50, 90], maxZoom: 17 }); }
    } catch { if (cur === c && !c.shown) { stop(); toast('Pas de réseau : l’itinéraire n’a pas pu être calculé.'); } }
    finally { c.busy = false; if (cur === c && c.again) { c.again = false; compute(); } }
  }
  return {
    go(dest) {
      const me = core.me;
      if (!cfg.vector) return toast('Itinéraire indisponible : cette carte n’a pas ses rues sur le serveur.');
      if (!me) return toast('Active ta position (◎) pour calculer un itinéraire.');
      if (dist(me, [dest.lat, dest.lng]) > MAX_M) return toast('Trop loin pour un itinéraire à pied (3 km au plus).');
      stop();
      cur = { dest: [dest.lat, dest.lng], name: dest.name || '', fit: true };
      map.closePopup(); core.closeSheets();
      toast('Itinéraire calculé sur ton téléphone. Seuls les dangers signalés sont évités.');
      compute();
    },
    // Nouveaux signalements : recalcul si ce qui est à éviter a changé
    changed() { if (cur && cur.shown && sigOf(zones()) !== cur.sig) compute(); },
    // Position : recalcul tous les 25 m
    moved() { if (cur && cur.shown && core.me && dist(core.me, cur.at) > 25) compute(); },
  };
};
