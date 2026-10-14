# Demande backend — clients proches du Zem, profil du Zem avant engagement, carte du Zem

**De :** Sergio (mobile) — **Pour :** l'équipe backend (Dorin / Esther.W)
**Date :** 12 octobre 2026
**État du mobile :** tout ce qui est décrit ci-dessous est **déjà prévu côté mobile** et fonctionne avec le backend actuel quand c'est possible. Chaque point indique ce que le mobile fait aujourd'hui, ce que le backend doit ajouter, et ce que le mobile attend exactement. Rien n'a été modifié dans `azo-backend` : toute la logique ci-dessous est à écrire de votre côté.

Ce document contient trois fonctions indépendantes. On peut les livrer dans cet ordre :

| # | Fonction | Gros du travail | Casse l'existant ? |
|---|---|---|---|
| **A** | Le Zem voit le nombre de clients disponibles autour de lui (rayon 10 km) et leurs positions avec leur prénom | Petit : paramètre de rayon, nom d'affichage, résumé, événements socket ciblés | Non |
| **C** | Carte du Zem : sa position, celle du client, la destination, avec les deux parties du trajet | Petit à moyen : trajet « course », position du client relue après redémarrage, libellés d'adresses | Non |
| **B** | Le client voit le **profil du Zem avant de s'engager** (proposition puis confirmation) | **Le plus gros** : nouveau statut de course `OFFERED`, 4 endpoints, délai d'expiration, profil public du Zem | **Oui** (changement de ce que fait `POST /rides/:id/accept`) |

Vocabulaire : **Zem** = chauffeur de moto-taxi (rôle `DRIVER`). **Client** = rôle `CLIENT`. **Demande** = course au statut `PENDING`.

---

## 0. Ce que le backend fait déjà (état constaté dans le code récupéré le 12/10)

- `GET /rides/pending?lat=&lng=` renvoie les demandes `PENDING` visibles pour le véhicule du Zem, déjà triées par distance, avec `distanceKm`, `ageMinutes`, `expiresInMinutes`. Rayon actuel : `radar.searchRadiusKm = 8` (config `tarification.json`). Le DTO ignore les paramètres inconnus (`ValidationPipe({ whitelist: true })`), donc le mobile peut déjà envoyer un paramètre en plus sans erreur.
- Chaque demande porte `client: { fullName }`. Le mobile masque le nom, mais **le serveur envoie le nom complet**.
- `ride:new` est émis à **tous les sockets connectés** (`this.server.emit("ride:new", …)`), sans nom de client.
- `POST /rides/:id/accept` passe directement la course de `PENDING` à `MATCHED` (atomique avec `updateMany`).
- `GET /rides/:id/route` calcule le trajet de l'**étape en cours** seulement : chauffeur → départ (`MATCHED`, `ARRIVED`) ou chauffeur → destination (`IN_PROGRESS`).
- La position du client (`clientLat`, `clientLng`) n'arrive au Zem que par le socket (`client:location`) ou par l'accusé de `ride:join` ; elle n'est **pas** dans `GET /rides/:id`.
- `ProviderProfile` contient déjà : `fullName`, `city`, `zones`, `bio`, `experienceYears`, `vehicleType`, `vehicleModel`, `plateNumber`, `status`, `kycScore`, `rating`, `jobsCompleted`, `agencyName`.
- ⚠️ **`rate()` n'écrit que `Ride.rating`.** `ProviderProfile.rating` et `jobsCompleted` ne sont **jamais mis à jour** par le code actuel : ils valent 0 pour tout le monde. Il faut les calculer (voir §B.7).

---

## A. Le Zem voit combien de clients sont disponibles autour de lui, et où

### A.1 Ce que le Zem verra (mobile — déjà fait)

Écran d'accueil du Zem, une fois « en ligne » et sans course en cours :
1. Une **carte** avec sa position (point bleu « Moi »).
2. Un point orange par client qui attend un Zem à **moins de 10 km**, avec son **prénom + initiale du nom** (« Kossi A. ») affiché en étiquette sous le point.
3. Un compteur : « **N clients disponibles à moins de 10 km** ».
4. En dessous, la liste des demandes (comme aujourd'hui), chaque carte portant le même prénom.

Le point d'un client est son **point de départ demandé** (`originLat/originLng`), pas sa position GPS en temps réel (qui reste privée tant que le client n'a pas été choisi).

### A.2 Ce que le backend doit faire

**A.2.1 — Rayon paramétrable sur `GET /rides/pending`**

