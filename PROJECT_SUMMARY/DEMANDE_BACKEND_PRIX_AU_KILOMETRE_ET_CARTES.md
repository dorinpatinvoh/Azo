# Demande backend — Prix au kilomètre réellement parcouru (course partielle, demi-tour) et fiabilité des cartes

Date : 11 octobre 2026 · Priorité : **haute** · Modules : `azo-backend/src/rides/rides.service.ts`, `rides.gateway.ts`, `rides.controller.ts`, `src/pricing/pricing.service.ts`, `prisma/schema.prisma`

Ce document a deux parties :

- **Partie 1 — Facturation à la distance parcourue** : quand la course s'arrête avant la destination (ou fait demi-tour), on ne paie que les kilomètres réellement faits, avec l'accord du client et du Zem.
- **Partie 2 — Audit des cartes** (client et Zem) : ce qui a été corrigé côté mobile, et ce que le backend doit fournir pour un suivi « à l'instant ».

Le front mobile est **déjà adapté** aux contrats décrits ici (voir §7) : il masque les nouvelles fonctions tant que le serveur ne renvoie pas les nouveaux champs, donc aucune régression avant la livraison du backend.

---

# Partie 1 — Prix au kilomètre réellement parcouru

## 1.1 La règle métier demandée

Tarif Zem, au kilomètre :

| Distance | Tarif |
|---|---|
| de 0 à 15 km | 70 F / km |
| de 16 à 24 km | 60 F / km |
| de 25 à 50 km | 50 F / km |

Le backend calcule le prix **à partir de la distance réellement parcourue**, au mètre près, au prorata :

- **1 km** parcouru → 70 F de kilomètres
- **1 km 500 m** → 70 F + (70 F / 2) = **105 F** de kilomètres
- **Demi-tour** : si le client et le Zem font 1 km 500 m puis reviennent au point de départ, ils ont parcouru 1 km 500 m **deux fois**. La distance cumulée est de 3 km → **(70 + 70/2) × 2 = 210 F** de kilomètres.
- L'arrêt anticipé se fait **avec l'accord du client et du Zem**.

> ✅ **DÉCISION (11 octobre 2026) — la base est due en cas d'arrêt anticipé.** Le prix d'une course partielle est **base + kilomètres parcourus**, exactement comme une course complète (« choix A », voir Q1). Les montants ci-dessus (70 F, 105 F, 210 F) sont donc la part « kilomètres » ; il faut y **ajouter la base du véhicule** : 150 F pour un Zem à essence, 100 F pour un Zem électrique.
>
> | Cas | Zem essence | Zem électrique |
> |---|---|---|
> | 1 km | 150 + 70 = **220 F** | 100 + 70 = **170 F** |
> | 1 km 500 m | 150 + 105 = **255 F** | 100 + 105 = **205 F** |
> | 1 km 500 m aller + retour (3 km) | 150 + 210 = **360 F** | 100 + 210 = **310 F** |
>
> Pourquoi : la base paie la prise en charge (le trajet du Zem **jusqu'au client n'est pas facturé au kilomètre**), et elle garde la cohérence avec le prix affiché à la commande. La base n'est facturée **qu'une seule fois** : un demi-tour ne la double pas. Une annulation **avant le départ** (course `MATCHED` ou `ARRIVED`) reste régie par le comportement actuel, sans rapport avec ce chantier.

## 1.2 Ce que fait le code aujourd'hui

- Le prix est calculé **une seule fois, à la commande**, d'après la distance estimée par OSRM, puis **figé** (`Ride.price`).
- `PricingService.breakdown(distanceKm, vehicleType)` calcule déjà un prix **au prorata, au mètre près** (distance convertie en millimètres entiers, chaque palier tronqué en FCFA entiers) : **la règle « 1 km 500 m = 70 + 70/2 » est déjà implémentée**, il suffit de l'appeler avec la distance réellement parcourue.
- `RidesService.settle` débite et crédite **toujours `ride.price`**, quelle que soit la distance faite.
- Le serveur **ne mesure jamais la distance réellement parcourue** : il conserve seulement la dernière position, pas le trajet.

