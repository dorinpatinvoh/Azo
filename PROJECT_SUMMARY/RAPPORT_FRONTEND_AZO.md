# RAPPORT D'AVANCEMENT TECHNIQUE & FONCTIONNEL — FRONT-END MOBILE (AZƆ̀)

**Projet :** Plateforme de Mobilité, Transport & Livraison Urbaine **AZƆ̀** (Bénin)  
**Périmètre :** Application Mobile Cross-Platform (`azo-mobile` — React Native / Expo)  
**Destinataires :** Direction Générale & Responsables Techniques  
**Date :** 02 Octobre 2026  

---

## 1. Synthèse Exécutive

Les travaux réalisés aujourd'hui sur l'application mobile **AZƆ̀ (`azo-mobile`)** ont permis de finaliser l'ensemble du parcours multi-profils (**Client, Chauffeur Zem/Voiture, Coursier/Livreur, Agence de flotte, Administrateur**), d'aligner l'interface sur les standards **UI/UX professionnels**, d'adapter l'application aux réalités réglementaires et tarifaires du **Bénin (plan national à 10 chiffres `01XXXXXXXX`, grille officielle des agences en FCFA)** et de fiabiliser la génération de l'**APK Android en mode Release** connecté au serveur cloud de production.

---

## 2. Authentification, Expérience d'Accueil & Simulation SMS (APK)

### 2.1. Refonte et aération de l'écran de connexion (`OtpLoginScreen.tsx`)
- **Épuration visuelle (UI/UX)** : Suppression des textes secondaires superflus afin d'offrir une interface respirante, lisible et moderne dès l'ouverture.
- **Conformité au plan de numérotation national béninois (ARCEP Bénin)** :
  - Validation stricte au format **10 chiffres** commençant par **`01`** (ex. `01 XX XX XX XX`), avec support automatique de l'indicatif international `+229`.
  - Formatage visuel dynamique du numéro pendant la saisie.
- **Bannière SMS OTP simulée (5 secondes)** :
  - Afin de permettre les tests complets sur fichier **APK Android** sans consommation de crédits SMS opérateur, le code OTP généré par le serveur s'affiche dans une **notification flottante en haut de l'écran pendant exactement 5 secondes**, puis disparaît automatiquement.
- **Sélecteur d'environnement serveur intégré** :
  - Connexion automatique par défaut au serveur de production (`https://azo-backend.onrender.com`) avec possibilité de basculer vers un serveur local en un clic pour les démonstrations techniques.

