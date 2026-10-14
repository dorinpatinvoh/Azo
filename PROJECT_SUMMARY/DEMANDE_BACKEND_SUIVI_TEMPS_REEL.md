# Demande backend — suivi en temps réel, à la seconde, du Zem et du client

Date : 12 octobre 2026 · Priorité : moyenne (le suivi fonctionne déjà ; ce sont des améliorations de fluidité et de robustesse) · Module : `azo-backend/src/rides/rides.gateway.ts`

Le mobile est **déjà adapté** (voir §3). Rien n'est bloquant : sans ces changements le suivi marche, mais sans le cap du client et sans protection contre un envoi trop fréquent. Ce document décrit les trois petits changements demandés au backend.

## 1. Ce que veut le produit

**Sur la carte du Zem** (avant la prise en charge) :
- sa propre position, mise à jour toutes les secondes ;
- la position du **client en mouvement**, mise à jour toutes les secondes ;
- le point de départ.

**Sur la carte du client** :
- la position du **Zem**, mise à jour toutes les secondes ;
- sa **propre position**, mise à jour toutes les secondes ;
- le point de départ.

## 2. Ce qui existe déjà côté backend (vérifié dans le code actuel)

| Fonction | Où | État |
|---|---|---|
| Position du Zem relayée au client, immédiatement | `driver:location` → room `ride:<id>` | ✅ en `MATCHED`, `ARRIVED`, `IN_PROGRESS` |
| Position du client relayée au Zem, immédiatement | `client:location` → room `user:<driverId>` | ✅ en `MATCHED` et `ARRIVED` seulement |
| Dernière position conservée en base | `LOCATION_PERSIST_INTERVAL_MS = 5 000` | ✅ une écriture au plus toutes les 5 s par course |
| Dernière position renvoyée à la connexion | accusé de `ride:join` (`driverLocation`, `clientLocation`) | ✅ |
| Positions plus anciennes ignorées | comparaison de `ts` | ✅ |
| Horodatage envoyé au mobile | champ `at` | ✅ |

Le relais n'applique aucune pause artificielle : **la cadence d'une seconde ne demande aucun changement pour fonctionner**.

## 3. Ce que fait le mobile maintenant (pour que le backend sache à quoi s'attendre)

- **Cadence** : le Zem et le client envoient leur position **à chaque point GPS, soit environ 1 par seconde** (un point par seconde ou tous les 2 m), et **renvoient la dernière position toutes les 2 s** quand ils sont immobiles. Cela fait **environ 2 messages par seconde et par course active** (un par participant).
- **Client** : son GPS tourne dès que la course est active (recherche, approche, trajet) pour afficher **sa propre position sur sa carte** ; il n'envoie `client:location` qu'en `MATCHED` et `ARRIVED`, car c'est tout ce que le serveur accepte.
- **Données envoyées avec chaque position** : `rideId`, `lat`, `lng`, `ts`, `accuracy` et, **nouveau**, `heading` (cap en degrés) et `speed` (m/s) pour le client, quand le téléphone les fournit.
- **Cadrage des cartes** : avant la prise en charge, chaque carte garde **les trois points visibles** (soi, l'autre participant, le départ) et ne se recadre que si l'un approche du bord ; pendant le trajet, la caméra suit le Zem.
- **Affichage du cap du client** : si le serveur relaie `heading` et `speed`, le Zem voit une flèche de direction sur le point du client **uniquement quand celui-ci avance** (vitesse ≥ 1 m/s). Sans ces champs, le point s'affiche sans flèche : aucune erreur.

## 4. Changements demandés au backend

### B1. Relayer `heading` et `speed` dans `client:location` *(petit, utile)*

Aujourd'hui `LiveLocationPayload` contient déjà `heading` et `speed`, mais le relais du client ne transmet que :

```ts
// rides.gateway.ts, handler client:location
this.server?.to(`user:${ride.driverId}`).emit("client:location", {
  lat: data.lat, lng: data.lng,
  ...(accuracy !== undefined ? { accuracy: Math.round(accuracy) } : {}),
  at,
});
```

À faire : valider et relayer `heading` et `speed` exactement comme dans `driver:location` (`validHeading`, `validNonNegative` existent déjà), sans les conserver en base (inutile pour le client).

### B2. Limiter la cadence d'envoi *(protection)*

Le mobile envoie maintenant environ une position par seconde, et rien n'empêche un client modifié d'en envoyer des centaines par seconde, relayées à tous les participants de la course. Demandé :

- ignorer sans erreur tout message `driver:location` ou `client:location` arrivant moins de **~400 ms** après le précédent **pour la même course et le même émetteur** (le mobile ne dépasse jamais 1 par seconde en usage normal, la marge est large) ;
- écarter les positions physiquement impossibles (saut de plusieurs kilomètres en une seconde) — un filtre de vitesse plausible comme celui proposé pour le compteur de distance.

### B3. Vérifier la charge *(mesure)*

Avec ~2 messages par seconde par course active, **vérifier qu'aucune requête base de données n'est faite à chaque message** : l'appartenance à la course, le statut et l'identité du chauffeur doivent venir du cache mémoire par course (`rideLocationContexts`, déjà présent) pour `driver:location` **et** `client:location`. Invalider ce cache aux changements de statut. À mesurer sur une vingtaine de courses simultanées avant de communiquer sur l'objectif « à la seconde ».

### B4. Optionnel : signaler la perte de signal de l'autre participant

Si le téléphone de l'autre participant se déconnecte (réseau coupé, application fermée), l'autre carte montre un point figé sans explication. Proposition : émettre un événement `ride:peer-offline { rideId, role, at }` à la déconnexion du socket d'un participant, et `ride:peer-online` à son retour. Le mobile pourra alors afficher « Position perdue depuis X s ». **À implémenter plus tard** : le mobile ne l'attend pas encore.

## 5. À ne PAS changer

- `client:location` reste **limité à `MATCHED` et `ARRIVED`** : sur la moto, le client est au même endroit que le Zem, inutile de consommer la batterie et le réseau.
- La conservation en base **toutes les 5 s** reste suffisante (elle ne sert qu'à la reconnexion).

## 6. Tests à ajouter (Jest)

1. `client:location` avec `heading` et `speed` valides → le Zem reçoit `lat`, `lng`, `heading`, `speed`, `at`.
2. `heading` hors de `[0, 360[` ou `speed` négatif → ces champs sont omis, la position est relayée.
3. Deux messages du même émetteur espacés de moins de 400 ms → le second est ignoré ; espacés de plus → relayé.
4. Un saut de position impossible → ignoré.
5. Un message de l'autre participant n'est pas ralenti par la limite de la même course (la limite est par émetteur).

## 7. Critères d'acceptation

- [ ] Le Zem voit le client avancer sur sa carte, avec une flèche de direction quand il marche.
- [ ] Un client modifié qui envoie 100 positions par seconde ne provoque que ~2 à 3 relais par seconde.
- [ ] Aucune requête base de données par message de position.
- [ ] `npm run build` et `npm test -- --runInBand` passent.

## 8. Limite connue côté mobile (hors backend)

Le GPS du Zem ne tourne qu'**écran allumé et application au premier plan** : téléphone verrouillé ou en poche, plus aucune position n'est envoyée, quel que soit le serveur. C'est le point A8 de [`DEMANDE_BACKEND_PRIX_AU_KILOMETRE_ET_CARTES.md`](./DEMANDE_BACKEND_PRIX_AU_KILOMETRE_ET_CARTES.md) : il demande une localisation en arrière-plan côté application (nouveau build natif), pas un changement du backend.