Un demi-tour ou un arrêt anticipé est donc aujourd'hui facturé au prix de la course entière. C'est ce qu'il faut corriger.

## 1.3 Questions à trancher AVANT de coder (bloquantes)

| # | Question | Pourquoi c'est bloquant | Proposition |
|---|---|---|---|
| **Q1** | ✅ **TRANCHÉE le 11 octobre 2026 — oui, la base est due.** *(La base : 150 F Zem essence, 100 F électrique.)* | Les exemples du message de départ (« 1 km = 70 F ») ne contenaient pas la base ; le prix de 1 km vaut **220 F** avec la base essence (170 F électrique), pas 70 F | **Choix A : prix = base + kilomètres parcourus**, comme une course complète. Les montants à coder sont ceux de la colonne « + base » du tableau ci-dessous |
| **Q2** | **Frontières des paliers** : le message dit « 16 à 24 km à 60 F » puis « 25 à 50 km à 50 F ». La configuration (`tarification.json`) dit 60 F jusqu'à **25 km** inclus, puis 50 F à partir du **26ᵉ** km. | Le 25ᵉ kilomètre est facturé 60 F ou 50 F selon la source | Garder `tarification.json` (source unique) et le corriger **si** le message est la bonne règle. Ne pas coder les paliers à deux endroits |
| **Q3** | **Au-delà de 50 km** : quel tarif ? | Le message s'arrête à 50 km ; la configuration applique 50 F sans limite | 50 F / km sans limite (comportement actuel) |
| **Q4** | **Demi-tour : tarifs cumulés ou « × 2 par trajet » ?** Le message écrit `(70 + 70/2) × 2`. Sur un cumul de distance, les deux méthodes **donnent le même montant** tant qu'on reste dans le premier palier (15 km au total), puis **diffèrent** | Un aller-retour de 10 km chacun : cumul 20 km = 1 350 F de kilomètres ; « 10 km × 2 » = 700 × 2 = 1 400 F | **Une seule règle : distance cumulée (compteur), puis paliers.** C'est cohérent avec la configuration (« paliers cumulatifs depuis l'origine ») |
| **Q5** | **Plafond** : si la distance parcourue dépasse la distance estimée (détour, demi-tour long), le client paie-t-il plus que le prix affiché à la commande ? | Le solde n'est vérifié qu'au démarrage, pour `ride.price` : payer plus peut dépasser le solde | Proposition : **plafonner au prix estimé** pour une course qui atteint sa destination ; pour un arrêt anticipé avec accord des deux, payer base + distance parcourue (le client a accepté le montant affiché) |
| **Q6** | **Arrondi** du montant final (aujourd'hui : FCFA entiers, tronqués) | Ex. 0,2 km = 14 F | Garder (entiers tronqués), ou arrondir au multiple de 5 F si le métier le veut |
| **Q7** | **Qui peut demander l'arrêt ?** Les deux (client ou Zem) | — | Oui, l'autre doit accepter |
| **Q8** | **Autres véhicules** : mêmes règles pour les voitures (Gazelle, Koala, Léopard) ? | `breakdown` gère tous les véhicules avec leurs propres paliers | Oui, même mécanisme, tarifs de `tarification.json` |

### Exemples chiffrés (paliers actuels de `tarification.json` : 70 F jusqu'à 15 km, 60 F de 15 à 25 km, 50 F au-delà)

| Distance parcourue | Kilomètres seuls | + base essence (150 F) | + base électrique (100 F) |
|---|---|---|---|
| 0,2 km | 14 F | 164 F | 114 F |
| 0,5 km | 35 F | 185 F | 135 F |
| 1 km | **70 F** | 220 F | 170 F |
| 1,5 km | **105 F** | 255 F | 205 F |
| **3 km (1,5 km aller + 1,5 km retour)** | **210 F** | 360 F | 310 F |
| 10 km | 700 F | 850 F | 800 F |
| 15 km | 1 050 F | 1 200 F | 1 150 F |
| 20 km | 1 350 F | 1 500 F | 1 450 F |
| 25 km | 1 650 F | 1 800 F | 1 750 F |
| 26 km | 1 700 F | 1 850 F | 1 800 F |
| 50 km | 2 900 F | 3 050 F | 3 000 F |

La colonne « kilomètres seuls » correspond **exactement aux exemples du message** (70 F, 105 F, 210 F) : elle ne sert plus que de contrôle intermédiaire. **Depuis la décision Q1, le montant à facturer est celui de la colonne « + base »** (essence ou électrique selon le véhicule de la course).

## 1.4 Ce que le backend doit construire

### 1.4.1 Mesurer la distance réellement parcourue (le cœur du chantier)

Aujourd'hui seule la dernière position est conservée. Il faut un **compteur de distance par course** (« odomètre »), alimenté par les positions du Zem **pendant `IN_PROGRESS` uniquement** (avant le départ, la distance vers le client n'est pas facturée).

À chaque `driver:location` valide en `IN_PROGRESS` :

```
distance_pas = haversine(dernier_point_retenu, point_courant)
retenir le pas SEULEMENT si :
  - précision (accuracy) ≤ 50 m (sinon ignorer le point),
  - le pas dépasse le bruit GPS : distance_pas ≥ max(5 m, accuracy / 2),
  - vitesse implicite plausible : distance_pas / Δt ≤ 40 m/s (144 km/h) — sinon saut GPS : ignorer,
  - Δt > 0 (position non plus ancienne que la précédente, cf. horodatage `ts` déjà géré).
si retenu : traveledMeters += distance_pas ; dernier_point_retenu = point_courant
```

- **Pourquoi ces filtres** : à l'arrêt, un GPS « dérive » de quelques mètres ; sans seuil, un Zem immobile cumulerait des kilomètres fictifs (et un Zem malhonnête pourrait gonfler la facture en bougeant le téléphone).
- **Persistance** : colonne `traveledMeters` sur `Ride`, écrite au plus toutes les 5 s (comme `driverLat/driverLng` aujourd'hui), plus le dernier point retenu (`odoLat`, `odoLng`) pour reprendre après un redémarrage du serveur.
- **Trajet pour les litiges** (recommandé) : table `RideTrackPoint (rideId, lat, lng, accuracy, speed, at)` échantillonnée toutes les ~5 s en `IN_PROGRESS`, **supprimée au bout de N jours** (à fixer, p. ex. 30). Sans trace, impossible de justifier un montant contesté.
- **Reprise de signal** : si le téléphone du Zem perd le réseau (tunnel, coupure), il y a un « trou » de positions ; le pas suivant peut être grand. Le filtre de vitesse plausible l'écarterait à tort : prévoir un **repli par interpolation** (une ligne droite au-delà de 40 m/s est refusée, mais un trou de plus de 10 s est comblé par la distance routière OSRM entre les deux points, plafonnée) — à discuter, ou accepter de sous-compter.
- Le compteur n'est jamais modifiable par un client HTTP : il n'est écrit que par le gateway, à partir des positions du **chauffeur de la course**.

### 1.4.2 Calcul du prix partiel

```ts
const km = ride.traveledMeters / 1000;
const partial = this.pricing.breakdown(km, ride.vehicleType);   // existant : au prorata, au mètre près
const price = partial.price;                                    // décision Q1 : base + kilomètres (la base est incluse)
// selon Q5 : Math.min(price, ride.price) si plafonné
```

`breakdown(...).price` contient déjà la base : **aucun calcul spécial à ajouter pour la décision Q1**, c'est le comportement par défaut. Pour 0 m parcouru, le prix vaut la base seule (150 F / 100 F) : c'est voulu, la prise en charge a eu lieu.

Ne pas recopier la règle des paliers : appeler `breakdown`, qui lit `tarification.json` (source unique).

### 1.4.3 Course qui atteint sa destination vs course partielle

- **Arrivée à destination** (le Zem termine à moins d'une tolérance de `destLat/destLng`, p. ex. 150 m, réglable dans `tarification.json`) : comportement actuel, **prix estimé** (`ride.price`), éventuellement plafonné (Q5). Le code d'arrivée existant continue de s'appliquer.
- **Course partielle** : le Zem ou le client demande l'arrêt, l'autre accepte → la course se termine et est payée **au prix de la distance parcourue**. Pas de code d'arrivée : l'accord explicite des deux le remplace.

### 1.4.4 Flux d'arrêt anticipé (accord des deux)

Nouvelles routes sous `/rides/:id`, réservées au client ou au chauffeur **de cette course**, uniquement en `IN_PROGRESS` :

| Route | Qui | Effet |
|---|---|---|
| `POST /rides/:id/stop-request` | client **ou** Zem | Enregistre la demande (`stopRequestedBy`, `stopRequestedAt`, `stopRequestedPrice` = prix calculé à cet instant). Notifie l'autre partie. Refusée si une demande est déjà en cours |
| `POST /rides/:id/stop-accept` | **l'autre partie** (jamais l'auteur) | Fige la distance (`traveledMeters`), calcule le prix, **règle la course** via `settle` avec ce prix, passe en `COMPLETED` |
| `POST /rides/:id/stop-decline` | l'autre partie | Efface la demande, notifie l'auteur. La course continue |
| `POST /rides/:id/stop-cancel` | l'auteur | Retire sa propre demande |

Règles :

- **Expiration** : une demande non traitée expire au bout de 2 minutes (valeur réglable) ; la course continue.
- **Le prix accepté est celui affiché au moment de la demande** (`stopRequestedPrice`), pas un prix recalculé plus tard : si les positions continuent d'arriver entre la demande et l'acceptation, le client paie ce qu'il a vu. Le compteur est figé (ou la demande invalidée si l'écart dépasse un seuil, p. ex. 100 m).
- **Atomicité** : `updateMany` avec le statut et l'absence de demande dans le `WHERE`, comme pour l'acceptation d'une course.
- **Le paiement ne peut jamais dépasser le solde** : le solde est contrôlé au démarrage pour `ride.price` ; le prix partiel étant plafonné (Q5), il reste couvert.
- **Contestation** : le mécanisme existant `RideSettlement` / `report-problem` reste disponible pour un litige après coup.

### 1.4.5 Règlement (`settle`) : un montant explicite

`settle(ride, driverId)` utilise `ride.price`. Il doit accepter un montant :

```ts
private async settle(ride, driverId, amount = ride.price)  // débit client = amount, commission calculée sur amount
```

et enregistrer ce qui s'est réellement passé : `finalPrice`, `settledDistanceMeters`, `priceMode` (`FULL` | `PARTIAL`). La commission (profil Zem, niveau d'agence) et le prélèvement mensuel de 15 % se calculent sur le **montant réellement payé**, pas sur l'estimation.

