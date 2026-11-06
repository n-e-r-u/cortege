// ---- Lieux de repli : création et modification par l'admin, orgas associées, logo du lieu,
//      nombre de lieux par orga, logos d'orgas à valider ----
const RF = { cfg: { glyphs: ['🕊️'], colors: ['#30a46c'], services: [] }, data: null, edit: null, logo: undefined, map: null, mk: null, vector: null };
const RF_SV = { eau: '💧 Eau', wc: '🚻 Toilettes', ecoute: '👂 Écoute', recharge: '🔋 Recharge', soins: '🩹 Premiers soins', abri: '☂️ À l’abri', pmr: '♿ Accessible PMR' };
fetch('/api/config').then(r => r.json()).then(c => {
  if (c.refuge) RF.cfg = c.refuge;
  RF.vector = c.vector || null;
  $('#rfGlyph').replaceChildren(...RF.cfg.glyphs.map(g => new Option(g, g)));
  $('#rfColor').replaceChildren(...RF.cfg.colors.map(x => { const o = new Option('■ ' + x, x); o.style.color = x; return o; }));
  $('#rfServices').append(...RF.cfg.services.map(sv => { const l = document.createElement('label'), i = document.createElement('input'); i.type = 'checkbox'; i.value = sv; l.append(i, ' ' + (RF_SV[sv] || sv)); return l; }));
}).catch(() => {});

const rfHHMM = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const rfAt = v => { const [h, m] = String(v || '').split(':').map(Number); const d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
{ const now = Date.now(), end = rfAt('20:00'); $('#rfFrom').value = rfHHMM(now); $('#rfTo').value = rfHHMM(end > now + 3600e3 ? end : now + 4 * 3600e3); }
function rfSlot() { const now = Date.now(), from = $('#rfFrom').value ? rfAt($('#rfFrom').value) : now; let to = rfAt($('#rfTo').value); if (to <= from) to += 24 * 3600e3; return { from: Math.max(from, now - 3600e3), to }; }

// Aperçu du point tel qu'il apparaîtra sur la carte
function rfPreview() {
  const p = $('#rfPreview'); p.textContent = '';
  if (RF.logo) { const i = document.createElement('img'); i.src = RF.logo; p.append(i); p.style.background = '#fff'; }
  else { p.textContent = $('#rfGlyph').value; p.style.background = $('#rfColor').value; }
}
$('#rfGlyph').onchange = $('#rfColor').onchange = rfPreview;
function rfLogoShow() {
  $('#rfLogoImg').hidden = !RF.logo; if (RF.logo) $('#rfLogoImg').src = RF.logo;
  $('#rfLogoDel').hidden = !RF.logo; rfPreview();
}
$('#rfLogoFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(f); });
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), s = Math.max(128 / img.width, 128 / img.height);
    x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); x.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
    URL.revokeObjectURL(img.src); RF.logo = c.toDataURL('image/png'); rfLogoShow();
  } catch { alertMsg('Image illisible.'); }
};
$('#rfLogoDel').onclick = () => { RF.logo = null; rfLogoShow(); };

// Position : carte (clic) ou « latitude, longitude » collé
const rfParse = v => { const m = String(v).match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/); return m ? [Number(m[1]), Number(m[2])] : null; };
function rfSetPos(ll, pan) {
  $('#rfPos').value = ll[0].toFixed(5) + ', ' + ll[1].toFixed(5);
  if (!RF.map) return;
  if (!RF.mk) RF.mk = L.marker(ll, { draggable: true }).addTo(RF.map).on('dragend', e => rfSetPos([e.target.getLatLng().lat, e.target.getLatLng().lng]));
  else RF.mk.setLatLng(ll);
  if (pan) RF.map.setView(ll, Math.max(RF.map.getZoom(), 16));
}
$('#rfPos').onchange = () => { const ll = rfParse($('#rfPos').value); if (ll) rfSetPos(ll, true); };
function rfMap(center) {
  if (!RF.map) {
    RF.map = L.map('rfMap', { zoomControl: true, attributionControl: true }).setView(center || [46.6, 2.4], center ? 16 : 5);
    if (RF.vector && window.protomapsL && window.cortegeVectorLayer) window.cortegeVectorLayer(window.protomapsL, { url: RF.vector.url, lang: 'fr', maxDataZoom: RF.vector.maxzoom, maxZoom: 20 }).addTo(RF.map);
    else L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(RF.map);
    RF.map.on('click', e => rfSetPos([e.latlng.lat, e.latlng.lng]));
  } else if (center) RF.map.setView(center, 16);
  setTimeout(() => RF.map.invalidateSize(), 50);
}

