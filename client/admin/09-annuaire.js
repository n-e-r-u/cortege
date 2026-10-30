// ---- Annuaire des legal teams ----
async function loadBadges() {
  try {
    const d = await api('/api/admin/reports'); $('#annBadge').textContent = d.pending || ''; $('#legalBadge').textContent = d.legalAlerts || '';
    $('#modBadge').textContent = d.moderation || ''; $('#ordBadge').textContent = d.ordersPending || ''; $('#mobBadge').textContent = (d.toPublish || []).length || '';
    pubPrompt(d.toPublish || []);
  } catch {}
}
setInterval(() => { if (!$('#app').hidden) loadBadges(); }, 120000);
const WATCH = { ok: '✓ source relue, numéro présent', missing: '⚠ numéro ABSENT de la source', changed: '⚠ la source affiche d’autres numéros', error: '⚠ source illisible', new: 'source pas encore relue' };
const dayFr = t => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });
let lgPos = null;
async function loadLegal() {
  let d; try { d = await api('/api/admin/legal'); } catch (e) { alertMsg(e.message); return; }
  const ul = $('#legalList'); ul.textContent = '';
  const live = d.list.filter(e => e.ok).length;
  $('#legalCount').textContent = `(${live} publiée(s) sur ${d.list.length})`;
  $('#legalWatchState').textContent = d.lastWatch ? 'Dernière relecture des sources : ' + dayFr(d.lastWatch) + ' à ' + hhmm(d.lastWatch) + '. La veille prévient ici, elle ne publie et ne modifie jamais rien.' : 'Les sources n’ont pas encore été relues (une fois par jour).';
  if (!d.list.length) return empty(ul, 'Annuaire vide.');
  for (const e of d.list) {
    const buttons = [];
    if (!e.ok) { const v = btn('Valider'); v.onclick = () => legalAct(e.id, 'validate'); buttons.push(v); }
    else { const u = btn('Dépublier', 'ghost'); u.onclick = () => legalAct(e.id, 'unvalidate'); buttons.push(u); }
    if (['missing', 'changed'].includes(e.status)) { const a = btn('Vu, numéro toujours bon', 'ghost'); a.onclick = () => legalAct(e.id, 'ack'); buttons.push(a); }
    const ed = btn('Modifier', 'ghost'); ed.onclick = () => editLegal(e); buttons.push(ed);
    const del = btn('Retirer', 'danger'); confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/legal/' + e.id, { method: 'DELETE' }); loadLegal(); }); buttons.push(del);
    const title = `${e.ok ? '✅' : '⏳ À VALIDER'} · ${e.city} · ${e.name} · ${e.phone}${e.signal ? ' (Signal)' : ''}`;
    const meta = [e.ok && e.checked ? 'vérifié le ' + dayFr(e.checked) : null, e.srcDate ? 'source du ' + dayFr(e.srcDate) : 'source non datée',
      WATCH[e.status] + (e.watch && e.watch.at ? ' (' + dayFr(e.watch.at) + ')' : ''),
      e.status === 'changed' && e.watch ? 'numéros vus : ' + e.watch.phones.join(', ') : null, e.watch && e.watch.err ? e.watch.err : null].filter(Boolean).join(' · ');
    const row = li(title, meta, ...buttons);
    if (e.src) { const a = document.createElement('a'); a.href = e.src; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Ouvrir la source'; a.className = 'meta'; row.firstChild.append(a); }
    ul.append(row);
  }
}
async function legalAct(id, act) { try { await api('/api/admin/legal/' + id + '/' + act, { method: 'POST', body: '{}' }); loadLegal(); loadBadges(); } catch (e) { alertMsg(e.message); } }
function editLegal(e) {
  $('#lgId').value = e.id; $('#lgCity').value = e.city; $('#lgName').value = e.name; $('#lgPhone').value = e.phone; $('#lgSignal').checked = e.signal;
  $('#lgSrc').value = e.src || ''; $('#lgSrcDate').value = e.srcDate || ''; lgPos = { lat: e.lat, lng: e.lng };
  $('#lgPos').textContent = 'Position : ' + e.lat.toFixed(3) + ', ' + e.lng.toFixed(3);
  $('#legalFormTitle').textContent = 'Modifier : ' + e.city; $('#lgCancel').hidden = false;
  $('#legalForm').scrollIntoView({ behavior: 'smooth' });
}
function resetLegalForm() { $('#legalForm').reset(); $('#lgId').value = ''; lgPos = null; $('#lgPos').textContent = 'Position : pas encore placée.'; $('#legalFormTitle').textContent = 'Ajouter une legal team'; $('#lgCancel').hidden = true; }
$('#lgCancel').onclick = resetLegalForm;
$('#lgFind').onclick = async () => {
  try {
    const r = await fetch('/api/geocode?q=' + encodeURIComponent($('#lgCity').value)).then(r => r.json());
    if (!Array.isArray(r) || !r.length) return ($('#lgPos').textContent = 'Ville introuvable, précise le nom.');
    lgPos = { lat: r[0].lat, lng: r[0].lng }; $('#lgPos').textContent = 'Position : ' + r[0].name + ' (' + r[0].lat.toFixed(3) + ', ' + r[0].lng.toFixed(3) + ')';
  } catch { $('#lgPos').textContent = 'Recherche indisponible.'; }
};
$('#legalForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (!lgPos) return ($('#lgPos').textContent = 'Place d’abord la ville (bouton « Placer la ville »).');
  const body = { city: $('#lgCity').value, name: $('#lgName').value, phone: $('#lgPhone').value, signal: $('#lgSignal').checked,
    src: $('#lgSrc').value, srcDate: $('#lgSrcDate').value || null, lat: lgPos.lat, lng: lgPos.lng };
  if ($('#lgId').value) body.id = $('#lgId').value;
  try { await api('/api/admin/legal', { method: 'POST', body: JSON.stringify(body) }); resetLegalForm(); loadLegal(); loadBadges(); } catch (e) { alertMsg(e.message); }
});
$('#legalWatchNow').onclick = async () => {
  const b = $('#legalWatchNow'); b.disabled = true; b.textContent = 'Relecture en cours…';
  try { await api('/api/admin/legal-watch', { method: 'POST', body: '{}' }); } catch (e) { alertMsg(e.message); }
  b.disabled = false; b.textContent = 'Relire les sources maintenant'; loadLegal(); loadBadges();
};

