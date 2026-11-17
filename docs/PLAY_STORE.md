# Cortège sur le Play Store

L'appli Android est une coquille officielle de Google (Trusted Web Activity) qui ouvre le site en plein écran. Elle ne contient
aucun code de Cortège, aucun outil de statistiques, de pub ni Firebase : c'est la web app, avec les mêmes garanties. Le site se
met à jour comme d'habitude ; l'appli n'a besoin d'une nouvelle version que si son nom, son icône ou ses couleurs changent.

Le projet est dans `android/`, généré avec Bubblewrap (`android/twa-manifest.json`), réglé pour l'instance d'origine : une autre instance change son adresse, son identifiant et ses icônes (voir la fin de ce guide). Il est construit par GitHub Actions
(`.github/workflows/android.yml`), pas sur le serveur.

## 1. La clé d'envoi (une seule fois)

Le Play Store garde la vraie clé de signature de l'appli (« signature d'application par Google Play »). Toi, tu gardes une clé
d'envoi : si elle est perdue ou volée, Google peut la remplacer. Crée-la sur le serveur, ou sur tout ordinateur avec Java :

```
sudo apt install -y openjdk-21-jre-headless
PASS=$(openssl rand -base64 24 | tr -d '/+=')
keytool -genkeypair -v -keystore cortege-upload.keystore -alias cortege -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Cortege"
echo "Mot de passe : $PASS"
base64 -w0 cortege-upload.keystore > cortege-upload.b64
keytool -list -v -keystore cortege-upload.keystore -storepass "$PASS" | grep "SHA256:"
```

Puis dans GitHub, **Settings > Secrets and variables > Actions > New repository secret** :

| Secret | Valeur |
|---|---|
| `ANDROID_KEYSTORE_B64` | le contenu de `cortege-upload.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | le mot de passe affiché |
| `ANDROID_KEY_PASSWORD` | le même mot de passe |

Garde une copie de `cortege-upload.keystore` et du mot de passe hors du serveur (clé USB, gestionnaire de mots de passe),
puis efface les fichiers du serveur. Note l'empreinte `SHA256:` affichée : elle sert à l'étape 4.

## 2. Construire l'appli

GitHub, onglet **Actions > Appli Android > Run workflow**. Au bout de quelques minutes, l'archive `cortege-android` contient :

- `cortege.aab` : le paquet à envoyer au Play Store ;
- `cortege.apk` : l'appli à installer directement, sans le Play Store ;
- `cortege-test-debug.apk` : une version de test, signée avec une clé jetable.

Pour une nouvelle version : augmenter `versionCode` (et `versionName`) dans `android/app/build.gradle` et `appVersionCode`
dans `android/twa-manifest.json`, puis relancer.

## 3. La Play Console

1. Compte développeur personnel sur [play.google.com/console](https://play.google.com/console) (25 $, une fois). Sont affichés
   publiquement : ton nom légal, ton pays et l'e-mail de contact du compte. Statut dans l'UE : « non professionnel » (non-trader)
   tant que l'appli est gratuite, sinon l'adresse et le téléphone deviennent publics.
2. **Créer l'appli** : nom « Cortège : la carte des manifs », langue par défaut français, application, gratuite.
3. **Test fermé obligatoire** (comptes personnels créés depuis fin 2023) : 12 testeurs inscrits sans interruption pendant
   14 jours avant de pouvoir demander la publication. Créer une piste « Test fermé », y envoyer `cortege.aab`, ajouter les
   adresses Gmail des testeurs, leur envoyer le lien d'inscription.
4. **Lier l'appli au site** : Play Console > Test et publication > Configuration > **Intégrité de l'appli** > Signature de
   l'application. Copier l'empreinte SHA-256 du « certificat de clé de signature d'application ». Sur le serveur, dans
   `/etc/cortege.env`, avec l'empreinte de la clé d'envoi (étape 1) pour l'APK installé directement :
   ```
   ANDROID_CERT_SHA256=AA:BB:…(Play),CC:DD:…(clé d'envoi)
   ```
   Redémarrer Cortège et vérifier `https://<ton instance>/.well-known/assetlinks.json`. Sans ce fichier, l'appli s'ouvre
   quand même, mais avec une barre d'adresse en haut.
5. Remplir la fiche et les formulaires (section suivante), puis demander l'accès à la production après les 14 jours.
6. Pour trouver les testeur·ses : Admin › Réglages › « Test de l’appli Android », le lien de ta page d’inscription. Un bandeau
   s’affiche sur les téléphones Android et un cadre dans Plus.
7. Une fois l'appli publiée : Admin › Réglages › « Fiche Google Play », le lien de la fiche. Le cadre de Plus devient « Cortège est
   sur le Play Store », le test fermé n'est plus proposé, et le lien apparaît sur l'espace presse et la page « Pour les orgas ».

## 4. Fiche du Play Store

**Nom** (30 caractères au plus) : `Cortège : la carte des manifs`

**Description courte** (80 au plus) : `Carte collaborative en direct pour se protéger en manif. Sans compte ni pistage.`

**Description complète** :

```
Cortège, c'est la carte des manifs en temps réel, tenue par celles et ceux qui y sont.

Pendant une manif, un blocus ou un rassemblement, chacun·e signale en deux appuis ce qui se passe : police, nasse, gaz lacrymogène, charge, contrôle ou barrage filtrant, street medics, point d'eau, zone calme. Les signalements s'affichent en direct pour tout le monde autour, et disparaissent seuls quand ils ne sont plus d'actualité.

SANS COMPTE, SANS PISTAGE
• Pas d'inscription, pas de mot de passe, pas de numéro de téléphone.
• Aucune adresse IP n'est gardée. Les signalements ne sont reliés à personne.
• Pas de pub, pas d'outil de statistiques, pas de revente de données.
• Le code est libre et public.

SE PROTÉGER ET PROTÉGER LES AUTRES
• Alertes quand un danger est signalé près de toi, même appli fermée.
• Tête de cortège, parcours et point de dispersion annoncés par les orgas.
• Tes droits en cas de contrôle ou d'interpellation, et les numéros des legal teams de ta ville.
• Un SMS d'alerte pré-rempli pour prévenir un proche.

TENIR QUAND LE RÉSEAU SATURE
• Mode léger quand ça capte mal.
• Les signalements partent dès que le réseau revient.
• La carte reste lisible hors ligne.

POUR LES ORGAS, LEGAL TEAMS ET STREET MEDICS
• Syndicats, collectifs et legal teams : annonces localisées, vérification des signalements, agenda des mobilisations.
• Street medics : un écran à part, avec une carte privée entre équipes.

Cortège est gratuit et financé par les dons. Il ne remplace pas la vigilance : vérifie toujours ce que tu vois sur place.
```

**Catégorie** : Cartes et navigation. **E-mail de contact** : celui du compte. **Site** : `https://<ton instance>`.
**Règles de confidentialité** : `https://<ton instance>/legal.html`.

**Images** (dans `android/store/`) : `icone-512.png` (icône), `image-presentation-1024x500.png` (bannière). Captures d'écran :
2 à 8, prises sur un téléphone avec la vraie carte (carte avec signalements, fiche « Signaler », mes droits, agenda). Ne pas y
laisser de vrai signalement qui permettrait d'identifier quelqu'un.

## 5. Formulaires de la Play Console

**Accès à l'appli** : tout est accessible sans connexion. Pour l'espace orga, préciser qu'il faut une invitation (pas de
compte à fournir).