### 2.2. Routage intelligent selon le profil (`App.tsx`)
Dès la validation du code OTP (ou à la réouverture de l'application grâce à la persistance sécurisée `expo-secure-store`), l'utilisateur est automatiquement dirigé vers son espace métier :
1. **Administrateur (`ADMIN`)** $\rightarrow$ Console d'Administration & Validation KYC (`AdminProvidersScreen`).
2. **Agence (`AGENCY`)** $\rightarrow$ Tableau de bord de gestion de flotte (`AgencyDashboardScreen`).
3. **Coursier / Livreur (`DRIVER` + `COURIER`)** $\rightarrow$ Espace Coursier & Missions de livraison (`CourierHomeScreen`).
4. **Chauffeur Zem / Voiture (`DRIVER`)** $\rightarrow$ Radar Chauffeur & Courses (`DriverHomeScreen`).
5. **Candidat Prestataire en attente** $\rightarrow$ Écran de suivi du dossier KYC (`ProviderStatusScreen`).
6. **Client (`CLIENT`)** $\rightarrow$ Accueil Client & Réservation (`HomeScreen`).

---

## 3. Espaces Métiers Développés & Finalisés

### 3.1. Parcours d'Enrôlement Prestataire & Upload KYC (`ProviderOnboardingScreen.tsx` & `ProviderStatusScreen.tsx`)
- **Recentrage métier AZƆ̀** : Activation exclusive des 3 filières officielles (**Chauffeur Zem / Voiture**, **Coursier / Livreur**, **Agence de flotte**) et retrait définitif de la catégorie Artisan.
- **Capture & Upload réel des pièces justificatives (`expo-image-picker`)** :
  - Prise de photo directe via la caméra (Selfie de sécurité) ou sélection depuis la galerie.
  - Prévisualisation miniature instantanée sur chaque pièce justificative.
  - Blocage strict de la soumission tant que les **2 pièces obligatoires (`SELFIE` + `CNI`)** ne sont pas jointes.
- **Application de la Nouvelle Grille Officielle AZƆ̀ pour les Agences** :
  - **Niveau PRO** : `100 000 FCFA` (activation unique) — Jusqu'à **25 comptes** — Commission **3 %** — Retrait **1 %**.
  - **Niveau SILVER** : `215 500 FCFA` — Jusqu'à **50 comptes** — Commission **2,5 %** — Retrait **0,75 %**.
  - **Niveau OR** : `450 500 FCFA` — Jusqu'à **100 comptes** — Commission **2 %** — Retrait **0,50 %**.
  - **Niveau DIAMANT** : `600 500 FCFA` — Jusqu'à **1 000 comptes** — Commission **1 %** — Retrait **0,25 %**.
  - **Grille lue depuis la configuration tarifaire** (`services/tarification.ts`) : aucun montant codé en dur dans l'app.

### 3.2. Console d'Administration Mobile (`AdminProvidersScreen.tsx`)
- **Tableau de bord analytique (3 onglets)** :
  1. **Dossiers** : Filtres rapides par statut (*Soumis, En revue, Incomplet, Approuvé, Rejeté, Suspendu*) et par type (*Chauffeur, Coursier, Agence*), avec recherche instantanée.
  2. **Statistiques** : Indicateurs clés (dossiers en attente, taux d'approbation, comptes actifs/bloqués, répartition par filière).
  3. **Utilisateurs** : Annuaire complet des comptes avec **blocage / déblocage** en temps réel et journal d'audit.
- **Inspection visuelle plein écran des pièces KYC** :
  - Visualisation directe des photos `SELFIE`, `CNI`, `PERMIS`, `CARTE_GRISE` et `ASSURANCE` envoyées par les candidats, avec zoom plein écran et validation/rejet individuel par pièce.
- **Corrections UI/UX** : Harmonisation de la hauteur des boutons de filtre (`flexGrow: 0`), alignement des cartes et suppression du bouton flottant de développement (`⋮⋮`) pour un rendu 100 % production.

### 3.3. Tableau de Bord Agence (`AgencyDashboardScreen.tsx`)
- **Suivi de la formule et du quota** : Affichage en temps réel du plan souscrit (*PRO, SILVER, OR, DIAMANT*), du taux de commission, des frais d'activation et de la jauge d'occupation de la flotte (ex. `3 / 25 comptes`).
- **Gestion de la flotte en direct** :
  - Rattachement d'un chauffeur ou coursier approuvé via son numéro béninois à 10 chiffres (`01XXXXXXXX`).
  - Retrait d'un membre de la flotte en un clic.
- **Suivi financier en FCFA** : Chiffre d'affaires brut de la flotte, commission AZƆ̀ et revenu net agence sur les courses et livraisons réalisées.

### 3.4. Espace Coursier / Livreur (`CourierHomeScreen.tsx`)
- **Radar des missions disponibles** : Liste des colis en attente à Cotonou avec adresses de collecte et de livraison, nature du colis, mode de transport (*Moto / Zem* ou *Tricycle / Fourgon*) et gain net en FCFA.
- **Cycle de vie complet d'une livraison** :
  - Acceptation de la mission (`ASSIGNED`) $\rightarrow$ Confirmation de collecte (`PICKED_UP`) $\rightarrow$ Confirmation de livraison (`DELIVERED`) avec crédit automatique du portefeuille **AZƆ̀ Pay**.

### 3.5. Cartographie OpenStreetMap & Suivi Temps Réel (`RideBookingScreen.tsx` & `LiveTrackingScreen.tsx`)
- **Migration complète vers `OSMMapView` (Leaflet / OpenStreetMap)** :
  - Remplacement définitif de `react-native-maps` dans `LiveTrackingScreen.tsx` et `RideTrackingScreen.tsx` par `OSMMapView`.
  - **Avantage majeur** : Affichage fluide des cartes de Cotonou (Étoile Rouge, Ganhi, Haie Vive, Akpakpa, Fidjrossè, Calavi) **sans nécessiter de clé API Google Maps payante** et sans risque de crash Android lié aux certificats SHA-1.

---

## 4. Stabilisation Native Android & Préparation APK Release

Afin de résoudre la fermeture automatique de l'application à l'ouverture sur smartphone Android, plusieurs correctifs structurels ont été appliqués :
1. **Suppression des modules natifs incompatibles** :
   - Retrait de `expo-av` (version SDK 53 incompatible avec Expo SDK 57 qui provoquait une erreur fatale Kotlin/JSI au lancement de `MainApplication`).
   - Retrait de `react-native-maps` et du SDK serveur Node.js `twilio` du paquet mobile.
2. **Intégration des modules système requis par Android** :
   - Ajout de `expo-splash-screen` et `expo-system-ui` conformes à Expo SDK 57.
   - Normalisation de `app.json` et configuration explicite de `:app:assembleRelease` dans `eas.json`.
3. **Filet de sécurité global (`RootErrorBoundary`)** :
   - Encapsulation de toute l'application dans un composant `RootErrorBoundary` et ajout d'un délai maximal de sécurité (2,5 s) sur le chargement des polices pour garantir que l'application ne reste jamais bloquée sur un écran de chargement.

---

## 5. Récapitulatif des Fichiers Front-End Livrés / Mis à Jour

| Fichier | Rôle & Améliorations |
| :--- | :--- |
| `azo-mobile/App.tsx` | Routage multi-rôles, restauration de session, `RootErrorBoundary`, masquage du bouton de dev |
| `azo-mobile/screens/OtpLoginScreen.tsx` | Interface aérée, format Bénin 10 chiffres (`01...`), bannière SMS OTP 5s, sélecteur serveur |
| `azo-mobile/screens/ProviderOnboardingScreen.tsx` | Upload photo caméra/galerie (`SELFIE` + `CNI`), grille officielle Agences AZƆ̀ |
| `azo-mobile/screens/AdminProvidersScreen.tsx` | Console Admin 3 onglets, aperçu & zoom photos KYC, gestion utilisateurs, UI/UX corrigée |
| `azo-mobile/screens/AgencyDashboardScreen.tsx` | Gestion de flotte Agence, quotas PRO/SILVER/OR/DIAMANT, activation payante, rattachement chauffeurs |
| `azo-mobile/screens/CourierHomeScreen.tsx` | Espace Coursier/Livreur, radar de colis, suivi des livraisons et gains FCFA |
| `azo-mobile/screens/LiveTrackingScreen.tsx` | Suivi de course en temps réel migré sur `OSMMapView` (OpenStreetMap) |
| `azo-mobile/services/api.ts` | Client API pointant sur `https://azo-backend.onrender.com` + tolérance cold-start (45s) |
| `azo-mobile/app.json` & `eas.json` | Configuration native Android (`bj.azo.app`) et profils de compilation APK Release |
