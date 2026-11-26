// ---- Réglages ----
let setData = null;
async function loadSettings() {
  try { setData = await api('/api/admin/settings'); } catch (e) { alertMsg(e.message); return; }
  const s = setData.settings, df = setData.defaults;
  $('#setBanner').value = s.banner?.text || ''; $('#setFrom').value = s.banner?.from || ''; $('#setTo').value = s.banner?.to || '';
  $('#setBannerDef').textContent = `Nom par défaut : « ${df.event} ». Sans dates, le bandeau reste affiché jusqu’à ce que tu le vides. Un jour de mobilisation prévue, son titre passe devant.`;
  $('#setLat').value = s.view ? s.view.lat : ''; $('#setLng').value = s.view ? s.view.lng : ''; $('#setZoom').value = s.view ? s.view.zoom : '';
  $('#setLat').placeholder = df.center[0]; $('#setLng').placeholder = df.center[1]; $('#setZoom').placeholder = df.zoom;
  $('#setRadius').value = s.alertRadius || ''; $('#setRadius').placeholder = df.alertRadius;
  $('#setNear').value = s.nearKm || ''; $('#setNear').placeholder = df.nearKm;
  $('#setAdminLabel').value = s.adminLabel || '';
  $('#setAndroidTest').value = s.androidTest || '';
  $('#setPlayStore').value = s.playStore || '';
  const f = s.feed || {};
  $('#setFeedBase').value = f.base || ''; $('#setFeedLabel').value = f.label || '';
  $('#setFeedEvery').value = f.every || ''; $('#setFeedEvery').placeholder = df.feedEvery;
  $('#setFeedDays').value = f.days || ''; $('#setFeedDays').placeholder = df.feedDays;
  $('#setFeedOff').checked = !!f.off;
  $('#setFeedLabel').placeholder = (f.base || '').replace(/^https:\/\//, '') || 'exemple.org';
  renderFeedState(setData.feed);
  const box = $('#setCats'); box.textContent = '';
  for (const c of setData.categories) {
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !c.off; cb.dataset.cat = c.id; cb.className = 'set-on';
    on.append(cb, ' ' + c.glyph + ' ' + c.label);
    const ttl = document.createElement('input'); ttl.type = 'number'; ttl.min = 5; ttl.max = 1440; ttl.value = c.ttl; ttl.dataset.cat = c.id; ttl.className = 'set-ttl'; ttl.setAttribute('aria-label', 'Durée en minutes : ' + c.label);
    const base = document.createElement('span'); base.className = 'base'; base.textContent = c.ttl !== c.base ? `min (défaut ${c.base})` : 'min';
    box.append(on, ttl, base);
  }
}
$('#setViewReset').onclick = () => { $('#setLat').value = $('#setLng').value = $('#setZoom').value = ''; };
$('#setForm').addEventListener('submit', async e => {
  e.preventDefault();
  const cats = {};
  document.querySelectorAll('#setCats .set-on').forEach(cb => { cats[cb.dataset.cat] = { off: !cb.checked }; });
  document.querySelectorAll('#setCats .set-ttl').forEach(i => { cats[i.dataset.cat].ttl = Number(i.value); });
  const num = id => $(id).value.trim() === '' ? null : Number($(id).value.replace(',', '.'));
  const body = { cats, alertRadius: num('#setRadius'), nearKm: num('#setNear'), adminLabel: $('#setAdminLabel').value.trim(), androidTest: $('#setAndroidTest').value.trim(), playStore: $('#setPlayStore').value.trim() };
  if ($('#setBanner').value.trim()) body.banner = { text: $('#setBanner').value, from: $('#setFrom').value, to: $('#setTo').value };
  if (num('#setLat') != null && num('#setLng') != null) body.view = { lat: num('#setLat'), lng: num('#setLng'), zoom: num('#setZoom') ?? 12 };
  // Agenda d'un site partenaire : sans adresse, la clé n'est pas envoyée, donc l'import s'éteint
  const feedBase = $('#setFeedBase').value.trim();
  if (feedBase) body.feed = { base: feedBase, label: $('#setFeedLabel').value.trim(), every: num('#setFeedEvery'), days: num('#setFeedDays'), off: $('#setFeedOff').checked };
  if ($('#setTo').value && $('#setFrom').value && $('#setTo').value < $('#setFrom').value) return alertMsg('La date de fin est avant la date de début.');
  try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) }); $('#setMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; loadSettings(); }
  catch (err) { alertMsg(err.message); }
});
// État du dernier passage de l'import, et lecture à la demande
function renderFeedState(st) {
  const box = $('#setFeedState'); if (!box) return;
  if (!st) { box.textContent = ''; return; }
  if (!st.on) { box.textContent = st.count ? `Import coupé. ${st.count} événement(s) importé(s) encore affiché(s).` : 'Import éteint.'; return; }
  const l = st.last;
  box.textContent = `${st.count} événement(s) importé(s) en ce moment.` + (!l ? ' Première lecture au prochain passage.'
    : l.ok ? ` Dernière lecture à ${hhmm(l.at)} : ${l.seen} repris de leur carte, ${l.added} ajouté(s) ou mis à jour, ${l.gone} retiré(s).`
    : ` Dernière lecture à ${hhmm(l.at)} : échec (${l.error}).`);
}
$('#setFeedNow').onclick = async () => {
  const b = $('#setFeedNow'); b.disabled = true; b.textContent = 'Lecture…';
  try { renderFeedState((await api('/api/admin/feed', { method: 'POST', body: '{}' })).feed); loadAgenda?.(); }
  catch (e) { alertMsg(e.message); }
  b.disabled = false; b.textContent = 'Lire maintenant';
};
$('#tabSettings').onclick = () => { showTab('Settings'); loadSettings(); };

// ---- L'instance : nom, contact, liens, marque, hébergeur (vide = valeur du serveur) ----
const INST = [['#inEvent', 'event'], ['#inContact', 'contact'], ['#inViolence', 'violenceUrl'], ['#inSource', 'sourceUrl'], ['#inHost', 'hostInfo'],
  ['#inHandle', 'brand.handle'], ['#inInsta', 'brand.instagram'], ['#inSite', 'brand.site'], ['#inKofi', 'brand.kofi']];
const pick = (o, k) => k.split('.').reduce((x, p) => (x ? x[p] : undefined), o);
async function loadInstance() {
  let d; try { d = await api('/api/admin/instance'); } catch (e) { alertMsg(e.message); return; }
  for (const [sel, k] of INST) { $(sel).value = pick(d.set, k) || ''; $(sel).placeholder = pick(d.defaults, k) || '(vide)'; }
}
$('#instForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { brand: {} };
  for (const [sel, k] of INST) { const v = $(sel).value.trim(); if (k.startsWith('brand.')) body.brand[k.slice(6)] = v; else body[k] = v; }
  try { await api('/api/admin/instance', { method: 'POST', body: JSON.stringify(body) }); $('#inMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; loadInstance(); }
  catch (err) { alertMsg(err.message); }
});
$('#tabSettings').addEventListener('click', loadInstance);

// Téléchargement d'un fichier de l'admin (la clé passe dans l'en-tête, pas dans l'adresse)
async function adminDownload(url, name) {
  const r = await fetch(url, { headers: { 'X-Admin-Key': KEY } });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || 'Téléchargement impossible.'); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
