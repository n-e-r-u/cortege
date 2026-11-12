  // ---- Utilitaires ----
  const ago = x => { const m = Math.round((Date.now() - x) / MIN); return m < 1 ? t('à l’instant') : t('il y a {m} min', { m }); };
  const left = exp => { const m = Math.max(0, Math.round((exp - Date.now()) / MIN)); return t('{m} min', { m }); };
  const dist = (a, b) => map.distance(a, b);
  // Distances : mètres et kilomètres, ou pieds et miles selon le pays (profil)
  const fmtDist = m => profile.units === 'imperial'
    ? (m < 160 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${(m / 1609.34).toFixed(1)} mi`)
    : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  // QR codes : la bibliothèque (57 Ko) n'est chargée qu'au premier QR code affiché ; elle est dans le cache hors ligne
  const qrSvg = (url, cellSize) => (window.qrcode ? Promise.resolve() : (qrSvg.p ||= new Promise((ok, ko) => {
    const sc = document.createElement('script'); sc.src = '/vendor/qrcode.js'; sc.onload = ok; sc.onerror = () => { qrSvg.p = null; ko(new Error('qrcode')); }; document.head.append(sc);
  }))).then(() => { const q = qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize, margin: 3, scalable: true }); });
  function toast(msg) {
    const el = $('#toast'); el.textContent = t(msg); el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
  }
  // Les textes simples (enfants, placeholder, aria-label, title) sont traduits au passage
  const TR_ATTRS = new Set(['placeholder', 'aria-label', 'title']);
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === 'style' ? n.style.cssText = v : n.setAttribute(k, TR_ATTRS.has(k) ? t(v) : v);
    for (const k of kids) n.append(typeof k === 'string' ? t(k) : k);
    return n;
  }

