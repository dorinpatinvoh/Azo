# Demande backend — langue de l'utilisateur et textes serveur traduits

**De :** Sergio (mobile) — **Pour :** l'équipe backend
**Contexte :** l'app mobile est maintenant traduite en 4 langues (français, anglais, espagnol, allemand). Le client choisit sa langue après l'onboarding ou dans son profil. Tous les textes écrits dans l'app sont traduits, **mais les textes qui viennent du serveur restent en français**. Rien n'a été modifié dans le backend côté mobile : ce document décrit ce qu'il faut ajouter.

## 1. Ce que le mobile fait déjà

- Langues gérées (codes) : `fr`, `en`, `es`, `de`. Défaut : `fr`.
- La langue est stockée sur le téléphone (SecureStore). Le serveur ne la connaît pas.
- Si le serveur envoie un texte, le mobile l'affiche tel quel, sans traduction.

## 2. Ce qui reste en français aujourd'hui (venant du serveur)

| Source | Exemple |
|---|---|
| Messages d'erreur HTTP (`message` des exceptions Nest) | « Solde insuffisant », « Course introuvable », validations d'inscription |
| Notifications (`GET /notifications` : `title`, `body`) | « Chauffeur trouvé », « Course terminée » |
| Libellés des transactions (`GET /wallet/transactions` : `label`, `meta`) | « Course Zem Express », « Recharge en attente FedaPay » |
| Messages du socket / statuts texte éventuels | demande d'arrêt, expiration de recherche |

## 3. Proposition

### 3.1 Stocker la langue
- Ajouter `language String @default("fr")` au modèle `User` (Prisma + migration).
- Valeurs acceptées : `fr | en | es | de` (validation `@IsIn`).
- Exposer `language` dans `GET /users/me` (profil).
- Nouvel endpoint : `PATCH /users/me/language` avec `{ "language": "en" }` → renvoie le profil à jour.
- **Côté mobile**, une fois l'endpoint disponible, j'appelle ce PATCH à chaque changement de langue (et à la connexion si le serveur a une autre valeur). Prévenez-moi du nom exact de la route.

### 3.2 En-tête alternatif (utile avant la connexion)
Accepter l'en-tête `Accept-Language: fr|en|es|de` sur toutes les routes. Si l'utilisateur est connecté, sa `language` a priorité ; sinon l'en-tête ; sinon `fr`. Cela permet de traduire les erreurs de l'inscription/OTP, qui arrivent avant que le profil existe. Le mobile peut envoyer cet en-tête dès que vous le confirmez.

### 3.3 Traduire les messages d'erreur
- Plutôt que des phrases en dur, renvoyer un **code stable** en plus du texte : `{ "statusCode": 400, "code": "WALLET_INSUFFICIENT", "message": "Solde insuffisant" }`.
- Le mobile traduira alors lui-même à partir du code (je gère la table dans l'app) et gardera `message` en secours. C'est la solution la plus simple pour vous : aucune traduction à écrire côté serveur.
- Codes à prévoir en priorité : solde insuffisant, course introuvable/expirée, code PIN/arrivée invalide, NPI invalide ou déjà utilisé, OTP invalide/expiré, trop de tentatives.

### 3.4 Traduire les notifications et libellés de transactions
Deux options, à vous de choisir :
1. **Code + paramètres** (recommandé) : stocker `titleKey`, `bodyKey`, `params` (JSON) au lieu du texte final. Le mobile traduit. Exemple : `{ "titleKey": "RIDE_MATCHED", "params": { "driver": "Romaric" } }`.
2. **Texte déjà traduit** : un petit dictionnaire serveur `fr/en/es/de` et on écrit la notification dans la langue du destinataire au moment de la création (`user.language`). Moins souple : l'historique reste dans l'ancienne langue si l'utilisateur en change.

Pour ne rien casser : garder `title`/`body`/`label` en français tant que le mobile n'a pas basculé, et ajouter les champs `*Key`/`params` à côté.

## 4. Ordre conseillé
1. `language` sur `User` + `PATCH /users/me/language` (rapide, débloque le reste).
2. Codes d'erreur (`code`) sur les erreurs du portefeuille, des courses et de l'inscription.
3. Notifications et libellés de transactions avec clés + paramètres.

## 5. Autres points repérés en récupérant le dernier `main`

- **Recharge FedaPay (`POST /wallet/recharge`)** : la réponse est maintenant `{ url, transactionId }`. Le mobile ouvre `url` dans le navigateur, puis recharge le solde au retour. Constats :
  - La transaction « en attente » est enregistrée avec `type: DEBIT`; elle apparaîtra comme une dépense dans l'historique. Un statut `PENDING` (ou un `CREDIT` marqué en attente) serait plus clair.
  - Le crédit du solde doit venir d'un **webhook/callback FedaPay** (`FEDAPAY_CALLBACK_URL`) ou d'une vérification (`verifyTransaction`) — je ne l'ai pas vu dans le code récupéré. Sans cela le solde ne bouge jamais après le paiement.
  - `customer.email` vient de `user.email` : les clients inscrits par téléphone n'ont peut-être pas d'e-mail. Prévoir une valeur de repli.
- **Noms de lieux** (Place de l'Étoile Rouge, Marché Dantokpa…) : volontairement non traduits (noms propres).
