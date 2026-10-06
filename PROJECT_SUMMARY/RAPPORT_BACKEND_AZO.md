# RAPPORT D'AVANCEMENT TECHNIQUE & ARCHITECTURE — BACK-END & API (AZƆ̀)

**Projet :** Plateforme de Mobilité, Transport & Livraison Urbaine **AZƆ̀** (Bénin)  
**Périmètre :** Serveur API & Base de Données (`azo-backend` — NestJS / Prisma / PostgreSQL)  
**URL de Production :** `https://azo-backend.onrender.com`  
**Destinataires :** Direction Générale & Responsables Techniques  
**Date :** 02 Octobre 2026 — *mise à jour du 5 octobre 2026 (filière Zem essence / électrique)*  

---

## 1. Synthèse Exécutive

Les travaux réalisés aujourd'hui sur le serveur **AZƆ̀ (`azo-backend`)** ont permis de livrer une architecture API complète, sécurisée et prête pour la production sur **Render Cloud** avec base de données **PostgreSQL**. Le backend gère désormais l'intégralité du cycle de vie des **prestataires (Chauffeurs, Coursiers, Agences)**, l'**upload et la persistance en base des photos KYC (`SELFIE`, `CNI`, etc.)**, la **nouvelle grille tarifaire officielle des agences AZƆ̀**, la **numérotation béninoise à 10 chiffres (`01XXXXXXXX`)**, le **commissionnement automatique via AZƆ̀ Pay**, ainsi qu'un **jeu de données réalistes de Cotonou** injecté automatiquement au déploiement.

---

## 2. Authentification OTP, Sécurité & Numérotation Bénin (`src/auth/`)

### 2.1. Normalisation & Validation Téléphonique Bénin (10 chiffres)
- **Validation stricte** dans `RequestOtpDto` et `VerifyOtpDto` : acceptation du format national béninois à **10 chiffres** commençant par **`01`** (`01XXXXXXXX`) ainsi que du format international `+22901XXXXXXXX`.
- **Contrôle d'accès & Statut Utilisateur (`UserStatus`)** :
  - Vérification systématique du statut du compte (`ACTIVE` vs `BLOCKED`) lors de la connexion OTP ET à chaque requête authentifiée dans `JwtStrategy`.
  - Un utilisateur bloqué par l'administrateur voit ses jetons JWT immédiatement rejetés (`403 Forbidden`).

### 2.2. Retour du code OTP pour les tests APK (`POST /auth/request-otp`)
- En complément de l'envoi SMS / WhatsApp (Twilio), l'API renvoie `devCode` dans la réponse JSON lorsque le mode simulation est actif (`RETURN_OTP_IN_RESPONSE`), permettant à l'application APK d'afficher la notification SMS simulée pendant 5 secondes lors des démonstrations clients.
- Enrichissement de `POST /auth/verify-otp` et `GET /auth/me` : renvoie en un seul appel le profil utilisateur complet, son rôle (`CLIENT`, `DRIVER`, `AGENCY`, `ADMIN`), ainsi que l'état et le type de son dossier prestataire (`provider.status`, `provider.type`).

---

## 3. Gestion du Cycle de Vie des Prestataires & KYC (`src/providers/`)

