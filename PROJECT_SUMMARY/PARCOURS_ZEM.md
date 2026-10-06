# Parcours d'une commande de Zem — AZƆ̀

Document de référence du parcours **« Je commande un Zem »** tel qu'il fonctionne
aujourd'hui dans l'application (mise à jour des 5 et 6 octobre 2026).

## 1. Principe

Un Zem est un **moto-taxi**. Il existe **deux types**, choisis par le client dès le
premier écran :

| Type | Libellé client | Base | 0 → 15 km | 16 → 25 km | 26 km et + |
|---|---|---|---|---|---|
| `ZEM_ESSENCE` | **Zem à essence** | 150 F | 70 F/km | 60 F/km | 50 F/km |
| `ZEM_ELECTRIC` | **Zem électrique** | **100 F** | 70 F/km | 60 F/km | 50 F/km |

**Mêmes paliers kilométriques pour les deux types : seule la base change** (150 F à essence,
**100 F** en électrique). Le Zem électrique coûte donc **50 F de moins**, quelle que soit la
distance.

**Aucune remise de base** : le barème en vigueur n'en comporte plus.

| Trajet | Prix Zem à essence | Prix Zem électrique |
|---|---|---|
| 5 km | 150 + 5 × 70 = **500 F** | 100 + 5 × 70 = **450 F** |
| 10 km | 150 + 10 × 70 = **850 F** | 100 + 10 × 70 = **800 F** |
| 15 km | 150 + 15 × 70 = **1 200 F** | 100 + 15 × 70 = **1 150 F** |
| 16 km | 150 + 1 050 + 60 = **1 260 F** | 100 + 1 050 + 60 = **1 210 F** |
| 25 km | 150 + 1 050 + 600 = **1 800 F** | 100 + 1 050 + 600 = **1 750 F** |
| 30 km | 150 + 1 050 + 600 + 5 × 50 = **2 050 F** | 100 + 1 050 + 600 + 5 × 50 = **2 000 F** |

L'écran « Quel Zem veux-tu ? » affiche le tarif **sous chaque carte**, lu dans la configuration
partagée (jamais codé en dur).

La base (150 F à essence, 100 F en électrique) est due dès que la course est **acceptée** ; le client n'est débité qu'à la
**fin** de la course (aucun débit avant le départ).

Les noms **Gazelle / Koala / Léopard** sont réservés aux **voitures** et n'apparaissent
jamais dans la commande d'un Zem.

## 2. Déroulé complet

```
CLIENT                                      BACKEND                    CHAUFFEUR (Radar)
 ──────                                      ───────                    ─────────────────
 Accueil → tuile « Zem »
   ↓
 ÉTAPE 1 — Écran dédié « Quel Zem veux-tu ? »
   • Zem à essence  |  Zem électrique
   • rappel : les deux ont le même tarif
   ↓
 ÉTAPE 2 — Écran de réservation
   • départ = GPS (modifiable / carte)
   • destination = autocomplete, carte ou lieu favori
   • estimation locale immédiate puis prix officiel
        ── POST /rides/estimate ──→  pricing.breakdown(km, type de Zem)
        ←── prix + détail (base, tranches) ──
   • solde AZƆ̀ Pay affiché, bouton « Confirmer · X FCFA »
        ── POST /rides ──────────→  Ride créée, status = PENDING
   ↓
 SUIVI — LiveTrackingScreen
   • polling GET /rides/:id (3 s) + socket « ride:join »
                                                                   GET /rides/pending (8 s)
                                                                   filtré sur SON véhicule
                                                                  ← demandes Zem compatibles
                                                                   « Accepter »
        ── POST /rides/:id/accept ─→  PENDING → MATCHED (atomique)
                                      + notification + socket
   ← fiche chauffeur (nom/tél masqués), Code Bouclier AZƆ̀ (4 chiffres)
                                                                   GPS toutes ~10 s
                                             ←── socket « driver:location » ──
   ← marqueur live + tracé + ETA
                                                                   saisit le PIN client
        ── POST /rides/:id/start ──→  vérifie PIN + solde client ≥ prix
                                      status = IN_PROGRESS
   ← « Course en cours » · chat in-app (socket « ride:chat »)
   • annulation impossible une fois la course démarrée
                                                                   « Terminer »
        ── POST /rides/:id/complete → transfert AZƆ̀ Pay atomique :
                                      client débité du prix, chauffeur crédité
                                      (commission 0 % pour un Zem indépendant)
                                      status = COMPLETED
   ← « Terminer » → notation (1 à 5 étoiles) → accueil
```

## 3. Détail par étape (code)

| Étape | Écran / code | Endpoint |
|---|---|---|
| Choix Zem essence / électrique | `screens/RideBookingScreen.tsx` (étape 1 dédiée) | — |
| Destination + estimation | `RideBookingScreen.tsx` (feuille de réservation) | `POST /rides/estimate` |
| Confirmation | `RideBookingScreen.tsx` → `App.tsx` (`ride-request` → `ride-tracking`) | `POST /rides` |
| Suivi + Code Bouclier | `screens/LiveTrackingScreen.tsx` | `GET /rides/:id` |
| Radar chauffeur | `screens/DriverHomeScreen.tsx` | `GET /rides/pending` |
| Acceptation | `DriverHomeScreen.tsx` | `POST /rides/:id/accept` |
| Démarrage (PIN) | `DriverHomeScreen.tsx` | `POST /rides/:id/start` |
| Fin + paiement | `DriverHomeScreen.tsx` | `POST /rides/:id/complete` |
| Notation | `screens/RideRatingScreen.tsx` | `POST /rides/:id/rate` |

