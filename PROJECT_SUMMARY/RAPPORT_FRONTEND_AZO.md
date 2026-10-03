# RAPPORT D'AVANCEMENT TECHNIQUE & FONCTIONNEL — FRONT-END MOBILE (AZƆ̀)

**Projet :** Plateforme de Mobilité, Transport & Livraison Urbaine **AZƆ̀** (Bénin)  
**Périmètre :** Application Mobile Cross-Platform (`azo-mobile` — React Native / Expo)  
**Destinataires :** Direction Générale & Responsables Techniques  
**Date :** 03 Octobre 2026  

---

## 1. Synthèse Exécutive

Les travaux réalisés aujourd'hui sur l'application mobile **AZƆ̀ (`azo-mobile`)** ont porté sur quatre axes stratégiques :
1. **L'optimisation UI/UX multi-profils** (Client, Chauffeur Zem/Voiture, Coursier/Livreur, Agence) pour rendre l'application plus fluide, intuitive et engageante dès le premier écran.
2. **Le déploiement du Volet 1 « Sécurité & Communication »** comprenant la **messagerie instantanée chiffrée intégrée**, l'**anonymisation des numéros et des noms**, et le **code de sécurité à 4 chiffres (« Bouclier AZƆ̀ »)** au démarrage de chaque course.
3. **La refonte complète du parcours d'inscription des Agences au Bénin (`AGENCY`)**, intégrant désormais l'identité complète et le **NPI (ANIP)** du représentant légal, le **N° IFU (13 chiffres DGI)**, le **N° RCCM**, le **type d'agence**, la **forme juridique**, le **siège social** et le **compte Mobile Money professionnel de reversement**.
4. **La mise en place des mises à jour instantanées Over-The-Air (`EAS Update`)** permettant de déployer les évolutions d'interface en 30 secondes sans réinstaller l'APK.

---

## 2. Volet 1 — Sécurité des Trajets, Anonymisation & Messagerie Intégrée

### 2.1. Messagerie instantanée chiffrée Client ↔ Prestataire (`components/RideChatModal.tsx`)
- **Canal de discussion dédié à la mission** : Disponible en 1 clic depuis l'écran de suivi Client (`LiveTrackingScreen`), l'écran de livraison Client (`DeliveryScreen`), le Radar Chauffeur (`DriverHomeScreen`) et l'Espace Coursier (`CourierHomeScreen`).
- **Réponses rapides en 1 clic adaptées au terrain béninois** :
  - *Côté Client* : « Je suis devant le portail », « J'arrive dans 2 minutes », « Quel est ton point de repère ? », « Je t'attends au carrefour ».
  - *Côté Chauffeur / Coursier* : « Je suis arrivé au point de départ », « J'arrive dans 2 minutes », « Je porte un casque / gilet AZƆ̀ », « Peux-tu m'envoyer un point de repère ? ».
- **Verrouillage automatique de confidentialité** : Dès que la course ou la livraison passe au statut terminé (`COMPLETED` / `DELIVERED`) ou annulé (`CANCELLED`), la conversation est automatiquement clôturée afin d'empêcher tout contact ultérieur hors mission.

### 2.2. Anonymisation des Numéros de Téléphone et des Noms (`utils/phone.ts`)
- **Masquage systématique des numéros personnels (`maskBeninPhone`)** : Les numéros à 10 chiffres ne sont jamais exposés en clair entre le client et le prestataire ; ils sont affichés sous la forme anonymisée **`01 •• •• •• 42`**.
- **Anonymisation du nom de famille (`maskPersonName`)** : Seul le prénom suivi de l'initiale du nom de famille est affiché (ex. `Romaric S.` ou `Kossi Boris A.`), protégeant la vie privée des usagers et des conducteurs.

