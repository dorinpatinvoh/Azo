# Tarification AZƆ̀ — Véhicules, tarifs et profils

Implémentation de la spécification métier **« Tarifs et profils »** (courses, agences,
profils prestataires). Devise : **FCFA, montants entiers**.

**Modèle de calcul** — `prix = base (remisée le cas échéant) + somme des paliers kilométriques`.
Chaque véhicule porte **ses propres paliers** (`brackets: [{ upToKm, perKm }, …]`, le dernier
portant `upToKm: null` = illimité) et, en option, une **remise de base**
(`baseDiscount: { pct, aboveKm }`). Tout est lu dans la configuration : un nouveau barème se
règle sans toucher au code.

Depuis le **5 octobre 2026**, les véhicules sont répartis en **deux filières distinctes** :

| Filière | Types de véhicules | Usage |
|---|---|---|
| **Moto-taxi (Zem)** | `ZEM_ESSENCE`, `ZEM_ELECTRIC` | Commande d'un Zem : le client choisit d'abord *essence* ou *électrique* |
| **Voiture** | `GAZELLE`, `KOALA`, `LEOPARD` | Courses en voiture (entrée de gamme, climatisée, premium) |

> **Les noms Gazelle / Koala / Léopard ne désignent plus que des voitures.** Ils ne
> s'appliquent jamais à un Zem.

## 1. Source unique de configuration

