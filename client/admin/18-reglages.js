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
  const body = { cats, alertRadius: num('#setRadius'), nearKm: num('#setNear'), adminLabel: $('#setAdminLabel').value.trim() };
  if ($('#setBanner').value.trim()) body.banner = { text: $('#setBanner').value, from: $('#setFrom').value, to: $('#setTo').value };
  if (num('#setLat') != null && num('#setLng') != null) body.view = { lat: num('#setLat'), lng: num('#setLng'), zoom: num('#setZoom') ?? 12 };
  if ($('#setTo').value && $('#setFrom').value && $('#setTo').value < $('#setFrom').value) return alertMsg('La date de fin est avant la date de début.');
  try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) }); $('#setMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; loadSettings(); }
  catch (err) { alertMsg(err.message); }
});
$('#tabSettings').onclick = () => { showTab('Settings'); loadSettings(); };
