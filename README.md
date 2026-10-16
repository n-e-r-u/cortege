# Cortège

> La carte en direct des manifs, par [@neru](https://www.instagram.com/neru/) — [neru.tv](https://neru.tv). En ligne sur **[cortege.neru.tv](https://cortege.neru.tv)**.

Carte collaborative en temps réel pour les manifs : on signale CRS, police, BAC, nasses, lacrymo, canon à eau, charges, street medics, legal team, presse, zones calmes, points d'eau, tête de cortège, rues bloquées. Fond de carte OpenStreetMap (Leaflet), application web installable (PWA), serveur Node sans aucune dépendance.

## Lancer

```bash
node server.js            # Node 22.13+ (24 conseillé) ; ouvre http://localhost:8080
```

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | Port d'écoute |
| `EVENT_NAME` | `Carte des mobilisations` | Texte sous le logo (ex. « Mobilisation du 17 octobre ») |
| `CENTER` / `ZOOM` | `46.6,2.4` / `6` | Vue d'ouverture quand la position n'est pas partagée (France entière) |
| `ADMIN_KEY` | vide | Clé d'accès à l'administration, aléatoire, 12 caractères minimum (32 conseillés). Vide = administration désactivée |
| `ORGA_KEYS` | vide | Accès orga / legal team : `Nom affiché:clé,Autre nom:clé2` (clés de 12 caractères minimum) |
| `CONTACT_EMAIL` | vide | Adresse de contact (mentions légales, bouton « Demander un accès orga »). Obligatoire avant lancement |
| `HOST_INFO` | vide | Coordonnées complètes de l'hébergeur pour les mentions légales |
| `SOURCE_URL` | vide | Lien du dépôt GitHub (affiché dans les mentions légales) |
| `VIOLENCE_URL` | page LDH | Lien du bouton « Signaler une violence policière » |
| `ARCHIVE_DAYS` | `60` | Durée de conservation de l'archive anonyme |
| `TRUST_PROXY` | auto | `1` derrière un proxy (Caddy, Nginx). Activé automatiquement sous Passenger/cPanel |
| `BRAND_HANDLE` | `neru` | Pseudo affiché (« Cortège par @neru ») |
| `BRAND_INSTAGRAM` | `https://www.instagram.com/neru/` | Lien du logo et de la carte « Suivre » |
| `BRAND_KOFI` | `https://ko-fi.com/neru` | Bouton « Soutenir Cortège » (vide = masqué) |
| `DATA_DIR` | hors du dossier web | Dossier des données privées du serveur. Ne jamais le placer dans un dossier servi par le web |
| `TILE_URL` | tuiles OSM | Fournisseur de tuiles |
| `TILE_UA` | — | User-Agent avec un contact, exigé par la politique OSM |
| `ADMIN_LABEL` | `Cortège` | Nom affiché sur les annonces publiées par l’admin |
| `PUBLIC_URL` | `https://cortege.neru.tv` | Adresse publique (identifie le serveur auprès des services de notification si `CONTACT_EMAIL` est vide) |

## Logo

Dépose ton logo en `public/brand/logo.png` (carré, 512×512 conseillé). Il s'affiche en haut à gauche et dans la carte Instagram. Sans fichier, un logo par défaut prend sa place. Les icônes de l’appli installée (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) sont générées à partir de ce logo.

## Mettre en ligne

### Hébergement cPanel (o2switch et similaires)

1. cPanel › **Setup Node.js App** › Create Application : **Node 24** (22.13 minimum), mode Production, racine `cortege`, URL `cortege.neru.tv`, fichier de démarrage `server.js`.
2. Envoie le contenu du zip dans `~/cortege` (Gestionnaire de fichiers › Upload › Extraire).
3. Variables d'environnement dans le même écran (voir tableau), puis **Restart**.
4. Domaines › active **Forcer la redirection HTTPS** pour le sous-domaine.
5. Vérifie `https://cortege.neru.tv/api/health` : `storageWritable` et `ipHeaderSeen` doivent valoir `true`.

Aucun `npm install` n'est nécessaire (zéro dépendance). Après une mise à jour des fichiers : bouton **Restart**.

Mise à jour depuis une version d'avant SQLite : les données sont reprises automatiquement au premier démarrage.

### VPS avec Docker

```bash
docker build -t cortege . && docker run -d -p 127.0.0.1:8080:8080 -v cortege-data:/data -e DATA_DIR=/data -e EVENT_NAME="Manif 18 oct." cortege
```

## Charge serveur

- **Base de données** : SQLite intégré à Node (`node:sqlite`, mode WAL), dans `DATA_DIR`. Plusieurs processus Passenger peuvent écrire en même temps sans se marcher dessus.
- **Lectures** : Node publie dans `live/` des fichiers statiques (par zone de ~5 km) qu'Apache sert sans réveiller Node. Ils ne contiennent que ce que la carte affiche publiquement. Les publications sont regroupées et ne touchent que les zones modifiées.
- **Rythme des téléphones** : 5 s s'il se passe quelque chose autour (signalement de moins de 15 min ou changement récent), 12 s sinon, 20 s en vue nationale, ×3 en mode économie. Décalage aléatoire de ±15 % pour éviter les pics synchronisés ; espacement jusqu'à 60 s si le réseau sature. Presque toutes les réponses sont des 304 vides.
- **Tuiles** : chaque tuile téléchargée une fois chez OpenStreetMap est écrite dans `tiles/` ; Apache la sert ensuite. Purge automatique au-delà de 30 jours (`TILE_DAYS`).

## Anti-abus

- Limites de fréquence par téléphone (identifiant aléatoire, jamais stocké en clair) et par réseau.
- Un point peut être retiré par les votes « Plus là » de plusieurs personnes ; jamais s'il est vérifié par une orga.
- Administration : pause des signalements, suppression d'un point, purge totale.

## Carte nationale

Une seule carte pour toute la France. Le téléphone s'ouvre sur la position de l'utilisateur (si déjà autorisée), sinon sur la France avec une recherche de ville. Il ne charge que les signalements de la zone affichée et des environs de l'utilisateur ; le serveur reçoit seulement des carrés arrondis (≈ 5 km), jamais la position exacte. En dézoomant, les points se regroupent en bulles numérotées.

## Administration

Avec la clé `ADMIN_KEY` :
- **Orgas** : ajouter une orga (nom affiché sur ses annonces) → un lien d'accès unique s'affiche une seule fois, à transmettre par messagerie chiffrée. Supprimer une orga coupe son accès immédiatement. Seule l'empreinte des clés est stockée.
- **Période d'essai** : une nouvelle orga peut vérifier des signalements et publier des annonces d'info. « Retirer » y compte comme deux « Plus là », ses numéros de legal team et ses événements attendent ta validation, et les annonces urgentes sont réservées aux orgas confirmées. Bouton « Confirmer » dans l'onglet Orgas.
- **Journal** : chaque action d'orga (vérification, retrait, annonce, événement) est enregistrée 60 jours, sans IP. Les points retirés restent une heure dans une corbeille, restaurables d'un clic. Des retraits en rafale bloquent temporairement le retrait pour l'orga concernée et apparaissent dans « À vérifier ».
- **Digest** : bilan anonyme par jour.

Sur le téléphone d'une orga apparaissent le badge ORGA et le bouton 📣 : annonces localisées (info ou urgente, 1 à 30 km, 30 min à 12 h), numéro de legal team (affiché dans « Mes droits » pour la zone), et sur chaque signalement « Vérifier » ou « Retirer (faux) ».

`ORGA_KEYS` (variable) reste possible mais n'est plus nécessaire.

## Digest

Onglet Digest de l'administration : total du jour, par type (avec l'heure du premier signalement), par heure, par ville, et un résumé prêt à copier. L'archive ne garde que la catégorie, l'heure à la minute et une position arrondie à ~100 m. Les points retirés par « Plus là » sont exclus.

