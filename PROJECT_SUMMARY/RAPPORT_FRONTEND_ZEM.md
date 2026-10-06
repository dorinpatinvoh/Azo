# RAPPORT D'AVANCEMENT TECHNIQUE & FONCTIONNEL — FRONT-END MOBILE (AZƆ̀)

**Projet :** Plateforme de Mobilité, Transport & Livraison Urbaine **AZƆ̀** (Bénin)
**Périmètre :** Application Mobile Cross-Platform (`azo-mobile` — React Native / Expo)
**Objet du présent rapport :** nouveau **parcours de commande d'un Zem** (choix
essence / électrique), **affichage des barèmes officiels** et **radar chauffeur filtré par
véhicule**
**Destinataires :** Direction Générale & Responsables Techniques
**Date :** 06 Octobre 2026

---

## 1. Synthèse exécutive

L'application mobile applique la règle métier validée par la Direction : **commander un Zem
n'est plus « commander une course »**. Le client choisit d'abord **son type de moto-taxi**
(électrique ou essence), puis renseigne sa destination et suit le parcours habituel — tandis que
les noms **Gazelle / Koala / Léopard** ne sont plus proposés que pour les **voitures**.

Trois apports concrets pour l'utilisateur :

1. **Un écran dédié « Quel Zem veux-tu ? »** avec, sous chaque carte, **le tarif exact** du type
   choisi (base et paliers kilométriques) ;
2. **Un détail de prix transparent** qui décompose le montant poste par poste (base, puis chaque
   palier de kilomètres) ;
3. **Un radar chauffeur honnête** : chaque prestataire ne voit que les demandes correspondant au
   véhicule de son dossier, avec un bandeau qui l'indique explicitement.

Le barème affiché par l'application n'est **jamais codé en dur** : il vient de la configuration
partagée avec le serveur, et l'application calcule exactement le même prix que le backend
(vérification croisée effectuée sur toutes les bornes de distance).

---

## 2. Parcours client de la commande d'un Zem

### 2.1 Étape 1 — « Quel Zem veux-tu ? » (`RideBookingScreen`)

Un écran plein écran, avant toute saisie de destination, propose les **deux types de Zem** en
grandes cartes (icône moto thermique / moto électrique). Le tarif de chaque type est affiché
**sous sa carte**, construit depuis la configuration partagée :

> **Zem à essence** — *Moto-taxi thermique, partout en ville*
> `150 FCFA de base · 70 FCFA/km (0–15 km) · 60 FCFA/km (16–25 km) · 50 FCFA/km au-delà`
>
> **Zem électrique** — *Moto-taxi électrique, silencieux*
> `100 FCFA de base · 70 FCFA/km (0–15 km) · 60 FCFA/km (16–25 km) · 50 FCFA/km au-delà`

Une note de bas d'écran rappelle que **les paliers kilométriques sont identiques** pour les deux
et que **seule la base change** — l'écart (50 F) est lui aussi **calculé depuis la
configuration**, jamais écrit en dur.

### 2.2 Étape 2 — destination et suite du parcours

Une fois le type choisi, le client retrouve l'écran de réservation habituel : départ GPS,
destination (recherche, carte ou lieu favori), estimation, solde AZƆ̀ Pay et confirmation.
Un **bandeau de rappel** affiche le Zem retenu avec un bouton **« Changer »** qui ramène à
l'étape 1 **sans perdre le trajet déjà saisi**.

### 2.3 Filière voiture — deux étapes également

Le service « Voiture » suit désormais la même logique que le Zem (voir
[`PARCOURS_VOITURE.md`](./PARCOURS_VOITURE.md)) : un écran plein écran **« Quelle voiture
veux-tu ? »** liste les gammes **Gazelle**, **Koala · climatisé** et **Léopard · premium** en
**simples boutons** (aucun tarif à cette étape) ; le clic ouvre l'écran **« Ce à quoi tu as
droit »** (sécurité, climatisation *si la gamme la déclare*, atouts, **tarif officiel** base +
paliers, usage idéal), avec le bouton **« Accepter et continuer »**. La suite est le parcours
habituel : destination, estimation **au tarif de la gamme retenue**, confirmation. Un bandeau
rappelle la voiture choisie avec un bouton **« Changer »**. Aucun nom de gamme n'apparaît dans un
parcours Zem, et inversement.

