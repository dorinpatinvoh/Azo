# Parcours d'une commande de voiture — AZƆ̀

Document de référence du parcours **« Je commande une voiture »** tel qu'il fonctionne
aujourd'hui dans l'application (mise à jour du 6 octobre 2026). Le parcours du Zem est décrit
dans [`PARCOURS_ZEM.md`](./PARCOURS_ZEM.md) ; les barèmes officiels sont dans
[`TARIFICATION.md`](./TARIFICATION.md).

## 1. Principe

Trois gammes de voiture sont proposées : **Gazelle**, **Koala** et **Léopard**. Ces trois noms
sont **réservés aux voitures** et n'apparaissent jamais dans la commande d'un Zem.

| Gamme | Libellé client | Base | 0 → 15 km | 16 km et + | Climatisation |
|---|---|---|---|---|---|
| `GAZELLE` | **Gazelle** | 800 F | 200 F/km | 150 F/km | non |
| `KOALA` | **Koala · climatisé** | 1 200 F | 375 F/km | 350 F/km | **oui** |
| `LEOPARD` | **Léopard · premium climatisé** | 2 500 F | 900 F/km | 800 F/km | **oui** |

Aucune remise de base n'est appliquée aux voitures. Le barème est **le même que celui de la
spécification initiale** : il n'a pas changé avec la refonte de la filière Zem.

> ℹ️ La climatisation est annoncée dans l'application **quand le barème la déclare**
> (`airConditioned` dans `tarification.json`) : c'est le cas du **Koala** et du **Léopard**,
> les deux voitures de confort. La Gazelle (entrée de gamme) ne l'est pas. Décision du
> 6 octobre 2026 — le Léopard étant une voiture de luxe, il est climatisé.

## 2. Déroulé complet

### Étape 1 — « Quelle voiture veux-tu ? » (nouvelle)

Un écran plein écran, **avant** toute saisie de destination, ne liste que les gammes, sous forme
de **boutons** : **Gazelle**, **Koala · climatisé**, **Léopard · premium climatisé**. Aucun tarif, aucune
description à cette étape : le client choisit d'abord la voiture qu'il veut emprunter.

### Étape 1 bis — « Ce à quoi tu as droit »

Le clic sur une gamme ouvre l'écran d'explication, construit depuis la configuration partagée :
sécurité (conducteur vérifié, trajet suivi), climatisation *si la gamme est déclarée climatisée*,
les atouts de la gamme, **le tarif officiel** (base, puis chaque palier) et l'usage idéal.
Deux issues :

* **« Accepter et continuer »** — la gamme est retenue et le client passe au choix de la
  destination ;
* **« Voir les autres voitures »** ou la flèche de retour — retour à la liste des gammes.

### Étape 2 — Destination, estimation et confirmation

Le client retrouve l'écran de réservation habituel : départ GPS, destination (recherche, carte ou
lieu favori), puis **le tarif de la gamme retenue** — base, puis une ligne par palier de
kilomètres. Un bandeau rappelle la voiture choisie, avec un bouton **« Changer »** qui ramène à la
liste des gammes. La confirmation crée la course et l'écran de suivi prend le relais.

### Côté chauffeur

Le radar applique la même règle que pour les Zem : un conducteur ne reçoit que les demandes de
**son** véhicule (Gazelle ≠ Koala ≠ Léopard), dans son **rayon de recherche** (8 km par défaut)
et **non expirées** (20 min par défaut). Réglages et notifications :
[`MATCHING_ET_NOTIFICATIONS.md`](./MATCHING_ET_NOTIFICATIONS.md).

## 3. Tarifs appliqués (exemples vérifiés)

| Trajet | Gazelle | Koala (climatisé) | Léopard (premium climatisé) |
|---|---|---|---|
| 5 km | 800 + 5 × 200 = **1 800 F** | 1 200 + 5 × 375 = **3 075 F** | 2 500 + 5 × 900 = **7 000 F** |
| 10 km | 800 + 10 × 200 = **2 800 F** | 1 200 + 10 × 375 = **4 950 F** | 2 500 + 10 × 900 = **11 500 F** |
| 15 km | 800 + 15 × 200 = **3 800 F** | 1 200 + 15 × 375 = **6 825 F** | 2 500 + 15 × 900 = **16 000 F** |
| 16 km | 800 + 3 000 + 150 = **3 950 F** | 1 200 + 5 625 + 350 = **7 175 F** | 2 500 + 13 500 + 800 = **16 800 F** |
| 20 km | 800 + 3 000 + 5 × 150 = **4 550 F** | 1 200 + 5 625 + 5 × 350 = **8 575 F** | 2 500 + 13 500 + 5 × 800 = **20 000 F** |

## 4. Où le parcours vit dans le code

| Fichier | Rôle |
|---|---|
| `azo-mobile/screens/RideBookingScreen.tsx` | Écran « Quelle voiture veux-tu ? », écran « Ce à quoi tu as droit » (`carEntitlements`), bandeau « Changer », estimation et confirmation |
| `azo-mobile/services/tarification.ts` | `priceBreakdown()` — base + paliers, identique au backend ; `CAR_VEHICLES` |
| `azo-mobile/config/tarification.json` | Barème embarqué, synchronisé avec le backend |
| `azo-backend/src/pricing/tarification.json` | Source unique des tarifs (base, paliers, climatisation) |

## 5. Points connus / chantiers ouverts

* **Notifications poussées** : aucun envoi au chauffeur — client et conducteur interrogent le
  serveur à intervalle régulier (3 s / 8 s).
* **Aucun dispatch par proximité** : pas de rayon de recherche ni d'expiration de demande.
* **Écran de notation factice** : `RideRatingScreen` affiche encore des valeurs de démonstration.
* **Production Render non à jour** : le barème n'y est pas encore déployé (décision assumée).
