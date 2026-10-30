// ---- Lieux permanents ----
let plKinds = {}, plTimer = null;
async function loadPlaces(search = false) {
  clearTimeout(plTimer);
  const qs = new URLSearchParams({ q: $('#plQ').value.trim(), kind: $('#plKind').value, filter: $('#plFilter').value });
  let d; try { d = await api('/api/admin/places?' + (search ? qs : '')); } catch (e) { alertMsg(e.message); return; }
  if (!Object.keys(plKinds).length) {
    d.kinds.forEach(k => { plKinds[k.id] = k; $('#plKind').append(new Option(k.glyph + ' ' + k.label, k.id)); $('#plAddKind').append(new Option(k.glyph + ' ' + k.label, k.id)); });
  }
  const L0 = d.last;
  const R0 = d.running || d.paused;
  const GB = n => (n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' Go';
  const osmStep = R => R.step === 'téléchargement' ? `téléchargement de la copie d’OpenStreetMap${R.parts > 1 ? ` (${R.part} / ${R.parts})` : ''} : ${GB(R.done || 0)}${R.total ? ' / ' + GB(R.total) + ` (${Math.floor((R.done || 0) / R.total * 100)} %)` : ''}`
    : R.step === 'extraction' ? 'extraction des lieux, des caméras et des contours de communes (quelques minutes, en priorité basse)' : `enregistrement : ${fmtN(R.n || 0)} lieux et caméras${R.communes ? `, ${fmtN(R.communes)} communes` : ''}`;
  $('#plState').textContent = d.running && R0.src === 'osm' ? `Mise à jour en cours, ${osmStep(R0)}.`
    : d.paused && R0.src === 'osm' ? 'Mise à jour interrompue (redémarrage du serveur). Elle recommence toute seule dans les minutes qui suivent, ou avec le bouton.'
    : d.running && R0.src === 'carte' ? `Lecture de la carte du serveur : ${fmtN(R0.done || 0)} / ${R0.total ? fmtN(R0.total) : '?'} morceaux de carte (${R0.total ? Math.floor((R0.done || 0) / R0.total * 100) : 0} %), ${fmtN(R0.n || 0)} lieux trouvés.`
    : d.running ? `Mise à jour en cours : ${R0.done || 0} / ${R0.total || '?'} zones, ${fmtN(R0.n || 0)} lieux trouvés${R0.errs ? `, ${R0.errs} zone(s) en échec` : ''}.`
      + (R0.cur ? ` Demande en cours à ${R0.cur.host} depuis ${Math.round((Date.now() - R0.cur.since) / 1000)} s.` : '') + (R0.err ? ` Dernière erreur : ${R0.err}.` : '')
    : d.paused ? `Mise à jour interrompue à ${R0.done} / ${R0.total} zones (redémarrage du serveur). Elle reprend toute seule dans les minutes qui suivent, ou avec le bouton.` + (R0.err ? ` Dernière erreur : ${R0.err}.` : '')
    : L0 ? `Dernière mise à jour : ${dayFr(L0.t)} à ${hhmm(L0.t)} · ${fmtN(L0.n)} lieux${L0.src === 'carte' ? ' lus dans la carte du serveur' : L0.src === 'osm' ? ' et caméras, depuis la copie complète d’OpenStreetMap (Geofabrik)' : ''}${L0.communes ? `, ${fmtN(L0.communes)} contours de communes (bilans par commune)` : ''}${L0.errs && L0.src === 'osm' ? ` · échec : ${L0.err}` : L0.errs ? ` · ${L0.errs} zone(s) en échec (${L0.err || 'serveur OpenStreetMap indisponible'}), relance plus tard` : ''}.`
    : 'Pas encore importés.' + (d.auto ? ' Premier import automatique deux minutes après le démarrage.' : '');
  $('#plImport').disabled = !!d.running;
  $('#plImport').textContent = d.paused ? 'Reprendre la mise à jour' : d.source === 'carte' ? 'Relire les lieux dans la carte du serveur' : d.source === 'osm' ? 'Mettre à jour maintenant (téléchargement de plusieurs Go)' : 'Mettre à jour depuis OpenStreetMap';
  const bars = $('#plCounts'); bars.textContent = '';
  const max = Math.max(1, ...Object.values(d.counts));
  for (const k of d.kinds) {
    const n = d.counts[k.id] || 0, row = document.createElement('div'); row.className = 'bar';
    row.innerHTML = '<span class="lbl"></span><span class="track"><span class="fill"></span></span><span class="n"></span>';
    row.querySelector('.lbl').textContent = k.glyph + ' ' + k.label; row.querySelector('.n').textContent = fmtN(n);
    row.querySelector('.fill').style.cssText = `width:${n / max * 100}%;--c:${k.grp === 'aide' ? '#3fcf86' : k.grp === 'surv' ? '#e0383e' : '#9b87e8'}`;
    bars.append(row);
  }
  if (search) renderPlaces(d.list);
  if (d.running) plTimer = setTimeout(() => loadPlaces(false), 5000);
}
function renderPlaces(list) {
  const ul = $('#plList'); ul.textContent = '';
  if (!list.length) return empty(ul, 'Aucun lieu trouvé.');
  for (const x of list) {
    const k = plKinds[x.kind] || { glyph: '📍', label: x.kind };
    const ed = btn('Corriger', 'ghost'), hide = btn(x.hid ? 'Réafficher' : 'Masquer', x.hid ? '' : 'danger');
    hide.onclick = async () => { try { await api('/api/admin/places/' + x.id, { method: 'POST', body: JSON.stringify({ hid: !x.hid }) }); loadPlaces(true); } catch (e) { alertMsg(e.message); } };
    const l = li(`${k.glyph} ${x.n || k.label}${x.hid ? ' · masqué' : ''}${x.ed ? ' · corrigé' : ''}`,
      `${k.label} · ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}${x.h ? ' · ' + x.h : ''}${x.p ? ' · ' + x.p : ''} · ${x.src === 'osm' ? 'OpenStreetMap ' + x.id : 'ajouté ici'}`, ed, hide);
    ed.onclick = () => {
      if (l.querySelector('.edit-form')) return;
      const f = document.createElement('form'); f.className = 'edit-form';
      const inp = (lab, val, max) => { const w = document.createElement('label'); w.className = 'fine'; w.textContent = lab; const i = document.createElement('input'); i.value = val || ''; i.maxLength = max; w.append(i); f.append(w); return i; };
      const sel = document.createElement('select'); Object.values(plKinds).forEach(kk => sel.append(new Option(kk.glyph + ' ' + kk.label, kk.id))); sel.value = x.kind; f.append(sel);
      const n = inp('Nom', x.n, 80), h = inp('Horaires', x.h, 120), p = inp('Téléphone', x.p, 30), pos = inp('Position', x.lat + ', ' + x.lng, 40);
      const save = btn('Enregistrer'); save.type = 'submit'; f.append(save);
      f.onsubmit = async e => {
        e.preventDefault();
        const [la, lo] = pos.value.split(',').map(Number);
        try { await api('/api/admin/places/' + x.id, { method: 'POST', body: JSON.stringify({ kind: sel.value, n: n.value, h: h.value, p: p.value, lat: la, lng: lo }) }); alertMsg('Lieu corrigé.'); loadPlaces(true); }
        catch (err) { alertMsg(err.message); }
      };
      l.append(f); n.focus();
    };
    ul.append(l);
  }
}
$('#plSearch').addEventListener('submit', e => { e.preventDefault(); loadPlaces(true); });
$('#plImport').onclick = async () => { $('#plImport').disabled = true; $('#plState').textContent = 'Lancement…'; try { await api('/api/admin/places/import', { method: 'POST', body: '{}' }); alertMsg('Mise à jour lancée : compter 20 à 40 minutes. Elle reprend toute seule si le serveur redémarre.'); } catch (e) { alertMsg(e.message); } loadPlaces(false); };
$('#plAdd').addEventListener('submit', async e => {
  e.preventDefault();
  const [lat, lng] = $('#plAddPos').value.split(',').map(x => Number(x.trim()));
  try { await api('/api/admin/places', { method: 'POST', body: JSON.stringify({ kind: $('#plAddKind').value, n: $('#plAddName').value, lat, lng, h: $('#plAddHours').value, p: $('#plAddPhone').value }) });
    $('#plAdd').reset(); alertMsg('Lieu ajouté.'); $('#plFilter').value = 'admin'; loadPlaces(true); }
  catch (err) { alertMsg(err.message); }
});
$('#tabPlaces').onclick = () => { showTab('Places'); loadPlaces(false); };