### 2.4 Transparence du prix

Sous le prix estimé, le détail est reconstruit **palier par palier** :

```
Base 150 FCFA  +  15 km × 70 FCFA/km  +  10 km × 60 FCFA/km  +  5 km × 50 FCFA/km
```

*(un trajet de 12 km n'affiche qu'une seule ligne de palier : « Base 150 FCFA + 12 km ×
70 FCFA/km » ; en électrique, la base est de 100 FCFA.)*

---

## 3. Radar chauffeur filtré par véhicule

* Le **dossier prestataire** déclare le véhicule exact du conducteur, présenté en **deux
  groupes** dans le wizard d'enrôlement : **Moto-taxi (Zem)** — Zem à essence, Zem électrique —
  puis **Voiture** — Gazelle, Koala, Léopard. Le repli hors ligne embarque la même liste que
  celle servie par le serveur (`/providers/requirements`), avec les icônes moto thermique /
  moto électrique / voiture.
* L'écran **Radar** (`DriverHomeScreen`) affiche un bandeau explicite :
  « **Radar Zem à essence — tu ne vois que ces demandes.** », et l'état vide indique clairement
  qu'aucune demande **de ce véhicule** n'est disponible autour du chauffeur.
* Résultat : **un Zem à essence ne reçoit jamais une demande de Zem électrique**, et les
  coursiers ne reçoivent plus les demandes de transport (leur espace est celui des missions de
  livraison).

---

## 4. Socle technique et cohérence avec le serveur

| Élément | Mise en œuvre |
|---|---|
| Types | `VehicleType` = `ZEM_ESSENCE | ZEM_ELECTRIC | GAZELLE | KOALA | LEOPARD`, plus `VehicleFamily` (`ZEM` / `CAR`) |
| Barème embarqué | `services/tarification.ts` — `priceBreakdown()` reprend **le même algorithme** que le backend : base remisée + une ligne par palier, chaque poste tronqué en FCFA |
| Synchronisation | `config/tarification.json` régénéré par `npm run sync:tarification` depuis la source unique du backend ; rafraîchi au démarrage via `GET /pricing` |
| Hors ligne | Si le serveur ne répond pas, l'application affiche le barème embarqué — **jamais un prix inventé** |
| Libellés & icônes | `utils/rideDisplay.ts` centralise les libellés et icônes des 5 véhicules (moto essence, moto électrique, voiture, climatisée, premium) |
| Résolution | Les anciens types restent convertis à l'affichage (`ZEM → ZEM_ESSENCE`, `CAR → KOALA`) |

**Vérification croisée :** le moteur mobile a été exécuté sur toutes les bornes
(0 · 1 · 5 · 10 · 15 · 16 · 20 · 25 · 26 · 30 · 50 · 100 km) pour les **deux types de Zem** :
montants **identiques au backend**, au franc près, avec un **écart constant de 50 F**. La
compilation TypeScript de l'application est **sans erreur**.

---

## 5. Valeurs de contrôle pour les tests

| Distance affichée | Zem à essence | Zem électrique | Écart attendu |
|---|---|---|---|
| 3 km | 360 F | 310 F | 50 F |
| 5 km | 500 F | 450 F | 50 F |
| 10 km | 850 F | 800 F | 50 F |
| 15 km | 1 200 F | 1 150 F | 50 F |
| 16 km | 1 260 F | 1 210 F | 50 F |
| 18 km | 1 380 F | 1 330 F | 50 F |
| 25 km | 1 800 F | 1 750 F | 50 F |
| 30 km | 2 050 F | 2 000 F | 50 F |

**Voitures (inchangées) :** Gazelle 10 km = 2 800 F · Koala 8 km = 4 200 F ·
Léopard 20 km = 20 000 F.

