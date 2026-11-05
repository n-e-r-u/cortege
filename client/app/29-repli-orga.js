  // ---- Espace orga : lieux de repli (orgas certifiées) ----
  {
    const RC = cfg.refuge || { glyphs: ['🕊️'], colors: ['#30a46c'], services: [] };
    const SV_LABEL = { eau: '💧 ' + t('Eau'), wc: '🚻 ' + t('Toilettes'), ecoute: '👂 ' + t('Écoute'), recharge: '🔋 ' + t('Recharge'), soins: '🩹 ' + t('Premiers soins'),
      abri: '☂️ ' + t('À l’abri'), pmr: '♿ ' + t('Accessible PMR') };
    const box = $('#refugeBox'), form = $('#refugeForm'), msg = s => { $('#refugeMsg').textContent = s || ''; };
    let list = [], max = 1, editing = null, pos = null, glyph = RC.glyphs[0], color = RC.colors[0];
    const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const at = (v, base = Date.now()) => { const [h, m] = String(v || '').split(':').map(Number); const d = new Date(base); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
    // Créneau choisi : une fermeture plus tôt que l'ouverture veut dire le lendemain
    function slot() {
      const now = Date.now(), from = $('#rfFrom').value ? at($('#rfFrom').value) : now;
      let to = at($('#rfTo').value); if (to <= from) to += 24 * 3600e3;
      return { from: Math.max(from, now - 60 * 60e3), to };
    }
    // Pictogrammes, couleurs, services : boutons et cases construits une fois
    for (const s of RC.services) $('#rfServices').append(el('label', { class: 'check' }, el('input', { type: 'checkbox', value: s }), ' ' + (SV_LABEL[s] || s)));
    const pick = (boxSel, vals, cur, set, render) => {
      const b = $(boxSel);
      for (const v of vals) { const x = el('button', { type: 'button', class: 'pick', 'data-v': v, 'aria-pressed': 'false' }, render(v)); x.onclick = () => { set(v); syncPick(); }; b.append(x); }
    };
    pick('#rfGlyphs', RC.glyphs, glyph, v => { glyph = v; }, v => v);
    pick('#rfColors', RC.colors, color, v => { color = v; }, v => el('span', { class: 'swatch', style: `background:${v}` }));
    function syncPick() {
      document.querySelectorAll('#rfGlyphs .pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === glyph)));
      document.querySelectorAll('#rfColors .pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === color)));
      document.querySelectorAll('#rfGlyphs .pick').forEach(b => { b.style.background = b.dataset.v === glyph ? color : ''; });
    }
    const showPos = () => { $('#rfPos').textContent = pos ? t('Position du lieu : {pos}', { pos: pos[0].toFixed(4) + ', ' + pos[1].toFixed(4) }) : t('Déplace la carte sur le lieu, puis place-le au centre.'); };
    $('#rfHere').onclick = () => { const c = map.getCenter(); pos = [c.lat, c.lng]; showPos(); };
    function openForm(r) {
      editing = r ? r.id : null;
      $('#rfName').value = r ? r.name : ''; $('#rfShort').value = r ? r.short : ''; $('#rfAddr').value = r ? r.addr : '';
      $('#rfMsg').value = r ? r.msg : ''; $('#rfUrl').value = r ? r.url : '';
      document.querySelectorAll('#rfServices input').forEach(i => { i.checked = !!(r && r.services.includes(i.value)); });
      glyph = r ? r.glyph : RC.glyphs[0]; color = r ? r.color : RC.colors[0];
      $('#rfUseLogo').checked = !!(r && r.useLogo); $('#rfConsent').checked = !!(r && r.consent);
      pos = r ? [r.lat, r.lng] : null; showPos(); syncPick();
      form.hidden = false; $('#rfAdd').hidden = true; $('#rfName').focus();
    }
    const canAdd = () => list.length < max;
    function closeForm() { form.hidden = true; $('#rfAdd').hidden = !canAdd(); editing = null; }
    $('#rfAdd').onclick = () => openForm(null);
    $('#rfCancel').onclick = closeForm;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pos) { msg(t('Place le lieu sur la carte.')); return; }
      const body = { name: $('#rfName').value, short: $('#rfShort').value, addr: $('#rfAddr').value, msg: $('#rfMsg').value, url: $('#rfUrl').value, lat: pos[0], lng: pos[1],
        services: [...document.querySelectorAll('#rfServices input:checked')].map(i => i.value), glyph, color, useLogo: $('#rfUseLogo').checked, consent: $('#rfConsent').checked };
      try {
        await orgaFetch('/api/orga/refuges' + (editing ? '/' + editing : ''), { method: 'POST', body: JSON.stringify(body) });
        closeForm(); msg(t('Lieu enregistré.')); load();
      } catch (err) { msg(err.message); }
    });
    const state = r => { const now = Date.now();
      if (r.state === 'closed' || !(r.to > now)) return t('Fermé');
      if (r.from > now) return t('Ouvre à {h}', { h: hhmm(r.from) });
      return (r.state === 'full' ? t('Complet') : t('Ouvert')) + ' · ' + t('jusqu’à {h}', { h: hhmm(r.to) }); };
    function render() {
      const ul = $('#refugeList'); ul.textContent = '';
      $('#refugeOpen').hidden = !list.length;
      for (const r of list) {
        const now = Date.now(), open = r.state !== 'closed' && r.to > now;
        const act = (label, fn, cls = 'ghost') => { const b = el('button', { type: 'button', class: cls }, label); b.onclick = fn; return b; };
        const setState = s => async () => { try { await orgaFetch(`/api/orga/refuges/${r.id}/state`, { method: 'POST', body: JSON.stringify({ state: s }) }); load(); } catch (err) { msg(err.message); } };
        const openOne = async () => { try { await orgaFetch('/api/orga/refuges/open', { method: 'POST', body: JSON.stringify({ ids: [r.id], ...slot() }) }); load(); } catch (err) { msg(err.message); } };
        const del = async () => { if (!confirmDel(r)) return; try { await orgaFetch('/api/orga/refuges/' + r.id, { method: 'DELETE' }); load(); } catch (err) { msg(err.message); } };
        ul.append(el('li', { class: 'refuge-item' + (open ? ' on' : '') },
          el('span', { class: 'refuge-dot', style: `background:${r.color}` }, r.glyph),
          el('div', { class: 'refuge-txt' }, el('b', {}, r.name), el('small', {}, state(r) + (r.addr ? ' · ' + r.addr : ''))),
          el('div', { class: 'refuge-acts' }, ...[
            open ? act(r.state === 'full' ? t('Plus complet') : t('Complet'), setState(r.state === 'full' ? 'open' : 'full')) : act(t('Ouvrir'), openOne, 'secondary'),
            open ? act(t('Fermer'), setState('closed')) : null,
            act(t('Modifier'), () => openForm(r)), act(t('Supprimer'), del, 'ghost danger-link')].filter(Boolean))));
      }
    }
    // Suppression : deux appuis (pas de fenêtre de confirmation du navigateur)
    const armed = new Set();
    function confirmDel(r) { if (armed.has(r.id)) { armed.delete(r.id); return true; } armed.add(r.id); msg(t('Appuie encore sur « Supprimer » pour retirer {name}.', { name: r.name })); setTimeout(() => armed.delete(r.id), 5000); return false; }
    $('#rfOpenAll').onclick = async () => {
      try { const d = await orgaFetch('/api/orga/refuges/open', { method: 'POST', body: JSON.stringify(slot()) }); msg(tn(d.n, '{n} lieu ouvert.', '{n} lieux ouverts.'));  load(); } catch (err) { msg(err.message); }
    };
    // Logo : redimensionné en PNG carré de 128 px sur le téléphone avant l'envoi
    function logoState(l) {
      $('#rfLogoImg').hidden = !l; if (l) $('#rfLogoImg').src = l.img;
      $('#rfLogoDel').hidden = !l;
      $('#rfLogoState').textContent = !l ? t('Facultatif. Il s’affiche au centre de tes lieux après validation par l’admin.')
        : l.status === 'ok' ? t('Logo validé : il s’affiche sur les lieux où tu l’as choisi.') : t('Logo envoyé : en attente de validation par l’admin.');
    }
    $('#rfLogoFile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(f); });
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const x = c.getContext('2d'), s = Math.max(128 / img.width, 128 / img.height);
        x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128);
        x.drawImage(img, (128 - img.width * s) / 2, (128 - img.height * s) / 2, img.width * s, img.height * s);
        URL.revokeObjectURL(img.src);
        const png = c.toDataURL('image/png');
        await orgaFetch('/api/orga/logo', { method: 'POST', body: JSON.stringify({ png }) });
        logoState({ status: 'pending', img: png });
      } catch (err) { msg(err.message || t('Image illisible.')); }
    };
    $('#rfLogoDel').onclick = async () => { try { await orgaFetch('/api/orga/logo', { method: 'DELETE' }); logoState(null); } catch (err) { msg(err.message); } };
    async function load() {
      box.hidden = !(orga && !orga.trial && !orga.admin);
      if (box.hidden) return;
      try { const d = await orgaFetch('/api/orga/refuges'); list = d.refuges || []; max = d.max || 1; $('#rfAdd').hidden = !form.hidden || !canAdd(); render(); logoState(d.logo); } catch (err) { msg(err.message); }
    }
    // Créneau proposé : maintenant jusqu'à 20 h (ou 4 h plus tard si c'est déjà le soir)
    { const now = Date.now(), end = at('20:00'); $('#rfFrom').value = hhmm(now); $('#rfTo').value = hhmm(end > now + 3600e3 ? end : now + 4 * 3600e3); }
    const prev = $('#btnOrga').onclick;
    $('#btnOrga').onclick = e => { prev && prev(e); closeForm(); load(); };
  }