### 3.1. Machine à états complète des dossiers prestataires
Le module `ProvidersModule` orchestre les 7 statuts réglementaires d'un dossier :
- `DRAFT` (Brouillon) $\rightarrow$ `SUBMITTED` (Soumis) $\rightarrow$ `UNDER_REVIEW` (En cours d'examen) $\rightarrow$ `INCOMPLETE` (Pièces à corriger) / `APPROVED` (Approuvé) / `REJECTED` (Rejeté) / `SUSPENDED` (Suspendu).
- **Journal d'audit immuable (`ProviderEvent`)** : Chaque action (soumission, ouverture par un admin, demande de complément, approbation, rejet, suspension, réactivation) est tracée avec horodatage, auteur (`actorId`) et commentaire.

### 3.2. Upload Multipart & Persistance Cloud des Photos KYC
- **Endpoint `POST /providers/me/documents/upload`** (`multipart/form-data`, jusqu'à 8 Mo par image, formats JPG/PNG/WEBP/HEIC).
- **Double persistance (Disque + PostgreSQL Data URL)** :
  - Sur les hébergeurs cloud modernes comme **Render**, le système de fichiers local est éphémère (réinitialisé à chaque redémoiement).
  - Pour garantir **zéro perte de photo KYC**, chaque image uploadée est convertie et sauvegardée directement en base PostgreSQL (`ProviderDocument.fileUrl`) en plus de l'écriture disque, et servie via `GET /providers/documents/file/:name`.
- **Règle métier stricte** : La soumission d'un dossier (`POST /providers/me/submit`) vérifie obligatoirement la présence des photos **`SELFIE`** et **`CNI`**, ainsi que la complétude des champs spécifiques à la filière choisie.

### 3.3. Promotion Automatique à l'Approbation (`POST /admin/providers/:id/approve`)
Lorsqu'un administrateur approuve un dossier dans une transaction atomique Prisma (`$transaction`) :
- Si le dossier est de type **`DRIVER`** ou **`COURIER`** $\rightarrow$ le rôle de l'utilisateur passe automatiquement à `DRIVER` (avec distinction `provider.type = DRIVER | COURIER`).
- Si le dossier est de type **`AGENCY`** $\rightarrow$ le rôle de l'utilisateur passe à `AGENCY` et l'entité `Agency` est créée ou mise à jour automatiquement avec les paramètres de la formule choisie.

---

## 4. Nouvelle Grille Officielle des Agences & Gestion de Flotte (`src/agencies/`)

### 4.1. Grille Tarifaire Officielle AZƆ̀ intégrée au Back-End
La grille vient de la configuration tarifaire (`src/pricing/tarification.json`, voir
`PROJECT_SUMMARY/TARIFICATION.md`), jamais codée en dur :

| Niveau (`AgencyPlan`) | Activation (unique) | Quota (`maxAccounts`) | Commission par course | Frais par retrait |
| :--- | :---: | :---: | :---: | :---: |
| **`PRO`** | **100 000 FCFA** | **25 comptes** | **3 %** | **1 %** |
| **`SILVER`** | **215 500 FCFA** | **50 comptes** | **2,5 %** | **0,75 %** |
| **`OR`** | **450 500 FCFA** | **100 comptes** | **2 %** | **0,50 %** |
| **`DIAMANT`** | **600 500 FCFA** | **1 000 comptes** | **1 %** | **0,25 %** |

Une agence n'opère qu'une fois ses frais d'activation réglés (`POST /agencies/activate`,
paiement unique) et la limite de comptes est refusée au-delà du plafond du niveau.

### 4.1bis. Tarification des courses — deux filières distinctes (mise à jour du 5 octobre 2026)

> 📄 **Rapport dédié à ce chantier : [`RAPPORT_BACKEND_ZEM.md`](./RAPPORT_BACKEND_ZEM.md)**
> (modèle de données, barème détaillé, filtrage du radar, migration, tests).
Les véhicules sont désormais répartis en **deux filières**, ce qui sépare enfin la commande
d'un Zem de celle d'une voiture :

| Filière | Types | Tarifs |
| :--- | :--- | :--- |
| **Moto-taxi (Zem)** | `ZEM_ESSENCE` | **Base 150 F**, puis **70 F/km de 0 à 15 km**, **60 F/km de 16 à 25 km**, **50 F/km au-delà** — aucune remise |
| **Moto-taxi (Zem)** | `ZEM_ELECTRIC` | **Mêmes paliers kilométriques** que le Zem à essence, mais **base réduite à 100 F** (50 F d'écart constant) |
| **Voiture** | `GAZELLE`, `KOALA`, `LEOPARD` | Gazelle 800 + 200/km puis 150/km · Koala climatisé 1 200 + 375/km puis 350/km · Léopard 2 500 + 900/km puis 800/km |

**Les noms Gazelle / Koala / Léopard ne désignent plus que des voitures** : ils n'apparaissent
jamais dans le parcours de commande d'un Zem. La filière de chaque véhicule est portée par la
configuration (`family: "ZEM" | "CAR"` dans `tarification.json`), jamais par une liste codée en dur.

**Modèle de prix unifié** : chaque véhicule porte ses propres **paliers kilométriques**
(`brackets: [{ upToKm, perKm }, …]`, dernier palier illimité) et, en option, une **remise de base**
(`baseDiscount: { pct, aboveKm }`) — le Zem en a trois paliers et une remise, les voitures deux
paliers et aucune remise. Un seul moteur de calcul, entièrement piloté par la configuration :
les nouveaux barèmes se règlent sans toucher au code.

**Filtrage du radar chauffeur** : `GET /rides/pending` n'expose plus toutes les demandes. Le
service applique `pricing.rideVisibleFor()` — par défaut (`radar.strictVehicleMatch = true`) un
prestataire ne reçoit que les demandes du **véhicule exact** qu'il a déclaré (un Zem à essence ne
voit pas les demandes de Zem électrique ; Gazelle ≠ Koala ≠ Léopard), et les **coursiers sont exclus**
des demandes de transport. Le mode souple (les deux Zem partagent leurs demandes) s'active par
configuration, sans redéploiement de code.

**Profils prestataires** : le profil `ZEM_INDEPENDANT` (15 % des revenus du mois + 1,5 % par
retrait, aucune commission par course) s'applique aux **deux** types de Zem, détectés par la
filière du véhicule. LIVREUR et COURSIER restent en catégorie `INDEPENDANT_PERSONNEL` avec 1,5 %
par retrait — leurs autres règles restant « à définir ». Les valeurs non arbitrées sont listées
dans la section `aDefinir` de la configuration et jamais présentées comme validées.

**Migration** `20261005140000_zem_essence_et_electrique` : ajout de `ZEM_ESSENCE` / `ZEM_ELECTRIC`
à l'enum `VehicleType`, et conversion des données existantes (`Ride.vehicleType` et dossiers DRIVER
en `GAZELLE` → `ZEM_ESSENCE`, puisque la Gazelle était le moto-taxi jusqu'ici).

Tests : `cd azo-backend && npm test` (**51 tests verts**), dont les trois paliers des deux Zem
(90/85/80 et 80/75/70), la remise de base (bornes à 10 km et 10,5 km), la base et la remise
communes aux deux types, l'absence de remise sur les voitures et le filtrage du radar (strict et
souple).

