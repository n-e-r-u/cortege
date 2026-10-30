// ---- Direct ----
let liveTimer = null;
async function loadLive() {
  clearTimeout(liveTimer);
  if ($('#panelLive').hidden) return;
  let d; try { d = await api('/api/admin/live'); } catch (e) { alertMsg(e.message); return; }
  const k = $('#liveKpis'); k.textContent = '';
  const last15 = d.perMin.reduce((a, b) => a + b, 0);
  k.append(kpi(fmtN(d.active), 'signalements actifs'), kpi(fmtN(last15), 'nouveaux en 15 min'), kpi(fmtN(d.contested), 'à vérifier'),
    kpi(fmtN(d.streams), 'téléphones en temps réel'), kpi(fmtN(d.push.subs), 'abonnés aux notifications'));
  const box = $('#livePerMin'); box.textContent = '';
  const max = Math.max(1, ...d.perMin);
  d.perMin.forEach((n, i) => { const b = document.createElement('div'); b.style.height = Math.max(2, n / max * 100) + '%'; if (!n) b.className = 'zero'; b.title = (14 - i) + ' min : ' + n; box.append(b); });
  const st = [];
  if (d.mob) st.push('Journée prévue aujourd’hui : ' + d.mob.title);
  st.push(d.strict ? 'Mode renforcé jusqu’à ' + hhmm(d.strict) : 'Mode renforcé : non');
  st.push(d.paused ? 'Signalements en pause jusqu’à ' + hhmm(d.paused) : 'Signalements ouverts');
  $('#liveState').textContent = st.join(' · ');
  const p = d.push, rate = p.sent ? Math.round(p.ok / p.sent * 100) + ' %' : '—';
  kv($('#livePush'), [
    ['Abonnés', `${fmtN(p.subs)} (annonces urgentes : ${fmtN(p.urg)}, dangers près de soi : ${fmtN(p.near)})`],
    ['Envoyées', `${fmtN(p.sent)} depuis ${dur(Math.round((d.now - p.since) / 1000))}`],
    ['Reçues par le service', `${fmtN(p.ok)} (${rate})`], ['Expirées', fmtN(p.gone)],
    ['Échecs', fmtN(p.fail) + (Object.keys(p.codes).length ? ' · codes ' + Object.entries(p.codes).map(([c, n]) => (c === '0' ? 'sans réponse' : c) + ' ×' + n).join(', ') : '')],
    ['En file', `${p.queue} en attente, ${p.running} en cours`],
    ['Dernière erreur', p.lastErr ? `${hhmm(p.lastErr.t)} · ${p.lastErr.host} · ${p.lastErr.code || 'pas de réponse'} · ${p.lastErr.msg || ''}` : 'aucune'],
  ]);
  const bl = $('#liveBatches'); bl.textContent = '';
  for (const b of p.batches) bl.append(li(`${b.kind} : ${b.n} envoi(s)`, `${hhmm(b.t)} · ${b.ok} reçue(s), ${b.gone} expirée(s), ${b.fail} échec(s)` + (b.fail ? ' ' + JSON.stringify(b.codes) : '')));
  const sy = d.sys;
  kv($('#liveSys'), [
    ['Version', d.version], ['En ligne depuis', dur(sy.uptime)],
    ['Charge (1, 5, 15 min)', sy.load.join(' · ') + ` pour ${sy.cpus} cœurs`],
    ['Mémoire libre', sy.mem ? `${sy.mem.free} % (${fmtN(sy.mem.mb)} Mo)` : '—'], ['Mémoire de Cortège', sy.rss + ' Mo'],
    ['Disque libre', sy.disk ? `${sy.disk.free} % (${String(sy.disk.gb).replace('.', ',')} Go)` : '—'],
    ['Serveur', (d.up != null ? `en marche depuis ${d.up < 3600 ? Math.round(d.up / 60) + ' min' : d.up < 172800 ? Math.round(d.up / 3600) + ' h' : Math.round(d.up / 86400) + ' j'}` : '—')
      + (d.crash && Date.now() - d.crash.t < 7 * 864e5 ? ` · ⚠ dernier plantage le ${dayFr(d.crash.t)} à ${hhmm(d.crash.t)} : ${d.crash.msg}${d.crash.at ? ' (' + d.crash.at + ')' : ''}` : '')],
    ['Retard de Node', d.load ? `${d.load.lagMs} ms` + (d.load.lagMs > 500 ? ' (surchargé : seul l’essentiel passe)' : '') : '—'],
    ['Refusées depuis le démarrage', d.load ? `${fmtN(d.load.shed)} par surcharge · ${fmtN(d.load.flood)} rafales d’une même adresse` : '—'],
  ]);
  liveTimer = setTimeout(loadLive, 10000);
}
$('#tabLive').onclick = () => { showTab('Live'); loadLive(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#panelLive').hidden) loadLive(); });

