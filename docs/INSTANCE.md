# Ouvrir une instance de Cortège dans un autre pays

Une instance, c'est un serveur qui fait tourner Cortège pour une zone : un pays, une région, ou plusieurs pays. Le code est le même partout ; ce qui change d'un pays à l'autre est décrit dans un **profil pays** (`profiles/<pays>.json`), et les textes dans les **traductions** (`i18n/`).

Avant tout : Cortège sert à des personnes en manifestation. Une instance mal tenue peut les mettre en danger. Lis la partie « Vie privée » jusqu'au bout.

## 1. Vie privée : ce qu'une instance doit garantir

- **Aucun journal d'accès** sur le serveur web (Caddy n'en garde pas par défaut) et `ACCESS_LOGS=none`.
- **Clés de hachage en mémoire seulement** : `SECRET_STORE=memory`. Rien ne permet ensuite de relier une empreinte à un téléphone.
- **Aucun service intermédiaire** qui voit le trafic (CDN, proxy d'un tiers) : il verrait les adresses IP de tout le monde.
- **La carte hébergée sur le serveur** (`TILE_PMTILES`) : sans elle, les adresses IP partent chez le fournisseur de tuiles.
- **Un accès par Tor** (adresse .onion), pour que l'opérateur téléphonique ne voie même pas l'usage de l'appli.
- **Un hébergeur dans un pays où les données sont protégées**, et des sauvegardes chiffrées (voir [INSTALLATION.md](INSTALLATION.md)).
- **Aucune donnée en plus** de ce que le code garde déjà. Toute modification qui stocke quelque chose doit être décrite dans `public/legal.html`.

Dans certains pays, la police demande couramment aux hébergeurs les données qu'ils gardent : ces règles ne sont pas des options.

## 2. Installer

Suis [INSTALLATION.md](INSTALLATION.md), puis dans le fichier de configuration du serveur :

```bash
TILE_PMTILES=/var/lib/cortege-map/usa.pmtiles,/var/lib/cortege-map/monde.pmtiles
```

Le reste se règle dans l'admin, sans redémarrer :

- **Réglages** : nom de la carte, contact, hébergeur, liens, ta marque ;
- **Pays** : les pays de ton instance, le pays principal, les corrections de leur profil ;
- **Langues** : les langues proposées, la langue par défaut, les traductions déposées ;
- **Serveur** : version, mise à jour disponible, disque, mémoire, cartes, dernière sauvegarde.

Les variables `PROFILES`, `DEFAULT_LANG`, `EVENT_NAME`, `CONTACT_EMAIL`, `BRAND_*`… ne servent plus que de valeurs de départ.

## 3. La carte de ton pays

Découpée dans les fichiers quotidiens de [Protomaps](https://docs.protomaps.com/basemaps/downloads) (données OpenStreetMap, ODbL), avec l'outil [pmtiles](https://github.com/protomaps/go-pmtiles/releases) :

```bash
# Ton pays, jusqu'au zoom de la rue (la zone est un fichier .geojson ; garde-le à côté de la carte, même nom)
pmtiles extract https://build.protomaps.com/AAAAMMJJ.pmtiles /var/lib/cortege-map/allemagne.pmtiles \
  --region=/opt/cortege/app/tools/germany.geojson --maxzoom=15
cp /opt/cortege/app/tools/germany.geojson /var/lib/cortege-map/allemagne.geojson

# Le monde, en zooms éloignés seulement (quelques dizaines de Mo) : jamais d'écran vide en dézoomant
pmtiles extract https://build.protomaps.com/AAAAMMJJ.pmtiles /var/lib/cortege-map/monde.pmtiles --maxzoom=6
```

Mets d'abord les fichiers des pays, puis celui du monde, dans `TILE_PMTILES`. Hors des zones hébergées, au zoom de la rue, la carte se replie sur OpenStreetMap via le serveur (sans transmettre les adresses IP) : à éviter pour une instance très utilisée, les serveurs d'OpenStreetMap ne sont pas faits pour ça.

## 4. Le profil de ton pays

Si ton pays a déjà un profil, active-le dans Administration › Pays. Tu peux y corriger les noms des types, les numéros d'urgence et les droits ; « Exporter » te donne le fichier à proposer au dépôt d'origine.

Pour un pays sans profil, copie un profil existant (`profiles/us.json`, `profiles/de.json`) et adapte-le :

| Champ | Rôle |
|---|---|
| `code`, `name` | Code du pays (`it`, `es`…) et nom en français |
| `area` | Contour du pays : `geo/countries/<area>-50m.json` (serveur) et `-110m.json` (téléphone), tirés de Natural Earth |
| `lang` | Langue principale du pays (langue de secours si l'instance commence par ce profil) |
| `units` | `metric` ou `imperial` (pieds et miles) |
| `emergency` | Numéros d'urgence : `medical`, `general`, et si besoin `pharmacy`, `police`, `poison` |
| `labels` | Nom local des types de signalement, écrit en français (il est traduit comme le reste). Ex. : `"bac": "Policiers en civil / à vélo"` |
| `hidden` | Types qui n'existent pas dans ton pays |
| `extra` | Types propres à ton pays : `id`, `group` (`fdo`, `danger`, `soutien`, `info`), `label`, `glyph`, `ttl` (minutes), `alert` (alerte de proximité), `merge` (rayon de fusion) |
| `rights` | Sections « Mes droits » : `title` et `items` (en français, le gras `<b>` est permis) |
| `violence` | Lien vers une association qui recense les violences policières : `label`, `desc`, `url` |

Les types gardent partout le même comportement (alertes, vibrations, fusion) : seuls leur nom et la liste visible changent. Fais relire le profil par des personnes du pays (legal teams, street medics) avant de l'ouvrir au public : un conseil juridique faux est dangereux.

Ensuite `node tools/i18n-build.js --pot` ajoute les nouveaux textes aux traductions.

## 5. La langue

Si la langue de ton pays manque : Administration › Langues › « Faire traduire dans une nouvelle langue » donne le fichier à envoyer à la personne qui traduit. Quand elle te le renvoie, dépose-le au même endroit : il est vérifié, mis en ligne sans redémarrer, et reste caché tant que tu ne coches pas la langue. Voir aussi [i18n/LISEZMOI.md](../i18n/LISEZMOI.md).

## 6. La mention d'origine

Le nom, le logo et les liens de ton instance sont libres (Administration › Réglages, `public/brand/logo.png`). La mention « Propulsé par Cortège, un projet de Neru », avec les liens de l'auteur (dépôt d'origine, neru.tv, Instagram, Ko-fi), doit rester visible dans le menu ; tes propres liens s'y ajoutent sans la remplacer : voir [les conditions additionnelles de la licence](../LICENSE-ADDITIONAL-TERMS.md). Le code modifié doit aussi rester public (AGPL).

## 7. Partager tes améliorations

Un profil, une traduction ou une correction utile à tout le monde : propose-les au dépôt d'origine (voir [CONTRIBUTING.md](../CONTRIBUTING.md)). Toutes les instances en profitent.
