# Demande backend — le client doit recevoir une alerte immédiate (popup) pour juger le profil du Zem

**De :** Sergio (mobile) — **Pour :** l'équipe backend (Dorin / Esther.W)
**Date :** 12 octobre 2026
**Suite de :** `DEMANDE_BACKEND_RADAR_PROFIL_ZEM_ET_CARTE.md` (fonction B) et `DEMANDE_BACKEND_FIN_PROPOSITION_ZEM.md`

## 1. Le problème constaté en test

Le Zem appuie sur « Accepter ». Son écran affiche « Proposition envoyée — Sergio A. regarde ton profil avant de te choisir » avec un compte à rebours de quelques secondes, **puis rien ne se passe** : le client n'a jamais vu le profil du Zem.

**Ce que le produit doit faire :** au moment où le Zem accepte, le client reçoit **immédiatement une fenêtre (popup) par-dessus tout ce qu'il est en train de faire** (accueil, autre onglet, application en arrière-plan ou écran verrouillé), avec le profil du Zem et deux boutons — **Choisir ce Zem** / **Refuser** — et un compte à rebours. Il n'a que quelques secondes pour décider.

## 2. Pourquoi ça ne marche pas aujourd'hui (constaté dans le code de `main`, commit `59e7c9fb`)

| # | Constat | Conséquence |
|---|---|---|
| 1 | `accept` (`rides.service.ts`) n'avertit le client que par `emitStatus(rideId, "OFFERED")`, qui écrit dans la room **`ride:{id}`**. Le client ne rejoint cette room (`ride:join`) que **lorsqu'il ouvre l'écran de suivi de la course**. | Un client sur l'accueil, un autre onglet ou avec l'application en arrière-plan ne reçoit **aucun événement temps réel**. |
| 2 | La room **`user:{userId}`** n'est rejointe que dans le gestionnaire `ride:join` (`rides.gateway.ts`, ligne ~140), **pas à la connexion**. | Aucun événement personnel ne peut atteindre un client qui n'a pas ouvert le suivi. |
| 3 | La seule alerte restante est la notification poussée créée par `notifications.push(..., { sendPush: true, data: { event: "ride-offered", rideId } })`. Elle part sur le canal Android **`default`**, avec le **titre en français non traduit** et **sans durée de vie** (`ttl`). | Une notification ordinaire, facile à rater ; si elle arrive après les quelques secondes, elle est inutile ; rien ne l'annule quand la proposition se termine. |
| 4 | `sendExpoPush` est **attendu** (`await`) à l'intérieur de `accept`, avec un délai maximum de 6 s. | La réponse de `accept` au Zem peut être retardée jusqu'à 6 s par la livraison d'une notification. |
| 5 | La proposition expire à `offerExpirySeconds` (45 s) **exactement**, et `approveDriver` refuse dès `offerExpiresAt < now`. | Un client qui touche « Choisir » à la dernière seconde (latence réseau) reçoit « La proposition a expiré » alors qu'il a décidé à temps. |
| 6 | Le Zem ne sait pas si le client **a vu** la proposition. | Il attend sans information (« Reste sur cet écran ») alors que le client n'a peut-être même pas ouvert l'application. |

## 3. Ce que le mobile fait (déjà prêt ou en cours)

Le mobile affiche une **popup plein écran au-dessus de n'importe quel écran** dès qu'il apprend qu'une proposition est en attente, par trois chemins qui se complètent :
1. **Événement temps réel `ride:offered`** reçu sur un socket maintenu par l'application pour tout client connecté.
2. **Notification poussée** `ride-offered` (reçue au premier plan ou touchée depuis la barre de notifications) → récupère la proposition et ouvre la popup.
3. **Relecture de secours** toutes les 3 s de la course en attente tant que le client n'est pas sur l'écran de suivi, et `GET /rides/offers/pending` au démarrage, à la reconnexion du socket et au retour au premier plan.

La popup contient : nom du Zem, badge « Vérifié », note, nombre de courses, véhicule, plaque masquée, distance et temps d'arrivée, compte à rebours, bouton « Voir le profil complet », « Choisir ce Zem », « Refuser ». Elle vibre à l'ouverture. Elle se ferme dès que la proposition n'est plus en attente (choisie, refusée, expirée, retirée, course annulée).

## 4. Ce que le backend doit faire

### 4.1 Rejoindre sa room personnelle dès la connexion du socket

Dans `handleConnection` (`rides.gateway.ts`), pour **tout** socket authentifié (client, Zem, agence) : `client.join("user:" + payload.sub)`. (Les Zem rejoignent déjà `drivers`.) Garder le `join` actuel de `ride:join` (idempotent).

### 4.2 Nouvel événement `ride:offered` envoyé au client

À la fin de `accept` en mode confirmation (juste après le `updateMany` réussi), émettre **vers `user:{clientId}`** (pas vers la room de la course) :

