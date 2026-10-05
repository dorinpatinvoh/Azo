# Tarification AZƆ̀ — Tarifs et profils

Implémentation de la spécification métier **« Tarifs et profils »** (courses, agences,
profils prestataires). Devise : **FCFA, montants entiers**.

## 1. Source unique de configuration

| Fichier | Rôle |
|---|---|
| `azo-backend/src/pricing/tarification.json` | **Source de vérité** : gammes de véhicules, paliers km, niveaux d'agence, profils. |
| `azo-backend/src/pricing/tarification.config.ts` | Chargement + validation de la config (erreur explicite si une clé manque). |
| `azo-backend/src/pricing/pricing.service.ts` | Tous les calculs (prix de course, commissions, frais de retrait, prélèvement mensuel). |
| `azo-backend/src/pricing/pricing.module.ts` | Module Nest + route publique `GET /pricing` (l'app mobile lit le même barème). |
| `azo-mobile/config/tarification.json` | Copie embarquée pour l'affichage hors ligne, synchronisée par `npm run sync:tarification`. |

Aucune règle de prix n'est codée en dur dans la logique métier. Le barème peut être
remplacé sans recompiler le code via `TARIFICATION_CONFIG_PATH=/chemin/tarification.json`
(fichier monté, volume, export base de données). La config est validée au démarrage :
une clé absente ou non numérique fait échouer le démarrage avec un message explicite.

## 2. Prix d'une course (gammes de véhicules)

`prix = tarif_de_base + km_tranche1 × prix_0_15 + km_tranche2 × prix_16_plus`

avec `km_tranche1 = min(distance_km, 15)` et `km_tranche2 = max(distance_km − 15, 0)`.

| Gamme | Tarif de base | 0 à 15 km | À partir du 16e km |
|---|---|---|---|
| **GAZELLE** (entrée de gamme) | 800 | 200 / km | 150 / km |
| **KOALA** (intermédiaire, **climatisé**) | 1 200 | 375 / km | 350 / km |
| **LEOPARD** (haut de gamme) | 2 500 | 900 / km | 800 / km |

Exemples vérifiés par les tests : GAZELLE 10 km = **2 800** · GAZELLE 20 km = **4 550** ·
LEOPARD 20 km = **20 000**.

*Convention de montant* : FCFA entiers, **sans arrondi** — le coût kilométrique est
tronqué (`Math.floor`). La distance est convertie en millimètres entiers avant
multiplication pour éviter les artefacts de virgule flottante (20,9 − 15 = 5,9 → 885 F).

## 3. Profils prestataires

| Profil | Catégorie | Prélèvement |
|---|---|---|
| **ZEM_INDEPENDANT** | — | **15 % des revenus du mois** (calcul mensuel, jamais par course) + **1,5 % sur chaque retrait** |
| **LIVREUR** | `INDEPENDANT_PERSONNEL` | Aucune règle définie à ce stade (profil et catégorie prévus, sans prélèvement) |
| **COURSIER** | `INDEPENDANT_PERSONNEL` | Aucune règle définie à ce stade (profil et catégorie prévus, sans prélèvement) |

Un profil non décrit par la spécification (ex. conducteur indépendant d'une gamme
KOALA/LEOPARD) suit la règle `unspecifiedProfile` : **aucun prélèvement** tant que le
métier ne l'a pas tranché.

## 4. Niveaux d'agence

Les niveaux ne concernent **que les agences**.

| Niveau | Frais d'activation (uniques) | Commission par course | Frais par retrait | Limite de comptes |
|---|---|---|---|---|
| **PRO** | 100 000 | 3 % | 1 % | 25 |
| **SILVER** | 215 500 | 2,5 % | 0,75 % | 50 |
| **OR** | 450 500 | 2 % | 0,50 % | 100 |
| **DIAMANT** | 600 500 | 1 % | 0,25 % | 1 000 |

Règles appliquées :
- l'activation est un **paiement unique et non récurrent** ; une agence non activée
  (`feePaidAt` vide) ne peut ni gérer de comptes ni opérer (course refusée) ;
- la commission est prélevée **sur chaque course** réalisée par l'agence ;
- les frais de retrait sont prélevés **à chaque retrait** de l'agence ;
- toute création/rattachement de compte **au-delà de la limite du niveau est refusée**.

## 5. Endpoints

| Endpoint | Description |
|---|---|
| `GET /pricing` | Barème complet (gammes, paliers, niveaux, profils) — lecture seule. |
| `POST /rides/estimate` | Prix d'une course (distance + gamme) avec détail du calcul. |
| `POST /rides/:id/complete` | Commission réelle (niveau d'agence ou profil) ; refuse une agence non activée. |
| `POST /agencies/activate` | Paiement unique des frais d'activation du niveau (débit AZƆ̀ Pay). |
| `POST /agencies/drivers` | Rattachement : vérifie l'activation puis la limite de comptes. |
| `GET /agencies/dashboard` | Commission %, frais de retrait %, activation, quota utilisés/total. |
| `GET /wallet/withdrawal-quote?amount=` | Frais de retrait applicables (profil 1,5 % / niveau d'agence). |
| `POST /wallet/withdraw` | Retrait : frais prélevés, net versé, solde débité du montant. |
| `POST /admin/settlements/zem-monthly` | Prélèvement mensuel des Zem indépendants (15 %), idempotent, période `AAAA-MM` optionnelle. |

## 6. Tests

```bash
cd azo-backend && npm test
```

35 tests couvrent les exemples de la spécification, les bornes de tranches (15 km,
16 km), la troncature, la conversion des anciens types de véhicules, **un cas par
niveau d'agence** (activation, commission, frais de retrait, plafond) et les profils
prestataires (Zem 15 % / 1,5 % ; LIVREUR & COURSIER sans prélèvement).

## 7. Points laissés configurables (à trancher côté métier)

1. **Livraison** : la spécification ne décrit pas de tarif de livraison. Le taux
   existant est conservé en configuration (`delivery.commissionPct`), en attente d'une
   règle métier. Le prix des livraisons reste déclaré par le client/coursier.
2. **Commission par course des profils non agence** : la spec ne définit que la part
   mensuelle des Zem. `unspecifiedProfile.rideCommissionPct` vaut donc 0 : mettre la
   valeur souhaitée dans `tarification.json` suffit à l'activer, sans toucher au code.
3. **Frais de retrait des LIVREUR / COURSIER** : non définis → 0 % aujourd'hui.

## 8. Migration de base de données

`prisma/migrations/20261005090000_tarification_gammes_et_niveaux/` :
- `VehicleType` : `ZEM` et `ZEM_ELECTRIC` → `GAZELLE`, `CAR` → `KOALA`, ajout de `LEOPARD` ;
- `AgencyPlan` : `ARGENT` → `SILVER`, limites et commissions réappliquées
  (le plafond PRO passe de 10 à 25 comptes) ;
- valeurs par défaut du modèle `Agency` alignées sur le niveau PRO.

> Les anciennes valeurs restent converties à la lecture (`legacyVehicleMapping`) pour
> tout environnement non encore migré : aucune course passée n'est perdue.
