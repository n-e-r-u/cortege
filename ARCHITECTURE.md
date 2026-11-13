# Architecture

Cortège est un seul processus Node, sans aucune dépendance : le serveur n'utilise que ce que fournit Node (SQLite intégré, `http`, `crypto`…). Le téléphone reçoit une web app statique (`public/`) et lit des petits fichiers JSON publiés dans `live/`.

## Démarrage

`server.js` est volontairement court. Il charge les modules de `src/`, lance les tâches de fond, puis passe chaque requête aux modules de routes, dans l'ordre. Chaque module de routes renvoie `NEXT` (voir `src/routes/next.js`) quand la requête ne le concerne pas.

## Où trouver quoi

| Dossier ou fichier | Rôle |
|---|---|
| `src/config.js` | Variables d'environnement et constantes partagées |
| `src/db.js` | Base SQLite et **toutes** les tables (créées ou complétées au démarrage) |
| `src/privacy.js` | Clés de hachage par période, empreintes d'IP et de téléphone, IP réelle derrière le proxy, accès Tor |
| `src/util.js` | Petits outils sans état (distances, empreintes, nettoyage de texte, verrou de fichier) |
| `src/categories.js` | Types de signalement et d'événement, fusion, alertes, vibrations |
| `src/profiles.js`, `profiles/`, `geo/countries/` | Profils pays : noms des types, types masqués ou propres au pays, numéros, droits, unités ; contours des pays (Natural Earth) pour savoir quel profil s'applique où. Voir [docs/INSTANCE.md](docs/INSTANCE.md) |
| `src/settings.js`, `src/instance.js` | Réglages modifiés depuis l'admin : bandeau, nom affiché, pause ; nom de la carte, contact, liens, marque (les variables d'environnement servent de valeurs de départ) |
| `src/limits.js` | Limites anti-spam, quotas, plafonds des tables, mode manif renforcé |
| `src/reports/` | Signalements : modèle et vue publique, stockage, votes « Plus là » et fiabilité |
| `src/announcements/`, `src/events/` | Annonces et agenda (stockage, création, import du 17 octobre) |
| `src/orgas/` | Orgas : clés, parrainage, journal, noms réservés, demandes d'accès |
| `src/legal.js`, `src/orders.js` | Annuaire des legal teams, arrêtés et restrictions |
| `src/refuges.js` | Lieux de repli des orgas : enregistrement, créneaux d'ouverture, logos validés par l'admin, publication des lieux ouverts (`live/repli.json`) |
| `src/veille-pref.js` | Veille : repérage des pages utiles d'un site de préfecture (actualités, communiqués, recueil des actes de l'année et du mois) |
| `src/geo/prefectures.js` | Adresses des sites des préfectures (et de la préfecture de police) pour la veille |
| `src/veille.js` | Veille des arrêtés : pages de préfecture et flux relus toutes les 20 minutes, nouveaux liens repérés par mots-clés et proposés à l'admin |
| `src/social.js` | Partage sur Bluesky et Mastodon : messages automatiques (veille et jour J d'une journée, arrêtés regroupés, bilan publié) et écrits par l'admin, relecture facultative, envoi avec nouveaux essais, retrait |
| `src/ideas.js` | Boîte à idées : propositions, validation par l'admin, statuts, votes anonymes par jeton propre à chaque idée, fusion des doublons |
| `src/medic.js`, `src/routes/medic.js` | Mode medic : comptes des équipes (`medics.json`), couche privée en mémoire (positions, points chauds, barrages, renforts), attente longue, notifications des urgences vitales, référent·es |
| `src/orgas/board.js` | Tableau de bord d'une orga (chiffres du journal, prochains rendez-vous) et rappels avant ses rendez-vous (table `orga_push`) |
| `src/orgas/recovery.js` | Code de secours des orgas et des équipes medic (création, saisie tolérante, empreinte) |
| `src/moderation.js`, `src/sweep.js` | File de modération, tableau des abus, ménage toutes les 30 s |
| `src/i18n.js`, `src/i18n-po.js`, `i18n/` | Traductions : un fichier PO par langue dans `i18n/` (voir `i18n/LISEZMOI.md`), construites dans `public/lang/` ; langues déposées dans l'admin (dossier de données), langues proposées et langue par défaut |
| `src/push.js` | Notifications Web Push (chiffrement et VAPID faits à la main) et traductions côté serveur |
| `src/geo/` | Carte hébergée (PMTiles), proxy de tuiles, communes, départements, villes, recherche de lieux |
| `src/places/` | Lieux permanents et caméras (OpenStreetMap, copie Geofabrik) |
| `src/digest/` | Archive anonyme, lignes d'une journée, bilans publiés |
| `src/pages/` | Pages HTML fabriquées par le serveur : bilans, agenda, arrêtés, villes, droits |
| `src/live/` | Publication des fichiers `live/`, minuteur, temps réel (Server-Sent Events) |
| `src/http/` | Réponses, fichiers statiques et politique de sécurité, version en ligne, protection contre la saturation |
| `src/routes/` | Les routes HTTP, par domaine : pages, API publique, admin (dont `admin-config.js` : instance, pays, langues, serveur), signalements, orgas, fichiers |
| `src/server-info.js` | État du serveur pour l'admin : version publiée, disque, mémoire, cartes, dernière sauvegarde |
| `src/mobs.js`, `src/migrate.js` | Journées de mobilisation prévues, reprise des anciennes données |
| `client/app/`, `client/admin/` | Le code du téléphone et de la page admin, en morceaux numérotés par fonction (carte, synchro, signaler, orga, agenda…) |
| `public/` | Ce que sert le serveur : la web app, l'admin, les pages statiques, les traductions (`public/lang/`, construites depuis `i18n/`) |
| `tools/` | Outils hors serveur : extraction de la carte, tracé par les rues, sauvegarde, traductions |

## Le code du téléphone et de l'admin

Il est écrit dans `client/app/` et `client/admin/`, en morceaux numérotés. `npm run build` (ou `node tools/build-client.js`) les assemble dans `public/app.js` et `public/admin.js`, dans l'ordre des numéros. Les fichiers assemblés restent dans le dépôt : rien à construire au déploiement, et les téléphones gardent un seul fichier à télécharger, important sur un réseau saturé.

Les morceaux de `client/app/` sont placés dans une seule fonction : ils partagent leurs variables (la carte, l'état de l'orga, les caches).

`client/parts/` contient les parties chargées à la demande, copiées telles quelles dans `public/app-<nom>.js` : aujourd'hui l'écran medic, que seuls les téléphones qui ont un accès medic téléchargent. Une partie ne partage pas les variables du reste : elle reçoit ce dont elle a besoin dans un objet (`core`, voir la fin de `client/app/17-acces.js`), et lit par `core.x` ce qui change au fil du temps. ESLint vérifie qu'elle n'utilise aucun nom qu'elle n'a pas reçu, et que les scripts assemblés n'en utilisent aucun d'inconnu. Ne modifie jamais `public/app.js` ou `public/admin.js` à la main : un test vérifie qu'ils correspondent à `client/`.

## Règles de dépendance entre modules

- Un module ne dépend que de modules plus « bas » que lui : `config`, `db`, `util` en bas, les routes tout en haut. Il n'y a pas d'import circulaire.
- Quand un module bas doit déclencher un module haut (par exemple republier les fichiers `live/` après un enregistrement), il passe par un point de branchement : `scheduleFlush` dans `src/live/files.js`, branché sur la publication par `setFlusher`.
- Un état qui change et que plusieurs modules lisent est un objet partagé (`dirty`, `pub`, `placesState`, `cityIdx`) ou une fonction (`pushRunningNow()`), jamais une variable `let` exportée : sa copie ne se mettrait pas à jour.
- Les tâches de fond (ménage, imports, archive) démarrent au chargement de leur module.

## Vérifier un changement

`npm test` lance le serveur pour de vrai et le teste de bout en bout. Les tests doivent tous passer, et un nouveau comportement mérite un test.
