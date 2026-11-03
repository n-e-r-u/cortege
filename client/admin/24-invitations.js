// ---- Invitations en série : un lien par orga, avec un message type prêt à envoyer ----
let bulkRows = [];
const BULK_TPL = 'Bonjour {nom},\n\nJe développe Cortège (https://cortege.neru.tv), une carte libre et gratuite des manifs en direct : forces de l’ordre, lacrymo, nasses, street medics, legal teams. Sans compte, sans pistage, code ouvert.\n\nJe vous propose un accès orga : vérifier les signalements, retirer les faux et, une fois certifiés, publier des annonces autour du cortège.\n\nVotre invitation (à ouvrir sur le téléphone qui servira en manif, valable une seule fois) :\n{lien}\n\nNeru';
try { $('#bulkTpl').value = localStorage.getItem('cortege-bulk-tpl') || BULK_TPL; } catch { $('#bulkTpl').value = BULK_TPL; }
$('#bulkTpl').addEventListener('input', () => { try { localStorage.setItem('cortege-bulk-tpl', $('#bulkTpl').value); } catch {} });
const bulkMsgFor = r => $('#bulkTpl').value.replaceAll('{nom}', r.label).replaceAll('{lien}', r.url);
async function bulkCopy(text, btn, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copié'; } catch { alertMsg(text); }
  setTimeout(() => (btn.textContent = label), 2000);
}
$('#bulkForm').addEventListener('submit', async e => {
  e.preventDefault();
  const labels = $('#bulkNames').value.split('\n').map(x => x.trim()).filter(Boolean);
  if (!labels.length) return alertMsg('Mets un nom d’orga par ligne.');
  try {
    const d = await api('/api/admin/orgas/bulk', { method: 'POST', body: JSON.stringify({ labels, days: +$('#bulkDays').value }) });
    bulkRows = d.created.map(o => ({ ...o, url: location.origin + '/?invite=' + o.invite }));
    const exp = bulkRows[0] ? new Date(bulkRows[0].exp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '';
    $('#bulkMsg').textContent = `${bulkRows.length} invitation(s) créée(s)${exp ? ', valables jusqu’au ' + exp : ''}.` + (d.skipped.length ? ` Pas créées : ${d.skipped.map(s => `${s.label} (${s.error})`).join(', ')}.` : '');
    const ul = $('#bulkList'); ul.textContent = '';
    for (const r of bulkRows) {
      const li = document.createElement('li'), info = document.createElement('div'), acts = document.createElement('div');
      const b = document.createElement('b'); b.textContent = r.label;
      const code = document.createElement('code'); code.textContent = r.url; code.style.cssText = 'display:block;font-size:12px;overflow-wrap:anywhere';
      info.append(b, code); acts.className = 'acts';
      const c1 = document.createElement('button'); c1.type = 'button'; c1.className = 'ghost'; c1.textContent = 'Copier le lien'; c1.onclick = () => bulkCopy(r.url, c1, 'Copier le lien');
      const c2 = document.createElement('button'); c2.type = 'button'; c2.textContent = 'Copier le message'; c2.onclick = () => bulkCopy(bulkMsgFor(r), c2, 'Copier le message');
      acts.append(c1, c2); li.append(info, acts); ul.append(li);
    }
    $('#bulkOut').hidden = false; $('#bulkNames').value = d.skipped.map(s => s.label).join('\n');
    api('/api/admin/orgas').then(renderOrgas);
  } catch (err) { alertMsg(err.message); }
});
$('#bulkCopyAll').onclick = () => bulkCopy(bulkRows.map(r => r.label + '\t' + r.url).join('\n'), $('#bulkCopyAll'), 'Copier tous les liens');
$('#bulkCsv').onclick = () => {
  // Texte commençant par = + - @ : neutralisé (un tableur l'exécuterait comme une formule)
  const esc = v => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['orga;lien;valable_jusqu_au;message', ...bulkRows.map(r => [r.label, r.url, new Date(r.exp).toLocaleDateString('fr-FR'), bulkMsgFor(r)].map(esc).join(';'))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `cortege-invitations-${new Date().toLocaleDateString('sv-SE')}.csv`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
