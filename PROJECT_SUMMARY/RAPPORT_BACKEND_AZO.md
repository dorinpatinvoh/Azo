# RAPPORT D'AVANCEMENT TECHNIQUE & ARCHITECTURE — BACK-END & API (AZƆ̀)

**Projet :** Plateforme de Mobilité, Transport & Livraison Urbaine **AZƆ̀** (Bénin)  
**Périmètre :** Serveur API, WebSockets Temps Réel & Base de Données (`azo-backend` — NestJS / Socket.IO / Prisma / PostgreSQL)  
**URL de Production :** `https://azo-backend.onrender.com`  
**Destinataires :** Direction Générale & Responsables Techniques  
**Date :** 03 Octobre 2026  

---

## 1. Synthèse Exécutive

Les travaux réalisés aujourd'hui sur le serveur **AZƆ̀ (`azo-backend`)** ont permis de déployer deux évolutions majeures en complément du socle de production hébergé sur **Render Cloud** :
1. **Le Volet 1 « Sécurité des Trajets & Communication Temps Réel »**, intégrant un canal de **messagerie instantanée chiffrée (WebSocket + REST)** entre le client et le prestataire ainsi que la vérification serveur du **Code de sécurité à 4 chiffres (« Bouclier AZƆ̀ »)** pour autoriser le démarrage d'une course.
2. **L'enrôlement juridique, fiscal et opérationnel complet des Agences au Bénin (`AGENCY`)**, prenant en charge l'identité détaillée et le **NPI (ANIP à 10 chiffres)** du représentant légal, l'**IFU de l'entreprise (13 chiffres DGI)**, le **numéro RCCM (GUFE)**, le **type d'agence**, la **forme juridique**, le **siège social**, la **taille du parc** et le **compte Mobile Money professionnel de reversement**.

---

## 2. Volet 1 — Messagerie Temps Réel & Code de Sécurité « Bouclier AZƆ̀ » (`src/rides/`)

### 2.1. Passerelle WebSocket & API REST de Messagerie In-App (`rides.gateway.ts`, `rides.controller.ts`, `rides.service.ts`)
Afin de permettre aux passagers, expéditeurs, chauffeurs et coursiers d'échanger sans jamais exposer leurs numéros de téléphone personnels :
- **Canal Temps Réel Socket.IO (`RidesGateway`)** :
  - Gestion de l'événement `@SubscribeMessage("ride:chat")` diffusant instantanément chaque message aux participants connectés à la salle (`room`) de la course ou de la livraison (`ride:{rideId}`).
  - Stockage structuré des messages de mission (`chatStore`) avec horodatage ISO, rôle de l'expéditeur (`CLIENT`, `DRIVER`, `COURIER`) et nom anonymisé.
- **Endpoints REST de Synchronisation & Secours (3G/4G)** :
  - `GET /rides/:id/messages` : Récupère l'historique des messages de la course ou de la livraison active lors de l'ouverture de la fenêtre de discussion.
  - `POST /rides/:id/messages` : Permet l'envoi de messages via HTTP classique avec diffusion automatique sur le canal WebSocket `ride:chat`, garantissant une fiabilité à 100 % même en cas de micro-coupure réseau mobile à Cotonou.

### 2.2. Vérification Serveur du Code « Bouclier AZƆ̀ » à 4 Chiffres (`POST /rides/:id/start`)
- **Algorithme déterministe de génération (`rideSecurityPin(rideId)`)** : Chaque course possède un code PIN unique à **4 chiffres** (ex. `4829`) calculé de manière déterministe à partir de l'identifiant de la course.
- **Contrôle strict au démarrage (`RidesService.start`)** :
  - Lorsqu'un chauffeur appelle `POST /rides/:id/start`, le serveur vérifie le code `pin` fourni.
  - Si le code PIN est erroné, le serveur rejette la requête (`400 BadRequestException : « Code de sécurité Bouclier AZƆ̀ invalide »`) et maintient la course au statut `ACCEPTED`.
  - Dès que le code exact est validé, la course passe au statut `IN_PROGRESS` et l'événement temps réel `ride:status` notifie immédiatement le client.

---

## 3. Enrôlement Juridique & Fiscal Complet des Agences Bénin (`src/providers/providers.module.ts`)

### 3.1. Nouveaux Champs Réglementaires & Métier (`SaveApplicationDto` & `AgencyDetails`)
Le module `ProvidersModule` accepte, valide et normalise désormais l'ensemble des informations requises pour l'immatriculation d'une agence partenaire au Bénin :