- Ajouter au `RadarQueryDto` : `radiusKm` (optionnel, nombre, `@Min(1) @Max(radar.maxRadiusKm)`).
- Si `radiusKm` est absent : utiliser `radar.nearbyRadiusKm` (**nouvelle clé de config, valeur 10**) à la place de `radar.searchRadiusKm`.
- Si `lat`/`lng` sont absents : comportement actuel inchangé (aucune demande écartée, tri par ancienneté).
- Nouvelles clés dans `azo-backend/src/pricing/tarification.json` (puis `npm run sync:tarification` côté mobile) :
  ```json
  "radar": { "searchRadiusKm": 8, "nearbyRadiusKm": 10, "maxRadiusKm": 15, ... }
  ```
  (`searchRadiusKm` peut être supprimé si plus utilisé ; le mobile lit `nearbyRadiusKm`, avec repli 10 s'il est absent.)
- `buildRadar(...)` reçoit déjà `radiusKm` : il suffit de lui passer la valeur résolue.

**A.2.2 — Nom d'affichage du client dans chaque demande**

Dans la réponse de `GET /rides/pending`, remplacer `client: { fullName }` par :
```json
"client": { "displayName": "Kossi A.", "firstName": "Kossi" }
```
- `firstName` = `User.firstName`, repli sur le premier mot de `fullName`, repli sur `null`.
- `displayName` = `firstName` + espace + **première lettre du nom en majuscule suivie d'un point** (`lastName`, repli sur le dernier mot de `fullName`) ; si pas de nom de famille : le prénom seul ; si rien : `null` (le mobile affiche « Client AZƆ̀ »).
- **Ne plus envoyer `fullName`, ni le téléphone, ni l'identifiant du client** dans le radar. Pendant la transition, vous pouvez garder `fullName` une version ; le mobile utilise `displayName` s'il existe, sinon masque `fullName` comme avant.

**A.2.3 — Résumé : nombre de clients disponibles**

Nouvelle route (déclarée **avant** `@Get(":id")` dans le contrôleur) :
```
GET /rides/pending/summary?lat=6.37&lng=2.39&radiusKm=10      (rôle DRIVER)
→ 200 { "radiusKm": 10, "count": 7, "nearestKm": 0.8 }
```
- Mêmes filtres exacts que `GET /rides/pending` : statut `PENDING`, non expirée, véhicule visible pour ce Zem (`pricing.rideVisibleFor`), dans le rayon, Zem non présent dans `declinedDriverIds` (voir B.3).
- `count` = nombre de demandes ; `nearestKm` = distance de la plus proche (1 décimale), `null` s'il n'y en a aucune.
- Sans `lat`/`lng` : `400 { message: "Position requise" }`.
- Coût : un `count` + un `min` SQL, **sans** charger les demandes. Le mobile appelle cette route toutes les 15 s et sur chaque événement `ride:new` / `ride:removed`. Cache serveur possible de 3 s par (Zem, case de 500 m).

**A.2.4 — Événements temps réel ciblés**

Aujourd'hui `ride:new` part à tout le monde. À changer :
1. À la connexion d'un socket authentifié dont `user.role === "DRIVER"`, le faire rejoindre la room **`drivers`**.
2. `emitNewRequest` émet **uniquement** dans `drivers` (`this.server.to("drivers").emit("ride:new", payload)`), avec ce payload (rien de plus) :
   ```json
   { "rideId": "…", "vehicleType": "ZEM_ESSENCE", "price": 1200,
     "originLat": 6.37, "originLng": 2.39, "clientDisplayName": "Kossi A.", "at": "2026-10-12T10:00:00.000Z" }
   ```
3. Nouvel événement **`ride:removed`** émis dans `drivers` quand une demande quitte le radar :
   ```json
   { "rideId": "…", "reason": "taken" | "offered" | "cancelled" | "expired", "at": "…" }
   ```
   Déclencheurs : acceptation (`offered` avec la fonction B, `taken` sinon), annulation par le client, expiration (`expireRide`). Quand une demande **revient** au statut `PENDING` après un refus du client (B), réémettre `ride:new`.
4. Le mobile ne se fie pas au contenu : à chaque événement il relance `GET /rides/pending/summary` puis `GET /rides/pending` (avec un anti-rebond de 800 ms).

**A.2.5 — Vie privée (à respecter)**

- Aucun numéro de téléphone, aucun nom complet, aucun identifiant utilisateur dans le radar ni dans les événements.
- Seuls les comptes `role = DRIVER` avec dossier `APPROVED` reçoivent ces données. Les coursiers (`provider.type === "COURIER"`) n'en reçoivent pas (déjà le cas pour `/rides/pending`).
- Le point de départ est exact (c'est déjà ce que voit le Zem aujourd'hui). La position GPS en direct du client n'est **jamais** envoyée avant que le client ait confirmé ce Zem (fonction B).

### A.3 Tests d'acceptation (A)

1. Trois demandes `PENDING` Zem essence à 2 km, 9 km et 14 km d'un Zem essence en ligne → `summary` : `count = 2`, `nearestKm = 2.0` ; `pending` renvoie 2 demandes triées.
2. `radiusKm=5` → `count = 1`. `radiusKm=50` → ramené à 15 (ou `400`, au choix, à documenter).
3. Une demande de Zem électrique n'apparaît pas pour un Zem essence si `strictVehicleMatch = true`.
4. Une demande expirée disparaît du `summary` (et est annulée, comme aujourd'hui).
5. Un client sans nom de famille → `displayName` = prénom seul ; un client sans rien → `displayName = null`.
6. Un socket client (rôle `CLIENT`) ne reçoit **pas** `ride:new`.
7. Quand un autre Zem accepte la demande, le premier Zem reçoit `ride:removed` avec `reason: "offered"` (ou `"taken"` avant la fonction B).
8. Aucune réponse du radar ne contient `phone`, `fullName` (après la période de transition) ni `clientId`.

---

## C. Carte du Zem : sa position, celle du client, la destination

### C.1 Ce que le Zem verra (mobile — déjà fait)

Pendant une course (`MATCHED`, `ARRIVED`, `IN_PROGRESS`), sa carte montre **toujours les trois éléments** :

| Élément | Marqueur | Source |
|---|---|---|
| Sa position | point bleu « Moi » + flèche de direction | GPS du téléphone |
| Le client | point orange avec son prénom ; **si sa position en direct est inconnue, le point est placé sur le point de départ demandé** | socket `client:location` (A) ou, à défaut, `originLat/originLng` |
| L'arrivée | point rouge « Destination » | `destLat/destLng` |

Deux lignes sur la carte :
- **Ligne pleine** (violet) : l'étape en cours (Zem → client avant la prise en charge ; Zem → destination pendant la course).
- **Ligne pointillée** (violet clair) : la suite du trajet (client → destination) tant que le client n'est pas monté.

La caméra cadre toujours les trois points (elle ne se recentre que si l'un approche du bord).

### C.2 Ce que le backend doit faire

**C.2.1 — Position du client incluse dans `GET /rides/:id` pour le Zem**

Problème actuel : si l'application du Zem redémarre (ou reprend après une coupure), le point du client n'apparaît qu'au prochain envoi du client.
- Dans la réponse de `GET /rides/:id` **quand l'appelant est le `driverId`** et `status ∈ { MATCHED, ARRIVED }` : ajouter `clientLat`, `clientLng`, `clientLocatedAt` (valeurs déjà en base). Dans tous les autres cas (statut `IN_PROGRESS` ou terminé, appelant = client, ou statut `OFFERED`/`PENDING`) : **ne pas** les inclure (pas de fuite de position).
- Idem pour la réponse de `accept` / `approve-driver` (voir B) côté Zem.
- Mobile : lit ces champs s'ils existent ; sinon attend le socket.

**C.2.2 — Trajet « course » (départ → destination), indépendant de l'étape**

Étendre `GET /rides/:id/route` avec un paramètre optionnel `stage` :
```
GET /rides/:id/route                  → comportement actuel (étape en cours)
GET /rides/:id/route?stage=trip       → départ du client → destination, quelle que soit l'étape
```
- `stage=trip` est autorisé pour `MATCHED`, `ARRIVED`, `IN_PROGRESS` (client **et** Zem de la course).
- `from` = `originLat/originLng`, `to` = `destLat/destLng`. Le trajet ne change pas pendant la course : **cache de 10 minutes** par `rideId` (clé `rideId:trip`), et `lastValidRoutes` conservé comme aujourd'hui pour survivre à une panne d'OSRM.
- Réponse : même forme qu'aujourd'hui, avec `stage: "trip"`.
- Valeur de `stage` inconnue → `400`.
- Pourquoi côté serveur : le mobile appelle sinon l'OSRM public depuis chaque téléphone, qui limite le débit (c'est la cause de l'erreur « itinéraire indisponible » vue en test).

**C.2.3 — Adresses lisibles sur la course**

Aujourd'hui le Zem ne voit que des coordonnées ; le mobile doit géocoder chaque adresse (lent, limité).
- Dans `CreateRideDto`, ajouter deux champs **optionnels** : `originLabel` et `destLabel` (`@IsOptional() @IsString() @MaxLength(120)`), les enregistrer sur `Ride` (colonnes `originLabel String?`, `destLabel String?`) et les renvoyer dans **toutes** les réponses de course (`/pending`, `/accept`, `/:id`, `/history`).
- Le mobile **envoie déjà** ces deux champs (ignorés tant que le DTO ne les connaît pas, grâce à `whitelist`). Il continue à géocoder quand ils sont absents.
- Nettoyage : couper les espaces, retirer les caractères de contrôle.

**C.2.4 — Prénom du client dans les réponses du Zem**

Dans `WITH_CLIENT` (`rides.service.ts`) et partout où `client` est inclus pour le Zem : renvoyer `{ displayName, firstName }` (même règle que A.2.2) **en plus** de `fullName`/`phone` existants pendant la transition. Le téléphone du client reste **masqué** par le mobile ; l'idéal est que le serveur ne renvoie le numéro qu'aux statuts `MATCHED`, `ARRIVED`, `IN_PROGRESS`.

### C.3 Tests d'acceptation (C)

1. Zem et client actifs, statut `MATCHED` : `GET /rides/:id` (Zem) contient `clientLat/clientLng/clientLocatedAt` ; le même appel par le client ne les contient pas.
2. Même appel en `IN_PROGRESS` → ces champs sont absents pour le Zem.
3. `GET /rides/:id/route?stage=trip` en `MATCHED` → coordonnées du départ vers la destination ; deuxième appel dans les 10 min → servi depuis le cache (aucun appel OSRM).
4. `stage=trip` sur une course `PENDING` ou `COMPLETED` → `400`.
5. `POST /rides` avec `originLabel`/`destLabel` → renvoyés par `GET /rides/:id` et `GET /rides/pending`.
6. OSRM injoignable après un premier succès → `route?stage=trip` renvoie le dernier trajet valide (`fallback: true` comme aujourd'hui).

---

## B. Le client voit le profil du Zem avant de s'engager

C'est la fonction la plus structurante. Aujourd'hui, dès que le Zem appuie sur « Accepter », la course est `MATCHED` : le client est engagé sans avoir rien vu du Zem. On ajoute une **étape de confirmation** par le client.

### B.1 Le parcours voulu

```
CLIENT                                         SERVEUR                              ZEM
──────                                         ───────                              ───
Crée la demande ─────────────────────────────► PENDING (visible sur les radars)
                                                                                    Appuie « Accepter »
                                               PENDING → OFFERED  ◄───────────────  POST /rides/:id/accept
                                               (driverId posé, délai de 45 s)
Notification « Un Zem a accepté ta course »  ◄─┤                                    Écran « En attente de la
Écran : carte « Un Zem propose de te prendre »                                      confirmation du client… 45 s »
  • [Voir le profil]  • [Choisir ce Zem]  • [Refuser]                               • [Annuler ma proposition]
   │
   ├─ « Choisir ce Zem » ──► POST /rides/:id/approve-driver ──► OFFERED → MATCHED ──► Zem notifié : course confirmée
   │                                                            (la course continue comme aujourd'hui)
   ├─ « Refuser »          ──► POST /rides/:id/decline-driver ─► OFFERED → PENDING ──► Zem notifié : « Le client a choisi
   │                                                            (ce Zem ne revoit plus cette demande)     un autre Zem » ; la demande
   │                                                                                   repart sur les radars des autres
   └─ Aucune réponse en 45 s ► OFFERED → PENDING (ce Zem exclu) ► Zem notifié « Le client n'a pas répondu »
```

### B.2 Changement du modèle de données (Prisma)

```prisma
enum RideStatus {
  PENDING
  OFFERED      // NOUVEAU : un Zem a accepté, le client doit confirmer
  MATCHED
  ARRIVED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

model Ride {
  // … champs existants …
  offeredAt         DateTime?   // quand le Zem a accepté
  offerExpiresAt    DateTime?   // offeredAt + rides.offerExpirySeconds
  declinedDriverIds String[]    @default([])   // Zem exclus de cette demande (refusés, sans réponse, retirés)
  matchedAt         DateTime?   // quand le client a confirmé (OFFERED → MATCHED)
}
```
- Migration SQL : `ALTER TYPE "RideStatus" ADD VALUE 'OFFERED' BEFORE 'MATCHED';` (à exécuter **hors transaction** avec Prisma ; prévoir un fichier de migration dédié).
- Nouvelle clé de config `rides.offerExpirySeconds` dans `tarification.json` (valeur **45**). Le mobile la lit (repli 45).
- **Revoir tous les usages du statut `MATCHED`** (`grep -rn '"MATCHED"' src/`) : `assertDriverIsFree`, `cancel`, `arrive`, `history`, `ride-settlement`, notifications, passerelle (`ACTIVE_*_LOCATION_STATUSES`), odomètre, `route()`. Règle générale : `OFFERED` **n'est pas** une course active (aucun débit, aucune base due, pas de GPS du client) **sauf** les deux cas listés plus bas.

### B.3 Les endpoints

**`POST /rides/:id/accept`** (rôle `DRIVER`) — **comportement modifié**
- Conditions (toutes dans **un seul** `updateMany` atomique, comme aujourd'hui) : `id`, `status = "PENDING"`, `driverId = null`, et `NOT (declinedDriverIds contient le Zem)`.
- Effet : `status = "OFFERED"`, `driverId = zem`, `offeredAt = now`, `offerExpiresAt = now + offerExpirySeconds`.
- `assertDriverIsFree` doit **aussi** refuser un Zem qui a déjà une course en `OFFERED` (un Zem = une proposition ou une course à la fois) : `400 "Tu as déjà une proposition ou une course en cours"`.
- Si la demande n'est plus `PENDING` : `400 "Course déjà prise"` (inchangé). Si le Zem est dans `declinedDriverIds` : `403 "Le client a déjà refusé cette proposition"`.
- Réponse `200` : la course vue par le Zem (comme aujourd'hui) avec `status: "OFFERED"`, `offerExpiresAt` (ISO) et **sans** `clientLat/clientLng` ni téléphone du client.
- Notifications : push + inbox au **client** : titre « Un Zem a accepté ta course », texte « Vois son profil et confirme avant de partir. », `data: { event: "ride-offered", rideId }`.
- Sockets : `ride:status { rideId, status: "OFFERED" }` dans `ride:{id}` ; `ride:removed { reason: "offered" }` dans `drivers`.
- ⚠️ Compatibilité : une **ancienne** version de l'application attend `MATCHED` immédiatement. Option de transition : activer la confirmation par un drapeau de config `rides.requireClientApproval` (défaut `true` en production, `false` pour tester l'ancien comportement). Quand le drapeau est `false`, `accept` garde le comportement actuel (`PENDING → MATCHED`).

**`POST /rides/:id/approve-driver`** (rôle `CLIENT`, propriétaire de la course) — **nouveau**
- Condition atomique : `id`, `clientId = appelant`, `status = "OFFERED"`, `offerExpiresAt > now`.
- Effet : `status = "MATCHED"`, `matchedAt = now`. (À partir d'ici la base est due, le Zem est « engagé », le client partage sa position : tout redevient comme aujourd'hui.)
- Idempotent : si la course est déjà `MATCHED` avec le même Zem → `200` avec la course.
- Si `offerExpiresAt` est dépassé : traiter l'expiration (B.4) puis `400 "La proposition a expiré"`.
- Si le statut n'est plus `OFFERED` (annulée, retirée) : `400 "Cette proposition n'est plus disponible"`.
- Contrôle du portefeuille : **ne pas** redébiter ; le contrôle du solde reste celui de la création de la course. (Si vous vérifiez le solde à l'acceptation aujourd'hui, le déplacer ici.)
- Notifications au **Zem** : « Le client t'a choisi — rejoins le point de prise en charge », `data: { event: "ride-approved", rideId }`.
- Sockets : `ride:status { status: "MATCHED" }` ; invalider le contexte de position (`invalidateRideLocationContext`).

**`POST /rides/:id/decline-driver`** (rôle `CLIENT`) — **nouveau**
- Condition atomique : `status = "OFFERED"`, `clientId = appelant`.
- Effet : `status = "PENDING"`, `declinedDriverIds = [...declinedDriverIds, driverId]`, puis `driverId = null`, `offeredAt = null`, `offerExpiresAt = null`.
- **Le chronomètre d'expiration de la demande ne repart pas à zéro** : `createdAt` est conservé. Si la demande a déjà dépassé `pendingExpiryMinutes`, elle expire normalement (annulée sans débit).
- Notifications au **Zem** : « Le client a choisi un autre Zem. » (`data: { event: "ride-declined", rideId }`).
- Réémettre `ride:new` dans `drivers` (la demande est de nouveau disponible).
- Réponse : la course vue par le client (`status: "PENDING"`, `expiresInMinutes`).

**`POST /rides/:id/withdraw-offer`** (rôle `DRIVER`, Zem de la proposition) — **nouveau**
- Condition : `status = "OFFERED"`, `driverId = appelant`.
- Effet : identique à `decline-driver` (retour à `PENDING`, Zem ajouté à `declinedDriverIds`), notification au **client** : « Le Zem a retiré sa proposition. Nous cherchons un autre Zem. »
- Quand la course est déjà `MATCHED`, `withdraw-offer` renvoie `400` : le Zem utilise l'annulation normale (`POST /rides/:id/cancel`).

**`GET /rides/:id/driver-profile`** (rôle `CLIENT`, propriétaire de la course) — **nouveau**
- Autorisé quand `status ∈ { OFFERED, MATCHED, ARRIVED, IN_PROGRESS, COMPLETED }` et qu'un `driverId` existe. Sinon `404`/`400`.
- Réponse : l'objet `profile` décrit en B.5 (même contenu que dans `ride.driver.profile`). Sert à l'écran « Profil du Zem » (le mobile le lit dans la course quand il y est, et appelle cette route sinon).

**Autres endpoints à adapter**
- `POST /rides/:id/cancel` : le **client** peut annuler en `OFFERED` (aucun débit, Zem notifié « Le client a annulé »). Le **Zem** qui annule en `OFFERED` = `withdraw-offer`.
- `GET /rides/pending` et `/summary` : exclure les demandes dont `declinedDriverIds` contient le Zem, et (déjà vrai) celles qui ne sont plus `PENDING` (donc les `OFFERED`).
- `GET /rides/history` : une course qui finit annulée depuis `OFFERED` apparaît comme `CANCELLED`.

### B.4 Expiration de la proposition (45 s)

- **Règle** : si `status = OFFERED` et `offerExpiresAt < now` sans réponse du client → même effet que `decline-driver` (retour à `PENDING`, Zem ajouté à `declinedDriverIds`), notification au **Zem** « Le client n'a pas répondu à ta proposition », réémission de `ride:new`.
- **Implémentation recommandée** (les deux) :
  1. **Tâche périodique** toutes les 5 secondes (`@nestjs/schedule` `@Interval(5000)`, ou un `setInterval` dans le module) : `updateMany where status = OFFERED and offerExpiresAt < now`. Faire passer chaque course concernée par la même fonction que `decline-driver` pour envoyer notifications et sockets.
  2. **Rattrapage à la lecture** dans `findOne`, `pending`, `accept`, `approve-driver` : si la course est `OFFERED` et expirée, la traiter avant de répondre. Ainsi le résultat reste juste même si la tâche est en retard.
- Ne **jamais** laisser une course `OFFERED` indéfiniment : un Zem resterait bloqué (`assertDriverIsFree`).

### B.5 Contenu du profil public du Zem (ce que le client a le droit de voir)

À renvoyer dans `ride.driver.profile` (réponse de `GET /rides/:id` pour le **client**, à partir de `OFFERED`) et dans `GET /rides/:id/driver-profile` :

```json
"driver": {
  "fullName": "Romaric Soglo",
  "phone": null,
  "profile": {
    "displayName": "Romaric S.",
    "photoUrl": null,
    "verified": true,
    "rating": 4.8,
    "ratingCount": 126,
    "jobsCompleted": 340,
    "experienceYears": 4,
    "memberSince": "2025-03-12T09:00:00.000Z",
    "city": "Cotonou",
    "zones": ["Cadjèhoun", "Haie Vive"],
    "bio": "Zem depuis 4 ans, ponctuel et prudent.",
    "vehicleType": "ZEM_ELECTRIC",
    "vehicleModel": "Bajaj Boxer 150",
    "plateMasked": "••-••21-AX",
    "agencyName": null
  },
  "offer": { "expiresAt": "2026-10-12T10:00:45.000Z", "distanceKm": 1.2, "etaMinutes": 4 }
}
```

| Champ | Règle |
|---|---|
| `displayName` | Prénom + initiale du nom (« Romaric S. »), tiré de `ProviderProfile.fullName` (repli `User.fullName`). |
| `verified` | `true` si `provider.status = APPROVED` (et, au choix, `kycScore ≥ 80`). Le mobile affiche un badge « Vérifié par AZƆ̀ ». |
| `rating` / `ratingCount` | Moyenne des `Ride.rating` non nuls des courses `COMPLETED` du Zem, **1 décimale** ; `rating = null` si `ratingCount < 1` (le mobile affiche « Nouveau »). Voir B.7. |
| `jobsCompleted` | Nombre de courses `COMPLETED` du Zem. |
| `experienceYears`, `city`, `zones`, `bio` | Depuis `ProviderProfile`. `bio` coupée à 200 caractères, sans balises ni liens. |
| `memberSince` | `User.createdAt`. |
| `vehicleType`, `vehicleModel` | Depuis `ProviderProfile`. |
| `plateMasked` | Plaque **partiellement masquée** : ne garder que les 2 derniers caractères du numéro et le suffixe de série (« ••-••21-AX »). La plaque complète n'est visible qu'à partir de `ARRIVED` (champ `plate`, optionnel — à décider avec le métier). |
| `photoUrl` | `null` tant qu'il n'y a pas de photo publique. Si vous exposez la photo du dossier KYC (selfie) : uniquement en version **redimensionnée**, jamais le fichier d'origine (CNI, permis). Voir B.8. |
| `phone` | **`null` pendant `OFFERED`** ; renvoyé (comme aujourd'hui) à partir de `MATCHED`. Le client ne doit pas pouvoir contacter le Zem hors de l'application avant d'avoir confirmé. |
| `offer` | Présent **seulement** en `OFFERED` : `expiresAt`, `distanceKm` (Zem → départ du client, Haversine à 1 décimale d'après `driverLat/driverLng`, sinon `null`), `etaMinutes` (estimation depuis la distance ou le cache de route, sinon `null`). |

**Jamais** exposés au client : identifiant utilisateur du Zem, `kycScore` brut, documents, NPI, revenus, commission, adresse précise du domicile.

Position du Zem pendant `OFFERED` : autoriser `driver:location` du Zem et la relayer **au client** (ajouter `OFFERED` à `ACTIVE_DRIVER_LOCATION_STATUSES`) pour qu'il voie « à 1,2 km » sur la carte pendant qu'il décide. La position du **client** n'est **pas** relayée au Zem tant que la course n'est pas `MATCHED` (ne pas ajouter `OFFERED` à `ACTIVE_CLIENT_LOCATION_STATUSES`).

### B.6 Ce que voit le Zem

- Après « Accepter » : écran « Proposition envoyée — en attente de la confirmation du client » avec le compte à rebours calculé depuis `offerExpiresAt` (45 s) et un bouton « Annuler ma proposition » (`withdraw-offer`).
- Il passe en course normale **uniquement** quand `ride:status` devient `MATCHED` (ou quand `GET /rides/:id` renvoie `MATCHED`). Le mobile interroge `GET /rides/:id` toutes les 3 s en plus du socket.
- Si la course repasse `PENDING` (refus ou expiration) ou devient `CANCELLED` : message « Le client a choisi un autre Zem » / « Le client n'a pas répondu » / « Demande annulée », et retour à la liste.

### B.7 Calcul de la note et du compteur de courses (corrige un manque existant)

`rate()` n'enregistre que `Ride.rating`. Il faut :
1. **Calculer** `rating` et `ratingCount` **à la volée** avec une agrégation : `prisma.ride.aggregate({ where: { driverId, status: "COMPLETED", rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } })`, mise en cache 60 s par Zem ; **ou**
2. **Mettre à jour** `ProviderProfile.rating`, `ratingCount` (nouvelle colonne `Int @default(0)`) et `jobsCompleted` dans `rate()` et dans `complete()` (recalcul incrémental : `rating = (rating × n + stars) / (n + 1)`).
Dans les deux cas : `jobsCompleted` = `count(Ride where driverId, status = COMPLETED)`. Les valeurs actuelles (0 partout) ne doivent pas être renvoyées telles quelles.
Contrainte à ajouter : `rate()` n'accepte la note que si la course est `COMPLETED` et qu'elle n'a pas déjà été notée (aujourd'hui le client peut noter n'importe quand et plusieurs fois).

### B.8 Photo de profil du Zem (optionnel, à décider)

Le mobile permet maintenant à chaque utilisateur de choisir une photo, **gardée sur le téléphone uniquement**. Pour que le client voie la photo du Zem : ajouter `User.avatarUrl String?`, une route `PUT /users/me/avatar` (image JPEG ≤ 500 Ko, redimensionnée à 256 × 256 côté serveur, stockée sur un espace de fichiers) et renvoyer `profile.photoUrl`. Tant que ce n'est pas fait, `photoUrl: null` et le mobile affiche les initiales.

### B.9 Sécurité et cas limites à couvrir

| Cas | Comportement attendu |
|---|---|
| Deux Zem appuient sur « Accepter » en même temps | Un seul passe (`updateMany` atomique sur `status = PENDING`) ; l'autre reçoit `400 "Course déjà prise"`. |
| Le client confirme au moment où l'offre expire | Une seule transition gagne (condition `offerExpiresAt > now` dans l'`updateMany`). Le perdant reçoit `400` avec un message clair. |
| Le client annule pendant `OFFERED` | `CANCELLED`, aucun débit, Zem notifié, `ride:removed` non nécessaire (la demande n'était plus sur les radars). |
| Le Zem coupe son application pendant `OFFERED` | L'offre expire normalement (B.4) ; le client peut aussi refuser à tout moment. |
| Un autre client essaie `approve-driver` sur une course qui n'est pas la sienne | `403`. |
| Un Zem essaie `approve-driver` / `decline-driver` | `403` (réservé au `CLIENT` propriétaire). |
| Un client essaie de lire le profil d'un Zem qui n'est pas celui de sa course | `403`/`404` : `driver-profile` n'existe que par course. |
| Même Zem qui reprend la même demande après un refus | `403` (`declinedDriverIds`). |
| Tous les Zem refusés / aucun disponible | La demande suit son expiration normale (`pendingExpiryMinutes`), annulée sans débit. |
| Ancienne application qui appelle `accept` | Avec `requireClientApproval = false` : ancien comportement (`MATCHED`). Avec `true` : la réponse porte `status: "OFFERED"` ; l'ancienne application doit être mise à jour (le mobile actuel gère les deux). |

### B.10 Tests d'acceptation (B)

1. Zem accepte → statut `OFFERED`, `driverId` posé, `offerExpiresAt ≈ now + 45 s` ; le client reçoit la notification ; le radar des autres Zem ne montre plus la demande ; `ride:removed (offered)` reçu.
2. Client `approve-driver` dans les 45 s → `MATCHED`, le Zem est notifié, le GPS du client est relayé au Zem à partir de là, la suite (arrivée, codes, démarrage, fin) est inchangée.
3. Client `decline-driver` → `PENDING`, `driverId = null`, `declinedDriverIds` contient le Zem ; le même Zem ne revoit plus la demande ; un autre Zem peut l'accepter ; `createdAt` inchangé.
4. Pas de réponse pendant 45 s → même résultat qu'au point 3 ; le Zem reçoit « Le client n'a pas répondu » ; il n'est plus bloqué (`assertDriverIsFree` autorise une nouvelle acceptation).
5. Client `approve-driver` à 46 s → `400 "La proposition a expiré"`, la course est revenue à `PENDING`.
6. Zem `withdraw-offer` → `PENDING`, client notifié ; Zem exclu de cette demande.
7. `GET /rides/:id` par le client en `OFFERED` : `driver.profile` complet, `driver.phone = null`, `offer.expiresAt` présent ; par un autre utilisateur : `403`.
8. `GET /rides/:id/driver-profile` : conforme au tableau B.5 ; `rating = null` pour un Zem sans note ; la plaque est masquée.
9. Un Zem en `OFFERED` ne peut pas accepter une seconde demande.
10. Client qui annule en `OFFERED` : aucun débit au portefeuille ; Zem notifié.
11. Après une course `COMPLETED` notée 5 puis 3 : `rating = 4.0`, `ratingCount = 2` ; une seconde note sur la même course est refusée.
12. Les tests existants du portefeuille (débit à la fin, base due à l'acceptation) sont adaptés : la base devient due à `MATCHED` (confirmation du client), pas à `OFFERED`.

---

## D. Ce que le mobile envoie et attend (contrat résumé)

| Sujet | Le mobile **envoie** | Le mobile **attend** (et tolère l'absence) |
|---|---|---|
| Radar | `GET /rides/pending?lat&lng&radiusKm=10` | items avec `client.displayName` (sinon masque `fullName`) ; `distanceKm`, `expiresInMinutes` |
| Compteur | `GET /rides/pending/summary?lat&lng&radiusKm=10` toutes les 15 s | `{ radiusKm, count, nearestKm }` ; **si la route est absente (404), le mobile compte lui-même les demandes à ≤ 10 km** |
| Temps réel radar | écoute `ride:new` et `ride:removed` | rafraîchit le radar à chaque événement ; sans eux, interrogation toutes les 8 s comme aujourd'hui |
| Création de course | `POST /rides` + `originLabel`, `destLabel` | libellés renvoyés dans les courses ; sinon géocodage local |
| Carte du Zem | `GET /rides/:id/route` et `?stage=trip` | `clientLat/clientLng` dans `GET /rides/:id` du Zem en `MATCHED`/`ARRIVED` ; **sans `stage=trip` le mobile calcule le trajet « course » lui-même** (service public, avec repli) |
| Acceptation | `POST /rides/:id/accept` | `status: "OFFERED"` + `offerExpiresAt`, **ou** `MATCHED` (ancien comportement : tout continue comme avant) |
| Zem en attente | `GET /rides/:id` toutes les 3 s ; `POST /rides/:id/withdraw-offer` | passage à `MATCHED`, retour `PENDING`, ou `CANCELLED` |
| Client, offre reçue | `GET /rides/:id` (suivi existant) ; `POST /rides/:id/approve-driver` ; `POST /rides/:id/decline-driver` ; `GET /rides/:id/driver-profile` | `status: "OFFERED"`, `driver.profile`, `offer.expiresAt` |

Fichiers mobile concernés (pour information) : `screens/DriverHomeScreen.tsx`, `screens/LiveTrackingScreen.tsx`, `components/OSMMapView.tsx`, `services/api.ts`, `components/DriverProfileSheet.tsx` (nouveau), `components/NearbyClientsMap.tsx` (nouveau).

---

## E. Ordre de travail conseillé et estimation

1. **C.2.1 + C.2.4** (position client dans `GET /rides/:id`, prénom) — très rapide, débloque immédiatement la carte du Zem.
2. **A.2.1 + A.2.2 + A.2.3** (rayon, nom d'affichage, résumé) puis **A.2.4** (room `drivers`, `ride:removed`).
3. **C.2.2 + C.2.3** (trajet `stage=trip`, libellés d'adresses).
4. **B** en une seule livraison : migration `OFFERED`, endpoints, expiration, profil public, notifications, tests. Prévoir la migration Render (`prisma migrate deploy` au démarrage) **avant** de publier la nouvelle application, car la nouvelle valeur d'enum doit exister avant tout appel à `accept`.
5. Mettre à jour `PROJECT_SUMMARY/PARCOURS_ZEM.md` (le déroulé « accepter → MATCHED » change).

Questions ouvertes à trancher avec le métier : (a) délai de confirmation (45 s proposé) ; (b) plaque complète visible à partir de `ARRIVED` ou jamais ; (c) photo du Zem : selfie du dossier KYC ou photo dédiée ; (d) le rayon de 10 km s'applique-t-il aussi aux voitures ; (e) faut-il limiter le nombre de refus consécutifs d'un client (anti-abus).
