'use strict';
// Page publique « Carte d'un créneau » (/manif/AAAA-MM-JJ/carte) : la personne choisit un lieu, un rayon et une plage horaire,
// et son navigateur fabrique l'image. Le serveur n'envoie qu'un fichier de points figé (mis en cache), une fois par visite.
// Garde-fous : rayon de 2 km et créneau de 6 h au plus, une image à la fois, quelques secondes entre deux images.
(async () => {
  const $ = s => document.querySelector(s);
  const C = window.cortegeCreneau;
  const date = (location.pathname.match(/\/manif\/(\d{4}-\d{2}-\d{2})\//) || [])[1];
  const MAX_R = 2000, MAX_H = 6, GAP = 5000;
  const msg = t => { $('#msg').textContent = t; };
  if (!date) return msg('Adresse invalide.');
  $('#back').href = '/manif/' + date;
  $('#day').textContent = new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  let cfg = {}, data;
  try {
    [cfg, data] = await Promise.all([fetch('/api/config').then(r => r.json()).catch(() => ({})),
      fetch(`/manif/${date}/points.json?v=3`, { cache: 'no-cache' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Indisponible.'); return j; })]);
  } catch (e) { return msg(e.message || 'Pas de réseau.'); }
  const cats = Object.fromEntries(data.cats.map(c => [c.id, c]));
  // Devenir du point (8e valeur) : les retirés et contestés restent visibles, avec la mention
  const OUT = ['', 'contesté (« Plus là »)', 'retiré par une orga', 'retiré par l’admin', 'évincé (zone saturée)', 'effacé (purge)', 'retiré', 'retiré'];
  const rows = data.pts.map(([c, t, e, la, lo, up, v, o]) => ({ cat: cats[c], t: t * 60000, end: e * 60000, lat: la / 1e3, lng: lo / 1e3, up, v, status: OUT[o || 0] || '' })).filter(r => r.cat);
  if (!rows.length) return msg('Aucun signalement ce jour-là.');

  // Créneau par défaut : l'heure la plus chargée de la journée
  const byH = Array(24).fill(0); rows.forEach(r => byH[+C.hm(r.t).slice(0, 2)]++);
  const peak = byH.indexOf(Math.max(...byH)), pad = n => String(n).padStart(2, '0');
  $('#from').value = pad(peak) + ':00'; $('#to').value = pad(Math.min(peak + 1, 23)) + ':' + (peak === 23 ? '59' : '00');

  // Carte de choix du lieu (même fond que l'appli), points du créneau en aperçu
  const box = L.latLngBounds(rows.map(r => [r.lat, r.lng]));
  const map = L.map('map', { zoomControl: true, attributionControl: true }).fitBounds(box.pad(0.1), { maxZoom: 13 });
  map.attributionControl.setPrefix(false);
  const raster = () => { document.body.classList.add('raster'); L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a>' }).addTo(map); };
  try {
    if (cfg.vector && window.protomapsL && window.cortegeVectorLayer)
      window.cortegeVectorLayer(window.protomapsL, { url: cfg.vector.url, lang: 'fr', maxDataZoom: cfg.vector.maxzoom, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a> · Protomaps' }).addTo(map);
    else raster();
  } catch { raster(); }
  const dots = L.layerGroup().addTo(map), renderer = L.canvas();
  let place = null, star = null, ring = null, last = 0, busy = false;
  const span = () => { const [a, b] = [$('#from').value, $('#to').value]; return (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3)); };
  function preview() {
    dots.clearLayers();
    const from = $('#from').value, to = $('#to').value;
    const lo = C.parisMs(date, from), hi = C.parisMs(date, to) + 59999, live = rows.filter(r => r.t <= hi && r.end >= lo);
    for (const r of live.slice(0, 5000)) L.circleMarker([r.lat, r.lng], r.status ? { renderer, radius: 5, weight: 2, color: C.COL[r.cat.group] || '#888', fillColor: '#141519', fillOpacity: 1 } : { renderer, radius: 5, weight: 1, color: '#fff', fillColor: C.COL[r.cat.group] || '#888', fillOpacity: .9 }).addTo(dots);
    const R = +$('#r').value;
    if (ring) ring.setRadius(R);
    const n = place ? C.select(rows, place, R, from, to, date).length : live.length;
    $('#count').textContent = place ? `${n} signalement${n > 1 ? 's' : ''} dans la zone sur ce créneau.` : `${live.length} signalement${live.length > 1 ? 's' : ''} sur ce créneau. Choisis un lieu sur la carte.`;
    $('#go').disabled = !place || busy;
  }
  function setPlace(lat, lng, label) {
    place = { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, label: label || `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    if (!star) {
      star = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="star">★</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false }).addTo(map);
      ring = L.circle([lat, lng], { radius: +$('#r').value, color: '#a191d8', weight: 2, dashArray: '8 6', fill: false, interactive: false }).addTo(map);
    } else { star.setLatLng([lat, lng]); ring.setLatLng([lat, lng]); }
    preview();
  }
  map.on('click', e => setPlace(e.latlng.lat, e.latlng.lng));
  ['#from', '#to', '#r'].forEach(s => $(s).addEventListener('change', preview));
  $('#search').onclick = async () => {
    const q = $('#q').value.trim(); if (q.length < 2) return;
    $('#search').disabled = true;
    try { const p = await C.geocode(q); setPlace(p.lat, p.lng, p.name || q); map.setView([p.lat, p.lng], 15); }
    catch (e) { msg(e.message); }
    $('#search').disabled = false;
  };
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#search').click(); } });

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!place || busy) return;
    const from = $('#from').value, to = $('#to').value, R = Math.min(MAX_R, +$('#r').value || 500);
    if (span() < 0) return msg('L’heure de fin est avant l’heure de début.');
    if (span() > MAX_H * 60) return msg(`Créneau de ${MAX_H} h au plus.`);
    const wait = last + GAP - Date.now();
    if (wait > 0) return msg(`Patiente ${Math.ceil(wait / 1000)} s avant la prochaine image.`);
    busy = true; $('#go').disabled = true; msg('Fabrication de l’image…');
    try {
      const sel = C.select(rows, place, R, from, to, date);
      await C.draw($('#cv'), { date, c: place, R, from, to, rows: sel, brand: cfg.brand || {}, more: 'zoome ou réduis le créneau' });
      const blob = await new Promise(ok => $('#cv').toBlob(ok, 'image/png'));
      const url = URL.createObjectURL(blob), name = `cortege-${date}-${from.replace(':', 'h')}-${to.replace(':', 'h')}.png`;
      $('#out').src = url; $('#dl').href = url; $('#dl').download = name;
      $('#result').hidden = false;
      const file = new File([blob], name, { type: 'image/png' });
      $('#share').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
      $('#share').onclick = () => navigator.share({ files: [file], title: 'Signalements Cortège' }).catch(() => {});
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      msg(`${sel.length} signalement${sel.length > 1 ? 's' : ''} sur l’image.`);
    } catch { msg('Impossible de fabriquer l’image. Réessaie.'); }
    last = Date.now(); busy = false; setTimeout(preview, GAP);
  });
  preview();
})();
