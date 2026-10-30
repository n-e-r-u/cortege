'use strict';

const crypto = require('crypto');
const { ORGAS, ADMIN_LABEL_ENV } = require('./config');
const { CATEGORIES, BASE_TTL } = require('./categories');
const { labelKey } = require('./util');
const { getMeta, setMeta } = require('./db');
const { readOrgas } = require('./orgas/store');
const { dirty, scheduleFlush } = require('./live/files');

// ---- Réglages modifiables depuis l'admin (sans toucher aux variables du serveur) ----
// Bandeau d'événement (avec dates), vue d'ouverture, catégories (activées, durée), rayon d'alerte, distance des notifications.
// Les clés, chemins et liens restent dans les variables d'environnement.
let SET = { at: 0, v: {}, h: '' };
function settings() {
  const now = Date.now();
  if (now - SET.at > 3000) {
    const raw = getMeta('settings') || '{}';
    if (raw !== SET.raw) {
      let v = {}; try { v = JSON.parse(raw); } catch {}
      for (const c of CATEGORIES) { const o = v.cats?.[c.id]; c.ttl = o && o.ttl >= 5 && o.ttl <= 24 * 60 ? Math.round(o.ttl) : BASE_TTL[c.id]; c.off = !!(o && o.off); }
      SET = { at: now, v, raw };
    } else SET.at = now;
  }
  return SET.v;
}
function cleanSettings(b) {
  const s = {}, str = (x, n) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const day = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : null;
  if (b.banner && str(b.banner.text, 80)) s.banner = { text: str(b.banner.text, 80), from: day(b.banner.from), to: day(b.banner.to) };
  if (b.view) {
    const lat = Number(b.view.lat), lng = Number(b.view.lng), zoom = Math.round(Number(b.view.zoom));
    if (Math.abs(lat) <= 85 && Math.abs(lng) <= 180 && zoom >= 3 && zoom <= 17) s.view = { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4, zoom };
  }
  if (b.cats && typeof b.cats === 'object') {
    s.cats = {};
    for (const c of CATEGORIES) {
      const o = b.cats[c.id]; if (!o) continue;
      const ttl = Math.round(Number(o.ttl)), out = {};
      if (o.off) out.off = true;
      if (ttl >= 5 && ttl <= 24 * 60 && ttl !== BASE_TTL[c.id]) out.ttl = ttl;
      if (Object.keys(out).length) s.cats[c.id] = out;
    }
  }
  const ar = Math.round(Number(b.alertRadius)); if (ar >= 50 && ar <= 2000) s.alertRadius = ar;
  const nk = Number(b.nearKm); if (nk >= 1 && nk <= 50) s.nearKm = Math.round(nk);
  const al = str(b.adminLabel, 40);
  if (al.length >= 2 && !readOrgas().some(o => labelKey(o.label) === labelKey(al)) && !ORGAS.some(o => labelKey(o.label) === labelKey(al))) s.adminLabel = al;
  return s;
}
function saveSettings(s) { setMeta('settings', JSON.stringify(s)); SET.at = 0; settings(); dirty.global = true; scheduleFlush(); }
// Journées de mobilisation prévues : notification la veille au soir, bandeau et mode renforcé le jour J, bilan proposé le lendemain
const mobsAll = () => { try { return JSON.parse(getMeta('mobs') || '[]'); } catch { return []; } };
const mobToday = (now = Date.now()) => { const d = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); return mobsAll().find(m => m.date === d) || null; };
// Bandeau affiché en haut de la carte : journée de mobilisation du jour, sinon bandeau des réglages (dans ses dates), sinon le nom par défaut
function bannerNow(now = Date.now()) {
  const m = mobToday(now); if (m) return m.title;
  const b = settings().banner, d = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  if (b && b.text && (!b.from || d >= b.from) && (!b.to || d <= b.to)) return b.text;
  return null;
}
const cfgHash = () => { const s = settings(); return crypto.createHash('sha1').update(JSON.stringify([s, bannerNow()])).digest('base64url').slice(0, 10); };

const pausedUntil = now => { const p = Number(getMeta('paused') || 0); return p > now ? p : 0; };

function adminLabel() { return settings().adminLabel || ADMIN_LABEL_ENV; }

module.exports = { settings, cleanSettings, saveSettings, mobsAll, mobToday, bannerNow, cfgHash, adminLabel, pausedUntil };
