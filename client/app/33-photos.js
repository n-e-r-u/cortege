  // ---- Photos d'un signalement (2.21) ----
  // Une photo passe toujours par le flouteur (/flouter?signalement=…) : visages masqués et métadonnées retirées sur le téléphone.
  // Publique quand le point est vérifié par une orga ou vient d'un téléphone fiable ; avant, seulement les orgas et l'admin.
  const PHOTO_MAX = 3;
  const photoUrls = new Map(); // photos vues par une orga (avec sa clé) : une seule copie locale par photo, gardée le temps de la session
  async function photoBlob(id) {
    if (photoUrls.has(id)) return photoUrls.get(id);
    const res = await fetch('/api/photos/' + id, { headers: { 'X-Orga-Key': orgaKey() } });
    if (!res.ok) throw new Error(res.status);
    const url = URL.createObjectURL(await res.blob());
    photoUrls.set(id, url);
    return url;
  }
  async function photoAct(id, act) {
    try {
      const res = await fetch(`/api/photos/${id}/${act}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': DEVICE, ...(act !== 'flag' ? { 'X-Orga-Key': orgaKey() } : {}) }, body: '{}' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return toast(body.error || 'Envoi impossible.');
      toast(act === 'flag' ? (body.hidden ? 'Photo signalée : elle est cachée en attendant une orga.' : 'Photo signalée, merci.') : act === 'remove' ? 'Photo retirée' : 'Photo remise');
      if (act !== 'flag') { const u = photoUrls.get(id); if (u) { URL.revokeObjectURL(u); photoUrls.delete(id); } }
      sync();
    } catch { toast('Pas de réseau.'); }
  }
  function photoBlock(r) {
    const list = r.ph || [], box = el('div', { class: 'pop-photos' });
    for (const p of list) {
      const fig = el('figure', { class: 'pop-photo' + (p.f ? ' flagged' : '') });
      if (p.p) {
        const img = el('img', { src: '/api/photos/' + p.id, alt: t('Photo du signalement'), loading: 'lazy' });
        fig.append(el('a', { href: '/api/photos/' + p.id, target: '_blank', rel: 'noopener' }, img));
      } else if (orga) {
        const img = el('img', { alt: t('Photo du signalement') });
        photoBlob(p.id).then(u => { img.src = u; }).catch(() => { img.replaceWith(el('span', { class: 'fine' }, t('Photo indisponible.'))); });
        fig.append(img, el('figcaption', { class: 'fine' }, t(p.f ? 'Cachée au public après des signalements.' : 'Visible du public quand le point sera vérifié.')));
      } else {
        fig.append(el('figcaption', { class: 'fine' }, '📷 ' + t(p.f ? 'Photo cachée après des signalements.' : 'Photo visible quand une orga aura vérifié le point.')));
      }
      const acts = el('div', { class: 'pop-photo-acts' });
      if (p.p) { const fl = el('button', { type: 'button', class: 'link-btn' }, t('Signaler la photo')); fl.onclick = () => { fl.disabled = true; photoAct(p.id, 'flag'); }; acts.append(fl); }
      if (orga) {
        if (p.f) { const rs = el('button', { type: 'button', class: 'link-btn' }, t('Remettre')); rs.onclick = () => photoAct(p.id, 'restore'); acts.append(rs); }
        const rm = el('button', { type: 'button', class: 'link-btn danger-link' }, t('Retirer la photo'));
        rm.onclick = () => { if (rm.dataset.armed) photoAct(p.id, 'remove'); else { rm.dataset.armed = '1'; rm.textContent = t('Confirmer le retrait'); } };
        acts.append(rm);
      }
      if (acts.childNodes.length) fig.append(acts);
      box.append(fig);
    }
    if (list.length < PHOTO_MAX && r.cat !== 'contact') box.append(el('a', { class: 'link-btn pop-add', href: '/flouter?signalement=' + encodeURIComponent(r.id) }, '📷 ' + t('Ajouter une photo (visages masqués)')));
    return box;
  }
  // Retour du flouteur (/?point=…&photo=…) : la carte s'ouvre sur le point, avec un mot sur la photo envoyée
  {
    const qs = new URLSearchParams(location.search), id = qs.get('point'), sent = qs.get('photo');
    if (id && /^[\w-]{1,16}$/.test(id)) {
      history.replaceState(null, '', location.pathname);
      if (sent) toast(sent === 'pub' ? 'Photo envoyée.' : 'Photo envoyée : visible quand une orga aura vérifié le point.');
      let tries = 0;
      const open = () => {
        const x = reports.get(id);
        if (x) { setFollow(false); map.setView([x.data.lat, x.data.lng], Math.max(map.getZoom(), 18)); setTimeout(() => x.marker.openPopup(), 300); return; }
        if (++tries < 30) setTimeout(open, 500);
      };
      setTimeout(open, 500);
    }
  }
