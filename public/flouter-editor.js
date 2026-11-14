'use strict';
// Flouteur : éditeur des masques, par-dessus l'aperçu de la photo (flouter.js). Il ne connaît ni les photos ni la traduction :
// la page lui donne sa zone, ses outils et le libellé de chaque masque. Rectangles : flouter-lib.js.
(() => {
  const { clampRectToImage } = window.cortegeFlouteur;
  const TAP_TOLERANCE = 10, MAX_ZOOM = 5, ZOOM_STEP = 1.5, MIN_MASK_SIDE = 8;
  // Masque ajouté à la main : 15 % du petit côté de l'image. « Agrandir » multiplie ses côtés par 1,15, « Réduire » les divise
  // (l'un défait l'autre). Au clavier, un pas fait 1 % du grand côté de l'image.
  const NEW_MASK_RATIO = 0.15, RESIZE_FACTOR = 1.15, KEY_STEP_RATIO = 0.01;
  // Débord de la poignée (44 px) hors du coin du masque, en px (voir .mask-handle dans flouter.html)
  const HANDLE_OVERHANG = 36;
  const ARROWS = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  const sameRect = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  // Redimensionne en déplaçant le coin tenu par la poignée, le coin opposé restant fixe
  function resizeFromCorner(m, corner, dx, dy) {
    const axis = (start, length, d, side) => {
      if (side !== 'start') return { start, length: Math.max(MIN_MASK_SIDE, length + d) };
      const s = Math.min(start + d, start + length - MIN_MASK_SIDE);
      return { start: s, length: start + length - s };
    };
    const h = axis(m.x, m.width, dx, corner.x), v = axis(m.y, m.height, dy, corner.y);
    return { x: h.start, y: v.start, width: h.length, height: v.length };
  }

  // Par-dessus l'aperçu : toucher une zone vide ajoute un masque, toucher un masque le retire, le glisser le déplace, sa poignée
  // le redimensionne, deux doigts zooment. Sans geste : boutons de zoom et de taille, et clavier sur les masques (un seul arrêt
  // de tabulation, flèches entre masques). Masques en pixels de l'original. maskLabel(n) : nom du n-ième masque (dès 1).
  // onChange(masques, { kind: 'ajout' | 'retrait' | 'modification', maskIndex }) : une modification, à garder pour l'annulation
  // (maskIndex : dans la nouvelle liste pour un ajout, dans l'ancienne sinon) ; onState : zoom ou masque actif changé.
  function createMaskEditor({ stage, content, layer, toolbar, maskLabel }, onChange, onState) {
    let masks = [], imgW = 0, imgH = 0, zoom = 1, pan = { x: 0, y: 0 }, finalPreview = false, clickSuppressed = false;
    // Dernier masque ajouté, déplacé, redimensionné ou ciblé au clavier : seul à montrer sa poignée et à recevoir la tabulation
    let active = null;
    // idle | press { maskIndex, corner, startMask, dragging } | pinch { startDistance, startZoom, anchor }
    let gesture = { kind: 'idle' };
    const pointers = new Map();
    const copy = list => list.map(m => ({ ...m }));
    const keepInside = m => ({ ...m, x: Math.min(Math.max(m.x, 0), Math.max(0, imgW - m.width)), y: Math.min(Math.max(m.y, 0), Math.max(0, imgH - m.height)) });

    function commit(change) { render(); onChange(copy(masks), change); }
    function setActive(i) { if (i === active) return; active = i; render(); onState(); }
    function addAt(x, y) {
      const side = Math.max(MIN_MASK_SIDE, Math.min(imgW, imgH) * NEW_MASK_RATIO);
      masks.push(clampRectToImage({ x: x - side / 2, y: y - side / 2, width: side, height: side }, imgW, imgH));
      active = masks.length - 1;
      commit({ kind: 'ajout', maskIndex: active });
    }
    function remove(i) {
      masks.splice(i, 1);
      if (active === i) active = null; else if (active !== null && active > i) active--;
      commit({ kind: 'retrait', maskIndex: i });
    }
    // Au clavier, le focus passe au masque suivant pour enchaîner, ou aux outils s'il n'en reste plus
    function removeFromKeyboard(i) { remove(i); if (masks.length) focusMask(Math.min(i, masks.length - 1)); else focusToolbar(); }
    // Remplace un masque et le garde en vue ; rien n'est enregistré s'il n'a pas changé (contre un bord, par exemple)
    function update(i, m) {
      if (sameRect(m, masks[i])) return;
      masks[i] = m; active = i;
      if (zoom > 1) centerView(maskCenter(m));
      commit({ kind: 'modification', maskIndex: i });
    }
    function resize(i, f) {
      const m = masks[i], width = Math.max(MIN_MASK_SIDE, m.width * f), height = Math.max(MIN_MASK_SIDE, m.height * f);
      update(i, clampRectToImage({ x: m.x + (m.width - width) / 2, y: m.y + (m.height - height) / 2, width, height }, imgW, imgH));
    }
    function move(i, d) {
      const step = Math.max(imgW, imgH) * KEY_STEP_RATIO, m = masks[i];
      update(i, keepInside({ ...m, x: m.x + d.x * step, y: m.y + d.y * step }));
    }
    // Passe au masque voulu (sans boucler) et, si l'image est zoomée, le ramène au centre de la vue
    function focusMask(i) {
      const button = layer.children[i]?.querySelector('button');
      if (!button) return;
      setActive(i);
      if (zoom > 1) centerView(maskCenter(masks[i]));
      button.focus();
    }
    const focusToolbar = () => toolbar.querySelector('button:not(:disabled)')?.focus();

    // ---- Zoom (le contenu est agrandi et décalé, la zone tactile reste fixe) ----
    const stagePoint = p => { const r = stage.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; };
    // Centre de la zone visible, en px du contenu non zoomé
    const viewCenter = () => ({ x: (stage.clientWidth / 2 - pan.x) / zoom, y: (stage.clientHeight / 2 - pan.y) / zoom });
    const maskCenter = m => ({ x: (m.x + m.width / 2) / imgW * stage.clientWidth, y: (m.y + m.height / 2) / imgH * stage.clientHeight });
    function applyTransform() {
      pan = { x: Math.min(0, Math.max(stage.clientWidth * (1 - zoom), pan.x)), y: Math.min(0, Math.max(stage.clientHeight * (1 - zoom), pan.y)) };
      content.style.transform = zoom === 1 ? '' : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      onState();
    }
    // Amène ce point du contenu non zoomé au centre de la vue, autant que les bords de l'image le permettent
    function centerView(p) { pan = { x: stage.clientWidth / 2 - p.x * zoom, y: stage.clientHeight / 2 - p.y * zoom }; applyTransform(); }
    // Zoom autour du masque actif, sinon du centre de la vue
    function zoomTo(z) { const anchor = active === null ? viewCenter() : maskCenter(masks[active]); zoom = Math.min(MAX_ZOOM, Math.max(1, z)); centerView(anchor); }
    function resetZoom() { zoom = 1; pan = { x: 0, y: 0 }; applyTransform(); }
    function panBy(dx, dy) { if (zoom === 1) return; pan = { x: pan.x + dx, y: pan.y + dy }; applyTransform(); }
    const twoFingers = () => { const [a, b] = [...pointers.values()].map(stagePoint); return { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; };
    function startPinch() {
      const { distance, mid } = twoFingers();
      // Le premier doigt avait commencé à déplacer un masque : il revient à sa place
      if (gesture.kind === 'press' && gesture.maskIndex !== null) { masks[gesture.maskIndex] = gesture.startMask; render(); }
      gesture = { kind: 'pinch', startDistance: Math.max(1, distance), startZoom: zoom, anchor: { x: (mid.x - pan.x) / zoom, y: (mid.y - pan.y) / zoom } };
    }
    function updatePinch() {
      if (pointers.size < 2) return;
      const { distance, mid } = twoFingers();
      zoom = Math.min(MAX_ZOOM, Math.max(1, gesture.startZoom * distance / gesture.startDistance));
      pan = { x: mid.x - gesture.anchor.x * zoom, y: mid.y - gesture.anchor.y * zoom };
      applyTransform();
    }

    // ---- Gestes ----
    stage.addEventListener('pointerdown', e => {
      if (!pointers.size) clickSuppressed = false;
      pointers.set(e.pointerId, { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY });
      if (pointers.size === 2) return startPinch();
      if (pointers.size > 2) return;
      const el = e.target.closest('[data-mask-index]'), i = el ? +el.dataset.maskIndex : null;
      gesture = { kind: 'press', maskIndex: i, corner: el && e.target.closest('[data-resize-handle]') ? { x: el.dataset.handleX, y: el.dataset.handleY } : null,
        startMask: i === null ? null : { ...masks[i] }, dragging: false };
    });
    stage.addEventListener('pointermove', e => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const stepX = e.clientX - p.x, stepY = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (gesture.kind === 'pinch') return updatePinch();
      if (gesture.kind !== 'press') return;
      const dx = p.x - p.startX, dy = p.y - p.startY;
      if (!gesture.dragging) {
        if (Math.hypot(dx, dy) < TAP_TOLERANCE) return;
        gesture.dragging = true;
        stage.setPointerCapture(e.pointerId);
        if (gesture.maskIndex !== null) setActive(gesture.maskIndex);
      }
      const { maskIndex: i, startMask: s, corner } = gesture;
      if (i === null) return panBy(stepX, stepY);
      const scale = imgW / content.getBoundingClientRect().width, ix = dx * scale, iy = dy * scale;
      masks[i] = corner ? clampRectToImage(resizeFromCorner(s, corner, ix, iy), imgW, imgH) : keepInside({ ...s, x: s.x + ix, y: s.y + iy });
      render();
    });
    const pointerEnd = e => {
      if (!pointers.delete(e.pointerId)) return;
      const g = gesture;
      if (pointers.size) {
        // Fin d'un pincement : le doigt restant fait défiler, il ne doit ni ajouter ni retirer de masque
        if (g.kind === 'pinch') gesture = { kind: 'press', maskIndex: null, corner: null, startMask: null, dragging: true };
        return;
      }
      gesture = { kind: 'idle' };
      if (g.kind === 'pinch' || (g.kind === 'press' && g.dragging)) clickSuppressed = true;
      if (g.kind === 'press' && g.dragging && g.maskIndex !== null && !sameRect(g.startMask, masks[g.maskIndex])) commit({ kind: 'modification', maskIndex: g.maskIndex });
    };
    stage.addEventListener('pointerup', pointerEnd);
    stage.addEventListener('pointercancel', pointerEnd);
    // Ajout et retrait passent par click, émis après le relâchement : ajouter au pointerup placerait le nouveau masque sous le
    // doigt, et le click qui suit le toucher le retirerait aussitôt. Entrée ou Espace sur un masque le retire aussi.
    layer.addEventListener('click', e => {
      const keyboard = e.detail === 0; // un clic au clavier n'est jamais la fin d'un glissé
      if (clickSuppressed && !keyboard) { clickSuppressed = false; return; }
      if (!imgW || e.target.closest('[data-resize-handle]')) return;
      const el = e.target.closest('[data-mask-index]');
      if (el) return keyboard ? removeFromKeyboard(+el.dataset.maskIndex) : remove(+el.dataset.maskIndex);
      const r = content.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * imgW, y = (e.clientY - r.top) / r.height * imgH;
      if (x >= 0 && y >= 0 && x <= imgW && y <= imgH) addAt(x, y);
    });
    // Flèches : masque précédent ou suivant ; Maj + flèches : déplacer ; + et − : taille ; Suppr, Retour arrière : retirer ; Échap : outils
    layer.addEventListener('keydown', e => {
      const el = e.target.closest('[data-mask-index]');
      if (!el || e.altKey || e.ctrlKey || e.metaKey) return;
      const i = +el.dataset.maskIndex, d = ARROWS[e.key];
      if (d && e.shiftKey) move(i, d);
      else if (d) focusMask(i + d.x + d.y);
      else if (e.key === '+') resize(i, RESIZE_FACTOR);
      else if (e.key === '-') resize(i, 1 / RESIZE_FACTOR);
      else if (e.key === 'Delete' || e.key === 'Backspace') removeFromKeyboard(i);
      else if (e.key === 'Escape') focusToolbar();
      else return;
      e.preventDefault();
    });
    layer.addEventListener('focusin', e => { const el = e.target.closest('[data-mask-index]'); if (el) setActive(+el.dataset.maskIndex); });

    // Poignée dehors, en bas à droite si la place le permet, sinon de l'autre côté, sinon dedans
    function placeHandle(m) {
      const over = HANDLE_OVERHANG * imgW / Math.max(1, content.offsetWidth);
      const side = (start, length, total) => start + length + over <= total ? 'end' : start - over >= 0 ? 'start' : 'inside';
      return { x: side(m.x, m.width, imgW), y: side(m.y, m.height, imgH) };
    }
    function render() {
      // Tabindex itinérant : un seul masque dans l'ordre de tabulation, l'actif, sinon le premier
      const tabbable = active ?? 0;
      while (layer.children.length > masks.length) layer.lastElementChild.remove();
      masks.forEach((m, i) => {
        let el = layer.children[i];
        if (!el) {
          el = Object.assign(document.createElement('div'), { className: 'mask' });
          el.innerHTML = '<button type="button" class="mask-button"></button><span class="mask-handle" data-resize-handle aria-hidden="true"></span>';
          layer.append(el);
        }
        const h = placeHandle(m), button = el.firstElementChild;
        Object.assign(el.dataset, { maskIndex: i, handleX: h.x, handleY: h.y });
        el.toggleAttribute('data-active', i === active);
        Object.assign(el.style, { left: m.x / imgW * 100 + '%', top: m.y / imgH * 100 + '%', width: m.width / imgW * 100 + '%', height: m.height / imgH * 100 + '%' });
        button.tabIndex = i === tabbable ? 0 : -1;
        button.setAttribute('aria-label', maskLabel(i + 1));
        // Position en pixels de l'original, lisible de l'extérieur (vérifications dans un navigateur)
        Object.assign(button.dataset, { x: Math.round(m.x), y: Math.round(m.y), width: Math.round(m.width), height: Math.round(m.height) });
      });
    }
    // Aperçu final : ni contours ni poignée, pour voir l'image exportée. Le calque est caché, donc ni touchable ni focusable :
    // un toucher retirerait un masque devenu invisible. Zoomer et se déplacer restent possibles.
    function showFinalPreview(on) { finalPreview = on; layer.hidden = on; }
    function setImage(w, h, list) { imgW = w; imgH = h; masks = copy(list); active = null; showFinalPreview(false); resetZoom(); render(); }
    return {
      setImage,
      // Pendant l'analyse d'une photo : aucun masque, et aucun geste ne peut en ajouter
      clear: () => setImage(0, 0, []),
      // Masques d'avant une action annulée, sans les signaler comme une nouvelle modification
      restore(list, i) { masks = copy(list); active = i; render(); },
      showFinalPreview, resetZoom,
      zoomIn: () => zoomTo(zoom * ZOOM_STEP),
      zoomOut: () => zoomTo(zoom / ZOOM_STEP),
      // Ajout sans viser : au centre de la zone visible
      addAtViewCenter() { const c = viewCenter(); addAt(c.x / stage.clientWidth * imgW, c.y / stage.clientHeight * imgH); },
      grow() { if (active !== null) resize(active, RESIZE_FACTOR); },
      shrink() { if (active !== null) resize(active, 1 / RESIZE_FACTOR); },
      get isZoomed() { return zoom > 1; },
      get canZoomIn() { return zoom < MAX_ZOOM; },
      get hasActive() { return active !== null; },
      get isFinalPreview() { return finalPreview; },
    };
  }
  window.cortegeMaskEditor = createMaskEditor;
})();
