// ---- Cartes hébergées : téléchargement depuis l'admin (outil pmtiles sur le serveur) ----
let mapsTimer = null;
const MAP_STEP = { recherche: 'Recherche de la dernière version de la carte…', estimation: 'Calcul de la taille…', 'téléchargement': 'Téléchargement', 'terminé': 'Terminé' };
const mapGo = n => n == null ? '?' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' Go' : Math.max(1, Math.round(n / 1e6)) + ' Mo';
const buildDate = b => b && /^\d{8}$/.test(b) ? `${b.slice(6, 8)}/${b.slice(4, 6)}/${b.slice(0, 4)}` : b || '';
async function loadMaps() {
  clearTimeout(mapsTimer);
  let d; try { d = await api('/api/admin/maps'); } catch (e) { $('#mapsList').textContent = e.message; return; }
  $('#mapsTool').hidden = !!d.tool; $('#mapsCmd').textContent = d.install;
  const j = d.job, running = j && !j.end;
  $('#mapsJob').hidden = !j || (!!j.end && Date.now() - j.end > 10 * 60_000 && !j.err);
  if (j) {
    const pct = j.est && j.done ? Math.min(100, Math.round(j.done / j.est * 100)) : null;
    $('#mapsJobTxt').textContent = `${j.name} : ` + (j.err ? 'échec, ' + j.err : running ? (MAP_STEP[j.step] || j.step) + (j.step === 'téléchargement' ? ` (${pct != null ? pct + ' %, ' : ''}environ ${mapGo(j.est)})` : '') : `carte du ${buildDate(j.build)} en service.`);
    $('#mapsBar').hidden = !running; $('#mapsFill').style.width = (pct || 2) + '%';
    $('#mapsStop').hidden = !running;
  }
  const ul = $('#mapsList'); ul.textContent = '';
  for (const t of d.targets) {
    const li = document.createElement('li'), info = document.createElement('div'), acts = document.createElement('div');
    const b = document.createElement('b'); b.textContent = t.name;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = t.inUse ? [t.file, mapGo(t.bytes), t.build ? 'version du ' + buildDate(t.build) : 'installée à la main'].join(' · ')
      : t.world ? 'pas de carte du monde : en dézoomant, fond OpenStreetMap' : 'pas de carte détaillée : fond OpenStreetMap';
    info.append(b, meta); acts.className = 'acts';
    const dl = document.createElement('button'); dl.type = 'button'; dl.textContent = t.inUse ? 'Mettre à jour' : 'Télécharger'; dl.className = t.inUse ? 'ghost' : '';
    dl.disabled = running || !d.tool;
    dl.onclick = async () => {
      if (!confirm(`${t.world ? 'Carte du monde' : 'Carte de ' + t.name} : le serveur va télécharger la dernière version (${t.world ? 'quelques centaines de Mo' : 'plusieurs Go'}). La taille exacte est vérifiée avant, par rapport à la place libre. Continuer ?`)) return;
      try { await api('/api/admin/maps/download', { method: 'POST', body: JSON.stringify({ code: t.code }) }); loadMaps(); } catch (e) { alertMsg(e.message); }
    };
    acts.append(dl);
    if (t.downloaded) {
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'ghost'; rm.textContent = 'Supprimer'; rm.disabled = running;
      rm.onclick = async () => {
        if (rm.dataset.armed !== '1') { rm.dataset.armed = '1'; rm.textContent = 'Confirmer'; setTimeout(() => { rm.dataset.armed = ''; rm.textContent = 'Supprimer'; }, 4000); return; }
        try { await api('/api/admin/maps/' + encodeURIComponent(t.file), { method: 'DELETE' }); loadMaps(); } catch (e) { alertMsg(e.message); }
      };
      acts.append(rm);
    }
    li.append(info, acts); ul.append(li);
  }
  for (const o of d.others) {
    const li = document.createElement('li'), info = document.createElement('div');
    const b = document.createElement('b'); b.textContent = o.name;
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${mapGo(o.bytes)} · ${o.world ? 'monde' : 'régionale'} · installée à la main (TILE_PMTILES)`;
    info.append(b, meta); li.append(info); ul.append(li);
  }
  $('#mapsFree').textContent = `Place libre : ${mapGo(d.free)} (dossier ${d.dir}).`;
  if (running && !$('#panelCountries').hidden) mapsTimer = setTimeout(loadMaps, 3000);
}
$('#mapsStop').onclick = async () => { try { await api('/api/admin/maps/cancel', { method: 'POST', body: '{}' }); setTimeout(loadMaps, 800); } catch (e) { alertMsg(e.message); } };
$('#mapsCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#mapsCmd').textContent); $('#mapsCopy').textContent = 'Copié'; setTimeout(() => ($('#mapsCopy').textContent = 'Copier'), 2000); } catch { alertMsg($('#mapsCmd').textContent); } };
