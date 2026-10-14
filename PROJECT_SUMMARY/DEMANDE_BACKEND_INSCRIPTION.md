# Demande backend — Inscription après l'OTP : nom, prénom, sexe et NPI

Date : 11 octobre 2026 · Priorité : **haute** (bloque l'inscription des nouveaux comptes) · Modules : `azo-backend/src/users/users.module.ts`, `src/auth/auth.service.ts`, `prisma/schema.prisma`

Le front mobile est **déjà fait**. Ce document décrit ce que le backend doit fournir pour qu'il fonctionne, et les règles de sécurité à respecter pour un numéro d'identité.

> ⚠️ **Ne pas livrer un APK avec ce formulaire avant que ce backend soit déployé** (migration appliquée sur la base de Render comprise). Sans la route `POST /users/me/registration`, un nouveau compte reste bloqué sur le formulaire (l'application affiche « Serveur pas à jour »).

---

## 1. Le parcours côté application

```
Numéro de téléphone → code OTP (4 chiffres) → [ Inscription ] → accueil
```

L'écran d'inscription s'ouvre **après la vérification de l'OTP**, pour tout compte `CLIENT` dont l'inscription n'est pas terminée. Il demande :

| Champ | Saisie | Contrôle côté application |
|---|---|---|
| Nom | texte | 2 à 50 caractères, lettres (accents), espace, tiret, apostrophe, **aucun chiffre** |
| Prénom | texte | idem |
| Sexe | choix `Masculin` / `Féminin` | obligatoire |
| NPI | chiffres | **10 chiffres** exactement (espaces tolérés à la saisie) |

L'étape est **obligatoire** : pas de bouton retour. Si l'application est fermée pendant l'inscription, elle rouvre directement sur le formulaire à la prochaine ouverture (la session est déjà ouverte à ce stade).

Aujourd'hui, le backend ne propose qu'une étape « pseudo » (`PATCH /users/me { fullName }`). **Elle est remplacée par ce formulaire.**

---

## 2. Contrat d'API demandé

### 2.1 `POST /users/me/registration` (nouvelle route)

Authentifiée (JWT), réservée au rôle `CLIENT` (un prestataire s'inscrit toujours d'abord comme client, le rôle métier n'étant accordé qu'à l'approbation de son dossier).

Requête :

```json
{ "lastName": "Adjovi", "firstName": "Kossi", "gender": "M", "npi": "1234567890" }
```

Réponse `201` : le profil mis à jour (même forme que `GET /users/me`, voir §2.2), avec `"profileComplete": true`.

Erreurs attendues (l'application les distingue) :

| Statut | Cas | Message affiché |
|---|---|---|
| `400` | Champ invalide (liste de messages en français, comme le reste de l'API) | le message du serveur |
| `404` | Route absente (serveur pas à jour) | « Serveur pas à jour… » |
| `409` | **NPI déjà associé à un autre compte** | « NPI déjà utilisé… contacte le support » |
| `409` | Inscription déjà terminée pour ce compte (voir règle ci-dessous) | message du serveur |
| `401` / `403` | Jeton invalide, compte bloqué, rôle non autorisé | message du serveur |

**Règle d'immutabilité : l'inscription ne s'écrit qu'une fois.** Si `profileComplete` est déjà vrai, refuser avec `409`. Le NPI n'est **jamais modifiable** par l'API (correction = support / administrateur, avec trace). Nom, prénom et sexe : même règle par défaut ; à assouplir seulement si le métier le demande.

### 2.2 `GET /users/me` et la réponse de `POST /auth/verify-otp`

L'objet `user` doit exposer, en plus de l'existant (`id`, `phone`, `fullName`, `role`, `status`, `createdAt`) :

```json
{
  "firstName": "Kossi",
  "lastName": "Adjovi",
  "gender": "M",
  "npiMasked": "••••••7890",
  "profileComplete": true
}
```

- **`profileComplete` est indispensable** : c'est lui qui décide si l'application affiche le formulaire. Il vaut `true` seulement si prénom, nom, sexe **et** NPI sont renseignés. Le calculer à la lecture (ou à partir d'une colonne `profileCompletedAt`), ne pas le laisser dériver à la main.
- **Le NPI n'est jamais renvoyé en clair**, ni dans cette réponse, ni dans les listes, ni dans les journaux. Seuls les **4 derniers chiffres** sont exposés (`npiMasked`).
- Tant que le serveur ne renvoie pas `profileComplete`, l'application se rabat sur l'ancienne règle (compte sans `fullName` = à compléter) : donc aucun risque de régression pour les anciennes versions.

### 2.3 `fullName` reste calculé

Beaucoup d'écrans (radar du Zem, suivi, historique, chat) lisent `fullName`. À l'inscription, le serveur l'écrit : `fullName = "<Prénom> <Nom>"`. L'application masque déjà les noms affichés à un tiers (`maskPersonName`). **À décider** : voir la question Q4.

---

## 3. Modèle de données

Ajouter sur `User` (migration Prisma, relue et versionnée) :

```prisma
enum Gender { M F }

model User {
  // …
  firstName         String?
  lastName          String?
  gender            Gender?
  npiHash           String?   @unique   // empreinte HMAC-SHA256 : unicité et recherche
  npiCipher         String?             // NPI chiffré (AES-256-GCM), jamais lisible en base
  npiLast4          String?             // 4 derniers chiffres, pour l'affichage masqué
  profileCompletedAt DateTime?
}
```

### Stockage du NPI : donnée d'identité sensible

Le NPI est un identifiant national : une fuite de la base est grave. Demandes :

1. **Ne pas stocker le NPI en clair.** Chiffrer (AES-256-GCM, clé dans une variable d'environnement dédiée, p. ex. `NPI_ENCRYPTION_KEY`, **jamais dans le dépôt**), et calculer à part un **HMAC-SHA256 avec une clé secrète distincte** (`NPI_HASH_KEY`) pour la contrainte d'unicité. Un simple hash sans clé de 10 chiffres se casse en quelques secondes par force brute : un HMAC à clé secrète est nécessaire.
2. **Variables d'environnement** à documenter dans `.env.example` et à créer sur Render (`render.yaml`, sans valeur dans le dépôt). Le démarrage doit **échouer clairement** si elles manquent, comme pour `JWT_SECRET`.
3. **Jamais dans le JWT**, jamais dans une notification, jamais dans les messages d'erreur ni les logs (`console.log` interdit sur la charge utile).
4. **Visible en clair uniquement** pour un administrateur, par une route dédiée avec journal d'audit (qui, quand, quel compte), et seulement si le métier en a besoin (question Q3).
5. À la suppression d'un compte, effacer le NPI chiffré et son empreinte.

---

## 4. Règles de validation (identiques à l'application)

À appliquer dans un DTO `class-validator`, avec messages en français :

- `firstName`, `lastName` : trim, espaces multiples réduits à un seul (comme `UpdateProfileDto`), 2 à 50 caractères, motif `^[\p{L}][\p{L}\s'’-]*$` (lettres Unicode, espace, tiret, apostrophe ; pas de chiffre).
- `gender` : `M` ou `F`.
- `npi` : retirer espaces et séparateurs, puis **exactement 10 chiffres**.

> **À confirmer avec la spécification officielle du NPI (ANIP)** : la longueur (10 chiffres) et l'éventuelle **clé de contrôle**. Je n'ai pas pu vérifier la règle officielle ; aucune somme de contrôle n'est vérifiée aujourd'hui. Si une clé existe, l'implémenter côté serveur (et le dire à l'équipe mobile : une constante `NPI_LENGTH` dans `azo-mobile/utils/registration.ts`).

---

## 5. Sécurité : le serveur doit imposer l'inscription, pas seulement l'application

Aujourd'hui, l'application affiche le formulaire, mais **rien n'empêche un client non inscrit d'appeler les routes métier directement**. À ajouter :

- Un garde (par exemple `RegistrationCompleteGuard`) sur les routes réservées aux clients inscrits : au minimum `POST /rides`, `POST /deliveries`, les routes de réservation et de commande, et **`POST /wallet/recharge`** et les retraits.
- En cas de refus : `403` avec un code stable, p. ex. `{ "code": "REGISTRATION_REQUIRED", "message": "Termine ton inscription pour continuer." }`.
- Laisser accessibles sans inscription : `GET /users/me`, `POST /users/me/registration`, `POST /auth/*`, `GET /pricing`.

**Limiter les tentatives** : la réponse `409` « NPI déjà utilisé » permet de tester si un NPI existe. Limiter à quelques essais par compte et par heure (comme l'OTP), et ne jamais indiquer à qui appartient le NPI.

**Conformité** : collecter une pièce d'identité nationale impose une base légale, une information claire de l'utilisateur, une durée de conservation et des droits d'accès/suppression. **À valider avec la personne responsable de la conformité** (loi béninoise sur la protection des données personnelles) avant la mise en production. Le texte affiché à l'utilisateur dans l'application est volontairement sobre (« Ton NPI est protégé et ne sera jamais montré aux chauffeurs ni aux autres utilisateurs ») : **le serveur doit tenir cet engagement**, d'où les règles du §3.

---

## 6. Comptes existants

Les comptes déjà créés n'ont ni prénom, ni nom, ni sexe, ni NPI. **Décision demandée (Q1)** :

- **Option recommandée** : `profileComplete = false` pour tout compte `CLIENT` incomplet ; l'application affichera le formulaire **à sa prochaine connexion** (OTP). Aucun script de masse.
- Pour les comptes `DRIVER`, `AGENCY`, `ADMIN` : l'application n'affiche **pas** le formulaire (il est limité à `CLIENT`). Ne pas les compter comme « à compléter » tant que la décision Q2 n'est pas prise.

Le NPI ne peut pas être rempli rétroactivement : ne pas l'inventer ni le déduire.

---

## 7. Questions à trancher avec l'équipe

| # | Question | Proposition |
|---|---|---|
| Q1 | Les clients existants doivent-ils s'inscrire à leur prochaine connexion ? | Oui (formulaire bloquant) |
| Q2 | Les prestataires (Zem, coursiers, agences) doivent-ils aussi fournir un NPI ? | Oui à terme : le rattacher à leur dossier KYC (le formulaire actuel est limité à `CLIENT`). À décider, car cela touche `ProviderProfile` |
| Q3 | Un administrateur doit-il voir le NPI en clair (comparaison avec la CNI) ? | Oui, par une route auditée ; sinon seulement les 4 derniers chiffres |
| Q4 | Que voit un chauffeur du client : nom complet, prénom seul, ou le pseudo choisi avant ? | Prénom + initiale du nom (« Kossi A. »), jamais le NPI. Le pseudo libre (`PATCH /users/me { fullName }`, ajouté récemment pour le radar du Zem) devient inutile ou doit être renommé `displayName` |
| Q5 | Le profil client peut-il être modifié ensuite ? | Nom/prénom/sexe : non par défaut ; NPI : jamais. L'écran Profil permet aujourd'hui de modifier `fullName` : à aligner |
| Q6 | Longueur et clé de contrôle exactes du NPI | À confirmer avec la source officielle |

---

## 8. Tests à ajouter (Jest)

Dans `azo-backend/test/`, dans le style des tests existants :

1. Inscription valide : écrit prénom, nom, sexe ; **chiffre** le NPI ; renseigne `fullName`, `profileCompletedAt` ; renvoie `profileComplete: true` et **aucun NPI en clair**.
2. Refus `400` : nom ou prénom vide, trop court, avec chiffres ; sexe hors `M`/`F` ; NPI de 9 ou 11 chiffres, avec lettres.
3. Normalisation : espaces superflus retirés, NPI saisi avec espaces accepté.
4. `409` si le NPI appartient à un autre compte (même après reformatage) ; **le message ne révèle pas le propriétaire**.
5. `409` si l'inscription est déjà terminée ; le NPI existant n'est pas modifié.
6. Un rôle autre que `CLIENT` reçoit `403`.
7. `GET /users/me` et `verify-otp` : `profileComplete` vrai/faux selon les champs ; `npiMasked` ne contient que les 4 derniers chiffres.
8. Le garde `REGISTRATION_REQUIRED` : un client incomplet est refusé sur `POST /rides` et `POST /wallet/recharge`, accepté après inscription.
9. Le NPI n'apparaît **ni dans le JWT ni dans les journaux** (test sur un espion de `console`).

## 9. Critères d'acceptation

- [ ] Un nouveau compte, après l'OTP, voit le formulaire, l'envoie, et arrive sur l'accueil.
- [ ] Fermer l'application pendant l'inscription puis la rouvrir ramène au formulaire.
- [ ] Un client non inscrit ne peut ni commander une course ni recharger son portefeuille, même en appelant l'API directement.
- [ ] Le NPI n'est lisible ni en base, ni dans une réponse d'API, ni dans un journal.
- [ ] Deux comptes ne peuvent pas avoir le même NPI.
- [ ] Les variables `NPI_ENCRYPTION_KEY` et `NPI_HASH_KEY` sont documentées et définies sur Render ; le serveur refuse de démarrer sans elles.
- [ ] `npm run build` et `npm test -- --runInBand` passent ; migration relue.

## 10. Ce que fait déjà le front (pour référence)

- `azo-mobile/screens/OtpLoginScreen.tsx` : étape `register` (nom, prénom, sexe, NPI), contrôles de saisie, messages d'erreur par statut (`404`, `409`, `400`).
- `azo-mobile/utils/registration.ts` : règles de validation et constante `NPI_LENGTH`.
- `azo-mobile/services/api.ts` : `userApi.register()`, type `UserProfile` étendu, fonction `needsRegistration()`.
- `azo-mobile/App.tsx` : reprise du formulaire si l'application est rouverte avant la fin de l'inscription.
- L'application **vérifie que le serveur confirme** `profileComplete: true` : si la réponse ne le confirme pas, l'utilisateur n'entre pas comme si tout était enregistré.
