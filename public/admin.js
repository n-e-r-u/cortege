'use strict';
const $ = s => document.querySelector(s);
const COLORS = { fdo: 'var(--fdo)', danger: 'var(--danger)', soutien: 'var(--soutien)', info: 'var(--info)' };
const hhmm = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
let KEY = '';
try { KEY = localStorage.getItem('cortege-admin') || ''; $('#key').value = KEY; } catch {}
const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': KEY, ...(opts.headers || {}) } })
  .then(async r => { const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.error || 'Erreur.'), { status: r.status, problems: b.problems }); return b; });

async function login() {
  KEY = $('#key').value;
  try { await api('/api/admin/orgas').then(renderOrgas); loadAgenda(); loadBadges(); loadRequests(); srvBadge(); }
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
  for (const t of ['Orgas', 'Anns', 'Orders', 'Legal', 'Agenda', 'Reports', 'Journal', 'Abuse', 'Digest', 'Live', 'Mod', 'Mobs', 'Places', 'Settings', 'Countries', 'Langs', 'Server']) {
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

// ---- Journal des orgas et corbeille ----
const JCATS = {};
fetch('/api/config').then(r => r.json()).then(c => (c.categories || []).forEach(x => (JCATS[x.id] = x)));
const ALERT_ACTIONS = new Set(['retrait bloqué (rafale)', 'legal team (en attente)', 'événement (en attente)']);
let journal = { log: [], trash: [] };
async function loadJournal() {
  try { journal = await api('/api/admin/journal'); } catch (e) { alertMsg(e.message); return; }
  // Corbeille
  const tl = $('#trashList'); tl.textContent = '';
  $('#trashCount').textContent = '(' + journal.trash.length + ')';
  if (!journal.trash.length) empty(tl, 'Corbeille vide.');
  for (const x of journal.trash) {
    const c = JCATS[x.cat] || { glyph: '•', label: x.cat };
    const b = btn('Restaurer');
    b.onclick = async () => { try { await api('/api/admin/trash/' + x.id + '/restore', { method: 'POST', body: '{}' }); alertMsg('Point restauré.'); loadJournal(); } catch (e) { alertMsg(e.message); } };
    tl.append(li(c.glyph + ' ' + c.label + (x.note ? ' · ' + x.note : ''), `${x.orga.startsWith('Votes') ? 'contesté par les votes' : 'retiré par ' + x.orga} à ${hhmm(x.t)} · ${x.lat.toFixed(4)}, ${x.lng.toFixed(4)}${x.up ? ' · confirmé ' + x.up + '×' : ''}`, b));
  }
  // Filtre par orga : toutes celles qui ont un historique (le journal est gardé en entier, lu par pages côté serveur)
  const sel = $('#journalOrga'), cur = sel.value;
  sel.textContent = ''; sel.append(new Option('Toutes', ''), ...(journal.orgas || []).map(o => new Option(`${o.label} (${o.n})`, o.o)));
  sel.value = (journal.orgas || []).some(o => o.o === cur) ? cur : '';
  jView = { log: journal.log, more: journal.more };
  if (sel.value) await loadJournalOrga(); else renderJournal();
  // À vérifier : rafales bloquées et validations en attente (24 h)
  const since = Date.now() - 24 * 3600e3;
  const alerts = journal.log.filter(x => x.t > since && ALERT_ACTIONS.has(x.action));
  // Vague de « Plus là » : beaucoup de points contestés en 30 min
  const recent = journal.log.filter(x => x.action === 'contesté' && x.t > Date.now() - 30 * 60e3);
  if (recent.length >= 10) alerts.unshift({ orga: 'Votes', action: recent.length + ' points contestés en 30 min', t: recent[0].t, detail: 'vérifie la corbeille' });
  $('#journalAlerts').hidden = !alerts.length;
  const al = $('#journalAlertList'); al.textContent = '';
  for (const x of alerts.slice(0, 30)) al.append(li(x.orga + ' : ' + x.action, hhmm(x.t) + (x.detail ? ' · ' + x.detail : '')));
  $('#journalBadge').textContent = alerts.length ? '(' + alerts.length + ')' : '';
}
let jView = { log: [], more: false };
async function loadJournalOrga() {
  const o = $('#journalOrga').value;
  try { const d = await api('/api/admin/journal' + (o ? '?o=' + encodeURIComponent(o) : '')); jView = { log: d.log, more: d.more }; } catch (e) { alertMsg(e.message); }
  renderJournal();
}
function renderJournal() {
  const ul = $('#journalList'); ul.textContent = '';
  const rows = jView.log;
  $('#journalMore').hidden = !jView.more;
  if (!rows.length) return empty(ul, 'Aucune action enregistrée.');
  for (const x of rows) {
    const c = x.cat ? (JCATS[x.cat] || { glyph: '•', label: x.cat }) : null;
    const where = x.lat != null ? ` · ${x.lat.toFixed(3)}, ${x.lng.toFixed(3)}` : '';
    const day = new Date(x.t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
    ul.append(li(`${x.orga} : ${x.action}${c ? ' ' + c.glyph + ' ' + c.label : ''}`, `${day} ${hhmm(x.t)}${where}${x.detail ? ' · ' + x.detail : ''}`));
  }
}
$('#journalOrga').onchange = loadJournalOrga;
$('#journalMore').onclick = async () => {
  const o = $('#journalOrga').value, last = jView.log[jView.log.length - 1];
  if (!last) return;
  try { const d = await api('/api/admin/journal?before=' + last.t + (o ? '&o=' + encodeURIComponent(o) : '')); jView = { log: jView.log.concat(d.log), more: d.more }; renderJournal(); } catch (e) { alertMsg(e.message); }
};
$('#journalCsv').onclick = () => { const o = $('#journalOrga').value; adminDownload('/api/admin/journal.csv' + (o ? '?o=' + encodeURIComponent(o) : ''), 'journal-orgas.csv').catch(e => alertMsg(e.message)); };
// Depuis la liste des orgas : ouvrir son historique complet
function openOrgaHistory(o, label) { showTab('Journal'); loadJournal().then(() => { const sel = $('#journalOrga'); if (![...sel.options].some(x => x.value === o)) sel.append(new Option(label + ' (0)', o)); sel.value = o; loadJournalOrga(); }); }

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

// ---- Arrêtés et restrictions ----
let ordKinds = {};
async function loadOrders() {
  let d; try { d = await api('/api/admin/orders'); } catch (e) { alertMsg(e.message); return; }
  ordKinds = Object.fromEntries(d.kinds.map(k => [k.id, k]));
  if (!$('#oaDep').options.length) { $('#oaDep').append(new Option('Choisir…', '')); d.deps.forEach(([c, n]) => $('#oaDep').append(new Option(c + ' · ' + n, c))); }
  const pending = d.orders.filter(o => o.status === 'pending'), ok = d.orders.filter(o => o.status === 'ok');
  $('#ordBadge').textContent = pending.length || '';
  for (const [ul, list, none] of [[$('#ordPending'), pending, 'Aucune proposition en attente.'], [$('#ordList'), ok, 'Aucun arrêté en cours ou à venir.']]) {
    ul.textContent = '';
    if (!list.length) { empty(ul, none); continue; }
    for (const o of list) {
      const src = document.createElement('a'); src.href = o.src; src.target = '_blank'; src.rel = 'noopener noreferrer'; src.textContent = 'source : ' + (o.host || 'lien');
      src.style.cssText = 'color:var(--accent);align-self:center;font-size:13px';
      const del = btn(o.status === 'pending' ? 'Refuser' : 'Retirer', 'danger');
      confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/orders/' + o.id, { method: 'DELETE' }); loadOrders(); });
      const buttons = [src];
      if (o.status === 'pending') { const okb = btn('Valider'); okb.onclick = async () => { okb.disabled = true; try { await api('/api/admin/orders/' + o.id + '/approve', { method: 'POST', body: '{}' }); alertMsg('Arrêté publié.'); loadOrders(); } catch (err) { alertMsg(err.message); okb.disabled = false; } }; buttons.push(okb); }
      buttons.push(del);
      const zone = o.zone ? o.zone.name + (o.zone.scope === 'dep' ? ' (département)' : ` (${o.zone.dep})`) : (o.commune ? o.commune + ' (' + o.dep + ')' : 'département ' + o.dep);
      ul.append(li(`🚫 ${zone}`, `${when(o.start)} → ${when(o.end)} · ${o.items.map(x => (ordKinds[x.k] || { glyph: 'ℹ' }).glyph + ' ' + x.text).join(' · ')} · ${o.by}`, ...buttons));
    }
  }
}
$('#tabOrders').onclick = () => { showTab('Orders'); loadOrders(); };
$('#ordAdminForm').addEventListener('submit', async e => {
  e.preventDefault();
  const items = $('#oaItems').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(manif|perimetre|couvre|transport|consigne|autre)\s*:\s*(.+)$/i); return m ? { k: m[1].toLowerCase(), text: m[2] } : { k: 'autre', text: l }; });
  const body = { dep: $('#oaDep').value, commune: $('#oaCommune').value, start: new Date($('#oaStart').value).getTime(), end: new Date($('#oaEnd').value).getTime(), items, src: $('#oaSrc').value };
  try { await api('/api/admin/orders', { method: 'POST', body: JSON.stringify(body) }); alertMsg('Arrêté publié.'); $('#ordAdminForm').reset(); loadOrders(); } catch (err) { alertMsg(err.message); }
});
$('#ordImportForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const d = await api('/api/admin/orders/import', { method: 'POST', body: JSON.stringify({ text: $('#oiText').value }) });
    const bad = d.results.filter(r => !r.ok);
    $('#oiMsg').textContent = `${d.results.length - bad.length} publié(s) sur ${d.results.length}.` + (bad.length ? ' Refusés : ' + bad.map(r => `${r.name} (${r.error})`).join(' ; ') : '');
    if (!bad.length) $('#oiText').value = '';
    loadOrders();
  } catch (err) { alertMsg(err.message); }
});

