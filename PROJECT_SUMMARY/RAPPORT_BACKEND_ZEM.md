# RAPPORT D'AVANCEMENT TECHNIQUE — BACK-END & API (AZƆ̀)

**Projet :** Plateforme de Mobilité, Transport & Livraison Urbaine **AZƆ̀** (Bénin)
**Périmètre :** Serveur API & Base de Données (`azo-backend` — NestJS / Prisma / PostgreSQL)
**Objet du présent rapport :** nouvelle filière **Zem (essence / électrique)**, séparation des
gammes voitures, **nouveau barème de courses** et **filtrage du radar chauffeur**
**URL de Production :** `https://azo-backend.onrender.com`
**Destinataires :** Direction Générale & Responsables Techniques
**Date :** 06 Octobre 2026

---

## 1. Synthèse exécutive

Le back-end AZƆ̀ a été profondément remanié aujourd'hui sur le cœur du métier : **le véhicule et
son prix**. Trois livraisons structurent cette journée :

1. **La filière Zem devient autonome.** L'application ne raisonne plus en « gammes » mélangées :
   le **Zem** (moto-taxi) existe désormais avec ses **deux types officiels** — `ZEM_ESSENCE` et
   `ZEM_ELECTRIC` — tandis que **Gazelle / Koala / Léopard ne désignent plus que des voitures**.
2. **Le barème de courses est refondu** autour d'une base et de **paliers kilométriques** propres
   à chaque véhicule. Les deux Zem partagent désormais les **mêmes paliers** (70 F/km de 0 à
   15 km, 60 F/km de 16 à 25 km, 50 F/km au-delà) et **seule la base les distingue** : 150 F pour
   le Zem à essence, **100 F pour le Zem électrique** — soit 50 F d'écart constant, sans remise.
3. **Le radar chauffeur est filtré** : un prestataire ne reçoit plus que les demandes
   correspondant **exactement** au véhicule déclaré dans son dossier — et les coursiers ne
   reçoivent plus du tout les demandes de transport.

L'ensemble reste piloté par **une seule source de vérité** (`src/pricing/tarification.json`) :
aucune règle de prix n'est codée en dur, la configuration est validée au démarrage, et
**51 tests unitaires** couvrent les cas métier (bornes de paliers, base par type, conversions,
niveaux d'agence, profils, radar).

---

## 2. Modèle de données — véhicules en deux filières

### 2.1 Enum `VehicleType` (Prisma / PostgreSQL)

```prisma
enum VehicleType {
  ZEM_ESSENCE    // moto-taxi thermique
  ZEM_ELECTRIC   // moto-taxi électrique
  GAZELLE        // voiture d'entrée de gamme
  KOALA          // voiture climatisée
  LEOPARD        // berline premium
}
```

La filière n'est pas une convention d'affichage : elle est **portée par la configuration**
(`family: "ZEM" | "CAR"`) et exploitée par le service de tarification
(`vehicleFamily()`, `isZem()`, `zemVehicleKeys()`). Aucune liste de véhicules n'est codée en dur
dans la logique métier.

### 2.2 Migration `20261005140000_zem_essence_et_electrique`

* enum `VehicleType` reconstruit avec les 5 valeurs (technique `RENAME` + `CREATE` + conversion
  des colonnes, car PostgreSQL interdit d'utiliser dans la même transaction une valeur d'enum
  ajoutée par `ALTER TYPE … ADD VALUE`) ;
* **conversion des données historiques** : toutes les courses et tous les dossiers `DRIVER`
  enregistrés en `GAZELLE` — qui désignait le moto-taxi jusqu'ici — passent en **`ZEM_ESSENCE`**
  (même véhicule, même tarif de référence). Sans cette conversion, une course passée en moto
  aurait été relue comme une course en voiture ;
* la filière **coursier / livraison** n'est volontairement pas touchée (harmonisation
  « moto essence / moto électrique » renvoyée à un chantier ultérieur) ;
* les anciens types restent convertis à la lecture (`legacyVehicleMapping` :
  `ZEM → ZEM_ESSENCE`, `CAR → KOALA`) pour tout environnement non encore migré.

**Vérification effectuée :** migration rejouée intégralement sur un **PostgreSQL 16** réel
(PGlite) — enum conforme, conversions exactes, coursiers et voitures intacts, aucun type résiduel.

---

## 3. Tarification — modèle unifié « base + paliers »

### 3.1 Principe

```
prix = base (remisée le cas échéant) + Σ (kilomètres du palier × prix/km du palier)
```

