# Cortège

[![Tests](https://github.com/n-e-r-u/cortege/actions/workflows/tests.yml/badge.svg)](https://github.com/n-e-r-u/cortege/actions/workflows/tests.yml)

**La carte des manifs en temps réel, faite par celles et ceux qui y sont.**

Cortège est une appli web gratuite et libre : pendant une manif, chacun·e signale ce qu'il ou elle voit (nasse, lacrymo, charge, street medics, legal team, zone calme…) et tout le monde le voit sur la carte, en quelques secondes. Pas de compte, pas de pub, pas de pistage.

## Ce que ça fait

- 📍 **Signaler en deux gestes** : un viseur, un type, c'est envoyé. Les autres confirment (« Toujours là ») ou démentent (« Plus là »), et chaque point s'éteint tout seul au bout de quelques minutes.
- 📳 **Être prévenu·e** : une vibration différente pour chaque danger proche, et des notifications même appli fermée (annonces urgentes, dangers dans ta zone).
- ⚖️ **Connaître ses droits** : les numéros des legal teams de ta ville, les réflexes en cas d'interpellation, un SMS d'alerte pré-rempli pour un proche.
- 📅 **Agenda** : manifs, blocus, rassemblements et AG, avec le parcours sur la carte.
- 🏛 **Lieux utiles** : préfectures, commissariats, tribunaux, lycées et facs, hôpitaux, pharmacies, points d'eau.
- 📶 **Tenir quand le réseau sature** : mode léger, signalements gardés jusqu'à ce que ça capte, dernière situation connue affichée hors ligne, carte gardée sur le téléphone.
- 📣 **Pour les orgas et legal teams** : annonces localisées, vérification et retrait des faux signalements, accès par QR code sans mot de passe.

## Contre les faux signalements

- Un « Plus là » ne supprime jamais un point à lui seul. Il faut plusieurs votes, venant d'au moins deux réseaux différents, pour qu'un point devienne « contesté » : il est alors grisé et s'éteint au bout de quelques minutes, sauf si quelqu'un le confirme.
- Les votes n'ont pas tous le même poids : un vote fait près du point compte davantage, celui d'un téléphone apparu il y a quelques minutes compte moins, et les votes en rafale ne sont pas comptés. Un point déjà confirmé demande plus de votes.
- Un point vérifié par une orga ne peut pas être contesté par les votes. Les points contestés passent par la corbeille de l'admin, qui peut les rétablir.
- Les orgas entrent par invitation, avec une période d'essai ou un parrainage. Un accès révoqué coupe aussi les orgas que celle-ci a fait entrer.

Détails : [anti-abus](docs/FONCTIONNEMENT.md#anti-abus).

## Ta vie privée

- Ta position ne quitte jamais ton téléphone : seuls les signalements partent, arrondis à une dizaine de mètres.
- Aucun compte, aucun cookie, aucun traqueur. Les signalements sont effacés à leur expiration.
- La carte peut être servie par le serveur lui-même (aucune requête vers un fournisseur) et l'appli est joignable par Tor.
- Le code est public : chacun·e peut vérifier que l'appli en ligne est bien celle de ce dépôt.

Détails : [ce que le serveur sait et ne sait pas](docs/FONCTIONNEMENT.md#ce-que-le-serveur-sait-et-ne-sait-pas) et [SECURITY.md](SECURITY.md).

## Héberger ta propre carte

Cortège tourne sur un petit serveur (Node 22.13+, aucune dépendance à installer) ou sur un hébergement mutualisé avec cPanel :

```bash
node server.js   # puis ouvre http://localhost:8080
```

- [Installation et configuration](docs/INSTALLATION.md) : variables, VPS, cPanel, Docker, sauvegarde, carte hébergée, adresse .onion.
- [Fonctionnement détaillé](docs/FONCTIONNEMENT.md) : signalements, anti-abus, administration, digest.
- [Nouveautés de chaque version](CHANGELOG.md).

## Participer

Bug, idée, traduction : ouvre une [issue](../../issues) ou lis [CONTRIBUTING.md](CONTRIBUTING.md). Une faille de sécurité : voir [SECURITY.md](SECURITY.md), sans la publier.

## Licence et crédits

Licence [AGPL-3.0](LICENSE) : toute version modifiée mise en ligne doit publier son code. Toute instance garde aussi la mention d'origine dans son interface : voir les [conditions additionnelles](LICENSE-ADDITIONAL-TERMS.md).

Données cartographiques © les contributeur·ices d'[OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL). Noms et positions des villes du digest : [GeoNames](https://www.geonames.org/) (CC BY 4.0), fichier `places.json`.
Polices des stories : Inter et JetBrains Mono (SIL Open Font License), dans `public/vendor/fonts/`. Rendu de la carte vectorielle : [protomaps-leaflet](https://github.com/protomaps/protomaps-leaflet) (BSD-3-Clause). Fond de carte des stories : Natural Earth via world-atlas (domaine public).
