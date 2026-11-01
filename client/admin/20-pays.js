// ---- Pays : pays couverts, pays principal, état de la carte, corrections du profil ----
let coData = null, coEditing = null;
const MAP_TXT = { detail: f => `carte détaillée (${f.file})`, world: f => `carte du monde seulement (zoom ${f.maxz} au plus), puis fond OpenStreetMap`, osm: () => 'pas de carte hébergée : fond OpenStreetMap' };
async function loadCountries() {
  try { coData = await api('/api/admin/countries'); } catch (e) { alertMsg(e.message); return; }
  const ul = $('#coList'); ul.textContent = '';
  for (const p of coData.list) {
    const li = document.createElement('li'), info = document.createElement('div'), acts = document.createElement('div');
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.active; cb.className = 'co-on'; cb.dataset.code = p.code;
    const b = document.createElement('b'); b.textContent = p.current.name || p.code;
    on.append(cb, ' ', b, ` (${p.code})`);
    const main = document.createElement('label'); main.className = 'check';
    const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'coMain'; rb.value = p.code; rb.checked = p.main;
    main.append(rb, ' pays principal');
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [MAP_TXT[p.map.kind](p.map), p.extra.length ? 'types en plus : ' + p.extra.join(', ') : '', p.orders ? 'arrêtés' : '', p.edited ? 'modifié dans l’admin' : ''].filter(Boolean).join(' · ');
    info.append(on, document.createElement('br'), main, meta);
    acts.className = 'acts';
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'ghost'; ed.textContent = 'Modifier'; ed.onclick = () => editCountry(p.code);
    const ex = document.createElement('button'); ex.type = 'button'; ex.className = 'ghost'; ex.textContent = 'Exporter';
    ex.onclick = () => adminDownload(`/api/admin/countries/${p.code}/export`, p.code + '.json').catch(e => alertMsg(e.message));
    acts.append(ed, ex);
    if (p.edited) {
      const rv = document.createElement('button'); rv.type = 'button'; rv.className = 'ghost'; rv.textContent = 'Revenir à l’origine';
      rv.onclick = async () => {
        if (rv.dataset.armed !== '1') { rv.dataset.armed = '1'; rv.textContent = 'Confirmer'; setTimeout(() => { rv.dataset.armed = ''; rv.textContent = 'Revenir à l’origine'; }, 4000); return; }
        try { await api('/api/admin/countries/' + p.code, { method: 'DELETE' }); if (coEditing === p.code) $('#coEdit').hidden = true; loadCountries(); } catch (e) { alertMsg(e.message); }
      };
      acts.append(rv);
    }
    li.append(info, acts); ul.append(li);
  }
}
$('#coSave').onclick = async () => {
  const on = [...document.querySelectorAll('#coList .co-on')].filter(c => c.checked).map(c => c.dataset.code);
  const main = document.querySelector('#coList input[name=coMain]:checked')?.value;
  if (!on.length) return alertMsg('Garde au moins un pays.');
  if (!main || !on.includes(main)) return alertMsg('Le pays principal doit être coché.');
  try { await api('/api/admin/countries/active', { method: 'POST', body: JSON.stringify({ codes: [main, ...on.filter(c => c !== main)] }) });
    $('#coMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '. Les téléphones l’appliquent à leur prochaine ouverture de l’appli.'; loadCountries(); }
  catch (e) { alertMsg(e.message); }
};
// Droits : « # Titre » puis une ligne par conseil
const rightsToText = r => (r || []).map(s => '# ' + s.title + '\n' + s.items.join('\n')).join('\n\n');
function textToRights(t) {
  const out = [];
  for (const raw of t.split('\n')) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#')) out.push({ title: l.replace(/^#+\s*/, ''), items: [] });
    else { if (!out.length) out.push({ title: 'Tes droits', items: [] }); out[out.length - 1].items.push(l.replace(/^[-•*]\s*/, '')); }
  }
  return out.filter(s => s.title && s.items.length);
}
function editCountry(code) {
  const p = coData.list.find(x => x.code === code); if (!p) return;
  coEditing = code;
  const c = p.current, o = p.original;
  $('#coEditTitle').textContent = 'Modifier : ' + (c.name || code);
  $('#coName').value = c.name || ''; $('#coUnits').value = c.units || 'metric';
  const em = c.emergency || {};
  for (const [sel, k] of [['#coMed', 'medical'], ['#coGen', 'general'], ['#coPol', 'police'], ['#coPha', 'pharmacy']]) $(sel).value = em[k] || '';
  const box = $('#coCats'); box.textContent = '';
  for (const cat of coData.categories) {
    if (cat.profiles && !cat.profiles.includes(code)) continue;
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !(c.hidden || []).includes(cat.id); cb.dataset.cat = cat.id; cb.className = 'co-show';
    on.append(cb, ' ' + cat.glyph + ' ' + cat.label);
    const inp = document.createElement('input'); inp.maxLength = 60; inp.dataset.cat = cat.id; inp.className = 'co-label';
    inp.value = (c.labels || {})[cat.id] || ''; inp.placeholder = (o.labels || {})[cat.id] || cat.label; inp.setAttribute('aria-label', 'Nom : ' + cat.label);
    box.append(on, inp, document.createElement('span'));
  }
  $('#coRights').value = rightsToText(c.rights);
  $('#coViolUrl').value = c.violence?.url || ''; $('#coViolLabel').value = c.violence?.label || '';
  $('#coEditMsg').textContent = '';
  $('#coEdit').hidden = false; $('#coEdit').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#coEditCancel').onclick = () => { $('#coEdit').hidden = true; coEditing = null; };
$('#coEditSave').onclick = async () => {
  if (!coEditing) return;
  const labels = {}, hidden = [];
  document.querySelectorAll('#coCats .co-label').forEach(i => { if (i.value.trim()) labels[i.dataset.cat] = i.value.trim(); });
  document.querySelectorAll('#coCats .co-show').forEach(cb => { if (!cb.checked) hidden.push(cb.dataset.cat); });
  // Les noms d'origine restent ceux du fichier (un champ vide les reprend)
  const p = coData.list.find(x => x.code === coEditing);
  for (const [id, v] of Object.entries(p.original.labels || {})) if (!labels[id]) labels[id] = v;
  const body = { name: $('#coName').value.trim(), units: $('#coUnits').value, labels, hidden,
    emergency: { medical: $('#coMed').value.trim(), general: $('#coGen').value.trim(), police: $('#coPol').value.trim(), pharmacy: $('#coPha').value.trim() },
    rights: textToRights($('#coRights').value),
    violence: $('#coViolUrl').value.trim() ? { url: $('#coViolUrl').value.trim(), label: $('#coViolLabel').value.trim(), ...(p.current.violence?.desc ? { desc: p.current.violence.desc } : {}) } : null };
  try { await api('/api/admin/countries/' + coEditing, { method: 'POST', body: JSON.stringify(body) });
    $('#coEditMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; await loadCountries(); editCountry(coEditing); $('#coEditMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; }
  catch (e) { alertMsg(e.message); }
};
$('#tabCountries').onclick = () => { showTab('Countries'); loadCountries(); };
