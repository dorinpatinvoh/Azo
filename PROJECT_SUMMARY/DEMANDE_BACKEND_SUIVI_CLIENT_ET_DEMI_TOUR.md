# Demande backend — voir le client sur la carte du Zem, et fiabiliser le suivi pendant un demi-tour

Date : 10 octobre 2026 · Branche de référence : `main` · Modules : `azo-backend/src/rides/rides.gateway.ts`, `rides.service.ts`, `prisma/schema.prisma`

Suite de [`DEMANDE_BACKEND_SUIVI_POSITION.md`](./DEMANDE_BACKEND_SUIVI_POSITION.md) (position du Zem → client, déjà corrigée côté gateway).

Ce document décrit deux demandes. Chacune explique ce qui est constaté, ce que fait le code aujourd'hui, ce que le backend doit fournir, et le contrat que l'application mobile utilisera.

---

## Demande A — Le Zem doit voir le client, comme le client voit le Zem

### A.1 Constat

Le client voit le curseur du Zem bouger sur sa carte. L'inverse n'existe pas : **le Zem ne voit jamais la position du client**, seulement un point fixe (le lieu de départ choisi à la commande). Si le client se déplace vers un point de rencontre plus pratique, le Zem ne le sait pas.

### A.2 Ce qui manque aujourd'hui

1. **Aucun événement `client:location`.** Le gateway n'accepte que `driver:location` (`rides.gateway.ts`, ~ligne 66).
2. **L'application du Zem ne rejoint jamais la room de la course.** Elle ne fait aucun `ride:join` (0 occurrence dans `DriverHomeScreen.tsx`) : seul le client le fait. Même si le serveur émettait la position du client dans la room `ride:<id>`, le Zem ne la recevrait pas. Le handler `ride:join` accepte déjà `driverId`, donc **aucun changement serveur n'est nécessaire pour ce point** : c'est une correction côté mobile (voir A.5).
3. **L'écran de suivi du client ne lit pas son propre GPS** (`LiveTrackingScreen.tsx` n'utilise pas `expo-location`). Côté mobile aussi (A.5).

### A.3 Ce que le backend doit fournir

#### Nouvel événement `client:location` (client → serveur)

```ts
@SubscribeMessage("client:location")
async clientLocation(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { rideId?: string; lat?: number; lng?: number; accuracy?: number }
) {
  const userId = client.data?.user?.userId;
  // mêmes contrôles de forme que driver:location (userId, rideId, lat/lng finis, |lat|≤90, |lng|≤180)
  const ride = await this.prisma.ride.findUnique({
    where: { id: data.rideId },
    select: { clientId: true, status: true },
  });
  if (!ride || ride.clientId !== userId) return;                       // seul LE client de CETTE course
  if (!["MATCHED", "ARRIVED"].includes(ride.status)) return;           // voir A.4 pour IN_PROGRESS
  this.server.to(`ride:${data.rideId}`).emit("client:location", {
    lat: data.lat, lng: data.lng,
    ...(Number.isFinite(data.accuracy) ? { accuracy: Math.round(data.accuracy) } : {}),
    at: Date.now(),
  });
}
```

Même schéma que `driver:location` : vérification d'appartenance **en base** (pas via le rôle du jeton, cf. demande précédente), relais dans la room privée uniquement.

#### Règles de confidentialité (à respecter)

- La position du client n'est visible **que par le Zem de la course**, et **seulement tant que la course est active** (`MATCHED`, `ARRIVED`). Dès `COMPLETED` ou `CANCELLED`, le serveur ignore tout nouvel envoi.
- Ne pas écrire cette position en base au-delà de la dernière valeur utile (voir B.2), et l'effacer à la fin de la course.
- Le Zem ne reçoit jamais le numéro ni l'identité du client par ce canal : uniquement `lat`, `lng`, `accuracy`, `at`.

### A.4 Question de produit à trancher avec l'équipe

Pendant `IN_PROGRESS`, le client est sur la moto : sa position est celle du Zem. L'émettre double la consommation de batterie du téléphone du client pour une information redondante. **Proposition : `client:location` seulement en `MATCHED` et `ARRIVED`.** Si l'équipe veut l'écart client/Zem comme contrôle de cohérence pendant la course, ajouter `IN_PROGRESS` à la liste ci-dessus.

### A.5 Contrat côté mobile (à faire en parallèle, pas pour le backend)

