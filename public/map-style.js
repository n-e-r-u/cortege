'use strict';
// Style de la carte vectorielle (protomaps-leaflet) aux couleurs de Cortège : fond sombre mais lisible,
// rues bien visibles (grands axes teintés de violet), bâtiments, eau et parcs marqués, noms plus grands en Inter.
// Partagé par l'appli et la carte à intégrer.
(() => {
  const F = {
    background: '#141519', earth: '#1b1c21', water: '#1d2b44', glacier: '#2a2c33', sand: '#2a2925', beach: '#2c2b27',
    park_a: '#1b2a22', park_b: '#1f3027', wood_a: '#1c2a23', wood_b: '#1f2e26', scrub_a: '#212820', scrub_b: '#232b22', zoo: '#1f2c25',
    hospital: '#2b2226', industrial: '#202026', school: '#25222d', pedestrian: '#26262e', aerodrome: '#202026', runway: '#383842',
    military: '#262326', pier: '#30303a', buildings: '#2e2e38',
    tunnel_other_casing: '#141519', tunnel_minor_casing: '#141519', tunnel_link_casing: '#141519', tunnel_major_casing: '#141519', tunnel_highway_casing: '#141519',
    tunnel_other: '#2c2c34', tunnel_minor: '#2c2c34', tunnel_link: '#34343e', tunnel_major: '#3a3a46', tunnel_highway: '#433e58',
    minor_service_casing: '#141519', minor_casing: '#141519', link_casing: '#141519', major_casing_late: '#141519', highway_casing_late: '#141519',
    major_casing_early: '#141519', highway_casing_early: '#141519',
    other: '#383842', minor_service: '#383842', minor_a: '#4a4a57', minor_b: '#42424e', link: '#615f78', major: '#6d6a8a', highway: '#8a7aae',
    railway: '#4a4656', boundaries: '#6e6782',
    bridges_other_casing: '#141519', bridges_minor_casing: '#141519', bridges_link_casing: '#141519', bridges_major_casing: '#141519', bridges_highway_casing: '#141519',
    bridges_other: '#383842', bridges_minor: '#4a4a57', bridges_link: '#615f78', bridges_major: '#6d6a8a', bridges_highway: '#8a7aae',
    roads_label_minor: '#a9a7b5', roads_label_minor_halo: '#141519', roads_label_major: '#d6d4de', roads_label_major_halo: '#141519',
    ocean_label: '#8794b0', subplace_label: '#b3b1bf', subplace_label_halo: '#141519', city_label: '#f2f1f4', city_label_halo: '#141519',
    state_label: '#7c7a88', state_label_halo: '#141519', country_label: '#a3a1ad', address_label: '#8a8896', address_label_halo: '#141519',
    pois: { blue: '#5aa9d6', green: '#3fcf86', lapis: '#5b7cf0', pink: '#ec9fa4', red: '#f26a85', slategray: '#a3a1ad', tangerine: '#f5a77c', turquoise: '#22c8d8' },
    landcover: { grassland: 'rgba(31, 44, 34, 1)', barren: 'rgba(40, 39, 36, 1)', urban_area: 'rgba(30, 30, 36, 1)', farmland: 'rgba(33, 39, 33, 1)',
      glacier: 'rgba(48, 49, 55, 1)', scrub: 'rgba(35, 40, 32, 1)', forest: 'rgba(29, 44, 37, 1)' },
  };
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
    const labels = P.labelRules(F, 'fr');
    try { labels.forEach(r => walk(r.symbolizer)); } catch {}
    return P.leafletLayer({ ...opts, paintRules: P.paintRules(F), labelRules: labels, backgroundColor: F.background });
  };
  // Polices chargées avant le premier dessin (sinon le canvas utiliserait la police par défaut)
  window.cortegeMapFonts = () => Promise.all(['400 12px Inter', '700 12px Inter'].map(f => document.fonts?.load?.(f).catch(() => {}))).catch(() => {});
})();