### 2.3. Code de Sécurité à 4 Chiffres « Bouclier AZƆ̀ » (`LiveTrackingScreen.tsx` & `DriverHomeScreen.tsx`)
- **Côté Client (`LiveTrackingScreen`)** : Dès qu'un chauffeur accepte la course, une bannière dédiée affiche le **Code Bouclier AZƆ̀ à 4 chiffres** à communiquer oralement au conducteur au moment de monter sur la moto ou dans le véhicule.
- **Côté Chauffeur (`DriverHomeScreen`)** : Le chauffeur doit saisir ce **code à 4 chiffres** pour pouvoir démarrer officiellement la course (`IN_PROGRESS`), garantissant que le bon passager monte avec le bon conducteur vérifié.
- **Mode démonstration APK (5 secondes)** : Un bouton *« Simuler SMS Code »* affiche le code Bouclier dans une bannière flottante pendant 5 secondes sur l'écran du chauffeur afin de faciliter les démonstrations sans nécessiter deux téléphones simultanés.

---

## 3. Parcours d'Inscription Complet & Réglementaire des Agences (`AGENCY`)

Le tunnel d'enrôlement des agences (`ProviderOnboardingScreen.tsx`) a été enrichi pour répondre aux exigences légales, fiscales et opérationnelles de la République du Bénin :

### 3.1. Choix du Type d'Agence (Étape 1)
L'agence sélectionne sa spécialité d'exploitation parmi 4 catégories :
1. **Agence de Flotte Zem & Moto-Taxi (`FLOTTE_ZEM`)** — Motos-taxis Zem thermiques et électriques.
2. **Agence VTC & Transport Voiture (`FLOTTE_VOITURE`)** — Flotte de berlines climatisées et transport urbain.
3. **Agence de Coursiers & Logistique (`FLOTTE_LIVRAISON`)** — Livreurs de colis, coursiers express et coursiers personnels.
4. **Agence Multi-Flotte (`FLOTTE_MIXTE`)** — Exploitation complète combinant Zem, Voitures et Livreurs.

### 3.2. Identité Légale du Représentant (Étape 2)
- **Nom de famille du représentant légal** *(obligatoire, ex. `SOGLO`)* et **Prénom(s)** *(obligatoire, ex. `Thierry Koffi`)*.
- **Fonction / Qualité dans l'entreprise** : sélection rapide en 1 clic (*Gérant*, *Directeur Général*, *Associé-Gérant*, *Président / Fondateur*).
- **NPI du représentant (Numéro Personnel d'Identification — ANIP Bénin à 10 chiffres)** *(obligatoire, figurant sur le CIP ou la CNI biométrique)*.
- **Ville d'implantation principale**, **zones couvertes** et **années d'expérience**.

### 3.3. Informations Légales, Fiscales & Flotte (Étape 3)
- **Raison sociale / Nom commercial** *(obligatoire)* et **Forme juridique** en 1 clic (*SARL*, *SAS / SA*, *Entreprise Individuelle (EI)*, *Coopérative / GIE*).
- **N° IFU de l'entreprise (Identifiant Fiscal Unique — 13 chiffres DGI Bénin)** *(obligatoire)*.
- **N° RCCM (Registre du Commerce et du Crédit Mobilier — GUFE Bénin)** *(obligatoire, ex. `RB/COT/24 B 12345`)*.
- **Adresse du siège social** *(Quartier, Ilot, Immeuble / Repère — obligatoire)*.
- **Coordonnées professionnelles & financières** : Téléphone professionnel (`01...`), Email professionnel, **Compte Mobile Money Entreprise (Reversements MTN MoMo / Moov `01...`)**, **Taille du parc (nombre de véhicules)** et **Formule officielle AZƆ̀** (*PRO, ARGENT, OR, DIAMANT*).

### 3.4. Visibilité dans le Suivi Prestataire & la Console Admin (`ProviderStatusScreen.tsx` & `AdminProvidersScreen.tsx`)
- **Suivi du dossier (`ProviderStatusScreen`)** : Affichage d'une carte dédiée **« Fiche légale & fiscale de l'agence »** récapitulant la raison sociale, la forme juridique, le représentant légal, le NPI, l'IFU, le RCCM et le siège social.
- **Console Administrateur (`AdminProvidersScreen`)** : Lors de l'inspection d'une candidature d'agence, l'administrateur visualise l'intégralité des identifiants légaux (Type d'agence, Forme juridique, Nom/Prénom/Fonction/NPI du représentant, IFU, RCCM, Siège social, Téléphone pro, Email pro, Compte MoMo de reversement et Taille du parc).