function rfOpenForm(r) {
  RF.edit = r ? r.id : null; RF.logo = r ? r.logo : null;
  $('#rfFormTitle').textContent = r ? 'Modifier « ' + r.name + ' »' : 'Nouveau lieu';
  $('#rfName').value = r ? r.name : ''; $('#rfShort').value = r ? r.short : ''; $('#rfAddr').value = r ? r.addr : '';
  $('#rfMsg').value = r ? r.msg : ''; $('#rfUrl').value = r ? r.url : '';
  $('#rfGlyph').value = r ? r.glyph : RF.cfg.glyphs[0]; $('#rfColor').value = r ? r.color : RF.cfg.colors[0];
  $('#rfUseLogo').checked = r ? r.useLogo : true; $('#rfConsent').checked = !!(r && r.consent);
  document.querySelectorAll('#rfServices input').forEach(i => { i.checked = !!(r && r.services.includes(i.value)); });
  // Orgas : cases à cocher, les orgas déjà associées d'abord
  const box = $('#rfOrgas'); box.querySelectorAll('label').forEach(l => l.remove());
  const sel = new Set(r ? r.orgas : []);
  const list = [...RF.data.quotas].sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || a.label.localeCompare(b.label, 'fr'));
  if (!list.length) box.append(Object.assign(document.createElement('label'), { textContent: 'Aucune orga pour l’instant : le lieu sera tenu par l’admin.' }));
  for (const o of list) { const l = document.createElement('label'), i = document.createElement('input'); i.type = 'checkbox'; i.value = o.id; i.checked = sel.has(o.id); l.append(i, ' ' + o.label + (o.trial ? ' (essai)' : '')); box.append(l); }
  $('#rfFormMsg').textContent = '';
  $('#rfForm').hidden = false; $('#rfNew').hidden = true;
  if (RF.mk) { RF.mk.remove(); RF.mk = null; }
  rfMap(r ? [r.lat, r.lng] : null);
  if (r) rfSetPos([r.lat, r.lng]); else $('#rfPos').value = '';
  rfLogoShow();
  $('#rfForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function rfCloseForm() { $('#rfForm').hidden = true; $('#rfNew').hidden = false; RF.edit = null; }
$('#rfNew').onclick = () => rfOpenForm(null);
$('#rfCancel').onclick = rfCloseForm;
$('#rfForm').onsubmit = async e => {
  e.preventDefault();
  const ll = rfParse($('#rfPos').value); if (!ll) { $('#rfFormMsg').textContent = 'Place le lieu sur la carte.'; return; }
  const body = { name: $('#rfName').value, short: $('#rfShort').value, addr: $('#rfAddr').value, msg: $('#rfMsg').value, url: $('#rfUrl').value, lat: ll[0], lng: ll[1],
    services: [...document.querySelectorAll('#rfServices input:checked')].map(i => i.value), glyph: $('#rfGlyph').value, color: $('#rfColor').value,
    useLogo: $('#rfUseLogo').checked, consent: $('#rfConsent').checked, orgas: [...document.querySelectorAll('#rfOrgas input:checked')].map(i => i.value), logo: RF.logo || null };
  try {
    await api('/api/admin/refuges' + (RF.edit ? '/' + RF.edit : ''), { method: 'POST', body: JSON.stringify(body) });
    rfCloseForm(); loadRefuges();
  } catch (err) { $('#rfFormMsg').textContent = err.message; }
};

async function loadRefuges() {
  let d; try { d = await api('/api/admin/refuges'); } catch (e) { alertMsg(e.message); return; }
  RF.data = d;
  const names = Object.fromEntries(d.quotas.map(o => [o.id, o.label]));
  $('#rfCount').textContent = d.refuges.length ? `(${d.refuges.filter(r => r.open).length} ouvert(s) sur ${d.refuges.length})` : '';
  // Tous les lieux
  const ul = $('#rfList'); ul.textContent = '';
  if (!d.refuges.length) empty(ul, 'Aucun lieu enregistré.');
  for (const r of d.refuges) {
    const st = async s => { try { await api(`/api/admin/refuges/${r.id}/state`, { method: 'POST', body: JSON.stringify({ state: s }) }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    const open = btn(r.open ? (r.state === 'full' ? 'Plus complet' : 'Complet') : 'Ouvrir');
    open.onclick = r.open ? () => st(r.state === 'full' ? 'open' : 'full') : async () => {
      try { await api('/api/admin/refuges/open', { method: 'POST', body: JSON.stringify({ ids: [r.id], ...rfSlot() }) }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    const close = btn('Fermer'); close.onclick = () => st('closed'); close.hidden = !r.open;
    const edit = btn('Modifier'); edit.onclick = () => rfOpenForm(r);
    const del = btn('Retirer', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/refuges/' + r.id, { method: 'DELETE' }); loadRefuges(); });
    const who = r.orgas.length ? r.orgas.map(id => names[id] || (id === 'admin' ? 'admin' : '?')).join(', ') : 'tenu par l’admin';
    const state = r.open ? (r.state === 'full' ? 'complet' : 'ouvert') + ' jusqu’à ' + hhmm(r.to) : r.state !== 'closed' && r.from > Date.now() ? 'ouvre à ' + hhmm(r.from) : 'fermé';
    const item = li(r.name, [who, state, r.addr, r.consent ? null : '⚠ accord du lieu non coché'].filter(Boolean).join(' · '), open, close, edit, del);
    const th = document.createElement('span'); th.className = 'rf-thumb';
    if (r.logo) { const i = document.createElement('img'); i.src = r.logo; i.alt = ''; th.append(i); } else { th.textContent = r.glyph; th.style.background = r.color; }
    item.prepend(th); ul.append(item);
  }
  // Nombre de lieux par orga
  $('#rfQuotaHint').textContent = `Par défaut : ${d.defaultMax} lieu(x) par orga (REFUGE_MAX). Règle-le orga par orga, de 0 à ${d.quotaMax} ; les lieux que tu associes toi-même ne sont pas limités.`;
  const uq = $('#rfQuotas'); uq.textContent = '';
  if (!d.quotas.length) empty(uq, 'Aucune orga pour l’instant.');
  for (const o of d.quotas) {
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = 0; inp.max = d.quotaMax; inp.value = o.max; inp.className = 'rf-quota'; inp.setAttribute('aria-label', 'Nombre de lieux pour ' + o.label);
    const save = btn('Enregistrer'); save.hidden = true;
    inp.oninput = () => { save.hidden = Number(inp.value) === o.max; };
    save.onclick = async () => { try { await api('/api/admin/refuge-quota/' + encodeURIComponent(o.id), { method: 'POST', body: JSON.stringify({ max: Number(inp.value) }) }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    uq.append(li(o.label + (o.trial ? ' (essai)' : ''), `${o.count} lieu(x) associé(s) · ${o.max} au plus`, inp, save));
  }
  // Logos d'orgas à valider
  const lg = $('#rfLogos'); lg.textContent = '';
  if (!d.logos.length) empty(lg, 'Aucun logo en attente.');
  for (const l of d.logos) {
    const ok = btn('Valider'), no = btn('Refuser', 'danger');
    ok.onclick = async () => { try { await api(`/api/admin/logos/${encodeURIComponent(l.oid)}/ok`, { method: 'POST', body: '{}' }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    no.onclick = async () => { try { await api(`/api/admin/logos/${encodeURIComponent(l.oid)}/no`, { method: 'POST', body: '{}' }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    const item = li(l.orga, 'envoyé le ' + dayFr(l.t) + ' à ' + hhmm(l.t), ok, no);
    const img = document.createElement('img'); img.src = l.img; img.alt = 'Logo de ' + l.orga; img.className = 'rf-pend';
    item.prepend(img); lg.append(item);
  }
}
{ const prev = $('#tabOrgas').onclick; $('#tabOrgas').onclick = e => { prev && prev(e); loadRefuges(); }; }
