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

Pour une course Zem, après acceptation le client suit la position GPS du chauffeur sur la
carte avec un itinéraire routier et un ETA recalculés. Le chauffeur confirme **« Je suis
arrivé »** (`POST /rides/:id/arrive`) au point de prise en charge. Le statut passe alors à
`ARRIVED`, une notification système est tentée, et le code aléatoire à 4 chiffres devient
visible **uniquement au client**. Le démarrage (`POST /rides/:id/start`) exige ce statut et
le code correct; le serveur refuse toute tentative avant l'arrivée.

## 5. Notifications

| Événement | Destinataire | Message |
|---|---|---|
| Demande publiée | chauffeurs du bon véhicule (max `driverNotificationMax`) | « Nouvelle demande de course — ouvre ton radar pour la prendre. » |
| Course acceptée | client | « Chauffeur trouvé » (in-app) |
| Chauffeur arrivé (`ARRIVED`) | client | « Ton Zem est arrivé » (in-app + Expo Push système) |
| Course terminée | client + chauffeur | montant débité / gains du chauffeur |
| Demande expirée | client | « Aucun chauffeur trouvé… aucun montant débité — relance une recherche. » |
| Annulation | l'autre partie | « Le client a annulé » / « Ton chauffeur a annulé, recherche d'un nouveau chauffeur… » |

Les notifications sont **enregistrées en base** (`Notification`) et affichées dans l'écran
**Notifications** de l'application (`GET /notifications`, `POST /notifications/read-all`). La
notification d'arrivée est aussi envoyée via l'API Expo Push aux appareils dont le jeton a été
enregistré (`POST /notifications/push-token`). L'envoi système est best-effort : il exige un
build natif (pas Expo Go Android) et des credentials FCM v1/APNs configurés dans EAS.

## 6. Temps réel

| Canal | Usage |
|---|---|
| `ride:new` (socket, diffusé à tous) | prévient les radars ouverts qu'une demande vient d'être publiée : ils se rafraîchissent sans attendre les 8 s du cycle. La charge utile ne contient **aucune donnée personnelle** (ni nom, ni numéro du client). |
| `ride:status` (socket, par course) | changement de statut poussé au client et au chauffeur concernés. |
| `driver:location` (socket, par course) | position du chauffeur envoyée au client pendant la course; elle sert à actualiser l'ETA et l'itinéraire OSRM. La room et les positions sont vérifiées côté serveur. |

En complément : le client recharge son suivi toutes les 3 s, le chauffeur son radar toutes les
8 s. C'est ce cycle qui garantit le fonctionnement même si le socket est indisponible.

## 7. Où le code vit

| Fichier | Rôle |
|---|---|
| `azo-backend/src/rides/radar.ts` | logique **pure** du radar : âge, expiration, distance (Haversine), rayon, classement |
| `azo-backend/src/rides/rides.service.ts` | radar, expiration, arrivée, code aléatoire et démarrage sécurisé |
| `azo-backend/src/rides/rides.controller.ts` | endpoints ride dont `POST /rides/:id/arrive` et le démarrage protégé par code |
| `azo-backend/src/rides/rides.gateway.ts` | positions GPS et statuts Socket.IO, rooms privées par course |
| `azo-backend/src/notifications/notifications.module.ts` | inbox, jetons Expo par appareil et envoi push |
| `azo-backend/prisma/schema.prisma` | statut `ARRIVED`, heure d'arrivée, code de prise en charge et jetons push |
| `azo-mobile/screens/DriverHomeScreen.tsx` | bouton « Je suis arrivé », puis saisie du code client |
| `azo-mobile/screens/LiveTrackingScreen.tsx` | ETA live, itinéraire routier, bannière d'arrivée et code client |
| `azo-mobile/services/routing.ts` | route/ETA OSRM, avec repli quand l'API est indisponible |
| `azo-mobile/services/pushNotifications.ts` | permission système et enregistrement du jeton Expo |
| `azo-mobile/screens/NotificationsScreen.tsx` | écran Notifications (liste, non lus, « tout marquer lu », rafraîchissement) |

## 8. Points connus / chantiers ouverts

1. **Push système** : l'envoi à l'arrivée est implémenté via Expo Push. La livraison réelle
   nécessite le project ID EAS, un build natif et les credentials FCM v1/APNs; Expo Go Android
   ne prend pas en charge les push distants depuis le SDK 53.
2. **Position du chauffeur non conservée** : elle est envoyée en temps réel par Socket.IO, mais
   la dernière position n'est pas stockée en base. Un dispatch serveur « au plus proche »
   demanderait de l'enregistrer.
3. **Itinéraire OSRM best-effort** : le service public gratuit peut être indisponible ou limiter
   le trafic; l'app revient alors à la distance directe et à une ETA approximative.
4. **Expiration paresseuse** : les demandes expirées sont annulées quand un radar ou un client
   recharge — il n'y a pas de tâche planifiée.
5. **Rayon et délai uniques** : les mêmes valeurs s'appliquent à tous les véhicules (une seule
   section `radar` dans la configuration).
