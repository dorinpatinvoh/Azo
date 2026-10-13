# Voix d'aide à l'inscription en langues locales (Fon, Yoruba) — texte à traduire et à enregistrer

**Principe.** L'utilisateur choisit une langue locale dans l'écran « Choisis ta langue » (section *Voix en langue locale*). L'application **reste en français** ; seule la **voix** qui guide l'inscription parle cette langue. Les téléphones n'ont pas de voix de synthèse pour le Fon ni le Yoruba : chaque message est donc un **enregistrement** fait par un locuteur natif.

**Tant qu'un enregistrement manque,** la voix lit le message en français : l'inscription n'est jamais muette. On peut donc livrer les langues message par message.

## Les 6 messages

Les textes ci-dessous sont les textes **français** d'origine (ils sont aussi lus en français si l'enregistrement manque). Les colonnes *Fon* et *Yoruba* sont à faire traduire et valider par un locuteur natif : je n'ai volontairement pas proposé de traduction, la qualité de mes traductions dans ces langues n'est pas assez sûre pour des consignes d'inscription (numéro, code, pièce d'identité).

| Fichier | Quand il est lu | Texte français | Fon | Yoruba |
|---|---|---|---|---|
| `welcome.mp3` | dès que la langue est choisie | « Bienvenue sur Azo. Je vais t'accompagner pas à pas pour créer ton compte. Appuie sur Continuer quand tu es prêt. » | *à traduire* | *à traduire* |
| `step-phone.mp3` | inscription, étape 1 | « Étape 1 sur 3. Entre ton numéro de téléphone béninois : dix chiffres, qui commencent par zéro un. Puis appuie sur Recevoir mon code. » | *à traduire* | *à traduire* |
| `step-code.mp3` | inscription, étape 2 | « Étape 2 sur 3. Je t'ai envoyé un code à quatre chiffres par SMS. Entre-le dans les quatre cases, puis appuie sur Vérifier et continuer. » | *à traduire* | *à traduire* |
| `step-register.mp3` | inscription, étape 3 | « Étape 3 sur 3. Entre ton nom et ton prénom, choisis ton sexe, puis écris ton numéro NPI de dix chiffres. Ces informations doivent correspondre à ta pièce d'identité. Ton NPI est protégé. Appuie ensuite sur Terminer mon inscription. » | *à traduire* | *à traduire* |
| `done.mp3` | inscription terminée | « Ton inscription est terminée. Bienvenue sur Azo ! » | *à traduire* | *à traduire* |
| `hint-on.mp3` | l'aide vocale est activée dans le profil | « Une voix t'explique les étapes de l'inscription. » | *à traduire* | *à traduire* |

## Consignes pour le traducteur / la personne qui enregistre

- **Les boutons restent en français à l'écran** : citer leur nom tel qu'il est écrit (« Recevoir mon code », « Vérifier et continuer », « Terminer mon inscription », « Continuer »). Ne pas les traduire dans la voix, sinon l'utilisateur ne les retrouve pas.
- Mots à garder tels quels : **NPI**, **SMS**, **Azo**.
- Parler **posément**, comme à une personne qui découvre l'application ; une pause entre les consignes.
- Les chiffres : « dix chiffres », « quatre chiffres », « zéro un » — dans la langue, comme on les dicte au quotidien.
- Garder les messages courts : si une phrase est trop longue à l'oral dans la langue, la couper en deux phrases (le sens prime sur la traduction mot à mot).

## Format des fichiers

- `.mp3`, **mono**, 64 à 96 kbit/s, voix claire, sans musique, silence net au début et à la fin.
- Nom EXACT du fichier (colonne *Fichier*), déposé dans `azo-mobile/assets/voice/fon/` ou `azo-mobile/assets/voice/yor/`.
- Puis : `npm run voice:manifest` (dans `azo-mobile`), puis reconstruire l'application : les enregistrements sont intégrés à l'APK.

## Ajouter d'autres langues plus tard (Bariba, Dendi, Goun…)

1. Ajouter la langue dans `LOCAL_VOICE_LANGUAGES` (`azo-mobile/i18n/languages.ts`) et dans le type `LocalVoiceCode`.
2. L'ajouter à `LANGS` dans `azo-mobile/scripts/gen-voice-manifest.js` et créer le dossier `assets/voice/<code>/`.
3. Déposer les enregistrements comme ci-dessus, relancer `npm run voice:manifest`.

Aucune autre partie de l'application n'est à traduire : la langue locale ne concerne que la voix.
