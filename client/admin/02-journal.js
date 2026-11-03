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
  // Filtre par orga : toutes celles qui ont un historique (le journal est gardé en entier, lu par pages côté serveur)
  const sel = $('#journalOrga'), cur = sel.value;
  sel.textContent = ''; sel.append(new Option('Toutes', ''), ...(journal.orgas || []).map(o => new Option(`${o.label} (${o.n})`, o.o)));
  sel.value = (journal.orgas || []).some(o => o.o === cur) ? cur : '';
  jView = { log: journal.log, more: journal.more };
  if (sel.value) await loadJournalOrga(); else renderJournal();
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
let jView = { log: [], more: false };
async function loadJournalOrga() {
  const o = $('#journalOrga').value;
  try { const d = await api('/api/admin/journal' + (o ? '?o=' + encodeURIComponent(o) : '')); jView = { log: d.log, more: d.more }; } catch (e) { alertMsg(e.message); }
  renderJournal();
}
function renderJournal() {
  const ul = $('#journalList'); ul.textContent = '';
  const rows = jView.log;
  $('#journalMore').hidden = !jView.more;
  if (!rows.length) return empty(ul, 'Aucune action enregistrée.');
  for (const x of rows) {
    const c = x.cat ? (JCATS[x.cat] || { glyph: '•', label: x.cat }) : null;
    const where = x.lat != null ? ` · ${x.lat.toFixed(3)}, ${x.lng.toFixed(3)}` : '';
    const day = new Date(x.t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
    ul.append(li(`${x.orga} : ${x.action}${c ? ' ' + c.glyph + ' ' + c.label : ''}`, `${day} ${hhmm(x.t)}${where}${x.detail ? ' · ' + x.detail : ''}`));
  }
}
$('#journalOrga').onchange = loadJournalOrga;
$('#journalMore').onclick = async () => {
  const o = $('#journalOrga').value, last = jView.log[jView.log.length - 1];
  if (!last) return;
  try { const d = await api('/api/admin/journal?before=' + last.t + (o ? '&o=' + encodeURIComponent(o) : '')); jView = { log: jView.log.concat(d.log), more: d.more }; renderJournal(); } catch (e) { alertMsg(e.message); }
};
$('#journalCsv').onclick = () => { const o = $('#journalOrga').value; adminDownload('/api/admin/journal.csv' + (o ? '?o=' + encodeURIComponent(o) : ''), 'journal-orgas.csv').catch(e => alertMsg(e.message)); };
// Depuis la liste des orgas : ouvrir son historique complet
function openOrgaHistory(o, label) { showTab('Journal'); loadJournal().then(() => { const sel = $('#journalOrga'); if (![...sel.options].some(x => x.value === o)) sel.append(new Option(label + ' (0)', o)); sel.value = o; loadJournalOrga(); }); }

