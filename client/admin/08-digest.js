// ---- Digest ----
const OUTCOME = { exp: 'expirés normalement', active: 'encore actifs', cont: 'contestés par « Plus là » puis expirés', orga: 'retirés par une orga',
  admin: 'retirés par l’admin', full: 'évincés (zone saturée)', purge: 'effacés (purge)', removed: 'retirés', old: 'retirés (ancien format)' };
const REMOVED = new Set(['cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old']);
const KEY_CATS = ['charge', 'nasse', 'lacrymo', 'canon', 'sommations', 'interpellation', 'bac', 'crs'];
let dg = null, dgMap = null, dgLayer = null, brand = {};
fetch('/api/config').then(r => r.json()).then(c => { brand = c.brand || {}; }).catch(() => {});
const minutes = ms => Math.round(ms / 60000);
const median = a => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const date = $('#date').value;
  $('#msg').textContent = 'Chargement… (le nom des villes peut prendre quelques secondes)';
  try {
    const res = await fetch('/api/digest?date=' + date, { headers: { 'X-Admin-Key': KEY } });
    const d = await res.json();
    if (!res.ok) { $('#msg').textContent = d.error || 'Erreur.'; $('#out').hidden = true; return; }
    dg = d; renderDigest();
  } catch { $('#msg').textContent = 'Pas de réseau.'; }
});
$('#dgAll').addEventListener('change', () => dg && renderDigest());