// ---- Urgences ----
let CATS = {};
fetch('/api/config').then(r => r.json()).then(c => { CATS = Object.fromEntries(c.categories.map(x => [x.id, x])); });
let repData = { reports: [], paused: 0 };
function confirmBtn(btn, label, action) {
  btn.onclick = async () => {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.dataset.label = btn.textContent; btn.textContent = label; setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000); return; }
    delete btn.dataset.armed; btn.textContent = btn.dataset.label;
    try { await action(); } catch (e) { alertMsg(e.message); }
  };
}
async function loadReports() {
  try { repData = await api('/api/admin/reports'); } catch (e) { alertMsg(e.message); return; }
  const p = repData.paused;
  $('#pauseState').textContent = p ? 'En pause jusqu’à ' + new Date(p).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '.' : 'Signalements ouverts.';
  renderReports();
}
function renderReports() {
  const q = $('#repFilter').value.trim().toLowerCase();
  const list = repData.reports.filter(r => !q || (CATS[r.cat]?.label || r.cat).toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q));
  $('#repCount').textContent = '(' + repData.reports.length + ')';
  const ul = $('#repList'); ul.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'meta'; li.textContent = 'Aucun signalement actif.'; ul.append(li); return; }
  for (const r of list.slice(0, 300)) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const t = document.createElement('b'); t.textContent = (CATS[r.cat]?.glyph || '') + ' ' + (CATS[r.cat]?.label || r.cat) + (r.ver ? ' ✓' : '');
    const m = document.createElement('div'); m.className = 'meta';
    const a = document.createElement('a'); a.href = `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}`; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'voir';
    a.style.color = 'var(--accent)';
    m.append(`il y a ${Math.round((Date.now() - r.t) / 60000)} min · +${r.up} / −${r.down}${r.note ? ' · « ' + r.note + ' »' : ''} · `, a);
    info.append(t, m);
    const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Supprimer';
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/reports/' + r.id, { method: 'DELETE' }); loadReports(); });
    li.append(info, del); ul.append(li);
  }
}
$('#repFilter').addEventListener('input', renderReports);
$('#repReload').onclick = loadReports;
document.querySelectorAll('[data-pause]').forEach(b => b.onclick = async () => {
  try { await api('/api/admin/pause', { method: 'POST', body: JSON.stringify({ minutes: +b.dataset.pause }) }); loadReports(); } catch (e) { alertMsg(e.message); }
});
confirmBtn($('#purgeReports'), 'Confirmer : tout effacer', async () => { const r = await api('/api/admin/purge', { method: 'POST', body: '{}' }); alertMsg(r.removed + ' signalement(s) effacé(s).'); loadReports(); });
confirmBtn($('#purgeAll'), 'Confirmer : tout effacer + annonces', async () => { const r = await api('/api/admin/purge', { method: 'POST', body: JSON.stringify({ announcements: true }) }); alertMsg(r.removed + ' signalement(s) et toutes les annonces effacés.'); loadReports(); });
$('#wipeForm').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('#wipeConfirm').value.trim() !== 'EFFACER') return alertMsg('Tape EFFACER pour confirmer.');
  try {
    const r = await api('/api/admin/wipe', { method: 'POST', body: JSON.stringify({ confirm: 'EFFACER', pub: $('#wipePub').checked }) });
    $('#wipeConfirm').value = '';
    alertMsg(`Effacement terminé : ${r.removed} signalement(s) et toutes les traces effacés.` + (r.rotated ? ' Nouvelle clé de hachage créée.' : ' La clé vient de la variable SECRET : change-la dans cPanel puis redémarre.'));
    loadReports();
  } catch (err) { alertMsg(err.message); }
});
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
    const tot = o.total || {};
    stats.textContent = `24 h : ${d.verified || 0} vérifié(s), ${d.removed || 0} retiré(s), ${d.announcements || 0} annonce(s)` + (d.blocked ? ` · ⚠ ${d.blocked} rafale(s) bloquée(s)` : '')
      + ` · depuis le début : ${tot.actions || 0} action(s), ${tot.verified || 0} vérifié(s), ${tot.removed || 0} retiré(s), ${tot.announcements || 0} annonce(s)` + (tot.blocked ? `, ${tot.blocked} rafale(s)` : '');
    const hist = document.createElement('button'); hist.type = 'button'; hist.className = 'link-btn'; hist.textContent = 'Voir tout l’historique';
    hist.onclick = () => openOrgaHistory(o.id || 'label:' + o.label, o.label);
    info.append(name, meta, ...(extra ? [extra] : []), stats, hist);
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

// ---- Digest ----
const OUTCOME = { exp: 'expirés normalement', active: 'encore actifs', cont: 'contestés par « Plus là » puis expirés', orga: 'retirés par une orga',
  admin: 'retirés par l’admin', full: 'évincés (zone saturée)', purge: 'effacés (purge)', removed: 'retirés', old: 'retirés (ancien format)' };
const REMOVED = new Set(['cont', 'orga', 'admin', 'full', 'purge', 'removed', 'old']);
const KEY_CATS = ['charge', 'nasse', 'lacrymo', 'canon', 'sommations', 'interpellation', 'bac', 'crs'];
let dg = null, dgMap = null, dgLayer = null, brand = {};
fetch('/api/config').then(r => r.json()).then(c => { brand = c.brand || {}; }).catch(() => {});
const minutes = ms => Math.round(ms / 60000);
const median = a => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const date = $('#date').value;
  $('#msg').textContent = 'Chargement… (le nom des villes peut prendre quelques secondes)';
  try {
    const res = await fetch('/api/digest?date=' + date, { headers: { 'X-Admin-Key': KEY } });
    const d = await res.json();
    if (!res.ok) { $('#msg').textContent = d.error || 'Erreur.'; $('#out').hidden = true; return; }
    dg = d; renderDigest();
  } catch { $('#msg').textContent = 'Pas de réseau.'; }
});
$('#dgAll').addEventListener('change', () => dg && renderDigest());

