  // ---- Interpellation : prévenir un proche (le message part du téléphone, rien ne passe par le serveur) ----
  const sosGet = () => { try { return JSON.parse(localStorage.getItem('cortege-sos') || 'null'); } catch { return null; } };
  function sosMessage() {
    const who = document.querySelector('input[name="sosWho"]:checked').value;
    const hour = I18N.lang === 'fr' ? fmtHour(Date.now()).replace(':', ' h ') : fmtHour(Date.now());
    let s = t(who === 'me' ? 'Je viens d’être interpellé·e ({hour})' : 'Quelqu’un de mon groupe vient d’être interpellé·e ({hour})', { hour });
    if (me) { const la = me[0].toFixed(4), lo = me[1].toFixed(4); s += ' ' + t('ici : {url}', { url: `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}` }); }
    const legal = nearestLegal();
    s += '. ' + (legal && legal.d < 80000 ? t('Préviens la legal team : {phone} ({name}).', { phone: legal.phone, name: legal.name }) : t('Préviens la legal team de la manif.'));
    s += ' ' + t('Message envoyé avec Cortège.');
    return s;
  }
  function sosLink() {
    const c = sosGet(); if (!c) return;
    const num = c.phone.replace(/[^\d+]/g, '');
    $('#sosSms').href = `sms:${num}${isIOS ? '&' : '?'}body=${encodeURIComponent($('#sosMsg').value)}`;
  }
  function openSos() {
    closeReport(); closeSheets();
    const c = sosGet();
    $('#sosSetup').hidden = !!c; $('#sosReady').hidden = !c;
    if (c) { $('#sosTo').textContent = c.name || c.phone; $('#sosMsg').value = sosMessage(); sosLink(); }
    else { $('#sosName').value = ''; $('#sosPhone').value = ''; }
    $('#sheetSos').hidden = false;
  }
  $('#btnSos').onclick = openSos;
  $('#btnSosRights').onclick = openSos;
  $('#sosClose').onclick = () => closeSheets();
  $('#sosForm').addEventListener('submit', e => {
    e.preventDefault();
    const phone = $('#sosPhone').value.trim();
    if (phone.replace(/\D/g, '').length < 6) return toast('Numéro invalide.');
    try { localStorage.setItem('cortege-sos', JSON.stringify({ name: $('#sosName').value.trim().slice(0, 30), phone })); } catch { return toast('Impossible d’enregistrer sur ce téléphone.'); }
    toast('Contact enregistré sur ce téléphone'); openSos();
  });
  $('#sosEdit').onclick = () => { const c = sosGet() || {}; $('#sosSetup').hidden = false; $('#sosReady').hidden = true; $('#sosName').value = c.name || ''; $('#sosPhone').value = c.phone || ''; };
  $('#sosMsg').addEventListener('input', sosLink);
  document.querySelectorAll('input[name="sosWho"]').forEach(r => r.addEventListener('change', () => { $('#sosMsg').value = sosMessage(); sosLink(); }));
  $('#sosShare').onclick = () => {
    const text = $('#sosMsg').value;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('Message copié : colle-le dans ta messagerie'), () => toast(text));
  };

