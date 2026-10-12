# Demande backend — modifier ses informations, onglet Messages, pourboire

**De :** Sergio (mobile) — **Pour :** l'équipe backend (Dorin / Esther.W)
**Date :** 12 octobre 2026
**État du mobile :** les trois fonctions ci-dessous sont **déjà construites côté mobile** (écrans, appels, textes dans 4 langues). Elles échouent proprement (message clair, pas de plantage) tant que les routes n'existent pas. Rien n'a été modifié dans `azo-backend`. Ce document dit **exactement** quoi construire.

Trois fonctions indépendantes, livrables dans cet ordre :

| # | Fonction | Taille | Pourquoi dans cet ordre |
|---|---|---|---|
| **1** | Le client modifie ses informations personnelles | Petite à moyenne | Débloque aussi l'e-mail pour FedaPay (`initRecharge` utilise une adresse fictive aujourd'hui) |
| **3** | Le client paie un pourboire au Zem après la course | Moyenne | Touche l'argent : tests et atomicité à soigner |
| **2** | Onglet « Messages » (boîte de réception du client) | La plus grosse | Demande de **persister** les messages (aujourd'hui en mémoire) |

Vocabulaire : **Zem** = chauffeur de moto-taxi (`Role.DRIVER`) ; **client** = `Role.CLIENT` ; **FCFA** = montants entiers.

---

## 0. Ce que le code backend fait aujourd'hui (constaté sur `main` du 12/10, commit `f54ac837`)

| Sujet | Constat |
|---|---|
| Modification du profil | `PATCH /users/me` (`updateLegacyProfile`) refuse tout dès que l'inscription est terminée : `409 "Ton profil inscrit ne peut plus être modifié."` Il n'existe **aucune** route pour changer l'e-mail, le numéro, un contact d'urgence, ni corriger une faute de frappe dans le nom. |
| E-mail | Le modèle `User` n'a **pas** de champ `email`. `WalletController.recharge` lit `user.email` qui est donc toujours `undefined` (repli sur une adresse fictive). |
| Messages | `RidesGateway.chatStore` est une `Map` **en mémoire** : 50 messages maximum par course, **perdus à chaque redémarrage** (Render redémarre régulièrement). Aucune table en base. |
| Sécurité des messages | `GET /rides/:id/messages` et `POST /rides/:id/messages` **ne vérifient pas que l'appelant fait partie de la course** : tout compte connecté peut lire ou écrire dans la messagerie de n'importe quelle course dont il connaît l'identifiant. `senderName` est pris tel quel dans la requête (usurpation de nom possible). La fermeture du chat en fin de course n'est appliquée que par l'application mobile. |
| Pourboire | Aucun : ni route, ni modèle, ni écriture dans le portefeuille. |
| Fin de course | `Ride` n'a pas de colonne `completedAt` (utile pour limiter la durée d'un pourboire). |

---

## 1. Le client modifie ses informations personnelles

### 1.1 Ce que le client voit (mobile — déjà fait)

Profil → « Informations personnelles ». Chaque ligne a un crayon quand elle est modifiable :

