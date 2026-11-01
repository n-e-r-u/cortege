// ---- Langues : traductions livrées ou déposées, langues proposées, langue par défaut ----
let lgData = null;
async function loadLangs(d) {
  if (d) lgData = d; else { try { lgData = await api('/api/admin/langs'); } catch (e) { alertMsg(e.message); return; } }
  $('#lgIntro').textContent = `${lgData.total} textes à traduire dans l’appli. Langue par défaut, pour les téléphones dont la langue n’est pas proposée : ${lgData.langs.find(l => l.code === lgData.def)?.name || lgData.def}.`;
  const ul = $('#lgList'); ul.textContent = '';
  for (const l of lgData.langs) {
    const li = document.createElement('li'), info = document.createElement('div'), acts = document.createElement('div');
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = l.active; cb.disabled = l.code === 'fr';
    cb.onchange = () => saveLangPrefs({ off: lgData.langs.filter(x => x.code !== 'fr' && (x.code === l.code ? !cb.checked : !x.active)).map(x => x.code) });
    const b = document.createElement('b'); b.textContent = l.name; b.dir = l.dir;
    on.append(cb, ' ', b, ` (${l.code})`, cb.disabled ? ' · texte d’origine' : ' · proposée');
    const def = document.createElement('label'); def.className = 'check';
    const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'lgDef'; rb.checked = l.code === lgData.def; rb.disabled = !l.active;
    rb.onchange = () => saveLangPrefs({ def: l.code });
    def.append(rb, ' par défaut');
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [l.code === 'fr' ? (l.n ? `${l.n} correction(s) du français` : 'aucune correction') : `${l.pct ?? '?'} % traduit (${fmtN(l.n)} texte${l.n > 1 ? 's' : ''})`,
      l.src === 'upload' ? (l.over ? 'fichier déposé dans l’admin, à la place du fichier livré' : 'fichier déposé dans l’admin') : 'livrée avec Cortège'].join(' · ');
    if (l.code !== 'fr' && l.pct != null) { const bar = document.createElement('span'), fill = document.createElement('i'); bar.className = 'lg-bar';
      fill.style.width = l.pct + '%'; bar.append(fill); meta.append(bar); }
    info.append(on, document.createElement('br'), def, meta);
    acts.className = 'acts';
    if (l.hasPo) { const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'ghost'; dl.textContent = 'Télécharger le .po';
      dl.onclick = () => adminDownload(`/api/admin/langs/${l.code}.po`, l.code + '.po').catch(e => alertMsg(e.message)); acts.append(dl); }
    if (l.src === 'upload') {
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'ghost'; rm.textContent = l.over ? 'Revenir au fichier livré' : 'Retirer';
      rm.onclick = async () => {
        if (rm.dataset.armed !== '1') { rm.dataset.armed = '1'; const t = rm.textContent; rm.textContent = 'Confirmer'; setTimeout(() => { rm.dataset.armed = ''; rm.textContent = t; }, 4000); return; }
        try { loadLangs(await api('/api/admin/langs/' + l.code, { method: 'DELETE' })); } catch (e) { alertMsg(e.message); }
      };
      acts.append(rm);
    }
    li.append(info, acts); ul.append(li);
  }
}
async function saveLangPrefs(body) {
  try { loadLangs(await api('/api/admin/langs/prefs', { method: 'POST', body: JSON.stringify(body) })); }
  catch (e) { alertMsg(e.message); loadLangs(); }
}
$('#lgUpload').onclick = async () => {
  const f = $('#lgFile').files[0]; $('#lgProblems').textContent = '';
  if (!f) return alertMsg('Choisis d’abord un fichier .po.');
  if (f.size > 2_500_000) return alertMsg('Fichier trop gros pour une traduction.');
  $('#lgUpMsg').textContent = 'Vérification…';
  try {
    const r = await api('/api/admin/langs/upload', { method: 'POST', body: JSON.stringify({ text: await f.text(), file: f.name }) });
    $('#lgUpMsg').textContent = `${r.name} (${r.code}) en ligne : ${fmtN(r.n)} texte${r.n > 1 ? 's' : ''} traduit${r.n > 1 ? 's' : ''}.` + (r.active ? '' : ' Coche-la dans la liste pour la proposer dans l’appli.')
      + (r.warnings.length ? ` ${r.warnings.length} point(s) à vérifier :` : '');
    for (const w of r.warnings) { const li = document.createElement('li'); li.textContent = w; $('#lgProblems').append(li); }
    $('#lgFile').value = ''; loadLangs();
  } catch (e) {
    $('#lgUpMsg').textContent = e.message;
    for (const p of e.problems || []) { const li = document.createElement('li'); li.textContent = p; $('#lgProblems').append(li); }
  }
};
$('#lgNewDl').onclick = () => {
  const code = $('#lgNewCode').value.trim().replace('_', '-'), name = $('#lgNewName').value.trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code)) return alertMsg('Code de langue attendu : de, it, pt-BR…');
  adminDownload(`/api/admin/langs/${code}.po?name=${encodeURIComponent(name || code)}`, code + '.po').catch(e => alertMsg(e.message));
};
$('#lgPot').onclick = e => { e.preventDefault(); adminDownload('/api/admin/langs/cortege.pot', 'cortege.pot').catch(err => alertMsg(err.message)); };
$('#tabLangs').onclick = () => { showTab('Langs'); loadLangs(); };
