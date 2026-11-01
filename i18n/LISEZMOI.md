# Traductions de Cortège

Un fichier par langue, au format PO, le format standard des logiciels libres. Il s'ouvre avec [Poedit](https://poedit.net) (gratuit) ou se traduit en ligne avec Weblate (qui peut s'héberger soi-même).

| Fichier | Rôle |
|---|---|
| `cortege.pot` | Le modèle : tous les textes de l'appli, avec des notes pour les mots de terrain (BAC, nasse, sommations…) |
| `fr.po` | Corrections du français, sans toucher au code : un texte rempli ici remplace le texte d'origine |
| `en.po`, `es.po`, `ar.po`… | Une langue par fichier |
| `en-US.po`… | Variante régionale facultative : seulement les textes qui changent par rapport à `en.po` |

Le texte français sert d'identifiant (`msgid`). Les `{valeurs}` entre accolades et les balises (`<b>`, `<small>`…) doivent rester dans la traduction.

## Ajouter une langue depuis l'admin

Le plus simple, sans toucher au serveur : Administration › Langues.

1. « Faire traduire dans une nouvelle langue » : donne le code (`de`, `it`, `pt-BR`…) et le nom de la langue. Tu reçois un fichier prêt pour Poedit, en-tête et pluriels remplis.
2. Quand la personne te le renvoie, « Déposer une traduction » le vérifie (balises, valeurs, nombre de formes du pluriel) et le met en ligne sans redémarrer.
3. Une langue nouvelle reste cachée : coche-la quand elle est assez avancée. Un texte pas encore traduit s'affiche en français.

Un fichier déposé est gardé dans le dossier de données du serveur et passe devant le fichier livré du même code. Pour en faire profiter toutes les instances, propose-le aussi sur le dépôt.

## Ajouter une langue dans le dépôt

1. Copie `cortege.pot` en `de.po` (le code de la langue : `de`, `it`, `pt`…).
2. Dans l'en-tête, renseigne :
   - `Language: de`
   - `X-Language-Name: Deutsch` (le nom de la langue, écrit dans la langue)
   - `X-Locale: de-DE` (format des dates par défaut)
   - `Plural-Forms:` la règle de la langue (Poedit la propose ; la liste officielle est sur le site de gettext).
3. Traduis. Un texte laissé vide s'affiche en français.
4. `node tools/i18n-build.js` vérifie le fichier (balises, valeurs, nombre de formes du pluriel) et construit `public/lang/de.json`.
   Au redémarrage du serveur, la langue apparaît toute seule dans l'appli, choisie automatiquement pour les téléphones réglés dans cette langue.

## Pluriels

Une phrase avec un nombre a une forme par cas de la langue : 2 en français et en anglais, 3 en russe, 6 en arabe. Les formes sont rangées dans l'ordre zero, one, two, few, many, other (seules celles que la langue utilise), comme le navigateur les choisit.

## Après une modification du code

`node tools/i18n-build.js --pot` met à jour `cortege.pot` avec les nouveaux textes trouvés dans le code, et les ajoute, vides, à chaque langue (bloc « textes à traduire » en fin de fichier). Les textes des pages HTML se relèvent dans l'appli ouverte, avec `I18N.collect(document.body)` dans la console du navigateur.
