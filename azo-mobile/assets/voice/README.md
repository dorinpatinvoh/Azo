# Voix en langues locales (Fon, Yoruba)

Pour l'assistance vocale de l'inscription, l'application lit un **enregistrement** quand l'utilisateur a choisi une langue
locale (les téléphones n'ont pas de voix de synthèse pour le Fon ni le Yoruba). L'application reste en français.

## Ajouter un enregistrement
1. Faire traduire puis enregistrer chaque message par un locuteur natif (textes et consignes : `PROJECT_SUMMARY/SCRIPT_VOIX_LANGUES_LOCALES.md`).
2. Déposer le fichier `.mp3` (mono, voix posée) dans `assets/voice/fon/` ou `assets/voice/yor/` avec EXACTEMENT ce nom :

| Fichier | Message |
|---|---|
| `welcome.mp3` | accueil, quand la langue est choisie |
| `hint-on.mp3` | confirmation quand l'aide vocale est activée dans le profil |
| `step-phone.mp3` | inscription, étape 1 (numéro de téléphone) |
| `step-code.mp3` | inscription, étape 2 (code reçu par SMS) |
| `step-register.mp3` | inscription, étape 3 (nom, prénom, sexe, NPI) |
| `done.mp3` | fin de l'inscription |

3. Lancer `npm run voice:manifest`, puis reconstruire l'application (les fichiers sont intégrés à l'application).

Un message sans enregistrement est lu en français par la voix du téléphone : l'inscription n'est jamais muette.
