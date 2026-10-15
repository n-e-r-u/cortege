# Cortège

> La carte en direct des manifs, par [@neru](https://www.instagram.com/neru/) — [neru.tv](https://neru.tv). En ligne sur **[cortege.neru.tv](https://cortege.neru.tv)**.

Carte collaborative en temps réel pour les manifs : on signale CRS, police, BAC, nasses, lacrymo, canon à eau, charges, street medics, legal team, presse, zones calmes, points d'eau, tête de cortège, rues bloquées. Fond de carte OpenStreetMap (Leaflet), application web installable (PWA), serveur Node sans aucune dépendance.

## Lancer

```bash
node server.js            # Node 18+ ; ouvre http://localhost:8080
```

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8080` | Port d'écoute |
| `EVENT_NAME` | `Carte des mobilisations` | Texte sous le logo (ex. « Mobilisation du 17 octobre ») |
| `CENTER` / `ZOOM` | `46.6,2.4` / `6` | Vue d'ouverture quand la position n'est pas partagée (France entière) |
| `ADMIN_KEY` | vide | Clé d'accès au digest (`/digest.html`). Vide = digest désactivé |
| `ORGA_KEYS` | vide | Accès orga / legal team : `Nom affiché:clé,Autre nom:clé2` (clés de 12 caractères minimum) |
| `CONTACT_EMAIL` | vide | Adresse de contact affichée dans les mentions légales (obligatoire avant lancement) |
| `HOST_INFO` | vide | Coordonnées complètes de l'hébergeur pour les mentions légales |
| `SOURCE_URL` | vide | Lien du dépôt GitHub (affiché dans les mentions légales) |
| `VIOLENCE_URL` | page LDH | Lien du bouton « Signaler une violence policière » |
| `ARCHIVE_DAYS` | `60` | Durée de conservation de l'archive anonyme |
| `TRUST_PROXY` | auto | `1` derrière un proxy (Caddy, Nginx). Activé automatiquement sous Passenger/cPanel |
| `BRAND_HANDLE` | `neru` | Pseudo affiché (« Cortège par @neru ») |
| `BRAND_INSTAGRAM` | `https://www.instagram.com/neru/` | Lien du logo et de la carte « Suivre » |
| `DATA_DIR` | `~/.cortege-data` | Où est gardé l'état partagé (hors du dossier web) |
| `TILE_URL` | tuiles OSM | Fournisseur de tuiles |
| `TILE_UA` | — | User-Agent avec un contact, exigé par la politique OSM |
| `ADMIN_LABEL` | `Cortège` | Nom affiché sur les annonces publiées par l’admin |
| `PUBLIC_URL` | `https://cortege.neru.tv` | Adresse publique (identifie le serveur auprès des services de notification si `CONTACT_EMAIL` est vide) |

## Logo

Dépose ton logo en `public/brand/logo.png` (carré, 512×512 conseillé). Il s'affiche en haut à gauche et dans la carte Instagram. Sans fichier, un logo par défaut prend sa place. Les icônes de l’appli installée (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) sont générées à partir de ce logo.

## Mettre en ligne

### Hébergement cPanel (o2switch et similaires)

1. cPanel › **Setup Node.js App** › Create Application : Node 20 ou plus, mode Production, racine `cortege`, URL `cortege.neru.tv`, fichier de démarrage `server.js`.
2. Envoie le contenu du zip dans `~/cortege` (Gestionnaire de fichiers › Upload › Extraire).
3. Variables d'environnement dans le même écran (voir tableau), puis **Restart**.
4. Domaines › active **Forcer la redirection HTTPS** pour le sous-domaine.
5. Vérifie `https://cortege.neru.tv/api/health` : `storageWritable` et `ipHeaderSeen` doivent valoir `true`.

Aucun `npm install` n'est nécessaire (zéro dépendance). Après une mise à jour des fichiers : bouton **Restart**.

### VPS avec Docker

```bash
docker build -t cortege . && docker run -d -p 127.0.0.1:8080:8080 -v cortege-data:/data -e DATA_DIR=/data -e EVENT_NAME="Manif 18 oct." cortege
```

## Charge serveur

- **Lectures** : Node écrit `live/index.json`, `live/c/<case>.json`, `live/all.json`, `live/ann.json` après chaque écriture. Sur cPanel, le dossier de l'appli est la racine web : Apache sert ces fichiers directement, Node n'est jamais réveillé pour lire. Les téléphones lisent l'index toutes les 5 s (réponse 304 vide si rien n'a changé), puis seulement les cases modifiées autour d'eux. En vue nationale : `all.json` toutes les 15 s.
- **Tuiles** : chaque tuile téléchargée une fois chez OpenStreetMap est écrite dans `tiles/` ; Apache la sert ensuite. Purge automatique au-delà de 30 jours (`TILE_DAYS`).
- **Écritures** (signalements, votes, annonces) : seules requêtes traitées par Node.
- Réseau saturé : les téléphones espacent automatiquement leurs requêtes (jusqu'à 30 s).

## Anti-abus

- Limites par téléphone (identifiant aléatoire, jamais stocké en clair) : 8 signalements et 40 votes / 5 min. Plafond large par IP (60 / 400) car en 4G des centaines d'abonnés partagent la même adresse.
- Un point est retiré par 2 « Plus là » venant de 2 réseaux différents (et plus nombreux que les « Toujours là ») ; jamais s'il est vérifié par une orga.
- Admin › Urgences : pause des signalements (15 min / 1 h), suppression d'un point, purge totale.

## Carte nationale

Une seule carte pour toute la France. Le téléphone s'ouvre sur la position de l'utilisateur (si déjà autorisée), sinon sur la France avec une recherche de ville. Il ne charge que les signalements de la zone affichée et des environs de l'utilisateur ; le serveur reçoit seulement des carrés arrondis (≈ 5 km), jamais la position exacte. En dézoomant, les points se regroupent en bulles numérotées.

## Administration : `cortege.neru.tv/admin.html`

Avec la clé `ADMIN_KEY` :
- **Orgas** : ajouter une orga (nom affiché sur ses annonces) → un lien d'accès unique `https://cortege.neru.tv/?orga=…` s'affiche une seule fois, à copier et envoyer par Signal. Supprimer une orga coupe son accès immédiatement. Seule l'empreinte des clés est stockée (`~/.cortege-data/orgas.json`).
- **Digest** : bilan anonyme par jour.

Sur le téléphone d'une orga apparaissent le badge ORGA et le bouton 📣 : annonces localisées (info ou urgente, 1 à 30 km, 30 min à 12 h), numéro de legal team (affiché dans « Mes droits » pour la zone), et sur chaque signalement « Vérifier » ou « Retirer (faux) ». Ton lien `?orga=ADMIN_KEY` peut tout retirer.

`ORGA_KEYS` (variable) reste possible mais n'est plus nécessaire.

## Digest

Onglet Digest de la page admin : total du jour, par type (avec l'heure du premier signalement), par heure, par ville, et un résumé prêt à copier. L'archive ne garde que la catégorie, l'heure à la minute et une position arrondie à ~100 m. Les points retirés par « Plus là » sont exclus.

## Comment ça marche

- **Agenda 📅** : manifs, blocus (lycée / fac), rassemblements, AG. Les orgas publient directement (avec parcours tracé sur la carte et point de dispersion) ; tout le monde peut proposer un événement, qui apparaît après validation dans admin › Agenda. Les événements du moment s’affichent sur la carte avec leur parcours.
- **Bien se préparer 🎒** : checklist (sac, téléphone, groupe), conseils pendant la manif, gaz lacrymogène, règle AMIS en cas d’interpellation, et point de ralliement du groupe placé sur la carte (reste sur le téléphone, partageable par messagerie).
- **SOS** : en cas d’interpellation, un SMS pré-rempli (heure, position, numéro de la legal team de la zone) part vers un proche choisi à l’avance. Le contact reste sur le téléphone, le SMS ne passe pas par le serveur.
- **Économie de batterie** (réglage dans « ? ») : synchro toutes les 20 s, GPS moins précis, boussole coupée.
- **Notifications** (réglage dans « ? ») : les annonces urgentes arrivent même appli fermée (Web Push chiffré, clés VAPID générées au premier démarrage dans `DATA_DIR/vapid.json`, sans dépendance). Le serveur ne garde que l’adresse de notification et une zone arrondie à ~10 km. Sur iPhone : seulement une fois l’appli installée sur l’écran d’accueil (iOS 16.4+).
- **Annonces nationales** : admin › Annonces, ou case « Annonce nationale » dans l’espace orga avec le lien admin. Les numéros de legal team sont permanents jusqu’à leur retrait.

- **Signaler** : un viseur apparaît (sur ta position si tu l'as activée), tu choisis la catégorie, précision facultative de 120 caractères.
- **Durée de vie** par catégorie (10 min pour une charge, 15 pour la lacrymo, 45 pour un street medic, etc.). « Toujours là » prolonge (plafond : 4× la durée de base). Deux « Plus là » majoritaires suppriment le point.
- **Alerte de proximité** : vibration + bandeau si lacrymo, charge, nasse, canon à eau ou forces de l'ordre sont signalés à moins de 300 m.
- **Hors ligne** : l'interface est mise en cache, et « Garder la zone hors ligne » télécharge les tuiles du parcours avant le départ, pour quand le réseau sature.

## Ce que le serveur sait et ne sait pas

- Aucun compte, aucun cookie. Les signalements actifs sont gardés dans un petit fichier (`~/.cortege-data/state.json`, hors du dossier web) et supprimés à expiration.
- La position de l'utilisateur ne quitte jamais le téléphone. Seuls les signalements sont envoyés, arrondis à ~11 m.
- L'anti-spam utilise une empreinte de l'IP (HMAC avec une clé secrète, renouvelée toutes les 6 h), effacée avec le signalement. Sur un hébergement mutualisé, l'hébergeur garde ses propres journaux d'accès : l'appli ne peut rien y faire.
- Les tuiles passent par le serveur : les IP des manifestant·es ne partent pas chez le fournisseur de carte.

## Limites à connaître

- **Faux signalements** : n'importe qui peut poster, y compris pour semer la confusion. Les votes limitent la casse, pas plus. Pour une grosse manif, prévoir des modérateurs ou un mode « signalements vérifiés par la legal team ».
- **Charge** : chaque téléphone interroge le serveur toutes les 5 s (réponse vide si rien n'a changé). Ça tient quelques centaines de personnes sur un mutualisé ; au-delà, passer sur un VPS.
- **Tuiles OSM** : le cache disque limite fortement les appels à OpenStreetMap. Si le trafic explose, passer à un fournisseur de tuiles (Stadia, MapTiler). Ne pas extraire de carte complète sur un hébergement mutualisé : l'extraction (≈ 10 Go) sature les ressources du compte.
- **Réseau saturé** : sans data, plus de temps réel. Pour les échanges entre personnes sans réseau, Briar (Bluetooth/Wi‑Fi) reste l'outil adapté.

Licence AGPL-3.0 : toute version modifiée mise en ligne doit publier son code.
