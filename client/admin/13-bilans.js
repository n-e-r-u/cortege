// ==== 2.2 ====
const fmtN = n => Number(n || 0).toLocaleString('fr-FR');
const dayLong = d => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dur = s => s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h ' + String(Math.round(s % 3600 / 60)).padStart(2, '0') : Math.floor(s / 86400) + ' j ' + Math.floor(s % 86400 / 3600) + ' h';
const kv = (dl, rows) => { dl.textContent = ''; for (const [k, v] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); } };
const kpi = (n, label) => { const d = document.createElement('div'); d.className = 'kpi'; const b = document.createElement('b'); b.textContent = n; const sp = document.createElement('span'); sp.textContent = label; d.append(b, sp); return d; };

// ---- Bilans à publier (le lendemain d'une journée prévue) ----
function pubPrompt(list) {
  const ul = $('#pubPromptList'); ul.textContent = '';
  $('#pubPrompt').hidden = !list.length;
  for (const m of list) {
    const go = btn('Publier le bilan'), see = btn('Voir le digest', 'ghost');
    go.onclick = async () => { try { const r = await api('/api/admin/publish/' + m.date, { method: 'POST', body: '{}' }); alertMsg('Bilan publié : ' + location.origin + r.url); loadBadges(); } catch (e) { alertMsg(e.message); } };
    see.onclick = () => { $('#tabDigest').click(); $('#date').value = m.date; $('#form').requestSubmit(); };
    ul.append(li(m.title, dayLong(m.date) + ' · les chiffres de la page publique sont figés au moment de la publication', see, go));
  }
}

