# Comment fonctionne Cortège

Le détail des fonctions, de l'administration et des protections. Pour installer une instance : [INSTALLATION.md](INSTALLATION.md).

## Comment ça marche

- **Agenda 📅** : manifs, blocus (lycée / fac), rassemblements, AG. Les orgas publient directement (avec parcours tracé sur la carte et point de dispersion) ; tout le monde peut proposer un événement, qui apparaît après validation. Les événements du moment s’affichent sur la carte avec leur parcours.
- **Bien se préparer 🎒** : checklist (sac, téléphone, groupe), conseils pendant la manif, gaz lacrymogène, règle AMIS en cas d’interpellation, et point de ralliement du groupe placé sur la carte (reste sur le téléphone, partageable par messagerie).
- **Import du 17 octobre** : toutes les 15 min, le serveur importe dans l’agenda les manifestations et rassemblements annoncés sur la carte participative 17octobregiletjaune.net (réutilisation autorisée). Les blocages de stations, raffineries, péages ne sont pas importés. Un événement importé retiré par l'administration ne revient pas. Variables : `IMPORT_17OCT=0` pour couper, `IMPORT_17OCT_UNTIL` (défaut `2026-11-01`).
- **SOS** : en cas d’interpellation, un SMS pré-rempli (heure, position, numéro de la legal team de la zone) part vers un proche choisi à l’avance. Le contact reste sur le téléphone, le SMS ne passe pas par le serveur.
- **Économie de batterie** (réglage dans « ? ») : synchro toutes les 20 s, GPS moins précis, boussole coupée.
- **Notifications** (bouton 🔔) : les annonces urgentes, les nouveaux arrêtés de ta zone et, en option, les dangers signalés près de toi (au plus une alerte toutes les 3 min) arrivent même appli fermée, dans la langue de l’appli (Web Push chiffré, clés générées au premier démarrage, sans dépendance). Le serveur ne garde que l’adresse de notification, une zone arrondie à ~10 km, les choix et la langue de l’appli. Sur iPhone : seulement une fois l’appli installée sur l’écran d’accueil (iOS 16.4+).
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
- **Alerte de proximité** : bandeau + vibration propre à chaque danger (charge, nasse, lacrymo, sommations…) quand il est signalé à moins de 300 m (réglable), pour le reconnaître sans sortir le téléphone. La légende est dans le menu 🔔.
- **Fiabilité du jour** : un téléphone dont les signalements sont souvent confirmés par d'autres pèse un peu plus (ses points sont plus durs à contester, ses « Plus là » comptent davantage). Un téléphone qui signale des dangers près de plusieurs zones calmes à la suite voit ses signalements marqués « non confirmés » : ils ne suspendent plus les zones calmes et ne déclenchent pas de notification tant que personne ne les confirme. Tout repart de zéro chaque jour.
- **Réseau faible** : l'appli mesure ses requêtes (et lit l'état du réseau donné par Chrome sur Android). Si ça rame, elle passe en mode léger : une seule requête par rafraîchissement (`live/p/<région>.json`, tous les points d'une région), délais courts, et plus aucun nouveau morceau de carte téléchargé, pour laisser passer les signalements. Un bandeau indique l'âge de ce qui est affiché.
- **Dernière situation connue** : la carte affichée est gardée sur le téléphone. Sans réseau, même à l'ouverture, l'appli la remontre (points non expirés) avec son heure. Les notifications transportent aussi, chiffrés, les derniers signalements autour de la zone de l'abonné·e (≈ 3 Ko) : la carte est à jour à l'ouverture même si le réseau ne passe plus. Sur Android, l'appli installée rafraîchit aussi l'agenda, les annonces et l'interface en arrière-plan.
- **Hors ligne** : l'interface est mise en cache, et les morceaux de carte déjà affichés restent sur le téléphone. Le préchargement d'une zone (« Garder la zone hors ligne ») est désactivé tant que les tuiles viennent d'OpenStreetMap, dont la politique l'interdit ; `TILE_PREFETCH=1` le réactive avec un fournisseur qui l'autorise.
- **Lieux permanents** (puce « 🏛 Lieux ») : préfectures, mairies, commissariats, gendarmeries, tribunaux, centres de rétention et hôpitaux dès le zoom quartier ; pharmacies (avec le 3237 pour la pharmacie de garde) et points d'eau potable au zoom rue. Source OpenStreetMap, mise à jour chaque mois.
- **Arrêtés et restrictions** (menu « Arrêtés ») : interdictions de manifester, périmètres interdits, couvre-feux, transports, consignes. Un bandeau s'affiche quand on regarde la zone ou qu'on s'y trouve (contour officiel de la commune ou du département), avec les dates, les mesures et la source. N'importe qui peut en signaler un avec une source obligatoire ; l'admin vérifie avant publication, ou publie directement et importe des blocs préparés. Fin automatique à la date prévue.
- **Caméras de surveillance** (puce « 📷 Caméras ») : au zoom rue le plus proche, les caméras recensées sur OpenStreetMap. Rouge : publique ; orange : privée qui filme la rue ; les caméras intérieures ne sont pas affichées. Un cône indique la direction filmée quand elle est connue. Le recensement est bénévole et incomplet.
- **Vue nationale** : dézoomé, la carte affiche une bulle par région (nombre de signalements par famille) au lieu de tous les points ; les vrais points autour de toi restent chargés pour les alertes de proximité.

## Carte nationale

Une seule carte pour toute la France. Le téléphone s'ouvre sur la position de l'utilisateur (si déjà autorisée), sinon sur la France avec une recherche de ville. Il ne charge que les signalements de la zone affichée et des environs de l'utilisateur ; le serveur reçoit seulement des carrés arrondis (≈ 5 km), jamais la position exacte. En dézoomant, les points se regroupent en bulles numérotées.

## Anti-abus

- Limites de fréquence par téléphone (identifiant aléatoire, jamais stocké en clair) et par réseau.
- Les votes « Plus là » n'effacent jamais un point d'un coup : quand plusieurs personnes, sur des réseaux différents, disent que c'est parti, le point devient « contesté » (grisé) et s'éteint au bout de quelques minutes, sauf si quelqu'un le confirme. Le bouton n'est proposé qu'aux personnes proches du point (calculé sur le téléphone), les votes faits sur place pèsent plus, ceux d'un identifiant tout neuf moins, et les votes en rafale ne comptent pas. Jamais de contestation sur un point vérifié par une orga ; les points contestés passent par la corbeille de l'admin.
- Administration : pause des signalements, suppression d'un point, purge totale.

## Administration

Avec la clé `ADMIN_KEY` :
- **Orgas** : ajouter une orga (nom affiché sur ses annonces) → une invitation à usage unique (QR code + lien, valable 24 h) s'affiche. L'orga la scanne : sa clé est créée à ce moment-là, sur son téléphone, et l'invitation ne sert plus. « Nouvelle invitation » coupe l'accès actuel et en crée un autre. Supprimer une orga coupe son accès immédiatement. Seule l'empreinte des clés est stockée.
- **Parrainage** : une orga confirmée peut inviter d'autres orgas depuis son espace (3 par semaine, QR code ou lien à usage unique). L'orga invitée est « parrainée » : surveillance renforcée (« Vérifier » ne vaut qu'une confirmation forte, retraits et annonces limités, actions visibles par la marraine). Après 7 jours et 10 actions sans incident, elle peut être confirmée par sa marraine ; l'admin peut la confirmer à tout moment. « Révoquer pour abus » coupe une orga et toutes celles qu'elle a fait entrer, et sa marraine ne peut plus inviter pendant 30 jours.
- **Appareils** : l'accès orga n'existe que sur l'appareil qui a ouvert l'invitation (aucun compte, aucun mot de passe). « Ajouter un appareil » crée un lien de 10 minutes pour un deuxième appareil (5 au plus). Une nouvelle invitation coupe tous les appareils.
- **Période d'essai** : une nouvelle orga peut vérifier des signalements et publier des annonces d'info. « Retirer » y compte comme deux « Plus là », ses numéros de legal team et ses événements attendent ta validation, et les annonces urgentes sont réservées aux orgas confirmées. Bouton « Confirmer » dans l'onglet Orgas.
- **Journal** : chaque action d'orga (vérification, retrait, annonce, événement) est enregistrée 30 jours, sans IP. Les points retirés restent une heure dans une corbeille, restaurables d'un clic. Des retraits en rafale bloquent temporairement le retrait pour l'orga concernée et apparaissent dans « À vérifier ».
- **Abus** : tableau des 24 dernières heures (points contestés, votes et signalements en rafale, dangers en série près des zones calmes), par heure et par zone. Gardé 48 h, sans empreinte au-delà d'une heure.
- **Mode manif renforcé** (onglet Abus, 1 à 6 h) : limites divisées par deux et téléphones apparus depuis moins de 10 min sans poids, sans couper les signalements.
- **Effacement d'urgence** (onglet Urgences) : efface d'un coup toutes les traces liées aux personnes et détruit les clés de hachage. Les orgas et l'agenda sont gardés.
- **Tête et queue de cortège** : un seul point chacune, qui suit le cortège (tous les signalements à moins de 300 m le déplacent) avec la trace des 30 dernières minutes, sa direction et sa vitesse. Sur un parcours dessiné dans l'agenda, la partie déjà faite est surlignée, avec l'avancée en pourcentage, une estimation de la fin et, si tu es plus loin sur le parcours, de son arrivée près de toi (calculée sur le téléphone, ta position ne part pas). Avec une tête et une queue, la carte montre le cortège entre les deux et sa longueur.
- **Position en direct des orgas** (espace orga, orgas confirmées) : une orga peut partager sa position comme street medic, legal team, presse, tête ou queue de cortège. Le téléphone l'envoie toutes les 30 s tant que l'appli est ouverte (écran gardé allumé) ; le point, marqué « En direct », disparaît 3 min après le dernier envoi ; arrêt à la main, à la fin de la durée choisie (1, 2 ou 4 h) ou au bout de 8 h. Un signalement de participant·e tout près confirme le point sans le déplacer.
- **Limites des orgas** : en période d'essai, « Vérifier » vaut une confirmation forte (sans la coche) et toutes les annonces attendent la validation de l'admin. Pour toutes les orgas : 30 vérifications par 5 min, 3 annonces urgentes par heure, 30 annonces et 20 événements par jour. Une orga bloquée apparaît dans le tableau des abus (« orga en rafale »).
- **Notifications** : au plus 60 nouveaux abonnements par réseau et par 6 h ; un abonnement refusé 5 fois de suite par le service de notification est supprimé.
- **Digest** : bilan anonyme par jour.
- **Direct** : signalements par minute, téléphones connectés en temps réel, notifications envoyées, reçues, expirées ou refusées (avec la dernière erreur du service de notification), charge, mémoire et disque du serveur. Actualisé toutes les 10 s.
- **Modération** : le plus urgent en haut (dangers contestés, puis dangers d'une série près des zones calmes, puis points isolés à plus de 500 km de toute autre activité, « Plus là » isolés et points hors de France). Chaque point dit pourquoi il est là, en clair. Filtres par ville et par type ; les simples « pas encore confirmé » du mode renforcé sont cachés par défaut (et ne comptent pas dans le badge). Boutons « C’est vrai » (efface les contestations), « Vérifier » ou « Retirer ».
- **Journées** : une journée de mobilisation prévue envoie une notification la veille à 20 h aux abonné·es aux annonces urgentes, affiche son titre en bandeau et lance le mode renforcé le jour J (7 h → 2 h), puis propose le lendemain de publier le bilan public.
- **Lieux** : lieux permanents (préfectures, sous-préfectures, mairies, commissariats, gendarmeries, tribunaux, centres de rétention, hôpitaux, pharmacies, eau potable). Avec les caméras, ils viennent d'une copie complète d'OpenStreetMap (Geofabrik), téléchargée une fois par mois puis triée sur le serveur par osmium, à basse priorité ; le gros fichier est effacé ensuite. Sans osmium : lus dans la carte PMTiles du serveur (sans caméras ni horaires), ou à défaut chez Overpass. Recherche, correction, masquage et ajout ; les corrections sont gardées aux imports suivants.
- **Réglages** : bandeau en haut de la carte (avec dates de début et de fin), vue d'ouverture, types de signalement (activés ou non, durée de vie), rayon de l'alerte de proximité et distance des notifications « danger près de toi ». Appliqués sans redémarrer ; les clés et les liens restent dans les variables du serveur.

Sur le téléphone d'une orga apparaissent le badge ORGA et le bouton 📣 : annonces localisées (info ou urgente, 1 à 30 km, 30 min à 12 h), numéro de legal team (avec sa ville, affiché dans « Mes droits » pour tout le monde, rangé par ville), et sur chaque signalement « Vérifier » ou « Retirer (faux) ». Le signalement d'une orga confirmée est vérifié d'office et dure deux fois plus longtemps ; elle peut ensuite le prolonger ou le corriger (type, précision) depuis sa fiche.

`ORGA_KEYS` (variable) reste possible mais n'est plus nécessaire.

### Annuaire des legal teams

Onglet « Legal teams » de l'administration. Une liste de départ (`legal-seed.json`, sources publiques) est chargée au premier démarrage, **sans rien publier** : chaque ligne doit être vérifiée auprès du collectif puis validée. Une veille relit chaque jour la page source de chaque ligne et signale dans l'onglet si le numéro n'y figure plus ou si d'autres numéros sont apparus. Elle ne publie et ne modifie jamais rien : la décision reste humaine. Modifier le numéro ou la source repasse la ligne en « à valider ».

## Devenir orga

Le bouton « Demander un accès orga » ouvre un formulaire dans l'appli (nom du collectif, ville, lien public, canal officiel). Les demandes arrivent dans l'onglet Orgas de l'administration, à vérifier par les canaux publics du collectif ; elles sont effacées une fois traitées, et au plus tard au bout de 30 jours. L'administration crée aussi des liens de candidature par ville (`/?rejoindre=Ville`, avec QR code) à partager dans les AG : ils ouvrent le formulaire, sans donner aucun accès.

## Digest

Onglet Digest de l'administration. Seuls les signalements faits en France (métropole et outre-mer) sont comptés, dans le digest comme dans les bilans publics et les stories : ceux envoyés d'ailleurs restent sur la carte en direct, et leur nombre est indiqué à part. Chaque point est rattaché à sa commune grâce aux contours des communes d'OpenStreetMap, extraits pendant l'import mensuel des lieux (aucun service extérieur) ; avant le premier import, à la ville ou l'agglomération la plus proche. Chiffres clés, carte du jour, moments clés (premier danger de chaque type par ville), répartition par type, par heure (par famille) et par ville avec les horaires d'activité, devenir de chaque signalement (expiré, contesté, retiré par une orga ou l'admin…), fiabilité (confirmations, vérifications, durée de visibilité), activité des orgas et de l'anti-abus, comparaison sur 15 jours, résumé prêt à copier et export CSV. Les signalements retirés ou contestés sont gardés et peuvent être inclus ou exclus d'un clic. L'archive ne garde que la catégorie, les heures de début et de fin à la minute, une position arrondie à ~100 m et des compteurs, jamais le texte des précisions ni d'empreinte.

## Stories du digest

Dans l'onglet Digest, « Fabriquer les stories » produit 7 visuels 1080 × 1920 (chiffres bruts, carte des villes, types, heures, villes, vérification, source), avec deux photos facultatives dont le bas est flouté. Tout est calculé dans le navigateur de l'admin ; sur téléphone, « Partager » les envoie directement vers une appli.

## Pages publiques, affiche et carte à intégrer

- **Agenda et bilans** (`/manif`, `/manif/AAAA-MM-JJ`) : `/manif` liste les prochaines mobilisations de l'agenda (aussi en données structurées pour les moteurs de recherche), puis les bilans publiés depuis l'onglet Digest. Un résumé agrégé est figé à la publication (totaux par ville avec seulement le centre de la ville, types, heures, vérification). Il reste en ligne même quand l'archive détaillée est effacée.
- **Carte d'un créneau** (`/manif/AAAA-MM-JJ/carte`, lien en bas de chaque bilan) : tout le monde choisit un lieu, un rayon (2 km au plus) et une plage horaire (6 h au plus), et obtient une image à télécharger ou partager. L'image est fabriquée dans le navigateur de la personne ; le serveur n'envoie qu'un fichier de points figé à la publication, mis en cache (catégorie, heures à la minute, position arrondie à ~100 m, confirmations, vérifié ou non, et ce qu'est devenu le point). Les signalements retirés ou contestés restent affichés, en rond vide avec la mention (retiré par une orga, par l'admin, contesté…) : un retrait ne fait pas disparaître ce qui a été signalé, avec une limite de demandes par réseau. L'admin a le même outil dans l'onglet Digest, avec en plus le CSV.
- **Affiche A4** (`/affiche.html?ville=…`) : QR code de l'appli et numéros de legal team de la ville (annuaire et numéros publiés par les orgas), à imprimer.
- **Carte à intégrer** (`/embed.html?lat=…&lng=…&z=…`) : lecture seule, sans géolocalisation des visiteur·ices, dans une iframe. C'est la seule page autorisée dans un autre site.
- **Nouveautés** : `public/nouveautes.json`, affiché une fois après chaque nouvelle version ; historique dans [`CHANGELOG.md`](../CHANGELOG.md).

## Référencement

- `/robots.txt` et `/sitemap.xml` (accueil, agenda et bilans, presse, affiche, mentions légales, chaque bilan publié) sont fabriqués par le serveur.
- L'admin, le digest, la carte à intégrer et la carte d'un créneau sont exclus des moteurs (`X-Robots-Tag: noindex`).
- Données structurées schema.org : l'appli (gratuite) sur l'accueil, les événements de l'agenda sur `/manif`.
- Validation Google Search Console par fichier : `GOOGLE_SITE_VERIFICATION=google0123456789abcdef.html` (le nom du fichier donné par Google), sans toucher aux pages.

## Langues

L’interface existe en français, anglais, espagnol et arabe (affichage de droite à gauche). Le téléphone choisit la langue de son système ; on la change dans Plus, Réglages. Le français est le texte d’origine et sert de clé.

- Les traductions sont dans `i18n/*.tsv` : une ligne par texte, `français<TAB>anglais<TAB>espagnol<TAB>arabe`. Les balises HTML et les valeurs entre accolades (`{n}`, `{d}`…) doivent rester identiques.
- `node tools/i18n-build.js` vérifie les fichiers et écrit `public/lang/en.json`, `es.json` et `ar.json`. À relancer après chaque modification, et à chaque nouveau texte ajouté à l’interface.
- Dans le navigateur, `public/i18n.js` charge le fichier de la langue choisie (un seul, gardé pour le hors-ligne), traduit la page, puis l’appli traduit ses messages avec `t('texte français', { valeurs })`. Un texte absent du dictionnaire reste en français.
- Les notifications suivent la langue de l’appli (envoyée au serveur avec l’abonnement) et utilisent les mêmes fichiers de traduction.
- Restent en français : les textes écrits par les orgas et l’admin (annonces, titres de journée), le texte des arrêtés, et les pages annexes (mentions légales, bilans, presse, affiche).

## Ce que le serveur sait et ne sait pas

- Aucun compte, aucun cookie. Les signalements actifs sont gardés dans une base hors du dossier web et supprimés à expiration.
- La position de l'utilisateur ne quitte jamais le téléphone. Seuls les signalements sont envoyés, arrondis à ~11 m.
- L'anti-spam utilise une empreinte de l'IP et du téléphone (HMAC avec une clé tirée au hasard pour chaque période de 6 h ou d'un jour, détruite à la fin de la période suivante), effacée avec le signalement. Sur un hébergement mutualisé, l'hébergeur garde ses propres journaux d'accès : l'appli ne peut rien y faire.
- Les tuiles passent par le serveur : les IP des manifestant·es ne partent pas chez le fournisseur de carte.

## Sécurité et vérification

- Signaler une faille, ce que l'appli protège et ne protège pas : voir [`SECURITY.md`](../SECURITY.md).
- Tests automatiques (`npm test`, sans dépendance) : fusion, votes contestés, zones calmes, fiabilité, mode renforcé, invitations d'orga, effacement d'urgence, notifications, en-têtes de sécurité. Ils tournent sur GitHub à chaque modification (badge en haut de page).
- Vérifier que l'appli en ligne est identique à ce dépôt : `node verifier.js https://carte.exemple.org` (depuis une copie du dépôt, avec l'adresse de l'instance à vérifier). Version et empreintes déclarées : `/api/version`. Si tu remplaces le logo (`public/brand/logo.png`), ce fichier apparaîtra logiquement comme différent.

## Limites à connaître

- **Faux signalements** : n'importe qui peut poster, y compris pour semer la confusion. Les votes limitent la casse, pas plus. Pour une grosse manif, prévoir des modérateurs ou un mode « signalements vérifiés par la legal team ».
- **Charge** : les lectures sont des fichiers statiques servis par Apache, les écritures passent par SQLite. Sur un mutualisé, la limite devient le nombre de connexions simultanées que l'hébergeur accepte : au-delà de quelques milliers de téléphones ouverts en même temps, passer sur un VPS.
- **Tuiles OSM** : le cache disque limite fortement les appels à OpenStreetMap. Si le trafic explose, passer à un fournisseur de tuiles (Stadia, MapTiler). Ne pas extraire de carte complète sur un hébergement mutualisé : l'extraction (≈ 10 Go) sature les ressources du compte.
- **Réseau saturé** : sans data, plus de temps réel. Pour les échanges entre personnes sans réseau, Briar (Bluetooth/Wi‑Fi) reste l'outil adapté.

Licence AGPL-3.0 : toute version modifiée mise en ligne doit publier son code.