Chaque véhicule porte **ses propres paliers** (`brackets: [{ upToKm, perKm }, …]`, le dernier
portant `upToKm: null` = illimité) et, en option, une **remise de base**
(`baseDiscount: { pct, aboveKm }`). Le champ global `kmThreshold` de l'ancien modèle a disparu :
les bornes vivent désormais dans le véhicule. Chaque poste est **tronqué en FCFA entiers**
(`Math.floor`), sans arrondi métier ; le calcul se fait en millimètres entiers pour rester exact
(20,9 km : ⌊5,9 × 60⌋ = 354 F, soit 150 + 1 050 + 354 = 1 554 F à essence).

### 3.2 Barème officiel

| Véhicule | Base | 0 → 15 km | 16 → 25 km | 26 km et + | Remise de base |
|---|---|---|---|---|---|
| **ZEM_ESSENCE** | 150 | 70 / km | 60 / km | 50 / km | aucune |
| **ZEM_ELECTRIC** | **100** | 70 / km | 60 / km | 50 / km | aucune |
| **GAZELLE** | 800 | 200 / km | 150 / km | 150 / km | aucune |
| **KOALA** (climatisé) | 1 200 | 375 / km | 350 / km | 350 / km | aucune |
| **LEOPARD** | 2 500 | 900 / km | 800 / km | 800 / km | aucune |

**Décisions retenues**

* les deux types de Zem partagent **exactement les mêmes paliers** (70 / 60 / 50 F/km, bornes à
  15 km, 25 km et dernier palier à partir du 26e km) ;
* **seule la base diffère** : 150 F pour le Zem à essence, **100 F** pour le Zem électrique. Le
  Zem électrique est donc **toujours 50 F moins cher**, quelle que soit la distance (vérifié par
  un test sur 0 · 3 · 10 · 15 · 16 · 25 · 26 · 30 · 60 · 100 km) ;
* **aucune remise de base** dans le barème en vigueur (la remise de 25 % du barème précédent est
  supprimée) ;
* la base est due **dès que la course est acceptée** ; le client n'est débité qu'à la **fin** de
  la course ;
* les voitures conservent leurs grilles de la spécification initiale, leur palier à 15 km et
  **aucune remise**.

### 3.3 Prix de référence vérifiés

| Trajet | Zem à essence | Zem électrique | Écart |
|---|---|---|---|
| 0 km | 150 | 100 | 50 |
| 5 km | 500 | 450 | 50 |
| 10 km | 850 | 800 | 50 |
| 15 km | 1 200 | 1 150 | 50 |
| 16 km | 1 260 | 1 210 | 50 |
| 25 km | 1 800 | 1 750 | 50 |
| 30 km | 2 050 | 2 000 | 50 |
| 100 km | 5 550 | 5 500 | 50 |

### 3.4 Validation de la configuration

Au démarrage, `assertValid()` refuse un barème incohérent : véhicule manquant, `base` absente ou
négative, paliers vides, **bornes non strictement croissantes**, **dernier palier non illimité**,
pourcentage de remise hors de `[0 ; 100]`, `aboveKm` invalide. Le message d'erreur est explicite :
une configuration erronée fait échouer le démarrage, jamais tourner l'API avec un prix faux.

---

## 4. Radar des demandes — filtrage par véhicule

`GET /rides/pending` n'expose plus l'ensemble des courses en attente. Le service applique
`PricingService.rideVisibleFor(véhicule du chauffeur, véhicule de la course)` :

| Véhicule du chauffeur | Demandes reçues |
|---|---|
| Zem à essence | demandes **ZEM_ESSENCE** uniquement |
| Zem électrique | demandes **ZEM_ELECTRIC** uniquement |
| Gazelle / Koala / Léopard | demandes de la **même gamme exacte** (jamais de demande Zem) |
| Coursier / livreur | **aucune** demande de transport (espace mission : `GET /delivery/available`) |
| Conducteur sans véhicule déclaré (compte historique) | aucune demande masquée |

Le comportement se règle **sans redéploiement**, dans `tarification.json` :

```json
"radar": { "strictVehicleMatch": true }
```

* `true` (défaut) — correspondance **exacte** : un Zem à essence ne voit pas les demandes de Zem
  électrique, et Gazelle ≠ Koala ≠ Léopard ;
* `false` (mode démarrage / démonstration) — les **deux Zem partagent** leurs demandes ; les
  voitures restent filtrées par gamme exacte. Utile lorsqu'un seul type de Zem est enrôlé.

---

## 5. Autres impacts back-end

* **Profils prestataires** — le profil `ZEM_INDEPENDANT` (15 % des revenus du mois + 1,5 % par
  retrait, **0 de commission par course**) est désormais détecté par la **filière** du véhicule
  (`isZem`), donc valable pour **les deux types de Zem**. Utilisé par le calcul de fin de course,
  par les frais de retrait (`/wallet/withdrawal-quote`, `/wallet/withdraw`) et par le prélèvement
  mensuel idempotent `POST /admin/settlements/zem-monthly`.
