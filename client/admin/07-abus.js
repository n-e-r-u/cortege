// ---- Abus ----
const ABUSE_HELP = {
  'orga en rafale': 'une orga a été bloquée : trop de vérifications, de retraits ou d’annonces urgentes d’un coup (regarde son journal dans Orgas)',
  'abonnements en rafale': 'trop d’abonnements aux notifications depuis un même réseau : refusés',
  'point contesté': 'points devenus « contestés » par des « Plus là »',
  '« Plus là » en rafale': 'téléphones dont les « Plus là » ont été ignorés (trop d’un coup)',
  'signalements en rafale': 'téléphones bloqués : trop de signalements d’un coup',
  'danger près zone calme': 'dangers signalés à moins de 100 m d’une zone calme (souvent légitime)',
  'série de dangers près des zones calmes': 'téléphones repérés : dangers près de plusieurs zones calmes à la suite (marqués non fiables)',
};
function bars(arr) { const max = Math.max(1, ...arr); return arr.slice().reverse().map(n => '▁▂▃▄▅▆▇█'[Math.min(7, Math.round(n / max * 7))]).join(''); }
async function loadAbuse() {
  let d; try { d = await api('/api/admin/abuse'); } catch (e) { alertMsg(e.message); return; }
  $('#strictState').textContent = d.strict ? 'Actif jusqu’à ' + new Date(d.strict).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.' : 'Désactivé.';
  $('#abuseSummary').textContent = `${d.trusted} téléphone(s) fiable(s) aujourd’hui · ${d.unreliable} signalement(s) non fiable(s) en ce moment` + (d.paused ? ' · signalements en pause' : '');
  const ul = $('#abuseKinds'); ul.textContent = '';
  const kinds = Object.entries(d.kinds).sort((a, b) => b[1] - a[1]);
  if (!kinds.length) empty(ul, 'Rien à signaler sur les dernières 24 h.');
  for (const [k, n] of kinds) {
    const l = li(`${n} · ${k}`, (ABUSE_HELP[k] || '') + ' · ' + bars(d.hours[k] || []) + ' (24 h → maintenant)');
    ul.append(l);
  }
  const zl = $('#abuseZones'); zl.textContent = '';
  if (!d.zones.length) empty(zl, 'Aucune zone.');
  for (const z of d.zones) {
    const a = document.createElement('a'); a.href = `https://www.openstreetmap.org/?mlat=${z.lat}&mlon=${z.lng}#map=12/${z.lat}/${z.lng}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'voir'; a.style.color = 'var(--accent)';
    zl.append(li(`${z.name || z.lat + ', ' + z.lng} · ${z.n}`, Object.entries(z.kinds).map(([k, n]) => n + ' ' + k).join(' · '), a));
  }
}
$('#tabAbuse').onclick = () => { showTab('Abuse'); loadAbuse(); };
$('#abuseReload').onclick = loadAbuse;
document.querySelectorAll('[data-strict]').forEach(b => b.onclick = async () => {
  try { await api('/api/admin/strict', { method: 'POST', body: JSON.stringify({ minutes: +b.dataset.strict }) }); loadAbuse(); } catch (e) { alertMsg(e.message); }
});
if (location.hash === '#digest') showTab('Digest');

function renderOrgas({ orgas }) {
  const ul = $('#orgaList'); ul.textContent = '';
  if (!orgas.length) { const li = document.createElement('li'); li.className = 'meta'; li.textContent = 'Aucune orga pour l’instant.'; ul.append(li); return; }
  for (const o of orgas) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = o.label;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = (o.source === 'variable' ? 'Variable ORGA_KEYS (cPanel)' : 'Créée le ' + new Date(o.created).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))
      + (o.trial ? ' · EN PÉRIODE D’ESSAI' : ' · confirmée')
      + (o.source === 'page' ? (o.active ? ' · activée' + (o.devices > 1 ? ' (' + o.devices + ' appareils)' : '') : o.invite ? ' · invitation en attente' : ' · invitation expirée') : '')
      + (o.clash ? ' · ⚠ NOM RÉSERVÉ OU EN DOUBLE : vérifie que c’est bien une vraie orga' : '')
      + (o.byLabel ? ' · parrainée par ' + o.byLabel : '') + (o.children ? ' · a invité ' + o.children + ' orga(s)' : '')
      + (o.ban ? ' · ⛔ invitations suspendues jusqu’au ' + new Date(o.ban).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '');
    let extra = null;
    if (o.readiness) {
      const rd = document.createElement('div'); rd.className = 'meta';
      const r = o.readiness;
      rd.textContent = r.ready ? '✓ Prête à être confirmée (' + r.days + ' j, ' + r.actions + ' actions, aucun incident)' : `Surveillance renforcée : ${r.days} j, ${r.actions} action(s)` + (r.bursts ? `, ${r.bursts} rafale(s) bloquée(s)` : '') + (r.restored ? `, ${r.restored} retrait(s) annulé(s)` : '');
      if (r.ready) rd.style.color = '#7ee2b0';
      extra = rd;
    }
    const stats = document.createElement('div'); stats.className = 'meta';
    const d = o.day || {};
    stats.textContent = `24 h : ${d.verified || 0} vérifié(s), ${d.removed || 0} retiré(s), ${d.announcements || 0} annonce(s)` + (d.blocked ? ` · ⚠ ${d.blocked} rafale(s) bloquée(s)` : '');
    info.append(name, meta, ...(extra ? [extra] : []), stats);
    li.append(info);
    if (o.id) {
      const tr = document.createElement('button'); tr.className = o.trial ? '' : 'ghost'; tr.textContent = o.trial ? 'Confirmer' : 'Repasser en essai';
      tr.onclick = async () => { try { await api('/api/admin/orgas/' + o.id + '/trial', { method: 'POST', body: JSON.stringify({ trial: !o.trial }) }); api('/api/admin/orgas').then(renderOrgas); } catch (e) { alertMsg(e.message); } };
      li.append(tr);
      const inv = document.createElement('button'); inv.className = 'ghost'; inv.textContent = 'Nouvelle invitation';
      inv.title = 'Crée un nouveau QR code et coupe l’accès actuel de cette orga';
      confirmBtn(inv, 'Confirmer (coupe l’accès actuel)', async () => { const r = await api('/api/admin/orgas/' + o.id + '/invite', { method: 'POST', body: '{}' }); showInvite(r); api('/api/admin/orgas').then(renderOrgas); });
      li.append(inv);
      const rv = document.createElement('button'); rv.className = 'danger'; rv.textContent = o.children ? 'Révoquer pour abus (+ ses invitées)' : 'Révoquer pour abus';
      rv.title = 'Coupe cette orga et toutes celles qu’elle a fait entrer. Sa marraine ne peut plus inviter pendant 30 jours.';
      confirmBtn(rv, 'Confirmer la révocation', async () => { const r = await api('/api/admin/orgas/' + o.id + '/revoke', { method: 'POST', body: '{}' }); alertMsg('Révoquée(s) : ' + r.removed.join(', ') + (r.sponsorBanned ? '. Sa marraine ne peut plus inviter pendant 30 jours.' : '.')); api('/api/admin/orgas').then(renderOrgas); });
      li.append(rv);
      const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Supprimer';
      del.onclick = async () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Confirmer'; return; }
        try { await api('/api/admin/orgas/' + o.id, { method: 'DELETE' }); api('/api/admin/orgas').then(renderOrgas); }
        catch (e) { alertMsg(e.message); }
      };
      li.append(del);
    }
    ul.append(li);
  }
}
// Messages : bulle en bas de l'écran, visible quel que soit l'endroit de la page
function alertMsg(m) {
  $('#loginMsg').textContent = $('#app').hidden ? m : '';
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = m; t.classList.add('on'); clearTimeout(alertMsg.t); alertMsg.t = setTimeout(() => t.classList.remove('on'), 6000);
}
// Invitation : QR code dessiné ici même (rien ne part chez un service extérieur)
function showInvite(o) {
  const url = location.origin + '/?invite=' + o.invite;
  $('#newLabel').textContent = o.label; $('#newUrl').textContent = url;
  $('#newExp').textContent = new Date(o.exp).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('#newQr').textContent = '';
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#newQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
  $('#newLink').hidden = false; $('#shareLink').hidden = !navigator.share;
  $('#newLink').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#orgaForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const o = await api('/api/admin/orgas', { method: 'POST', body: JSON.stringify({ label: $('#orgaLabel').value }) });
    showInvite(o);
    $('#orgaLabel').value = '';
    api('/api/admin/orgas').then(renderOrgas);
  } catch (err) { alertMsg(err.message); }
});
$('#copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText($('#newUrl').textContent); $('#copyLink').textContent = 'Copié'; }
  catch { const r = document.createRange(); r.selectNodeContents($('#newUrl')); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copyLink').textContent = 'Sélectionné'; }
  setTimeout(() => ($('#copyLink').textContent = 'Copier le lien'), 2000);
};
$('#shareLink').onclick = () => navigator.share?.({ title: 'Invitation orga Cortège', text: 'Ton invitation orga Cortège (usage unique, ne la transfère pas) :', url: $('#newUrl').textContent }).catch(() => {});
$('#date').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

function bar(label, n, max, color, extra) {
  const row = document.createElement('div'); row.className = 'bar';
  const l = document.createElement('span'); l.className = 'lbl'; l.textContent = label;
  const tr = document.createElement('div'); tr.className = 'track';
  const f = document.createElement('div'); f.className = 'fill'; f.style.width = (max ? (n / max) * 100 : 0) + '%'; f.style.setProperty('--c', color);
  tr.append(f);
  const c = document.createElement('span'); c.className = 'n'; c.textContent = n;
  row.append(l, tr, c);
  if (extra) { const e = document.createElement('span'); e.className = 'first'; e.textContent = extra; row.append(e); }
  return row;
}

