# Nouveautés

Versions : **majeure** (3.0) pour un gros changement visible ou qui casse l'existant, **mineure** (2.1, 2.2…) pour de nouvelles fonctions, **correctif** (2.1.1) pour une réparation sans nouveauté.

## 2.17.5

Version issue d'une relecture complète du code : sécurité, vitesse, solidité. Rien ne change dans l'usage.

**Sécurité** :
- Veille des préfectures : les pages, les sites et les recueils PDF sont lus avec la même garde que la veille des legal teams. Jamais le serveur lui-même ni le réseau interne (même après une redirection), taille bornée pendant le téléchargement, durée totale bornée. `pdftotext` ne reçoit plus les variables du serveur.
- Direction d'un véhicule et nombre d'un groupe : 2 saisies au plus par téléphone et par point en 10 minutes ; la valeur posée par un téléphone tient 30 secondes avant qu'un autre puisse la changer.
- Temps réel : 500 connexions au plus pour un même réseau (`STREAM_NET_MAX`), pour qu'un seul réseau ne prenne pas toutes les places.
- `/api/health` ne répond plus que `{"ok":true}` sans la clé admin ; le détail (disque, mémoire, proxy) demande la clé.
- Webhook GitHub : un même envoi n'est pris en compte qu'une fois.
- Lieux (Geofabrik) : plus de retour à http, taille maximale (`GEOFABRIK_MAX_GB`), somme de contrôle vérifiée.
- Installation VPS : le serveur n'a plus le droit d'écrire dans son propre code (`TILE_DIR` dans le dossier des données, voir [INSTALLATION.md](docs/INSTALLATION.md)). Actions GitHub épinglées par empreinte.

