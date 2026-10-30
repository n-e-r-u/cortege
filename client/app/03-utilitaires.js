  // ---- Utilitaires ----
  const ago = x => { const m = Math.round((Date.now() - x) / MIN); return m < 1 ? t('à l’instant') : t('il y a {m} min', { m }); };
  const left = exp => { const m = Math.max(0, Math.round((exp - Date.now()) / MIN)); return t('{m} min', { m }); };
  const dist = (a, b) => map.distance(a, b);
  const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
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

