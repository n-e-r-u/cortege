// ---- Journées de mobilisation ----
let mobEdit = null;
async function loadMobs() {
  let d; try { d = await api('/api/admin/mobs'); } catch (e) { alertMsg(e.message); return; }
  $('#mobDate').min = d.today;
  pubPrompt(d.toPublish); $('#mobBadge').textContent = d.toPublish.length || '';
  const ul = $('#mobList'); ul.textContent = '';
  if (!d.list.length) return empty(ul, 'Aucune journée prévue.');
  for (const m of d.list) {
    const ed = btn('Modifier', 'ghost'), del = btn('Supprimer', 'danger');
    ed.onclick = () => { mobEdit = m.id; $('#mobDate').value = m.date; $('#mobTitle').value = m.title; $('#mobEve').value = m.eve || ''; $('#mobPush').checked = m.push; $('#mobStrict').checked = m.strict;
      $('#mobSave').textContent = 'Enregistrer'; $('#mobCancel').hidden = false; $('#mobForm').scrollIntoView({ behavior: 'smooth' }); };
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/mobs/' + m.id, { method: 'DELETE' }); loadMobs(); });
    const past = m.date < d.today, today = m.date === d.today;
    const st = [m.push ? (m.eveSent ? 'notification envoyée' : 'notification la veille à 20 h') : 'sans notification',
      m.strict ? (m.strictSet ? 'mode renforcé lancé' : 'mode renforcé le jour J') : 'sans mode renforcé', past ? (m.published ? 'bilan publié' : 'bilan pas encore publié') : ''].filter(Boolean).join(' · ');
    ul.append(li((today ? '● Aujourd’hui · ' : '') + dayLong(m.date) + ' · ' + m.title, st, ...(past ? [del] : [ed, del])));
  }
}
const mobReset = () => { mobEdit = null; $('#mobForm').reset(); $('#mobSave').textContent = 'Prévoir la journée'; $('#mobCancel').hidden = true; };
$('#mobCancel').onclick = mobReset;
$('#mobForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { date: $('#mobDate').value, title: $('#mobTitle').value, eve: $('#mobEve').value, push: $('#mobPush').checked, strict: $('#mobStrict').checked };
  try { await api('/api/admin/mobs' + (mobEdit ? '/' + mobEdit : ''), { method: 'POST', body: JSON.stringify(body) }); alertMsg(mobEdit ? 'Journée modifiée.' : 'Journée prévue.'); mobReset(); loadMobs(); }
  catch (err) { alertMsg(err.message); }
});
$('#tabMobs').onclick = () => { showTab('Mobs'); loadMobs(); };

