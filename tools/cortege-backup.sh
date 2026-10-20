#!/bin/sh
# Sauvegarde chiffrée de Cortège (à lancer en root, chaque nuit par le minuteur systemd).
# Contenu : copie cohérente de la base, accès orga, clés de notification, archive du digest,
# clé de l'adresse .onion et fichiers de configuration. Pas la carte (re-téléchargeable).
# Chiffrée avec age pour une clé publique : seule la clé secrète, gardée hors du serveur, peut l'ouvrir.
set -eu
DATA=${CORTEGE_DATA:-/var/lib/cortege}
DEST=${CORTEGE_BACKUP_DIR:-/var/backups/cortege}
PUB=${CORTEGE_BACKUP_PUB:-/etc/cortege-backup.pub}
KEEP=${CORTEGE_BACKUP_DAYS:-14}
READER=${CORTEGE_BACKUP_GROUP:-debian}   # utilisateur qui rapatrie les sauvegardes (lecture seule)
APP_USER=${CORTEGE_USER:-cortege}

[ -s "$PUB" ] || { echo "Clé publique absente : $PUB" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; chmod 711 "$T"
mkdir -p "$T/data" "$T/config"
chown "$APP_USER" "$T/data"

# Copie cohérente de la base pendant que l'appli tourne (lue par l'utilisateur de l'appli)
runuser -u "$APP_USER" -- env OUT="$T/data/cortege.db" SRC="$DATA/cortege.db" \
  node -e 'const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.env.SRC).exec(`VACUUM INTO \x27${process.env.OUT}\x27`)'

for f in orgas.json vapid.json import-17oct.stamp; do [ -e "$DATA/$f" ] && cp -a "$DATA/$f" "$T/data/"; done
[ -d "$DATA/archive" ] && cp -a "$DATA/archive" "$T/data/"
[ -d /var/lib/tor/cortege ] && cp -a /var/lib/tor/cortege "$T/tor-cortege"
for f in /etc/cortege.env /etc/caddy/Caddyfile /etc/tor/torrc /etc/systemd/system/cortege.service; do
  [ -e "$f" ] && cp -a "$f" "$T/config/"
done

mkdir -p "$DEST"; chmod 750 "$DEST"; chgrp "$READER" "$DEST" 2>/dev/null || true
OUT="$DEST/cortege-$(date +%F).tar.gz.age"
tar czf - -C "$T" . | age -R "$PUB" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
chmod 640 "$OUT"; chgrp "$READER" "$OUT" 2>/dev/null || true
ln -sfn "$(basename "$OUT")" "$DEST/latest.tar.gz.age"
find "$DEST" -name 'cortege-*.tar.gz.age' -mtime +"$KEEP" -delete
echo "Sauvegarde : $OUT ($(du -h "$OUT" | cut -f1))"