| Ligne | Comportement mobile |
|---|---|
| **E-mail** (nouveau) | Crayon → feuille « Modifier l'e-mail » → enregistre. Vide = supprimer. |
| **Contact d'urgence** (nouveau : nom + téléphone) | Crayon → feuille avec deux champs → enregistre. Servira à pré-remplir le partage de trajet. |
| **Prénom, nom, sexe** | Modifiables **directement** pendant la fenêtre de correction (24 h après l'inscription, une seule fois). Après : bouton « Demander une correction » (motif obligatoire) qui crée une demande traitée par un administrateur. |
| **Téléphone** | Crayon → « Changer mon numéro » : saisie du nouveau numéro → code reçu par SMS sur ce numéro → validation. |
| **NPI** | Cadenas, **jamais modifiable** dans l'application (note « Contacte le support »). |
| **Langue** | Déjà en place (`PATCH /users/me/language`). |

Le mobile affiche les crayons **selon ce que le serveur annonce** dans `GET /users/me` (voir 1.2) ; sans ces champs il affiche les crayons de l'e-mail, du contact d'urgence et du téléphone, et les enregistrements échouent avec « pas encore disponible » tant que les routes n'existent pas.

### 1.2 Ce que le backend doit faire

**1.2.1 — Base de données (Prisma)**

```prisma
model User {
  // … champs existants …
  email                    String?
  emergencyContactName     String?
  emergencyContactPhone    String?
  identityCorrectedAt      DateTime?   // quand la correction « directe » a été utilisée (une seule fois)
}

model IdentityCorrectionRequest {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id])
  firstName    String?
  lastName     String?
  gender       Gender?
  reason       String             // motif du client, 10 à 300 caractères
  status       String   @default("PENDING")   // PENDING | APPROVED | REJECTED
  decidedById  String?
  decidedAt    DateTime?
  rejectReason String?
  createdAt    DateTime @default(now())
  @@index([userId, status])
}

model PhoneChangeRequest {
  id        String   @id @default(uuid())
  userId    String
  newPhone  String
  codeHash  String             // jamais le code en clair
  attempts  Int      @default(0)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}

model UserProfileChange {          // journal d'audit
  id        String   @id @default(uuid())
  userId    String
  field     String                 // "email" | "emergencyContact" | "firstName" | "lastName" | "gender" | "phone"
  oldValue  String?                // pour phone : 4 derniers chiffres seulement
  newValue  String?
  at        DateTime @default(now())
  @@index([userId, at])
}
```

**1.2.2 — `GET /users/me` : champs ajoutés** (rien d'existant ne change)

```json
{
  "email": "kossi@exemple.com",
  "emergencyContact": { "name": "Akouavi", "phone": "0197000000" },
  "language": "fr",
  "identityEditableUntil": "2026-10-13T09:12:00.000Z",
  "identityCorrectionPending": false
}
```
- `identityEditableUntil` = `profileCompletedAt + 24 h` **tant que** `identityCorrectedAt` est `null` ; sinon `null`.
- `identityCorrectionPending` = `true` s'il existe une demande de correction `PENDING`.
- `emergencyContact` = `null` si absent ; `email` = `null` si absent.
- Le téléphone du contact d'urgence est renvoyé **en clair** à son propriétaire seulement.

**1.2.3 — `PATCH /users/me/profile`** (tous les rôles)

```
PATCH /users/me/profile
{ "email": "kossi@exemple.com" | null, "emergencyContact": { "name": "Akouavi", "phone": "0197000000" } | null }
→ 200 le profil complet (même forme que GET /users/me)
```
- Chaque clé est optionnelle ; **absente = inchangée**, `null` = supprimer.
- `email` : format valide (`@IsEmail`), minuscules, 5 à 120 caractères. Pas d'unicité obligatoire. Message : `400 EMAIL_INVALID`.
- `emergencyContact.name` : 2 à 50 caractères (même normalisation que `normalizeName`). `phone` : numéro béninois à 10 chiffres commençant par `01` (même règle que l'inscription, voir `registration-profile.ts`) ; **différent du numéro du compte** (`400 EMERGENCY_PHONE_SAME_AS_OWN`). Erreur générale : `400 EMERGENCY_CONTACT_INVALID`.
- Écrire une ligne `UserProfileChange` par champ modifié.
- Limite de débit : 10 appels par heure et par utilisateur (`429 TOO_MANY_REQUESTS`).
- **À brancher** : `WalletService.initRecharge` doit utiliser `user.email` (relu en base) dès qu'il existe, au lieu de l'adresse de repli.

**1.2.4 — `PATCH /users/me/identity`** (rôle `CLIENT`) — correction directe, **une seule fois, 24 h**

```
PATCH /users/me/identity
{ "firstName": "Kossi", "lastName": "Adjovi", "gender": "M" }     // au moins un champ
→ 200 le profil complet
```
- Autorisé seulement si `profileCompletedAt` est non nul, `identityCorrectedAt` est nul **et** `now < profileCompletedAt + 24 h`.
- Hors fenêtre : `403 IDENTITY_WINDOW_CLOSED`. Déjà utilisé : `409 IDENTITY_ALREADY_CORRECTED`. Inscription non terminée : `409 REGISTRATION_REQUIRED`.
- Validation : mêmes règles que l'inscription (`normalizeName`, 2 à 50 caractères, `gender` ∈ `M | F`).
- Effets : mettre à jour `firstName`, `lastName`, `gender`, **recalculer `fullName = firstName + " " + lastName`**, poser `identityCorrectedAt = now`, journaliser. Le **NPI n'est jamais touché**.
- Atomique (`updateMany` avec `identityCorrectedAt: null` dans le `where`) pour qu'un double appui n'utilise pas deux corrections.

**1.2.5 — `POST /users/me/identity-correction-requests`** (rôle `CLIENT`) — après la fenêtre

```
POST /users/me/identity-correction-requests
{ "firstName"?: "…", "lastName"?: "…", "gender"?: "F", "reason": "Faute de frappe dans mon nom" }
→ 201 { "id": "…", "status": "PENDING" }
```
- `reason` obligatoire, 10 à 300 caractères. Au moins un champ à corriger.
- Une seule demande `PENDING` à la fois : `409 IDENTITY_REQUEST_PENDING`.
- Notification à l'administrateur (même mécanisme que les dossiers prestataires) ; l'administrateur voit les valeurs actuelles et demandées.
- Décision : `POST /admin/identity-corrections/:id/approve` ou `/reject {reason}` (rôle `ADMIN`) : à l'approbation, appliquer comme en 1.2.4 sans la limite de fenêtre ; notifier le client dans les deux cas (clés `NOTIFICATION_IDENTITY_APPROVED` / `NOTIFICATION_IDENTITY_REJECTED`). L'écran admin mobile viendra plus tard : exposer d'abord `GET /admin/identity-corrections?status=PENDING`.

**1.2.6 — Changement de numéro de téléphone (avec code SMS)**

```
POST /users/me/phone-change/request   { "newPhone": "0197000000" }
→ 202 { "expiresInSeconds": 300, "maskedPhone": "01•••••00" }

POST /users/me/phone-change/confirm   { "code": "123456" }
→ 200 le profil complet  (+ "token": "<nouveau JWT>" si votre JWT contient le numéro)
```
- `request` : numéro valide (règle béninoise) ; différent du numéro actuel ; **pas déjà utilisé** par un autre compte (`409 PHONE_ALREADY_USED` — sans révéler à qui) ; maximum **3 demandes par heure** par utilisateur (`429 OTP_TOO_MANY_REQUESTS`). Générer un code (même service que l'OTP de connexion), stocker **seulement son hash** dans `PhoneChangeRequest` (expiration 5 min), l'envoyer par SMS au **nouveau** numéro.
- `confirm` : prend la dernière demande non utilisée et non expirée de l'utilisateur ; code faux : incrémenter `attempts`, `400 OTP_WRONG_CODE` ; **5 essais maximum**, ensuite `400 OTP_TOO_MANY_ATTEMPTS` et la demande est invalidée ; expirée : `400 OTP_INVALID_OR_EXPIRED`.
- Succès : `UPDATE User SET phone = newPhone` dans une transaction qui vérifie à nouveau l'unicité (contrainte `@unique` existante ; intercepter `P2002` → `409 PHONE_ALREADY_USED`), marquer `usedAt`, journaliser (ancien numéro : 4 derniers chiffres), envoyer une **notification à l'ancien canal** (« Ton numéro a été changé », clé `NOTIFICATION_PHONE_CHANGED`) pour qu'un propriétaire légitime détecte un détournement.
- **Vérifier la charge du JWT** : si l'identifiant du jeton est `userId`, rien à faire ; si le jeton contient `phone`, renvoyer un nouveau `token` dans la réponse (le mobile le gère déjà : champ optionnel `token`).
- Les prestataires (`DRIVER`, agences) : mêmes routes autorisées, mais **ajouter** un contrôle : refuser (`403 PHONE_CHANGE_FORBIDDEN`) si le dossier prestataire est en cours d'examen (`SUBMITTED`/`UNDER_REVIEW`), pour ne pas casser la vérification du dossier.

### 1.3 Tests d'acceptation (1)

1. `GET /users/me` d'un client inscrit il y a 2 h → `identityEditableUntil` dans ~22 h ; inscrit il y a 3 jours → `null`.
2. `PATCH /users/me/profile {email:"A@B.com"}` → e-mail enregistré en `a@b.com` ; `{email:"pas-un-mail"}` → `400 EMAIL_INVALID`.
3. Contact d'urgence avec le numéro du compte → `400 EMERGENCY_PHONE_SAME_AS_OWN`.
4. `PATCH /users/me/identity` dans la fenêtre → `fullName` recalculé ; un second appel → `409 IDENTITY_ALREADY_CORRECTED`.
5. Même appel après 24 h → `403 IDENTITY_WINDOW_CLOSED` ; `POST …/identity-correction-requests` → `201` ; une seconde demande → `409`.
6. Changement de numéro : code correct → `phone` mis à jour, notification envoyée à l'ancien canal ; code faux 5 fois → demande invalidée ; numéro déjà pris → `409 PHONE_ALREADY_USED` sans fuite d'information.
7. Aucun de ces appels ne modifie `npiHash`, `npiCipher`, `npiLast4`.
8. `WalletService.initRecharge` utilise l'e-mail du client dès qu'il est renseigné.

---

## 2. Onglet « Messages » : la boîte de réception du client

### 2.1 Ce que le client voit (mobile — déjà fait)

Un nouvel onglet **Messages** dans la barre du bas (entre « Courses » et « AZƆ̀ Pay »). Il liste **les Zem avec qui le client a déjà échangé**, du plus récent au plus ancien :

- nom du Zem (« Romaric S. »), petit badge « Vérifié » ;
- dernier message (début) et son heure ;
- pastille avec le nombre de messages non lus ;
- appui sur une ligne → la conversation s'ouvre ; on peut **répondre uniquement si une course avec ce Zem est en cours** ; sinon la conversation est en **lecture seule** (« Course terminée : la discussion est verrouillée »).

Tant que `GET /messages/conversations` n'existe pas, le mobile reconstitue une liste limitée à partir de l'historique des courses (Zem des courses passées) et des messages encore en mémoire du serveur. Cette liste est incomplète : c'est la raison de cette demande.

### 2.2 Ce que le backend doit faire

**2.2.1 — Persister les messages (prérequis de tout le reste)**

```prisma
model RideMessage {
  id         String   @id @default(uuid())
  rideId     String
  ride       Ride     @relation(fields: [rideId], references: [id], onDelete: Cascade)
  senderId   String
  senderRole String             // "CLIENT" | "PROVIDER"
  text       String             // 1 à 300 caractères, après nettoyage
  createdAt  DateTime @default(now())
  readAt     DateTime?          // lu par le destinataire
  @@index([rideId, createdAt])
  @@index([senderId, createdAt])
}
```
- `RidesGateway.chatStore` est supprimé : toute lecture/écriture passe par cette table. Le plafond de 50 messages par course disparaît (pagination à la place).
- **Nom de l'expéditeur** : ne plus le stocker ni le lire dans la requête. Il est **calculé à la lecture** (`displayName` du compte : « Romaric S. » pour un Zem, « Kossi A. » pour un client, règle identique à `display-name.ts`). Ignorer tout `senderName` envoyé par le mobile (compatibilité : le champ reste accepté mais sans effet).
- Rétention : **12 mois** après la fin de la course (`chat.retentionMonths: 12` dans `tarification.json`), puis suppression par une tâche quotidienne. Suppression en cascade avec la course et avec le compte.

**2.2.2 — Corriger la sécurité des routes existantes (à faire en même temps)**

- `GET /rides/:id/messages` et `POST /rides/:id/messages` : charger la course et **exiger que l'appelant soit `clientId` ou `driverId`** → sinon `403 FORBIDDEN`. Même contrôle dans le gestionnaire socket `ride:chat` (déjà fait pour le socket, **à ajouter côté REST**).
- **Fermeture du chat côté serveur** : écrire n'est permis que si `status ∈ { MATCHED, ARRIVED, IN_PROGRESS }` (le statut `OFFERED` n'ouvre **pas** le chat : le client ne connaît pas encore le Zem). Sinon `403 CHAT_LOCKED`. Paramètre `chat.minutesAfterRide` (défaut **0**) pour tolérer quelques minutes après `COMPLETED` si le métier le souhaite.
- Nettoyage du texte : `trim`, suppression des caractères de contrôle, 1 à 300 caractères (`400 MESSAGE_INVALID`), limite de débit **20 messages par minute** et par utilisateur (`429`).
- Réponse d'un message : `{ id, rideId, senderRole, senderName (calculé), text, createdAt, readAt }`. `senderId` n'est plus renvoyé (le mobile compare `senderRole` à son rôle ; garder `senderId` pendant la transition si nécessaire).

**2.2.3 — `GET /messages/conversations`** (tout rôle connecté)

```
GET /messages/conversations?limit=30&cursor=<iso>
→ 200 {
  "items": [
    {
      "peer": { "displayName": "Romaric S.", "role": "DRIVER", "photoUrl": null, "verified": true, "vehicleType": "ZEM_ELECTRIC" },
      "lastRideId": "…",
      "lastRideStatus": "COMPLETED",
      "ridesCount": 3,
      "lastMessage": { "text": "J'arrive dans 2 min", "at": "2026-10-12T10:00:00.000Z", "fromMe": false },
      "unreadCount": 2,
      "activeRideId": null,
      "canReply": false
    }
  ],
  "nextCursor": null
}
```
- **Une ligne par interlocuteur** (paire client/Zem), pas par course. Regrouper toutes les courses entre le même client et le même Zem.
- Ne contient que les paires ayant **au moins un message** (« les Zem avec qui il a déjà parlé »).
- Tri : `lastMessage.at` décroissant. `limit` 1–50 (défaut 30), curseur sur `lastMessage.at`.
- `peer` vu par un **client** = le Zem (`displayName`, `verified` = dossier `APPROVED`, `vehicleType`) ; vu par un **Zem** = le client (`displayName`, `role: "CLIENT"`, sans `verified`). **Jamais** de téléphone, de nom complet ni d'identifiant utilisateur.
- `unreadCount` = messages de l'interlocuteur avec `readAt = null`, toutes courses confondues.
- `activeRideId` = identifiant d'une course **en cours** (`MATCHED`/`ARRIVED`/`IN_PROGRESS`) entre ces deux personnes, sinon `null`. `canReply = (activeRideId != null)`. `lastRideId` = course la plus récente de la paire (le mobile ouvre la discussion avec `activeRideId ?? lastRideId`).
- Requête recommandée : `RideMessage` jointe à `Ride` filtrée sur `clientId = moi OR driverId = moi`, `GROUP BY` (client, driver). Prévoir l'index `@@index([clientId, driverId])` sur `Ride` si absent.

**2.2.4 — Lecture d'une conversation**

```
GET /rides/:id/messages?before=<iso>&limit=50&scope=ride|peer
→ 200 { "items": [ { …message… } ], "nextBefore": "2026-10-11T08:00:00.000Z" | null, "locked": true }
```
- `scope=ride` (défaut) : messages de cette course. `scope=peer` : messages de **toutes** les courses entre les deux mêmes personnes, ordre chronologique croissant, chaque message portant son `rideId`. Contrôle d'appartenance sur la course `:id` **et** limitation du `peer` à l'autre participant de cette course.
- `locked` = `true` si on ne peut plus écrire (voir 2.2.2).
- Rétro-compatibilité : sans paramètres, renvoyer **aussi** le tableau simple actuel ? Non : le mobile lit `items` s'il existe, sinon traite la réponse comme un tableau (ancien format). Prévenir quand le format change.

**2.2.5 — Marquer comme lu et compteur**

```
POST /rides/:id/messages/read      → 200 { "unreadTotal": 0 }       // messages de l'autre participant, de cette course
GET  /messages/unread-count        → 200 { "count": 3 }              // pastille de l'onglet
```
- `read` met `readAt = now` sur les messages **reçus** (`senderId ≠ moi`) de la course qui n'avaient pas encore de `readAt`. Idempotent.
- `unread-count` = total des non lus de l'utilisateur, toutes courses.

**2.2.6 — Temps réel**

- Le socket `ride:chat` **enregistre d'abord** le message en base, **puis** le diffuse dans la room `ride:{id}` (événement `ride:chat`, même forme que la réponse REST).
- À la connexion d'un socket authentifié : le faire rejoindre la room `user:{userId}` (aujourd'hui seulement faite dans `ride:join`).
- Nouvel événement vers `user:{destinataireId}` à chaque message : `messages:unread { "rideId": "…", "unreadTotal": 3, "peerDisplayName": "Romaric S.", "text": "J'arrive dans 2 min", "at": "…" }`. Le mobile met à jour la pastille de l'onglet et la liste sans recharger.
- Notification **push** au destinataire s'il n'est pas dans la room `ride:{id}` : clés `NOTIFICATION_CHAT_MESSAGE`, `params: { peer, text }` (texte coupé à 80 caractères), `data: { event: "chat-message", rideId }`, **au plus une toute les 30 secondes par course** pour ne pas spammer.

### 2.3 Tests d'acceptation (2)

1. Un utilisateur **hors course** appelle `GET /rides/:id/messages` → `403`. Idem `POST`.
2. Redémarrer le serveur : les messages d'une course restent lisibles.
3. Course terminée : `POST /rides/:id/messages` → `403 CHAT_LOCKED` ; `GET` → messages + `locked: true`.
4. `OFFERED` : le chat est fermé (`CHAT_LOCKED`).
5. Client avec 2 courses chez le même Zem (3 messages au total) et 1 course chez un autre (1 message) → `GET /messages/conversations` renvoie **2 lignes**, triées par dernier message, `ridesCount = 2` pour la première.
6. Un Zem n'ayant jamais écrit ni reçu de message n'apparaît pas dans la liste.
7. `unreadCount` baisse après `POST …/messages/read` ; `GET /messages/unread-count` reflète le total.
8. Le destinataire connecté reçoit `messages:unread` en temps réel ; non connecté → push (une seule en 30 s).
9. `senderName` envoyé par le mobile est ignoré ; le nom affiché est celui du compte.
10. 21 messages en 1 minute → `429` au 21ᵉ.
11. Aucune réponse ne contient de téléphone ni de nom complet.
12. Suppression d'une course (cascade) → ses messages disparaissent.

---

## 3. Le pourboire : le client remercie le Zem après la course

### 3.1 Ce que le client voit (mobile — déjà fait)

Sur l'écran de fin de course (« Comment s'est passée votre course ? ») :
- une ligne « Ajouter un pourboire (100 % reversé au Zem) » avec les montants **100, 200, 500, 1 000 F** et un champ **autre montant** ;
- un bouton « Envoyer le pourboire · 500 F » (désactivé sans montant) ;
- le solde AZƆ̀ Pay est vérifié : si insuffisant, message et bouton « Recharger » ;
- après l'envoi : « Merci ! Pourboire de 500 F envoyé » (montant verrouillé, plus de second envoi) ;
- le pourboire est **indépendant de la note** : on peut noter sans donner de pourboire, et inversement.
Les montants proposés, le minimum, le maximum et la durée viennent de la configuration (`tips` dans `tarification.json`) ; sans elle, le mobile utilise les valeurs de 3.2.1.

### 3.2 Ce que le backend doit faire

**3.2.1 — Configuration** (`azo-backend/src/pricing/tarification.json`, puis `npm run sync:tarification` côté mobile)

```json
"tips": { "presets": [100, 200, 500, 1000], "minAmount": 50, "maxAmount": 10000, "windowHours": 24, "maxPerHourPerClient": 5 }
```
Le mobile lit `tarification().tips`, avec ces valeurs par défaut s'il est absent.

**3.2.2 — Base de données**

```prisma
model RideTip {
  id        String   @id @default(uuid())
  rideId    String   @unique            // un seul pourboire par course
  ride      Ride     @relation(fields: [rideId], references: [id])
  clientId  String
  driverId  String
  amount    Int                         // FCFA, entier
  createdAt DateTime @default(now())
  @@index([driverId, createdAt])
  @@index([clientId, createdAt])
}

model Ride {
  // …
  completedAt DateTime?                 // posé quand la course passe à COMPLETED (complete() et acceptStop())
}

model Transaction {
  // …
  kind String?                          // "RIDE" | "TIP" | "RECHARGE" | "WITHDRAWAL" … ; ici "TIP"
}
```
- Poser `Ride.completedAt = now` partout où une course devient `COMPLETED` (`complete`, `acceptStop` / règlement d'arrêt anticipé). Les courses déjà terminées auront `completedAt = null` : les considérer comme **non éligibles** (ou utiliser `createdAt + 3 h` en repli, à décider).

**3.2.3 — `POST /rides/:id/tip`** (rôle `CLIENT`, propriétaire de la course)

```
POST /rides/:id/tip
Idempotency-Key: <uuid généré par le mobile>      // en-tête recommandé
{ "amount": 500 }
→ 201 { "rideId": "…", "tipId": "…", "amount": 500, "balance": 12000, "at": "2026-10-12T10:20:00.000Z" }
```

Conditions (toutes vérifiées dans la **même transaction** `prisma.$transaction`) :

| Règle | Erreur |
|---|---|
| L'appelant est le `clientId` de la course | `403 FORBIDDEN` |
| `status = COMPLETED` et `driverId` non nul | `400 RIDE_NOT_COMPLETED` |
| `now ≤ completedAt + tips.windowHours` | `400 TIP_WINDOW_CLOSED` |
| Aucun `RideTip` pour cette course (contrainte `@unique` ; intercepter `P2002`) | `409 TIP_ALREADY_SENT` |
| `amount` entier, `minAmount ≤ amount ≤ maxAmount` | `400 TIP_AMOUNT_INVALID` (message avec les bornes) |
| Pas plus de `maxPerHourPerClient` pourboires par heure pour ce client | `429 TOO_MANY_REQUESTS` |
| Solde du client ≥ montant | `400 WALLET_INSUFFICIENT` |

Effets, **atomiques** (tout ou rien) :
1. **Débit du client** : `wallet.updateMany({ where: { id, balance: { gte: amount } }, data: { balance: { decrement: amount } } })` ; `count === 0` → `WALLET_INSUFFICIENT` (évite le solde négatif en cas d'appels simultanés).
2. **Crédit du Zem** : `balance += amount` sur le portefeuille du **Zem** (jamais celui de l'agence), **sans commission et sans frais** : le client voit « 100 % reversé ».
3. Deux lignes `Transaction`, statut `CONFIRMED`, `kind = "TIP"`, `meta = "tip:<rideId>"` :
   - client : `DEBIT`, `labelKey = "TRANSACTION_TIP_SENT"`, `labelParams = { "ride": "#abc123", "driver": "Romaric S." }` ;
   - Zem : `CREDIT`, `labelKey = "TRANSACTION_TIP_RECEIVED"`, `labelParams = { "ride": "#abc123", "client": "Kossi A." }`.
   (Garder aussi `label` en français comme secours, comme pour les autres transactions.)
4. Créer la ligne `RideTip`.
5. **Idempotence** : si l'en-tête `Idempotency-Key` est déjà connu pour ce client, renvoyer la même réponse sans refaire le débit (stocker la clé 24 h ; ou s'appuyer sur la contrainte `rideId @unique` et renvoyer `200` avec le pourboire existant quand le **montant est identique**).
6. Après validation de la transaction : notification au **Zem** (inbox + push) : `titleKey = "NOTIFICATION_TIP_RECEIVED"`, `params = { "amount": 500, "client": "Kossi A." }`, `data: { event: "tip-received", rideId }`.

**3.2.4 — Règles financières (à respecter, elles changent les calculs existants)**

- Le pourboire est **exclu** de la base du prélèvement mensuel de 15 % des Zem indépendants et de la commission d'agence : filtrer sur `Transaction.kind <> 'TIP'` (ou `meta NOT LIKE 'tip:%'`) dans le calcul des revenus du mois.
- Le **retrait** reste soumis aux frais habituels (1,5 % pour un Zem indépendant ; taux de la formule pour une agence) puisque c'est du solde retiré comme un autre.
- Un pourboire n'est **jamais remboursable** automatiquement (pas de route d'annulation). Un litige passe par l'administration.

**3.2.5 — Champs ajoutés aux réponses de course**

- `GET /rides/:id` et `GET /rides/history` : `tip: { "amount": 500, "at": "…" } | null` (visible du client **et** du Zem de la course).
- `GET /rides/:id` pour le **client**, course `COMPLETED` : `tipUntil: "<ISO>"` (= `completedAt + windowHours`) tant que la fenêtre est ouverte et qu'aucun pourboire n'a été envoyé ; sinon absent. Le mobile affiche la section pourboire seulement dans ce cas.
- Écran des gains du Zem : exposer la somme des pourboires du jour (`tipsToday`) dans le résumé existant des gains, **séparée** du chiffre de courses (le mobile du Zem l'affichera ensuite).

### 3.3 Tests d'acceptation (3)

1. Course `COMPLETED` il y a 5 min, solde 2 000 F, `POST …/tip {amount:500}` → `201`, solde client 1 500 F, solde Zem +500 F (aucune commission), deux `Transaction` `kind = TIP`, une ligne `RideTip`.
2. Même appel une seconde fois (autre clé) → `409 TIP_ALREADY_SENT`, aucun nouveau mouvement d'argent.
3. Même clé d'idempotence rejouée → même réponse, un seul débit.
4. `amount: 10` → `400 TIP_AMOUNT_INVALID` ; `amount: 99999` → idem.
5. Course `IN_PROGRESS` → `400 RIDE_NOT_COMPLETED` ; course terminée il y a 25 h → `400 TIP_WINDOW_CLOSED`.
6. Solde 100 F, pourboire 500 F → `400 WALLET_INSUFFICIENT`, **aucune** écriture (ni débit ni crédit).
7. Deux requêtes simultanées pour le dernier solde disponible → une seule réussit, solde jamais négatif.
8. Un autre client (ou le Zem) appelle la route → `403`.
9. Un Zem rattaché à une agence : le pourboire va sur **son** portefeuille ; la commission d'agence du mois n'inclut pas ce montant.
10. Le calcul du prélèvement mensuel de 15 % ignore les `Transaction.kind = 'TIP'`.
11. Le Zem reçoit la notification `NOTIFICATION_TIP_RECEIVED`.
12. `GET /rides/:id` : `tip` renseigné après envoi, `tipUntil` absent.

---

## 4. Contrat mobile (ce que le mobile envoie et attend)

| Sujet | Le mobile **envoie** | Le mobile **attend** (et ce qu'il fait sans) |
|---|---|---|
| Profil | `GET /users/me` | `email`, `emergencyContact`, `identityEditableUntil`, `identityCorrectionPending` ; absents → crayons e-mail / contact / téléphone visibles, correction d'identité en mode « demande » |
| Modifier e-mail / contact | `PATCH /users/me/profile` | `200` profil complet ; `404` → message « pas encore disponible » (aucune donnée perdue) |
| Corriger l'identité | `PATCH /users/me/identity` (dans la fenêtre) ou `POST /users/me/identity-correction-requests` (après) | `200` / `201` ; codes d'erreur de 1.2.4 et 1.2.5 |
| Changer de numéro | `POST /users/me/phone-change/request` puis `/confirm` | `202` puis `200` (+ `token` optionnel) |
| Messages — liste | `GET /messages/conversations` | liste de 2.2.3 ; **404 → repli** sur l'historique des courses |
| Messages — fil | `GET /rides/:id/messages?scope=peer` ; `POST /rides/:id/messages` ; `POST /rides/:id/messages/read` | `items` + `locked` ; ancien format tableau toléré |
| Pastille | `GET /messages/unread-count` au démarrage ; écoute `messages:unread` | `{ count }` ; sans : pas de pastille |
| Pourboire | `POST /rides/:id/tip` + `Idempotency-Key` | `201` ; codes de 3.2.3 traduits côté mobile |
| Langue des erreurs | en-tête `Accept-Language` sur toutes les requêtes + `PATCH /users/me/language` à chaque changement de langue | `code` stable dans les erreurs (déjà livré) |

**Nouveaux codes d'erreur à traduire côté mobile** (merci de les ajouter à `http-exception.filter.ts` ou de lever des exceptions avec `code`) : `EMAIL_INVALID`, `EMERGENCY_CONTACT_INVALID`, `EMERGENCY_PHONE_SAME_AS_OWN`, `IDENTITY_WINDOW_CLOSED`, `IDENTITY_ALREADY_CORRECTED`, `IDENTITY_REQUEST_PENDING`, `PHONE_ALREADY_USED`, `PHONE_CHANGE_FORBIDDEN`, `CHAT_LOCKED`, `MESSAGE_INVALID`, `RIDE_NOT_COMPLETED`, `TIP_WINDOW_CLOSED`, `TIP_ALREADY_SENT`, `TIP_AMOUNT_INVALID`.

Fichiers mobile concernés (information) : `screens/PersonalInfoScreen.tsx`, `components/EditFieldSheet.tsx` (nouveau), `screens/MessagesScreen.tsx` (nouveau), `components/ClientTabBar.tsx`, `screens/RideRatingScreen.tsx`, `services/api.ts`.

---

## 5. Ordre de travail conseillé

1. **E-mail + contact d'urgence** (`PATCH /users/me/profile`, champs de `GET /users/me`) — rapide ; brancher l'e-mail sur `initRecharge`.
2. **Pourboire** (config `tips`, `completedAt`, `RideTip`, route, règles financières, tests d'argent).
3. **Messages** : d'abord la **persistance et la correction de sécurité** (2.2.1 et 2.2.2) — c'est urgent même sans l'onglet — puis les routes de liste, de lecture, de non-lus et les événements socket.
4. **Correction d'identité** (fenêtre de 24 h, demande, écran admin) puis **changement de numéro**.

Questions ouvertes à trancher avec le métier : (a) fenêtre de correction : 24 h convient-elle ; (b) montant maximum d'un pourboire ; (c) durée de conservation des messages (12 mois proposés) ; (d) le Zem peut-il écrire au client après la course (aujourd'hui non) ; (e) l'e-mail doit-il être **vérifié** (lien de confirmation) avant d'être utilisé pour FedaPay ; (f) mise à disposition des pourboires dans les relevés de gains des agences.
