# Nouveautés

Versions : **majeure** (3.0) pour un gros changement visible ou qui casse l'existant, **mineure** (2.1, 2.2…) pour de nouvelles fonctions, **correctif** (2.1.1) pour une réparation sans nouveauté.

## 2.8.1

- Données structurées des événements (Google Search Console) : ajout de l’organisateur (l’orga qui a publié), de l’image, de l’entrée gratuite, de la fin (estimée à 3 h après le début) et de l’adresse.

## 2.8.0

- Bilans précis : les positions gardées pour les bilans passent d’environ 100 m à une dizaine de mètres (comme sur la carte en direct), pour la presse et les legal teams. Les journées archivées avant gardent leur ancienne précision.
- Bilans plus complets : rang de la journée parmi les bilans publiés et évolution depuis le précédent, moments clés (premier signalement de chaque danger, ville par ville), durée de chaque danger par ville, parcours réel des cortèges d’après le chemin de leur tête (longueur, heures, vitesse moyenne), arrêtés en vigueur ce jour-là avec leurs sources. Les bilans déjà publiés sont complétés tant que l’archive de la journée existe.
- Une page par ville et par journée (au moins 20 signalements) : chiffres, schéma du parcours et des signalements, moments clés, durées, arrêtés, et la carte d’un créneau déjà centrée sur la ville.
- Données ouvertes : chaque bilan propose un fichier CSV (un signalement par ligne, position, commune, heures, confirmations, devenir), sous licence CC BY 4.0.
- Pages publiques pour le référencement, sans script : `/agenda`, `/arretes`, `/villes` et une page par ville (agenda, arrêtés, legal team, bilans), `/droits`, `/legal-teams`. Menu commun à toutes les pages publiques, plan du site complété.
- Admin : nom affiché au choix dans les réglages (au lieu de « Cortège »), réservé. Nouveau point « viens me voir pour un accès orga », partagé en direct par l’admin, avec le logo et une phrase libre ; toutes les orgas peuvent aussi ajouter une phrase à leur position en direct.
- Les arrêtés terminés sont gardés 8 jours (non affichés sur la carte) pour que les bilans les citent.

## 2.7.1

- Position en direct des orgas, garde-fous pour ne jamais révéler où la personne va après la manif :
  - le serveur arrête le partage dès qu’une position arrive à plus de 2 km du point de départ (et du parcours d’une manif en cours de l’agenda), sans enregistrer cette position ; le point de départ n’est jamais publié ;
  - toutes les 30 min, l’appli demande « Tu es toujours en manif ? » (vibration, bandeau orange) ; plus tôt si plus rien ne se passe à moins de 300 m depuis 10 min ; sans réponse en 3 min, le partage s’arrête ;
  - bandeau vert toujours visible pendant le partage, avec « Arrêter » ;
  - 1 h par défaut (30 min, 1 h, 2 h ou 4 h), 4 h au maximum côté serveur (au lieu de 8 h).
- Tête et queue de cortège : un signalement à moins de 2 km (au lieu de 300 m) déplace le point existant au lieu d’en créer un deuxième. Pratique pour un long cortège ou une tête signalée en retard.
- Cortège entre la queue et la tête : il suit maintenant les rues. D’abord le parcours annoncé, sinon le chemin réellement suivi par la tête (trace gardée 60 min pour la tête), sinon le plus court chemin piéton calculé par le serveur sur les rues de la carte hébergée (tuiles PMTiles, sans autoroutes ni voies ferrées, aucun service extérieur). À défaut, ligne fine en pointillés marquée « à vol d’oiseau ».

## 2.7.0

- Tête de cortège qui suit vraiment le cortège : un seul point, que chaque nouveau signalement à moins de 300 m déplace, avec la trace pointillée des 30 dernières minutes, une flèche de direction et la vitesse (« Avance vers le nord-ouest, environ 3 km/h »). Durée de base ramenée à 10 min, relancée à chaque signalement.
- Nouveau signalement « Queue de cortège » (🔚). Avec une tête et une queue, la carte dessine le cortège entre les deux et affiche sa longueur (« Cortège : environ 480 m »).
- Sur un parcours dessiné dans l’agenda : la partie déjà parcourue est surlignée, avec l’avancée en pourcentage, une estimation de la fin, et « Arrive près de toi dans environ 12 min » si tu es plus loin sur le parcours (calculé sur le téléphone, ta position ne part jamais).
- Position en direct pour les orgas confirmées : dans l’espace orga, « Ma position en direct » comme street medic, legal team, presse, tête ou queue de cortège, pour qu’on les trouve facilement. Envoi toutes les 30 s tant que l’appli est ouverte (l’écran reste allumé), point marqué « En direct » avec le nom de l’orga, qui disparaît 3 min après le dernier envoi. Arrêt à la main, à la fin de la durée choisie (1, 2 ou 4 h) ou au bout de 8 h. Le serveur ne garde que la dernière position (et, pour la tête et la queue seulement, le chemin des 30 dernières minutes). Une orga en période d’essai ne peut pas l’utiliser.
- Mentions légales : la position en direct des orgas est décrite.