* **Dossiers prestataires** — `POST /providers/applications` accepte les 5 véhicules
  (`@IsIn`), et `GET /providers/requirements` renvoie les choix enrichis d'une **filière**
  (`family`), ce qui permet à l'application mobile d'afficher deux groupes distincts.
* **`GET /pricing`** (public) expose la configuration complète, la liste des véhicules et la
  liste des Zem — l'application mobile affiche donc **exactement** les mêmes prix que le serveur.

---

## 6. Endpoints concernés

| Endpoint | Évolution |
|---|---|
| `GET /pricing` | Barème complet : véhicules + filières, paliers, niveaux d'agence, profils, radar |
| `POST /rides/estimate` | Renvoie la **base remisée** (`base`, `baseFull`, `baseDiscountPct`, `baseDiscountApplied`, `baseDiscountAboveKm`) et **une ligne par palier** (`brackets[]`) |
| `POST /rides` | Accepte les 5 véhicules (dont les deux Zem) |
| `GET /rides/pending` | **Filtré** sur le véhicule du chauffeur ; exclut les coursiers |
| `POST /rides/:id/accept · start · complete · cancel · rate` | Inchangés (commission via profil / niveau d'agence) |
| `GET /providers/requirements` | Choix de véhicules avec `family: ZEM | CAR` |
| `POST /providers/applications` | Validation des 5 véhicules |
| `GET /wallet/withdrawal-quote`, `POST /wallet/withdraw` | Profil `ZEM_INDEPENDANT` appliqué aux deux Zem |
| `POST /admin/settlements/zem-monthly` | Prélèvement mensuel des Zem indépendants (les deux types) |

---

## 7. Tests et vérifications

```bash
cd azo-backend && npm test
```

**51 tests verts** (`test/pricing.spec.ts`), dont :

* paliers Zem complets : 0 · 5 · 10 · 15 · 16 · 25 · 26 · 30 · 60 · 100 km, pour **les deux
  types** ;
* **paliers strictement identiques** pour les deux Zem (bornes et tarifs au km) et **écart
  constant de 50 F** (base 150 F à essence contre 100 F en électrique), à toutes les distances ;
* **absence de remise de base** : le champ `baseDiscount` est absent de la configuration et
  aucun véhicule ne remise sa base ;
* voitures : grilles de la spécification, **aucune remise**, palier à 15 km ;
* radar : correspondance exacte, non-mélange Zem / voiture, mode souple, conversion des anciens
  types ;
* cas transverses déjà couverts : niveaux d'agence (un test par niveau), profils prestataires,
  valeurs provisoires « à définir », conversion des véhicules historiques.

**Autres contrôles :** compilation TypeScript sans erreur nouvelle ; validation de la migration
sur PostgreSQL 16 ; cohérence stricte entre la configuration backend et sa copie embarquée dans
l'application mobile.

---

## 8. Points de vigilance et chantiers ouverts

1. **Le serveur Render en production n'est pas à jour.** Il tourne sur une révision antérieure à
   la PR #2 : `GET /pricing` y répond **404** et l'enum ne connaît pas les deux Zem. Tant qu'il
   n'est pas redéployé, l'application mobile doit pointer sur **un backend local**. La mise en
   production est volontairement différée (décision : développer toutes les fonctionnalités
   avant de fusionner dans `main`).
2. **Aucun matching automatique** : les chauffeurs interrogent le radar toutes les 8 secondes,
   le client toutes les 3 secondes. Pas de dispatch par proximité, pas de rayon de recherche,
   pas d'expiration de demande, pas de notification poussée.
3. **Code Bouclier AZƆ̀** : le code à 4 chiffres est dérivé de l'identifiant de course et la
   vérification reste **facultative** dans `POST /rides/:id/start`.
4. **Distances** : le prix est figé à la création sur une distance en **ligne droite**
   (haversine), sans raccord routier.
5. **Filière coursier** volontairement inchangée dans l'immédiat (harmonisation prévue).

---

## 9. Documents de référence

| Document | Contenu |
|---|---|
| `PROJECT_SUMMARY/TARIFICATION.md` | Modèle de prix, barèmes, paliers, remises, niveaux d'agence, profils, migrations |
| `PROJECT_SUMMARY/PARCOURS_ZEM.md` | Déroulé complet de la commande d'un Zem, filtrage du radar, chantiers ouverts |
| `PROJECT_SUMMARY/RAPPORT_FRONTEND_ZEM.md` | Rapport front-end correspondant (parcours, écrans, affichage des prix) |
| `azo-backend/README.md` | Endpoints et règles métier du serveur |
