'use strict';
// Langues de l'interface : le français est le texte d'origine ; chaque autre langue est un fichier /lang/<code>.json
// (construit depuis i18n/<code>.po). La liste des langues vient de /lang/langs.js (fabriqué par le serveur) :
// une langue ajoutée sur le serveur apparaît toute seule. Variantes régionales (en-US) : seulement leurs différences.
// Rien n'est demandé au serveur sauf ces fichiers, gardés ensuite pour le hors-ligne par le service worker.
(function () {
  const LIST = Array.isArray(window.CORTEGE_LANGS) && window.CORTEGE_LANGS.length ? window.CORTEGE_LANGS
    : [{ code: 'fr', base: 'fr', name: 'Français', dir: 'ltr', locale: 'fr-FR', n: 0 }, { code: 'en', base: 'en', name: 'English', dir: 'ltr', locale: 'en-GB', n: 1 },
      { code: 'es', base: 'es', name: 'Español', dir: 'ltr', locale: 'es-ES', n: 1 }, { code: 'ar', base: 'ar', name: 'العربية', dir: 'rtl', locale: 'ar-u-nu-latn', n: 1 }];
  const BY = Object.fromEntries(LIST.map(x => [x.code, x]));
  const FALLBACK = BY[window.CORTEGE_DEFAULT_LANG] ? window.CORTEGE_DEFAULT_LANG : 'fr';
  const LANGS = LIST.map(x => x.code);
  // Choix : celui gardé sur le téléphone, sinon la langue du téléphone (variante exacte, puis langue), sinon la langue de l'instance
  let code = null, phoneTag = null;
  try { code = localStorage.getItem('cortege-lang'); } catch {}
  const tags = navigator.languages || [navigator.language || FALLBACK];
  if (!BY[code]) {
    code = null;
    for (const l of tags) {
      const tag = String(l || ''), exact = LIST.find(x => x.code.toLowerCase() === tag.toLowerCase()), base = tag.slice(0, 2).toLowerCase();
      if (exact) { code = exact.code; phoneTag = tag; break; }
      if (BY[base]) { code = base; phoneTag = tag; break; }
    }
    code ||= FALLBACK;
  }
  let info = BY[code] || BY.fr || LIST[0], lang = info.base || info.code;
  // Format des dates : celui du téléphone quand il parle cette langue (en-US : 31/10 → 10/31, 14:00 → 2:00 PM)
  const localeFor = inf => {
    const tag = phoneTag || tags.find(x => String(x).slice(0, 2).toLowerCase() === inf.base);
    const loc = tag && /^[a-z]{2,3}-[A-Za-z]{2,4}$/.test(tag) && !inf.code.includes('-') ? tag : inf.locale;
    return inf.base === 'ar' && !/-u-nu-/.test(loc) ? loc + '-u-nu-latn' : loc;
  };
  const html = document.documentElement;
  let dict = {};
  const norm = s => String(s).replace(/\s+/g, ' ').trim();
  const fill = (str, v) => v ? str.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : str;
  // t('il y a {m} min', { m: 3 }) : traduction du texte français, avec ses valeurs
  function t(s, v) { const k = norm(s), d = dict[k]; return fill(typeof d === 'string' ? d : Array.isArray(d) ? d[d.length - 1] : s, v); }
  // tn(n, 'un signalement', '{n} signalements') : la bonne forme du pluriel pour la langue (l'arabe en a six)
  let plural = null;
  function tn(n, one, many, v) {
    const d = dict[norm(one)], vals = { n, ...(v || {}) };
    if (Array.isArray(d)) {
      try { plural ||= new Intl.PluralRules(info.locale.split('-u-')[0]); } catch {}
      const cats = info.plural || ['one', 'other'], i = plural ? cats.indexOf(plural.select(n)) : -1;
      return fill(d[i >= 0 ? i : d.length - 1], vals);
    }
    return lang === 'fr' && !d ? fill(n > 1 ? many : one, vals) : t(n > 1 || (n === 0 && lang !== 'fr') ? many : one, vals);
  }

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
  function translate(root) { if (root && Object.keys(dict).length) walk(root); }
  function collect(root) { const out = new Set(); walk(root, out); return [...out]; }

  function set(l) { try { localStorage.setItem('cortege-lang', LANGS.includes(l) ? l : FALLBACK); } catch {} }

  let ready;
  // Français sans correction (fr.po vide) : rien à charger
  if (lang === 'fr' && !info.n) ready = Promise.resolve();
  else {
    html.classList.add('i18n-wait');
    const done = () => { html.classList.remove('i18n-wait'); };
    const domReady = new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r, { once: true }) : r());
    const load = fetch('/lang/' + info.code + '.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('délai')), 6000));
    ready = Promise.all([Promise.race([load, timeout]), domReady]).then(([d]) => {
      dict = {};
      for (const [k, v] of Object.entries(d || {})) if (k && ((typeof v === 'string' && v) || Array.isArray(v))) dict[norm(k)] = v;
      if (d && d['']) info = { ...info, ...d[''] };
      html.lang = info.code; html.dir = info.dir || 'ltr';
      if (dict[norm(document.title)]) document.title = dict[norm(document.title)];
      translate(document.body);
    }).catch(() => { dict = {}; info = BY.fr || LIST[0]; lang = 'fr'; Object.assign(window.I18N, { lang, code: 'fr', locale: 'fr-FR' }); }).finally(done);
  }
  // lang : la langue (en, ar…), code : avec sa variante éventuelle (en-US), list : les langues disponibles (nom, sens d'écriture)
  window.I18N = { lang, code: info.code, locale: localeFor(info), langs: LANGS, list: LIST, t, tn, translate, collect, set, ready };
})();
