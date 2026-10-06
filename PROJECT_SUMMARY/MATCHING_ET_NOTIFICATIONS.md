# Matching des courses & notifications — AZƆ̀

Document de référence du **radar des demandes**, du **matching par proximité** et des
**notifications** (mise à jour du 6 octobre 2026). Barèmes : [`TARIFICATION.md`](./TARIFICATION.md) —
parcours client : [`PARCOURS_ZEM.md`](./PARCOURS_ZEM.md), [`PARCOURS_VOITURE.md`](./PARCOURS_VOITURE.md).

## 1. Principe

Le matching AZƆ̀ reste un **matching par tirage (pull)** : le chauffeur interroge le serveur,
c'est le serveur qui décide ce qu'il peut voir. Aucun envoi direct de course n'existe — un
chauffeur ne peut donc jamais se voir attribuer une course malgré lui.

Trois règles décident de ce qu'un chauffeur voit dans son radar :

1. **Son véhicule** — `GET /rides/pending` ne renvoie que les demandes du véhicule déclaré dans
   son dossier validé (Zem essence ≠ Zem électrique ; Gazelle ≠ Koala ≠ Léopard ; un coursier ne
   reçoit aucune demande de transport).
2. **Sa position** — quand l'application transmet la position du chauffeur
   (`GET /rides/pending?lat=…&lng=…`), les demandes situées **au-delà du rayon de recherche**
   sont écartées, et les autres sont classées **de la plus proche à la plus lointaine**.
3. **Le temps** — une demande sans chauffeur **expire** au bout du délai configuré : elle
   disparaît du radar et est **annulée automatiquement**, sans aucun débit client.

## 2. Réglages (source unique `tarification.json`)

```json
"radar": {
  "strictVehicleMatch": true,
  "searchRadiusKm": 8,
  "pendingExpiryMinutes": 20,
  "driverNotificationMax": 30
}
```

| Réglage | Rôle | Valeur par défaut | Effet d'une valeur à 0 |
|---|---|---|---|
| `strictVehicleMatch` | correspondance exacte du véhicule | `true` | — (booléen) |
| `searchRadiusKm` | rayon de recherche autour du chauffeur, en km | `8` | `0` = **aucune limite** |
| `pendingExpiryMinutes` | délai avant annulation d'une demande sans chauffeur | `20` | minimum appliqué : 1 min |
| `driverNotificationMax` | chauffeurs prévenus à la publication d'une demande | `30` | — |

Ces valeurs sont **validées au démarrage** (nombres positifs, entier ≥ 1 pour le plafond de
notifications) et s'appliquent **sans redéploiement de code** : il suffit de modifier
`tarification.json` puis de resynchroniser l'application (`npm run sync:tarification`).

Sans position connue (GPS refusé, téléphone sans GPS), le radar reste utilisable : aucune
demande n'est écartée et le classement se fait **du plus ancien au plus récent**.

## 3. Ce que reçoit l'application

Chaque demande du radar porte, en plus de ses champs habituels :

| Champ | Signification |
|---|---|
| `distanceKm` | distance entre la position transmise et le point de départ (km, 1 décimale) ; `null` sans position |
| `ageMinutes` | depuis combien de minutes la demande attend |
| `expiresInMinutes` | minutes restantes avant annulation (0 = expire) |

Côté client, `GET /rides/:id` renvoie `expiresInMinutes` tant que la demande attend, puis
`expired: true` **au moment où le serveur l'annule** (le client voit immédiatement pourquoi sa
course s'est arrêtée).

## 4. Déroulé d'une demande

```
CLIENT                        SERVEUR                         CHAUFFEURS
  │  POST /rides                 │                                  │
  │─────────────────────────────►│  crée la course (PENDING)        │
  │                              │  + notifie les chauffeurs        │
  │                              │    du bon véhicule (max 30)      │
  │                              │  + diffuse « ride:new » (socket) │
  │                              │                                  │
  │                              │◄── GET /rides/pending?lat&lng ───│
  │                              │    rayon + tri par distance      │
  │                              │    + annule les demandes         │
  │                              │      expirées (aucun débit)      │
  │                              │─────────────────────────────────►│
  │                              │◄──── POST /rides/:id/accept ─────│
  │  ◄── notification            │     (atomique : 1 seul chauffeur)│
  │      « Chauffeur trouvé »    │                                  │
  │                              │                                  │
  │  ... course, suivi, paiement ...                                │
  │◄── « Course terminée »   ◄───│───► « Paiement reçu »            │
```

