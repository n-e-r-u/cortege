// ---- Veille des arrêtés : pages de préfecture surveillées, liens repérés à vérifier ----
let vlDeps = [];
// Site d'une préfecture : www.<nom-du-département>.gouv.fr (sans accents ni apostrophes) ; Paris : préfecture de police
const vlSite = (code, name) => code === '75' ? 'https://www.prefecturedepolice.interieur.gouv.fr/'
  : 'https://www.' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/\s+/g, '-') + '.gouv.fr/';
async function loadVeille() {
  let d; try { d = await api('/api/admin/veille'); } catch (e) { alertMsg(e.message); return; }
  $('#vlCount').textContent = d.hits.length ? `(${d.hits.length})` : '';
  const ul = $('#vlHits'); ul.textContent = '';
  if (!d.hits.length) empty(ul, d.sources.length ? 'Rien de nouveau dans les pages surveillées.' : 'Aucune page surveillée : ajoute celles des préfectures ci-dessous.');
  const depName = c => (vlDeps.find(x => x[0] === c) || [c, ''])[1];
  for (const h of d.hits) {
    const open = document.createElement('a'); open.href = h.url; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = 'Ouvrir';
    open.style.cssText = 'color:var(--accent);align-self:center;font-weight:700';
    const prep = btn('Préparer');
    prep.onclick = () => {
      if (h.dep) $('#oaDep').value = h.dep; $('#oaSrc').value = h.url;
      $('#ordAdminForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#oaCommune').focus();
      api('/api/admin/veille/hits/' + h.id, { method: 'POST', body: JSON.stringify({ status: 'done' }) }).then(loadVeille).catch(() => {});
    };
    const skip = btn('Pas utile', 'ghost');
    skip.onclick = async () => { try { await api('/api/admin/veille/hits/' + h.id, { method: 'POST', body: JSON.stringify({ status: 'skip' }) }); loadVeille(); } catch (e) { alertMsg(e.message); } };
    ul.append(li(`🔎 ${h.title}`, `${h.dep ? h.dep + ' ' + depName(h.dep) + ' · ' : ''}${dayFr(h.t)} à ${hhmm(h.t)} · ${h.kw}`, open, prep, skip));
  }
  $('#vlSrcN').textContent = d.sources.length;
  const sl = $('#vlSrc'); sl.textContent = '';
  for (const s of d.sources) {
    const test = btn('Relire', 'ghost');
    test.onclick = async () => { test.disabled = true; try { const r = await api(`/api/admin/veille/sources/${s.id}/test`, { method: 'POST', body: '{}' }); alertMsg(r.error ? 'Page injoignable : ' + r.error : `${r.n} liens lus, ${r.hits} nouveau(x) à vérifier.`); loadVeille(); } catch (e) { alertMsg(e.message); } finally { test.disabled = false; } };
    const del = btn('Retirer', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/veille/sources/' + s.id, { method: 'DELETE' }); loadVeille(); });
    const state = !s.last ? 'pas encore lue' : s.ok ? `${s.n} liens · lue le ${dayFr(s.last)} à ${hhmm(s.last)}` : `⚠ injoignable (${s.err}) · ${dayFr(s.last)} à ${hhmm(s.last)}`;
    const row = li(`${s.dep ? s.dep + ' ' + depName(s.dep) : '—'}${s.label ? ' · ' + s.label : ''}`, `${s.url} · ${state}`, test, del);
    if (s.last && !s.ok) row.classList.add('bad');
    sl.append(row);
  }
}
async function veilleDeps() {
  if (vlDeps.length) return;
  try { vlDeps = (await api('/api/admin/orders')).deps; } catch { return; }
  $('#vlDep').append(new Option('Choisir…', ''));
  vlDeps.forEach(([c, n]) => $('#vlDep').append(new Option(c + ' · ' + n, c)));
}
$('#vlGuess').onclick = () => {
  const c = $('#vlDep').value, d = vlDeps.find(x => x[0] === c);
  if (!d) { $('#vlMsg').textContent = 'Choisis d’abord le département.'; return; }
  $('#vlUrl').value = vlSite(d[0], d[1]); if (!$('#vlLabel').value) $('#vlLabel').value = 'accueil';
  $('#vlMsg').textContent = 'Adresse proposée : vérifie qu’elle ouvre bien le site de la préfecture avant de l’ajouter.';
};
$('#vlForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#vlMsg').textContent = 'Première lecture…';
  try {
    const r = await api('/api/admin/veille/sources', { method: 'POST', body: JSON.stringify({ dep: $('#vlDep').value, url: $('#vlUrl').value, label: $('#vlLabel').value }) });
    $('#vlMsg').textContent = r.error ? `Ajoutée, mais la page ne répond pas pour l’instant (${r.error}).` : `Ajoutée : ${r.n} liens lus. Les nouveaux liens seront signalés à partir de maintenant.`;
    $('#vlUrl').value = ''; $('#vlLabel').value = ''; loadVeille();
  } catch (err) { $('#vlMsg').textContent = err.message; }
});
{ const prev = $('#tabOrders').onclick; $('#tabOrders').onclick = () => { prev && prev(); veilleDeps().then(loadVeille); }; }
