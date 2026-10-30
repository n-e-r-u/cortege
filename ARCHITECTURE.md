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
| `src/settings.js` | Réglages modifiés depuis l'admin, bandeau, nom affiché, pause |
| `src/limits.js` | Limites anti-spam, quotas, plafonds des tables, mode manif renforcé |
| `src/reports/` | Signalements : modèle et vue publique, stockage, votes « Plus là » et fiabilité |
| `src/announcements/`, `src/events/` | Annonces et agenda (stockage, création, import du 17 octobre) |
| `src/orgas/` | Orgas : clés, parrainage, journal, noms réservés, demandes d'accès |
| `src/legal.js`, `src/orders.js` | Annuaire des legal teams, arrêtés et restrictions |
| `src/moderation.js`, `src/sweep.js` | File de modération, tableau des abus, ménage toutes les 30 s |
| `src/push.js` | Notifications Web Push (chiffrement et VAPID faits à la main) et traductions côté serveur |
| `src/geo/` | Carte hébergée (PMTiles), proxy de tuiles, communes, départements, villes, recherche de lieux |
| `src/places/` | Lieux permanents et caméras (OpenStreetMap, copie Geofabrik) |
| `src/digest/` | Archive anonyme, lignes d'une journée, bilans publiés |
| `src/pages/` | Pages HTML fabriquées par le serveur : bilans, agenda, arrêtés, villes, droits |
| `src/live/` | Publication des fichiers `live/`, minuteur, temps réel (Server-Sent Events) |
| `src/http/` | Réponses, fichiers statiques et politique de sécurité, version en ligne, protection contre la saturation |
| `src/routes/` | Les routes HTTP, par domaine : pages, API publique, admin, signalements, orgas, fichiers |
| `src/mobs.js`, `src/migrate.js` | Journées de mobilisation prévues, reprise des anciennes données |
| `public/` | La web app (carte, admin, pages statiques) et ses traductions (`public/lang/`, construites depuis `i18n/`) |
| `tools/` | Outils hors serveur : extraction de la carte, tracé par les rues, sauvegarde, traductions |

## Règles de dépendance entre modules

- Un module ne dépend que de modules plus « bas » que lui : `config`, `db`, `util` en bas, les routes tout en haut. Il n'y a pas d'import circulaire.
- Quand un module bas doit déclencher un module haut (par exemple republier les fichiers `live/` après un enregistrement), il passe par un point de branchement : `scheduleFlush` dans `src/live/files.js`, branché sur la publication par `setFlusher`.
- Un état qui change et que plusieurs modules lisent est un objet partagé (`dirty`, `pub`, `placesState`, `cityIdx`) ou une fonction (`pushRunningNow()`), jamais une variable `let` exportée : sa copie ne se mettrait pas à jour.
- Les tâches de fond (ménage, imports, archive) démarrent au chargement de leur module.

## Vérifier un changement

`npm test` lance le serveur pour de vrai et le teste de bout en bout. Les tests doivent tous passer, et un nouveau comportement mérite un test.
