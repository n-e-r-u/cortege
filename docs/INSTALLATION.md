# Installer Cortège

Tout ce qu'il faut pour héberger ta propre instance. Pour découvrir l'appli, commence par le [README](../README.md).

## Lancer

```bash
node server.js            # Node 22.13+ (24 conseillé) ; ouvre http://localhost:8080
```

Variables d'environnement. Celles marquées « admin » se règlent aussi dans l'administration, sans redémarrer : la variable ne sert alors que de valeur de départ.

| Variable | Défaut ou exemple | Rôle |
|---|---|---|
| `PORT` | `8080` | Port d'écoute |
| `EVENT_NAME` | `Carte des mobilisations` | Texte sous le logo par défaut (modifiable dans Administration › Réglages, avec des dates) |
| `CENTER` / `ZOOM` | `46.6,2.4` / `6` | Vue d'ouverture par défaut quand la position n'est pas partagée (modifiable aussi dans Réglages) |
| `ADMIN_KEY` | vide | Clé d'accès à l'administration, aléatoire, 12 caractères minimum (32 conseillés). Vide = administration désactivée |
| `ORGA_KEYS` | vide | Accès orga / legal team : `Nom affiché:clé,Autre nom:clé2` (clés de 12 caractères minimum) |
| `CONTACT_EMAIL` | vide | Adresse de contact (mentions légales, bouton « Demander un accès orga »). Obligatoire avant lancement (admin) |
| `HOST_INFO` | vide | Coordonnées complètes de l'hébergeur pour les mentions légales (admin) |
| `SOURCE_URL` | dépôt d'origine | Lien du dépôt du code (affiché dans le menu et les mentions légales) (admin) |
| `LEGAL_WATCH` | `1` | `0` coupe la veille quotidienne des sources de l'annuaire des legal teams |
| `VIOLENCE_URL` | page LDH | Lien du bouton « Signaler une violence policière » (admin) |
| `ARCHIVE_DAYS` | `30` | Durée de conservation de l'archive anonyme (jours) |
| `ORGA_LOG_DAYS` | `0` | Durée de conservation du journal des orgas, en jours. `0` : historique complet, gardé sans limite |
| `REFUGE_MAX` | `1` | Nombre de lieux de repli qu'une orga certifiée peut enregistrer par défaut (1 à 30) ; l'admin peut le régler orga par orga |
| `TRUST_PROXY` | auto | `1` derrière un proxy (Caddy, Nginx). Activé automatiquement sous Passenger/cPanel. Les en-têtes du proxy ne sont crus que pour les connexions venant de la machine elle-même (ou de `PROXY_IPS`) |
| `PROXY_IPS` | vide | Adresses du proxy s'il n'est pas sur la même machine (ex. passerelle Docker `172.17.0.1`), séparées par des virgules |
| `CLOUDFLARE` | `0` | `1` seulement si l'instance est vraiment derrière Cloudflare : l'en-tête `CF-Connecting-IP` est alors cru. Sinon il est ignoré (n'importe qui peut l'envoyer) |
| `ONION_SECRET` | vide | Valeur secrète que le bloc .onion de Caddy met dans `X-Cortege-Onion` (au lieu de `1`). Sans `ONION_SECRET` ni `ONION_HOST`, l'en-tête est ignoré : personne ne peut se faire passer pour Tor, même si le site public ne supprime pas l'en-tête |
| `ONION_KEY_TRIES` | `30` | Essais de clé orga ratés acceptés en 5 min pour tout le trafic Tor réuni (Tor ne donne pas d'adresse IP : sans ce compteur commun, un robot changerait d'identifiant à chaque essai) |
| `PUSH_ONION_MAX` | `2000` | Abonnements aux notifications créés par Tor (toutes connexions Tor réunies) |
| `IMPORT_17OCT_MAX` | `400` | Nombre maximal d'événements repris de la carte du 17 octobre (les plus proches dans le temps sont gardés) |
| `BRAND_HANDLE` | `moncollectif` | Pseudo affiché sous le titre (« Cortège par @moncollectif ») (admin) |
| `BRAND_INSTAGRAM` | `https://www.instagram.com/moncollectif/` | Lien du logo et de la carte « Suivre » (admin) |
| `BRAND_KOFI` | `https://ko-fi.com/moncollectif` | Bouton « Soutenir » (vide = masqué) (admin) |
| `DATA_DIR` | hors du dossier web | Dossier des données privées du serveur. Ne jamais le placer dans un dossier servi par le web |
| `TILE_PMTILES` | vide | Fichier(s) PMTiles installés à la main (tuiles vectorielles), séparés par des virgules : un par pays (zone lue dans le `.geojson` du même nom), puis éventuellement une carte du monde légère pour les zooms éloignés. Facultatif depuis la 2.10.5 : les cartes se téléchargent dans l'admin (onglet Pays). Une carte téléchargée remplace le fichier de même nom |
| `MAP_DIR` | `DATA_DIR/cartes` | Dossier des cartes téléchargées depuis l'admin (non sauvegardé : elles se re-téléchargent) |
| `PMTILES_BIN` | `pmtiles` | Chemin de l'outil pmtiles, utilisé pour découper les cartes |
| `MAP_MAXZOOM` / `MAP_WORLD_MAXZOOM` | `15` / `6` | Zoom le plus proche d'une carte de pays, et de la carte du monde |
| `PROFILES` | `fr` | Profils pays de l'instance (`profiles/*.json`), séparés par des virgules : `fr`, `us`, `de`… Le premier sert aussi hors de toutes les zones. Voir [INSTANCE.md](INSTANCE.md) (admin › Pays) |
| `DEFAULT_LANG` | langue du premier profil | Langue des téléphones dont la langue n'est pas traduite (admin) |
| `TILE_URL` | tuiles OSM | Fournisseur de tuiles |
| `TILE_UA` | — | User-Agent avec un contact, exigé par la politique OSM |
| `ADMIN_LABEL` | `Cortège` | Nom affiché sur les annonces publiées par l’admin |
| `HOST` | toutes les adresses | Adresse d'écoute. `127.0.0.1` derrière un proxy sur la même machine (Caddy, Nginx) |
| `LIVE_DIR` | `live/` du code | Dossier des fichiers publics de la carte, servi directement par le serveur web si possible |
| `SECRET_STORE` | fichier | Clés de hachage : une par période (6 h pour les IP, un jour pour les téléphones), détruites à la fin de la période suivante, dans `DATA_DIR/keys`. `memory` : seulement en mémoire, jamais sur le disque (un seul processus) |
| `STREAM` | auto | Temps réel (`/api/stream`). Actif par défaut hors Passenger (un seul processus), `0` pour le couper |
| `STREAM_MAX` | `20000` | Nombre maximal de téléphones connectés en temps réel (au-delà : interrogation régulière) |
| `ACCESS_LOGS` | vide | `none` quand le serveur web ne garde aucun journal d'accès (Caddy par défaut) : les mentions légales le disent |
| `ONION_HOST` | vide | Adresse .onion de l'instance (affichée dans le menu) |
| `PUSH_PARALLEL` | `48` | Notifications envoyées en même temps |
| `PLACES_IMPORT` | `1` | `0` coupe l'import automatique des lieux permanents (le bouton de l'admin reste disponible) |
| `PLACES_SOURCE` | auto | `osm` (copie Geofabrik triée par osmium, par défaut si `osmium` est installé), `carte` (lus dans le fichier PMTiles, sans caméras), `overpass` |
| `GEOFABRIK_URLS` | France entière | Fichier(s) `.osm.pbf` de Geofabrik à télécharger chaque mois, séparés par des virgules (ex. une seule région pour un petit serveur). Les contours des communes (bilans par commune) sortent du même fichier |
| `GOOGLE_SITE_VERIFICATION` | vide | Nom du fichier de validation Google Search Console (ex. `google0123456789abcdef.html`) : le serveur le sert à la racine |
| `BLUESKY_HANDLE` / `BLUESKY_APP_PASSWORD` | vide | Compte Bluesky de l'instance (ex. `moncollectif.bsky.social`) et **mot de passe d'application** (Bluesky › Réglages › Confidentialité et sécurité › Mots de passe d'application), jamais le mot de passe du compte. Active le partage automatique (admin › Réseaux) |
| `BLUESKY_PDS` | `https://bsky.social` | Serveur du compte Bluesky, seulement s'il est hébergé ailleurs |
| `MASTODON_URL` / `MASTODON_TOKEN` | vide | Adresse de l'instance Mastodon (ex. `https://mastodon.social`) et jeton d'accès d'une application créée dans Préférences › Développement, avec le seul droit `write:statuses` (et `read:accounts` pour « Tester la connexion ») |
| `GEO_API` | geo.api.gouv.fr | API Géo de l'État : contour officiel d'une commune, demandé par le serveur à la validation d'un arrêté |
| `OSM_MIN_FREE_GB` | `6` | Place libre exigée sur le disque avant de télécharger |
| `OVERPASS_URL` | overpass-api.de | Serveur Overpass utilisé pour cet import |
| `PUBLIC_URL` | `https://carte.exemple.org` | Adresse publique de ton instance (identifie le serveur auprès des services de notification si `CONTACT_EMAIL` est vide) |

## Logo

Dépose ton logo en `public/brand/logo.png` (carré, 512×512 conseillé). Il s'affiche en haut à gauche et dans la carte Instagram. Sans fichier, un logo par défaut prend sa place. Les icônes de l’appli installée (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) sont générées à partir de ce logo.

## Mettre en ligne

### Hébergement mutualisé avec cPanel (Passenger)

1. cPanel › **Setup Node.js App** › Create Application : **Node 24** (22.13 minimum), mode Production, racine `cortege`, URL de ton (sous-)domaine, fichier de démarrage `server.js`.
2. Envoie le contenu du zip dans `~/cortege` (Gestionnaire de fichiers › Upload › Extraire).
3. Variables d'environnement dans le même écran (voir tableau), puis **Restart**.
4. Domaines › active **Forcer la redirection HTTPS** pour le sous-domaine.
5. Vérifie `https://carte.exemple.org/api/health` : `storageWritable` et `ipHeaderSeen` doivent valoir `true`.

Aucun `npm install` n'est nécessaire (zéro dépendance). Après une mise à jour des fichiers : bouton **Restart**. Les téléphones qui ont l'appli ouverte détectent la nouvelle version dans les secondes qui suivent et se rechargent tout seuls, au même endroit de la carte. Si quelqu'un est en train de signaler ou d'écrire, un bandeau s'affiche et la mise à jour attend qu'il ait fini.

Mise à jour depuis une version d'avant SQLite : les données sont reprises automatiquement au premier démarrage.

### VPS (Debian / Ubuntu) avec Caddy

Node derrière Caddy, qui gère le HTTPS et sert directement les fichiers publics de la carte.

```bash
# Utilisateur, code, données et fichiers publics
useradd --system --create-home --home-dir /opt/cortege --shell /usr/sbin/nologin cortege
sudo -u cortege git clone https://github.com/n-e-r-u/cortege /opt/cortege/app
install -d -o cortege -g cortege -m 700 /var/lib/cortege
install -d -o cortege -g caddy -m 2750 /srv/cortege-live
```

`/etc/cortege.env` (droits 600) : `PORT=8080`, `HOST=127.0.0.1`, `TRUST_PROXY=1`, `DATA_DIR=/var/lib/cortege`, `LIVE_DIR=/srv/cortege-live`, `SECRET_STORE=memory`, `ACCESS_LOGS=none`, puis tes autres variables.

Service systemd (`/etc/systemd/system/cortege.service`) :

```ini
[Unit]
StartLimitIntervalSec=0

[Service]
User=cortege
WorkingDirectory=/opt/cortege/app
EnvironmentFile=/etc/cortege.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cortege /srv/cortege-live /opt/cortege/app
UMask=0027
```

Cloisonnement supplémentaire (Node ne voit plus que ses dossiers, sans aucun privilège) : `sudo mkdir -p /etc/systemd/system/cortege.service.d && sudo cp tools/systemd/durcissement.conf /etc/systemd/system/cortege.service.d/`, puis `daemon-reload` et redémarrage. La note de `systemd-analyze security cortege` baisse nettement (8,7 sans ce fichier).

`/etc/caddy/Caddyfile` :

```
carte.exemple.org {
	encode zstd gzip
	# Personne ne peut choisir son « IP » ni se faire passer pour Tor
	request_header -CF-Connecting-IP
	request_header -X-Cortege-Onion
	handle_path /live/* {
		root * /srv/cortege-live
		header Cache-Control "public, max-age=2, must-revalidate"
		header X-Content-Type-Options nosniff
		file_server {
			hide .htaccess
		}
	}
	handle {
		reverse_proxy 127.0.0.1:8080
	}
}
```

Caddy ne garde aucun journal d'accès tant qu'on ne lui en demande pas. Ouvrir les ports TCP 80 et 443, et UDP 443 pour HTTP/3. Mise à jour : `cd /opt/cortege/app && sudo -u cortege git pull && systemctl restart cortege`.

### Lieux et caméras de surveillance

```bash
apt install -y osmium-tool
```

Avec osmium, le serveur télécharge une fois par mois la copie d'OpenStreetMap de Geofabrik (environ 4,5 Go pour la France), en extrait les lieux et les caméras à basse priorité, puis efface le fichier. Compter environ 6 Go libres pendant l'opération et quelques minutes de calcul. Premier import deux minutes après le redémarrage, ou avec le bouton de l'onglet Lieux de l'admin.

### Sauvegarde chiffrée

`tools/cortege-backup.sh` fait chaque nuit une copie cohérente de la base (pendant que l'appli tourne), des accès orga, des clés de notification, de l'archive, de la clé .onion et de la configuration, chiffrée avec [age](https://age-encryption.org) pour une clé publique : la clé secrète reste hors du serveur. 14 copies gardées dans `/var/backups/cortege`.

La copie contient `/etc/cortege.env`, donc `ADMIN_KEY` et `SECRET` s'il est défini : garde la clé secrète age aussi précieusement que ces valeurs. Avec `SECRET_STORE=memory`, les clés de hachage, elles, ne sont jamais sur le disque ni dans la sauvegarde.

```bash
apt install -y age
age-keygen -o /root/cle-sauvegarde.txt          # garde le contenu dans ton gestionnaire de mots de passe
age-keygen -y /root/cle-sauvegarde.txt > /etc/cortege-backup.pub && shred -u /root/cle-sauvegarde.txt
install -m 700 tools/cortege-backup.sh /usr/local/sbin/cortege-backup
cp tools/cortege-backup.service tools/cortege-backup.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cortege-backup.timer && systemctl start cortege-backup
```

Une copie hors du serveur est indispensable : `tools/sauvegarde-pc.ps1` la rapatrie chaque jour sur un PC Windows (tâche planifiée). Restauration : `age -d -i cle.txt sauvegarde.tar.gz.age | tar xz`, puis remettre `data/` dans `DATA_DIR`, `tor-cortege/` dans `/var/lib/tor/cortege` (propriétaire `debian-tor`) et les fichiers de `config/`.

### Carte hébergée sur le serveur (Protomaps)

Sans fournisseur de carte : aucune requête de tes utilisateurices ne part ailleurs, et la carte d'une ville peut être gardée sur le téléphone. Les cartes sont découpées dans les builds quotidiens de [Protomaps](https://docs.protomaps.com/basemaps/downloads) (données OpenStreetMap, ODbL) : quelques Go pour la France (outre-mer compris), autant pour l'Allemagne, quelques centaines de Mo pour une carte du monde légère qui sert en dézoomant.

Une seule installation, l'outil `pmtiles` (binaire unique, [go-pmtiles](https://github.com/protomaps/go-pmtiles/releases)) :

```bash
curl -fsSL https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz | sudo tar xz -C /usr/local/bin pmtiles
```

(`Linux_arm64` à la place de `Linux_x86_64` sur un serveur ARM.) Ensuite tout se fait dans l'admin, onglet **Pays › Cartes hébergées** : un bouton par pays coché, plus la carte du monde. Le serveur cherche la dernière version, calcule la taille et vérifie la place libre avant de télécharger, puis met la carte en service sans redémarrer. « Mettre à jour » refait la même chose tous les quelques mois ; la carte en place reste servie pendant le téléchargement. Refusé un jour de mobilisation (bande passante). Les lieux permanents sont relus dans la nouvelle carte si elle en est la source.

Les cartes vont dans `DATA_DIR/cartes` (déjà accessible au service, pas de changement dans systemd). Une carte installée à la main avant la 2.10.5 (`TILE_PMTILES`) continue de marcher ; si tu télécharges la même depuis l'admin (même nom de fichier, par exemple `france.pmtiles`), la nouvelle prend sa place et tu peux supprimer l'ancien fichier puis retirer `TILE_PMTILES`.

À la main, sans l'admin :

```bash
install -d -o cortege -g cortege /var/lib/cortege-map
pmtiles extract https://build.protomaps.com/AAAAMMJJ.pmtiles /var/lib/cortege-map/france.pmtiles \
  --region=/opt/cortege/app/tools/france.geojson --maxzoom=15
```

Puis `TILE_PMTILES=/var/lib/cortege-map/france.pmtiles` dans les variables et redémarrage. Hors des zones de la carte, l'appli se replie sur OpenStreetMap (via le proxy du serveur) ; `TILE_PMTILES_REGION` si tu as extrait une autre région.

### Adresse .onion (Tor)

Pour que ton opérateur ne voie même pas que tu utilises l'appli. Sur le VPS : `apt install tor`, puis dans `/etc/tor/torrc` :

```
HiddenServiceDir /var/lib/tor/cortege/
HiddenServicePort 80 127.0.0.1:8081
```

Après `systemctl restart tor`, l'adresse est dans `/var/lib/tor/cortege/hostname`. Dans le Caddyfile, un deuxième site, local, qui marque les requêtes venues de Tor (l'anti-spam se fonde alors sur l'identifiant du téléphone, sinon tout Tor partagerait une seule limite) :

```
http://:8081 {
	bind 127.0.0.1
	handle_path /live/* {
		root * /srv/cortege-live
		file_server {
			hide .htaccess
		}
	}
	handle {
		reverse_proxy 127.0.0.1:8080 {
			header_up X-Cortege-Onion 1
		}
		# avec ONION_SECRET=… dans les variables : header_up X-Cortege-Onion LA_MÊME_VALEUR
	}
}
```

Sur le site public, ajouter `header Onion-Location http://ADRESSE.onion{uri}` (Tor Browser proposera la version .onion) et `request_header -X-Cortege-Onion` (personne ne peut se faire passer pour Tor). Enfin `ONION_HOST=ADRESSE.onion` dans les variables.

### Résister à la saturation (sans service extérieur)

Aucun intermédiaire de type Cloudflare : il verrait l'adresse IP de chaque visiteur. La protection se fait sur le serveur lui-même, à trois niveaux.

1. **Pare-feu du noyau** (`tools/protection/`) : une adresse qui ouvre des centaines de connexions par seconde est mise de côté 10 minutes, une adresse qui garde des milliers de connexions ouvertes est refusée, et les essais SSH en série sont freinés. Les limites sont larges, car des milliers de téléphones partagent parfois une adresse d'opérateur mobile. Réglages réseau du noyau en plus (protection contre les inondations de demandes de connexion).
   ```bash
   sudo sh tools/protection/installer.sh            # essai : tout est retiré seul au bout de 3 minutes
   sudo sh tools/protection/installer.sh confirmer  # après avoir vérifié qu'une nouvelle connexion SSH passe
   sudo sh tools/protection/installer.sh retirer
   ```
2. **Caddy** : délais courts pour les connexions lentes. En tête du Caddyfile :
   ```
   {
   	servers {
   		timeouts {
   			read_header 10s
   			read_body 30s
   			idle 2m
   		}
   		max_header_size 16KB
   	}
   }
   ```
3. **Node** : `FLOOD_MAX` requêtes par minute et par adresse au plus (6000 par défaut, les fichiers `live/` ne comptent pas), et, si Node est débordé (retard de plus de `LAG_SHED` ms, 500 par défaut), seul l'essentiel passe : envoyer un signalement, voter, le temps réel. Les téléphones gardent la carte en cache. L'onglet Direct de l'admin montre le retard et les requêtes refusées.

**Adresse .onion** : Tor sait se défendre seul. Dans `/etc/tor/torrc`, sous `HiddenServiceDir`, ajoute :
```
HiddenServiceEnableIntroDoSDefense 1
HiddenServicePoWDefensesEnabled 1
```
Pendant une attaque, les navigateurs Tor résolvent un petit calcul avant d'entrer : les vraies visites passent, les robots coûtent cher. L'adresse .onion reste aussi un repli quand l'adresse normale est noyée.

Une attaque par le volume (plus de trafic que la connexion du serveur n'en accepte) ne se règle pas sur le serveur : elle dépend de la protection réseau de l'hébergeur.

### VPS avec Docker

```bash
docker build -t cortege . && docker run -d -p 127.0.0.1:8080:8080 -v cortege-data:/data -e DATA_DIR=/data -e EVENT_NAME="Manif 18 oct." cortege
```

## Charge serveur

- **Base de données** : SQLite intégré à Node (`node:sqlite`, mode WAL), dans `DATA_DIR`. Plusieurs processus Passenger peuvent écrire en même temps sans se marcher dessus.
- **Lectures** : Node publie dans `live/` des fichiers statiques (par zone de ~5 km) qu'Apache sert sans réveiller Node. Ils ne contiennent que ce que la carte affiche publiquement. Les publications sont regroupées et ne touchent que les zones modifiées.
- **Temps réel** (hors Passenger) : le téléphone s'abonne aux régions de ~100 km qu'il affiche et le serveur le prévient dès qu'une région change ; l'interrogation régulière passe alors à 30 s, comme filet de sécurité.
- **Rythme des téléphones** : 5 s s'il se passe quelque chose autour (signalement de moins de 15 min ou changement récent), 12 s sinon, 20 s en vue nationale, ×3 en mode économie. Décalage aléatoire de ±15 % pour éviter les pics synchronisés ; espacement jusqu'à 60 s si le réseau sature. Presque toutes les réponses sont des 304 vides.
- **Carte vectorielle** (`TILE_PMTILES`) : Node lit directement les tuiles dans le fichier PMTiles et les envoie compressées ; le téléphone les dessine (protomaps-leaflet) et les garde en cache.
- **Tuiles** : chaque tuile téléchargée une fois chez OpenStreetMap est écrite dans `tiles/` ; Apache la sert ensuite. Purge automatique au-delà de 30 jours (`TILE_DAYS`).
