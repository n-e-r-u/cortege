// ==== Carte d'un créneau : image PNG des signalements actifs pendant un créneau, autour d'un lieu ====
const { COL: SLOT_COL, FAM: SLOT_FAM } = window.cortegeCreneau;
let slotData = null;
const slotGeocode = q => window.cortegeCreneau.geocode(q);
function slotRows(c, R, from, to) {
  const cat = Object.fromEntries(dg.categories.map(x => [x.id, x]));
  const rows = dg.rows.filter(r => cat[r.c] && ($('#dgAll').checked || !REMOVED.has(r.o)))
    .map(r => ({ ...r, cat: cat[r.c], end: r.e || r.t, status: REMOVED.has(r.o) ? (OUTCOME[r.o] || r.o) : '' }));
  return window.cortegeCreneau.select(rows, c, R, from, to, dg.date);
}
async function slotDraw(c, R, from, to, rows) {
  const n = await window.cortegeCreneau.draw($('#slotCanvas'), { date: dg.date, c, R, from, to, rows, brand });
  $('#slotCanvas').hidden = false; return n;
}
$('#slotForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!dg) return;
  const from = $('#slotFrom').value, to = $('#slotTo').value, R = Math.min(5000, Math.max(100, +$('#slotR').value || 500));
  if (to < from) { $('#slotMsg').textContent = 'L’heure de fin est avant l’heure de début.'; return; }
  $('#slotGo').disabled = true; $('#slotMsg').textContent = 'Recherche du lieu et fabrication de l’image…';
  try {
    const c = await slotGeocode($('#slotPlace').value);
    c.label = c.name || $('#slotPlace').value.trim();
    const rows = slotRows(c, R, from, to);
    const nTiles = await slotDraw(c, R, from, to, rows);
    slotData = { c, R, from, to, rows };
    const name = `cortege-${dg.date}-${from.replace(':', 'h')}-${to.replace(':', 'h')}`;
    $('#slotDl').href = $('#slotCanvas').toDataURL('image/png'); $('#slotDl').download = name + '.png';
    $('#slotActions').hidden = false;
    $('#slotMsg').textContent = `${rows.length} signalement(s) actif(s) sur le créneau, à moins de ${R} m de « ${c.label} ».` + (nTiles ? '' : ' Fond de carte indisponible pour l’instant : réessaie dans un moment.');
  } catch (err) { $('#slotMsg').textContent = err.message || 'Impossible de fabriquer l’image.'; }
  $('#slotGo').disabled = false;
});
$('#slotCsv').onclick = () => {
  if (!slotData) return;
  const iso = t => new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16);
  const esc = v => /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = ['debut;fin;type;famille;latitude;longitude;distance_m;confirmations;plus_la;verifie;devenir',
    ...slotData.rows.map(r => [iso(r.t), iso(r.end), r.cat.label, SLOT_FAM[r.cat.group] || r.cat.group, r.lat, r.lng, Math.round(r.dist / 10) * 10, r.up, r.dn ?? '', r.v ? 'oui' : 'non', OUTCOME[r.o] || r.o].map(esc).join(';'))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
  a.download = `cortege-${dg.date}-${slotData.from.replace(':', 'h')}-${slotData.to.replace(':', 'h')}.csv`; document.body.append(a); a.click(); a.remove();
};
