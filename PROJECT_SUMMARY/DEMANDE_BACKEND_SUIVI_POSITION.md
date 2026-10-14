# Demande backend — la position du Zem n'arrive pas au client

Date : 10 octobre 2026 · Branche de référence : `main` (`83685b28`) · Module : `azo-backend/src/rides/rides.gateway.ts`

## 1. Le problème, vu de l'application

Pendant une course, **le client ne voit jamais le curseur du Zem bouger sur la carte** :

- quand le Zem vient vers le client (statut `MATCHED`) ;
- une fois arrivé (`ARRIVED`) ;
- pendant le trajet vers la destination (`IN_PROGRESS`).

Le curseur reste absent ou figé. Pourtant, côté Zem, tout le reste marche : accepter, « Je suis arrivé », code de départ, « Terminer », code d'arrivée.

## 2. Cause probable (à confirmer, voir §5)

Le backend lit le **rôle** de l'utilisateur de deux façons différentes.

| Canal | Où | D'où vient le rôle |
|---|---|---|
| HTTP (accept, arrive, start, finish…) | `src/auth/jwt.strategy.ts`, `validate()` | **Base de données**, relue à chaque requête |
| Socket.IO (`driver:location`, `ride:chat`) | `src/rides/rides.gateway.ts`, `handleConnection()` ligne ~43 | **Contenu du jeton JWT**, figé à la connexion |

Dans `driver:location` (ligne ~74), le gateway fait :

```ts
if (!user?.userId || user.role !== "DRIVER" || ...) return;   // silencieux
```

Or un prestataire s'inscrit comme `CLIENT`, dépose son dossier, puis un admin l'approuve (`role` passe à `DRIVER` **en base**). L'application l'envoie alors dans l'espace chauffeur **sans nouvelle connexion** (`App.tsx` → `onEnterWorkspace`) : il garde son ancien jeton, qui dit toujours `role: "CLIENT"`.

Conséquence : les appels HTTP du Zem réussissent (rôle relu en base), mais **toutes ses positions sont ignorées sans erreur** par le socket. Le client ne reçoit rien.

Même défaut dans `ride:chat` (ligne ~123) : `client.data.user.role === "DRIVER"` est lu dans le jeton, donc un Zem fraîchement approuvé est étiqueté « client » dans la messagerie.

## 3. Correctif demandé

### 3.1 `driver:location` : ne plus dépendre du rôle du jeton

La vérification qui compte est déjà là : `ride.driverId === user.userId`. Seul un utilisateur à qui `POST /rides/:id/accept` (protégé par `@Roles(DRIVER)` et relu en base) a attribué la course peut être `driverId`. Le contrôle de rôle sur le jeton est donc redondant et c'est lui qui casse.

```ts
// rides.gateway.ts — driver:location
const userId = client.data?.user?.userId;
if (
  !userId ||
  !data?.rideId ||
  typeof data.lat !== "number" || typeof data.lng !== "number" ||
  !Number.isFinite(data.lat) || !Number.isFinite(data.lng) ||
  Math.abs(data.lat) > 90 || Math.abs(data.lng) > 180
) return;

const ride = await this.prisma.ride.findUnique({
  where: { id: data.rideId },
  select: { driverId: true, status: true },
});
if (!ride || ride.driverId !== userId || !["MATCHED", "ARRIVED", "IN_PROGRESS"].includes(ride.status)) return;
// ... émission inchangée (heading, room `ride:${rideId}`)
```

Supprimer `user.role !== "DRIVER"` de la condition. Ne rien changer d'autre : la room privée, la validation des coordonnées et le filtre sur les statuts actifs restent identiques.

### 3.2 `ride:chat` : déduire le rôle de la course

Remplacer le calcul de `role` à partir du jeton par une comparaison avec la course :

```ts
const ride = await this.prisma.ride.findUnique({
  where: { id: data.rideId },
  select: { clientId: true, driverId: true },
});
if (!ride || (ride.clientId !== userId && ride.driverId !== userId)) return;   // aussi : fermer l'envoi sans appartenance
const role = ride.driverId === userId ? "PROVIDER" : "CLIENT";
```