function renderDigest() {
  pubUi();
  const d = dg, cat = Object.fromEntries(d.categories.map(c => [c.id, c]));
  const all = d.rows.filter(r => cat[r.c]);
  const rows = $('#dgAll').checked ? all : all.filter(r => !REMOVED.has(r.o));
  $('#msg').textContent = (all.length ? longDate(d.date) : `Aucun signalement en France le ${longDate(d.date)}.` + (d.days.length ? ` Jours archivés : ${d.days.slice(0, 8).join(', ')}.` : ''))
    + (d.abroad ? ` · ${d.abroad} ${d.abroad > 1 ? 'signalements' : 'signalement'} hors de France, ${d.abroad > 1 ? 'visibles' : 'visible'} sur la carte en direct mais non ${d.abroad > 1 ? 'comptés' : 'compté'} ici.` : '');
  $('#out').hidden = !all.length;
  if (!all.length) return;
  const groupOf = r => cat[r.c].group, zoneName = r => d.zones[r.z]?.name || r.z;
  const removed = all.filter(r => REMOVED.has(r.o)).length;
  const cities = new Set(rows.map(r => r.z)).size;
  const confirmed = rows.filter(r => r.up > 0).length, verified = rows.filter(r => r.v).length;
  const t0 = Math.min(...rows.map(r => r.t)), t1 = Math.max(...rows.map(r => r.e || r.t));

  // Chiffres clés
  $('#kpis').textContent = '';
  for (const [n, label] of [[rows.length, 'signalements'], [cities, cities > 1 ? 'villes' : 'ville'], [confirmed, 'confirmés par d’autres'], [verified, 'vérifiés par une orga'],
    [removed, 'retirés ou contestés'], [rows.length ? hhmm(t0) + '–' + hhmm(t1) : '—', 'activité']]) {
    const k = document.createElement('div'); k.className = 'kpi';
    const b = document.createElement('b'); b.textContent = n; const s = document.createElement('span'); s.textContent = label;
    k.append(b, s); $('#kpis').append(k);
  }

  // Carte
  if (!dgMap) {
    dgMap = L.map('dgMap', { zoomControl: true, attributionControl: true });
    L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(dgMap);
    dgLayer = L.layerGroup().addTo(dgMap);
  }
  dgLayer.clearLayers();
  for (const r of rows) {
    const c = cat[r.c], col = getComputedStyle(document.documentElement).getPropertyValue('--' + ({ fdo: 'fdo', danger: 'danger', soutien: 'soutien', info: 'info' })[c.group]).trim() || '#ec9fa4';
    L.circleMarker([r.lat, r.lng], { radius: 5 + Math.min(r.up, 6), color: col, weight: REMOVED.has(r.o) ? 1 : 2, dashArray: REMOVED.has(r.o) ? '3 3' : null, fillOpacity: REMOVED.has(r.o) ? .15 : .55 })
      .bindTooltip(`${c.glyph} ${c.label} · ${hhmm(r.t)}${r.e ? '–' + hhmm(r.e) : ''} · ${OUTCOME[r.o] || r.o}${r.up ? ' · confirmé ' + r.up + '×' : ''}`).addTo(dgLayer);
  }
  setTimeout(() => { dgMap.invalidateSize(); if (rows.length) dgMap.fitBounds(L.latLngBounds(rows.map(r => [r.lat, r.lng])).pad(0.2), { maxZoom: 14 }); }, 50);
  $('#dgLegend').textContent = '';
  for (const g of d.groups) { const s = document.createElement('span'); s.style.setProperty('--c', COLORS[g.id]); s.textContent = g.label; $('#dgLegend').append(s); }
  const s2 = document.createElement('span'); s2.style.setProperty('--c', 'transparent'); s2.textContent = 'pointillés : retiré ou contesté'; $('#dgLegend').append(s2);

  // Moments clés : première occurrence de chaque danger par ville
  const firsts = new Map();
  for (const r of rows.filter(r => KEY_CATS.includes(r.c)).sort((a, b) => a.t - b.t)) { const k = r.z + '|' + r.c; if (!firsts.has(k)) firsts.set(k, r); }
  const mom = [...firsts.values()].sort((a, b) => a.t - b.t).slice(0, 30);
  $('#moments').textContent = '';
  if (!mom.length) { const li = document.createElement('li'); li.textContent = 'Aucun danger signalé.'; $('#moments').append(li); }
  for (const r of mom) {
    const li = document.createElement('li'); const tm = document.createElement('time'); tm.textContent = hhmm(r.t);
    const sp = document.createElement('span'); sp.textContent = `${cat[r.c].glyph} ${zoneName(r)} : ${cat[r.c].label.toLowerCase()}${r.up ? ` (confirmé ${r.up}×)` : ''}${r.v ? ' ✓ vérifié' : ''}${REMOVED.has(r.o) ? ' · ' + OUTCOME[r.o] : ''}`;
    li.append(tm, sp); $('#moments').append(li);
  }

  // Par type
  const byCat = {};
  for (const r of rows) (byCat[r.c] ||= []).push(r);
  const cats = Object.entries(byCat).sort((a, b) => b[1].length - a[1].length);
  $('#cats').textContent = '';
  for (const [c, list] of cats) {
    const first = Math.min(...list.map(r => r.t)), conf = list.filter(r => r.up > 0).length, life = median(list.filter(r => r.e).map(r => r.e - r.t));
    $('#cats').append(bar(`${cat[c].glyph} ${cat[c].label}`, list.length, cats[0][1].length, COLORS[cat[c].group],
      `Premier à ${hhmm(first)} · ${conf} confirmé(s)` + (life ? ` · visible ${minutes(life)} min en médiane` : '')));
  }

  // Par heure, empilé par famille
  const byHour = Array.from({ length: 24 }, () => ({}));
  for (const r of rows) { const h = +new Date(r.t).toLocaleString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }) % 24; byHour[h][groupOf(r)] = (byHour[h][groupOf(r)] || 0) + 1; }
  const totH = byHour.map(o => Object.values(o).reduce((a, b) => a + b, 0)), maxH = Math.max(1, ...totH);
  $('#hours').textContent = ''; $('#hourLabels').textContent = '';
  byHour.forEach((o, h) => {
    const col = document.createElement('div'); col.style.height = (totH[h] / maxH) * 100 + '%'; col.title = `${h} h : ${totH[h]}`;
    for (const g of d.groups) if (o[g.id]) { const i = document.createElement('i'); i.style.setProperty('--c', COLORS[g.id]); i.style.height = (o[g.id] / totH[h]) * 100 + '%'; col.append(i); }
    $('#hours').append(col);
    const lb = document.createElement('span'); lb.textContent = h; $('#hourLabels').append(lb);
  });
  $('#hourLegend').textContent = '';
  for (const g of d.groups) { const s = document.createElement('span'); s.style.setProperty('--c', COLORS[g.id]); s.textContent = g.label; $('#hourLegend').append(s); }

  // Par ville
  const byZone = {};
  for (const r of rows) (byZone[r.z] ||= []).push(r);
  const zs = Object.entries(byZone).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
  $('#zones').textContent = '';
  for (const [z, list] of zs) {
    const counts = {}; list.forEach(r => counts[r.c] = (counts[r.c] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${n} ${cat[c].label.toLowerCase()}`).join(', ');
    const a = Math.min(...list.map(r => r.t)), b = Math.max(...list.map(r => r.e || r.t));
    $('#zones').append(bar(d.zones[z]?.name || z, list.length, zs[0][1].length, 'var(--accent)', `${hhmm(a)}–${hhmm(b)} · ${top}`));
  }

  // Devenir
  const outc = {}; all.forEach(r => outc[r.o] = (outc[r.o] || 0) + 1);
  const oc = Object.entries(outc).sort((a, b) => b[1] - a[1]);
  $('#outcomes').textContent = '';
  for (const [o, n] of oc) $('#outcomes').append(bar(OUTCOME[o] || o, n, oc[0][1], REMOVED.has(o) ? 'var(--fdo)' : 'var(--soutien)'));

  // Fiabilité
  const tr = [['confirmés (2 pers. ou +)', confirmed], ['confirmés (3 pers. ou +)', rows.filter(r => r.up >= 2).length],
    ['vérifiés par une orga', verified], ['téléphone fiable', rows.filter(r => r.f === 1).length], ['marqués non fiables', rows.filter(r => r.f === -1).length],
    ['avec une précision', rows.filter(r => r.n > 0).length], ['avec des « Plus là »', rows.filter(r => r.dn > 0).length]];
  $('#trust').textContent = '';
  for (const [l, n] of tr) $('#trust').append(bar(l, n, rows.length, 'var(--accent)', rows.length ? Math.round(n / rows.length * 100) + ' %' : ''));
  const lifeBy = d.groups.map(g => { const l = rows.filter(r => groupOf(r) === g.id && r.e).map(r => r.e - r.t); return l.length ? `${g.label} : ${minutes(median(l))} min` : null; }).filter(Boolean);
  $('#lifetimes').textContent = lifeBy.length ? 'Durée de visibilité médiane sur la carte : ' + lifeBy.join(' · ') + '.' : '';

  // Orgas et modération
  const od = [['vérifications d’orgas', d.orga.verified], ['retraits par des orgas', d.orga.removed], ['retraits par l’admin', d.orga.adminRemoved], ['retraits annulés', d.orga.restored],
    ['annonces publiées', d.orga.announcements], ['annonces urgentes', d.orga.urgent], ['numéros de legal team', d.orga.legal], ['contestés par votes', d.orga.contested],
    ...Object.entries(d.abuse).map(([k, n]) => ['anti-abus : ' + k, n])];
  const maxO = Math.max(1, ...od.map(x => x[1]));
  $('#orgaDay').textContent = '';
  for (const [l, n] of od) if (n) $('#orgaDay').append(bar(l, n, maxO, 'var(--info)'));
  if (!$('#orgaDay').children.length) $('#orgaDay').textContent = 'Aucune action d’orga ce jour-là.';

  // Comparaison
  const maxHist = Math.max(1, ...d.history.map(x => x.total));
  $('#history').textContent = ''; $('#historyLabels').textContent = '';
  for (const x of d.history) {
    const col = document.createElement('div'); col.style.height = Math.max(2, x.total / maxHist * 100) + '%'; col.title = `${x.date} : ${x.total}`;
    if (x.date === d.date) col.className = 'today'; $('#history').append(col);
    const lb = document.createElement('span'); lb.textContent = +x.date.slice(8); $('#historyLabels').append(lb);
  }
  const prev = d.history.slice(0, -1).map(x => x.total), avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;

  // Agenda du jour
  $('#eventsCard').hidden = !d.events.length; $('#dgEvents').textContent = '';
  for (const e of d.events) $('#dgEvents').append(li(e.title, `${hhmm(e.start)} · ${e.place || ''}`));

  // Résumé
  const peak = totH.indexOf(Math.max(...totH));
  const lines = [
    `Mobilisation du ${longDate(d.date)} : ce que les manifestant·es ont signalé sur Cortège`,
    `• ${rows.length} signalements dans ${cities} ${cities > 1 ? 'villes' : 'ville'}, de ${hhmm(t0)} à ${hhmm(t1)}`,
    ...cats.slice(0, 5).map(([c, list]) => `• ${list.length} × ${cat[c].label.toLowerCase()} (premier à ${hhmm(Math.min(...list.map(r => r.t)))})`),
    `• Pic d’activité entre ${peak} h et ${peak + 1} h`,
    ...(zs.length ? [`• Ville la plus active : ${d.zones[zs[0][0]]?.name || zs[0][0]} (${zs[0][1].length})`] : []),
    ...mom.slice(0, 4).map(r => `• ${hhmm(r.t)} : ${cat[r.c].label.toLowerCase()} à ${zoneName(r)}`),
    ...(avg ? [`• ${rows.length >= avg ? '+' : ''}${Math.round((rows.length - avg) / avg * 100)} % par rapport à la moyenne des 14 jours précédents`] : []),
    `Signalements de participant·es : ${confirmed} confirmés par d’autres, ${verified} vérifiés par des orgas${removed ? `, ${removed} retirés ou contestés` + ($('#dgAll').checked ? ' (inclus dans les chiffres)' : ' (non comptés)') : ''}.`,
    `Source : Cortège (${location.host})${brand.handle ? ', par @' + brand.handle : ''}`,
  ];
  $('#summary').textContent = lines.join('\n');
}

$('#csv').addEventListener('click', () => {
  if (!dg) return;
  const cat = Object.fromEntries(dg.categories.map(c => [c.id, c]));
  const head = ['categorie', 'famille', 'debut', 'fin', 'latitude', 'longitude', 'ville', 'confirmations', 'plus_la', 'precisions', 'verifie', 'fiabilite', 'devenir'];
  // Texte commençant par = + - @ : neutralisé (un tableur l'exécuterait comme une formule) ; les nombres restent des nombres
  const esc = v => { let s = String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const iso = t => t ? new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }) : '';
  const lines = [head.join(';'), ...dg.rows.filter(r => cat[r.c]).map(r => [cat[r.c].label, cat[r.c].group, iso(r.t), iso(r.e), r.lat, r.lng, dg.zones[r.z]?.name || '', r.up, r.dn ?? '', r.n ?? '', r.v ? 'oui' : 'non',
    r.f === 1 ? 'fiable' : r.f === -1 ? 'non fiable' : '', OUTCOME[r.o] || r.o].map(esc).join(';'))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `cortege-${dg.date}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#summary').textContent); $('#copy').textContent = 'Copié'; }
  catch { const r = document.createRange(); r.selectNodeContents($('#summary')); getSelection().removeAllRanges(); getSelection().addRange(r); $('#copy').textContent = 'Sélectionné, fais Copier'; }
  setTimeout(() => ($('#copy').textContent = 'Copier le résumé'), 2000);
});

// ---- Annuaire des legal teams ----
async function loadBadges() {
  try {
    const d = await api('/api/admin/reports'); $('#annBadge').textContent = d.pending || ''; $('#legalBadge').textContent = d.legalAlerts || '';
    $('#modBadge').textContent = d.moderation || ''; $('#ordBadge').textContent = d.ordersPending || ''; $('#mobBadge').textContent = (d.toPublish || []).length || '';
    pubPrompt(d.toPublish || []);
  } catch {}
}
setInterval(() => { if (!$('#app').hidden) loadBadges(); }, 120000);
const WATCH = { ok: '✓ source relue, numéro présent', missing: '⚠ numéro ABSENT de la source', changed: '⚠ la source affiche d’autres numéros', error: '⚠ source illisible', new: 'source pas encore relue' };
const dayFr = t => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric' });
let lgPos = null;
async function loadLegal() {
  let d; try { d = await api('/api/admin/legal'); } catch (e) { alertMsg(e.message); return; }
  const ul = $('#legalList'); ul.textContent = '';
  const live = d.list.filter(e => e.ok).length;
  $('#legalCount').textContent = `(${live} publiée(s) sur ${d.list.length})`;
  $('#legalWatchState').textContent = d.lastWatch ? 'Dernière relecture des sources : ' + dayFr(d.lastWatch) + ' à ' + hhmm(d.lastWatch) + '. La veille prévient ici, elle ne publie et ne modifie jamais rien.' : 'Les sources n’ont pas encore été relues (une fois par jour).';
  if (!d.list.length) return empty(ul, 'Annuaire vide.');
  for (const e of d.list) {
    const buttons = [];
    if (!e.ok) { const v = btn('Valider'); v.onclick = () => legalAct(e.id, 'validate'); buttons.push(v); }
    else { const u = btn('Dépublier', 'ghost'); u.onclick = () => legalAct(e.id, 'unvalidate'); buttons.push(u); }
    if (['missing', 'changed'].includes(e.status)) { const a = btn('Vu, numéro toujours bon', 'ghost'); a.onclick = () => legalAct(e.id, 'ack'); buttons.push(a); }
    const ed = btn('Modifier', 'ghost'); ed.onclick = () => editLegal(e); buttons.push(ed);
    const del = btn('Retirer', 'danger'); confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/legal/' + e.id, { method: 'DELETE' }); loadLegal(); }); buttons.push(del);
    const title = `${e.ok ? '✅' : '⏳ À VALIDER'} · ${e.city} · ${e.name} · ${e.phone}${e.signal ? ' (Signal)' : ''}`;
    const meta = [e.ok && e.checked ? 'vérifié le ' + dayFr(e.checked) : null, e.srcDate ? 'source du ' + dayFr(e.srcDate) : 'source non datée',
      WATCH[e.status] + (e.watch && e.watch.at ? ' (' + dayFr(e.watch.at) + ')' : ''),
      e.status === 'changed' && e.watch ? 'numéros vus : ' + e.watch.phones.join(', ') : null, e.watch && e.watch.err ? e.watch.err : null].filter(Boolean).join(' · ');
    const row = li(title, meta, ...buttons);
    if (e.src) { const a = document.createElement('a'); a.href = e.src; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Ouvrir la source'; a.className = 'meta'; row.firstChild.append(a); }
    ul.append(row);
  }
}
async function legalAct(id, act) { try { await api('/api/admin/legal/' + id + '/' + act, { method: 'POST', body: '{}' }); loadLegal(); loadBadges(); } catch (e) { alertMsg(e.message); } }
function editLegal(e) {
  $('#lgId').value = e.id; $('#lgCity').value = e.city; $('#lgName').value = e.name; $('#lgPhone').value = e.phone; $('#lgSignal').checked = e.signal;
  $('#lgSrc').value = e.src || ''; $('#lgSrcDate').value = e.srcDate || ''; lgPos = { lat: e.lat, lng: e.lng };
  $('#lgPos').textContent = 'Position : ' + e.lat.toFixed(3) + ', ' + e.lng.toFixed(3);
  $('#legalFormTitle').textContent = 'Modifier : ' + e.city; $('#lgCancel').hidden = false;
  $('#legalForm').scrollIntoView({ behavior: 'smooth' });
}
function resetLegalForm() { $('#legalForm').reset(); $('#lgId').value = ''; lgPos = null; $('#lgPos').textContent = 'Position : pas encore placée.'; $('#legalFormTitle').textContent = 'Ajouter une legal team'; $('#lgCancel').hidden = true; }
$('#lgCancel').onclick = resetLegalForm;
$('#lgFind').onclick = async () => {
  try {
    const r = await fetch('/api/geocode?q=' + encodeURIComponent($('#lgCity').value)).then(r => r.json());
    if (!Array.isArray(r) || !r.length) return ($('#lgPos').textContent = 'Ville introuvable, précise le nom.');
    lgPos = { lat: r[0].lat, lng: r[0].lng }; $('#lgPos').textContent = 'Position : ' + r[0].name + ' (' + r[0].lat.toFixed(3) + ', ' + r[0].lng.toFixed(3) + ')';
  } catch { $('#lgPos').textContent = 'Recherche indisponible.'; }
};
$('#legalForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  if (!lgPos) return ($('#lgPos').textContent = 'Place d’abord la ville (bouton « Placer la ville »).');
  const body = { city: $('#lgCity').value, name: $('#lgName').value, phone: $('#lgPhone').value, signal: $('#lgSignal').checked,
    src: $('#lgSrc').value, srcDate: $('#lgSrcDate').value || null, lat: lgPos.lat, lng: lgPos.lng };
  if ($('#lgId').value) body.id = $('#lgId').value;
  try { await api('/api/admin/legal', { method: 'POST', body: JSON.stringify(body) }); resetLegalForm(); loadLegal(); loadBadges(); } catch (e) { alertMsg(e.message); }
});
$('#legalWatchNow').onclick = async () => {
  const b = $('#legalWatchNow'); b.disabled = true; b.textContent = 'Relecture en cours…';
  try { await api('/api/admin/legal-watch', { method: 'POST', body: '{}' }); } catch (e) { alertMsg(e.message); }
  b.disabled = false; b.textContent = 'Relire les sources maintenant'; loadLegal(); loadBadges();
};

// ---- Demandes d'accès orga ----
async function loadRequests() {
  let d; try { d = await api('/api/admin/orga-requests'); } catch (e) { return; }
  const ul = $('#reqList'); ul.textContent = '';
  $('#reqCount').textContent = '(' + d.list.length + ')'; $('#reqBadge').textContent = d.list.length || '';
  if (!d.list.length) return empty(ul, 'Aucune demande en attente.');
  for (const r of d.list) {
    const inv = btn('Créer l’invitation');
    inv.onclick = async () => { $('#orgaLabel').value = r.collective; $('#orgaForm').requestSubmit();
      try { await api('/api/admin/orga-requests/' + r.id, { method: 'DELETE' }); } catch {} loadRequests(); };
    const del = btn('Refuser', 'danger');
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/orga-requests/' + r.id, { method: 'DELETE' }); loadRequests(); });
    const meta = [r.role, r.city, 'canal : ' + r.contact, r.since ? 'depuis ' + r.since : null, r.sponsor ? 'garant : ' + r.sponsor : null,
      new Date(r.t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ');
    const row = li(r.collective, meta, inv, del);
    const a = document.createElement('a'); a.href = r.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = r.link; a.className = 'meta'; row.firstChild.append(a);
    if (r.note) { const n = document.createElement('div'); n.className = 'meta'; n.textContent = '« ' + r.note + ' »'; row.firstChild.append(n); }
    ul.append(row);
  }
}
$('#joinLinkForm').addEventListener('submit', e => {
  e.preventDefault();
  const url = location.origin + '/?rejoindre=' + encodeURIComponent($('#joinCity').value.trim());
  $('#joinUrl').textContent = url; $('#joinQr').textContent = '';
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#joinQr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }); }
  $('#joinLinkOut').hidden = false;
});
$('#joinCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#joinUrl').textContent); alertMsg('Lien copié.'); } catch {} };

