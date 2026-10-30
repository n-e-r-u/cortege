// ---- Arrêtés et restrictions ----
let ordKinds = {};
async function loadOrders() {
  let d; try { d = await api('/api/admin/orders'); } catch (e) { alertMsg(e.message); return; }
  ordKinds = Object.fromEntries(d.kinds.map(k => [k.id, k]));
  if (!$('#oaDep').options.length) { $('#oaDep').append(new Option('Choisir…', '')); d.deps.forEach(([c, n]) => $('#oaDep').append(new Option(c + ' · ' + n, c))); }
  const pending = d.orders.filter(o => o.status === 'pending'), ok = d.orders.filter(o => o.status === 'ok');
  $('#ordBadge').textContent = pending.length || '';
  for (const [ul, list, none] of [[$('#ordPending'), pending, 'Aucune proposition en attente.'], [$('#ordList'), ok, 'Aucun arrêté en cours ou à venir.']]) {
    ul.textContent = '';
    if (!list.length) { empty(ul, none); continue; }
    for (const o of list) {
      const src = document.createElement('a'); src.href = o.src; src.target = '_blank'; src.rel = 'noopener noreferrer'; src.textContent = 'source : ' + (o.host || 'lien');
      src.style.cssText = 'color:var(--accent);align-self:center;font-size:13px';
      const del = btn(o.status === 'pending' ? 'Refuser' : 'Retirer', 'danger');
      confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/orders/' + o.id, { method: 'DELETE' }); loadOrders(); });
      const buttons = [src];
      if (o.status === 'pending') { const okb = btn('Valider'); okb.onclick = async () => { okb.disabled = true; try { await api('/api/admin/orders/' + o.id + '/approve', { method: 'POST', body: '{}' }); alertMsg('Arrêté publié.'); loadOrders(); } catch (err) { alertMsg(err.message); okb.disabled = false; } }; buttons.push(okb); }
      buttons.push(del);
      const zone = o.zone ? o.zone.name + (o.zone.scope === 'dep' ? ' (département)' : ` (${o.zone.dep})`) : (o.commune ? o.commune + ' (' + o.dep + ')' : 'département ' + o.dep);
      ul.append(li(`🚫 ${zone}`, `${when(o.start)} → ${when(o.end)} · ${o.items.map(x => (ordKinds[x.k] || { glyph: 'ℹ' }).glyph + ' ' + x.text).join(' · ')} · ${o.by}`, ...buttons));
    }
  }
}
$('#tabOrders').onclick = () => { showTab('Orders'); loadOrders(); };
$('#ordAdminForm').addEventListener('submit', async e => {
  e.preventDefault();
  const items = $('#oaItems').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(manif|perimetre|couvre|transport|consigne|autre)\s*:\s*(.+)$/i); return m ? { k: m[1].toLowerCase(), text: m[2] } : { k: 'autre', text: l }; });
  const body = { dep: $('#oaDep').value, commune: $('#oaCommune').value, start: new Date($('#oaStart').value).getTime(), end: new Date($('#oaEnd').value).getTime(), items, src: $('#oaSrc').value };
  try { await api('/api/admin/orders', { method: 'POST', body: JSON.stringify(body) }); alertMsg('Arrêté publié.'); $('#ordAdminForm').reset(); loadOrders(); } catch (err) { alertMsg(err.message); }
});
$('#ordImportForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const d = await api('/api/admin/orders/import', { method: 'POST', body: JSON.stringify({ text: $('#oiText').value }) });
    const bad = d.results.filter(r => !r.ok);
    $('#oiMsg').textContent = `${d.results.length - bad.length} publié(s) sur ${d.results.length}.` + (bad.length ? ' Refusés : ' + bad.map(r => `${r.name} (${r.error})`).join(' ; ') : '');
    if (!bad.length) $('#oiText').value = '';
    loadOrders();
  } catch (err) { alertMsg(err.message); }
});