### 1.4.6 Champs et événements exposés au mobile

Dans `GET /rides/:id` (client et Zem) **et** dans l'historique du chauffeur, en `IN_PROGRESS` :

```json
{
  "traveledMeters": 1480,
  "currentPrice": 104,
  "stopRequest": { "by": "CLIENT", "at": "2026-10-11T09:41:00Z", "expiresAt": "2026-10-11T09:43:00Z", "price": 104 },
  "finalPrice": 105
}
```

- `traveledMeters` : distance cumulée en mètres.
- `currentPrice` : prix si la course s'arrêtait **maintenant** : **base + kilomètres déjà parcourus** (Q1), plafonné selon Q5. Au départ de la course (0 m), il vaut déjà la base seule.
- `stopRequest` : `null` s'il n'y a pas de demande en cours.
- `finalPrice` : seulement une fois la course terminée.

**Le mobile n'affiche la fonction « Arrêter ici » que si `traveledMeters` est présent** : ces champs servent donc d'interrupteur de fonctionnalité.

Événements Socket.IO (room `ride:<id>`, reçus par le client **et** le Zem, qui rejoignent tous deux la room) :

| Événement | Charge utile | Quand |
|---|---|---|
| `ride:progress` | `{ rideId, traveledMeters, currentPrice, at }` | toutes les ~5 s en `IN_PROGRESS` |
| `ride:stop` | `{ rideId, stopRequest }` (`null` si retirée ou refusée) | à chaque demande, annulation, refus, expiration |
| `ride:status` | existant | `COMPLETED` après un accord |

