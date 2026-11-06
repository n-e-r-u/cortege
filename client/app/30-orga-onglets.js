  // ---- Espace orga : 4 onglets (Annonces, Terrain, Réseau, Mon orga) au lieu d'une longue page ----
  // Le dernier onglet ouvert est gardé sur le téléphone. Pastilles : vert sur « Terrain » quand ta position
  // ou ton lieu de repli est en ligne, « ! » sur « Mon orga » tant qu'un seul appareil a l'accès.
  {
    const tabs = [...document.querySelectorAll('.orga-tabs [role="tab"]')], KEY = 'cortege-orga-tab';
    const panes = Object.fromEntries(tabs.map(b => [b.dataset.pane, $('#opane-' + b.dataset.pane)]));
    let cur = 'ann';
    try { cur = localStorage.getItem(KEY) || 'ann'; } catch {}
    function show(name, focus) {
      if (!panes[name]) name = 'ann';
      cur = name; try { localStorage.setItem(KEY, name); } catch {}
      for (const b of tabs) { const on = b.dataset.pane === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
      for (const [k, p] of Object.entries(panes)) p.hidden = k !== name;
      $('#sheetOrga').scrollTop = 0;
    }
    tabs.forEach((b, i) => {
      b.onclick = () => show(b.dataset.pane);
      b.onkeydown = e => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
        e.preventDefault(); const rtl = document.dir === 'rtl' ? -1 : 1;
        show(tabs[(i + d * rtl + tabs.length) % tabs.length].dataset.pane, true);
      };
    });
    // Statut de l'orga, invitations réservées aux orgas certifiées, pastilles
    function status() {
      if (!orga) return;
      $('#orgaStatusName').textContent = orga.label;
      $('#orgaStatusChip').textContent = orga.admin ? t('Admin') : orga.trial ? (orga.sponsored ? t('Parrainée, en essai') : t('En essai')) : t('Orga certifiée');
      $('#orgaStatusChip').dataset.k = orga.admin ? 'admin' : orga.trial ? 'trial' : 'ok';
      $('#orgaInviteOff').hidden = !$('#orgaInviteBox').hidden || !!orga.admin;
      const live = !!beacon || [...document.querySelectorAll('#refugeList .refuge-item.on')].length > 0;
      $('#otab-terrain').classList.toggle('dot-live', live);
      $('#otab-compte').classList.toggle('dot-warn', !orga.admin && !!orga.canAddDevice && (orga.devices || 1) < 2);
    }
    for (const id of ['#deviceState', '#refugeList', '#bkState']) new MutationObserver(status).observe($(id), { childList: true, subtree: true, characterData: true });
    new MutationObserver(status).observe($('#orgaInviteBox'), { attributes: true, attributeFilter: ['hidden'] });
    const prev = $('#btnOrga').onclick;
    $('#btnOrga').onclick = e => { prev && prev(e); let c = cur; try { c = localStorage.getItem(KEY) || cur; } catch {} show(c); status(); };
    show(cur);
  }