## Comment ça marche

- **Agenda 📅** : manifs, blocus (lycée / fac), rassemblements, AG. Les orgas publient directement (avec parcours tracé sur la carte et point de dispersion) ; tout le monde peut proposer un événement, qui apparaît après validation. Les événements du moment s’affichent sur la carte avec leur parcours.
- **Bien se préparer 🎒** : checklist (sac, téléphone, groupe), conseils pendant la manif, gaz lacrymogène, règle AMIS en cas d’interpellation, et point de ralliement du groupe placé sur la carte (reste sur le téléphone, partageable par messagerie).
- **Import du 17 octobre** : toutes les 15 min, le serveur importe dans l’agenda les manifestations et rassemblements annoncés sur la carte participative 17octobregiletjaune.net (réutilisation autorisée). Les blocages de stations, raffineries, péages ne sont pas importés. Un événement importé retiré par l'administration ne revient pas. Variables : `IMPORT_17OCT=0` pour couper, `IMPORT_17OCT_UNTIL` (défaut `2026-11-01`).
- **SOS** : en cas d’interpellation, un SMS pré-rempli (heure, position, numéro de la legal team de la zone) part vers un proche choisi à l’avance. Le contact reste sur le téléphone, le SMS ne passe pas par le serveur.
- **Économie de batterie** (réglage dans « ? ») : synchro toutes les 20 s, GPS moins précis, boussole coupée.
- **Notifications** (réglage dans « ? ») : les annonces urgentes arrivent même appli fermée (Web Push chiffré, clés générées au premier démarrage, sans dépendance). Le serveur ne garde que l’adresse de notification et une zone arrondie à ~10 km. Sur iPhone : seulement une fois l’appli installée sur l’écran d’accueil (iOS 16.4+).
- **Annonces nationales** : réservées à l’administration. Les numéros de legal team sont permanents jusqu’à leur retrait.

