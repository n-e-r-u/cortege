// ---- Demandes d'accès orga ----
async function loadRequests() {
  let d; try { d = await api('/api/admin/orga-requests'); } catch (e) { return; }
  const ul = $('#reqList'); ul.textContent = '';
  $('#reqCount').textContent = '(' + d.list.length + ')'; $('#reqBadge').textContent = d.list.length || '';
  if (!d.list.length) return empty(ul, 'Aucune demande en attente.');
  for (const r of d.list) {
    const inv = btn('Créer l’invitation');
    inv.onclick = async () => { $('#orgaLabel').value = r.collective; $('#orgaForm').requestSubmit();
      try { await api('/api/admin/orga-requests/' + r.id, { method: 'DELETE' }); } catch {} loadRequests(); };
    const del = btn('Refuser', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/orga-requests/' + r.id, { method: 'DELETE' }); loadRequests(); });
    const meta = [r.role, r.city, 'canal : ' + r.contact, r.since ? 'depuis ' + r.since : null, r.sponsor ? 'garant : ' + r.sponsor : null,
      new Date(r.t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ');
    const row = li(r.collective, meta, inv, del);
    const a = document.createElement('a'); a.href = r.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = r.link; a.className = 'meta'; row.firstChild.append(a);
    if (r.note) { const n = document.createElement('div'); n.className = 'meta'; n.textContent = '« ' + r.note + ' »'; row.firstChild.append(n); }
    ul.append(row);
  }
}
$('#joinLinkForm').addEventListener('submit', e => {
  e.preventDefault();
  const url = location.origin + '/?rejoindre=' + encodeURIComponent($('#joinCity').value.trim());
  $('#joinUrl').textContent = url; $('#joinQr').textContent = '';
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#joinQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
  $('#joinLinkOut').hidden = false;
});
$('#joinCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#joinUrl').textContent); alertMsg('Lien copié.'); } catch {} };

