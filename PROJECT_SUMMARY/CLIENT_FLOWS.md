# Parcours client — AZƆ̀

Ce document décrit les parcours clients proposés pour les principales fonctionnalités : Livraison, Course, Location, Marketplace et Wallet.

## 1. Livraison (Delivery)

- Écran 1: Saisie des informations colis (type, dimensions, description)
- Écran 2: Saisie adresses de pickup et drop (récupération via géolocalisation ou saisie manuelle)
- Écran 3: Sélection du payeur (Sender/Recipient) et estimation prix
- Écran 4: Confirmation + génération d'un `pickupCode` côté backend
- Backend : création de `Delivery` en base (status: PENDING)
- Matching : assignation d'un coursier (manuel/auto) -> status MATCHED
- Livraison : codes vérifiés au pickup et à la livraison, suivi temps réel via WebSocket
- Paiement : via `Wallet` (si solde suffisant) ou via passerelle externe
- Écran final: récapitulatif + reçu + option noter le coursier

Points techniques:
- Générer `pickupCode` et `deliveryCode` stockés dans `Delivery`.
- WebSocket pour mise à jour de status et position du coursier (`rides.gateway.ts` déjà existant).
- Vérifier payer par wallet et créer `Transaction`.

## 2. Course (Ride)

> **Mise à jour des 5 et 6 octobre 2026 — deux filières distinctes :**
> **Zem** (moto-taxi) et **Voiture** ne partagent plus le même parcours.
> Le détail complet est dans [`PARCOURS_ZEM.md`](./PARCOURS_ZEM.md).

**Parcours Zem (`ZEM_ESSENCE` / `ZEM_ELECTRIC`)**
- Écran 0: Interface « Quel Zem veux-tu ? » — **Zem à essence** (**150 F** de base) ou
  **Zem électrique** (**100 F** de base) ; **mêmes paliers pour les deux** : **70 / 60 / 50 F/km**
  (0–15, 16–25, 26 km et +), aucune remise — l'électrique est donc toujours 50 F moins cher
- Écran 1: Demande (origine/destination) + rappel du Zem choisi (bouton « Changer »)
- Écran 2: Estimation prix + confirmation (paiement AZƆ̀ Pay)

**Parcours Voiture (`GAZELLE` / `KOALA` / `LEOPARD`)**
- Écran 1: Demande (origine/destination) + choix de la gamme de voiture
- Écran 2: Estimation prix + confirmation

**Commun**
- Radar chauffeur : chaque prestataire ne reçoit que les demandes de **son** véhicule
  (un Zem à essence ne voit pas les demandes de Zem électrique).
- Backend : création de `Ride` (PENDING)
- Matching : recherche manuelle (les chauffeurs *pollent* `GET /rides/pending`) -> MATCHED
- Suivi : position du driver en temps réel via Socket.IO
- Fin de course : calcul prix final, prélèvement (wallet / PSP), création `Transaction`
- Notation : écran de notation après la course

Points techniques:
- Utiliser `originLat/originLng/destLat/destLng` du modèle `Ride`.
- Matching basé sur distance (PostGIS ou calcul haversine côté serveur).
- WebSocket/Socket.IO pour notifications et position.

## 3. Location véhicule (Rental)

- Écran 1: Sélection véhicule + formules (journée, week-end)
- Écran 2: Calendrier / durée + estimation prix
- Écran 3: Paiement ou réservation par wallet
- Backend : création de `RentalBooking` (status: pending)
- Confirmation agence: acceptation -> status confirmé

Points techniques:
- Gestion de disponibilité, calendrier et conflits.
- Intégration avec wallet et génération de `Transaction`.

## 4. Marketplace (Orders + Escrow)

- Écran 1: Saisie market, items (label, note, price)
- Écran 2: Résumé + paiement en séquestre (escrow)
- Backend : création de `MarketplaceOrder` (status: escrowed)
- Livraison/confirmation : changement de status vers delivered -> libération des fonds
- Dispute / remboursement : workflow de remboursement

Points techniques:
- Stocker `items` en JSON dans `MarketplaceOrder`.
- Modifier `wallet` et `transactions` pour support escrow (fonds bloqués jusqu'à confirmation).

## 5. Wallet & Paiements

- Écran: solde, historique transactions, recharger (card / mobile money), envoyer/retenir
- Backend : `Wallet`, `Transaction` existants
- Actions: crédit/débit, cashback, commissions agences

Points techniques:
- Atomicité des opérations (transactions DB) pour éviter double prélèvement.
- Webhook pour PSP externes.

## Améliorations UX recommandées

- Feedback en temps réel (loader, états réseau). 
- Gestion d'erreurs et retry pour requêtes critiques (confirmations, paiements).
- Écrans minimaux pour onboarding (OTP) et récupération d'accès.
- Historique accessible et filtres pour commandes/trajets/transactions.

## APIs à prioriser

- `POST /auth/otp` — demander OTP
- `POST /auth/verify` — vérifier OTP
- `POST /rides` — créer une course
- `GET /rides/:id` — état et position
- `POST /deliveries` — créer livraison
- `POST /marketplace/orders` — créer commande
- `POST /wallet/charge` — recharger wallet

---

Fichier généré automatiquement pour résumé rapide.
