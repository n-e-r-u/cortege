// ---- Page publique du jour ----
function pubUi() {
  if (!dg) return;
  $('#pubState').textContent = dg.published ? 'Publiée : ' + location.origin + '/manif/' + dg.date : 'Pas encore publiée.';
  $('#pubBtn').textContent = dg.published ? 'Mettre à jour la page' : 'Publier la page publique';
  $('#pubLink').hidden = !dg.published; $('#pubLink').href = '/manif/' + dg.date;
  let un = document.getElementById('pubDel');
  if (dg.published && !un) { un = btn('Retirer la page', 'danger'); un.id = 'pubDel'; un.type = 'button'; $('#pubBtn').after(un);
    confirmBtn(un, 'Confirmer', async () => { await api('/api/admin/publish/' + dg.date, { method: 'DELETE' }); dg.published = false; un.remove(); pubUi(); }); }
  if (!dg.published && un) un.remove();
}
$('#pubBtn').onclick = async () => {
  if (!dg) return;
  try { await api('/api/admin/publish/' + dg.date, { method: 'POST', body: '{}' }); dg.published = true; pubUi(); alertMsg('Page publiée.'); } catch (e) { alertMsg(e.message); }
};
