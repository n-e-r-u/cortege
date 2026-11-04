'use strict';
// Style de la carte vectorielle (protomaps-leaflet) aux couleurs de Cortège, en deux thèmes (sombre et clair, voir theme.js) :
// rues bien visibles, bâtiments, eau et parcs marqués, noms plus grands en Inter.
// Partagé par l'appli et la carte à intégrer.
(() => {
  // Sombre : bleu nuit NERU, rues bien visibles (grands axes teintés de mauve), bâtiments, eau et parcs marqués
  const D = {
    background: '#12153a', earth: '#151940', water: '#1e2f5c', glacier: '#2a2d4a', sand: '#2a2938', beach: '#2c2b3a',
    park_a: '#17303a', park_b: '#1a3540', wood_a: '#17303a', wood_b: '#1a333d', scrub_a: '#1c2c3a', scrub_b: '#1e2f3c', zoo: '#1a323c',
    hospital: '#2c2140', industrial: '#1d2147', school: '#262352', pedestrian: '#23285a', aerodrome: '#1d2147', runway: '#363c73',
    military: '#262347', pier: '#2e3366', buildings: '#262b5e',
    tunnel_other_casing: '#12153a', tunnel_minor_casing: '#12153a', tunnel_link_casing: '#12153a', tunnel_major_casing: '#12153a', tunnel_highway_casing: '#12153a',
    tunnel_other: '#2a2f62', tunnel_minor: '#2a2f62', tunnel_link: '#323870', tunnel_major: '#3a3f7a', tunnel_highway: '#4a4380',
    minor_service_casing: '#12153a', minor_casing: '#12153a', link_casing: '#12153a', major_casing_late: '#12153a', highway_casing_late: '#12153a',
    major_casing_early: '#12153a', highway_casing_early: '#12153a',
    other: '#333970', minor_service: '#333970', minor_a: '#444b86', minor_b: '#3d437c', link: '#5f5f99', major: '#7a6fa8', highway: '#a07ca8',
    railway: '#45487a', boundaries: '#7b72a3',
    bridges_other_casing: '#12153a', bridges_minor_casing: '#12153a', bridges_link_casing: '#12153a', bridges_major_casing: '#12153a', bridges_highway_casing: '#12153a',
    bridges_other: '#333970', bridges_minor: '#444b86', bridges_link: '#5f5f99', bridges_major: '#7a6fa8', bridges_highway: '#a07ca8',
    roads_label_minor: '#aeb1d6', roads_label_minor_halo: '#12153a', roads_label_major: '#dcdcf2', roads_label_major_halo: '#12153a',
    ocean_label: '#8e9ad0', subplace_label: '#b9bbe0', subplace_label_halo: '#12153a', city_label: '#f3f2fa', city_label_halo: '#12153a',
    state_label: '#8185b3', state_label_halo: '#12153a', country_label: '#b0b3d8', address_label: '#8f92bd', address_label_halo: '#12153a',
    pois: { blue: '#5aa9d6', green: '#3fcf86', lapis: '#7d8cf0', pink: '#f6a29c', red: '#f26a85', slategray: '#aeb1d6', tangerine: '#f5a77c', turquoise: '#22c8d8' },
    landcover: { grassland: 'rgba(24, 46, 56, 1)', barren: 'rgba(40, 39, 58, 1)', urban_area: 'rgba(25, 29, 69, 1)', farmland: 'rgba(26, 44, 52, 1)',
      glacier: 'rgba(48, 50, 80, 1)', scrub: 'rgba(30, 44, 58, 1)', forest: 'rgba(22, 46, 54, 1)' },
  };
  // Clair : fond pastel du logo, rues blanches, grands axes pêche, eau bleu pâle, textes à l'encre NERU
  const C = {
    background: '#f3eff6', earth: '#f5f1f7', water: '#cdd5f1', glacier: '#eef0f8', sand: '#f3ece0', beach: '#f4ede2',
    park_a: '#dbeedf', park_b: '#d3e9d8', wood_a: '#d3e9d8', wood_b: '#cbe4d1', scrub_a: '#e1ede0', scrub_b: '#d9e8d8', zoo: '#d8ecdc',
    hospital: '#f6e1e4', industrial: '#ebe6f0', school: '#ece6f5', pedestrian: '#faf8fc', aerodrome: '#ebe6f0', runway: '#d8d2e6',
    military: '#ece4ea', pier: '#e6e0ee', buildings: '#e6e0ee',
    tunnel_other_casing: '#e2dcea', tunnel_minor_casing: '#e2dcea', tunnel_link_casing: '#e2dcea', tunnel_major_casing: '#e2dcea', tunnel_highway_casing: '#e2dcea',
    tunnel_other: '#f7f5fa', tunnel_minor: '#f7f5fa', tunnel_link: '#fbece9', tunnel_major: '#fbe3df', tunnel_highway: '#f7d4cf',
    minor_service_casing: '#e2dcea', minor_casing: '#e2dcea', link_casing: '#ead3d3', major_casing_late: '#e8c9c6', highway_casing_late: '#e0b7b2',
    major_casing_early: '#e8c9c6', highway_casing_early: '#e0b7b2',
    other: '#ffffff', minor_service: '#ffffff', minor_a: '#ffffff', minor_b: '#ffffff', link: '#fde9e6', major: '#fde1dd', highway: '#f8cfca',
    railway: '#c9c3d9', boundaries: '#9576a8',
    bridges_other_casing: '#e2dcea', bridges_minor_casing: '#e2dcea', bridges_link_casing: '#ead3d3', bridges_major_casing: '#e8c9c6', bridges_highway_casing: '#e0b7b2',
    bridges_other: '#ffffff', bridges_minor: '#ffffff', bridges_link: '#fde9e6', bridges_major: '#fde1dd', bridges_highway: '#f8cfca',
    roads_label_minor: '#4a4f7a', roads_label_minor_halo: '#ffffff', roads_label_major: '#1c2156', roads_label_major_halo: '#ffffff',
    ocean_label: '#3a4db2', subplace_label: '#4a4f7a', subplace_label_halo: '#ffffff', city_label: '#1c2156', city_label_halo: '#ffffff',
    state_label: '#6b6f98', state_label_halo: '#ffffff', country_label: '#4a4f7a', address_label: '#6b6f98', address_label_halo: '#ffffff',
    pois: { blue: '#2f78b5', green: '#23885a', lapis: '#3a4db2', pink: '#c0565f', red: '#c63a55', slategray: '#4a4f7a', tangerine: '#b9632e', turquoise: '#13848f' },
    landcover: { grassland: 'rgba(220, 238, 223, 1)', barren: 'rgba(241, 236, 228, 1)', urban_area: 'rgba(238, 233, 243, 1)', farmland: 'rgba(232, 240, 226, 1)',
      glacier: 'rgba(240, 242, 249, 1)', scrub: 'rgba(226, 237, 224, 1)', forest: 'rgba(211, 233, 216, 1)' },
  };
  const theme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  // Noms de rues et de lieux : police Inter de l'appli, un peu plus grands que le style d'origine
  const SCALE = 1.15;
  function boostFont(attr) {
    if (!attr || typeof attr.get !== 'function' || attr.__cortege) return;
    const get = attr.get.bind(attr); attr.__cortege = true;
    attr.get = (z, f) => String(get(z, f)).replace(/([\d.]+)px\s+sans-serif/, (_, px) => `${Math.round(px * SCALE * 10) / 10}px Inter, sans-serif`);
  }
  function walk(o, seen = new Set(), depth = 0) {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 6) return;
    seen.add(o);
    if ('family' in o || ('font' in o && typeof o.get === 'function')) boostFont(o);
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') walk(v, seen, depth + 1); }
  }
  window.cortegeVectorLayer = function (P, opts) {
    const F = (opts.theme || theme()) === 'light' ? C : D;
    // Noms des rues et des lieux dans la langue de l'appli quand la carte la connaît (sinon le nom local)
    const labels = P.labelRules(F, opts.lang || 'fr');
    try { labels.forEach(r => walk(r.symbolizer)); } catch {}
    // transparent : pas de fond peint sous les tuiles (hors de la zone du fichier de carte, le repli OpenStreetMap posé dessous reste visible ;
    // le fond est alors celui du conteneur de la carte, de la même couleur)
    const { transparent, theme: _t, ...rest } = opts;
    return P.leafletLayer({ ...rest, paintRules: P.paintRules(F), labelRules: labels, backgroundColor: transparent ? undefined : F.background });
  };
  // Polices chargées avant le premier dessin (sinon le canvas utiliserait la police par défaut)
  window.cortegeMapBackground = () => (theme() === 'light' ? C : D).background;
  window.cortegeMapFonts = () => Promise.all(['400 12px Inter', '700 12px Inter'].map(f => document.fonts?.load?.(f).catch(() => {}))).catch(() => {});
})();