**Annonces** : non. **Achats intégrés** : non.

**Public cible** : 13 ans et plus (les lycéen·nes s'en servent pendant les blocus). Ne pas cocher « moins de 13 ans ».

**Classification du contenu** (questionnaire IARC) : catégorie « Référence, actualités ou éducation ». Interaction entre
utilisateurs : oui, contenu publié par les utilisateurs (signalements sur la carte, sans messagerie). Partage de la position :
oui (position des signalements ; position en direct pour les orgas qui l'activent). Pas de violence, pas de contenu sexuel,
pas de jeux d'argent.

**Sécurité des données** (réponses honnêtes, à relire avec `legal.html`) :

| Question | Réponse |
|---|---|
| Données partagées avec des tiers | Aucune |
| Données chiffrées en transit | Oui |
| Possibilité de demander la suppression | Oui : les données s'effacent seules (signalements en quelques heures), et l'e-mail de contact pour le reste |
| Position approximative | Collectée, facultative : zone des alertes (arrondie) pour qui active les notifications. Fonctionnalité de l'appli |
| Position précise | Collectée, facultative : l'endroit d'un signalement, et la position en direct d'une orga qui l'active. Fonctionnalité de l'appli. Non reliée à une identité |
| Identifiants de l'appareil | Collectés : identifiant aléatoire anti-spam créé par l'appli (pas l'identifiant publicitaire). Prévention des abus |
| Contenu généré par l'utilisateur | Collecté : signalements, annonces et propositions d'événements. Fonctionnalité de l'appli |
| Photos | Collectées, facultatives : photo jointe à un signalement, visages masqués sur le téléphone avant l'envoi. Fonctionnalité de l'appli. Non reliée à une identité. Effacée au bout de 3 jours, sauf si elle est choisie pour un bilan public |
| Tout le reste (nom, e-mail, contacts, historique…) | Non collecté |

**Contenu généré par les utilisateurs** : Google demande un moyen de signaler un contenu abusif et une modération. Dans
Cortège : « Faux / plus là » sur chaque signalement, « Signaler la photo » sur chaque photo (cachée après 2 signalements),
vérification et retrait par les orgas, retrait par l'admin. Une photo n'est publique qu'une fois le point vérifié. Le dire dans
la déclaration.

## À savoir

- **Google sait qui installe** : passer par le Play Store, c'est installer avec un compte Google. Le site, l'installation depuis
  le navigateur et l'APK direct restent les voies les plus discrètes ; la fiche et l'appli le rappellent.
- **Refus possible** : une appli qui montre la position de la police peut être examinée de près. Si Google refuse, la raison
  sera donnée dans la Play Console ; le site et l'APK direct ne changent pas.
- **Vérification des développeurs** : à partir de 2027, Google exigera partout qu'une appli Android, même installée hors du
  Play Store, vienne d'un développeur vérifié. Le compte de la Play Console couvre aussi l'APK direct.
- Autre instance : changer `packageId`, `host`, le nom et les icônes dans `android/twa-manifest.json` et
  `android/app/build.gradle`, et régler `ANDROID_PACKAGE` en plus de `ANDROID_CERT_SHA256` sur son serveur.