### 1.4.7 Migration Prisma

```prisma
model Ride {
  // …
  traveledMeters       Int       @default(0)
  odoLat               Float?
  odoLng               Float?
  stopRequestedBy      String?   // "CLIENT" | "DRIVER"
  stopRequestedAt      DateTime?
  stopRequestedPrice   Int?
  finalPrice           Int?
  settledDistanceMeters Int?
  priceMode            String?   // "FULL" | "PARTIAL"
}

model RideTrackPoint {
  id        String   @id @default(uuid())
  rideId    String
  ride      Ride     @relation(fields: [rideId], references: [id], onDelete: Cascade)
  lat       Float
  lng       Float
  accuracy  Int?
  speed     Float?
  at        DateTime
  @@index([rideId, at])
}
```

## 1.5 Tests à ajouter (Jest)

1. **Exemples du métier** (via `breakdown`), **base incluse** (décision Q1) : Zem essence 1 km → **220 F**, 1,5 km → **255 F**, 3 km → **360 F** ; Zem électrique 1 km → **170 F**, 1,5 km → **205 F**, 3 km → **310 F**. Vérifier aussi que la base n'est comptée **qu'une fois** (3 km d'aller-retour = 150 + 210, pas 2 × 255).
2. **Compteur** : une trace droite de 1 500 m cumule 1 500 m ± tolérance ; une trace aller-retour de 1 500 m + 1 500 m cumule 3 000 m.
3. **Filtres** : un téléphone immobile qui « dérive » de quelques mètres cumule 0 m ; un saut GPS de 5 km en 1 s est ignoré ; un point à 200 m de précision est ignoré ; un point plus ancien que le précédent est ignoré.
4. **Pas de comptage avant le départ** : positions en `MATCHED` / `ARRIVED` n'alimentent pas `traveledMeters`.
5. **Arrêt anticipé** : demande par le client, acceptation par le Zem → course `COMPLETED`, client débité du prix partiel, Zem crédité (prix − commission) ; l'inverse (demande Zem, acceptation client).
6. **Refus** : l'auteur ne peut pas accepter sa propre demande ; un tiers reçoit `403` ; une course hors `IN_PROGRESS` est refusée.
7. **Expiration et refus** : la course continue, aucune écriture dans le portefeuille.
8. **Prix figé** : le prix accepté est celui de `stopRequestedPrice`, même si `traveledMeters` a grandi entre-temps.
9. **Plafond** (selon Q5) et **solde** : le débit ne dépasse jamais le solde vérifié au démarrage.
10. **Commission** calculée sur `finalPrice`.
11. **Course normale** : arrivée à destination → prix estimé inchangé, code d'arrivée inchangé.
12. **Compatibilité** : sans nouvelle donnée, `GET /rides/:id` renvoie `traveledMeters: 0` (pas d'erreur) pour une course démarrée avant la migration.

## 1.6 Critères d'acceptation

- [ ] **Base + kilomètres** (décision Q1) : Zem essence, 1 km parcouru puis arrêt à deux → **220 F** (150 + 70) ; 1,5 km → **255 F** ; 1,5 km aller + retour (3 km) → **360 F** ; Zem électrique : 170 F, 205 F, 310 F. La base n'est jamais comptée deux fois.
- [ ] Le client et le Zem voient la distance et le prix évoluer pendant la course (toutes les ~5 s).
- [ ] Personne ne peut arrêter la course seul : l'autre partie doit accepter.
- [ ] Un Zem immobile ou un GPS qui dérive ne fait pas monter le compteur.
- [ ] Le portefeuille n'est jamais débité de plus que le solde vérifié au démarrage.
- [ ] La commission et le prélèvement mensuel se basent sur le montant réellement payé.
- [ ] `tarification.json` reste la seule source des tarifs.
- [ ] `npm run build`, `npm test -- --runInBand` passent ; migration relue.

---

# Partie 2 — Audit des cartes (client et Zem)

## 2.1 Ce qui a été audité

`azo-mobile/components/OSMMapView.tsx` (carte OpenStreetMap/Leaflet dans une WebView), `screens/DriverHomeScreen.tsx` (carte du Zem), `screens/LiveTrackingScreen.tsx` (carte du client), et le gateway Socket.IO.

## 2.2 Constats et état

Légende : ✅ corrigé côté mobile dans cette livraison · ⚠️ côté mobile, **non traité** (besoin d'une décision ou d'un nouveau build natif) · 🛠️ **backend** · 🏗️ infrastructure.

| # | Constat | Gravité | État |
|---|---|---|---|
| A1 | **Le tracé complet était renvoyé à la carte à chaque position GPS** (des milliers de coordonnées OSRM), soit à chaque seconde : la WebView saturait, d'où une carte lente côté Zem | haute | ✅ tracé envoyé seulement quand il change, et réduit à 250 points |
| A2 | **L'icône du Zem était reconstruite à chaque changement de cap** : coûteux et clignotant | haute | ✅ l'aiguille tourne sans reconstruire l'icône, par le plus court chemin |
| A3 | **Animation de 0,8 s fixe** alors que les positions arrivent toutes les 2,5 s : le curseur avançait puis s'arrêtait, en boucle | haute | ✅ durée alignée sur le rythme réel des positions, départ depuis la position affichée (aucun saut) |
| A4 | **La caméra ne suivait qu'au-delà de 30 m** : saccades, curseur près du bord | haute | ✅ la caméra suit le marqueur à ~20 images/s, comme une navigation |
| A5 | **Impossible de déplacer la carte** : le suivi automatique la ramenait de force à chaque position | moyenne | ✅ le suivi se met en pause quand l'utilisateur déplace la carte ; bouton **« Recentrer »** |
| A6 | **Carte du Zem de 240 px**, dans un défilement : trop petite et gestes qui se disputent avec la liste | haute | ✅ bouton pour agrandir (62 % de l'écran) ; gestes de la carte prioritaires |
| A7 | **GPS du Zem peu réactif** (précision « haute », un point tous les 5 m ou 2,5 s) | haute | ✅ en course : précision navigation, un point tous les 3 m ou 1,5 s, renvoi de secours toutes les 4 s à l'arrêt |
| A8 | **Le GPS s'arrête quand l'écran du Zem se verrouille ou que l'application passe en arrière-plan** (aucune localisation en arrière-plan) : sur une moto, le téléphone est souvent verrouillé ou en poche | **critique** | ⚠️ **non traité** : demande un service de localisation au premier plan (notification permanente), de nouvelles permissions Android et un **nouveau build natif**, avec les règles du Play Store. Solution intermédiaire possible : garder l'écran allumé pendant la course (dépendance `expo-keep-awake`) |
| A9 | **Les dalles de la carte viennent du serveur public d'OpenStreetMap** (`tile.openstreetmap.org`). Sa politique d'usage interdit une utilisation intensive et exige une identification correcte ; la WebView n'envoie pas de référent | **critique avant le lancement** | 🏗️ à décider : fournisseur de dalles dédié (MapTiler, Stadia, Mapbox…) ou serveur de dalles propre. Au-delà de quelques utilisateurs, les dalles risquent d'être bloquées |
| A10 | **La bibliothèque Leaflet est téléchargée depuis `unpkg.com` à chaque ouverture** : carte blanche sans réseau, et dépendance à un site tiers | haute | ⚠️ à embarquer dans l'application (fichiers locaux) : demande de modifier la configuration de Metro et un build natif |
| A11 | **L'itinéraire est calculé par chaque téléphone sur le serveur public OSRM** (limite de débit), et un échec effaçait le tracé | haute | ✅ le tracé n'est plus effacé en cas d'échec, et n'est recalculé qu'après ~55 m de déplacement ; 🛠️ proxy serveur à terme (§2.3-B) |
| A12 | **Un seul marqueur pour le départ**, sans distinguer le client en mouvement | moyenne | ✅ marqueur « Départ » (vert) + marqueur « Client » (orange) qui bouge avant le départ ; le client voit déjà le Zem |
| A13 | **Cap GPS instable à faible vitesse** (arrêt, demi-tour) : la flèche tournait au hasard | moyenne | ✅ flèche masquée sous ~1 m/s |
| A14 | **Positions plus anciennes acceptées** : le curseur reculait avec un réseau instable | moyenne | ✅ horodatage `at` comparé côté mobile ; 🛠️ le serveur ignore déjà les plus anciennes |
| A15 | **Aucune indication quand la position n'arrive plus** (réseau coupé) : le curseur reste figé sans explication | moyenne | ⚠️ à ajouter : afficher « Position du chauffeur perdue depuis X s » si aucune position depuis 15 s |
| A16 | Le chat (`chatStore`) et l'anti-bruteforce OTP sont **en mémoire** : perdus au redémarrage, incompatibles avec plusieurs instances | moyenne | 🛠️ hors périmètre carte, signalé pour mémoire |
| A17 | **Serveur gratuit de Render** : il s'endort ; le premier appel peut prendre une minute, et le temps réel est coupé pendant le réveil | haute | 🏗️ hébergement non gratuit pour un usage réel |

## 2.3 Ce que le backend doit fournir pour un suivi « à l'instant »

### A. Cadence et ordre des positions (partiellement déjà fait)

Déjà livré (commit « Add live ride participant locations ») : dernière position conservée, ignorer les positions plus anciennes, `client:location`. **À ajouter pour la fluidité :**

1. **Accepter une cadence de 1 à 2 s** par chauffeur sans surcharge : le serveur écrit en base au plus toutes les 5 s (déjà le cas) mais **relaie chaque position** immédiatement. Vérifier qu'aucune limite de débit ne rejette les messages du Zem (cadence de 1,5 s en course, renvoi toutes les 4 s à l'arrêt).
2. **Ne relayer que ce qui a changé** n'est pas nécessaire ; en revanche, **ne pas faire de requête base de données à chaque position** : lire `driverId`, `status` et l'horodatage de la dernière position **une seule fois**, les garder en mémoire par course (invalider au changement de statut). Aujourd'hui `findUnique` est appelé à chaque message : à 1,5 s par Zem, c'est inutilement lourd.
3. **`ride:progress`** (voir §1.4.6) toutes les ~5 s : donne au client et au Zem la distance et le prix en direct.

### B. Itinéraire fourni par le serveur (priorité moyenne)

`GET /rides/:id/route` (client et chauffeur de la course) :

- itinéraire de la **dernière position connue du Zem** vers l'étape en cours (point de départ en `MATCHED`, destination en `IN_PROGRESS`), via OSRM (déjà appelé dans `RidesService.drivingRoute`) ;
- **cache** de quelques secondes (clé arrondie à ~50 m et à l'étape) ;
- en cas d'échec d'OSRM, **renvoie le dernier itinéraire valide** au lieu d'une erreur ;
- renvoie `{ coordinates: [{ latitude, longitude }], distanceKm, durationMinutes, computedAt }`, **simplifié à ~250 points**.

Cela supprime les deux appels OSRM par téléphone, la limite de débit du serveur public, et la disparition du tracé au demi-tour. À terme : OSRM auto-hébergé.

### C. Tolérance aux coupures

Le client lit déjà `driverLocation` à la connexion et par le suivi périodique. S'assurer que **`GET /rides/:id` renvoie toujours la dernière position et son horodatage** (déjà le cas), pour que l'application puisse dire « position vieille de X secondes ».

---

# 7. Ce que fait le mobile (déjà en place) et ce qu'il attend

## 7.1 Déjà fait

- **`components/OSMMapView.tsx`** réécrit : tracé envoyé seulement s'il change et réduit à 250 points ; aiguille de cap sans reconstruction d'icône ; déplacement continu aligné sur le rythme des positions ; caméra qui suit à ~20 images/s ; suivi mis en pause quand on déplace la carte, avec bouton « Recentrer » ; carte vectorielle plus légère (rendu canvas).
- **`screens/DriverHomeScreen.tsx`** : carte du Zem agrandissable ; GPS en précision navigation pendant la course (point tous les 3 m ou 1,5 s) ; renvoi de la dernière position toutes les 4 s ; relecture de la course toutes les 3 s en `IN_PROGRESS` (le client peut terminer la course sans action du Zem) ; écoute de `ride:progress` et `ride:stop`.
- **`screens/LiveTrackingScreen.tsx`** : écoute de `ride:progress` et `ride:stop` ; panneau d'arrêt.
- **`components/RideStopPanel.tsx`** (commun au client et au Zem) : affiche « Parcouru : X,XX km · Y F » en direct ; bouton « Arrêter ici (prix selon la distance parcourue) » avec confirmation du montant et rappel que la prise en charge est incluse ; côté destinataire, bannière « Ton Zem / Le client propose d'arrêter ici : Y F pour X km » avec acceptation ou refus ; annulation de sa propre demande.
- **`services/api.ts`** : `ridesApi.requestStop`, `acceptStop`, `declineStop`, `cancelStop` (routes du §1.4.4) ; nouveaux champs optionnels de `Ride` : `traveledMeters`, `currentPrice`, `stopRequest`, `finalPrice`.

## 7.2 Ce que le mobile attend du backend

| Contrat | Détail |
|---|---|
| Interrupteur de fonction | Le panneau d'arrêt n'apparaît que si `GET /rides/:id` renvoie `traveledMeters` (nombre) en `IN_PROGRESS` |
| Routes | `POST /rides/:id/stop-request`, `stop-accept`, `stop-decline`, `stop-cancel` ; chacune renvoie la course mise à jour (même forme que `GET /rides/:id`) |
| Événements | `ride:progress { rideId, traveledMeters, currentPrice, at }`, `ride:stop { rideId, stopRequest }` dans la room `ride:<id>` |
| Fin de course par accord | La course passe en `COMPLETED` ; le mobile du Zem la détecte (relecture toutes les 3 s) et rafraîchit son portefeuille ; celui du client suit déjà `COMPLETED` |
| Montant affiché | `stopRequest.price` (sinon `currentPrice`) : c'est le montant accepté, il doit être celui réellement débité |

## 7.3 Ce que le mobile ne fait PAS encore

- Localisation en arrière-plan du Zem (A8), Leaflet embarqué (A10), fournisseur de dalles dédié (A9), message « position perdue » (A15) : voir le tableau §2.2.
- Aucun calcul de prix côté mobile : **le serveur est la seule autorité** sur le montant.

---

## Ordre de travail proposé pour le backend

1. **Trancher Q2 à Q5** avec le métier (surtout Q2, les bornes des paliers). **Q1 est tranchée** : base + kilomètres.
2. **Compteur de distance** (§1.4.1) + migration + tests de filtres : c'est la base de tout le reste.
3. **Prix partiel** (§1.4.2, §1.4.5) et **règlement avec montant explicite**.
4. **Routes d'arrêt anticipé** et événements `ride:progress` / `ride:stop` (§1.4.4, §1.4.6).
5. **Optimisation du gateway** (§2.3-A) : plus de lecture en base à chaque position.
6. **`GET /rides/:id/route`** (§2.3-B), si le test de terrain confirme les limites d'OSRM.
7. En parallèle, côté infrastructure : fournisseur de dalles (A9) et hébergement (A17).