**Vitesse** :
- Nouveautés : seules celles de la version en cours sont lues au démarrage (3 Ko au lieu de 41) ; l'historique est lu à l'ouverture de la liste.
- QR code : sa bibliothèque (57 Ko) n'est chargée qu'au premier QR code affiché.
- Logo allégé (21 Ko au lieu de 63), sans différence visible.
- Démarrage : un calcul de mise en page inutile retiré (la plus longue tâche du démarrage est à peu près divisée par deux). Premier chargement : 16 % de données en moins.
- Serveur : les anciens fichiers `live/index.json` et `live/all.json` (formats d'avant la 2.0) ne sont plus écrits toutes les 5 et 10 secondes.

**Solidité** :
- Arrêt propre : au redémarrage, les requêtes en cours se terminent, la publication en attente part et la base est refermée.
- Les requêtes HEAD (outils de surveillance, aperçus de liens) reçoivent une réponse.
- Import du 17 octobre retiré (terminé depuis le 1er novembre).
- Accessibilité : le champ du code à intégrer a une étiquette.
- Intégration continue : vérification ESLint du serveur, et un test dans un vrai navigateur (ouvrir, signaler, confirmer, partager).

## 2.17.0

**Droits** (onglet Droits, profil France), chaque point vérifié le 10 novembre 2026 sur Légifrance et service-public.fr :
- nouvelles rubriques : audition libre, palpation et fouille, empreintes, photos et ADN, moins de 18 ans (Code de la justice pénale des mineurs), ce qu'on peut te proposer à la place d'un procès (avertissement pénal probatoire, composition pénale, reconnaissance préalable de culpabilité) ;
- « Pour tes proches » : un·e proche est interpellé·e (choisir son avocat·e, demander un médecin, justificatifs à rassembler avant une comparution immédiate), et les fichiers de police après coup (TAJ, ADN, accès et effacement) ;
- corrections et précisions : renvoi en comparution immédiate de 4 à 10 semaines (depuis le 30 septembre 2024), délai d'appel de 10 jours, demande d'exclusion du bulletin n° 2, peines des délits d'attroupement et de visage dissimulé, appel au proche dans les 3 heures, conditions de poursuite pour le refus de donner le code du téléphone (Cour de cassation 2022 et 2026) ;
- **fiche imprimable** : « Imprimer la fiche » ouvre toutes les rubriques et imprime l'onglet seul, sur deux colonnes.

**Secours et terrain** (idées de la boîte à idées) :
- **Défibrillateurs** sur la carte (OpenStreetMap), au zoom rue, avec leur emplacement exact et quoi faire en cas d'arrêt cardiaque. Calque « 🫀 Défibrillateurs ». Ils arrivent avec le prochain import des lieux.
- **Nombre approximatif** pour les groupes fascistes, la police, les CRS, la BAC, les militaires et les unités d'intervention : juste après le signalement ou dans la fiche du point (1 à 5, 5 à 15, 15 à 30, plus de 30).
- **Point de ralliement** : nouveau type d'annonce des orgas certifiées. Un drapeau 🚩 sur la carte, à l'endroit choisi, avec l'orga, le texte et l'heure de fin ; un bandeau « Voir sur la carte ».
- **Masquer un type de lieu depuis sa fiche** : « 🙈 Masquer ce type de lieu » dans la fiche d'un lieu (défibrillateur, pharmacie, caméra…). Le bouton Calques, en bas à droite, porte maintenant une pastille avec le nombre de choses masquées et s'anime un instant après un masquage, pour montrer où les réafficher.
- **Agenda** : un événement situé dans la zone d'un arrêté d'interdiction de manifester (ou de périmètre interdit) en vigueur à son heure porte « Arrêté en vigueur dans la zone », avec le lien vers le texte.

**Admin** :
- **Veille des préfectures** (Admin › Arrêtés) : pages à surveiller (accueil ou actualités d'une préfecture, recueil des actes administratifs, flux RSS ou Atom), relues toutes les 20 minutes. Les nouveaux liens qui parlent de manifestation, de périmètre, de couvre-feu, de drones, de mesures de police… sont proposés ; « Préparer » remplit le formulaire d'arrêté avec le département et la source. Rien n'est publié tout seul. Compté dans la pastille Arrêtés.
  - **« Ajouter toutes les préfectures »** : les sites des 101 préfectures (adresses relevées dans le jeu de données des recueils sur data.gouv.fr et vérifiées), plus la page des arrêtés et celle des communiqués de la préfecture de police à Paris. Pour chaque site, les pages utiles sont repérées toutes seules et mises à jour chaque jour : accueil, actualités, communiqués de presse de l'année et du mois, recueil des actes administratifs de l'année et du mois (y compris quand le site ajoute un niveau « RAA du département »). Chaque site est relu toutes les 30 minutes.
  - **Recueils PDF lus** : leurs titres ne disent rien (« Recueil spécial n° 331 ») ; si `pdftotext` est installé sur le serveur (paquet poppler-utils), les nouveaux recueils sont téléchargés (25 Mo au plus) et leurs 80 premières pages lues. Un recueil qui contient une interdiction de manifester, un périmètre de protection, un couvre-feu, une autorisation de drones, une restriction d'artifices ou de carburant… est proposé avec l'extrait trouvé.
- **Tickets GitHub des idées** (Admin › Idées) : chaque idée publiée a son ticket sur le dépôt, avec texte, langue, votes, statut, réponse et lien vers l'idée. Tenu à jour tout seul (votes toutes les 10 minutes), fermé quand l'idée est faite (avec la version), pas retenue ou fusionnée. Facultatif : un ticket fermé ou rouvert sur GitHub change le statut de l'idée (webhook signé). Réglages : `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_WEBHOOK_SECRET`.
- README : comment Cortège résiste aux faux signalements.

## 2.16.0

Deux idées venues de la boîte à idées.
- **Secours sur la carte** : nouveau type de signalement « Secours (pompiers, SAMU) » 🚑, dans le soutien. Il dure 15 minutes et le point suit le véhicule. Pas d'alerte ni de vibration.
- **Urgences plus visibles** : les hôpitaux qui ont un service d'urgences apparaissent dès le zoom ville, avec un bord plus épais et une pastille « URG ». Les autres hôpitaux gardent leur zoom.
- **Direction des véhicules** (police, CRS, BAC, unités d'intervention, blindés, canons à eau, groupes fascistes, secours) :
  - juste après le signalement, une rose des vents permet d'indiquer d'un appui vers où ça va (facultatif, le signalement part toujours d'un seul appui) ;
  - dans la fiche d'un point, « Indiquer sa direction » ou « Corriger » : n'importe qui sur place peut la donner ou la mettre à jour, « ■ » efface ;
  - quand un point est revu 40 m plus loin, sa direction est déduite du déplacement ;
  - une flèche autour du point montre la direction, et la fiche dit « Se dirige vers le nord-est · il y a 2 min ». Au bout de 5 minutes sans nouvelle, la flèche disparaît.
- **Idées au vote sur Bluesky et Mastodon** : quand l'admin met une idée au vote, elle est publiée (titre, début du texte, lien qui ouvre l'idée dans l'appli). Une seule fois par idée. Type de message réglable dans Admin › Réseaux.
- Lien `/?idee=…` : ouvre la boîte à idées sur l'idée, mise en avant un instant.
- **Nouveautés publiées automatiquement** sur Bluesky et Mastodon, une fois par version, dès que le serveur tourne avec la nouvelle version : les nouveautés que l'appli montre (fichier des nouveautés), dans la langue de l'instance. Mastodon reçoit chaque nouveauté en entier ; sur Bluesky (300 caractères), chaque nouveauté est en entier tant que ça tient, puis seulement son titre. Le lien `/?nouveautes` ouvre la fenêtre des nouveautés dans l'appli. Type de message réglable dans Admin › Réseaux.

## 2.15.0

- **Partage automatique sur Bluesky et Mastodon** (admin › Réseaux). Le serveur publie lui-même sur les comptes de l'instance :
  - la veille d'une journée de mobilisation, dès 19 h ;
  - le matin du jour J, dès 8 h, avec le nombre de rendez-vous de l'agenda ;
  - les nouveaux arrêtés, regroupés en un seul message 10 minutes après le dernier validé (un import de 30 arrêtés = un message) ;
  - le bilan public d'une journée, au moment où l'admin le publie ;
  - les messages écrits à la main dans l'onglet, avec un lien facultatif.
- Chaque message ne part qu'une fois (un bilan republié ne refait pas de message). Le texte est coupé pour tenir dans la limite du réseau (300 caractères sur Bluesky, 500 sur Mastodon), lien et mots-clés gardés. Sur Bluesky, liens et mots-clés sont cliquables et le lien s'affiche en carte avec l'image de l'appli.
- Réglages : publier directement ou relire avant l'envoi (texte modifiable ; veille, jour J et arrêtés en attente sont abandonnés au bout de 12 h), choix des types de messages, réseaux actifs, mots-clés ajoutés à chaque message.
- Erreur d'un réseau : nouvel essai 2, 4, 8 puis 16 minutes plus tard ; l'autre réseau n'attend pas. Un message publié peut être retiré des deux réseaux depuis l'admin.
- Identifiants dans les variables du serveur seulement (`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `MASTODON_URL`, `MASTODON_TOKEN`), jamais dans la base ni dans l'admin ; « Tester la connexion » les vérifie sans rien publier. Sans ces variables, rien ne change.
- Seuls des totaux, des noms de villes et des liens publics sont envoyés. Textes des messages traduits dans la langue de l'instance.

## 2.14.1

- **Vote contre dans la boîte à idées** : sous 👍, un bouton 👎. Un téléphone a un seul vote par idée, pour ou contre ; appuyer sur l'autre bouton change d'avis, appuyer sur le vote déjà choisi le retire. Les deux nombres sont affichés. Le classement « Les plus votées » suit le solde (pour moins contre), puis le nombre de pour. L'admin voit le solde et le détail ; une fusion de doublons additionne aussi les contre. La pastille du rond 💡 compte comme votée une idée où le téléphone a voté contre. Les téléphones pas encore à jour continuent de voter pour.
- **Thème sombre** : les couleurs des textes « vérifié », « attention » et « danger » (et l'anneau des signalements vérifiés) avaient disparu depuis la 2.12. Elles sont rétablies.
- Onglets de la boîte à idées : plus de barre de défilement visible sous les onglets.

## 2.14.0

- **Boîte à idées** (Plus › Idées) : chacun peut proposer une amélioration de Cortège (titre de 80 caractères, explication facultative de 400) et voter pour celles qui lui parlent. Quatre onglets : les plus votées, récentes, faites, pas retenues. Pendant la saisie, l'appli montre les idées déjà proposées qui y ressemblent, pour voter plutôt que créer un doublon.
- **Validation avant publication** : une idée n'est visible qu'une fois publiée par l'admin (nouvel onglet Idées, avec une pastille du nombre d'idées à valider). L'admin peut corriger le titre, donner un statut (proposée, à l'étude, prévue, faite, pas retenue) avec la version et une réponse courte publique, fusionner les doublons (les votes s'additionnent) ou supprimer.
- **Idées mises au vote** : l'admin met en avant une ou plusieurs idées ouvertes (« Mettre au vote »). Elles passent en tête de la liste avec le badge « Au vote en ce moment », et un rond 💡 apparaît sur la carte, au-dessus de SOS, avec une pastille du nombre d'idées au vote pour lesquelles le téléphone n'a pas encore voté. Le rond disparaît quand plus aucune idée n'est au vote ; une idée faite ou écartée en sort d'elle-même. Les téléphones sont prévenus par `live/g.json` (clé `ideas`).
- **Anonymat** : pas de compte. Un vote par téléphone et par idée, retirable. Le jeton de vote est propre à chaque idée (HMAC de l'identifiant du téléphone avec une clé du serveur) : impossible de relier les votes d'un même téléphone entre deux idées ; l'identifiant brut et l'adresse IP ne sont jamais gardés. Au plus 3 idées par téléphone et par jour, liens refusés. Plus de vote sur une idée faite ou pas retenue.

## 2.13.7

- **Lieux de repli visibles seulement au zoom quartier** (15 et plus) : ce sont des lieux locaux, ils ne s'affichent plus sur la vue d'une ville ou du pays. La flèche vers la zone calme la plus proche continue de les proposer à tout zoom.

## 2.13.6

- **Lieux créés dans l'admin visibles dans l'espace orga de l'admin** : connecté à l'appli avec la clé admin, l'onglet Terrain liste maintenant tous les lieux que l'admin a créés, depuis l'admin ou depuis l'appli, même associés à des orgas. Avant, il ne montrait que ceux associés au compte admin lui-même.

## 2.13.5

- **Lieux de repli gérés depuis l'admin** (onglet Orgas, carte « Lieux de repli ») :
  - créer et modifier un lieu : nom, étiquette, adresse, position sur une carte (toucher la carte, déplacer le repère ou coller « latitude, longitude »), services, message, lien, pictogramme, couleur, accord du lieu, avec un aperçu du point ;
  - **associer le lieu à une ou plusieurs orgas** : toutes peuvent l'ouvrir, le fermer et le modifier depuis leur espace orga (sans pouvoir changer les orgas associées ni le logo). Sur la carte, la fiche cite toutes les orgas associées ; un lieu sans orga est présenté au nom de l'admin ;
  - **logo propre au lieu**, recadré en carré dans le navigateur, vérifié par le serveur ; il passe avant le logo des orgas ;
  - ouvrir un lieu sur un créneau, le passer en complet, le fermer, le retirer.
- **Nombre de lieux par orga** réglable orga par orga, de 0 à 30 (par défaut `REFUGE_MAX`, soit 1). Les lieux que l'admin associe lui-même ne comptent pas dans cette limite.
- Orga supprimée : elle est retirée de ses lieux ; un lieu qui n'a plus d'orga disparaît, sauf s'il a été créé par l'admin.
- Espace orga : un lieu partagé indique avec quelles autres orgas.

## 2.13.2

- **Espace orga en 4 onglets** au lieu d'une longue page :
  - **Annonces** : publier une annonce ou un numéro de legal team, publier une manif ou un blocus, annonces actives ;
  - **Terrain** : position en direct et lieu de repli ;
  - **Réseau** : inviter une orga et suivre les orgas invitées (ou, en essai, ce qu'il faut pour pouvoir inviter) ;
  - **Mon orga** : nom et statut (certifiée, en essai, parrainée, admin), logo, appareils, avertissement sur la perte d'accès, sortie du mode orga.
- Pastilles sur les onglets : verte sur « Terrain » quand ta position ou ton lieu de repli est en ligne, « ! » sur « Mon orga » tant qu'un seul appareil a l'accès. Le dernier onglet ouvert est gardé ; une orga qui vient d'entrer arrive sur « Mon orga ». Navigation au clavier avec les flèches.
- La feuille garde la même hauteur d'un onglet à l'autre. Corrigés au passage : la case « Annonce nationale » démesurée et le menu « Pendant » qui débordait quand l'admin partage sa position.

## 2.13.1

- **Un lieu de repli par orga pour l'instant** : chaque orga certifiée enregistre un seul lieu (réglable avec `REFUGE_MAX` dans `/etc/cortege.env`, de 1 à 30). L'espace orga s'adapte : « Ajouter mon lieu » disparaît une fois le lieu enregistré, et « Ouvrir sur ce créneau » ouvre le lieu.
- **Section « Lieu de repli » visible pour l'admin** (connecté à l'appli avec sa clé), qui peut tenir son propre lieu ; son logo est validé d'office. Pour une orga en essai, la section s'affiche avec le message « Réservé aux orgas certifiées » au lieu d'être cachée.

## 2.13.0

- **Lieux de repli tenus par les orgas** : une orga certifiée enregistre une fois ses lieux de repli (commerces, locaux associatifs, points d'écoute), avec l'accord de chaque lieu, puis les ouvre le jour d'une manif pour un créneau de 24 h au plus, tous d'un coup ou un par un. Pendant la manif, un bouton « Complet » ou « Fermer » suffit. Fini de reposer les points à chaque manif.
- **Visibles seulement quand ils sont ouverts** : un lieu n'apparaît sur la carte que pendant son créneau. Aucune liste n'est consultable en dehors, pour ne pas exposer les lieux solidaires.
- **Sur la carte** : anneau vert « soutien » (la couleur de sens ne change pas), coche « vérifié », intérieur choisi par l'orga (pictogramme et couleur, sans rouge ni orange) ou son logo, et nom du lieu sous le point au zoom quartier. La fiche donne l'orga qui le garantit, l'heure de fermeture, les services (eau, toilettes, écoute, recharge, premiers soins, abri, accès PMR), l'adresse et un message. Comme une zone calme vérifiée, un danger signalé à moins de 100 m l'affiche en alerte ou barré. La flèche vers la zone calme la plus proche propose aussi les lieux de repli ouverts. Masqués avec les points « Soutien » dans les calques. Gardés sur le téléphone pour le mode hors ligne.
- **Logo des orgas** : redimensionné sur le téléphone en PNG carré, vérifié par le serveur, affiché seulement après validation par l'admin (onglet Orgas, carte « Lieux de repli des orgas », avec la liste de tous les lieux et un bouton pour en retirer un). Une orga supprimée emporte ses lieux et son logo.
- Les signalements anonymes « Zone calme / repli » restent comme avant, avec leur durée de vie de 90 minutes.

## 2.12.1

- **Appui long pour signaler** : un appui long sur la carte (un peu plus d'une demi-seconde) ouvre « Signaler » avec le viseur posé à cet endroit, zoomé pour être précis ; sur ordinateur, c'est le clic droit. Rien ne part sans choisir une catégorie. L'appui est annulé si le doigt glisse ou si un deuxième doigt zoome, et ne se déclenche pas sur un point, une fenêtre ou un bouton. Le téléphone vibre brièvement pour confirmer. Le double tap garde son rôle de zoom.
- **Liens Instagram vers l'appli** : un lien vers un profil Instagram (en-tête, Plus, partage, pages publiques, presse) ouvre directement l'appli Instagram quand elle est installée. Sur Android (Chrome, Edge, Samsung Internet, dans le navigateur ou installé) et sur iPhone depuis Cortège installé sur l'écran d'accueil, Cortège passe par l'adresse de l'appli (`instagram://`) et ouvre le site si le téléphone n'a pas basculé dans l'appli au bout d'une seconde et demie. Sur iPhone dans Safari, Safari le faisait déjà ; sur ordinateur, rien ne change. Un petit script commun (`public/deeplink.js`) ne lit que l'adresse du lien touché.
- **Nom de l'événement en haut de la carte** : il passe sur deux lignes au lieu d'être coupé après quelques mots.

## 2.12.0

- **Nouveau style, partout** : le style est revu sur toute l'appli et ses pages (bilans, agenda, droits, legal teams, mentions légales, presse, outil des créneaux, admin, carte à intégrer). Titres en Anton, texte en Inter, bleu nuit en sombre, pastels pêche, mauve et bleu en clair, cartes « sticker » en relief dans le thème clair. Les couleurs de sens ne changent pas : rouge pour les forces de l'ordre, orange pour les dangers, vert pour le soutien, violet pour l'info.
- **Clair, sombre ou système** : le choix se fait dans Plus › Réglages › Apparence. Par défaut, l'appli suit le réglage du téléphone et bascule en direct quand il change. Le choix est gardé sur le téléphone et vaut pour toutes les pages du site ; la carte à intégrer, affichée chez d'autres sites, suit le réglage du système.
- **Fond de carte en deux versions** : la carte vectorielle hébergée a une version claire (pastel) et une sombre (bleu nuit), qui s'échangent sans recharger la page. La carte de secours OpenStreetMap n'est plus inversée en thème clair.
- **Mode manif toujours en sombre** : écran discret dans la rue la nuit et moins de batterie. En sortant du mode manif, l'apparence choisie revient. Si l'appli s'ouvre directement en mode manif, elle démarre en sombre, sans flash.
- **Carte à intégrer, claire ou sombre au choix** : dans « La carte sur ton site », un choix « Apparence de la carte » (selon l'appareil de qui regarde, claire ou sombre) ajoute `&theme=clair` ou `&theme=sombre` au code. Le paramètre marche aussi à la main sur toutes les pages.
- **Visuels au nouveau style** : image de partage des liens (`og.png`), stories du digest (titres en Anton, fond bleu nuit), affiche imprimable (fond blanc gardé pour l'encre, titres en Anton, texte bleu encre, QR code noir pour rester lisible) et carte des bilans.
- **Lisibilité** : contrastes vérifiés (WCAG AA) sur l'appli et ses pages, dans les deux thèmes. Les boutons SOS, l'alerte forces de l'ordre et les pastilles d'orga prennent une teinte plus foncée de leur couleur pour que le texte blanc reste lisible au soleil ; les textes colorés (file d'attente, avertissements, modération) passent aux variantes lisibles du thème. Les parcours de manif et les contours d'arrêtés sont plus foncés sur la carte claire et changent de couleur avec le thème.
- **Écran de lancement** mauve (couleur intermédiaire) au lieu du bleu nuit, pour passer dans les deux thèmes.
- **Carte du digest dans l'admin** : même fond vectoriel que l'appli, clair ou sombre ; les tuiles OpenStreetMap de secours ne sont inversées qu'en sombre.
- Une seule feuille de thème partagée (`public/theme.css`) et un petit script (`public/theme.js`, chargé avant l'affichage pour éviter un flash) pour les pages annexes. Les pages publiques générées par le serveur autorisent désormais la feuille, la police et ce script du même domaine dans leur CSP.

## 2.11.0

- **Allemand** : toute l'appli est traduite (936 textes), choisie automatiquement pour les téléphones réglés en allemand, et changeable dans Plus › Réglages.
- **Annonces réservées aux orgas certifiées**, dans un rayon de 3 km au plus autour du point choisi. Une orga en période d'essai ne publie plus d'annonce : elle vérifie les signalements et peut proposer le numéro de sa legal team. Seul·e l'admin peut publier plus loin (jusqu'à 50 km) ou partout.
- **Invitations en série** dans l'onglet Orgas, pour démarcher plusieurs collectifs, syndicats ou legal teams d'un coup : un nom par ligne, un lien par orga valable 7 à 60 jours, un message type modifiable (le nom et le lien sont remplis pour chacune), « Copier le message » par orga et un tableau CSV. Les orgas arrivent en essai et se certifient dans la liste.
- **Historique complet des orgas** : le journal de chaque orga est gardé sans limite de durée (avant : 30 jours ; `ORGA_LOG_DAYS` pour fixer une durée). Dans l'onglet Orgas, chaque orga affiche ses compteurs des dernières 24 h et depuis le début, et « Voir tout l'historique » ouvre son journal, lu par pages (« Voir plus ancien ») et exportable en CSV. Les contestations automatiques par les votes suivent toujours la durée de l'archive.

## 2.10.5

- **Cartes hébergées depuis l'admin** (onglet Pays) : un bouton par pays coché pour télécharger sa carte détaillée, et un pour la carte du monde légère qui sert en dézoomant. Le serveur prend la dernière version de la carte OpenStreetMap de Protomaps, calcule la taille et vérifie la place libre avant de télécharger, montre la progression, et met la carte en service sans redémarrer (les téléphones rechargent leur configuration). « Mettre à jour » pour rafraîchir une carte, « Supprimer » pour en retirer une. La carte en place reste servie pendant le téléchargement, et rien ne se télécharge un jour de mobilisation. Il faut installer une fois l'outil `pmtiles` sur le serveur : la commande est affichée dans l'onglet et dans le guide d'installation. Les cartes vont dans `DATA_DIR/cartes`, sans rien changer à systemd ; `TILE_PMTILES` reste possible pour une carte installée à la main.
- **Lycées et facs** sur la carte, dans les lieux utiles : universités dès le zoom ville, lycées (y compris professionnels et cités scolaires) dès le zoom quartier, comme les mairies. Un nouveau filtre « Lycées et facs » dans le choix des lieux. Les lieux sont réimportés tout seuls après la mise à jour pour les ajouter.
- Lieux lus dans la carte du serveur : toutes les cartes de pays sont lues (plus seulement la première), et une nouvelle carte relance la lecture.

## 2.10.2

Correctifs de sécurité, issus d'un audit complet du code :

- Signalements : l'auteur d'un point est maintenant enregistré à part. Retirer ou déplacer un point reste réservé au téléphone qui l'a posé, même après beaucoup de confirmations ; retirer sa voix ne donne la main à personne d'autre. Renvoyer le même signalement ne remet plus à zéro les contestations et ne prolonge plus le point au-delà du plafond habituel.
- Balises de position des orgas : un vote ou une fusion ne touche plus à leur durée ; une balise arrêtée (plus d'envoi depuis 3 min) ne repart plus d'elle-même, il faut la relancer. Le journal des orgas ne garde plus aucune position de balise.
- Tor : l'en-tête qui signale le passage par l'adresse .onion n'est pris en compte que si `ONION_SECRET` ou `ONION_HOST` est défini. Tout le trafic Tor compte pour un seul réseau dans les contestations, les propositions et les demandes d'accès orga, partage un compteur commun d'essais de clé orga (`ONION_KEY_TRIES`) et un plafond d'abonnements aux notifications (`PUSH_ONION_MAX`). Le verrouillage des clés se ferme en cas d'erreur au lieu de s'ouvrir.
- Orgas en essai : le nombre de retraits est limité comme pour les orgas parrainées ; une orga en essai ou suspendue ne peut pas confirmer ses filleules.
- Propositions d'arrêtés et d'événements : 5 en attente au plus par réseau, retirées après 7 jours sans validation. Demandes d'accès orga : 5 par jour et par réseau, gardées 14 jours.
- Veille des legal teams : une adresse IP écrite directement dans le lien est vérifiée comme les autres (le réseau interne reste inaccessible, y compris sous forme IPv6). Corrige aussi la veille des sources en nom de domaine, qui échouait toujours avec les versions récentes de Node.
- Effacement d'urgence : les anciens fichiers `state.json` et `push.json` (et leurs copies `.repris-…`) sont supprimés ; la reprise les supprime désormais au lieu de les renommer.
- Sauvegarde : le fichier de suivi est écrit par l'utilisateur de l'appli et non plus par root. À réinstaller une fois : `sudo install -m 700 tools/cortege-backup.sh /usr/local/sbin/cortege-backup`.
- Import du 17 octobre : 400 événements au plus (`IMPORT_17OCT_MAX`) ; l'agenda publié garde toujours les événements des orgas et de l'admin avant ceux importés.
- Appli : un lien `?orga=` demande confirmation avant de remplacer une clé déjà enregistrée ; « Tout effacer » attend la fin de la suppression des données locales ; les fiches de droits n'affichent que du texte (et du gras). Exports CSV protégés contre les formules de tableur. Ajout d'un `.dockerignore`.

Conseil : ajoute `ONION_SECRET` dans `/etc/cortege.env` (et la même valeur dans le bloc .onion de Caddy) si ton instance a une adresse .onion.

## 2.10.1

Configurer l'instance depuis l'admin, sans toucher au serveur ni redémarrer :

- **Pays** : cocher les pays de l'instance et choisir le pays principal ; voir si chacun a une carte hébergée ; corriger un profil (noms des types, types masqués, numéros d'urgence, droits, lien violences policières), revenir au fichier d'origine, exporter le profil corrigé pour le proposer au dépôt. Les types d'un pays désactivé (ICE) disparaissent de l'appli.
- **Langues** : déposer le fichier .po renvoyé par la personne qui traduit (vérifié comme par `tools/i18n-build.js`, mis en ligne sans redémarrage) ; part traduite de chaque langue ; langues proposées ou cachées (une langue nouvelle reste cachée jusqu'à ce que tu la coches) ; langue par défaut ; fichier prêt pour Poedit pour une nouvelle langue.
- **Réglages › L'instance** : nom de la carte, email de contact, hébergeur, lien violences policières, lien du code source, pseudo, Instagram, site, lien de soutien. Les variables d'environnement ne servent plus que de valeurs de départ.
- **Serveur** : version en ligne et version publiée sur le dépôt (vérifiée au plus toutes les 6 h, seulement à l'ouverture de l'admin), commande de mise à jour à copier, mémoire, disques, base, cartes hébergées, dernière sauvegarde. Rien ne s'installe depuis l'admin.
- Sauvegarde : le script note la date et la taille de la dernière sauvegarde (lues par l'onglet Serveur) et sauvegarde aussi les traductions déposées. À réinstaller une fois : `sudo install -m 700 tools/cortege-backup.sh /usr/local/sbin/cortege-backup`.
- Mention d'origine renforcée : « Propulsé par Cortège, un projet de Neru » et les liens GitHub, neru.tv, Instagram et Ko-fi restent affichés (menu de l'appli, pages des bilans) quelle que soit la marque choisie pour l'instance ; seule une instance qui affiche déjà exactement ces liens s'en passe. Conditions additionnelles de la licence mises à jour.
- Les téléphones ouverts appliquent un changement de pays, de types ou de marque en se rechargeant la prochaine fois que l'appli passe en arrière-plan.

## 2.10.0

- Retirer ou déplacer son propre signalement : le téléphone qui a envoyé un point peut le retirer s’il est posé par erreur (supprimé sans trace dans les bilans) tant que personne d’autre ne l’a confirmé, sinon il retire seulement sa voix ; il peut aussi le déplacer de 150 m au plus dans les 10 premières minutes.
- Carte hors de France : le repli OpenStreetMap n’est plus caché par le fond de la carte vectorielle. `TILE_PMTILES` accepte plusieurs fichiers (un par pays, plus une carte du monde légère pour les zooms éloignés).
- Profils pays (`profiles/*.json`, `PROFILES=fr,de,us`) : noms des types de signalement, types masqués ou propres au pays (ICE aux États-Unis), numéros d’urgence, droits, unités (pieds et miles). Une instance peut couvrir plusieurs pays ; l’appli suit le pays affiché. Profils fournis : France, États-Unis, Allemagne (à faire relire sur place).
- Traductions en fichiers PO, un par langue (`i18n/`), avec variantes régionales, `fr.po` pour corriger le français sans toucher au code et le modèle `cortege.pot`. Une langue ajoutée apparaît toute seule. Vrais pluriels (six formes en arabe), format des dates selon le téléphone.
- Bilans et modération : « hors zone » au lieu de « hors de France ».
- Mention « Propulsé par Cortège, un projet de Neru » obligatoire sur toute instance (conditions additionnelles à l’AGPL) ; guide d’une nouvelle instance (`docs/INSTANCE.md`).

## 2.9.0

- Code réorganisé, sans changement de comportement : `server.js` ne fait plus que démarrer le serveur, tout le reste est rangé par domaine dans `src/` (signalements, orgas, annonces, agenda, arrêtés, notifications, carte, lieux, bilans, pages, publication, routes). Le code du téléphone et de l’admin est écrit en morceaux dans `client/` et assemblé dans `public/` par `npm run build`. Voir `ARCHITECTURE.md`.
- Le script de la page admin n’est plus intégré à `admin.html` (fichier `admin.js`).
- Propriétaire d’un signalement : nouvelle colonne `owner` à la place de `oid`, un nom réservé par SQLite que certaines versions refusent d’ajouter (la position en direct des orgas pouvait planter). Les bases existantes sont reprises automatiquement.
- Noms des rues et des villes sur la carte dans la langue de l’appli ; derniers textes encore en dur en français passés dans les traductions.
- Traductions : fichiers Windows acceptés, balise non fermée bloquée, {valeur} oubliée signalée, fichiers écrits d’un coup.
- `CENTER` invalide ignoré au lieu de casser la carte ; vérificateur avec délai maximal par fichier ; `/api/version` déclare aussi les fichiers de `src/`.
- Merci à JadePrice (PR #4) pour l’audit et plusieurs de ces corrections.

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