// ---- Stories Instagram du digest ----
let stBlobs = [];
$('#stMake').onclick = async () => {
  if (!dg) return;
  const b = $('#stMake'); b.disabled = true; b.textContent = 'Fabrication…';
  try {
    stBlobs = await window.makeStories(dg, { cover: $('#stCover').files[0], end: $('#stEnd').files[0], brand: brand.handle });
    const out = $('#stOut'); out.textContent = '';
    stBlobs.forEach((bl, i) => { const img = document.createElement('img'); img.src = URL.createObjectURL(bl); img.alt = 'Story ' + (i + 1); out.append(img); });
    $('#stActions').hidden = false;
    $('#stShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([stBlobs[0]], 'a.png', { type: 'image/png' })] }));
  } catch (e) { alertMsg('Stories : ' + e.message); }
  b.disabled = false; b.textContent = 'Fabriquer les stories';
};
const stFiles = () => stBlobs.map((bl, i) => new File([bl], `cortege-${dg.date}-${i + 1}.png`, { type: 'image/png' }));
$('#stShare').onclick = () => navigator.share({ files: stFiles() }).catch(() => {});
$('#stSave').onclick = () => stFiles().forEach((f, i) => setTimeout(() => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.append(a); a.click(); a.remove();
}, i * 300));