| Catégorie | Champ API (`SaveApplicationDto`) | Règle de Validation & Normalisation Back-End |
| :--- | :--- | :--- |
| **Type d'exploitation** | `agencyType` | `FLOTTE_ZEM`, `FLOTTE_VOITURE`, `FLOTTE_LIVRAISON`, ou `FLOTTE_MIXTE` |
| **Représentant légal** | `representativeLastName` | Nom de famille du dirigeant (nettoyé et validé) |
| **Représentant légal** | `representativeFirstName` | Prénom(s) du dirigeant (composition automatique de `fullName`) |
| **Représentant légal** | `representativeRole` | Fonction : *Gérant*, *Directeur Général*, *Associé-Gérant*, *Président / Fondateur* |
| **Identité ANIP** | `representativeNpi` | **NPI (Numéro Personnel d'Identification)** — chiffres uniquement (10 chiffres ANIP) |
| **Entreprise** | `agencyName` & `legalForm` | Raison sociale & Forme juridique (*SARL*, *SAS / SA*, *EI*, *Coopérative / GIE*) |
| **Fiscalité DGI** | `ifuNumber` | **Identifiant Fiscal Unique (IFU)** — extraction stricte des **13 chiffres** DGI Bénin |
| **Registre GUFE** | `rccmNumber` | **Numéro RCCM** normalisé en majuscules (ex. `RB/COT/24 B 38412`) |
| **Localisation** | `headquartersAddress` | Adresse complète du siège social (Ville, Quartier, Ilot, Immeuble) |
| **Contact & Reversement** | `businessPhone`, `businessEmail`, `payoutPhone` | Téléphone pro (`01...`), Email pro en minuscules, Compte MoMo Entreprise (`01...`) |
| **Capacité & Formule** | `fleetSize` & `plan` | Taille du parc (`0` à `10 000` véhicules) & Formule (`PRO`, `ARGENT`, `OR`, `DIAMANT`) |

### 3.2. Contrôle de Complétude avant Soumission (`missingFields`)
Lorsqu'une agence appelle `POST /providers/applications/:id/submit`, le serveur vérifie désormais — en plus de la raison sociale, de la ville, de la formule et des photos obligatoires (`SELFIE` + `CNI`) — la présence effective :
1. Du **NPI du représentant légal (10 chiffres ANIP)** ;
2. Du **numéro IFU de l'entreprise (13 chiffres DGI)** ;
3. Du **numéro RCCM de l'entreprise (GUFE)**.

### 3.3. Persistance Structurée Sans Migration Destructive (`parseAgencyDetails` & `serialize`)
- Afin de préserver l'intégrité des bases PostgreSQL existantes (en local comme sur **Render**) sans nécessiter de réinitialisation de table, les métadonnées légales et fiscales de l'agence sont sérialisées en JSON structuré dans `ProviderProfile.bio` et synchronisées avec `ProviderProfile.categoryId` et `ProviderProfile.fullName`.
- La méthode `ProvidersService.serialize()` expose un objet dédié **`activity.agencyDetails`** directement consommé par l'application mobile (`ProviderOnboardingScreen`, `ProviderStatusScreen`) et par la console d'administration (`AdminProvidersScreen`).

---

## 4. Enrichissement du Seed de Production Bénin (`prisma/seed.js`)

Le script d'initialisation de la base de données (`prisma/seed.js`) a été mis à jour pour que les agences de démonstration disposent d'un dossier juridique et fiscal complet dès le déploiement :
- **Agence active approuvée (`+229 01 97 00 00 10`)** :
  - **Raison sociale** : *Atlantique Mobilité & Flotte Cotonou SARL* (Formule `OR`, Multi-Flotte `FLOTTE_MIXTE`, 28 véhicules).
  - **Représentant légal** : *Sènakpon Rodrigue AHOUANDJINOU* (Directeur Général — NPI `1094827361`).
  - **Identifiants légaux** : IFU `3202410894512` · RCCM `RB/COT/24 B 38412` · Siège : *Cotonou, Quartier Ganhi, Ilot 412, Immeuble Marina*.
- **Agence en attente de validation Admin (`+229 01 96 77 88 99`)** :
  - **Raison sociale** : *Bénin Express Logistique SARL* (Formule `ARGENT`, Agence de Coursiers & Logistique `FLOTTE_LIVRAISON`, 14 véhicules).
  - **Représentant légal** : *Honoré KPADONOU* (Gérant — NPI `2083914756`).
  - **Identifiants légaux** : IFU `3202519402815` · RCCM `RB/PNO/25 B 11204` · Siège : *Porto-Novo, Quartier Ouando, Carrefour Beau-Rivage*.

---

## 5. Récapitulatif des Fichiers Back-End Livrés Aujourd'hui

| Fichier | Rôle & Nouveautés Livrées |
| :--- | :--- |
| `azo-backend/src/rides/rides.gateway.ts` | Canal WebSocket temps réel `ride:chat` et stockage des messages de mission |
| `azo-backend/src/rides/rides.controller.ts` | Endpoints `POST /rides/:id/start` (avec `pin`), `GET /rides/:id/messages` et `POST /rides/:id/messages` |
| `azo-backend/src/rides/rides.service.ts` | Calcul et validation du Code Bouclier AZƆ̀ à 4 chiffres (`rideSecurityPin`) et gestion des messages |
| `azo-backend/src/providers/providers.module.ts` | Validation, sauvegarde et exposition de `agencyDetails` (NPI, IFU, RCCM, Type d'agence, Forme juridique, Siège, MoMo Pro) |
| `azo-backend/prisma/seed.js` | Enrichissement des agences de démonstration avec des dossiers légaux et fiscaux complets du Bénin |
