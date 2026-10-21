#!/bin/sh
# Installe la protection de Cortège (pare-feu du noyau + réglages réseau), sans aucun service extérieur.
# Sécurité : les règles sont retirées toutes seules au bout de 3 minutes, sauf si tu confirmes
# (au cas où une règle te couperait l'accès SSH). Usage, en root :
#   sh tools/protection/installer.sh           → essai de 3 minutes
#   sh tools/protection/installer.sh confirmer → garde les règles, aussi après un redémarrage
#   sh tools/protection/installer.sh retirer   → enlève tout
set -eu
D=$(cd "$(dirname "$0")" && pwd)
case "${1:-essai}" in
  essai)
    nft -c -f "$D/cortege-protection.nft"
    install -m 644 "$D/90-cortege.conf" /etc/sysctl.d/90-cortege.conf
    modprobe nf_conntrack 2>/dev/null || true
    sysctl -q -p /etc/sysctl.d/90-cortege.conf || true
    nft -f "$D/cortege-protection.nft"
    systemd-run --quiet --unit=cortege-protection-essai --on-active=180 /usr/sbin/nft delete table inet cortege_protection || true
    echo "Règles actives pour 3 minutes. Ouvre une NOUVELLE connexion SSH pour vérifier que tu peux toujours entrer,"
    echo "et vérifie le site. Si tout va bien : sh $0 confirmer"
    ;;
  confirmer)
    systemctl stop cortege-protection-essai.timer 2>/dev/null || true
    nft list table inet cortege_protection >/dev/null 2>&1 || nft -f "$D/cortege-protection.nft"
    install -m 644 "$D/cortege-protection.nft" /etc/cortege-protection.nft
    cat > /etc/systemd/system/cortege-protection.service <<UNIT
[Unit]
Description=Protection de Cortège (pare-feu du noyau)
After=network-pre.target
Before=network.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/cortege-protection.nft
ExecStop=/usr/sbin/nft delete table inet cortege_protection
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload && systemctl enable --quiet cortege-protection
    echo "Protection gardée, y compris après un redémarrage du serveur."
    ;;
  retirer)
    systemctl disable --now --quiet cortege-protection 2>/dev/null || true
    nft delete table inet cortege_protection 2>/dev/null || true
    rm -f /etc/cortege-protection.nft /etc/systemd/system/cortege-protection.service /etc/sysctl.d/90-cortege.conf
    systemctl daemon-reload
    echo "Protection retirée."
    ;;
  *) echo "Usage : $0 [essai|confirmer|retirer]"; exit 1 ;;
esac
