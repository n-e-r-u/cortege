'use strict';
// Affiche A4 : QR code de l'appli + numéros de legal team d'une ville (annuaire vérifié et numéros publiés par les orgas)
(async () => {
  const $ = s => document.querySelector(s);
  const norm = c => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const url = location.origin + '/';
  $('#url').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true }); }
  const get = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [cfg, legal, ann] = await Promise.all([get('/api/config'), get('/live/legal.json'), get('/live/ann.json')]);
  if (cfg && cfg.brand && cfg.brand.handle) { $('#by').textContent = 'La carte en direct des manifs · par @' + cfg.brand.handle; $('#handle').innerHTML = ''; const b = document.createElement('b'); b.textContent = '@' + cfg.brand.handle; $('#handle').append(b); }
  const rows = [...((legal && legal.l) || []).map(e => ({ city: e.city, name: e.name, phone: e.phone })),
    ...((ann && ann.a) || []).filter(a => a.kind === 'legal' && a.city).map(a => ({ city: a.city, name: a.by, phone: a.phone }))];
  const cities = new Map(); for (const r of rows) { const k = norm(r.city); if (!cities.has(k)) cities.set(k, { name: r.city, items: [] }); cities.get(k).items.push(r); }
  const sel = $('#city');
  [...cities.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'fr')).forEach(([k, c]) => { const o = document.createElement('option'); o.value = k; o.textContent = c.name; sel.append(o); });
  const want = norm(new URLSearchParams(location.search).get('ville'));
  if (want && cities.has(want)) sel.value = want;
  function render() {
    const c = cities.get(sel.value), extra = $('#extra').value.trim(), list = $('#legalList');
    list.textContent = '';
    const items = c ? c.items.slice(0, 3) : [];
    for (const it of items) {
      const who = document.createElement('div'); who.className = 'who'; who.textContent = it.name;
      const n = document.createElement('div'); n.className = 'n'; n.textContent = it.phone;
      list.append(n, who);
    }
    if (extra) { const n = document.createElement('div'); n.className = 'who'; n.style.fontSize = '6mm'; n.style.color = '#121214'; n.textContent = extra; list.append(n); }
    $('#legal').hidden = !items.length && !extra;
    $('#legalTitle').textContent = c ? 'Legal team · ' + c.name : 'Legal team';
    document.title = 'Affiche Cortège' + (c ? ' · ' + c.name : '');
  }
  sel.onchange = render; $('#extra').oninput = render; render();
  $('#print').onclick = () => window.print();
})();
