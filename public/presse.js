'use strict';
// Espace presse : code d'intégration prêt à copier, adresse de contact lue dans la configuration de l'instance
(() => {
  const $ = s => document.querySelector(s);
  const code = `<iframe src="${location.origin}/embed.html?lat=43.611&lng=3.877&z=13" width="100%" height="480" style="border:0;border-radius:12px" loading="lazy" title="Cortège, carte en direct des manifs"></iframe>`;
  $('#embedCode').value = code;
  $('#copyEmbed').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); } catch { $('#embedCode').select(); document.execCommand('copy'); }
    $('#copyEmbed').textContent = 'Copié';
    setTimeout(() => { $('#copyEmbed').textContent = 'Copier le code'; }, 2000);
  });
  fetch('/api/config').then(r => r.json()).then(c => {
    if (!c.contact) return;
    $('#contactLink').href = 'mailto:' + c.contact + '?subject=' + encodeURIComponent('Cortège : demande presse');
    $('#contactLink').textContent = c.contact;
    $('#contactMail').hidden = false;
  }).catch(() => {});
})();