```json
event "ride:offered"
{
  "rideId": "…",
  "expiresAt": "2026-10-12T12:50:45.000Z",
  "serverNow": "2026-10-12T12:50:00.000Z",
  "expiresInSeconds": 45,
  "price": 1200,
  "originLabel": "Cadjèhoun",
  "destLabel": "Marché Dantokpa",
  "driver": {
    "displayName": "Romaric S.",
    "photoUrl": null,
    "verified": true,
    "rating": 4.8,
    "ratingCount": 126,
    "jobsCompleted": 340,
    "experienceYears": 4,
    "vehicleType": "ZEM_ELECTRIC",
    "vehicleModel": "Bajaj Boxer 150",
    "plateMasked": "••-••21-AX"
  },
  "offer": { "distanceKm": 1.2, "etaMinutes": 4 }
}
```
- **Mêmes champs que `buildPublicDriverProfile`** (déjà écrit) : réutiliser cette fonction. **Ni téléphone, ni identifiant du Zem, ni nom complet.**
- `serverNow` + `expiresInSeconds` permettent au mobile d'afficher le compte à rebours **sans dépendre de l'horloge du téléphone** (écart fréquent de quelques secondes).
- Émettre aussi, au même endroit, `ride:status { status: "OFFERED" }` dans la room de la course (comportement actuel).

### 4.3 Fin de proposition : fermer la popup du client

Émettre vers `user:{clientId}` l'événement `ride:offer-ended { rideId, outcome: "withdrawn" | "expired" | "cancelled" | "approved", at }` quand : le Zem retire sa proposition (`withdrawOffer`), la proposition expire (`revertOfferToPending`, tâche et rattrapage), la course est annulée, ou le client confirme depuis un **autre appareil**. Le mobile ferme alors la popup immédiatement.

### 4.4 Route de rattrapage `GET /rides/offers/pending` (rôle CLIENT)

```
GET /rides/offers/pending
→ 200 { "offers": [ { …même contenu que l'événement ride:offered… } ] }   // liste vide si rien en attente
```
- Renvoie les courses du client au statut `OFFERED` dont `offerExpiresAt` n'est pas dépassé (en pratique zéro ou une).
- Sert quand le client rouvre l'application depuis la notification, revient au premier plan ou reconnecte son socket : il récupère la popup **sans avoir manqué l'événement**.
- À déclarer **avant** `@Get(":id")` dans le contrôleur.
- Contenu strictement identique à 4.2 pour que le mobile n'ait qu'un seul rendu.

### 4.5 Notification poussée dédiée (haute priorité, courte durée de vie)

Dans `accept`, **ne pas attendre** (`await`) l'envoi (voir 2.4) : lancer `void this.notifications.push(...)` avec gestion d'erreur, après avoir répondu au Zem.

Étendre `PushOptions` / `sendExpoPush` pour accepter ces champs optionnels, transmis tels quels à l'API Expo (`https://exp.host/--/api/v2/push/send`) :

