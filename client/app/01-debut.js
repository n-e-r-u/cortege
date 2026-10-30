  // Langue : le dictionnaire est chargé (et la page traduite) avant tout le reste
  await (window.I18N ? window.I18N.ready : null);
  const I18N = window.I18N || { lang: 'fr', locale: 'fr-FR', t: (s, v) => v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s, tn: (n, a, b, v) => (n > 1 ? b : a).replace(/\{(\w+)\}/g, (m, k) => ({ n, ...v })[k] ?? m), set() {}, translate() {} };
  const { t, tn } = I18N;
  const $ = s => document.querySelector(s);
  const MIN = 60_000;
  const ALERT_CATS = new Set(['sommations', 'lacrymo', 'canon', 'charge', 'tirs', 'facho', 'nasse', 'bac', 'inter', 'blinde', 'crs', 'interpellation']);
  let orga = null; // { label, admin } quand ce téléphone a un lien orga
  let beacon = null; // position partagée en direct par une orga : { role, until, timer, lock }
  let announcements = [];
  // Économie de batterie : rafraîchissement espacé, GPS moins précis, boussole coupée
  let eco = false; try { eco = localStorage.getItem('cortege-eco') === '1'; } catch {}
  let pushSub = null;               // abonnement aux notifications (annonces urgentes)
  let evCache = { h: null, e: [] }; // agenda (événements publiés)
  let legalCache = { h: null, l: [] }; // annuaire permanent des legal teams (lignes validées par l'admin)
  let voice = false; try { voice = localStorage.getItem('cortege-voice') === '1'; } catch {}
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  // Identifiant anonyme de ce téléphone (tiré au hasard, jamais lié à une personne) : sert seulement
  // à limiter le spam par appareil, car en 4G des centaines de personnes partagent la même adresse IP.
  const DEVICE = (() => {
    let d = null; try { d = localStorage.getItem('cortege-dev'); } catch {}
    if (!d || !/^[\w-]{16,64}$/.test(d)) {
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      d = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { localStorage.setItem('cortege-dev', d); } catch {}
    }
    return d;
  })();
  // Réglages du serveur : gardés sur le téléphone pour que l'appli s'ouvre aussi sans réseau
  const cfg = await (async () => {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 8000);
    try {
      const c = await fetch('/api/config', { signal: ac.signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      try { localStorage.setItem('cortege-config', JSON.stringify(c)); } catch {}
      return c;
    } catch (e) {
      let c = null; try { c = JSON.parse(localStorage.getItem('cortege-config') || 'null'); } catch {}
      if (c) return c;
      throw e;
    } finally { clearTimeout(to); }
  })();
  // Libellés venus du serveur (en français) : traduits ici une fois pour toutes
  for (const list of [cfg.categories, cfg.groups, cfg.poiKinds, cfg.orderKinds, cfg.eventTypes]) for (const x of list || []) if (x.label) x.label = t(x.label);
  const CAT = Object.fromEntries(cfg.categories.map(c => [c.id, c]));
  let ALERT_RADIUS = cfg.alertRadius || 300;   // mètres (réglable par l'admin)
  const MERGE = cfg.merge || {};              // rayon de fusion par type (m), même règle que le serveur
  const mergeR = cat => (MERGE[cat] && MERGE[cat].r) || 50;
  const GROUP_COLOR = { fdo: 'var(--fdo)', danger: 'var(--danger)', soutien: 'var(--soutien)', info: 'var(--info)' };
  function applyBanner() { const e = $('#eventName'); e.textContent = t(cfg.event); e.classList.toggle('on', !!cfg.banner); }
  applyBanner();
  if (cfg.sourceUrl) $('#githubLink').href = cfg.sourceUrl;
  if (cfg.onion) {
    $('#onionTip').hidden = false; $('#onionAddr').textContent = cfg.onion;
    $('#onionCopy').onclick = async () => { try { await navigator.clipboard.writeText('http://' + cfg.onion); toast(t('Adresse .onion copiée')); } catch { toast(cfg.onion); } };
  }
  if (cfg.violenceUrl) document.querySelectorAll('#violenceLink, .violence-inline').forEach(a => (a.href = cfg.violenceUrl));
  if (cfg.brand) {
    document.querySelectorAll('.handle').forEach(n => (n.textContent = '@' + cfg.brand.handle));
    document.querySelectorAll('a[href="https://www.instagram.com/neru/"]').forEach(a => (a.href = cfg.brand.instagram));
    $('#brandLink').href = cfg.brand.instagram;
    document.querySelectorAll('a[href="https://ko-fi.com/neru"]').forEach(a => { if (cfg.brand.kofi) a.href = cfg.brand.kofi; else a.hidden = true; });
    const siteLabel = cfg.brand.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    document.querySelectorAll('a[href="https://neru.tv"]').forEach(a => { a.href = cfg.brand.site; if (!a.querySelector('svg')) a.textContent = siteLabel; });
  }

  // Logo absent : on le masque (fait ici et pas dans le HTML, que la politique de sécurité interdit)
  document.querySelectorAll('img[src="/brand/logo.png"]').forEach(img => {
    const fail = () => { img.hidden = true; if (img.classList.contains('logo-img') && img.nextElementSibling) img.nextElementSibling.hidden = false; };
    if (img.complete && !img.naturalWidth) fail(); else img.addEventListener('error', fail);
  });

  // Demande d'accès orga : formulaire dans l'appli (lien partageable par ville : /?rejoindre=Montpellier)
  $('#orgaRequestCard').hidden = false;

