# Cortège

[![Tests](https://github.com/n-e-r-u/cortege/actions/workflows/tests.yml/badge.svg)](https://github.com/n-e-r-u/cortege/actions/workflows/tests.yml)

> Carte collaborative des manifestations, en temps réel. Logiciel libre à héberger soi-même.

Carte collaborative en temps réel pour les manifs : on signale CRS, police, BAC, nasses, lacrymo, canon à eau, charges, street medics, legal team, presse, zones calmes, points d'eau, tête de cortège, rues bloquées. Fond de carte OpenStreetMap (Leaflet), application web installable (PWA), serveur Node sans aucune dépendance.

## Lancer

```bash
node server.js            # Node 22.13+ (24 conseillé) ; ouvre http://localhost:8080
```

Variables d'environnement :

| Variable | Défaut ou exemple | Rôle |
|---|---|---|
| `PORT` | `8080` | Port d'écoute |
| `EVENT_NAME` | `Carte des mobilisations` | Texte sous le logo (ex. « Mobilisation du 17 octobre ») |
| `CENTER` / `ZOOM` | `46.6,2.4` / `6` | Vue d'ouverture quand la position n'est pas partagée (France entière) |
| `ADMIN_KEY` | vide | Clé d'accès à l'administration, aléatoire, 12 caractères minimum (32 conseillés). Vide = administration désactivée |
| `ORGA_KEYS` | vide | Accès orga / legal team : `Nom affiché:clé,Autre nom:clé2` (clés de 12 caractères minimum) |
| `CONTACT_EMAIL` | vide | Adresse de contact (mentions légales, bouton « Demander un accès orga »). Obligatoire avant lancement |
| `HOST_INFO` | vide | Coordonnées complètes de l'hébergeur pour les mentions légales |
| `SOURCE_URL` | dépôt d'origine | Lien du dépôt du code (affiché dans le menu et les mentions légales) |
| `LEGAL_WATCH` | `1` | `0` coupe la veille quotidienne des sources de l'annuaire des legal teams |
| `VIOLENCE_URL` | page LDH | Lien du bouton « Signaler une violence policière » |
| `ARCHIVE_DAYS` | `30` | Durée de conservation de l'archive anonyme et du journal des orgas (jours) |
| `TRUST_PROXY` | auto | `1` derrière un proxy (Caddy, Nginx). Activé automatiquement sous Passenger/cPanel |
| `BRAND_HANDLE` | `moncollectif` | Pseudo affiché sous le titre (« Cortège par @moncollectif ») |
| `BRAND_INSTAGRAM` | `https://www.instagram.com/moncollectif/` | Lien du logo et de la carte « Suivre » |
| `BRAND_KOFI` | `https://ko-fi.com/moncollectif` | Bouton « Soutenir » (vide = masqué) |
| `DATA_DIR` | hors du dossier web | Dossier des données privées du serveur. Ne jamais le placer dans un dossier servi par le web |
| `TILE_PMTILES` | vide | Fichier PMTiles (tuiles vectorielles) : la carte vient du serveur lui-même, et « Prêt pour la manif » peut la garder hors ligne |
| `TILE_URL` | tuiles OSM | Fournisseur de tuiles |
| `TILE_UA` | — | User-Agent avec un contact, exigé par la politique OSM |
| `ADMIN_LABEL` | `Cortège` | Nom affiché sur les annonces publiées par l’admin |
| `HOST` | toutes les adresses | Adresse d'écoute. `127.0.0.1` derrière un proxy sur la même machine (Caddy, Nginx) |
| `LIVE_DIR` | `live/` du code | Dossier des fichiers publics de la carte, servi directement par le serveur web si possible |
| `SECRET_STORE` | fichier | `memory` : la clé de hachage n'existe qu'en mémoire, jamais sur le disque (un seul processus ; elle change à chaque redémarrage) |
| `STREAM` | auto | Temps réel (`/api/stream`). Actif par défaut hors Passenger (un seul processus), `0` pour le couper |
| `STREAM_MAX` | `20000` | Nombre maximal de téléphones connectés en temps réel (au-delà : interrogation régulière) |
| `ACCESS_LOGS` | vide | `none` quand le serveur web ne garde aucun journal d'accès (Caddy par défaut) : les mentions légales le disent |
| `ONION_HOST` | vide | Adresse .onion de l'instance (affichée dans le menu) |
| `PUSH_PARALLEL` | `48` | Notifications envoyées en même temps |
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
[Service]
User=cortege
WorkingDirectory=/opt/cortege/app
EnvironmentFile=/etc/cortege.env
ExecStart=/usr/bin/node server.js
Restart=always
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/cortege /srv/cortege-live /opt/cortege/app
UMask=0027
```

`/etc/caddy/Caddyfile` :

```
carte.exemple.org {
	encode zstd gzip
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

### Sauvegarde chiffrée

`tools/cortege-backup.sh` fait chaque nuit une copie cohérente de la base (pendant que l'appli tourne), des accès orga, des clés de notification, de l'archive, de la clé .onion et de la configuration, chiffrée avec [age](https://age-encryption.org) pour une clé publique : la clé secrète reste hors du serveur. 14 copies gardées dans `/var/backups/cortege`.

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

Sans fournisseur de carte : aucune requête de tes utilisateurices ne part ailleurs, et la carte d'une ville peut être gardée sur le téléphone. Un fichier unique pour la France, la Corse et l'outre-mer (quelques Go), découpé dans les builds quotidiens de [Protomaps](https://docs.protomaps.com/basemaps/downloads) (données OpenStreetMap, ODbL).

```bash
# Outil pmtiles (binaire unique) : https://github.com/protomaps/go-pmtiles/releases
install -d -o cortege -g cortege /var/lib/cortege-map
pmtiles extract https://build.protomaps.com/AAAAMMJJ.pmtiles /var/lib/cortege-map/france.pmtiles \
  --region=/opt/cortege/app/tools/france.geojson --maxzoom=15
```

Puis `TILE_PMTILES=/var/lib/cortege-map/france.pmtiles` dans les variables et redémarrage. Hors des zones de `tools/france.geojson`, la carte se replie sur OpenStreetMap (via le proxy du serveur) ; `TILE_PMTILES_REGION` si tu as extrait une autre région. Pour mettre la carte à jour (tous les quelques mois), refaire l'extraction dans un nouveau fichier, puis le renommer à la place de l'ancien et redémarrer.

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
	}
}
```

Sur le site public, ajouter `header Onion-Location http://ADRESSE.onion{uri}` (Tor Browser proposera la version .onion) et `request_header -X-Cortege-Onion` (personne ne peut se faire passer pour Tor). Enfin `ONION_HOST=ADRESSE.onion` dans les variables.

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

## Anti-abus

- Limites de fréquence par téléphone (identifiant aléatoire, jamais stocké en clair) et par réseau.
- Les votes « Plus là » n'effacent jamais un point d'un coup : quand plusieurs personnes, sur des réseaux différents, disent que c'est parti, le point devient « contesté » (grisé) et s'éteint au bout de quelques minutes, sauf si quelqu'un le confirme. Le bouton n'est proposé qu'aux personnes proches du point (calculé sur le téléphone), les votes faits sur place pèsent plus, ceux d'un identifiant tout neuf moins, et les votes en rafale ne comptent pas. Jamais de contestation sur un point vérifié par une orga ; les points contestés passent par la corbeille de l'admin.
- Administration : pause des signalements, suppression d'un point, purge totale.

## Carte nationale

Une seule carte pour toute la France. Le téléphone s'ouvre sur la position de l'utilisateur (si déjà autorisée), sinon sur la France avec une recherche de ville. Il ne charge que les signalements de la zone affichée et des environs de l'utilisateur ; le serveur reçoit seulement des carrés arrondis (≈ 5 km), jamais la position exacte. En dézoomant, les points se regroupent en bulles numérotées.

## Administration

Avec la clé `ADMIN_KEY` :
- **Orgas** : ajouter une orga (nom affiché sur ses annonces) → une invitation à usage unique (QR code + lien, valable 24 h) s'affiche. L'orga la scanne : sa clé est créée à ce moment-là, sur son téléphone, et l'invitation ne sert plus. « Nouvelle invitation » coupe l'accès actuel et en crée un autre. Supprimer une orga coupe son accès immédiatement. Seule l'empreinte des clés est stockée.
- **Parrainage** : une orga confirmée peut inviter d'autres orgas depuis son espace (3 par semaine, QR code ou lien à usage unique). L'orga invitée est « parrainée » : surveillance renforcée (« Vérifier » ne vaut qu'une confirmation forte, retraits et annonces limités, actions visibles par la marraine). Après 7 jours et 10 actions sans incident, elle peut être confirmée par sa marraine ; l'admin peut la confirmer à tout moment. « Révoquer pour abus » coupe une orga et toutes celles qu'elle a fait entrer, et sa marraine ne peut plus inviter pendant 30 jours.
- **Appareils** : l'accès orga n'existe que sur l'appareil qui a ouvert l'invitation (aucun compte, aucun mot de passe). « Ajouter un appareil » crée un lien de 10 minutes pour un deuxième appareil (5 au plus). Une nouvelle invitation coupe tous les appareils.
- **Période d'essai** : une nouvelle orga peut vérifier des signalements et publier des annonces d'info. « Retirer » y compte comme deux « Plus là », ses numéros de legal team et ses événements attendent ta validation, et les annonces urgentes sont réservées aux orgas confirmées. Bouton « Confirmer » dans l'onglet Orgas.
- **Journal** : chaque action d'orga (vérification, retrait, annonce, événement) est enregistrée 30 jours, sans IP. Les points retirés restent une heure dans une corbeille, restaurables d'un clic. Des retraits en rafale bloquent temporairement le retrait pour l'orga concernée et apparaissent dans « À vérifier ».
- **Abus** : tableau des 24 dernières heures (points contestés, votes et signalements en rafale, dangers en série près des zones calmes), par heure et par zone. Gardé 48 h, sans empreinte au-delà d'une heure.
- **Mode manif renforcé** (onglet Abus, 1 à 6 h) : limites divisées par deux et téléphones apparus depuis moins de 10 min sans poids, sans couper les signalements.
- **Effacement d'urgence** (onglet Urgences) : efface d'un coup toutes les traces liées aux personnes et change la clé de hachage. Les orgas et l'agenda sont gardés.
- **Digest** : bilan anonyme par jour.

Sur le téléphone d'une orga apparaissent le badge ORGA et le bouton 📣 : annonces localisées (info ou urgente, 1 à 30 km, 30 min à 12 h), numéro de legal team (avec sa ville, affiché dans « Mes droits » pour tout le monde, rangé par ville), et sur chaque signalement « Vérifier » ou « Retirer (faux) ».

`ORGA_KEYS` (variable) reste possible mais n'est plus nécessaire.

### Annuaire des legal teams

Onglet « Legal teams » de l'administration. Une liste de départ (`legal-seed.json`, sources publiques) est chargée au premier démarrage, **sans rien publier** : chaque ligne doit être vérifiée auprès du collectif puis validée. Une veille relit chaque jour la page source de chaque ligne et signale dans l'onglet si le numéro n'y figure plus ou si d'autres numéros sont apparus. Elle ne publie et ne modifie jamais rien : la décision reste humaine. Modifier le numéro ou la source repasse la ligne en « à valider ».

## Devenir orga

Le bouton « Demander un accès orga » ouvre un formulaire dans l'appli (nom du collectif, ville, lien public, canal officiel). Les demandes arrivent dans l'onglet Orgas de l'administration, à vérifier par les canaux publics du collectif ; elles sont effacées une fois traitées, et au plus tard au bout de 30 jours. L'administration crée aussi des liens de candidature par ville (`/?rejoindre=Ville`, avec QR code) à partager dans les AG : ils ouvrent le formulaire, sans donner aucun accès.

## Digest

Onglet Digest de l'administration : chiffres clés, carte du jour, moments clés (premier danger de chaque type par ville), répartition par type, par heure (par famille) et par ville avec les horaires d'activité, devenir de chaque signalement (expiré, contesté, retiré par une orga ou l'admin…), fiabilité (confirmations, vérifications, durée de visibilité), activité des orgas et de l'anti-abus, comparaison sur 15 jours, résumé prêt à copier et export CSV. Les signalements retirés ou contestés sont gardés et peuvent être inclus ou exclus d'un clic. L'archive ne garde que la catégorie, les heures de début et de fin à la minute, une position arrondie à ~100 m et des compteurs, jamais le texte des précisions ni d'empreinte.

## Comment ça marche

- **Agenda 📅** : manifs, blocus (lycée / fac), rassemblements, AG. Les orgas publient directement (avec parcours tracé sur la carte et point de dispersion) ; tout le monde peut proposer un événement, qui apparaît après validation. Les événements du moment s’affichent sur la carte avec leur parcours.
- **Bien se préparer 🎒** : checklist (sac, téléphone, groupe), conseils pendant la manif, gaz lacrymogène, règle AMIS en cas d’interpellation, et point de ralliement du groupe placé sur la carte (reste sur le téléphone, partageable par messagerie).
- **Import du 17 octobre** : toutes les 15 min, le serveur importe dans l’agenda les manifestations et rassemblements annoncés sur la carte participative 17octobregiletjaune.net (réutilisation autorisée). Les blocages de stations, raffineries, péages ne sont pas importés. Un événement importé retiré par l'administration ne revient pas. Variables : `IMPORT_17OCT=0` pour couper, `IMPORT_17OCT_UNTIL` (défaut `2026-11-01`).
- **SOS** : en cas d’interpellation, un SMS pré-rempli (heure, position, numéro de la legal team de la zone) part vers un proche choisi à l’avance. Le contact reste sur le téléphone, le SMS ne passe pas par le serveur.
- **Économie de batterie** (réglage dans « ? ») : synchro toutes les 20 s, GPS moins précis, boussole coupée.
- **Notifications** (bouton 🔔) : les annonces urgentes et, en option, les dangers signalés près de toi (au plus une alerte toutes les 3 min) arrivent même appli fermée (Web Push chiffré, clés générées au premier démarrage, sans dépendance). Le serveur ne garde que l’adresse de notification et une zone arrondie à ~10 km. Sur iPhone : seulement une fois l’appli installée sur l’écran d’accueil (iOS 16.4+).
- **Annonces nationales** : réservées à l’administration. Les numéros de legal team sont permanents jusqu’à leur retrait.
- **Mes droits** : les numéros de legal team de la ville la plus proche (de ta position, sinon du centre de la carte) en premier, puis les autres villes. Deux sources : l’annuaire permanent, tenu par l’administration (chaque ligne indique sa date de vérification et sa source), et les numéros publiés par les orgas pour une mobilisation. Les derniers numéros connus restent disponibles hors ligne.
- **Menu** : un panneau qui s’ouvre depuis la droite (☰) rassemble Mes droits, la liste, l’agenda, les alertes, la préparation, le partage et les réglages. Sur la carte restent seulement : localiser, chercher, le menu et l’installation à droite ; SOS, soutien et espace orga à gauche.

- **Signaler** : un viseur apparaît (sur ta position si tu l'as activée), tu choisis la catégorie : c'est envoyé tout de suite. Une petite carte propose ensuite d'ajouter une précision (120 caractères).
- **Précisions** : n'importe qui peut ajouter une précision à un point déjà signalé (« ＋ Ajouter une précision » dans sa fiche). Les 3 plus récentes sont affichées, une par téléphone (la sienne peut être corrigée).
- **Fusion** : un signalement du même type tout près d'un point existant le confirme au lieu d'en créer un deuxième (rayon adapté à chaque type ; les forces de l'ordre et la tête de cortège suivent la position la plus récente). Sous le viseur, le bouton indique « déjà là · confirmer ». Chaque point affiche le nombre de personnes qui l'ont signalé.
- **Piles** : des types différents au même endroit s'affichent en une seule pastille ; un appui ouvre la liste, chaque type garde ses votes et sa durée.
- **Danger contre zone calme** : un danger actif près d'une zone calme la suspend sans l'effacer. Elle s'affiche barrée avec un avertissement (ou masquée si le danger est confirmé) et revient d'elle-même quand le danger expire ou est contesté. Les personnes sur place peuvent démentir avec « C'est calme ici ». Une zone vérifiée par une orga résiste aux signalements isolés. On ne peut pas créer de zone calme là où un danger est signalé.
- **File d'attente hors ligne** : sans réseau, le signalement est gardé sur le téléphone avec son heure et part dès que ça capte (en arrière-plan sur Android, à la réouverture sur iPhone). S'il a dépassé sa durée de vie entre-temps, il n'est pas publié.
- **Durée de vie** par catégorie (10 min pour une charge, 15 pour la lacrymo, 45 pour un street medic, etc.). « Toujours là » prolonge (plafond : 4× la durée de base). Des « Plus là » en nombre suffisant le rendent « contesté » : il ne lui reste alors que quelques minutes, sauf nouvelle confirmation.
- **Alerte de proximité** : bandeau + vibration propre à chaque danger (charge, nasse, lacrymo, sommations…) quand il est signalé à moins de 300 m, pour le reconnaître sans sortir le téléphone. La légende est dans le menu 🔔.
- **Fiabilité du jour** : un téléphone dont les signalements sont souvent confirmés par d'autres pèse un peu plus (ses points sont plus durs à contester, ses « Plus là » comptent davantage). Un téléphone qui signale des dangers près de plusieurs zones calmes à la suite voit ses signalements marqués « non confirmés » : ils ne suspendent plus les zones calmes et ne déclenchent pas de notification tant que personne ne les confirme. Tout repart de zéro chaque jour.
- **Réseau faible** : l'appli mesure ses requêtes (et lit l'état du réseau donné par Chrome sur Android). Si ça rame, elle passe en mode léger : une seule requête par rafraîchissement (`live/p/<région>.json`, tous les points d'une région), délais courts, et plus aucun nouveau morceau de carte téléchargé, pour laisser passer les signalements. Un bandeau indique l'âge de ce qui est affiché.
- **Dernière situation connue** : la carte affichée est gardée sur le téléphone. Sans réseau, même à l'ouverture, l'appli la remontre (points non expirés) avec son heure. Les notifications transportent aussi, chiffrés, les derniers signalements autour de la zone de l'abonné·e (≈ 3 Ko) : la carte est à jour à l'ouverture même si le réseau ne passe plus. Sur Android, l'appli installée rafraîchit aussi l'agenda, les annonces et l'interface en arrière-plan.
- **Hors ligne** : l'interface est mise en cache, et les morceaux de carte déjà affichés restent sur le téléphone. Le préchargement d'une zone (« Garder la zone hors ligne ») est désactivé tant que les tuiles viennent d'OpenStreetMap, dont la politique l'interdit ; `TILE_PREFETCH=1` le réactive avec un fournisseur qui l'autorise.
- **Vue nationale** : dézoomé, la carte affiche une bulle par région (nombre de signalements par famille) au lieu de tous les points ; les vrais points autour de toi restent chargés pour les alertes de proximité.

## Sécurité et vérification

- Signaler une faille, ce que l'appli protège et ne protège pas : voir [`SECURITY.md`](SECURITY.md).
- Tests automatiques (`npm test`, sans dépendance) : fusion, votes contestés, zones calmes, fiabilité, mode renforcé, invitations d'orga, effacement d'urgence, notifications, en-têtes de sécurité. Ils tournent sur GitHub à chaque modification (badge en haut de page).
- Vérifier que l'appli en ligne est identique à ce dépôt : `node verifier.js https://carte.exemple.org` (depuis une copie du dépôt, avec l'adresse de l'instance à vérifier). Version et empreintes déclarées : `/api/version`. Si tu remplaces le logo (`public/brand/logo.png`), ce fichier apparaîtra logiquement comme différent.

## Ce que le serveur sait et ne sait pas

- Aucun compte, aucun cookie. Les signalements actifs sont gardés dans une base hors du dossier web et supprimés à expiration.
- La position de l'utilisateur ne quitte jamais le téléphone. Seuls les signalements sont envoyés, arrondis à ~11 m.
- L'anti-spam utilise une empreinte de l'IP (HMAC avec une clé secrète, renouvelée toutes les 6 h), effacée avec le signalement. Sur un hébergement mutualisé, l'hébergeur garde ses propres journaux d'accès : l'appli ne peut rien y faire.
- Les tuiles passent par le serveur : les IP des manifestant·es ne partent pas chez le fournisseur de carte.

## Limites à connaître

- **Faux signalements** : n'importe qui peut poster, y compris pour semer la confusion. Les votes limitent la casse, pas plus. Pour une grosse manif, prévoir des modérateurs ou un mode « signalements vérifiés par la legal team ».
- **Charge** : les lectures sont des fichiers statiques servis par Apache, les écritures passent par SQLite. Sur un mutualisé, la limite devient le nombre de connexions simultanées que l'hébergeur accepte : au-delà de quelques milliers de téléphones ouverts en même temps, passer sur un VPS.
- **Tuiles OSM** : le cache disque limite fortement les appels à OpenStreetMap. Si le trafic explose, passer à un fournisseur de tuiles (Stadia, MapTiler). Ne pas extraire de carte complète sur un hébergement mutualisé : l'extraction (≈ 10 Go) sature les ressources du compte.
- **Réseau saturé** : sans data, plus de temps réel. Pour les échanges entre personnes sans réseau, Briar (Bluetooth/Wi‑Fi) reste l'outil adapté.

Licence AGPL-3.0 : toute version modifiée mise en ligne doit publier son code.

## Pages publiques, affiche et carte à intégrer

- **Bilans** (`/manif`, `/manif/AAAA-MM-JJ`) : publiés depuis l'onglet Digest. Un résumé agrégé est figé à la publication (totaux par ville avec seulement le centre de la ville, types, heures, vérification) ; aucune position de signalement. Il reste en ligne même quand l'archive détaillée est effacée.
- **Affiche A4** (`/affiche.html?ville=…`) : QR code de l'appli et numéros de legal team de la ville (annuaire et numéros publiés par les orgas), à imprimer.
- **Carte à intégrer** (`/embed.html?lat=…&lng=…&z=…`) : lecture seule, sans géolocalisation des visiteur·ices, dans une iframe. C'est la seule page autorisée dans un autre site.
- **Nouveautés** : `public/nouveautes.json`, affiché une fois après chaque nouvelle version ; historique dans `CHANGELOG.md`.

## Stories du digest

Dans l'onglet Digest, « Fabriquer les stories » produit 7 visuels 1080 × 1920 (chiffres bruts, carte des villes, types, heures, villes, vérification, source), avec deux photos facultatives dont le bas est flouté. Tout est calculé dans le navigateur de l'admin ; sur téléphone, « Partager » les envoie directement vers une appli.

## Crédits

Noms et positions des villes du digest : [GeoNames](https://www.geonames.org/) (CC BY 4.0), fichier `places.json`.
Polices des stories : Inter et JetBrains Mono (SIL Open Font License), dans `public/vendor/fonts/`. Rendu de la carte vectorielle : [protomaps-leaflet](https://github.com/protomaps/protomaps-leaflet) (BSD-3-Clause). Fond de carte des stories : Natural Earth via world-atlas (domaine public).