## 2.6.5

Durcissement, suite du même audit.

- Orgas en période d’essai : « Vérifier » compte comme une confirmation forte, sans la coche « vérifié », et toutes leurs annonces (info comprises) attendent la validation de l’admin.
- Limites pour toutes les orgas (sauf l’admin) : 30 vérifications par 5 min, 3 annonces urgentes par heure (une orga piratée ne peut pas inonder les téléphones de notifications), 30 annonces et 20 événements par jour. Une orga bloquée en rafale apparaît dans le tableau des abus (« orga en rafale »), en plus de son journal.
- Veille des legal teams : le serveur ne va chercher que des adresses publiques (jamais lui-même, le réseau local ni les adresses internes de l’hébergeur), vérifiées au moment de la connexion, ports 80 et 443, 3 redirections au plus, chacune revérifiée.
- Notifications : au plus 60 nouveaux abonnements par réseau et par 6 h, désabonnements et notifications de test limités par réseau, abonnement supprimé après 5 refus d’affilée du service de notification (hors erreurs de notre côté), au plus 3 000 zones différentes par envoi.
- Charge : tables plafonnées (empreintes de téléphones, abus, limites, journal des orgas), cache des tuiles plafonné en mémoire (64 Mo, `TILE_CACHE_MB`) et sur le disque (2 Go, `TILE_DISK_GB`, les plus anciennes partent d’abord), tuiles OpenStreetMap délestées en premier quand le serveur est débordé.
- Clés de hachage : une clé tirée au hasard pour chaque période (6 h pour les adresses IP, un jour pour les téléphones), détruite à la fin de la période suivante. Même avec une copie du disque, les empreintes passées ne peuvent plus être recalculées. L’ancienne clé unique est effacée au démarrage.
- Mentions légales complétées : services de notification des navigateurs (Google, Apple, Mozilla, Microsoft), abonnement temps réel par zones d’environ 100 km, arrêtés proposés, contenu exact du journal des orgas et de la corbeille, tout ce qui est gardé sur le téléphone, ce que voit un hébergeur ou quelqu’un qui prendrait le contrôle du serveur, limites de l’effacement d’urgence. Plus aucun « nous ».

## 2.6.4

Correctif de sécurité, suite à un audit signalé en privé. Merci à la personne qui l’a fait.

- Orgas : les droits ne reposent plus sur le nom affiché. Chaque annonce et chaque événement garde l’identifiant de l’orga qui l’a publié ; seule elle (ou l’admin) peut le retirer, et « mes annonces » ne montre que les siennes. Avant, une orga qui prenait le même nom qu’une autre (ou que l’admin) pouvait retirer ses annonces. Les annonces et événements existants sont rattachés à leur orga au démarrage, seulement quand il n’y a aucun doute ; sinon, seul·e l’admin peut les retirer.
- Noms réservés : le nom de l’admin, « Cortège », les sources importées et les noms déjà pris sont refusés, sans tenir compte des accents, majuscules, espaces et lettres sosies (cyrillique, grec). Une orga invitée par parrainage ne peut pas non plus prendre le nom d’une legal team de l’annuaire, ni un nom qui contient « Cortège ». L’admin voit un avertissement sur toute orga existante dont le nom pose problème.
- Adresse IP : les en-têtes du proxy (`X-Forwarded-For`…) ne sont crus que si la connexion vient de la machine elle-même ou d’une adresse listée dans `PROXY_IPS`. `CF-Connecting-IP` est ignoré sauf avec `CLOUDFLARE=1`. Avant, n’importe qui pouvait changer d’« IP » à chaque requête et contourner les limites (signalements, votes, essais de clé). Nouvelle option `ONION_SECRET` pour que personne ne puisse se faire passer pour Tor. Docker : `TRUST_PROXY=0` par défaut.
- L’empreinte d’un téléphone n’est enregistrée qu’après la limite d’envois (un identifiant inventé à chaque requête refusée ne remplit plus la table).
- Effacement d’urgence : efface aussi l’empreinte du téléphone dans les propositions d’arrêtés, continue même si un fichier de l’archive résiste (et le signale), et peut supprimer les bilans publics (case à cocher). L’admin rappelle ce qu’un effacement logiciel ne peut pas toucher (sauvegardes de l’hébergeur, copies, disque).
- `SECURITY.md` précise combien de temps les actions d’un même appareil peuvent être reliées entre elles.

## 2.6.3

