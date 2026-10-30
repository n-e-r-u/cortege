// ---- Journal des orgas et corbeille ----
const JCATS = {};
fetch('/api/config').then(r => r.json()).then(c => (c.categories || []).forEach(x => (JCATS[x.id] = x)));
const ALERT_ACTIONS = new Set(['retrait bloqué (rafale)', 'legal team (en attente)', 'événement (en attente)']);
let journal = { log: [], trash: [] };
async function loadJournal() {
  try { journal = await api('/api/admin/journal'); } catch (e) { alertMsg(e.message); return; }
  // Corbeille
  const tl = $('#trashList'); tl.textContent = '';
  $('#trashCount').textContent = '(' + journal.trash.length + ')';
  if (!journal.trash.length) empty(tl, 'Corbeille vide.');
  for (const x of journal.trash) {
    const c = JCATS[x.cat] || { glyph: '•', label: x.cat };
    const b = btn('Restaurer');
    b.onclick = async () => { try { await api('/api/admin/trash/' + x.id + '/restore', { method: 'POST', body: '{}' }); alertMsg('Point restauré.'); loadJournal(); } catch (e) { alertMsg(e.message); } };
    tl.append(li(c.glyph + ' ' + c.label + (x.note ? ' · ' + x.note : ''), `${x.orga.startsWith('Votes') ? 'contesté par les votes' : 'retiré par ' + x.orga} à ${hhmm(x.t)} · ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}${x.up ? ' · confirmé ' + x.up + '×' : ''}`, b));
  }
  // Filtre par orga
  const sel = $('#journalOrga'), cur = sel.value;
  const orgas = [...new Set(journal.log.map(x => x.orga))].sort();
  sel.textContent = ''; sel.append(new Option('Toutes', ''), ...orgas.map(o => new Option(o, o))); sel.value = orgas.includes(cur) ? cur : '';
  renderJournal();
  // À vérifier : rafales bloquées et validations en attente (24 h)
  const since = Date.now() - 24 * 3600e3;
  const alerts = journal.log.filter(x => x.t > since && ALERT_ACTIONS.has(x.action));
  // Vague de « Plus là » : beaucoup de points contestés en 30 min
  const recent = journal.log.filter(x => x.action === 'contesté' && x.t > Date.now() - 30 * 60e3);
  if (recent.length >= 10) alerts.unshift({ orga: 'Votes', action: recent.length + ' points contestés en 30 min', t: recent[0].t, detail: 'vérifie la corbeille' });
  $('#journalAlerts').hidden = !alerts.length;
  const al = $('#journalAlertList'); al.textContent = '';
  for (const x of alerts.slice(0, 30)) al.append(li(x.orga + ' : ' + x.action, hhmm(x.t) + (x.detail ? ' · ' + x.detail : '')));
  $('#journalBadge').textContent = alerts.length ? '(' + alerts.length + ')' : '';
}
function renderJournal() {
  const ul = $('#journalList'); ul.textContent = '';
  const f = $('#journalOrga').value, rows = journal.log.filter(x => !f || x.orga === f);
  if (!rows.length) return empty(ul, 'Aucune action enregistrée.');
  for (const x of rows.slice(0, 200)) {
    const c = x.cat ? (JCATS[x.cat] || { glyph: '•', label: x.cat }) : null;
    const where = x.lat != null ? ` · ${x.lat.toFixed(3)}, ${x.lng.toFixed(3)}` : '';
    const day = new Date(x.t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
    ul.append(li(`${x.orga} : ${x.action}${c ? ' ' + c.glyph + ' ' + c.label : ''}`, `${day} ${hhmm(x.t)}${where}${x.detail ? ' · ' + x.detail : ''}`));
  }
}
$('#journalOrga').onchange = renderJournal;