function renderDigest() {
  pubUi();
  const d = dg, cat = Object.fromEntries(d.categories.map(c => [c.id, c]));
  const all = d.rows.filter(r => cat[r.c]);
  const rows = $('#dgAll').checked ? all : all.filter(r => !REMOVED.has(r.o));
  $('#msg').textContent = (all.length ? longDate(d.date) : `Aucun signalement en France le ${longDate(d.date)}.` + (d.days.length ? ` Jours archivés : ${d.days.slice(0, 8).join(', ')}.` : ''))
    + (d.abroad ? ` · ${d.abroad} ${d.abroad > 1 ? 'signalements' : 'signalement'} hors de France, ${d.abroad > 1 ? 'visibles' : 'visible'} sur la carte en direct mais non ${d.abroad > 1 ? 'comptés' : 'compté'} ici.` : '');
  $('#out').hidden = !all.length;
  if (!all.length) return;
  const groupOf = r => cat[r.c].group, zoneName = r => d.zones[r.z]?.name || r.z;
  const removed = all.filter(r => REMOVED.has(r.o)).length;
  const cities = new Set(rows.map(r => r.z)).size;
  const confirmed = rows.filter(r => r.up > 0).length, verified = rows.filter(r => r.v).length;
  const t0 = Math.min(...rows.map(r => r.t)), t1 = Math.max(...rows.map(r => r.e || r.t));

  // Chiffres clés
  $('#kpis').textContent = '';
  for (const [n, label] of [[rows.length, 'signalements'], [cities, cities > 1 ? 'villes' : 'ville'], [confirmed, 'confirmés par d’autres'], [verified, 'vérifiés par une orga'],
    [removed, 'retirés ou contestés'], [rows.length ? hhmm(t0) + '–' + hhmm(t1) : '—', 'activité']]) {
    const k = document.createElement('div'); k.className = 'kpi';
    const b = document.createElement('b'); b.textContent = n; const s = document.createElement('span'); s.textContent = label;
    k.append(b, s); $('#kpis').append(k);
  }

  // Carte
  if (!dgMap) {
    dgMap = L.map('dgMap', { zoomControl: true, attributionControl: true });
    L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(dgMap);
    dgLayer = L.layerGroup().addTo(dgMap);
  }
  dgLayer.clearLayers();
  for (const r of rows) {
    const c = cat[r.c], col = getComputedStyle(document.documentElement).getPropertyValue('--' + ({ fdo: 'fdo', danger: 'danger', soutien: 'soutien', info: 'info' })[c.group]).trim() || '#ec9fa4';
    L.circleMarker([r.lat, r.lng], { radius: 5 + Math.min(r.up, 6), color: col, weight: REMOVED.has(r.o) ? 1 : 2, dashArray: REMOVED.has(r.o) ? '3 3' : null, fillOpacity: REMOVED.has(r.o) ? .15 : .55 })
      .bindTooltip(`${c.glyph} ${c.label} · ${hhmm(r.t)}${r.e ? '–' + hhmm(r.e) : ''} · ${OUTCOME[r.o] || r.o}${r.up ? ' · confirmé ' + r.up + '×' : ''}`).addTo(dgLayer);
  }
  setTimeout(() => { dgMap.invalidateSize(); if (rows.length) dgMap.fitBounds(L.latLngBounds(rows.map(r => [r.lat, r.lng])).pad(0.2), { maxZoom: 14 }); }, 50);
  $('#dgLegend').textContent = '';
  for (const g of d.groups) { const s = document.createElement('span'); s.style.setProperty('--c', COLORS[g.id]); s.textContent = g.label; $('#dgLegend').append(s); }
  const s2 = document.createElement('span'); s2.style.setProperty('--c', 'transparent'); s2.textContent = 'pointillés : retiré ou contesté'; $('#dgLegend').append(s2);

  // Moments clés : première occurrence de chaque danger par ville
  const firsts = new Map();
  for (const r of rows.filter(r => KEY_CATS.includes(r.c)).sort((a, b) => a.t - b.t)) { const k = r.z + '|' + r.c; if (!firsts.has(k)) firsts.set(k, r); }
  const mom = [...firsts.values()].sort((a, b) => a.t - b.t).slice(0, 30);
  $('#moments').textContent = '';
  if (!mom.length) { const li = document.createElement('li'); li.textContent = 'Aucun danger signalé.'; $('#moments').append(li); }
  for (const r of mom) {
    const li = document.createElement('li'); const tm = document.createElement('time'); tm.textContent = hhmm(r.t);
    const sp = document.createElement('span'); sp.textContent = `${cat[r.c].glyph} ${zoneName(r)} : ${cat[r.c].label.toLowerCase()}${r.up ? ` (confirmé ${r.up}×)` : ''}${r.v ? ' ✓ vérifié' : ''}${REMOVED.has(r.o) ? ' · ' + OUTCOME[r.o] : ''}`;
    li.append(tm, sp); $('#moments').append(li);
  }

  // Par type
  const byCat = {};
  for (const r of rows) (byCat[r.c] ||= []).push(r);
  const cats = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  $('#cats').textContent = '';
  for (const [c, list] of cats) {
    const first = Math.min(...list.map(r => r.t)), conf = list.filter(r => r.up > 0).length, life = median(list.filter(r => r.e).map(r => r.e - r.t));
    $('#cats').append(bar(`${cat[c].glyph} ${cat[c].label}`, list.length, cats[0][1].length, COLORS[cat[c].group],
      `Premier à ${hhmm(first)} · ${conf} confirmé(s)` + (life ? ` · visible ${minutes(life)} min en médiane` : '')));
  }

  // Par heure, empilé par famille
  const byHour = Array.from({ length: 24 }, () => ({}));
  for (const r of rows) { const h = +new Date(r.t).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }) % 24; byHour[h][groupOf(r)] = (byHour[h][groupOf(r)] || 0) + 1; }
  const totH = byHour.map(o => Object.values(o).reduce((a, b) => a + b, 0)), maxH = Math.max(1, ...totH);
  $('#hours').textContent = ''; $('#hourLabels').textContent = '';
  byHour.forEach((o, h) => {
    const col = document.createElement('div'); col.style.height = (totH[h] / maxH) * 100 + '%'; col.title = `${h} h : ${totH[h]}`;
    for (const g of d.groups) if (o[g.id]) { const i = document.createElement('i'); i.style.setProperty('--c', COLORS[g.id]); i.style.height = (o[g.id] / totH[h]) * 100 + '%'; col.append(i); }
    $('#hours').append(col);
    const lb = document.createElement('span'); lb.textContent = h; $('#hourLabels').append(lb);
  });
  $('#hourLegend').textContent = '';
  for (const g of d.groups) { const s = document.createElement('span'); s.style.setProperty('--c', COLORS[g.id]); s.textContent = g.label; $('#hourLegend').append(s); }

  // Par ville
  const byZone = {};
  for (const r of rows) (byZone[r.z] ||= []).push(r);
  const zs = Object.entries(byZone).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  $('#zones').textContent = '';
  for (const [z, list] of zs) {
    const counts = {}; list.forEach(r => counts[r.c] = (counts[r.c] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${n} ${cat[c].label.toLowerCase()}`).join(', ');
    const a = Math.min(...list.map(r => r.t)), b = Math.max(...list.map(r => r.e || r.t));
    $('#zones').append(bar(d.zones[z]?.name || z, list.length, zs[0][1].length, 'var(--accent)', `${hhmm(a)}–${hhmm(b)} · ${top}`));
  }

  // Devenir
  const outc = {}; all.forEach(r => outc[r.o] = (outc[r.o] || 0) + 1);
  const oc = Object.entries(outc).sort((a, b) => b[1] - a[1]);
  $('#outcomes').textContent = '';
  for (const [o, n] of oc) $('#outcomes').append(bar(OUTCOME[o] || o, n, oc[0][1], REMOVED.has(o) ? 'var(--fdo)' : 'var(--soutien)'));

  // Fiabilité
  const tr = [['confirmés (2 pers. ou +)', confirmed], ['confirmés (3 pers. ou +)', rows.filter(r => r.up >= 2).length],
    ['vérifiés par une orga', verified], ['téléphone fiable', rows.filter(r => r.f === 1).length], ['marqués non fiables', rows.filter(r => r.f === -1).length],
    ['avec une précision', rows.filter(r => r.n > 0).length], ['avec des « Plus là »', rows.filter(r => r.dn > 0).length]];
  $('#trust').textContent = '';
  for (const [l, n] of tr) $('#trust').append(bar(l, n, rows.length, 'var(--accent)', rows.length ? Math.round(n / rows.length * 100) + ' %' : ''));
  const lifeBy = d.groups.map(g => { const l = rows.filter(r => groupOf(r) === g.id && r.e).map(r => r.e - r.t); return l.length ? `${g.label} : ${minutes(median(l))} min` : null; }).filter(Boolean);
  $('#lifetimes').textContent = lifeBy.length ? 'Durée de visibilité médiane sur la carte : ' + lifeBy.join(' · ') + '.' : '';

  // Orgas et modération
  const od = [['vérifications d’orgas', d.orga.verified], ['retraits par des orgas', d.orga.removed], ['retraits par l’admin', d.orga.adminRemoved], ['retraits annulés', d.orga.restored],
    ['annonces publiées', d.orga.announcements], ['annonces urgentes', d.orga.urgent], ['numéros de legal team', d.orga.legal], ['contestés par votes', d.orga.contested],
    ...Object.entries(d.abuse).map(([k, n]) => ['anti-abus : ' + k, n])];
  const maxO = Math.max(1, ...od.map(x => x[1]));
  $('#orgaDay').textContent = '';
  for (const [l, n] of od) if (n) $('#orgaDay').append(bar(l, n, maxO, 'var(--info)'));
  if (!$('#orgaDay').children.length) $('#orgaDay').textContent = 'Aucune action d’orga ce jour-là.';

  // Comparaison
  const maxHist = Math.max(1, ...d.history.map(x => x.total));
  $('#history').textContent = ''; $('#historyLabels').textContent = '';
  for (const x of d.history) {
    const col = document.createElement('div'); col.style.height = Math.max(2, x.total / maxHist * 100) + '%'; col.title = `${x.date} : ${x.total}`;
    if (x.date === d.date) col.className = 'today'; $('#history').append(col);
    const lb = document.createElement('span'); lb.textContent = +x.date.slice(8); $('#historyLabels').append(lb);
  }
  const prev = d.history.slice(0, -1).map(x => x.total), avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;

  // Agenda du jour
  $('#eventsCard').hidden = !d.events.length; $('#dgEvents').textContent = '';
  for (const e of d.events) $('#dgEvents').append(li(e.title, `${hhmm(e.start)} · ${e.place || ''}`));

  // Résumé
  const peak = totH.indexOf(Math.max(...totH));
  const lines = [
    `Mobilisation du ${longDate(d.date)} : ce que les manifestant·es ont signalé sur Cortège`,
    `• ${rows.length} signalements dans ${cities} ${cities > 1 ? 'villes' : 'ville'}, de ${hhmm(t0)} à ${hhmm(t1)}`,
    ...cats.slice(0, 5).map(([c, list]) => `• ${list.length} × ${cat[c].label.toLowerCase()} (premier à ${hhmm(Math.min(...list.map(r => r.t)))})`),
    `• Pic d’activité entre ${peak} h et ${peak + 1} h`,
    ...(zs.length ? [`• Ville la plus active : ${d.zones[zs[0][0]]?.name || zs[0][0]} (${zs[0][1].length})`] : []),
    ...mom.slice(0, 4).map(r => `• ${hhmm(r.t)} : ${cat[r.c].label.toLowerCase()} à ${zoneName(r)}`),
    ...(avg ? [`• ${rows.length >= avg ? '+' : ''}${Math.round((rows.length - avg) / avg * 100)} % par rapport à la moyenne des 14 jours précédents`] : []),
    `Signalements de participant·es : ${confirmed} confirmés par d’autres, ${verified} vérifiés par des orgas${removed ? `, ${removed} retirés ou contestés` + ($('#dgAll').checked ? ' (inclus dans les chiffres)' : ' (non comptés)') : ''}.`,
    `Source : Cortège (${location.host})${brand.handle ? ', par @' + brand.handle : ''}`,
  ];
  $('#summary').textContent = lines.join('\n');
}

$('#csv').addEventListener('click', () => {
  if (!dg) return;
  const cat = Object.fromEntries(dg.categories.map(c => [c.id, c]));
  const head = ['categorie', 'famille', 'debut', 'fin', 'latitude', 'longitude', 'ville', 'confirmations', 'plus_la', 'precisions', 'verifie', 'fiabilite', 'devenir'];
  const esc = v => /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const iso = t => t ? new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }) : '';
  const lines = [head.join(';'), ...dg.rows.filter(r => cat[r.c]).map(r => [cat[r.c].label, cat[r.c].group, iso(r.t), iso(r.e), r.lat, r.lng, dg.zones[r.z]?.name || '', r.up, r.dn ?? '', r.n ?? '', r.v ? 'oui' : 'non',
    r.f === 1 ? 'fiable' : r.f === -1 ? 'non fiable' : '', OUTCOME[r.o] || r.o].map(esc).join(';'))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `cortege-${dg.date}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#summary').textContent); $('#copy').textContent = 'Copié'; }
  catch { const r = document.createRange(); r.selectNodeContents($('#summary')); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copy').textContent = 'Sélectionné, fais Copier'; }
  setTimeout(() => ($('#copy').textContent = 'Copier le résumé'), 2000);
});

