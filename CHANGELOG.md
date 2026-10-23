# Nouveautés

Versions : **majeure** (3.0) pour un gros changement visible ou qui casse l'existant, **mineure** (2.1, 2.2…) pour de nouvelles fonctions, **correctif** (2.1.1) pour une réparation sans nouveauté.

## 2.5.1

- Espace presse aux couleurs NERU : fond pastel, titres en Anton (police hébergée sur le serveur, rien chargé chez Google), cartes façon sticker, chiffres du 17 octobre en grand. L’image de présentation garde ses proportions (elle était étirée).

## 2.5.0

- Nouvelle navigation : barre d’onglets en bas (Carte, Infos, Signaler, Droits, Plus). « Infos » réunit les arrêtés qui concernent la zone, les annonces des orgas et l’agenda proche, avec une pastille quand il y a quelque chose à lire. « Droits » met la legal team et le SOS en premier. « Plus » regroupe le reste, avec le soutien Ko-fi et le compte Instagram en tête. Le bouton Ko-fi reste visible en haut de la carte.
- Calques : les puces de filtre sont remplacées par un bouton qui ouvre « Ce que montre la carte » (familles de signalements avec leur nombre, agenda, lieux utiles, caméras).
- Mode manif : écran réduit à la carte, un gros bouton Signaler, le SOS et Droits. Gardé sur le téléphone jusqu’à « Quitter ».
- Langues : anglais, espagnol et arabe (de droite à gauche), en plus du français. Langue du téléphone par défaut, choix dans Plus, Réglages. Traductions dans `i18n/*.tsv`, compilées par `node tools/i18n-build.js` vers `public/lang/`. Le texte français sert de clé ; les libellés et messages d’erreur du serveur sont traduits sur le téléphone. Les notifications, les annonces et arrêtés publiés et les pages annexes (mentions légales, bilans, presse) restent en français.
- Alerte vocale : un danger proche peut être lu à voix haute par la synthèse vocale du téléphone (rien ne part sur Internet). À activer dans Alertes.
- Tout effacer d’un geste : appui long de 2 secondes (ou deux fois Entrée au clavier) dans Droits ou Plus. Efface le stockage local, la file d’attente, les caches, l’abonnement aux notifications et le service worker, puis quitte la page.

## 2.4.5

- Espace presse (`/presse`) : présentation, fonctions, confidentialité, code d’intégration de la carte à copier, outil « carte d’un créneau », citations, visuels, contact (adresse lue dans `CONTACT_EMAIL`).

## 2.4.4

- Arrêtés et restrictions : interdiction de manifester, périmètre interdit, couvre-feu, transports, consignes. Un bandeau s’affiche quand on regarde la zone (commune ou département, contour officiel) ou qu’on s’y trouve ; il donne les dates, chaque mesure et la source. Menu « Arrêtés » : ceux d’ici d’abord, puis le reste de la France, et « Voir la zone sur la carte ».
- N’importe qui peut signaler un arrêté depuis l’appli, avec une source obligatoire ; seul l’admin valide. Onglet Admin « Arrêtés » : validation, publication directe, import d’un bloc préparé (JSON), retrait. Les arrêtés disparaissent tout seuls à la fin.
- Contours : départements de métropole livrés avec l’appli (`geo/departements.json`, simplifiés d’après france-geojson, données IGN sous licence ouverte) ; communes demandées par le serveur à l’API Géo de l’État au moment de la validation (`GEO_API`). Outre-mer : par commune.

## 2.4.3

- Robustesse : plus de 3 000 requêtes aux données absurdes envoyées sur toutes les adresses du serveur, sans plantage. Un corps de requête qui n’est pas un objet JSON est refusé proprement.
- Admin, onglet Direct : depuis combien de temps le serveur tourne, et la cause du dernier plantage s’il y en a eu un dans la semaine (gardée avant que systemd relance le serveur).

## 2.4.2

