  // ---- Boîte à idées (Plus › Idées) ----
  // La fiche et son script (public/app-idees.js, client/parts/idees.js) sont chargés à la première ouverture. Ici : le rond 💡 de la
  // carte, visible tant que l'admin a mis des idées au vote, avec une pastille du nombre d'idées pas encore votées.
  var syncIdeas = null;
  {
    const api = (url, opts = {}) => fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE, ...(opts.headers || {}) } })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || t('Pas de connexion.')); return j; });
    const openIdeas = focus => loadPart('idees', () => ({ $, el, t, tn, I18N, closeReport, closeSheets, addSheet, api, refreshBadge }))
      .then(m => m.open(focus)).catch(() => toast('Pas de réseau : les idées se chargeront quand ça capte.'));
    $('#btnIdeas').onclick = () => openIdeas();
    $('#btnIdeaVote').onclick = () => openIdeas();
    { const id = new URLSearchParams(location.search).get('idee');
      if (id && /^[\w-]{1,16}$/.test(id)) { history.replaceState(null, '', location.pathname); setTimeout(() => openIdeas(id), 800); } }
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
  }