| Fichier | Rôle |
|---|---|
| `azo-backend/src/pricing/tarification.json` | **Source de vérité** : véhicules et filières, paliers km, niveaux d'agence, profils, radar. |
| `azo-backend/src/pricing/tarification.config.ts` | Chargement + validation de la config (erreur explicite si une clé manque). |
| `azo-backend/src/pricing/pricing.service.ts` | Tous les calculs (prix de course, commissions, frais de retrait, prélèvement mensuel, visibilité des demandes). |
| `azo-backend/src/pricing/pricing.module.ts` | Module Nest + route publique `GET /pricing` (l'app mobile lit le même barème). |
| `azo-mobile/config/tarification.json` | Copie embarquée pour l'affichage hors ligne, synchronisée par `npm run sync:tarification`. |

Aucune règle de prix n'est codée en dur dans la logique métier. Le barème peut être
remplacé sans recompiler le code via `TARIFICATION_CONFIG_PATH=/chemin/tarification.json`
(fichier monté, volume, export base de données). La config est validée au démarrage :
une clé absente ou non numérique fait échouer le démarrage avec un message explicite.

## 2. Prix d'une course

`prix = base + Σ (kilomètres du palier × prix_km du palier)`, chaque poste **tronqué** en
FCFA entiers. Les paliers sont cumulatifs depuis l'origine : un trajet de 12 km facture les
10 premiers kilomètres au tarif du palier 1, puis les 2 suivants au tarif du palier 2.

### 2.1 Filière Zem — motos-taxis

**Mêmes paliers kilométriques pour les deux types : seule la base diffère.**

| Type | Base | 0 → 15 km | 16 → 25 km | 26 km et + | Remise de base |
|---|---|---|---|---|---|
| **ZEM_ESSENCE** (moto à essence) | **150** | **70** / km | **60** / km | **50** / km | aucune |
| **ZEM_ELECTRIC** (moto électrique) | **100** | **70** / km | **60** / km | **50** / km | aucune |

**Décisions validées (6 octobre 2026)**

1. Les **paliers sont communs aux deux types** : **70 F/km de 0 à 15 km**, **60 F/km de 16 à
   25 km**, **50 F/km à partir du 26e km**. Le dernier palier de la progression est le 50 F/km :
   au-delà de 25 km, c'est ce tarif qui continue de s'appliquer. Un test vérifie que les deux
   barèmes sont **strictement identiques**, bornes et tarifs compris.
2. **Seule la base diffère** : **150 F** pour le Zem à essence, **100 F** pour le Zem électrique.
   L'écart de prix entre les deux types est donc **constant : 50 F**, quelle que soit la distance
   — vérifié par un test sur toutes les bornes (0 · 3 · 10 · 15 · 16 · 25 · 26 · 30 · 60 · 100 km).
3. **Aucune remise de base** : la remise de 25 % du barème précédent est supprimée. La base est
   due **en entier**, dès que la course est acceptée.
4. Le client n'est débité qu'à la **fin** de la course (aucun débit avant le départ).

### 2.2 Filière Voiture

| Gamme | Base | 0 → 15 km | 16 km et + | Remise de base |
|---|---|---|---|---|
| **GAZELLE** (entrée de gamme) | 800 | 200 / km | 150 / km | aucune |
| **KOALA** (intermédiaire, **climatisé**) | 1 200 | 375 / km | 350 / km | aucune |
| **LEOPARD** (haut de gamme) | 2 500 | 900 / km | 800 / km | aucune |

Montants inchangés (décision du 5 octobre 2026) : les grilles voitures restent celles de la
spécification initiale, avec leur palier à 15 km et **sans remise de base**.

### 2.3 Exemples vérifiés par les tests

**Zem à essence** — base 150 F

| Exemple | Calcul | Prix |
|---|---|---|
| 0 km | 150 | **150** |
| 5 km | 150 + 5 × 70 | **500** |
| 10 km | 150 + 10 × 70 | **850** |
| 15 km | 150 + 15 × 70 | **1 200** |
| 16 km | 150 + 15 × 70 + 1 × 60 | **1 260** |
| 25 km | 150 + 15 × 70 + 10 × 60 | **1 800** |
| 26 km | 150 + 1 050 + 600 + 1 × 50 | **1 850** |
| 30 km | 150 + 1 050 + 600 + 5 × 50 | **2 050** |
| 100 km | 150 + 1 050 + 600 + 75 × 50 | **5 550** |

**Zem électrique** — base 100 F (soit **exactement 50 F de moins** à chaque distance)

| Exemple | Calcul | Prix |
|---|---|---|
| 0 km | 100 | **100** |
| 5 km | 100 + 5 × 70 | **450** |
| 10 km | 100 + 10 × 70 | **800** |
| 15 km | 100 + 15 × 70 | **1 150** |
| 16 km | 100 + 15 × 70 + 1 × 60 | **1 210** |
| 25 km | 100 + 15 × 70 + 10 × 60 | **1 750** |
| 26 km | 100 + 1 050 + 600 + 1 × 50 | **1 800** |
| 30 km | 100 + 1 050 + 600 + 5 × 50 | **2 000** |
| 100 km | 100 + 1 050 + 600 + 75 × 50 | **5 500** |

> 💡 Repère de test : à **30 km**, l'électrique est à **2 000 F** contre **2 050 F** en essence ;
> à **10 km**, 800 F contre 850 F. L'écart est **toujours de 50 F**, jamais autre chose.

**Voitures**

| Exemple | Calcul | Prix |
|---|---|---|
| GAZELLE 10 km | 800 + 10 × 200 | **2 800** |
| GAZELLE 20 km | 800 + 15 × 200 + 5 × 150 | **4 550** |
| KOALA 10 km | 1 200 + 10 × 375 | **4 950** |
| KOALA 20 km | 1 200 + 15 × 375 + 5 × 350 | **8 575** |
| LEOPARD 20 km | 2 500 + 15 × 900 + 5 × 800 | **20 000** |

*Convention de montant* : FCFA entiers, **sans arrondi** — chaque poste est tronqué
(`Math.floor`). La distance est convertie en millimètres entiers avant multiplication pour
éviter les artefacts de virgule flottante (20,9 km : 20,9 − 15 = 5,9 → ⌊5,9 × 60⌋ = 354 F,
soit 150 + 1 050 + 354 = **1 554 F** en essence).

Le **même calcul** existe côté application (`azo-mobile/services/tarification.ts`,
`priceBreakdown`) pour l'affichage hors ligne : une vérification croisée a confirmé des montants
identiques au backend, **pour les deux types de Zem**, sur toutes les bornes
(0 · 1 · 5 · 10 · 15 · 16 · 20 · 25 · 26 · 30 · 50 · 100 km), avec un écart constant de 50 F.

## 3. Radar des demandes (filtrage par véhicule)

`GET /rides/pending` ne renvoie plus toutes les demandes : chaque prestataire reçoit
uniquement les courses correspondant au **véhicule déclaré dans son dossier**.

| Situation | Visibilité |
|---|---|
| Zem à essence | demandes **ZEM_ESSENCE** uniquement |
| Zem électrique | demandes **ZEM_ELECTRIC** uniquement |
| Gazelle / Koala / Léopard | demandes de la **même gamme exacte** (jamais de demande Zem) |
| Coursier / livreur | aucune demande de transport (son espace est `GET /delivery/available`) |
| Compte conducteur sans véhicule déclaré (historique) | aucune demande masquée |

Le comportement se règle dans `tarification.json` :

```json
"radar": { "strictVehicleMatch": true }
```

`false` (mode démarrage / démonstration) fait **partager les demandes entre les deux
types de Zem** — pratique quand un seul type de Zem est enrôlé — tout en gardant les
voitures filtrées par gamme exacte.

## 4. Profils prestataires

| Profil | Catégorie | Part mensuelle | Frais de retrait | Commission par course |
|---|---|---|---|---|
| **ZEM_INDEPENDANT** (les 2 types de Zem) | — | **15 % des revenus du mois** (jamais par course) — *validé* | **1,5 %** — *validé* | **0** — *validé* |
| **LIVREUR** | `INDEPENDANT_PERSONNEL` | ⚠️ **règle à définir** (0 provisoire) | **1,5 %** (identique au Zem) | ⚠️ **règle à définir** (0 provisoire) |
| **COURSIER** | `INDEPENDANT_PERSONNEL` | ⚠️ **règle à définir** (0 provisoire) | **1,5 %** (identique au Zem) | ⚠️ **règle à définir** (0 provisoire) |

Le profil `ZEM_INDEPENDANT` s'applique aux **deux** types de Zem (essence et électrique),
détectés par la **filière** du véhicule (`family: "ZEM"`) et non plus par un nom de gamme.

Un profil non décrit par la spécification (ex. conducteur indépendant d'une gamme
KOALA/LEOPARD) suit la règle `unspecifiedProfile` : aucun prélèvement tant que le métier
ne l'a pas tranché — ⚠️ lui aussi **à définir** s'il doit être facturé.

Les valeurs provisoires sont **explicitement listées** dans la section `aDefinir` de
`tarification.json` (chemin, valeur, note « règle à définir »), en plus d'un
avertissement `_aDefinir` dans chaque section concernée. Un test échoue si une valeur
provisoire est modifiée sans mise à jour de cette liste, et si une règle validée y est
ajoutée par erreur : impossible de confondre les deux.

## 5. Niveaux d'agence

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

## 6. Endpoints

| Endpoint | Description |
|---|---|
| `GET /pricing` | Barème complet (véhicules + filières, paliers, niveaux, profils, radar) — lecture seule. |
| `POST /rides/estimate` | Prix d'une course (distance + véhicule) : base remisée, une ligne par palier, filière. |
| `GET /rides/pending` | Demandes visibles par **ce** chauffeur (filtre véhicule + exclusion des coursiers). |
| `POST /rides/:id/complete` | Commission réelle (niveau d'agence ou profil) ; refuse une agence non activée. |
| `POST /agencies/activate` | Paiement unique des frais d'activation du niveau (débit AZƆ̀ Pay). |
| `POST /agencies/drivers` | Rattachement : vérifie l'activation puis la limite de comptes. |
| `GET /agencies/dashboard` | Commission %, frais de retrait %, activation, quota utilisés/total. |
| `GET /wallet/withdrawal-quote?amount=` | Frais de retrait applicables (profil 1,5 % / niveau d'agence). |
| `POST /wallet/withdraw` | Retrait : frais prélevés, net versé, solde débité du montant. |
| `POST /admin/settlements/zem-monthly` | Prélèvement mensuel des Zem indépendants (15 %), idempotent, période `AAAA-MM` optionnelle. |

## 7. Tests

```bash
cd azo-backend && npm test
```

51 tests couvrent les exemples voitures de la spécification, les bornes de tranches (15 km,
16 km), la troncature, la conversion des anciens types de véhicules, **un cas par niveau
d'agence** (activation, commission, frais de retrait, plafond), les profils prestataires
(Zem 15 %/mois + 1,5 % par retrait ; LIVREUR & COURSIER : 1,5 % par retrait, règles restantes
marquées « à définir »), le **barème Zem** (bases 150 F à essence et 100 F en électrique,
paliers communs 70 / 60 / 50 F/km aux bornes 15 km · 16 km · 25 km · 26 km, écart constant de
50 F, aucune remise de base), l'absence de remise sur les voitures et le **filtrage du radar**
(strict et souple).

## 8. Valeurs provisoires « règle à définir »

| Chemin dans la config | Valeur provisoire | Statut |
|---|---|---|
| `delivery.commissionPct` | 15 | ⚠️ **Règle à définir** — aucun tarif de livraison validé. Valeur conservée telle quelle, non modifiée, à ne pas présenter comme une règle métier. |
| `profiles.LIVREUR.monthlyRevenueSharePct` | 0 | ⚠️ **Règle à définir** — le 0 provisoire ne signifie **pas** « aucun frais, définitivement ». |
| `profiles.LIVREUR.rideCommissionPct` | 0 | ⚠️ **Règle à définir** — idem. |
| `profiles.COURSIER.monthlyRevenueSharePct` | 0 | ⚠️ **Règle à définir** — idem. |
| `profiles.COURSIER.rideCommissionPct` | 0 | ⚠️ **Règle à définir** — idem. |

Ces valeurs se changent **dans `tarification.json` uniquement** (aucun code à toucher).
Règles validées, à ne pas confondre : barème Zem (base 150 F à essence et 100 F en électrique ;
paliers communs 70 / 60 / 50 F/km), grille des voitures, profil Zem indépendant (15 %/mois + 1,5 % par retrait, 0 par course), frais de
retrait LIVREUR/COURSIER identiques au Zem (1,5 %), prix par tranches, activation unique
des agences, plafonds de comptes, filtrage du radar.

## 9. Migrations de base de données

`prisma/migrations/20261005090000_tarification_gammes_et_niveaux/` (historique) :
- `VehicleType` : `ZEM` et `ZEM_ELECTRIC` → `GAZELLE`, `CAR` → `KOALA`, ajout de `LEOPARD` ;
- `AgencyPlan` : `ARGENT` → `SILVER`, limites et commissions réappliquées
  (le plafond PRO passe de 10 à 25 comptes) ;
- valeurs par défaut du modèle `Agency` alignées sur le niveau PRO.

`prisma/migrations/20261005140000_zem_essence_et_electrique/` (5 octobre 2026) :
- `VehicleType` gagne **`ZEM_ESSENCE`** et **`ZEM_ELECTRIC`** ; `GAZELLE`, `KOALA` et
  `LEOPARD` ne désignent plus que des **voitures** ;
- conversion des données : `Ride.vehicleType = 'GAZELLE'` → `'ZEM_ESSENCE'` (la Gazelle
  était le moto-taxi jusqu'ici) et idem pour les dossiers `ProviderProfile.type = 'DRIVER'` ;
- la filière **coursier** (livraison) reste volontairement inchangée pour l'instant.

> Les anciennes valeurs restent converties à la lecture (`legacyVehicleMapping` : `ZEM` →
> `ZEM_ESSENCE`, `CAR` → `KOALA`) pour tout environnement non encore migré : aucune course
> passée n'est perdue.

## 10. Documentation du parcours client

Le déroulé complet de la commande d'un Zem (choix du type, destination, estimation,
acceptation, Code Bouclier, paiement, notation) est décrit dans
[`PARCOURS_ZEM.md`](./PARCOURS_ZEM.md).

Le parcours de commande d'une voiture (boutons de gamme, explication, tarifs appliqués) est
décrit dans [`PARCOURS_VOITURE.md`](./PARCOURS_VOITURE.md).

Les rapports d'avancement de ce chantier :
[`RAPPORT_BACKEND_ZEM.md`](./RAPPORT_BACKEND_ZEM.md) (modèle, API, barème, tests, migration) et
[`RAPPORT_FRONTEND_ZEM.md`](./RAPPORT_FRONTEND_ZEM.md) (parcours client, écrans, radar, valeurs de contrôle).
