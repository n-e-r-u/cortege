// ---- Agenda : validation des propositions ----
const EVT = {};
fetch('/api/config').then(r => r.json()).then(c => (c.eventTypes || []).forEach(t => (EVT[t.id] = t)));
const when = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function loadAgenda() {
  let d; try { d = await api('/api/admin/events'); } catch (e) { alertMsg(e.message); return; }
  const pending = d.events.filter(e => e.status === 'pending'), ok = d.events.filter(e => e.status === 'ok');
  $('#pendingBadge').textContent = pending.length || '';
  for (const [ul, list, none] of [[$('#pendingList'), pending, 'Aucune proposition en attente.'], [$('#eventList'), ok, 'Aucun événement à venir.']]) {
    ul.textContent = '';
    if (!list.length) { empty(ul, none); continue; }
    for (const e of list) {
      const t = EVT[e.type] || { glyph: '📍', label: e.type };
      const map = document.createElement('a'); map.href = `https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=16/${e.lat}/${e.lng}`; map.target = '_blank'; map.rel = 'noopener'; map.textContent = 'voir le lieu';
      map.style.cssText = 'color:var(--accent);align-self:center;font-size:13px';
      const del = btn(e.status === 'pending' ? 'Refuser' : 'Retirer', 'danger');
      confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/events/' + e.id, { method: 'DELETE' }); loadAgenda(); });
      const buttons = [map];
      if (e.status === 'pending') { const okb = btn('Valider'); okb.onclick = async () => { try { await api('/api/admin/events/' + e.id + '/approve', { method: 'POST', body: '{}' }); loadAgenda(); } catch (err) { alertMsg(err.message); } }; buttons.push(okb); }
      buttons.push(del);
      ul.append(li(`${t.glyph} ${e.title}`, `${t.label} · ${when(e.start)} · ${e.place}${e.route ? ' · parcours tracé' : ''}${e.note ? ' · « ' + e.note + ' »' : ''} · ${e.by}`, ...buttons));
    }
  }
}

