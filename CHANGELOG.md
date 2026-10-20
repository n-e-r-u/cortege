# Nouveautés

Versions : **majeure** (3.0) pour un gros changement visible ou qui casse l'existant, **mineure** (2.1, 2.2…) pour de nouvelles fonctions, **correctif** (2.1.1) pour une réparation sans nouveauté.

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
