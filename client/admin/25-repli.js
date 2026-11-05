// ---- Lieux de repli des orgas : logos à valider, liste et retrait ----
async function loadRefuges() {
  let d; try { d = await api('/api/admin/refuges'); } catch (e) { alertMsg(e.message); return; }
  const lg = $('#rfLogos'), ul = $('#rfList'); lg.textContent = ''; ul.textContent = '';
  $('#rfCount').textContent = d.refuges.length ? `(${d.refuges.filter(r => r.open).length} ouvert(s) sur ${d.refuges.length})` : '';
  if (!d.logos.length) empty(lg, 'Aucun logo en attente.');
  for (const l of d.logos) {
    const ok = btn('Valider'), no = btn('Refuser', 'danger');
    ok.onclick = async () => { try { await api(`/api/admin/logos/${encodeURIComponent(l.oid)}/ok`, { method: 'POST', body: '{}' }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    no.onclick = async () => { try { await api(`/api/admin/logos/${encodeURIComponent(l.oid)}/no`, { method: 'POST', body: '{}' }); loadRefuges(); } catch (e) { alertMsg(e.message); } };
    const item = li(l.orga, 'envoyé le ' + dayFr(l.t) + ' à ' + hhmm(l.t), ok, no);
    const img = document.createElement('img'); img.src = l.img; img.alt = 'Logo de ' + l.orga; img.className = 'rf-logo';
    item.prepend(img); lg.append(item);
  }
  if (!d.refuges.length) return empty(ul, 'Aucun lieu enregistré.');
  for (const r of d.refuges) {
    const del = btn('Retirer', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/refuges/' + r.id, { method: 'DELETE' }); loadRefuges(); });
    const state = r.open ? (r.state === 'full' ? 'complet' : 'ouvert') + ' jusqu’à ' + hhmm(r.to) : 'fermé';
    ul.append(li(`${r.glyph} ${r.name} · ${r.orga || '?'}`, [state, r.addr, r.consent ? 'accord du lieu coché' : null].filter(Boolean).join(' · '), del));
  }
}
{ const prev = $('#tabOrgas').onclick; $('#tabOrgas').onclick = e => { prev && prev(e); loadRefuges(); }; }
