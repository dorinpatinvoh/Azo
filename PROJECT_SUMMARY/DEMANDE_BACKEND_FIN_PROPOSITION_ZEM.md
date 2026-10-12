# Demande backend — le Zem reste bloqué sur « Proposition envoyée … 0 s »

**De :** Sergio (mobile) — **Pour :** l'équipe backend (Dorin / Esther.W)
**Date :** 12 octobre 2026
**Suite de :** `DEMANDE_BACKEND_RADAR_PROFIL_ZEM_ET_CARTE.md` (fonction B, statut `OFFERED`)

## 1. Le symptôme

Un Zem appuie sur « Accepter ». Son écran passe sur **« Proposition envoyée — Sergio A. regarde ton profil avant de te choisir »** avec un compte à rebours. Le compte à rebours atteint **0 s** et l'écran **reste figé** : le Zem ne passe ni à la carte de la course (si le client l'a choisi), ni au radar (si le client a refusé ou n'a pas répondu). Il n'a aucun moyen de savoir ce qui s'est passé.

## 2. Où est le problème : les deux côtés, mais la cause racine est dans le contrat du backend

### 2.1 Cause racine côté backend (vérifiée dans le code de `main`, commit `f54ac837`)

Quand la proposition prend fin sans que le client choisisse ce Zem (refus, expiration de 45 s, ou retrait), `RidesService.revertOfferToPending` fait :

```ts
data: { status: "PENDING", driverId: null, offeredAt: null, offerExpiresAt: null, declinedDriverIds: newDeclined }
```

Conséquences :

1. **Le Zem n'est plus rattaché à la course** (`driverId = null`). Quand son application relit la course avec `GET /rides/:id`, `findOne` répond :
   ```ts
   if (ride.clientId !== userId && ride.driverId !== userId) throw new ForbiddenException();
   ```
   → **`403 Forbidden`**. C'est la **seule** façon qu'a le Zem d'apprendre que la proposition est terminée, et c'est une erreur indistinguable d'une panne.
2. **Aucun événement temps réel n'atteint le Zem.** `revertOfferToPending` n'émet que `emitNewRequest` (vers la room `drivers`). Il n'émet **pas** `ride:status` ; et même s'il le faisait, `emitStatus` écrit dans la room `ride:{id}`, que le Zem **n'a pas rejointe** (il ne fait `ride:join` qu'une fois la course confirmée).
3. **La room `user:{userId}` n'est rejointe que dans le gestionnaire `ride:join`** (ligne ~140 de `rides.gateway.ts`), donc un Zem en attente n'y est pas non plus.
4. **Aucune notification poussée** pour la fin de proposition : `NOTIFICATION_RIDE_OFFER_EXPIRED` et `NOTIFICATION_RIDE_DECLINED` sont écrites en base mais sans `sendPush: true` (seul `ride-offered`, côté client, envoie un push).
5. Rien ne permet au Zem de **retrouver sa proposition** s'il ferme et rouvre l'application : il n'existe pas de route « ma proposition en cours » ; le mobile devait déduire l'état de `GET /rides/history`, qui ne contient plus la course (le Zem n'y est plus rattaché).

### 2.2 Côté mobile (corrigé)

Le mobile relisait la course toutes les 3 s et **traitait toute erreur comme une coupure réseau** (« on réessaiera au prochain cycle »). Le `403` était donc ignoré à l'infini. Correctif fait dans l'application : un `403` / `404` pendant l'attente est maintenant interprété comme « la proposition est terminée » (message + retour au radar), et un délai de sécurité libère l'écran 12 s après la fin du compte à rebours. **Ce contournement fonctionne mais reste une devinette** : le mobile ne sait pas *pourquoi* c'est fini (refusé, expiré, retiré, ou course annulée). Les points ci-dessous donnent au Zem la vraie information.

## 3. Ce que le backend doit faire

### 3.1 Garder la trace des propositions (nouvelle table)

```prisma
model RideOffer {
  id        String    @id @default(uuid())
  rideId    String
  ride      Ride      @relation(fields: [rideId], references: [id], onDelete: Cascade)
  driverId  String
  status    String                       // OFFERED | APPROVED | DECLINED | EXPIRED | WITHDRAWN | CANCELLED
  offeredAt DateTime  @default(now())
  expiresAt DateTime
  endedAt   DateTime?
  @@index([driverId, status])
  @@index([rideId, driverId])
}
```
- Créer une ligne à chaque `accept` (mode confirmation).
- `approveDriver` → `APPROVED` ; `declineDriver` → `DECLINED` ; `withdrawOffer` → `WITHDRAWN` ; expiration (tâche et rattrapage) → `EXPIRED` ; annulation de la course par le client pendant `OFFERED` → `CANCELLED` ; tout en posant `endedAt = now`.
- `declinedDriverIds` peut rester, ou être remplacé par une lecture de cette table (`status IN (DECLINED, EXPIRED, WITHDRAWN)`).

### 3.2 `GET /rides/:id` ne doit plus répondre `403` à un Zem dont la proposition vient de finir

Autoriser, **en plus** du client et du Zem actuel, tout Zem qui possède une ligne `RideOffer` pour cette course **terminée il y a moins de 24 h**. Pour lui, renvoyer une **vue restreinte** (jamais la position, le téléphone ni le nom complet du client) :

```json
{
  "id": "…",
  "status": "PENDING",
  "driverId": null,
  "offerOutcome": "expired",
  "offerEndedAt": "2026-10-12T12:50:45.000Z"
}
```
- `offerOutcome` ∈ `approved | declined | expired | withdrawn | cancelled`.
- Si le client a confirmé ce Zem (`APPROVED`), la course est `MATCHED` avec `driverId` = ce Zem : réponse complète habituelle (déjà le cas).
- Si la course est `CANCELLED` : `status: "CANCELLED"`, `offerOutcome: "cancelled"`.
- Un Zem **sans** aucune ligne `RideOffer` pour cette course continue de recevoir `403`.
- Le mobile lit `offerOutcome` pour afficher le bon message : « Le client a choisi un autre Zem » (declined), « Le client n'a pas répondu à temps » (expired), « Proposition retirée », « Demande annulée par le client ».

### 3.3 Route « ma proposition en cours » (reprise après redémarrage)

```
GET /rides/offers/current        (rôle DRIVER)
→ 200 { "offer": { "rideId": "…", "status": "OFFERED", "expiresAt": "…", "ride": { …vue Zem, sans position du client… } } | null,
        "lastEnded": { "rideId": "…", "outcome": "declined", "endedAt": "…" } | null }
```
- `offer` = la proposition `OFFERED` non expirée de ce Zem (au plus une, voir `assertDriverIsFree`) ; `null` sinon.
- `lastEnded` = la dernière proposition terminée dans les **10 dernières minutes**, pour que l'application rouverte puisse expliquer ce qui est arrivé.
- À déclarer **avant** `@Get(":id")` dans le contrôleur.
- Le mobile l'appellera au démarrage de l'écran Zem et à chaque reconnexion.

### 3.4 Événements temps réel vers le Zem

1. À la connexion d'un socket authentifié (toute personne, pas seulement dans `ride:join`) : `client.join("user:" + userId)`.
2. Quand une proposition finit, émettre vers **`user:{driverId}`** :
   ```json
   event "ride:offer-ended"  { "rideId": "…", "outcome": "declined" | "expired" | "withdrawn" | "cancelled", "at": "…" }
   event "ride:offer-approved" { "rideId": "…" }      // le client a choisi ce Zem (MATCHED)
   ```
   Émettre aussi `ride:status { status: "MATCHED" }` vers `user:{driverId}` (en plus de la room de la course) quand le client confirme, pour que le Zem passe à la carte immédiatement.
3. Appels à ajouter dans : `declineDriver`, `withdrawOffer` (confirmation au Zem), `revertOfferToPending` (raison `expired`), `approveDriver`, annulation par le client.
4. Le mobile écoutera ces événements **et** gardera la relecture toutes les 3 s en secours.

### 3.5 Notifications poussées

- `NOTIFICATION_RIDE_APPROVED` (déjà `sendPush: true`) : garder.
- `NOTIFICATION_RIDE_OFFER_EXPIRED` et `NOTIFICATION_RIDE_DECLINED` : ajouter `sendPush: true` et `data: { event, rideId }` (déjà présents côté `data`) pour qu'un Zem hors de l'application soit prévenu.
- Texte de `NOTIFICATION_RIDE_DECLINED` : le corps est vide aujourd'hui (`""`) ; ajouter « Tu peux accepter une autre demande ».

### 3.6 Erreur claire quand la proposition est terminée

Quand le Zem (ou le client) appelle une action sur une proposition qui n'est plus `OFFERED` (`withdraw-offer`, `approve-driver`), répondre avec un code dédié : `409 { "code": "RIDE_OFFER_ENDED", "message": "La proposition est terminée" }` au lieu du `400 "Cette proposition n'est plus disponible"` générique. À ajouter dans `http-exception.filter.ts`.

## 4. Autres points à vérifier côté déploiement (cause possible du blocage en test)

1. **Le serveur Render exécute-t-il bien le dernier `main` ?** La tâche `RidesOfferExpiryTask` et `rides.requireClientApproval` doivent être présents. Vérifier dans les logs de démarrage la ligne `RidesOfferExpiryTask` et qu'aucun message `Offer expiry sweep error` n'apparaît.
2. **La migration `20261012110000_ride_offered_labels_profile` est-elle appliquée en production ?** Sans la valeur d'enum `OFFERED`, `accept` plante ; avec elle absente de la base, le statut ne peut pas être lu.
3. **Render met le service en veille** (offre gratuite) : un `setInterval` de 5 s ne tourne plus quand l'instance dort. Le rattrapage à la lecture (`expireOfferedIfNeeded`) existe déjà dans `findOne` : c'est pour cela que **§3.2 est essentiel** (le Zem doit pouvoir lire la course sans `403` pour déclencher et voir ce rattrapage).

## 5. Tests d'acceptation

1. Zem accepte, client ne répond pas pendant 45 s → `GET /rides/:id` (Zem) renvoie `200` avec `status: "PENDING"` et `offerOutcome: "expired"` (jamais `403`) ; le Zem reçoit `ride:offer-ended` et une notification poussée.
2. Client refuse (`decline-driver`) → même chose avec `offerOutcome: "declined"`.
3. Zem retire sa proposition → `offerOutcome: "withdrawn"` ; le client est prévenu.
4. Client confirme (`approve-driver`) → le Zem reçoit `ride:offer-approved` et `ride:status MATCHED` **sans** avoir rejoint la room de la course ; `GET /rides/:id` renvoie la course complète.
5. Client annule la course pendant `OFFERED` → `offerOutcome: "cancelled"`, `status: "CANCELLED"`.
6. Un Zem qui n'a **jamais** reçu de proposition sur cette course → `GET /rides/:id` = `403`.
7. `GET /rides/offers/current` : `offer` non nul pendant `OFFERED` ; `lastEnded` renseigné dans les 10 minutes qui suivent la fin ; tout est `null` ensuite.
8. Les réponses restreintes (§3.2) ne contiennent ni `clientLat`, ni téléphone, ni nom complet.
9. Appeler `approve-driver` sur une proposition expirée → `409` avec `code: "RIDE_OFFER_ENDED"`.
10. Redémarrer l'application du Zem pendant `OFFERED` → au retour, `GET /rides/offers/current` restitue la proposition et son compte à rebours.

## 6. Ce que fait le mobile (contrat)

| Situation | Mobile aujourd'hui | Mobile après livraison de ce document |
|---|---|---|
| Fin de proposition, `GET /rides/:id` → 403/404 | Considère la proposition terminée (message générique) | Lit `offerOutcome` et affiche le bon message |
| Événements `ride:offer-ended` / `ride:offer-approved` | Ignorés | Écoutés : écran mis à jour instantanément |
| Réouverture de l'application pendant `OFFERED` | Retrouve la proposition seulement si l'historique la contient | Appelle `GET /rides/offers/current` |
| Notification de fin de proposition | Aucune push | Reçoit la push et ouvre le radar |
