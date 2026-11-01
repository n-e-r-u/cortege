// ---- Serveur : version, mise à jour disponible, ressources, cartes, sauvegarde ----
const octets = n => n == null ? 'inconnu' : n >= 1e9 ? (n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go' : n >= 1e6 ? Math.round(n / 1e6) + ' Mo' : Math.round(n / 1e3) + ' ko';
const duree = s => s < 3600 ? Math.round(s / 60) + ' min' : s < 172800 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' j';
const libre = d => d ? `${octets(d.free)} libres sur ${octets(d.total)} (${Math.round(d.free / d.total * 100)} %)` : 'inconnu';
async function loadServer(check = true) {
  let d; try { d = await api('/api/admin/server' + (check ? '' : '?check=0')); } catch (e) { alertMsg(e.message); return; }
  $('#srvBadge').textContent = d.newer ? '1' : '';
  $('#srvUpdate').hidden = !d.newer;
  if (d.newer) {
    $('#srvUpdateText').textContent = `La version ${d.latest} est publiée ; ton serveur fait tourner la ${d.version}.`;
    $('#srvCmd').textContent = d.update;
    $('#srvChangelog').hidden = !d.changelog; if (d.changelog) $('#srvChangelog').href = d.changelog;
  }
  kv($('#srvVersion'), [
    ['En ligne', d.version],
    ['Publiée', d.latest ? d.latest + (d.newer ? ' (plus récente)' : ' (à jour)') : d.latestErr || 'pas encore vérifiée'],
    ['Vérifiée', d.latestAt ? `${dayFr(d.latestAt)} à ${hhmm(d.latestAt)}` : 'inconnu'],
    ['Node', d.node],
    ['Commande de mise à jour', d.update],
  ]);
  kv($('#srvRes'), [
    ['Cortège tourne depuis', duree(d.uptime)],
    ['Machine allumée depuis', duree(d.host.uptime)],
    ['Charge (1, 5, 15 min)', d.host.load.join(' · ') + ` pour ${d.host.cpus} cœurs`],
    ['Mémoire', d.mem ? `${octets(d.mem.free)} libres sur ${octets(d.mem.total)} · Cortège : ${octets(d.rss)}` : 'inconnu'],
    ['Disque des données', libre(d.disk.data)],
    ...(d.disk.tiles ? [['Disque des cartes', libre(d.disk.tiles)]] : []),
    ['Base de données', octets(d.db)],
    ['Dernier plantage', d.crash ? `${dayFr(d.crash.t)} à ${hhmm(d.crash.t)} : ${d.crash.msg}` : 'aucun'],
  ]);
  kv($('#srvMaps'), d.maps.length ? d.maps.map(m => [m.name, `${octets(m.bytes)} · ${m.world ? 'monde' : 'régionale'}${m.open ? ` · zoom ${m.minz} à ${m.maxz}` : ' · illisible'}`])
    : [['Aucune', 'fond OpenStreetMap partout (voir le guide d’une nouvelle instance pour héberger une carte)']]);
  const old = d.backup && Date.now() - d.backup.t > 36 * 3600_000;
  kv($('#srvBackup'), [['Dernière sauvegarde', d.backup ? `${dayFr(d.backup.t)} à ${hhmm(d.backup.t)}${d.backup.bytes ? ' · ' + octets(d.backup.bytes) : ''}${old ? ' ⚠ plus d’un jour' : ''}` : 'inconnue']]);
  $('#srvBackupHelp').textContent = d.backup ? 'Faite chaque nuit par le minuteur du serveur, chiffrée : seule ta clé secrète, gardée hors du serveur, peut l’ouvrir.'
    : 'Le script de sauvegarde n’a pas encore indiqué de date. S’il est installé, mets-le à jour une fois sur le serveur : sudo install -m 700 tools/cortege-backup.sh /usr/local/sbin/cortege-backup (depuis le dossier de l’appli).';
}
$('#srvCheck').onclick = () => loadServer(true);
$('#srvCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#srvCmd').textContent); $('#srvCopy').textContent = 'Copié'; setTimeout(() => ($('#srvCopy').textContent = 'Copier'), 2000); } catch { alertMsg($('#srvCmd').textContent); } };
$('#tabServer').onclick = () => { showTab('Server'); loadServer(true); };
// Pastille « mise à jour disponible » dès la connexion
function srvBadge() { api('/api/admin/server').then(d => { $('#srvBadge').textContent = d.newer ? '1' : ''; }).catch(() => {}); }