## 5. Notifications

| Événement | Destinataire | Message |
|---|---|---|
| Demande publiée | chauffeurs du bon véhicule (max `driverNotificationMax`) | « Nouvelle demande de course — ouvre ton radar pour la prendre. » |
| Course acceptée | client | « Chauffeur trouvé » |
| Course terminée | client + chauffeur | montant débité / gains du chauffeur |
| Demande expirée | client | « Aucun chauffeur trouvé… aucun montant débité — relance une recherche. » |
| Annulation | l'autre partie | « Le client a annulé » / « Ton chauffeur a annulé, recherche d'un nouveau chauffeur… » |

Les notifications sont **enregistrées en base** (`Notification`) et affichées dans l'écran
**Notifications** de l'application (`GET /notifications`, `POST /notifications/read-all`) —
l'écran groupe les messages par jour, marque les non lus et se met à jour par glissement vers
le bas. **Aucune notification « push » système** (bannière hors application) n'est envoyée à ce
stade : l'application doit être ouverte sur le radar, où la demande apparaît en moins de
8 secondes — et **immédiatement** si la connexne temps réel est active.

## 6. Temps réel

| Canal | Usage |
|---|---|
| `ride:new` (socket, diffusé à tous) | prévient les radars ouverts qu'une demande vient d'être publiée : ils se rafraîchissent sans attendre les 8 s du cycle. La charge utile ne contient **aucune donnée personnelle** (ni nom, ni numéro du client). |
| `ride:status` (socket, par course) | changement de statut poussé au client et au chauffeur concernés. |
| `driver:location` (socket, par course) | position du chauffeur envoyée au client pendant la course. |

En complément : le client recharge son suivi toutes les 3 s, le chauffeur son radar toutes les
8 s. C'est ce cycle qui garantit le fonctionnement même si le socket est indisponible.

## 7. Où le code vit

| Fichier | Rôle |
|---|---|
| `azo-backend/src/rides/radar.ts` | logique **pure** du radar : âge, expiration, distance (Haversine), rayon, classement |
| `azo-backend/src/rides/rides.service.ts` | `pending()` (radar + balayage des expirées), `create()` (notifications + diffusion), `expireRide()`, `findOne()` (expiration paresseuse) |
| `azo-backend/src/rides/rides.controller.ts` | `GET /rides/pending?lat=…&lng=…` (position optionnelle validée) |
| `azo-backend/src/rides/rides.gateway.ts` | `emitNewRequest()` (`ride:new`), `emitStatus()` |
| `azo-backend/test/radar.spec.ts` | 15 tests : expiration, bornes, rayon, classement, distances réelles de Cotonou, cas limites |
| `azo-mobile/screens/DriverHomeScreen.tsx` | radar : envoi de la position, distance serveur, rayon affiché, rafraîchissement immédiat sur `ride:new` |
| `azo-mobile/screens/LiveTrackingScreen.tsx` | temps restant pendant la recherche, message dédié quand la demande a expiré |
| `azo-mobile/screens/NotificationsScreen.tsx` | écran Notifications branché sur le serveur (liste, non lus, « tout marquer lu », rafraîchissement) |

## 8. Points connus / chantiers ouverts

1. **Pas de notification « push » système** : l'application doit être ouverte sur le radar. Pour
   notifier un téléphone en veille, il faudra enregistrer un jeton Expo Push par appareil
   (`expo-notifications`) et envoyer via le service Expo — chantier distinct.
2. **Position du chauffeur non conservée** : elle est transmise à chaque interrogation du radar
   et n'est pas stockée en base. Un dispatch serveur « au plus proche » (sans que le chauffeur
   interroge) demanderait d'enregistrer la dernière position connue.
3. **Expiration paresseuse** : les demandes expirées sont annulées quand un radar ou un client
   recharge — il n'y a pas de tâche planifiée.
4. **Rayon et délai uniques** : les mêmes valeurs s'appliquent à tous les véhicules (une seule
   section `radar` dans la configuration).
