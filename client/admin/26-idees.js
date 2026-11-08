// ---- Boîte à idées : validation, statut, version, réponse, fusion des doublons ----
const IDEA_ST = { pending: '⏳ À valider', proposed: '💬 Proposée', study: '🔎 À l’étude', planned: '🗓 Prévue', done: '✅ Faite', no: '✖ Pas retenue' };
let ideaData = [];
function ideaBadge() { api('/api/admin/ideas').then(d => { $('#ideaBadge').textContent = d.pending || ''; }).catch(() => {}); }
async function loadIdeas() {
  let d; try { d = await api('/api/admin/ideas'); } catch (e) { alertMsg(e.message); return; }
  ideaData = d.ideas; $('#ideaBadge').textContent = d.pending || '';
  const nf = d.ideas.filter(i => i.featured).length;
  $('#ideaCount').textContent = `(${d.ideas.length}${d.pending ? ', ' + d.pending + ' à valider' : ''}${nf ? ', ' + nf + ' au vote' : ''})`;
  renderIdeas();
}
function renderIdeas() {
  const f = $('#ideaFilter').value, ul = $('#ideaAdminList'); ul.textContent = '';
  const list = ideaData.filter(i => !f || (f === 'featured' ? i.featured : i.status === f));
  if (!list.length) return empty(ul, 'Aucune idée ici.');
  for (const i of list) {
    const l = document.createElement('li'); l.className = 'st-' + i.status; l.dataset.title = i.title;
    const v = document.createElement('div'); v.className = 'iv'; v.textContent = (i.votes - (i.down || 0) > 0 ? '+' : '') + (i.votes - (i.down || 0)); const vs = document.createElement('small'); vs.textContent = `👍 ${i.votes} · 👎 ${i.down || 0}`; v.append(vs);
    const b = document.createElement('div'); b.className = 'ib';
    const title = document.createElement('input'); title.value = i.title; title.maxLength = 80; title.setAttribute('aria-label', 'Titre');
    const body = document.createElement('p'); body.textContent = i.body || '(sans description)';
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${i.featured ? '🗳 AU VOTE · ' : ''}${IDEA_ST[i.status]} · ${i.lang.toUpperCase()} · reçue le ${dayFr(i.t)} à ${hhmm(i.t)}`;
    const row = document.createElement('div'); row.className = 'controls';
    const st = document.createElement('select'); st.setAttribute('aria-label', 'Statut');
    for (const [k, lab] of Object.entries(IDEA_ST)) st.append(new Option(lab, k));
    st.value = i.status;
    const ver = document.createElement('input'); ver.placeholder = 'version (2.15)'; ver.value = i.version || ''; ver.size = 8; ver.setAttribute('aria-label', 'Version');
    const reply = document.createElement('input'); reply.placeholder = 'Réponse courte (publique)'; reply.value = i.reply || ''; reply.maxLength = 300; reply.style.flex = '1'; reply.setAttribute('aria-label', 'Réponse');
    const save = btn(i.status === 'pending' ? 'Publier' : 'Enregistrer');
    save.onclick = async () => {
      const status = i.status === 'pending' && st.value === 'pending' ? 'proposed' : st.value;
      try { await api('/api/admin/ideas/' + i.id, { method: 'POST', body: JSON.stringify({ title: title.value, status, version: ver.value, reply: reply.value }) }); loadIdeas(); } catch (e) { alertMsg(e.message); }
    };
    row.append(st, ver, reply, save);
    const row2 = document.createElement('div'); row2.className = 'controls';
    const into = document.createElement('select'); into.setAttribute('aria-label', 'Fusionner dans');
    into.append(new Option('Fusionner dans…', ''));
    for (const o of ideaData) if (o.id !== i.id && o.status !== 'pending') into.append(new Option(`${o.title.slice(0, 50)} (👍 ${o.votes} · 👎 ${o.down || 0})`, o.id));
    const merge = btn('Fusionner');
    merge.onclick = async () => { if (!into.value) return; try { await api(`/api/admin/ideas/${i.id}/merge`, { method: 'POST', body: JSON.stringify({ into: into.value }) }); loadIdeas(); } catch (e) { alertMsg(e.message); } };
    const del = btn('Supprimer', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/ideas/' + i.id, { method: 'DELETE' }); loadIdeas(); });
    // Mise au vote : l'idée passe en tête dans l'appli et le rond 💡 apparaît sur la carte
    const feat = btn(i.featured ? 'Retirer du vote' : '🗳 Mettre au vote', i.featured ? 'ghost' : '');
    feat.hidden = !['proposed', 'study', 'planned'].includes(i.status);
    feat.onclick = async () => { try { await api('/api/admin/ideas/' + i.id, { method: 'POST', body: JSON.stringify({ featured: !i.featured }) }); loadIdeas(); } catch (e) { alertMsg(e.message); } };
    row2.append(feat, into, merge, del);
    b.append(title, body, meta, row, row2);
    l.append(v, b); ul.append(l);
  }
}
$('#ideaFilter').onchange = renderIdeas;
$('#tabIdeas').onclick = () => { showTab('Ideas'); loadIdeas(); };