// ---- Page publique du jour ----
function pubUi() {
  if (!dg) return;
  $('#pubState').textContent = dg.published ? 'Publiée : ' + location.origin + '/manif/' + dg.date : 'Pas encore publiée.';
  $('#pubBtn').textContent = dg.published ? 'Mettre à jour la page' : 'Publier la page publique';
  $('#pubLink').hidden = !dg.published; $('#pubLink').href = '/manif/' + dg.date;
  let un = document.getElementById('pubDel');
  if (dg.published && !un) { un = btn('Retirer la page', 'danger'); un.id = 'pubDel'; un.type = 'button'; $('#pubBtn').after(un);
    confirmBtn(un, 'Confirmer', async () => { await api('/api/admin/publish/' + dg.date, { method: 'DELETE' }); dg.published = false; un.remove(); pubUi(); }); }
  if (!dg.published && un) un.remove();
}
$('#pubBtn').onclick = async () => {
  if (!dg) return;
  try { await api('/api/admin/publish/' + dg.date, { method: 'POST', body: '{}' }); dg.published = true; pubUi(); alertMsg('Page publiée.'); } catch (e) { alertMsg(e.message); }
};
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

// ---- Direct ----
let liveTimer = null;
async function loadLive() {
  clearTimeout(liveTimer);
  if ($('#panelLive').hidden) return;
  let d; try { d = await api('/api/admin/live'); } catch (e) { alertMsg(e.message); return; }
  const k = $('#liveKpis'); k.textContent = '';
  const last15 = d.perMin.reduce((a, b) => a + b, 0);
  k.append(kpi(fmtN(d.active), 'signalements actifs'), kpi(fmtN(last15), 'nouveaux en 15 min'), kpi(fmtN(d.contested), 'à vérifier'),
    kpi(fmtN(d.streams), 'téléphones en temps réel'), kpi(fmtN(d.push.subs), 'abonnés aux notifications'));
  const box = $('#livePerMin'); box.textContent = '';
  const max = Math.max(1, ...d.perMin);
  d.perMin.forEach((n, i) => { const b = document.createElement('div'); b.style.height = Math.max(2, n / max * 100) + '%'; if (!n) b.className = 'zero'; b.title = (14 - i) + ' min : ' + n; box.append(b); });
  const st = [];
  if (d.mob) st.push('Journée prévue aujourd’hui : ' + d.mob.title);
  st.push(d.strict ? 'Mode renforcé jusqu’à ' + hhmm(d.strict) : 'Mode renforcé : non');
  st.push(d.paused ? 'Signalements en pause jusqu’à ' + hhmm(d.paused) : 'Signalements ouverts');
  $('#liveState').textContent = st.join(' · ');
  const p = d.push, rate = p.sent ? Math.round(p.ok / p.sent * 100) + ' %' : '—';
  kv($('#livePush'), [
    ['Abonnés', `${fmtN(p.subs)} (annonces urgentes : ${fmtN(p.urg)}, dangers près de soi : ${fmtN(p.near)})`],
    ['Envoyées', `${fmtN(p.sent)} depuis ${dur(Math.round((d.now - p.since) / 1000))}`],
    ['Reçues par le service', `${fmtN(p.ok)} (${rate})`], ['Expirées', fmtN(p.gone)],
    ['Échecs', fmtN(p.fail) + (Object.keys(p.codes).length ? ' · codes ' + Object.entries(p.codes).map(([c, n]) => (c === '0' ? 'sans réponse' : c) + ' ×' + n).join(', ') : '')],
    ['En file', `${p.queue} en attente, ${p.running} en cours`],
    ['Dernière erreur', p.lastErr ? `${hhmm(p.lastErr.t)} · ${p.lastErr.host} · ${p.lastErr.code || 'pas de réponse'} · ${p.lastErr.msg || ''}` : 'aucune'],
  ]);
  const bl = $('#liveBatches'); bl.textContent = '';
  for (const b of p.batches) bl.append(li(`${b.kind} : ${b.n} envoi(s)`, `${hhmm(b.t)} · ${b.ok} reçue(s), ${b.gone} expirée(s), ${b.fail} échec(s)` + (b.fail ? ' ' + JSON.stringify(b.codes) : '')));
  const sy = d.sys;
  kv($('#liveSys'), [
    ['Version', d.version], ['En ligne depuis', dur(sy.uptime)],
    ['Charge (1, 5, 15 min)', sy.load.join(' · ') + ` pour ${sy.cpus} cœurs`],
    ['Mémoire libre', sy.mem ? `${sy.mem.free} % (${fmtN(sy.mem.mb)} Mo)` : '—'], ['Mémoire de Cortège', sy.rss + ' Mo'],
    ['Disque libre', sy.disk ? `${sy.disk.free} % (${String(sy.disk.gb).replace('.', ',')} Go)` : '—'],
    ['Serveur', (d.up != null ? `en marche depuis ${d.up < 3600 ? Math.round(d.up / 60) + ' min' : d.up < 172800 ? Math.round(d.up / 3600) + ' h' : Math.round(d.up / 86400) + ' j'}` : '—')
      + (d.crash && Date.now() - d.crash.t < 7 * 864e5 ? ` · ⚠ dernier plantage le ${dayFr(d.crash.t)} à ${hhmm(d.crash.t)} : ${d.crash.msg}${d.crash.at ? ' (' + d.crash.at + ')' : ''}` : '')],
    ['Retard de Node', d.load ? `${d.load.lagMs} ms` + (d.load.lagMs > 500 ? ' (surchargé : seul l’essentiel passe)' : '') : '—'],
    ['Refusées depuis le démarrage', d.load ? `${fmtN(d.load.shed)} par surcharge · ${fmtN(d.load.flood)} rafales d’une même adresse` : '—'],
  ]);
  liveTimer = setTimeout(loadLive, 10000);
}
$('#tabLive').onclick = () => { showTab('Live'); loadLive(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#panelLive').hidden) loadLive(); });

// ---- Modération ----
// Explication en clair de chaque raison (calculée par le serveur)
const MOD_WHY = {
  contested: r => `Contesté : ${r.down} ${r.down > 1 ? 'personnes disent' : 'personne dit'} que ce n’est plus là. Si c’est toujours vrai, « C’est vrai » le remet ; sinon, retire-le.`,
  down: r => `${r.down} « Plus là », pas encore assez pour le contester. Rien d’urgent.`,
  series: () => 'Danger signalé près d’une zone calme par un téléphone qui en a signalé près de plusieurs zones calmes en peu de temps. Peut-être une tentative de faire fuir les gens d’un endroit sûr.',
  new: () => 'Pas encore confirmé : envoyé par un téléphone tout récent pendant le mode manif renforcé. Il s’affiche avec la mention « Pas encore confirmé ». Rien à faire, sauf si tu sais qu’il est faux.',
  isolated: () => 'Isolé : aucun autre signalement à moins de 500 km. Souvent un test ou une position fausse.',
  abroad: () => 'Hors zone : visible sur la carte en direct, mais pas compté dans les bilans.',
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

// ---- Journées de mobilisation ----
let mobEdit = null;
async function loadMobs() {
  let d; try { d = await api('/api/admin/mobs'); } catch (e) { alertMsg(e.message); return; }
  $('#mobDate').min = d.today;
  pubPrompt(d.toPublish); $('#mobBadge').textContent = d.toPublish.length || '';
  const ul = $('#mobList'); ul.textContent = '';
  if (!d.list.length) return empty(ul, 'Aucune journée prévue.');
  for (const m of d.list) {
    const ed = btn('Modifier', 'ghost'), del = btn('Supprimer', 'danger');
    ed.onclick = () => { mobEdit = m.id; $('#mobDate').value = m.date; $('#mobTitle').value = m.title; $('#mobEve').value = m.eve || ''; $('#mobPush').checked = m.push; $('#mobStrict').checked = m.strict;
      $('#mobSave').textContent = 'Enregistrer'; $('#mobCancel').hidden = false; $('#mobForm').scrollIntoView({ behavior: 'smooth' }); };
    confirmBtn(del, 'Confirmer', async () => { await api('/api/admin/mobs/' + m.id, { method: 'DELETE' }); loadMobs(); });
    const past = m.date < d.today, today = m.date === d.today;
    const st = [m.push ? (m.eveSent ? 'notification envoyée' : 'notification la veille à 20 h') : 'sans notification',
      m.strict ? (m.strictSet ? 'mode renforcé lancé' : 'mode renforcé le jour J') : 'sans mode renforcé', past ? (m.published ? 'bilan publié' : 'bilan pas encore publié') : ''].filter(Boolean).join(' · ');
    ul.append(li((today ? '● Aujourd’hui · ' : '') + dayLong(m.date) + ' · ' + m.title, st, ...(past ? [del] : [ed, del])));
  }
}
const mobReset = () => { mobEdit = null; $('#mobForm').reset(); $('#mobSave').textContent = 'Prévoir la journée'; $('#mobCancel').hidden = true; };
$('#mobCancel').onclick = mobReset;
$('#mobForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { date: $('#mobDate').value, title: $('#mobTitle').value, eve: $('#mobEve').value, push: $('#mobPush').checked, strict: $('#mobStrict').checked };
  try { await api('/api/admin/mobs' + (mobEdit ? '/' + mobEdit : ''), { method: 'POST', body: JSON.stringify(body) }); alertMsg(mobEdit ? 'Journée modifiée.' : 'Journée prévue.'); mobReset(); loadMobs(); }
  catch (err) { alertMsg(err.message); }
});
$('#tabMobs').onclick = () => { showTab('Mobs'); loadMobs(); };

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
    row.querySelector('.fill').style.cssText = `width:${n / max * 100}%;--c:${k.grp === 'aide' ? '#3fcf86' : k.grp === 'surv' ? '#e0383e' : k.grp === 'etude' ? '#f2b33d' : '#9b87e8'}`;
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

// ---- Réglages ----
let setData = null;
async function loadSettings() {
  try { setData = await api('/api/admin/settings'); } catch (e) { alertMsg(e.message); return; }
  const s = setData.settings, df = setData.defaults;
  $('#setBanner').value = s.banner?.text || ''; $('#setFrom').value = s.banner?.from || ''; $('#setTo').value = s.banner?.to || '';
  $('#setBannerDef').textContent = `Nom par défaut : « ${df.event} ». Sans dates, le bandeau reste affiché jusqu’à ce que tu le vides. Un jour de mobilisation prévue, son titre passe devant.`;
  $('#setLat').value = s.view ? s.view.lat : ''; $('#setLng').value = s.view ? s.view.lng : ''; $('#setZoom').value = s.view ? s.view.zoom : '';
  $('#setLat').placeholder = df.center[0]; $('#setLng').placeholder = df.center[1]; $('#setZoom').placeholder = df.zoom;
  $('#setRadius').value = s.alertRadius || ''; $('#setRadius').placeholder = df.alertRadius;
  $('#setNear').value = s.nearKm || ''; $('#setNear').placeholder = df.nearKm;
  $('#setAdminLabel').value = s.adminLabel || '';
  const box = $('#setCats'); box.textContent = '';
  for (const c of setData.categories) {
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !c.off; cb.dataset.cat = c.id; cb.className = 'set-on';
    on.append(cb, ' ' + c.glyph + ' ' + c.label);
    const ttl = document.createElement('input'); ttl.type = 'number'; ttl.min = 5; ttl.max = 1440; ttl.value = c.ttl; ttl.dataset.cat = c.id; ttl.className = 'set-ttl'; ttl.setAttribute('aria-label', 'Durée en minutes : ' + c.label);
    const base = document.createElement('span'); base.className = 'base'; base.textContent = c.ttl !== c.base ? `min (défaut ${c.base})` : 'min';
    box.append(on, ttl, base);
  }
}
$('#setViewReset').onclick = () => { $('#setLat').value = $('#setLng').value = $('#setZoom').value = ''; };
$('#setForm').addEventListener('submit', async e => {
  e.preventDefault();
  const cats = {};
  document.querySelectorAll('#setCats .set-on').forEach(cb => { cats[cb.dataset.cat] = { off: !cb.checked }; });
  document.querySelectorAll('#setCats .set-ttl').forEach(i => { cats[i.dataset.cat].ttl = Number(i.value); });
  const num = id => $(id).value.trim() === '' ? null : Number($(id).value.replace(',', '.'));
  const body = { cats, alertRadius: num('#setRadius'), nearKm: num('#setNear'), adminLabel: $('#setAdminLabel').value.trim() };
  if ($('#setBanner').value.trim()) body.banner = { text: $('#setBanner').value, from: $('#setFrom').value, to: $('#setTo').value };
  if (num('#setLat') != null && num('#setLng') != null) body.view = { lat: num('#setLat'), lng: num('#setLng'), zoom: num('#setZoom') ?? 12 };
  if ($('#setTo').value && $('#setFrom').value && $('#setTo').value < $('#setFrom').value) return alertMsg('La date de fin est avant la date de début.');
  try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(body) }); $('#setMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; loadSettings(); }
  catch (err) { alertMsg(err.message); }
});
$('#tabSettings').onclick = () => { showTab('Settings'); loadSettings(); };

// ---- L'instance : nom, contact, liens, marque, hébergeur (vide = valeur du serveur) ----
const INST = [['#inEvent', 'event'], ['#inContact', 'contact'], ['#inViolence', 'violenceUrl'], ['#inSource', 'sourceUrl'], ['#inHost', 'hostInfo'],
  ['#inHandle', 'brand.handle'], ['#inInsta', 'brand.instagram'], ['#inSite', 'brand.site'], ['#inKofi', 'brand.kofi']];
const pick = (o, k) => k.split('.').reduce((x, p) => (x ? x[p] : undefined), o);
async function loadInstance() {
  let d; try { d = await api('/api/admin/instance'); } catch (e) { alertMsg(e.message); return; }
  for (const [sel, k] of INST) { $(sel).value = pick(d.set, k) || ''; $(sel).placeholder = pick(d.defaults, k) || '(vide)'; }
}
$('#instForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = { brand: {} };
  for (const [sel, k] of INST) { const v = $(sel).value.trim(); if (k.startsWith('brand.')) body.brand[k.slice(6)] = v; else body[k] = v; }
  try { await api('/api/admin/instance', { method: 'POST', body: JSON.stringify(body) }); $('#inMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; loadInstance(); }
  catch (err) { alertMsg(err.message); }
});
$('#tabSettings').addEventListener('click', loadInstance);

// Téléchargement d'un fichier de l'admin (la clé passe dans l'en-tête, pas dans l'adresse)
async function adminDownload(url, name) {
  const r = await fetch(url, { headers: { 'X-Admin-Key': KEY } });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || 'Téléchargement impossible.'); }
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
// ==== Carte d'un créneau : image PNG des signalements actifs pendant un créneau, autour d'un lieu ====
const { COL: SLOT_COL, FAM: SLOT_FAM } = window.cortegeCreneau;
let slotData = null;
const slotGeocode = q => window.cortegeCreneau.geocode(q);
function slotRows(c, R, from, to) {
  const cat = Object.fromEntries(dg.categories.map(x => [x.id, x]));
  const rows = dg.rows.filter(r => cat[r.c] && ($('#dgAll').checked || !REMOVED.has(r.o)))
    .map(r => ({ ...r, cat: cat[r.c], end: r.e || r.t, status: REMOVED.has(r.o) ? (OUTCOME[r.o] || r.o) : '' }));
  return window.cortegeCreneau.select(rows, c, R, from, to, dg.date);
}
async function slotDraw(c, R, from, to, rows) {
  const n = await window.cortegeCreneau.draw($('#slotCanvas'), { date: dg.date, c, R, from, to, rows, brand });
  $('#slotCanvas').hidden = false; return n;
}
$('#slotForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!dg) return;
  const from = $('#slotFrom').value, to = $('#slotTo').value, R = Math.min(5000, Math.max(100, +$('#slotR').value || 500));
  if (to < from) { $('#slotMsg').textContent = 'L’heure de fin est avant l’heure de début.'; return; }
  $('#slotGo').disabled = true; $('#slotMsg').textContent = 'Recherche du lieu et fabrication de l’image…';
  try {
    const c = await slotGeocode($('#slotPlace').value);
    c.label = c.name || $('#slotPlace').value.trim();
    const rows = slotRows(c, R, from, to);
    const nTiles = await slotDraw(c, R, from, to, rows);
    slotData = { c, R, from, to, rows };
    const name = `cortege-${dg.date}-${from.replace(':', 'h')}-${to.replace(':', 'h')}`;
    $('#slotDl').href = $('#slotCanvas').toDataURL('image/png'); $('#slotDl').download = name + '.png';
    $('#slotActions').hidden = false;
    $('#slotMsg').textContent = `${rows.length} signalement(s) actif(s) sur le créneau, à moins de ${R} m de « ${c.label} ».` + (nTiles ? '' : ' Fond de carte indisponible pour l’instant : réessaie dans un moment.');
  } catch (err) { $('#slotMsg').textContent = err.message || 'Impossible de fabriquer l’image.'; }
  $('#slotGo').disabled = false;
});
$('#slotCsv').onclick = () => {
  if (!slotData) return;
  const iso = t => new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16);
  // Texte commençant par = + - @ : neutralisé (un tableur l'exécuterait comme une formule) ; les nombres restent des nombres
  const esc = v => { let s = String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = ['debut;fin;type;famille;latitude;longitude;distance_m;confirmations;plus_la;verifie;devenir',
    ...slotData.rows.map(r => [iso(r.t), iso(r.end), r.cat.label, SLOT_FAM[r.cat.group] || r.cat.group, r.lat, r.lng, Math.round(r.dist / 10) * 10, r.up, r.dn ?? '', r.v ? 'oui' : 'non', OUTCOME[r.o] || r.o].map(esc).join(';'))];
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
  a.download = `cortege-${dg.date}-${slotData.from.replace(':', 'h')}-${slotData.to.replace(':', 'h')}.csv`; document.body.append(a); a.click(); a.remove();
};
// ---- Pays : pays couverts, pays principal, état de la carte, corrections du profil ----
let coData = null, coEditing = null;
const MAP_TXT = { detail: f => `carte détaillée (${f.file})`, world: f => `carte du monde seulement (zoom ${f.maxz} au plus), puis fond OpenStreetMap`, osm: () => 'pas de carte hébergée : fond OpenStreetMap' };
async function loadCountries() {
  try { coData = await api('/api/admin/countries'); } catch (e) { alertMsg(e.message); return; }
  const ul = $('#coList'); ul.textContent = '';
  for (const p of coData.list) {
    const li = document.createElement('li'), info = document.createElement('div'), acts = document.createElement('div');
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.active; cb.className = 'co-on'; cb.dataset.code = p.code;
    const b = document.createElement('b'); b.textContent = p.current.name || p.code;
    on.append(cb, ' ', b, ` (${p.code})`);
    const main = document.createElement('label'); main.className = 'check';
    const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'coMain'; rb.value = p.code; rb.checked = p.main;
    main.append(rb, ' pays principal');
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [MAP_TXT[p.map.kind](p.map), p.extra.length ? 'types en plus : ' + p.extra.join(', ') : '', p.orders ? 'arrêtés' : '', p.edited ? 'modifié dans l’admin' : ''].filter(Boolean).join(' · ');
    info.append(on, document.createElement('br'), main, meta);
    acts.className = 'acts';
    const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'ghost'; ed.textContent = 'Modifier'; ed.onclick = () => editCountry(p.code);
    const ex = document.createElement('button'); ex.type = 'button'; ex.className = 'ghost'; ex.textContent = 'Exporter';
    ex.onclick = () => adminDownload(`/api/admin/countries/${p.code}/export`, p.code + '.json').catch(e => alertMsg(e.message));
    acts.append(ed, ex);
    if (p.edited) {
      const rv = document.createElement('button'); rv.type = 'button'; rv.className = 'ghost'; rv.textContent = 'Revenir à l’origine';
      rv.onclick = async () => {
        if (rv.dataset.armed !== '1') { rv.dataset.armed = '1'; rv.textContent = 'Confirmer'; setTimeout(() => { rv.dataset.armed = ''; rv.textContent = 'Revenir à l’origine'; }, 4000); return; }
        try { await api('/api/admin/countries/' + p.code, { method: 'DELETE' }); if (coEditing === p.code) $('#coEdit').hidden = true; loadCountries(); } catch (e) { alertMsg(e.message); }
      };
      acts.append(rv);
    }
    li.append(info, acts); ul.append(li);
  }
}
$('#coSave').onclick = async () => {
  const on = [...document.querySelectorAll('#coList .co-on')].filter(c => c.checked).map(c => c.dataset.code);
  const main = document.querySelector('#coList input[name=coMain]:checked')?.value;
  if (!on.length) return alertMsg('Garde au moins un pays.');
  if (!main || !on.includes(main)) return alertMsg('Le pays principal doit être coché.');
  try { await api('/api/admin/countries/active', { method: 'POST', body: JSON.stringify({ codes: [main, ...on.filter(c => c !== main)] }) });
    $('#coMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '. Les téléphones l’appliquent à leur prochaine ouverture de l’appli.'; loadCountries(); loadMaps(); }
  catch (e) { alertMsg(e.message); }
};
// Droits : « # Titre » puis une ligne par conseil
const rightsToText = r => (r || []).map(s => '# ' + s.title + '\n' + s.items.join('\n')).join('\n\n');
function textToRights(t) {
  const out = [];
  for (const raw of t.split('\n')) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('#')) out.push({ title: l.replace(/^#+\s*/, ''), items: [] });
    else { if (!out.length) out.push({ title: 'Tes droits', items: [] }); out[out.length - 1].items.push(l.replace(/^[-•*]\s*/, '')); }
  }
  return out.filter(s => s.title && s.items.length);
}
function editCountry(code) {
  const p = coData.list.find(x => x.code === code); if (!p) return;
  coEditing = code;
  const c = p.current, o = p.original;
  $('#coEditTitle').textContent = 'Modifier : ' + (c.name || code);
  $('#coName').value = c.name || ''; $('#coUnits').value = c.units || 'metric';
  const em = c.emergency || {};
  for (const [sel, k] of [['#coMed', 'medical'], ['#coGen', 'general'], ['#coPol', 'police'], ['#coPha', 'pharmacy']]) $(sel).value = em[k] || '';
  const box = $('#coCats'); box.textContent = '';
  for (const cat of coData.categories) {
    if (cat.profiles && !cat.profiles.includes(code)) continue;
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !(c.hidden || []).includes(cat.id); cb.dataset.cat = cat.id; cb.className = 'co-show';
    on.append(cb, ' ' + cat.glyph + ' ' + cat.label);
    const inp = document.createElement('input'); inp.maxLength = 60; inp.dataset.cat = cat.id; inp.className = 'co-label';
    inp.value = (c.labels || {})[cat.id] || ''; inp.placeholder = (o.labels || {})[cat.id] || cat.label; inp.setAttribute('aria-label', 'Nom : ' + cat.label);
    box.append(on, inp, document.createElement('span'));
  }
  $('#coRights').value = rightsToText(c.rights);
  $('#coViolUrl').value = c.violence?.url || ''; $('#coViolLabel').value = c.violence?.label || '';
  $('#coEditMsg').textContent = '';
  $('#coEdit').hidden = false; $('#coEdit').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#coEditCancel').onclick = () => { $('#coEdit').hidden = true; coEditing = null; };
$('#coEditSave').onclick = async () => {
  if (!coEditing) return;
  const labels = {}, hidden = [];
  document.querySelectorAll('#coCats .co-label').forEach(i => { if (i.value.trim()) labels[i.dataset.cat] = i.value.trim(); });
  document.querySelectorAll('#coCats .co-show').forEach(cb => { if (!cb.checked) hidden.push(cb.dataset.cat); });
  // Les noms d'origine restent ceux du fichier (un champ vide les reprend)
  const p = coData.list.find(x => x.code === coEditing);
  for (const [id, v] of Object.entries(p.original.labels || {})) if (!labels[id]) labels[id] = v;
  const body = { name: $('#coName').value.trim(), units: $('#coUnits').value, labels, hidden,
    emergency: { medical: $('#coMed').value.trim(), general: $('#coGen').value.trim(), police: $('#coPol').value.trim(), pharmacy: $('#coPha').value.trim() },
    rights: textToRights($('#coRights').value),
    violence: $('#coViolUrl').value.trim() ? { url: $('#coViolUrl').value.trim(), label: $('#coViolLabel').value.trim(), ...(p.current.violence?.desc ? { desc: p.current.violence.desc } : {}) } : null };
  try { await api('/api/admin/countries/' + coEditing, { method: 'POST', body: JSON.stringify(body) });
    $('#coEditMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; await loadCountries(); editCountry(coEditing); $('#coEditMsg').textContent = 'Enregistré à ' + hhmm(Date.now()) + '.'; }
  catch (e) { alertMsg(e.message); }
};
$('#tabCountries').onclick = () => { showTab('Countries'); loadCountries(); loadMaps(); };
// ---- Langues : traductions livrées ou déposées, langues proposées, langue par défaut ----
let lgData = null;
async function loadLangs(d) {
  if (d) lgData = d; else { try { lgData = await api('/api/admin/langs'); } catch (e) { alertMsg(e.message); return; } }
  $('#lgIntro').textContent = `${lgData.total} textes à traduire dans l’appli. Langue par défaut, pour les téléphones dont la langue n’est pas proposée : ${lgData.langs.find(l => l.code === lgData.def)?.name || lgData.def}.`;
  const ul = $('#lgList'); ul.textContent = '';
  for (const l of lgData.langs) {
    const li = document.createElement('li'), info = document.createElement('div'), acts = document.createElement('div');
    const on = document.createElement('label'); on.className = 'check';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = l.active; cb.disabled = l.code === 'fr';
    cb.onchange = () => saveLangPrefs({ off: lgData.langs.filter(x => x.code !== 'fr' && (x.code === l.code ? !cb.checked : !x.active)).map(x => x.code) });
    const b = document.createElement('b'); b.textContent = l.name; b.dir = l.dir;
    on.append(cb, ' ', b, ` (${l.code})`, cb.disabled ? ' · texte d’origine' : ' · proposée');
    const def = document.createElement('label'); def.className = 'check';
    const rb = document.createElement('input'); rb.type = 'radio'; rb.name = 'lgDef'; rb.checked = l.code === lgData.def; rb.disabled = !l.active;
    rb.onchange = () => saveLangPrefs({ def: l.code });
    def.append(rb, ' par défaut');
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [l.code === 'fr' ? (l.n ? `${l.n} correction(s) du français` : 'aucune correction') : `${l.pct ?? '?'} % traduit (${fmtN(l.n)} texte${l.n > 1 ? 's' : ''})`,
      l.src === 'upload' ? (l.over ? 'fichier déposé dans l’admin, à la place du fichier livré' : 'fichier déposé dans l’admin') : 'livrée avec Cortège'].join(' · ');
    if (l.code !== 'fr' && l.pct != null) { const bar = document.createElement('span'), fill = document.createElement('i'); bar.className = 'lg-bar';
      fill.style.width = l.pct + '%'; bar.append(fill); meta.append(bar); }
    info.append(on, document.createElement('br'), def, meta);
    acts.className = 'acts';
    if (l.hasPo) { const dl = document.createElement('button'); dl.type = 'button'; dl.className = 'ghost'; dl.textContent = 'Télécharger le .po';
      dl.onclick = () => adminDownload(`/api/admin/langs/${l.code}.po`, l.code + '.po').catch(e => alertMsg(e.message)); acts.append(dl); }
    if (l.src === 'upload') {
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'ghost'; rm.textContent = l.over ? 'Revenir au fichier livré' : 'Retirer';
      rm.onclick = async () => {
        if (rm.dataset.armed !== '1') { rm.dataset.armed = '1'; const t = rm.textContent; rm.textContent = 'Confirmer'; setTimeout(() => { rm.dataset.armed = ''; rm.textContent = t; }, 4000); return; }
        try { loadLangs(await api('/api/admin/langs/' + l.code, { method: 'DELETE' })); } catch (e) { alertMsg(e.message); }
      };
      acts.append(rm);
    }
    li.append(info, acts); ul.append(li);
  }
}
async function saveLangPrefs(body) {
  try { loadLangs(await api('/api/admin/langs/prefs', { method: 'POST', body: JSON.stringify(body) })); }
  catch (e) { alertMsg(e.message); loadLangs(); }
}
$('#lgUpload').onclick = async () => {
  const f = $('#lgFile').files[0]; $('#lgProblems').textContent = '';
  if (!f) return alertMsg('Choisis d’abord un fichier .po.');
  if (f.size > 2_500_000) return alertMsg('Fichier trop gros pour une traduction.');
  $('#lgUpMsg').textContent = 'Vérification…';
  try {
    const r = await api('/api/admin/langs/upload', { method: 'POST', body: JSON.stringify({ text: await f.text(), file: f.name }) });
    $('#lgUpMsg').textContent = `${r.name} (${r.code}) en ligne : ${fmtN(r.n)} texte${r.n > 1 ? 's' : ''} traduit${r.n > 1 ? 's' : ''}.` + (r.active ? '' : ' Coche-la dans la liste pour la proposer dans l’appli.')
      + (r.warnings.length ? ` ${r.warnings.length} point(s) à vérifier :` : '');
    for (const w of r.warnings) { const li = document.createElement('li'); li.textContent = w; $('#lgProblems').append(li); }
    $('#lgFile').value = ''; loadLangs();
  } catch (e) {
    $('#lgUpMsg').textContent = e.message;
    for (const p of e.problems || []) { const li = document.createElement('li'); li.textContent = p; $('#lgProblems').append(li); }
  }
};
$('#lgNewDl').onclick = () => {
  const code = $('#lgNewCode').value.trim().replace('_', '-'), name = $('#lgNewName').value.trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code)) return alertMsg('Code de langue attendu : de, it, pt-BR…');
  adminDownload(`/api/admin/langs/${code}.po?name=${encodeURIComponent(name || code)}`, code + '.po').catch(e => alertMsg(e.message));
};
$('#lgPot').onclick = e => { e.preventDefault(); adminDownload('/api/admin/langs/cortege.pot', 'cortege.pot').catch(err => alertMsg(err.message)); };
$('#tabLangs').onclick = () => { showTab('Langs'); loadLangs(); };
// ---- Serveur : version, mise à jour disponible, ressources, cartes, sauvegarde ----
const octets = n => n == null ? 'inconnu' : n >= 1e9 ? (n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go' : n >= 1e6 ? Math.round(n / 1e6) + ' Mo' : Math.round(n / 1e3) + ' ko';
const duree = s => s < 3600 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' j';
const libre = d => d ? `${octets(d.free)} libres sur ${octets(d.total)} (${Math.round(d.free / d.total * 100)} %)` : 'inconnu';
async function loadServer(check = true) {
  let d; try { d = await api('/api/admin/server' + (check ? '' : '?check=0')); } catch (e) { alertMsg(e.message); return; }
  $('#srvBadge').textContent = d.newer ? '1' : '';
  $('#srvUpdate').hidden = !d.newer;
  if (d.newer) {
    $('#srvUpdateText').textContent = `La version ${d.latest} est publiée ; ton serveur fait tourner la ${d.version}.`;
    $('#srvCmd').textContent = d.update;
    $('#srvChangelog').hidden = !d.changelog; if (d.changelog) $('#srvChangelog').href = d.changelog;
  }
  kv($('#srvVersion'), [
    ['En ligne', d.version],
    ['Publiée', d.latest ? d.latest + (d.newer ? ' (plus récente)' : ' (à jour)') : d.latestErr || 'pas encore vérifiée'],
    ['Vérifiée', d.latestAt ? `${dayFr(d.latestAt)} à ${hhmm(d.latestAt)}` : 'inconnu'],
    ['Node', d.node],
    ['Commande de mise à jour', d.update],
  ]);
  kv($('#srvRes'), [
    ['Cortège tourne depuis', duree(d.uptime)],
    ['Machine allumée depuis', duree(d.host.uptime)],
    ['Charge (1, 5, 15 min)', d.host.load.join(' · ') + ` pour ${d.host.cpus} cœurs`],
    ['Mémoire', d.mem ? `${octets(d.mem.free)} libres sur ${octets(d.mem.total)} · Cortège : ${octets(d.rss)}` : 'inconnu'],
    ['Disque des données', libre(d.disk.data)],
    ...(d.disk.tiles ? [['Disque des cartes', libre(d.disk.tiles)]] : []),
    ['Base de données', octets(d.db)],
    ['Dernier plantage', d.crash ? `${dayFr(d.crash.t)} à ${hhmm(d.crash.t)} : ${d.crash.msg}` : 'aucun'],
  ]);
  kv($('#srvMaps'), d.maps.length ? d.maps.map(m => [m.name, `${octets(m.bytes)} · ${m.world ? 'monde' : 'régionale'}${m.open ? ` · zoom ${m.minz} à ${m.maxz}` : ' · illisible'}`])
    : [['Aucune', 'fond OpenStreetMap partout (voir le guide d’une nouvelle instance pour héberger une carte)']]);
  const old = d.backup && Date.now() - d.backup.t > 36 * 3600_000;
  kv($('#srvBackup'), [['Dernière sauvegarde', d.backup ? `${dayFr(d.backup.t)} à ${hhmm(d.backup.t)}${d.backup.bytes ? ' · ' + octets(d.backup.bytes) : ''}${old ? ' ⚠ plus d’un jour' : ''}` : 'inconnue']]);
  $('#srvBackupHelp').textContent = d.backup ? 'Faite chaque nuit par le minuteur du serveur, chiffrée : seule ta clé secrète, gardée hors du serveur, peut l’ouvrir.'
    : 'Le script de sauvegarde n’a pas encore indiqué de date. S’il est installé, mets-le à jour une fois sur le serveur : sudo install -m 700 tools/cortege-backup.sh /usr/local/sbin/cortege-backup (depuis le dossier de l’appli).';
}
$('#srvCheck').onclick = () => loadServer(true);
$('#srvCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#srvCmd').textContent); $('#srvCopy').textContent = 'Copié'; setTimeout(() => ($('#srvCopy').textContent = 'Copier'), 2000); } catch { alertMsg($('#srvCmd').textContent); } };
$('#tabServer').onclick = () => { showTab('Server'); loadServer(true); };
// Pastille « mise à jour disponible » dès la connexion
function srvBadge() { api('/api/admin/server').then(d => { $('#srvBadge').textContent = d.newer ? '1' : ''; }).catch(() => {}); }
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
