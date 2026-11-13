// ---- Équipes medic : invitations, référent·es, rayon des urgences vitales, totaux (jamais de positions) ----
function mdInvite(o) {
  const url = location.origin + '/?invite=' + o.invite;
  $('#mdLinkLabel').textContent = o.label; $('#mdLinkUrl').textContent = url;
  $('#mdLinkExp').textContent = new Date(o.exp).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('#mdLinkQr').textContent = '';
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#mdLinkQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
  $('#mdLink').hidden = false; $('#mdLink').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function loadMedics() {
  let d; try { d = await api('/api/admin/medics'); } catch (e) { alertMsg(e.message); return; }
  const s = d.stats;
  $('#mdCount').textContent = `(${d.teams.length})`;
  $('#mdStats').textContent = `En ce moment : ${s.pos} équipe(s) qui partagent leur position, ${s.help} appel(s) de renfort ouvert(s), ${s.hot} point(s) chaud(s), ${s.block} barrage(s) filtrant(s), ${s.listening} écran(s) medic ouvert(s). Renforts demandés aujourd’hui : ${s.helpsToday}.`;
  $('#mdRadius').value = d.cfg.radiusKm;
  const ul = $('#mdList'); ul.textContent = '';
  if (!d.teams.length) return empty(ul, 'Aucune équipe medic pour l’instant.');
  const names = Object.fromEntries(d.teams.map(t => [t.id, t.label]));
  for (const o of d.teams.sort((a, b) => (a.city || '').localeCompare(b.city || '', 'fr') || a.label.localeCompare(b.label, 'fr'))) {
    const li = document.createElement('li'), info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = (o.ref ? '★ ' : '') + o.label;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = (o.city ? o.city + ' · ' : '') + (o.ref ? 'RÉFÉRENT·E · ' : '')
      + (o.active ? 'activée' + (o.devices > 1 ? ' (' + o.devices + ' appareils)' : '') + (o.rec ? ' · code de secours' : ' · sans code de secours') : o.invite ? 'invitation en attente' : 'invitation expirée')
      + (o.by !== 'admin' ? ' · invitée par ' + (names[o.by] || 'une équipe retirée') : '');
    info.append(name, meta);
    const ref = btn(o.ref ? 'Retirer le rôle de référent·e' : 'Nommer référent·e', 'ghost');
    ref.onclick = async () => { try { await api('/api/admin/medics/' + o.id, { method: 'POST', body: JSON.stringify({ ref: !o.ref }) }); loadMedics(); } catch (e) { alertMsg(e.message); } };
    const again = btn('Nouvelle invitation', 'ghost');
    confirmBtn(again, o.active ? 'Confirmer : l’accès actuel sera coupé' : 'Confirmer', async () => { mdInvite(await api(`/api/admin/medics/${o.id}/invite`, { method: 'POST', body: '{}' })); loadMedics(); });
    const del = btn('Retirer', 'danger');
    confirmBtn(del, 'Confirmer le retrait', async () => { await api('/api/admin/medics/' + o.id, { method: 'DELETE' }); loadMedics(); });
    const acts = document.createElement('div'); acts.className = 'controls'; acts.append(ref, again, del);
    li.append(info, acts); ul.append(li);
  }
}
$('#mdForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const o = await api('/api/admin/medics', { method: 'POST', body: JSON.stringify({ label: $('#mdLabel').value, city: $('#mdCity').value, ref: $('#mdRef').checked }) });
    $('#mdLabel').value = ''; $('#mdRef').checked = false; mdInvite(o); loadMedics();
  } catch (err) { alertMsg(err.message); }
});
$('#mdLinkCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#mdLinkUrl').textContent); $('#mdLinkCopy').textContent = 'Copié'; setTimeout(() => { $('#mdLinkCopy').textContent = 'Copier le lien'; }, 2000); } catch {} };
$('#mdRadiusSave').onclick = async () => { try { await api('/api/admin/medics/config', { method: 'POST', body: JSON.stringify({ radiusKm: Number($('#mdRadius').value) }) }); loadMedics(); } catch (e) { alertMsg(e.message); } };
$('#tabMedics').onclick = () => { showTab('Medics'); loadMedics(); };