---

## 4. Améliorations UI/UX & Ergonomie des Profils

- **Écran d'Accueil Client (`HomeScreen.tsx`)** :
  - **Correction visuelle de la carte AZƆ̀ Pay** : Suppression du badge *« 100% Sans Cash »* qui chevauchait le bouton `+ Recharger`, offrant une carte portefeuille épurée et parfaitement lisible.
  - **Destinations fréquentes en 1 clic** : Ajout de puces rapides (*Aéroport Cotonou, Marché Dantokpa, Haie Vive, Ganhi, Université d'Abomey-Calavi*) pré-remplissant la destination pour réserver en moins de 3 secondes.
  - **Grille Bento 3×2** : Organisation claire des 6 services (*Zem Express, Zem Électrique, Voiture Confort, Coursier & Colis, Location Véhicule, Recharger AZƆ̀ Pay*).
- **Radar Chauffeur (`DriverHomeScreen.tsx`)** :
  - Ajout d'une barre de progression **« Objectif du jour (10 000 FCFA) »** calculée en temps réel pour stimuler l'engagement quotidien des conducteurs.
- **Espace Coursier (`CourierHomeScreen.tsx`)** :
  - Ajout d'un **Stepper visuel en 3 étapes** (*1. Collecte → 2. En route → 3. Livré*) et d'un bandeau rappelant le **double code OTP** (collecte expéditeur + remise destinataire).

---

## 5. Récapitulatif des Fichiers Front-End Livrés Aujourd'hui

| Fichier | Rôle & Nouveautés Livrées |
| :--- | :--- |
| `azo-mobile/components/RideChatModal.tsx` | **Nouveau** — Messagerie chiffrée in-app Client ↔ Prestataire avec réponses 1 clic et auto-verrouillage |
| `azo-mobile/utils/phone.ts` | Anonymisation des numéros (`maskBeninPhone`), des noms (`maskPersonName`) et calcul du Code Bouclier |
| `azo-mobile/screens/HomeScreen.tsx` | Retrait du badge derrière `+ Recharger`, destinations 1 clic Cotonou, grille Bento 3×2 |
| `azo-mobile/screens/LiveTrackingScreen.tsx` | Affichage du Code Bouclier AZƆ̀ à 4 chiffres, identité chauffeur anonymisée, bouton Chat in-app |
| `azo-mobile/screens/DriverHomeScreen.tsx` | Validation du Code Bouclier 4 chiffres avant départ, simulation SMS 5s, Objectif du jour, Chat in-app |
| `azo-mobile/screens/CourierHomeScreen.tsx` | Stepper 3 étapes, client anonymisé, messagerie in-app intégrée |
| `azo-mobile/screens/DeliveryScreen.tsx` | Suivi colis avec coursier anonymisé et messagerie in-app intégrée |
| `azo-mobile/screens/ProviderOnboardingScreen.tsx` | Parcours complet d'inscription Agence Bénin (Type d'agence, Nom/Prénom/Fonction/NPI, IFU, RCCM, Siège, MoMo) |
| `azo-mobile/screens/ProviderStatusScreen.tsx` | Carte « Fiche légale & fiscale de l'agence » sur l'écran de suivi du dossier |
| `azo-mobile/screens/AdminProvidersScreen.tsx` | Affichage complet des informations légales et fiscales des agences pour la validation Admin |
| `azo-mobile/eas.json` | Configuration des canaux `preview` et `production` pour les mises à jour instantanées **EAS Update (OTA)** |