**À vérifier en priorité :** le même trajet en essence puis en électrique doit toujours donner
**exactement 50 F d'écart** (l'électrique moins cher) — ni plus, ni moins — quelle que soit la
distance, et **jamais** l'inverse.

---

## 6. Fichiers livrés / mis à jour

| Fichier | Rôle & améliorations |
|---|---|
| `screens/RideBookingScreen.tsx` | **Étape 1 dédiée** « Quel Zem veux-tu ? » (tarif par type) et, pour la voiture, « Quelle voiture veux-tu ? » (boutons seuls) puis « Ce à quoi tu as droit » (`carEntitlements`, tarif officiel) ; bandeau « Changer » commun, détail du prix **par palier** |
| `screens/DriverHomeScreen.tsx` | Bandeau « Radar *véhicule* — tu ne vois que ces demandes », état vide explicite, lecture du véhicule du dossier |
| `screens/ProviderOnboardingScreen.tsx` | Choix de véhicule en **deux filières** (Moto-taxi / Voiture), icônes moto essence, moto électrique, voiture |
| `services/tarification.ts` | `priceBreakdown()` (base remisée + paliers), `isZem` / `vehicleFamily`, résolution des anciens types |
| `services/api.ts` | Types `VehicleType` (5 véhicules), `VehicleFamily`, `Estimate.breakdown` (base remisée + paliers) |
| `utils/rideDisplay.ts` | Libellés et icônes des 5 véhicules, jeux de démonstration cohérents |
| `screens/LiveTrackingScreen.tsx`, `screens/HomeScreen.tsx`, `screens/RideRequestScreen.tsx` | Libellés des véhicules, tuile d'accueil « Zem — Essence ou électrique », écran historique aligné |
| `config/tarification.json` | Copie embarquée du barème, synchronisée avec le backend |

---

## 7. Points de vigilance et chantiers ouverts

1. **Environnement de test :** le serveur Render de production n'est pas encore à jour
   (`GET /pricing` y répond 404). Pour tester, l'application doit pointer sur **le backend local**
   de la machine (sélecteur de serveur de l'écran de connexion, ou `EXPO_PUBLIC_API_URL`).
2. **Démonstration à un seul chauffeur :** passer `"radar": { "strictVehicleMatch": false }`
   dans `azo-backend/src/pricing/tarification.json` puis `npm run sync:tarification` — les deux
   Zem partageront leurs demandes.
3. **Écran de notation factice :** `RideRatingScreen` affiche encore des valeurs de démonstration
   (« #8492 », nom du chauffeur, montant du pourboire) ; seul le nombre d'étoiles est envoyé.
4. **Code Bouclier** affiché au client mais non obligatoire côté serveur, et dérivé de
   l'identifiant de course.
5. **Aucune notification poussée** : client et chauffeur « pollent » le serveur (3 s / 8 s).
6. **Filière coursier / livraison** : libellés de véhicules inchangés dans l'immédiat.
7. **Configuration EAS** (`app.json` : `projectId`, `updates.url`, permissions) : présente sur la
   branche `arena/01a10bd9-azo` uniquement ; à rapatrier si un build APK doit être produit depuis
   la branche de travail.

---

## 8. Documents de référence

| Document | Contenu |
|---|---|
| `PROJECT_SUMMARY/PARCOURS_ZEM.md` | Déroulé complet de la commande d'un Zem, prix de référence, filtrage du radar |
| `PROJECT_SUMMARY/PARCOURS_VOITURE.md` | Déroulé complet de la commande d'une voiture (boutons de gamme, « Ce à quoi tu as droit », tarifs) |
| `PROJECT_SUMMARY/TARIFICATION.md` | Barèmes officiels (Zem et voitures), modèle de calcul, profils, migrations |
| `PROJECT_SUMMARY/RAPPORT_BACKEND_ZEM.md` | Rapport back-end correspondant (modèle, API, tests, migration) |
| `PROJECT_SUMMARY/GUIDE_TEST_CLIENT.md` | Guide de test pas-à-pas des cinq espaces, mis à jour |