Aujourd'hui `onChat` n'exige même pas que l'expéditeur participe à la course (`senderId` peut valoir `"anon"`) : à fermer dans la même retouche.

### 3.3 À ne pas faire

- Ne pas forcer une reconnexion de l'utilisateur à l'approbation : le correctif backend suffit.
- Ne pas retirer la vérification `ride:join` (client ou chauffeur de la course seulement).

## 4. Contrat avec l'application mobile (aucun changement front nécessaire)

**Chauffeur** (`azo-mobile/screens/DriverHomeScreen.tsx`)

- Connexion : `io(API_URL, { transports: ["websocket"], auth: { token } })`, ouverte quand le chauffeur est « en ligne ».
- Envoi : `socket.emit("driver:location", { rideId, lat, lng, heading? })`.
- Cadence pendant une course : toutes les ~2,5 s **ou** tous les 5 m (GPS haute précision, premier plan seulement). Hors course : 10 s ou 25 m.
- Renvoyée aussi à la (re)connexion du socket.

**Client** (`azo-mobile/screens/LiveTrackingScreen.tsx`)

- Connexion : même méthode, puis `socket.emit("ride:join", { rideId })` à `connect`.
- Réception : `socket.on("driver:location", { lat, lng, heading?, at })` met à jour le curseur du Zem et recalcule l'itinéraire OSRM.
- Réception : `socket.on("ride:status", { rideId, status })` met à jour le statut.
- Le suivi de la carte (`OSMMapView`) suit le marqueur `driver` pour les statuts `MATCHED`, `ARRIVED` et `IN_PROGRESS`.

Les noms d'événements et les charges utiles ne changent pas.

## 5. Comment reproduire et confirmer

1. Créer un compte **client**, se connecter (jeton à `role: CLIENT`).
2. Déposer un dossier chauffeur ; un admin l'approuve. **Ne pas se reconnecter.**
3. Avec un second compte client, commander un Zem ; le premier compte accepte la course.
4. Constat attendu **avant correctif** : le client ne reçoit aucun `driver:location`.
5. Contre-test : sur le téléphone du Zem, se déconnecter puis se reconnecter (nouveau jeton à `role: DRIVER`) → les positions arrivent. **Si ce contre-test réussit, la cause est confirmée.**

## 6. Tests à ajouter (Jest)

Dans `azo-backend/test/`, un test du gateway avec Prisma simulé, dans le style de `rides-arrival.spec.ts` :

1. Socket dont le jeton dit `role: "CLIENT"` mais `ride.driverId === userId`, course `IN_PROGRESS` → l'événement `driver:location` est bien émis dans la room `ride:<id>`.
2. Utilisateur différent de `ride.driverId` → rien n'est émis.
3. Course `PENDING`, `COMPLETED` ou `CANCELLED` → rien n'est émis.
4. Coordonnées invalides (`NaN`, lat > 90) → rien n'est émis.
5. Chat : un participant est étiqueté `PROVIDER` ou `CLIENT` selon la course ; un non-participant ne peut pas écrire.

## 7. Critères d'acceptation

- [ ] Un Zem approuvé après sa connexion, **sans reconnexion**, voit son curseur apparaître chez le client dès `MATCHED`, le conserve en `ARRIVED` puis en `IN_PROGRESS`.
- [ ] Un utilisateur qui n'est pas le chauffeur de la course ne peut pas émettre de position.
- [ ] `npm run build` et `npm test -- --runInBand` passent.
- [ ] Aucune migration de base de données.

## 8. Points secondaires (hors périmètre, à noter)

- **Position non conservée** : elle n'est jamais écrite en base ; après un redémarrage du serveur ou une reconnexion du client, il faut attendre la prochaine émission du Zem.
- **Application du Zem au premier plan seulement** : écran verrouillé ou application en arrière-plan, le GPS s'arrête (aucune localisation en arrière-plan configurée). C'est une limite côté mobile, indépendante de ce correctif.
- **Chat en mémoire** (`chatStore`) : perdu au redémarrage du serveur.
- Le gateway n'écarte pas les comptes `BLOCKED` à la connexion socket (le HTTP le fait dans `jwt.strategy.ts`) : à aligner si possible.