- **Client** (`LiveTrackingScreen.tsx`) : tant que le statut est `MATCHED` ou `ARRIVED`, lire le GPS (`watchPositionAsync`, ~3 s ou 5 m) et émettre `socket.emit("client:location", { rideId, lat, lng, accuracy })`.
- **Zem** (`DriverHomeScreen.tsx`) : faire `socket.emit("ride:join", { rideId })` à la connexion et à chaque nouvelle course, écouter `client:location`, afficher un marqueur « Client » (vert) qui bouge sur sa carte, en plus du point de départ.

---

## Demande B — Suivi fiable pendant un demi-tour (client et Zem ensemble)

### B.1 Constat

Pendant la course, quand le Zem et le client **font demi-tour pour retourner au point de départ**, les curseurs et le tracé ne sont **pas bien suivis** sur les cartes : curseur qui saute ou prend du retard, tracé qui disparaît ou pointe dans la mauvaise direction.

### B.2 Causes probables (lecture du code, **à confirmer par un test de terrain**)

Je n'ai pas pu reproduire un demi-tour réel avec deux téléphones. Les causes ci-dessous viennent de la lecture du code et sont classées de la plus probable à la moins probable. Le backend est concerné par les deux premières.

1. **Le serveur ne garde aucune position.** `driver:location` est relayé puis oublié (aucune écriture, aucune colonne). Conséquences : un client qui rejoint ou se reconnecte en plein trajet n'a **rien** à afficher tant que le Zem n'a pas émis à nouveau ; lors d'un demi-tour (ralentissement, arrêt, GPS plus lent), il peut s'écouler plusieurs secondes sans nouveau point, et le curseur semble figé puis saute.
2. **Chaque téléphone calcule l'itinéraire lui-même sur le serveur public OSRM**, recalculé à chaque déplacement. Un demi-tour change complètement l'itinéraire, donc déclenche un recalcul ; le serveur public est limité en débit. **En cas d'erreur, l'application efface le tracé** (`LiveTrackingScreen.tsx` : `setDriverRoute(null)` dans le `catch`). Le tracé disparaît alors précisément quand la direction change.
3. **Ordre et fraîcheur des positions non garantis.** Rien n'empêche qu'une position plus ancienne arrive après une plus récente (réseau mobile instable) : le curseur recule brièvement. Le champ `at` existe (`Date.now()` côté serveur, `rides.gateway.ts` ~ligne 103) mais il est estampillé à la réception, pas à l'émission.
4. **Cap (`heading`) instable à faible vitesse.** Pendant un demi-tour, la vitesse tombe, le cap GPS devient invalide (le mobile l'ignore s'il n'est pas dans `[0, 360[`) : la flèche disparaît ou tourne. C'est surtout un sujet mobile, mais le backend peut relayer la **vitesse** pour aider (voir B.3).
5. **Distance et prix** : le prix est calculé **à la commande**, sur l'itinéraire estimé. Un demi-tour change la distance réelle, mais pas le prix. Ce n'est pas un bug de suivi : c'est une **question de produit** (voir B.5).

### B.3 Ce que le backend doit fournir

#### B.3.1 Conserver la dernière position (priorité 1)

Ajouter des colonnes sur `Ride` (migration Prisma) :

```prisma
model Ride {
  // …
  driverLat       Float?
  driverLng       Float?
  driverHeading   Int?
  driverSpeed     Float?      // m/s, si fourni
  driverLocatedAt DateTime?
  clientLat       Float?
  clientLng       Float?
  clientLocatedAt DateTime?
}
```

- Écrire à **au plus une fois toutes les 5 secondes par course** (limitation en mémoire, `Map<rideId, timestamp>`), pas à chaque point GPS, pour ne pas saturer la base.
- Remettre à `null` à `COMPLETED` / `CANCELLED`.
- **Exposer cette position de deux façons** :
  1. dans l'accusé de `ride:join` : `{ joined, messages, driverLocation?, clientLocation? }` — le client qui se (re)connecte voit tout de suite le Zem ;
  2. dans `GET /rides/:id` : `driverLocation: { lat, lng, heading?, at }` pour le client, `clientLocation` pour le Zem. Le client interroge déjà cette route toutes les 3 s : c'est un **filet de sécurité si le socket tombe**.

#### B.3.2 Fiabiliser l'ordre des positions (priorité 1)

- Accepter un champ `ts` (horodatage d'émission, en ms) envoyé par le mobile ; l'inclure dans le message relayé (`at: ts`), avec repli sur `Date.now()` si absent ou aberrant (plus d'une minute dans le futur).
- **Ignorer** toute position dont `ts` est plus ancien que la dernière relayée pour cette course.

#### B.3.3 Relayer la vitesse (priorité 3)

Accepter et relayer `speed` (m/s) et `accuracy` (m) quand ils sont fournis, avec la même validation que les coordonnées. Le mobile s'en servira pour masquer la flèche de cap quand la vitesse est quasi nulle.

#### B.3.4 Service d'itinéraire côté serveur (priorité 2, peut suivre dans un second temps)

Nouvelle route `GET /rides/:id/route`, réservée au client et au chauffeur de la course :

- calcule l'itinéraire de la **dernière position connue du Zem** vers l'étape en cours (point de départ en `MATCHED`, destination en `IN_PROGRESS`), via OSRM (déjà utilisé dans `rides.service.ts`, `drivingRoute`) ;
- **met en cache** le résultat quelques secondes, avec une clé arrondie (~50 m) et l'étape ;
- si OSRM échoue, **renvoie le dernier itinéraire valide** au lieu d'une erreur ;
- renvoie `{ coordinates: [{latitude, longitude}], distanceKm, durationMinutes, computedAt }`.

Cela remplace les deux appels OSRM faits par chaque téléphone, évite la limite de débit du serveur public, et supprime la cause n°2. À terme, héberger sa propre instance OSRM ou utiliser un fournisseur payant.

### B.4 Contrat côté mobile (à faire en parallèle)

- Émettre `ts: Date.now()`, `speed` et `accuracy` avec chaque `driver:location` / `client:location`.
- Au `ride:join`, utiliser `driverLocation` de l'accusé pour afficher immédiatement le Zem.
- Ne plus effacer le tracé quand un recalcul échoue : garder le dernier tracé valide.
- Ignorer les positions dont `at` est plus ancien que celle déjà affichée.
- Masquer la flèche de cap quand `speed` est inférieur à ~1 m/s.
- Plus tard : lire `GET /rides/:id/route` à la place d'OSRM.

### B.5 Question de produit (hors correctif)

Quand le client demande au Zem de repartir au point de départ en cours de course, **le prix doit-il changer ?** Aujourd'hui il est figé à l'estimation initiale. Options : conserver le prix initial, ou recalculer à la fin d'après la distance réellement parcourue (cela suppose d'**enregistrer la trajectoire** de la course, ce que B.3.1 ne fait pas : une seule dernière position). À décider avant de toucher au code de paiement (`RidesService.settle`).

---

## Tests à ajouter (Jest)

Dans `azo-backend/test/`, dans le style de `rides-gateway.spec.ts` :

1. `client:location` : émis dans la room pour le client de la course en `MATCHED` et `ARRIVED`.
2. `client:location` : **rien d'émis** pour un autre utilisateur, pour le chauffeur, pour une course `PENDING`, `COMPLETED` ou `CANCELLED`, ou avec des coordonnées invalides.
3. `driver:location` : une position avec un `ts` plus ancien que la précédente est ignorée.
4. Persistance : au plus une écriture toutes les 5 s par course ; remise à `null` à la fin de la course.
5. `ride:join` renvoie `driverLocation` / `clientLocation` quand elles existent, et ne renvoie jamais la position de l'autre à un non-participant.
6. `GET /rides/:id/route` (si B.3.4) : renvoie le dernier itinéraire valide quand OSRM échoue ; refuse un non-participant.

## Critères d'acceptation

- [ ] Le Zem voit sur sa carte un marqueur « Client » qui bouge tant que la course est `MATCHED` ou `ARRIVED`, et il disparaît à `IN_PROGRESS` (sauf décision A.4).
- [ ] Un utilisateur qui n'est pas le client de la course ne peut pas émettre `client:location`.
- [ ] La position du client n'est plus relayée ni conservée après la fin ou l'annulation de la course.
- [ ] Un client qui ouvre le suivi en cours de trajet voit le Zem **immédiatement**, sans attendre la prochaine émission.
- [ ] Pendant un demi-tour, les curseurs ne reculent pas et le tracé ne disparaît pas.
- [ ] `npm run build` et `npm test -- --runInBand` passent.
- [ ] Migration Prisma relue et versionnée (`npx prisma migrate dev --name ride_live_positions` en local, puis `migrate deploy` ailleurs).

## Ordre de travail proposé

1. **B.3.1 + B.3.2** (dernière position, ordre) : corrige la cause la plus probable du demi-tour et sert de base à A.
2. **A.3** (`client:location`) + côté mobile A.5.
3. **B.3.3** (vitesse, précision).
4. **B.3.4** (itinéraire serveur), si le test de terrain montre que la limite d'OSRM est bien en cause.