Statuts de la course : `PENDING` → `MATCHED` → `IN_PROGRESS` → `COMPLETED`
(ou `CANCELLED`). Une annulation **client** clôt la course ; une annulation **chauffeur**
la remet en `PENDING` pour un autre chauffeur.

## 4. Filtrage du radar (le chauffeur ne voit que son véhicule)

Le dossier prestataire enregistre le **véhicule exact** du conducteur :

- **Filière Moto-taxi (Zem)** : *Zem à essence* ou *Zem électrique* ;
- **Filière Voiture** : *Gazelle*, *Koala* ou *Léopard*.

`GET /rides/pending` ne renvoie au chauffeur que les demandes correspondantes :

| Véhicule du chauffeur | Demandes reçues |
|---|---|
| Zem à essence | Zem à essence uniquement |
| Zem électrique | Zem électrique uniquement |
| Gazelle / Koala / Léopard | courses de la même gamme de voiture |
| Coursier / livreur | aucune demande de transport |

Le mode **souple** (`"radar": { "strictVehicleMatch": false }` dans
`azo-backend/src/pricing/tarification.json`, puis `npm run sync:tarification` côté mobile)
fait partager les demandes entre les deux types de Zem — utile au démarrage ou en
démonstration quand un seul type de Zem est enrôlé. Aucun redéploiement de code n'est
nécessaire : la copie mobile du barème est relue par `GET /pricing`.

> ℹ️ **Conséquence pour les tests** : pour recevoir une demande « Zem électrique », il
> faut un chauffeur dont le dossier approuvé déclare **Zem électrique** — et inversement.
> Le radar du chauffeur affiche désormais son véhicule (« Radar Zem à essence — tu ne vois
> que ces demandes »).

## 5. Rapports d'avancement

* [`RAPPORT_BACKEND_ZEM.md`](./RAPPORT_BACKEND_ZEM.md) — back-end : modèle de données, barème,
  filtrage du radar, endpoints, tests, migration.
* [`RAPPORT_FRONTEND_ZEM.md`](./RAPPORT_FRONTEND_ZEM.md) — front-end : parcours client, écrans,
  affichage des prix, valeurs de contrôle pour les tests.

## 6. Points connus / chantiers ouverts

1. **Pas de matching automatique** : les chauffeurs *pollent* le radar toutes les 8 s et
   le client toutes les 3 s. Aucune notification poussée, aucune expiration de demande.
2. **Le Code Bouclier n'est pas un secret** : il est dérivé de l'identifiant de course
   (recalculé côté client et côté serveur) et la vérification est **optionnelle** dans
   l'API (`POST /rides/:id/start` accepte l'absence de PIN).
3. **Prix figé à la création** sur une distance en ligne droite, alors que l'estimation
   locale du mobile applique un facteur route ×1,35 : l'écran peut annoncer un montant
   légèrement supérieur à celui du serveur.
4. **Solde vérifié au démarrage et à la fin** uniquement : un client qui se vide le
   portefeuille en cours de course bloque la fin de course (le chauffeur n'est pas payé).
5. **Filière coursier** : libellés de véhicules volontairement inchangés dans l'immédiat
   (harmonisation « moto essence / moto électrique » prévue séparément).

---

## 7. Dépannage — erreur « vehicleType must be one of the following values »

**Symptôme** : la réservation s'affiche correctement (prix calculé par l'app) mais la
confirmation échoue avec un message du type
`vehicleType must be one of the following values: ZEM, ZEM_ELECTRIC, CAR, LEOPARD`.

**Cause** : le serveur qui répond est une **version antérieure du backend**. La liste des
véhicules acceptés vient du **client Prisma généré** (`@IsEnum(VehicleType)` dans
`azo-backend/src/rides/dto/create-ride.dto.ts`) ; un client généré avant la migration Zem
connaît encore les anciens noms (`ZEM`, `CAR`) et refuse donc `ZEM_ESSENCE`.

**Remède** (dans `azo-backend`, après avoir arrêté le serveur) :

```powershell
git pull
npm install
npx prisma generate        # INDISPENSABLE : régénère la liste des véhicules connus
npx prisma migrate deploy  # applique la migration Zem si ce n'est pas déjà fait
npm run start:dev
```

**Vérification** : `http://localhost:3000/pricing` doit contenir `ZEM_ESSENCE` et
`ZEM_ELECTRIC`. Le message exact renvoyé par le serveur est désormais traduit dans
l'application (`friendlyApiMessage` dans `azo-mobile/services/api.ts`).

> ℹ️ Le prix affiché avant l'erreur reste juste : l'application calcule l'estimation avec le
> barème embarqué (`config/tarification.json`) quand le serveur ne répond pas.