| Champ Expo | Valeur pour `ride-offered` | Pourquoi |
|---|---|---|
| `channelId` | `"ride-offers"` | Canal Android **dédié**, importance maximale, son et vibration forts. Le mobile crée ce canal ; tant que le serveur envoie `default`, rien ne change. |
| `priority` | `"high"` (déjà présent) | Livraison immédiate même en veille. |
| `ttl` | `offerExpirySeconds` (45) | **Ne pas livrer une alerte périmée** : après 45 s le service de push abandonne le message. |
| `sound` | `"default"` | Son. |
| `data` | `{ event: "ride-offered", rideId, expiresAt, serverNow }` | Le mobile ouvre la popup et peut calculer le compte à rebours ; **pas** de profil complet (limite de taille, vie privée sur l'écran verrouillé). |
| `title` / `body` | Dans la **langue du client** : « Un Zem a accepté ta course » / « Touche pour voir son profil — il te reste {s} s. » | Les textes sont aujourd'hui toujours en français. Utiliser `user.language` (déjà en base) et un petit dictionnaire serveur `fr/en/es/de`, ou envoyer les clés `titleKey`/`bodyKey` + `params` que le mobile traduit (voir `NOTIFICATION_RIDE_OFFERED`). |

À la fin de la proposition (§4.3), envoyer une **seconde notification poussée silencieuse** `data: { event: "ride-offer-ended", rideId }` (sans titre ni corps, `_contentAvailable: true`) pour que le mobile retire la notification affichée si elle est encore dans la barre.

### 4.6 Marge de confirmation (corriger la course à la dernière seconde)

Ajouter dans la configuration `rides.offerApprovalGraceSeconds` (valeur **5**) :
- `approveDriver` et `declineDriver` acceptent encore l'action pendant `offerExpiresAt + grace`, **tant que la proposition n'a pas été remise en recherche** par la tâche ou le rattrapage.
- La tâche d'expiration et `expireOfferedIfNeeded` attendent `offerExpiresAt + grace` avant de remettre en `PENDING`.
- Le Zem, lui, voit toujours le compte à rebours officiel (`offerExpiresAt`) : la marge n'est pas affichée, elle absorbe seulement la latence réseau.

### 4.7 Dire au Zem que le client a vu la proposition

Nouvelle route et nouvel événement :
```
POST /rides/:id/offer-seen      (rôle CLIENT, propriétaire de la course)
→ 200 { "seenAt": "2026-10-12T12:50:03.000Z" }
```
- Appelée par le mobile **dès que la popup est affichée**. Enregistre `Ride.offerSeenAt` (nouvelle colonne `DateTime?`, mise à `null` quand l'offre prend fin). Idempotent.
- Émettre vers `user:{driverId}` : `ride:offer-seen { rideId, at }`.
- L'écran du Zem affiche alors **« Le client regarde ton profil »** ; tant que l'événement n'est pas reçu, il affiche **« En attente que le client ouvre l'application »**. Cela évite l'impression d'un blocage.
- Reprise : inclure `offerSeenAt` dans la réponse de `GET /rides/:id` (vue Zem) et de `GET /rides/offers/current` (voir `DEMANDE_BACKEND_FIN_PROPOSITION_ZEM.md`).

### 4.8 Durée de la proposition

45 s est la valeur actuelle (`rides.offerExpirySeconds`). Avec une popup immédiate, **20 à 30 s suffisent** et font attendre moins le Zem. À trancher avec le métier ; la valeur est lue dans la configuration partagée par le mobile (compte à rebours calculé avec `expiresInSeconds` de l'événement, donc **aucune modification du mobile** si elle change).

## 5. Ce que le mobile envoie et attend (contrat)

| Sujet | Le mobile | Si le backend ne l'a pas encore |
|---|---|---|
| Socket client | Se connecte à l'ouverture de session et écoute `ride:offered`, `ride:offer-ended` | Retombe sur la relecture de la course toutes les 3 s (popup quasi immédiate si l'app est ouverte, jamais en arrière-plan) |
| Rattrapage | `GET /rides/offers/pending` au démarrage, à la reconnexion, au retour au premier plan | `404` ignoré |
| Vu par le client | `POST /rides/:id/offer-seen` à l'ouverture de la popup | `404` ignoré |
| Choisir / refuser | `POST /rides/:id/approve-driver` / `decline-driver` | Déjà en place |
| Notification poussée | Canal Android `ride-offers` créé à l'enregistrement ; toucher la notification ouvre la popup | Notification classique, ouvre l'écran de suivi |

## 6. Tests d'acceptation

1. Client sur l'**accueil** (application ouverte) : le Zem accepte → `ride:offered` reçu en moins d'1 s, popup affichée avec le profil complet et le compte à rebours.
2. Client application **en arrière-plan** : notification poussée sur le canal `ride-offers` (son + vibration) avec titre dans sa langue ; la toucher ouvre la popup.
3. Client application **fermée** puis rouverte dans les 45 s : `GET /rides/offers/pending` renvoie la proposition et la popup apparaît avec le temps restant correct.
4. Client touche « Choisir ce Zem » à `expiresAt + 3 s` (dans la marge) → course `MATCHED` ; à `expiresAt + 6 s` → `400 RIDE_OFFER_ENDED`.
5. Le Zem retire sa proposition pendant que la popup est ouverte → `ride:offer-ended { outcome: "withdrawn" }` ferme la popup ; la notification poussée déjà affichée est retirée.
6. Le client refuse → Zem notifié (`ride:offer-ended` / push), course de nouveau en recherche.
7. Le client ouvre la popup → le Zem reçoit `ride:offer-seen` et son écran passe de « En attente que le client ouvre l'application » à « Le client regarde ton profil ».
8. `accept` répond au Zem en moins d'1 s même si l'API Expo met 6 s à répondre (notification non attendue).
9. Un client A ne reçoit **jamais** la popup d'une course du client B (événement envoyé uniquement à `user:{clientId}` de la course) ; la route `offers/pending` ne renvoie que ses propres courses.
10. Aucune donnée sensible dans l'événement, la notification ou la route : ni téléphone, ni nom complet du Zem, ni identifiant du Zem, ni plaque complète.
11. Notification **expirée** : un téléphone éteint pendant 60 s ne reçoit pas la notification à l'allumage (`ttl`).

## 7. Ordre de travail conseillé

1. **4.1 + 4.2 + 4.3** (room personnelle, `ride:offered`, `ride:offer-ended`) — petit, donne la popup immédiate application ouverte.
2. **4.4** (`offers/pending`) — rattrape les cas fermé/arrière-plan.
3. **4.5** (push dédiée, non bloquante, avec `ttl` et canal `ride-offers`).
4. **4.6** (marge de confirmation) puis **4.7** (« vu par le client »).
5. Trancher **4.8** (durée) avec le métier.
