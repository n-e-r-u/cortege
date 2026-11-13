'use strict';
// Affiche A4 : QR code de l'appli + numéros de legal team d'une ville (annuaire vérifié et numéros publiés par les orgas)
(async () => {
  const $ = s => document.querySelector(s);
  const norm = c => String(c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Paramètres : ?ville=… (legal team), ?orga=… (nom de l'orga), ?rdv=… (ligne du rendez-vous), ?at=lat,lng (le QR code ouvre la carte à cet endroit)
  const P = new URLSearchParams(location.search);
  const at = (P.get('at') || '').match(/^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/);
  const url = location.origin + '/' + (at ? '?at=' + at[1] + ',' + at[2] : '');
  $('#url').textContent = location.host;
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true }); }
  $('#orga').value = (P.get('orga') || '').slice(0, 50); $('#rdv').value = (P.get('rdv') || '').slice(0, 90);
  const get = u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [cfg, legal, ann] = await Promise.all([get('/api/config'), get('/live/legal.json'), get('/live/ann.json')]);
  if (cfg && cfg.brand && cfg.brand.handle) { $('#by').textContent = 'La carte en direct des manifs · par @' + cfg.brand.handle; $('#handle').innerHTML = ''; const b = document.createElement('b'); b.textContent = '@' + cfg.brand.handle; $('#handle').append(b); }
  const rows = [...((legal && legal.l) || []).map(e => ({ city: e.city, name: e.name, phone: e.phone })),
    ...((ann && ann.a) || []).filter(a => a.kind === 'legal' && a.city).map(a => ({ city: a.city, name: a.by, phone: a.phone }))];
  const cities = new Map(); for (const r of rows) { const k = norm(r.city); if (!cities.has(k)) cities.set(k, { name: r.city, items: [] }); cities.get(k).items.push(r); }
  const sel = $('#city');
  [...cities.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'fr')).forEach(([k, c]) => { const o = document.createElement('option'); o.value = k; o.textContent = c.name; sel.append(o); });
  const want = norm(P.get('ville'));
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
    if (extra) { const n = document.createElement('div'); n.className = 'who'; n.style.fontSize = '6mm'; n.style.color = '#1c2156'; n.textContent = extra; list.append(n); }
    $('#legal').hidden = !items.length && !extra;
    $('#legalTitle').textContent = c ? 'Legal team · ' + c.name : 'Legal team';
    document.title = 'Affiche Cortège' + (c ? ' · ' + c.name : '');
    const orga = $('#orga').value.trim(), rdv = $('#rdv').value.trim();
    $('#rdvLine').hidden = !rdv; $('#rdvLine').textContent = rdv;
    const w = $('#with'); w.textContent = '';
    if (orga) { const b = document.createElement('span'); b.className = 'with'; b.textContent = orga; w.append(' · avec ', b); }
    // Flyers : quatre copies de l'affiche, réduites de moitié, sur une même page
    const out = $('#out'), sheet = $('#sheet');
    out.querySelector('.page4')?.remove();
    const a6 = $('#format').value === 'a6';
    sheet.hidden = a6;
    if (a6) {
      const page = document.createElement('div'); page.className = 'page4';
      for (let i = 0; i < 4; i++) { const k = sheet.cloneNode(true); k.hidden = false; k.removeAttribute('id'); k.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); page.append(k); }
      out.append(page);
    }
  }
  sel.onchange = render; for (const id of ['#extra', '#orga', '#rdv']) $(id).oninput = render; $('#format').onchange = render; render();
  $('#print').onclick = () => window.print();
})();
