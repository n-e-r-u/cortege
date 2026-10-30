'use strict';
// Langues de l'interface : français (texte d'origine), anglais, espagnol, arabe (de droite à gauche).
// Le texte français sert de clé : /lang/xx.json associe chaque texte français à sa traduction.
// Rien n'est demandé au serveur sauf ce fichier, gardé ensuite pour le hors-ligne par le service worker.
(function () {
  const LANGS = ['fr', 'en', 'es', 'ar'];
  const LOCALES = { fr: 'fr-FR', en: 'en-US', es: 'es-US', ar: 'ar-u-nu-latn' };
  let lang = null;
  try { lang = localStorage.getItem('cortege-lang'); } catch {}
  if (!LANGS.includes(lang)) {
    lang = 'fr';
    for (const l of navigator.languages || [navigator.language || 'fr']) {
      const b = String(l || '').slice(0, 2).toLowerCase();
      if (LANGS.includes(b)) { lang = b; break; }
    }
  }
  const html = document.documentElement;
  let dict = {};
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const fill = (str, v) => v ? str.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : str;
  // t('il y a {m} min', { m: 3 }) : traduction du texte français, avec ses valeurs
  function t(s, v) { const k = norm(s); return fill((lang !== 'fr' && dict[k]) || s, v); }
  // tn(n, 'un signalement', '{n} signalements') : singulier ou pluriel
  function tn(n, one, many, v) { return t(n > 1 || (n === 0 && lang !== 'fr') ? many : one, { n, ...(v || {}) }); }

  // ---- Traduction de la page ----
  // Un « bloc » est un élément dont tout le contenu est du texte et du balisage simple (gras, lien…) :
  // il est traduit d'un coup (la phrase entière, balises comprises). Sinon on descend dans ses enfants.
  const INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'SMALL', 'SUP', 'SUB', 'CODE', 'BR', 'A', 'SPAN', 'ABBR']);
  const SKIP = 'script,style,svg,template,textarea,[data-no-i18n]';
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function isBlock(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1 || !INLINE.has(c.tagName) || c.id || !isBlock(c)) return false;
    }
    return true;
  }
  const hasText = n => /\S/.test(n.textContent);
  function attrs(n, out) {
    for (const a of ATTRS) {
      const v = n.getAttribute && n.getAttribute(a);
      if (v && /[A-Za-zÀ-ÿ]/.test(v)) { if (out) out.add(norm(v)); else if (dict[norm(v)]) n.setAttribute(a, dict[norm(v)]); }
    }
  }
  // out : Set → on collecte les clés (outil de traduction) ; sinon on traduit
  function walk(n, out) {
    if (n.nodeType !== 1 || n.matches(SKIP)) return;
    attrs(n, out);
    for (const c of n.querySelectorAll('[placeholder],[aria-label],[title],[alt]')) if (!c.closest(SKIP)) attrs(c, out);
    walkText(n, out);
  }
  function walkText(n, out) {
    if (n.nodeType !== 1 || n.matches(SKIP)) return;
    if (n.tagName !== 'BODY' && hasText(n) && isBlock(n)) {
      const k = norm(n.innerHTML);
      if (out) { out.add(k); return; }
      if (dict[k]) { n.innerHTML = dict[k]; return; }
      if (!n.children.length) return;
    }
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) {
        const k = norm(c.nodeValue); if (!k || !/[A-Za-zÀ-ÿ]/.test(k)) continue;
        if (out) out.add(k);
        else if (dict[k]) { const m = /^(\s*)[\s\S]*?(\s*)$/.exec(c.nodeValue); c.nodeValue = m[1] + dict[k] + m[2]; }
      } else if (c.nodeType === 1) walkText(c, out);
    }
  }
  function translate(root) { if (lang !== 'fr' && root) walk(root); }
  function collect(root) { const out = new Set(); walk(root, out); return [...out]; }

  function set(l) { try { localStorage.setItem('cortege-lang', LANGS.includes(l) ? l : 'fr'); } catch {} }

  let ready;
  if (lang === 'fr') ready = Promise.resolve();
  else {
    html.classList.add('i18n-wait');
    const done = () => { html.classList.remove('i18n-wait'); };
    const domReady = new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r());
    const load = fetch('/lang/' + lang + '.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('délai')), 6000));
    ready = Promise.all([Promise.race([load, timeout]), domReady]).then(([d]) => {
      dict = {};
      for (const [k, v] of Object.entries(d || {})) if (typeof v === 'string' && v) dict[norm(k)] = v;
      html.lang = lang; html.dir = lang === 'ar' ? 'rtl' : 'ltr';
      if (dict[norm(document.title)]) document.title = dict[norm(document.title)];
      translate(document.body);
    }).catch(() => { lang = 'fr'; window.I18N.lang = 'fr'; window.I18N.locale = LOCALES.fr; }).finally(done);
  }
  window.I18N = { lang, locale: LOCALES[lang], langs: LANGS, t, tn, translate, collect, set, ready };
})();