- Correctif de sécurité : une adresse piégée envoyée par un robot d’attaque (« //%5c%2e%2e/…/etc/passwd ») faisait planter le serveur à chaque requête ; quelques requêtes suffisaient pour que systemd abandonne et que l’appli reste hors ligne (erreur 502). Ces adresses reçoivent maintenant une erreur 400, et toute erreur imprévue dans une requête est notée dans le journal sans arrêter le serveur.

## 2.4.1

- Correctif : la page de l’appli n’est plus jamais refusée quand le serveur est chargé (le délestage ne touche plus que les API non vitales et les tuiles), et seulement après 3 secondes de surcharge continue, jamais pendant les 20 secondes qui suivent un démarrage. Avant, un seul pic d’une seconde (démarrage, import des lieux) pouvait renvoyer une erreur 503 à l’ouverture, que le navigateur d’Instagram affiche comme « Page Web non disponible ».
- Import des lieux : la publication des fichiers rend la main entre deux zones (pic de 1,3 s ramené à 60 ms sur 200 000 lieux).

## 2.4.0

- Caméras de surveillance (`man_made=surveillance` d’OpenStreetMap) : puce « 📷 Caméras », visibles au zoom 17 et plus. Rouge pour les caméras publiques, orange pour les caméras privées qui filment la rue ; les caméras intérieures sont ignorées. Cône de la direction filmée quand elle est connue, fiche avec l’exploitant et la mention du recensement bénévole. Fichiers séparés `l/<zone>-c.json`, chargés seulement au zoom rue.
- Lieux et caméras importés depuis une copie complète d’OpenStreetMap (Geofabrik, `GEOFABRIK_URLS`), triée sur le serveur avec osmium, une fois par mois : vraies préfectures, CRA, horaires, téléphones et urgences. Simple téléchargement de fichier, sans API ni quota ; le gros fichier est effacé juste après. Vérifie qu’il reste environ 6 Go libres. Sans osmium, la carte PMTiles puis Overpass restent utilisés.
- Admin : avancement du téléchargement et de l’extraction, compteur des caméras.

## 2.3.15

- Protection : l’installeur installe nftables s’il manque (Debian minimal).

## 2.3.14

- Protection contre la saturation, sans service extérieur : pare-feu du noyau prêt à installer (`tools/protection/`, essai de 3 minutes avec retrait automatique), plafond de requêtes par adresse dans Node, et délestage quand Node est débordé (signalements, votes et temps réel passent en priorité). L’onglet Direct affiche le retard de Node et les requêtes refusées.
- Documentation : réglages Caddy et défense de Tor (preuve de travail) pour l’adresse .onion.

## 2.3.13

- Lieux : la puce « Lieux » ouvre un choix type par type (préfectures, mairies, commissariats et gendarmeries, tribunaux, centres de rétention, hôpitaux, pharmacies, eau potable). Ils apparaissent plus près : grands lieux au zoom 14, mairies et commissariats au 15, pharmacies et eau au 16 (noms seulement au plus près).
- Nouveautés : les dernières versions sont toutes affichées, la plus récente en premier ; le menu indique la version exacte.

## 2.3.12

- Lieux permanents lus directement dans la carte de France du serveur (fichier PMTiles), dans un fil séparé : plus aucune requête vers Overpass, plus de blocage ni d’attente. Relus automatiquement quand la carte change. Overpass reste utilisé seulement sans carte sur le serveur (ou avec `PLACES_SOURCE=overpass`).
- Outil `tools/pmtiles-pois.js` pour inspecter les lieux d’un fichier de carte.

## 2.3.11

- Lieux permanents : requêtes par valeur exacte (index d’Overpass, bien plus rapide qu’une expression régulière), délai porté à 3 minutes ; une zone trop lente est coupée en quatre, et les zones en échec sont retentées à la fin de l’import.

## 2.3.10

- Lieux permanents : l’admin et le journal du serveur montrent la demande en cours (serveur interrogé, depuis combien de temps) ; l’ancienne erreur est effacée à la reprise.

## 2.3.9

- Lieux permanents : le serveur Overpass de secours (overpass.private.coffee) passe en premier ; overpass-api.de ne répondait pas aux requêtes du serveur.

## 2.3.8

- Lieux permanents : requêtes OpenStreetMap encore allégées (simple rectangle, sans calcul des frontières, qui faisait dépasser le délai), et seuls les carrés qui contiennent une ville de la zone sont demandés (118 au lieu de 208). Avancement écrit dans le journal du serveur à chaque zone.
- Administration : l’onglet ouvert reste dans l’adresse (F5 le rouvre), messages affichés en bas de l’écran, bouton de mise à jour des lieux qui montre ce qu’il fait.

## 2.3.7

- Lieux permanents : l’import reprend là où il s’était arrêté après un redémarrage du serveur (avant, chaque mise à jour le relançait depuis le début, sans jamais finir).
- Requêtes OpenStreetMap plus légères (carrés de 1°, plus de recherche de nom sur tous les objets), second serveur Overpass en secours, réponses incomplètes détectées.
- La carte se remplit au fur et à mesure ; l’admin affiche l’avancement, les lieux trouvés et la dernière erreur.

## 2.3.6

- Carte d’un créneau : les signalements retirés ou contestés restent affichés, en rond vide, avec la mention (retiré par une orga, par l’admin, contesté par des « Plus là »…). Un retrait, même volontaire et en masse, ne fait plus disparaître ce qui a été signalé.

## 2.3.5

- Carte d’un créneau : les points sont relus à chaque ouverture de la page (cache de 2 minutes au lieu de 15), pour ne plus garder d’anciennes heures de fin.

## 2.3.4

- Carte d’un créneau : les signalements archivés sans heure de fin (anciens formats, imports) prennent leur durée normale au lieu de « maintenant », et le créneau compare de vraies heures. Avant, ces journées donnaient « 0 signalement ».

## 2.3.3

- Carte d’un créneau ouverte au public, depuis chaque bilan publié (`/manif/AAAA-MM-JJ/carte`) : on touche la carte (ou on cherche une adresse), on choisit l’heure et le rayon, et on télécharge ou partage l’image.
- Garde-fous : image fabriquée dans le navigateur (aucun calcul sur le serveur), points figés et mis en cache, nombre de demandes limité par réseau, rayon de 2 km et créneau de 6 h au plus, quelques secondes entre deux images. Les signalements retirés ou contestés n’y figurent jamais.

## 2.3.2

- Carte d’un créneau : étiquettes placées sans se chevaucher (ni entre elles, ni sur les points ou les traits), sans les cercles d’imprécision ni le cercle du rayon ; logo, adresse du site et compte Instagram en haut de l’image.

## 2.3.1

- Carte d’un créneau : fond de carte de Cortège (tuiles vectorielles du serveur, même style que l’appli) au lieu des tuiles OpenStreetMap, plus lisible.

## 2.3

- Administration › Digest : « Carte d’un créneau ». Pour un jour, un créneau horaire et un lieu (adresse ou coordonnées) avec un rayon, fabrique une image PNG des signalements actifs, avec leurs heures, et le CSV correspondant. Pour répondre aux demandes de médias ou de legal teams.
- Administration : menu de navigation en colonne, rangé par usage (pendant la manif, organiser, bilans, réglages) ; sur téléphone, un menu déroulant au lieu d'onglets à faire défiler.
- Administration : cases à cocher alignées avec leur texte.

## 2.2

- Lieux permanents sur la carte, depuis OpenStreetMap (mis à jour chaque mois) : préfectures, sous-préfectures, mairies, commissariats, gendarmeries, tribunaux, centres de rétention, hôpitaux dès le zoom quartier ; pharmacies (avec le 3237 pour la pharmacie de garde) et eau potable au zoom rue. Puce « 🏛 Lieux ».
- Notifications : bouton « Recevoir une notification de test » (envoyée par le serveur), statistiques d'envoi et dernière erreur dans l'administration.
- Plus de faux « hors ligne » au retour dans l'appli : reconnexion rapide, et les échecs de ce moment ne font plus passer en mode léger.
- Signalements des orgas confirmées vérifiés d'office et deux fois plus longs ; l'orga peut prolonger ou corriger les siens.
- Administration : onglets Réglages (bandeau daté, vue d'ouverture, types de signalement, rayon d'alerte, distance des notifications), Journées (notification la veille, bandeau et mode renforcé le jour J, bilan proposé le lendemain), Direct (tableau de bord), Modération (points contestés), Lieux (correction, masquage, ajout).
- README simplifié ; documentation technique dans `docs/`.

## 2.1.2

- Carte retravaillée : rues plus visibles (grands axes teintés de violet), eau, parcs et bâtiments mieux marqués, noms de rues et de lieux plus grands dans la police de l'appli.

## 2.1.1

- La zone de la carte hébergée correspond de nouveau au fichier extrait : l'est de la Suisse s'affiche via OpenStreetMap au lieu de rester vide.

## 2.1

- Flèche vers la zone calme la plus proche (moins de 2 km), qui marche aussi sans réseau.
- Pages publiques par manif (`/manif/AAAA-MM-JJ`), publiées depuis le digest : totaux par ville, types, heures, vérification. Aucune position précise.
- Affiche A4 imprimable par ville : QR code de l'appli et numéros de legal team.
- Carte intégrable sur un autre site (`/embed.html`), en lecture seule.
- Réglages « Texte plus grand » et « Contraste renforcé ».
- Hors de la zone de la carte hébergée : repli automatique sur OpenStreetMap .
- « Nouveautés » dans le menu, affichées une fois après chaque mise à jour.

## 2.0

- Hébergement sur un serveur dédié, sans journal de connexion.
- Temps réel : les nouveaux signalements arrivent en environ une seconde.
- Carte vectorielle hébergée sur le serveur (PMTiles) et bouton « Prêt pour la manif » (carte, numéros et agenda hors ligne).
- Adresse .onion (Tor).
- Clé de hachage seulement en mémoire, surveillance du disque et de la mémoire, file d'envoi des notifications.
- Digest regroupé par ville et agglomération, stories Instagram du digest.
- Demandes d'accès orga par formulaire, liens de candidature par ville.
- Annuaire des legal teams vérifié, avec veille quotidienne des sources ; « Mes droits » rangé par ville.
- Nouveau menu en panneau latéral.
- Sauvegarde chiffrée quotidienne (2.0.1).
