// ---- Annonces (nationales + toutes les annonces actives) ----
const li = (title, meta, ...buttons) => {
  const l = document.createElement('li'), info = document.createElement('div');
  const b = document.createElement('b'); b.textContent = title;
  const m = document.createElement('div'); m.className = 'meta'; m.textContent = meta;
  info.append(b, m);
  const acts = document.createElement('div'); acts.className = 'acts'; acts.append(...buttons);
  l.append(info, acts); return l;
};
const btn = (label, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; return b; };
const empty = (ul, txt) => { const l = document.createElement('li'); l.className = 'meta'; l.textContent = txt; ul.append(l); };
async function loadAnns() {
  let d; try { d = await api('/api/admin/reports'); } catch (e) { alertMsg(e.message); return; }
  $('#pushCount').textContent = d.pushSubs + ' téléphone(s) abonné(s) aux notifications. Une annonce urgente nationale leur arrive à tous.';
  const ul = $('#annAdminList'); ul.textContent = '';
  $('#annCount').textContent = '(' + d.announcements.length + ')';
  $('#annBadge').textContent = d.pending || ''; $('#legalBadge').textContent = d.legalAlerts || '';
  if (!d.announcements.length) return empty(ul, 'Aucune annonce active.');
  for (const a of d.announcements) {
    const del = btn('Retirer', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/announcements/' + a.id, { method: 'DELETE' }); loadAnns(); });
    const what = (a.pending ? '⏳ À VALIDER · ' : '') + (a.kind === 'legal' ? '⚖ Legal team ' + (a.city ? a.city + ' ' : '') + a.phone + (a.text ? ' · ' + a.text : '') : (a.level === 'urgent' ? '⚠ ' : '') + a.text);
    const where = a.national ? 'toute la France' : a.r + ' km autour de ' + a.lat.toFixed(3) + ', ' + a.lng.toFixed(3);
    const buttons = [del];
    if (a.pending) { const ok = btn('Valider'); ok.onclick = async () => { try { await api('/api/admin/announcements/' + a.id + '/approve', { method: 'POST', body: '{}' }); loadAnns(); } catch (e) { alertMsg(e.message); } }; buttons.unshift(ok); }
    ul.append(li(what, `${a.by} · ${where} · ${a.permanent ? 'permanent' : 'jusqu’à ' + hhmm(a.exp)}${a.pending ? ' · vérifie le numéro auprès du collectif avant de valider' : ''}`, ...buttons));
  }
}
$('#natForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ kind: 'info', national: true, text: $('#natText').value, link: $('#natLink').value, level: $('#natLevel').value, minutes: +$('#natMinutes').value }) });
    $('#natText').value = ''; $('#natLink').value = ''; alertMsg('Annonce nationale publiée.'); loadAnns();
  } catch (err) { alertMsg(err.message); }
});

