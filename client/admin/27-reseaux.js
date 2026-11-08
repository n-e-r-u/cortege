// ---- Réseaux : partage sur Bluesky et Mastodon (réglages, relecture, message écrit à la main, retrait) ----
const SOC_KIND = { eve: '📣 Veille de journée', day: '✊ Jour J', ord: '⛔ Arrêtés', pub: '📊 Bilan', man: '✍ Message écrit' };
const SOC_ST = { review: '⏳ À relire', queued: '📤 En cours d’envoi', done: '✓ Publié', error: '⚠ Échec', skip: '✖ Ignoré', deleted: '🗑 Retiré des réseaux' };
const SOC_NET = { bsky: 'Bluesky', masto: 'Mastodon' };
let socData = null;
function socialBadge() { api('/api/admin/social').then(d => { $('#socialBadge').textContent = d.review || ''; }).catch(() => {}); }
async function loadSocial() {
  try { socData = await api('/api/admin/social'); } catch (e) { alertMsg(e.message); return; }
  const d = socData; $('#socialBadge').textContent = d.review || '';
  const nets = $('#socNets'); nets.textContent = '';
  for (const [k, n] of Object.entries(d.nets)) {
    const l = document.createElement('li'); const b = document.createElement('div');
    const name = document.createElement('b'); name.textContent = SOC_NET[k];
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = n.ready ? `Prêt · ${n.who}${d.cfg.off[k] ? ' · coupé dans les réglages' : ''}` : k === 'bsky' ? 'Pas configuré : BLUESKY_HANDLE et BLUESKY_APP_PASSWORD manquent.' : 'Pas configuré : MASTODON_URL et MASTODON_TOKEN manquent.';
    b.append(name, m); l.append(b); nets.append(l);
  }
  $('#socMode').value = d.cfg.mode; $('#socTags').value = d.cfg.tags;
  document.querySelectorAll('#socCfg [data-k]').forEach(i => { i.checked = d.cfg.kinds[i.dataset.k]; });
  document.querySelectorAll('#socCfg [data-n]').forEach(i => { i.checked = !d.cfg.off[i.dataset.n]; });
  socCount(); renderSocial();
}
function renderSocial() {
  const ul = $('#socList'); ul.textContent = '';
  const list = socData.posts;
  $('#socCountAll').textContent = list.length ? `(${list.length}${socData.review ? ', ' + socData.review + ' à relire' : ''})` : '';
  if (!list.length) return empty(ul, 'Aucun message pour l’instant.');
  for (const p of list) {
    const l = document.createElement('li'), b = document.createElement('div');
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = `${SOC_KIND[p.kind] || p.kind} · ${SOC_ST[p.status] || p.status} · ${dayFr(p.t)} à ${hhmm(p.t)}`;
    let text;
    if (p.status === 'review') { text = document.createElement('textarea'); text.rows = 4; text.maxLength = 1000; text.value = p.text; text.setAttribute('aria-label', 'Texte du message'); }
    else { text = document.createElement('p'); text.className = 'soc-text'; text.textContent = p.text; }
    b.append(meta, text);
    if (p.link) { const a = document.createElement('a'); a.href = p.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.link; a.className = 'fine'; b.append(a); }
    const nets = document.createElement('div'); nets.className = 'soc-nets';
    for (const [k, s] of Object.entries(p.nets)) {
      const x = document.createElement(s.url && s.st === 'ok' ? 'a' : 'span');
      if (x.tagName === 'A') { x.href = s.url; x.target = '_blank'; x.rel = 'noopener'; }
      x.textContent = SOC_NET[k] + ' : ' + ({ ok: 'en ligne', wait: s.tries ? `nouvel essai (${s.tries}/5)` : 'en attente', err: 'échec', off: 'pas envoyé (réseau coupé)', del: 'retiré' }[s.st] || s.st) + (s.err && s.st !== 'ok' ? ' · ' + s.err : '');
      if (s.st === 'err' || (s.err && s.st === 'wait')) x.className = 'bad';
      nets.append(x);
    }
    b.append(nets);
    const row = document.createElement('div'); row.className = 'controls';
    const act = (label, path, body, cls) => { const x = btn(label, cls); x.onclick = async () => { try { await api(`/api/admin/social/${p.id}/${path}`, { method: 'POST', body: JSON.stringify(body ? body() : {}) }); loadSocial(); } catch (e) { alertMsg(e.message); } }; return x; };
    if (p.status === 'review') row.append(act('Publier', 'send', () => ({ text: text.value })), act('Ignorer', 'skip', null, 'ghost'));
    if (p.status === 'queued') row.append(act('Annuler l’envoi', 'skip', null, 'ghost'));
    if (Object.values(p.nets).some(s => s.st === 'err')) row.append(act('Réessayer', 'retry'));
    if (Object.values(p.nets).some(s => s.st === 'ok')) {
      const del = btn('Retirer des réseaux', 'danger');
      confirmBtn(del, 'Confirmer le retrait', async () => { await api('/api/admin/social/' + p.id, { method: 'DELETE' }); loadSocial(); });
      row.append(del);
    }
    if (row.childElementCount) b.append(row);
    l.append(b); ul.append(l);
  }
}
// Longueur : Bluesky compte 300 caractères avec le lien et les mots-clés, Mastodon 500 ; au-delà, le texte est coupé
function socCount() {
  const tags = $('#socTags').value.trim(), link = $('#socLink').value.trim();
  const n = [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment($('#socText').value.trim() + (link ? '\n\n' + link : '') + (tags ? '\n' + tags : ''))].length;
  $('#socCount').textContent = `${n} caractères avec le lien et les mots-clés · Bluesky 300 au plus, Mastodon 500 : au-delà, le texte est coupé.`;
  $('#socCount').classList.toggle('bad', n > 300);
}
$('#socText').oninput = socCount; $('#socLink').oninput = socCount; $('#socTags').oninput = socCount;
$('#socForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#socMsg').textContent = '';
  try { await api('/api/admin/social/post', { method: 'POST', body: JSON.stringify({ text: $('#socText').value, link: $('#socLink').value }) });
    $('#socText').value = ''; $('#socLink').value = ''; $('#socMsg').textContent = 'Envoi en cours.'; socCount(); setTimeout(loadSocial, 3000); loadSocial(); }
  catch (err) { $('#socMsg').textContent = err.message; }
});
$('#socCfg').addEventListener('submit', async e => {
  e.preventDefault();
  const kinds = {}, off = {};
  document.querySelectorAll('#socCfg [data-k]').forEach(i => { kinds[i.dataset.k] = i.checked; });
  document.querySelectorAll('#socCfg [data-n]').forEach(i => { off[i.dataset.n] = !i.checked; });
  try { await api('/api/admin/social/config', { method: 'POST', body: JSON.stringify({ mode: $('#socMode').value, kinds, off, tags: $('#socTags').value }) }); $('#socCfgMsg').textContent = 'Enregistré.'; loadSocial(); }
  catch (err) { $('#socCfgMsg').textContent = err.message; }
});
$('#socTest').onclick = async () => {
  $('#socTestMsg').textContent = 'Vérification…';
  try {
    const r = await api('/api/admin/social/test', { method: 'POST', body: '{}' });
    const parts = Object.entries(r).map(([k, x]) => `${SOC_NET[k]} : ${x.ok ? '✓ connecté en tant que ' + x.who : '⚠ ' + x.error}`);
    $('#socTestMsg').textContent = parts.join(' · ') || 'Aucun réseau configuré.';
  } catch (e) { $('#socTestMsg').textContent = e.message; }
};
$('#tabSocial').onclick = () => { showTab('Social'); loadSocial(); };
