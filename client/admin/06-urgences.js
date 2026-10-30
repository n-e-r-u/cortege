// ---- Urgences ----
let CATS = {};
fetch('/api/config').then(r => r.json()).then(c => { CATS = Object.fromEntries(c.categories.map(x => [x.id, x])); });
let repData = { reports: [], paused: 0 };
function confirmBtn(btn, label, action) {
  btn.onclick = async () => {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.dataset.label = btn.textContent; btn.textContent = label; setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000); return; }
    delete btn.dataset.armed; btn.textContent = btn.dataset.label;
    try { await action(); } catch (e) { alertMsg(e.message); }
  };
}
async function loadReports() {
  try { repData = await api('/api/admin/reports'); } catch (e) { alertMsg(e.message); return; }
  const p = repData.paused;
  $('#pauseState').textContent = p ? 'En pause jusqu’à ' + new Date(p).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.' : 'Signalements ouverts.';
  renderReports();
}
function renderReports() {
  const q = $('#repFilter').value.trim().toLowerCase();
  const list = repData.reports.filter(r => !q || (CATS[r.cat]?.label || r.cat).toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q));
  $('#repCount').textContent = '(' + repData.reports.length + ')';
  const ul = $('#repList'); ul.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'meta'; li.textContent = 'Aucun signalement actif.'; ul.append(li); return; }
  for (const r of list.slice(0, 300)) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const t = document.createElement('b'); t.textContent = (CATS[r.cat]?.glyph || '') + ' ' + (CATS[r.cat]?.label || r.cat) + (r.ver ? ' ✓' : '');
    const m = document.createElement('div'); m.className = 'meta';
    const a = document.createElement('a'); a.href = `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'voir';
    a.style.color = 'var(--accent)';
    m.append(`il y a ${Math.round((Date.now() - r.t) / 60000)} min · +${r.up} / −${r.down}${r.note ? ' · « ' + r.note + ' »' : ''} · `, a);
    info.append(t, m);
    const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Supprimer';
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/reports/' + r.id, { method: 'DELETE' }); loadReports(); });
    li.append(info, del); ul.append(li);
  }
}
$('#repFilter').addEventListener('input', renderReports);
$('#repReload').onclick = loadReports;
document.querySelectorAll('[data-pause]').forEach(b => b.onclick = async () => {
  try { await api('/api/admin/pause', { method: 'POST', body: JSON.stringify({ minutes: +b.dataset.pause }) }); loadReports(); } catch (e) { alertMsg(e.message); }
});
confirmBtn($('#purgeReports'), 'Confirmer : tout effacer', async () => { const r = await api('/api/admin/purge', { method: 'POST', body: '{}' }); alertMsg(r.removed + ' signalement(s) effacé(s).'); loadReports(); });
confirmBtn($('#purgeAll'), 'Confirmer : tout effacer + annonces', async () => { const r = await api('/api/admin/purge', { method: 'POST', body: JSON.stringify({ announcements: true }) }); alertMsg(r.removed + ' signalement(s) et toutes les annonces effacés.'); loadReports(); });
$('#wipeForm').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('#wipeConfirm').value.trim() !== 'EFFACER') return alertMsg('Tape EFFACER pour confirmer.');
  try {
    const r = await api('/api/admin/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'EFFACER', pub: $('#wipePub').checked }) });
    $('#wipeConfirm').value = '';
    alertMsg(`Effacement terminé : ${r.removed} signalement(s) et toutes les traces effacés.` + (r.rotated ? ' Nouvelle clé de hachage créée.' : ' La clé vient de la variable SECRET : change-la dans cPanel puis redémarre.'));
    loadReports();
  } catch (err) { alertMsg(err.message); }
});
