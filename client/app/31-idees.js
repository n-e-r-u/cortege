  // ---- Boîte à idées (Plus › Idées) : proposer une amélioration, voter, suivre ce qui est fait ----
  // Vote pour ou contre, classement au solde. Idées mises au vote par l'admin : rond 💡 sur la carte, avec une pastille du nombre d'idées pas encore votées
  var syncIdeas = null;
  {
    const STATUS = { proposed: ['💬', t('Proposée')], study: ['🔎', t('À l’étude')], planned: ['🗓', t('Prévue')], done: ['✅', t('Faite')], no: ['✖', t('Pas retenue')] };
    let view = 'top', ideas = [], busy = false;
    const msg = s => { $('#ideaMsg').textContent = s || ''; };
    const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE, ...(opts.headers || {}) } })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || t('Pas de connexion.')); return j; });
    function card(i) {
      const [ic, lab] = STATUS[i.status] || STATUS.proposed;
      const open = i.status !== 'done' && i.status !== 'no';
      // Pour ou contre : un appui sur le vote déjà choisi le retire, l'autre bouton change d'avis
      const my = i.my ?? (i.voted ? 1 : 0);
      const btn = (v, glyph, n, on, off) => {
        const b = el('button', { type: 'button', class: 'idea-vote ' + (v > 0 ? 'up' : 'down') + (my === v ? ' on' : ''), 'aria-pressed': String(my === v) },
          el('span', { 'aria-hidden': 'true' }, glyph), el('b', {}, String(n)));
        b.disabled = !open;
        b.setAttribute('aria-label', (v > 0 ? tn(n, '{n} pour', '{n} pour') : tn(n, '{n} contre', '{n} contre')) + (open ? ' · ' + (my === v ? off : on) : ''));
        if (open) b.onclick = async () => {
          if (busy) return; busy = true;
          try { const d = await api(`/api/ideas/${i.id}/vote`, { method: 'POST', body: JSON.stringify({ v: my === v ? 0 : v }) }); i.my = d.my ?? (d.voted ? 1 : 0); i.votes = d.votes; i.down = d.down ?? i.down; render(); if (i.feat) refreshBadge(); }
          catch (e) { msg(e.message); } finally { busy = false; }
        };
        return b;
      };
      const vote = el('div', { class: 'idea-votes', role: 'group', 'aria-label': t('Ton avis') },
        btn(1, '👍', i.votes, t('Je veux ça'), t('Retirer mon vote')), btn(-1, '👎', i.down || 0, t('Je suis contre'), t('Retirer mon vote')));
      const meta = [ic + ' ' + lab + (i.version && (i.status === 'planned' || i.status === 'done') ? ' · ' + i.version : ''), i.lang && i.lang !== I18N.lang ? i.lang.toUpperCase() : ''].filter(Boolean).join(' · ');
      const body = el('div', { class: 'idea-txt' });
      if (i.feat && open) body.append(el('span', { class: 'idea-feat' }, '🗳 ' + t('Au vote en ce moment')));
      body.append(el('b', { lang: i.lang || 'fr' }, i.title));
      if (i.body) body.append(el('p', { lang: i.lang || 'fr' }, i.body));
      body.append(el('small', {}, meta));
      if (i.reply) body.append(el('p', { class: 'idea-reply' }, '↳ ' + i.reply));
      return el('li', { class: 'idea st-' + i.status + (i.feat && open ? ' feat' : '') }, vote, body);
    }
    function render() {
      const ul = $('#ideaList'); ul.textContent = '';
      if (!ideas.length) ul.append(el('li', { class: 'idea-empty' }, view === 'done' ? t('Rien de terminé pour l’instant.') : view === 'no' ? t('Aucune idée écartée.') : t('Pas encore d’idée publiée. Lance-toi !')));
      for (const i of ideas) ul.append(card(i));
    }
    async function load() {
      msg('');
      try { ideas = (await api('/api/ideas?v=' + view)).ideas || []; render(); }
      catch (e) { $('#ideaList').textContent = ''; msg(e.message); }
    }
    document.querySelectorAll('.idea-tabs [role="tab"]').forEach(b => {
      b.onclick = () => { view = b.dataset.v; document.querySelectorAll('.idea-tabs [role="tab"]').forEach(x => x.setAttribute('aria-selected', String(x === b))); load(); };
    });
    // Idées proches de ce qu'on tape (mots en commun), pour voter plutôt que créer un doublon
    const words = s => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 3));
    let pool = [];
    $('#ideaTitle').oninput = () => {
      const w = words($('#ideaTitle').value), ul = $('#ideaSimilarList'); ul.textContent = '';
      const near = w.size ? pool.map(i => [i, [...words(i.title + ' ' + (i.body || ''))].filter(x => w.has(x)).length]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
      $('#ideaSimilar').hidden = !near.length;
      for (const [i] of near) {
        const b = el('button', { type: 'button', class: 'idea-near' }, i.title + ' (' + tn(i.votes, '{n} vote', '{n} votes') + ')');
        b.onclick = () => { closeForm(); view = 'top'; document.querySelectorAll('.idea-tabs [role="tab"]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.v === 'top'))); load().then(() => document.querySelector('.idea-list .idea')?.scrollIntoView({ block: 'center' })); };
        ul.append(el('li', {}, b));
      }
    };
    function closeForm() { $('#ideaForm').hidden = true; $('#ideaNew').hidden = false; }
    $('#ideaNew').onclick = async () => {
      $('#ideaForm').hidden = false; $('#ideaNew').hidden = true; $('#ideaTitle').value = ''; $('#ideaBody').value = ''; $('#ideaSimilar').hidden = true; msg('');
      $('#ideaTitle').focus();
      try { pool = (await api('/api/ideas?v=top')).ideas || []; } catch { pool = []; }
    };
    $('#ideaCancel').onclick = closeForm;
    $('#ideaForm').onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/api/ideas', { method: 'POST', body: JSON.stringify({ title: $('#ideaTitle').value, body: $('#ideaBody').value, lang: I18N.lang }) });
        closeForm(); msg(t('Merci ! Ton idée sera publiée après relecture.'));
      } catch (err) { msg(err.message); }
    };
    const openIdeas = () => { closeReport(); closeSheets(); $('#sheetIdeas').hidden = false; closeForm();
      view = 'top'; document.querySelectorAll('.idea-tabs [role="tab"]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.v === 'top'))); load(); };
    $('#btnIdeas').onclick = openIdeas;
    $('#btnIdeaVote').onclick = openIdeas;
    // Rond 💡 : visible tant qu'au moins une idée est au vote ; pastille = celles pour lesquelles ce téléphone n'a pas voté
    let ideasH = null;
    async function refreshBadge() {
      try {
        const list = (await api('/api/ideas?v=vote')).ideas || [], left = list.filter(i => !(i.my || i.voted)).length;
        $('#btnIdeaVote').hidden = !list.length;
        $('#ideaBadgeMap').hidden = !left; $('#ideaBadgeMap').textContent = left > 9 ? '9+' : String(left);
        $('#btnIdeaVote').setAttribute('aria-label', list.length ? tn(left, '{n} idée à voter', '{n} idées à voter') : t('Idées au vote'));
      } catch {}
    }
    syncIdeas = h => {
      if (!h) { ideasH = null; $('#btnIdeaVote').hidden = true; return; }
      if (h === ideasH) return;
      ideasH = h; refreshBadge();
    };
    $('#idClose').onclick = () => closeSheets();
  }