- Nouveau signalement « Milice / groupe fasciste » (☠️), demandé par les manifestant·es après les attaques d’extrême droite contre des cortèges : famille Danger, alerte « danger près de toi » et alerte vocale, vibration propre (une longue, deux courtes, une longue), suspend les zones calmes voisines. Visible 20 min, fusion à 150 m, le point suit le groupe. Aide de la précision : « Combien, direction, armes visibles. Pas de nom ni de photo. »
- Onglet Droits : « Attaque d’un groupe fasciste », que faire (rester groupé·e, aller vers le service d’ordre ou les street medics, signaler sur la carte, 15 ou 112, porter plainte).

## 2.6.2

- Carte « Par ville » des bilans publics et des stories lisible : les communes d’une même agglomération (moins de 15 km) sont regroupées sous le nom de la plus active, les cercles sont plus petits et plafonnés, et les étiquettes se placent autour de leur cercle (8 positions essayées) sans chevaucher une autre étiquette ni un autre cercle. Les 5 villes les plus actives ont toujours leur étiquette : s’il n’y a pas de place, elle s’écarte un peu ou passe au-dessus des petits cercles voisins. Le détail par commune reste dans la liste sous la carte.

## 2.6.1

- Correctif : les bilans publics affichaient le code INSEE des communes (75056, 34172…) au lieu de leur nom. Les bilans déjà publiés sont corrigés automatiquement à l’affichage.

## 2.6.0

- Bilans justes : le digest, les bilans publics, les stories et la comparaison sur 15 jours ne comptent plus que la France (métropole et outre-mer). Les signalements envoyés d’ailleurs restent sur la carte en direct ; leur nombre est indiqué à part (« N signalements hors de France »), et la carte du digest se cadre sur la France.
- Une commune par signalement : les contours des communes d’OpenStreetMap sont extraits pendant l’import mensuel des lieux (même passage d’osmium, aucun service extérieur), et chaque point est rattaché à la commune qui le contient. Avant le premier import, l’ancien rattachement à la ville ou l’agglomération la plus proche reste utilisé.
- Annoncer une manif : bouton « Annoncer une manif » sous l’agenda dans l’onglet Infos, et « Organiser une manif » dans Plus. Les deux ouvrent directement le formulaire.
- Modération repensée : le plus urgent en haut (dangers contestés, séries de dangers près des zones calmes, points isolés à plus de 500 km de toute autre activité, points hors de France), une explication en clair pour chaque point, filtres par ville et par type. Les simples « pas encore confirmé » du mode renforcé sont cachés par défaut et ne gonflent plus le badge. « Garder » devient « C’est vrai ».
- Notifications dans la langue de l’appli (français, anglais, espagnol, arabe) : la langue est envoyée avec l’abonnement.
- Nouvelle alerte « Nouveaux arrêtés dans ta zone » : quand un arrêté est validé, les abonné·es de sa zone sont prévenu·es. Plusieurs arrêtés validés d’affilée partent en une seule notification. Réglable dans Alertes.
- Référencement : `robots.txt`, plan du site, titres et descriptions sans tiret long, données structurées (appli gratuite, auteur, événements de l’agenda), adresse canonique, pages d’outils exclues des moteurs, validation Google Search Console par fichier (`GOOGLE_SITE_VERIFICATION`). `/manif` liste aussi les prochaines manifs de l’agenda.

## 2.5.9

- Correctif notifications iPhone : Apple refusait les envois avec « 403 ExpiredProviderToken » dès que le jeton d’identification du serveur (VAPID) avait plus d’une heure. Le jeton dure maintenant 1 h et il est renouvelé toutes les 30 minutes, pour tous les services de notification.

## 2.5.8

- Correctif : la mention OpenStreetMap n’apparaît plus en double (la carte de secours hors zone ajoutait la sienne à celle de la carte principale).

## 2.5.7

- Mention « © contributeurs OpenStreetMap » toujours visible sur la carte, au-dessus de la barre d’onglets et des gros boutons du mode manif, avec un lien vers la page de droits d’auteur d’OpenStreetMap (elle était cachée par la barre du bas). Même lien sur la carte à intégrer et la carte d’un créneau.

## 2.5.6

- Militaires (Sentinelle) rangés dans « Forces de l’ordre » au lieu de « Infos cortège ». Toujours sans alerte de proximité, et ils ne suspendent pas les zones calmes voisines (garde statique de bâtiments).

## 2.5.5

- Nouveaux types de signalement, d’après les moyens annoncés par le ministère de l’Intérieur pour le 24 octobre : unités d’intervention (BRI, RAID, GIGN) et blindés (Centaure, VBRG) dans « Forces de l’ordre », tirs LBD / grenades dans « Danger », avec alerte de proximité et vibration propre. Militaires de l’opération Sentinelle dans « Infos cortège », sans alerte : leur mission est la garde statique de bâtiments, pas le maintien de l’ordre.
- Mode manif renforcé : un signalement fait par un téléphone que le serveur ne connaît pas encore ce jour-là n’est plus présenté comme venant d’un « téléphone suspect », mais simplement « pas encore confirmé ». La protection reste la même (pas d’alerte de proximité tant que personne ne l’a confirmé).

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
