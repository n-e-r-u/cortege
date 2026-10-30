'use strict';
const $ = s => document.querySelector(s);
const COLORS = { fdo: 'var(--fdo)', danger: 'var(--danger)', soutien: 'var(--soutien)', info: 'var(--info)' };
const hhmm = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
let KEY = '';
try { KEY = localStorage.getItem('cortege-admin') || ''; $('#key').value = KEY; } catch {}
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY, ...(opts.headers || {}) } })
  .then(async r => { const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || 'Erreur.'), { status: r.status }); return b; });

async function login() {
  KEY = $('#key').value;
  try { await api('/api/admin/orgas').then(renderOrgas); loadAgenda(); loadBadges(); loadRequests(); }
  catch (e) { $('#loginMsg').textContent = e.message; $('#app').hidden = true; return; }
  try { localStorage.setItem('cortege-admin', KEY); } catch {}
  $('#loginMsg').textContent = ''; $('#loginForm').hidden = true; $('#app').hidden = false; document.querySelector('main').classList.add('wide');
  const want = location.hash.slice(1).toLowerCase(), tab = [...document.querySelectorAll('.tab')].find(b => b.id.slice(3).toLowerCase() === want);
  if (tab) tab.click();
  $('#navCurrent').textContent = navLabel($('.tab[aria-selected="true"]'));
}
$('#loginForm').addEventListener('submit', e => { e.preventDefault(); login(); });
if (KEY) login();

const navLabel = b => b.querySelector('.ni').textContent + '  ' + [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
function showTab(which) {
  for (const t of ['Orgas', 'Anns', 'Orders', 'Legal', 'Agenda', 'Reports', 'Journal', 'Abuse', 'Digest', 'Live', 'Mod', 'Mobs', 'Places', 'Settings']) {
    $('#tab' + t).setAttribute('aria-selected', String(t === which));
    $('#panel' + t).hidden = t !== which;
  }
  // Téléphone : le menu se referme et affiche la section ouverte
  $('#navCurrent').textContent = navLabel($('#tab' + which));
  $('#adminNav').classList.remove('open'); $('#navToggle').setAttribute('aria-expanded', 'false');
  window.scrollTo({ top: 0 });
  // Garde l'onglet dans l'adresse : F5 rouvre le même onglet
  try { history.replaceState(null, '', '#' + which.toLowerCase()); } catch {}
}
$('#navToggle').onclick = () => { const o = $('#adminNav').classList.toggle('open'); $('#navToggle').setAttribute('aria-expanded', String(o)); };
$('#tabOrgas').onclick = () => { showTab('Orgas'); loadRequests(); };
$('#tabDigest').onclick = () => showTab('Digest');
$('#tabReports').onclick = () => { showTab('Reports'); loadReports(); };
$('#tabAnns').onclick = () => { showTab('Anns'); loadAnns(); };
$('#tabLegal').onclick = () => { showTab('Legal'); loadLegal(); };
$('#tabAgenda').onclick = () => { showTab('Agenda'); loadAgenda(); };
$('#tabJournal').onclick = () => { showTab('Journal'); loadJournal(); };