### 4.2. Endpoints de Gestion de Flotte Agence
- `GET /agencies/me` : Retourne le tableau de bord complet de l'agence (formule, quota utilisé/restant, liste des chauffeurs et coursiers rattachés, chiffre d'affaires brut, commissions et net agence).
- `POST /agencies/me/drivers` : Rattache un chauffeur ou coursier approuvé à partir de son numéro à 10 chiffres (`01XXXXXXXX`), après vérification automatique du respect du plafond `maxAccounts` de la formule.
- `DELETE /agencies/me/drivers/:driverId` : Détache un chauffeur ou coursier de la flotte et enregistre l'événement dans le journal d'audit.

---

## 5. Livraison de Colis, Courses & Portefeuille AZƆ̀ Pay (`src/delivery/`, `src/rides/`, `src/admin/`)

### 5.1. Module Coursiers & Livraison (`src/delivery/delivery.module.ts`)
- `GET /delivery/available` : Liste les colis en attente (`PENDING`) pour les coursiers.
- `POST /delivery/:id/accept` & `PATCH /delivery/:id/status` : Permet au coursier d'accepter une course de livraison, de confirmer la collecte (`PICKED_UP`), puis la livraison finale (`DELIVERED`).
- **Rémunération automatique AZƆ̀ Pay** : Dès le passage au statut `DELIVERED`, le portefeuille (`Wallet`) du coursier est automatiquement crédité de **88 %** du montant de la course (commission plateforme de 12 %), avec création d'une écriture comptable `Transaction` (`RIDE_EARNING`).

### 5.2. Console d'Administration Globale (`src/admin/admin.module.ts`)
- `GET /admin/dashboard` : Agrégation temps réel du volume d'affaires (GMV), des courses actives, du nombre d'utilisateurs par rôle, des dossiers KYC en attente et des comptes bloqués.
- `GET /admin/users` & `PATCH /admin/users/:id/status` : Recherche et filtrage des utilisateurs, blocage (`BLOCKED`) et réactivation (`ACTIVE`) immédiate des comptes avec journalisation.
- `GET /admin/audit` : Historique complet des décisions administratives.

---

## 6. Données Réalistes Bénin (`prisma/seed.ts`) & Déploiement Cloud Render (`render.yaml`)

### 6.1. Peuplement Automatique (Seed Cotonou / Bénin)
Le fichier `prisma/seed.js` initialise la base de données sans aucun compte de démonstration :
- **Compte Administrateur** pré-configuré (`ADMIN_PHONE`, par défaut `+229 01 97 00 00 00`) : validation des dossiers prestataires (KYC) et pilotage global.
- **Aucun numéro de test** : chaque client ou prestataire s'inscrit depuis l'application mobile avec son propre numéro béninois à 10 chiffres (`01...`) ; le rôle métier n'est accordé qu'après approbation du dossier par l'Administrateur.
- **Nettoyage automatique** : à chaque exécution, le seed purge les anciens comptes de démonstration historiques (et leurs données : courses, livraisons, portefeuilles, dossiers, agences), sans jamais toucher au compte Administrateur.
- Outils de gestion : `npm run providers:list` (comptes et dossiers) et `npm run providers:approve -- +229...` (approbation d'un dossier par script).

### 6.2. Infrastructure Cloud Render (`render.yaml`)
- Configuration **Infrastructure-as-Code** (`render.yaml`) déployant :
  1. Le service Web Node/NestJS **`azo-backend`** (`https://azo-backend.onrender.com`).
  2. La base de données managée PostgreSQL **`azo-db`**.
- Pipeline de démarrage automatisé (`npm run start:render`) : synchronisation du schéma Prisma (`prisma db push`), injection des données initiales (`prisma db seed`) et lancement du serveur de production.
