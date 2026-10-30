// ---- Modération ----
// Explication en clair de chaque raison (calculée par le serveur)
const MOD_WHY = {
  contested: r => `Contesté : ${r.down} ${r.down > 1 ? 'personnes disent' : 'personne dit'} que ce n’est plus là. Si c’est toujours vrai, « C’est vrai » le remet ; sinon, retire-le.`,
  down: r => `${r.down} « Plus là », pas encore assez pour le contester. Rien d’urgent.`,
  series: () => 'Danger signalé près d’une zone calme par un téléphone qui en a signalé près de plusieurs zones calmes en peu de temps. Peut-être une tentative de faire fuir les gens d’un endroit sûr.',
  new: () => 'Pas encore confirmé : envoyé par un téléphone tout récent pendant le mode manif renforcé. Il s’affiche avec la mention « Pas encore confirmé ». Rien à faire, sauf si tu sais qu’il est faux.',
  isolated: () => 'Isolé : aucun autre signalement à moins de 500 km. Souvent un test ou une position fausse.',
  abroad: () => 'Hors de France : visible sur la carte en direct, mais pas compté dans les bilans.',
};
const MOD_TAG = { 1: ['Urgent', 'var(--fdo)'], 2: ['À regarder', 'var(--danger)'], 3: ['À regarder', 'var(--danger)'], 4: ['Info', 'var(--info)'], 5: ['Info', 'var(--muted, #888)'] };
let modData = [];
function renderMod() {
  const city = $('#modCity').value, type = $('#modType').value, low = $('#modLow').checked;
  const list = modData.filter(r => (low || !r.low) && (!city || r.place === city) && (!type || r.group === type));
  const ul = $('#modList'); ul.textContent = '';
  const nLow = modData.filter(r => r.low).length;
  $('#modLowN').textContent = nLow ? `(${nLow})` : '';
  $('#modCount').textContent = '(' + modData.filter(r => !r.low).length + ')';
  if (!list.length) return empty(ul, modData.length ? 'Rien avec ces filtres.' : 'Rien à vérifier.');
  for (const r of list) {
    const c = CATS[r.cat] || { glyph: '•', label: r.cat };
    const keep = btn('C’est vrai', 'ghost'), ver = btn('Vérifier'), del = btn('Retirer', 'danger');
    keep.onclick = async () => { try { await api(`/api/admin/reports/${r.id}/keep`, { method: 'POST', body: '{}' }); loadMod(); loadBadges(); } catch (e) { alertMsg(e.message); } };
    ver.onclick = async () => { try { await api(`/api/admin/reports/${r.id}/verify`, { method: 'POST', body: '{}' }); loadMod(); loadBadges(); } catch (e) { alertMsg(e.message); } };
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/reports/' + r.id, { method: 'DELETE' }); loadMod(); loadBadges(); });
    const l = li(`${c.glyph} ${c.label}${r.ver ? ' ✓ ' + r.ver : ''} · ${r.place}`,
      `signalé il y a ${Math.round((Date.now() - r.t) / 60000)} min · ${r.up + 1} personne(s)${r.note ? ' · « ' + r.note + ' »' : ''}`, keep, ver, del);
    const [tag, col] = MOD_TAG[r.prio] || MOD_TAG[4];
    const t = document.createElement('b'); t.textContent = tag + ' '; t.style.color = col;
    l.querySelector('b').prepend(t);
    for (const w of r.why) { const p = document.createElement('p'); p.className = 'fine'; p.style.margin = '4px 0 0'; p.textContent = (MOD_WHY[w] || (() => w))(r); l.querySelector('.meta').append(p); }
    const a = document.createElement('a'); a.href = `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'voir sur une carte'; a.style.color = 'var(--accent)';
    l.querySelector('.meta').append(a);
    ul.append(l);
  }
}
async function loadMod() {
  let d; try { d = await api('/api/admin/moderation'); } catch (e) { alertMsg(e.message); return; }
  modData = d.list;
  const sel = $('#modCity'), cur = sel.value, cities = {};
  for (const r of modData) cities[r.place] = (cities[r.place] || 0) + 1;
  sel.length = 1;
  for (const [n, k] of Object.entries(cities).sort((a, b) => b[1] - a[1])) sel.append(new Option(`${n} (${k})`, n));
  sel.value = cities[cur] ? cur : '';
  renderMod();
}
for (const id of ['#modCity', '#modType', '#modLow']) $(id).addEventListener('change', renderMod);
$('#tabMod').onclick = () => { showTab('Mod'); loadMod(); };
$('#modReload').onclick = loadMod;

