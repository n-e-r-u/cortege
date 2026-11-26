  // ---- Bandeau de situation : un seul en haut de la carte ----
  // Six bandeaux pouvaient s'empiler (alerte de proximité, réseau, pause des signalements, arrêtés, annonces d'orga,
  // Play Store) et réduire la carte à une bande. On n'affiche que le plus important ; un bouton « + n » déplie les autres.
  // Chaque bandeau garde son code et son apparence : ce fichier ne fait que choisir celui qui se voit.
  {
    const box = $('#overlays');
    // Du plus urgent au moins urgent : un danger tout près, puis ce qui fausse ce qu'on voit (réseau, pause),
    // puis ce qui concerne le lieu (arrêté), puis les orgas, puis l'appli elle-même.
    const ORDER = ['#alert', '#netBar', '#pauseBanner', '#ordBar', '#anns', '#testBand'];
    const count = n => (n.id === 'anns' ? n.querySelectorAll('.ann').length : 1);
    const live = () => ORDER.map(s => $(s)).filter(n => n && !n.hidden && count(n) > 0);
    const more = el('button', { type: 'button', class: 'ov-more', hidden: '', 'aria-expanded': 'false' });
    more.onclick = () => { box.classList.toggle('open'); restack(); };
    let lastTop = null;
    // L'observateur est coupé le temps de ranger : sinon nos propres changements le relanceraient sans fin
    const obs = new MutationObserver(() => restack());
    const watch = () => obs.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    function restack() {
      obs.disconnect();
      try {
        const list = live();
        const top = list[0] || null;
        // Un danger qui arrive reprend la main : la pile se referme pour qu'il soit seul à l'écran
        if (top && top.id === 'alert' && lastTop !== top) box.classList.remove('open');
        lastTop = top;
        const open = box.classList.contains('open');
        for (const n of ORDER.map(s => $(s))) if (n) n.classList.toggle('ov-stacked', !open && n !== top);
        const extra = list.reduce((n, x) => n + count(x), 0) - 1;
        const label = open ? t('Replier') : tn(extra, '+ {n} autre', '+ {n} autres');
        if (more.hidden !== extra < 1) more.hidden = extra < 1;
        if (more.textContent !== label) more.textContent = label;
        if (more.getAttribute('aria-expanded') !== String(open)) more.setAttribute('aria-expanded', String(open));
        const aria = open ? t('Replier les bandeaux') : t('Voir les autres bandeaux');
        if (more.getAttribute('aria-label') !== aria) more.setAttribute('aria-label', aria);
        if (box.lastElementChild !== more) box.append(more);  // toujours en dernier, même après l'ajout d'un bandeau
      } finally { obs.takeRecords(); watch(); }
    }
    restack();
  }