- **Signaler** : un viseur apparaît (sur ta position si tu l'as activée), tu choisis la catégorie : c'est envoyé tout de suite. Une petite carte propose ensuite d'ajouter une précision (120 caractères).
- **Précisions** : n'importe qui peut ajouter une précision à un point déjà signalé (« ＋ Ajouter une précision » dans sa fiche). Les 3 plus récentes sont affichées, une par téléphone (la sienne peut être corrigée).
- **Fusion** : un signalement du même type tout près d'un point existant le confirme au lieu d'en créer un deuxième (rayon adapté à chaque type ; les forces de l'ordre et la tête de cortège suivent la position la plus récente). Sous le viseur, le bouton indique « déjà là · confirmer ». Chaque point affiche le nombre de personnes qui l'ont signalé.
- **Piles** : des types différents au même endroit s'affichent en une seule pastille ; un appui ouvre la liste, chaque type garde ses votes et sa durée.
- **Danger contre zone calme** : un danger signalé près d'une zone calme la retire, et on ne peut pas marquer calme une zone où un danger est signalé.
- **File d'attente hors ligne** : sans réseau, le signalement est gardé sur le téléphone avec son heure et part dès que ça capte (en arrière-plan sur Android, à la réouverture sur iPhone). S'il a dépassé sa durée de vie entre-temps, il n'est pas publié.
- **Durée de vie** par catégorie (10 min pour une charge, 15 pour la lacrymo, 45 pour un street medic, etc.). « Toujours là » prolonge (plafond : 4× la durée de base). Deux « Plus là » majoritaires suppriment le point.
- **Alerte de proximité** : vibration + bandeau si lacrymo, charge, nasse, canon à eau ou forces de l'ordre sont signalés à moins de 300 m.
- **Hors ligne** : l'interface est mise en cache, et les morceaux de carte déjà affichés restent sur le téléphone. Le préchargement d'une zone (« Garder la zone hors ligne ») est désactivé tant que les tuiles viennent d'OpenStreetMap, dont la politique l'interdit ; `TILE_PREFETCH=1` le réactive avec un fournisseur qui l'autorise.
- **Vue nationale** : dézoomé, la carte affiche une bulle par région (nombre de signalements par famille) au lieu de tous les points ; les vrais points autour de toi restent chargés pour les alertes de proximité.

## Sécurité et vérification

- Signaler une faille, ce que l'appli protège et ne protège pas : voir [`SECURITY.md`](SECURITY.md).
- Vérifier que l'appli en ligne est identique à ce dépôt : `node verifier.js https://cortege.neru.tv` (depuis une copie du dépôt). Version et empreintes déclarées : `/api/version`. Si tu remplaces le logo (`public/brand/logo.png`), ce fichier apparaîtra logiquement comme différent.

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
