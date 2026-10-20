# Sécurité

Cortège est utilisé par des personnes en manifestation. Une faille peut avoir des conséquences réelles : merci de la signaler en privé avant d'en parler publiquement.

## Signaler une faille

- **De préférence** : onglet **Security** de ce dépôt, bouton **Report a vulnerability**. Le signalement reste privé.
- **Sinon** : l'adresse de contact indiquée dans les mentions légales de l'appli (`/legal.html`).

Indique si possible : ce qui est touché, comment le reproduire, et l'impact que tu imagines.

## Ce à quoi je m'engage

- Te répondre dès que possible (le projet est maintenu par une seule personne, compte quelques jours au plus).
- Corriger en priorité ce qui peut exposer des manifestant·es, puis publier le correctif.
- Te créditer dans le correctif si tu le souhaites.
- Aucune poursuite pour une recherche menée de bonne foi.

Merci de ne pas tester d'attaque par saturation sur le site en ligne, de ne pas publier de faux signalements en série, et de ne pas toucher aux données d'autres personnes. Une copie locale (`node server.js`) suffit pour presque tous les tests.

## Ce que l'appli protège

- **La position** ne quitte jamais le téléphone. Le serveur ne reçoit que les signalements (arrondis à une dizaine de mètres) et les zones de carte demandées (carrés d'environ 5 km).
- **Aucun compte, aucun cookie.** Pour l'anti-spam, les signalements et votes sont accompagnés d'un identifiant tiré au hasard sur le téléphone (lié à rien ni personne) ; le serveur n'en garde qu'une empreinte chiffrée, comme pour l'adresse IP (renouvelée toutes les 6 h). Sur un serveur à processus unique, la clé de ces empreintes peut ne vivre qu'en mémoire (`SECRET_STORE=memory`) : une copie du disque ne permet alors pas de les recalculer, effacée avec le signalement ou l'événement. Pour les votes « Plus là », le serveur retient aussi depuis quand il voit cette empreinte (l'empreinte du téléphone change chaque jour, et tout est oublié au bout de 26 h), et le téléphone indique seulement s'il est près du point, sans envoyer sa position.
- **Les tuiles de carte passent par le serveur** : les adresses IP des utilisateurs ne partent pas chez le fournisseur de carte.
- **Le navigateur n'exécute que les scripts du site** (Content-Security-Policy), même si un texte piégé était un jour affiché.

## Ce qu'elle ne protège pas

- **L'hébergeur et l'opérateur mobile** voient qu'un téléphone se connecte au site. En situation sensible, utilise un VPN ou Tor (Tor Browser, ou Orbot sur Android).
- **Les faux signalements** : n'importe qui peut en publier. Les votes, la vérification par les orgas et les limites anti-abus réduisent le problème sans le supprimer.
- **Le code du serveur** ne peut pas être vérifié de l'extérieur (voir ci-dessous). C'est pour ça que les protections de la vie privée sont dans le code du téléphone, qui lui est vérifiable.

## Vérifier la version en ligne

Le code qui tourne sur les téléphones peut être comparé à ce dépôt :

```bash
git clone https://github.com/n-e-r-u/cortege && cd cortege
node verifier.js https://adresse-de-l-instance
```

Le script retélécharge chaque fichier servi par le site et compare son empreinte SHA-256 avec celle du dépôt. L'adresse `/api/version` affiche aussi la version en ligne et les empreintes déclarées.

Tu peux aussi regarder dans ton navigateur (outils de développement, onglet Réseau) tout ce que l'appli envoie : jamais ta position. Seulement les zones de carte demandées, les signalements et votes que tu fais, les villes que tu recherches, une zone arrondie à une dizaine de kilomètres si tu actives les notifications, et l'identifiant anti-spam tiré au hasard décrit plus haut.

## Audit

Aucun audit externe indépendant n'a encore été réalisé. Une relecture de sécurité complète a été faite avant le lancement. Le code est volontairement court et sans aucune dépendance pour rester lisible : les relectures extérieures sont les bienvenues.
