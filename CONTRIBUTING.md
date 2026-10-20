# Contribuer à Cortège

Merci de vouloir aider. Cortège sert à des personnes en manifestation : chaque changement doit rester simple, fiable sur un réseau saturé, et ne jamais affaiblir la protection des personnes qui l'utilisent.

## Signaler un problème ou proposer une idée

Ouvre une « issue » avec le modèle qui correspond (bug ou idée). Plus c'est concret, mieux c'est : téléphone et navigateur, ce que tu as fait, ce qui s'est passé, une capture si possible.

**Une faille de sécurité ne se signale jamais dans une issue publique** : voir [SECURITY.md](SECURITY.md).

## Proposer du code

1. Fais un fork, puis une branche pour ton changement.
2. Lance l'appli en local : `node server.js` (Node 22.13 ou plus, 24 conseillé), puis ouvre http://localhost:8080.
3. Lance les tests : `npm test`. Ils doivent tous passer, et un nouveau comportement mérite un test.
4. Ouvre une « pull request » qui explique le pourquoi, pas seulement le quoi.

## Les règles du projet

- **Aucune dépendance** côté serveur : uniquement ce que fournit Node. Côté téléphone, des bibliothèques copiées dans `public/vendor/`, jamais chargées depuis un autre site.
- **La position ne quitte jamais le téléphone.** Le serveur ne reçoit que les signalements (arrondis) et des zones larges.
- **Rien d'identifiant n'est stocké en clair** : ni adresse IP, ni identifiant de téléphone. Toute nouvelle donnée conservée doit être justifiée, limitée dans le temps et décrite dans `public/legal.html`.
- **Pensé pour un réseau saturé** : petites réponses, fichiers statiques, mode léger, hors ligne.
- **Textes de l'appli** : en français, clairs, sans infantiliser.
- Le code reste court et lisible : une relecture extérieure doit rester possible.

## Licence

En contribuant, tu acceptes que ton code soit publié sous la licence du projet (AGPL-3.0).
