# Gestion des prestataires AZƆ̀ — inscription, validation admin, espaces métier

> Document de conception (rien n'est implémenté à ce jour).
> Objectif : un parcours unique et auditable pour **tout** prestataire — chauffeur
> indépendant, agence, artisan, coursier — de l'inscription à l'activation du compte,
> avec validation humaine par un administrateur et une interface métier par type.

---

## 1. État des lieux (audit du code avant l'étape 3a)

| Élément | État | Détail |
|---|---|---|
| Rôle prestataire | ✅ **corrigé en 3a** | Avant : `POST /auth/verify-otp` acceptait `profile: DRIVER \| AGENCY` et créait le compte avec ce rôle signé dans le JWT — n'importe qui devenait chauffeur ou agence en 2 taps. Maintenant l'inscription crée toujours un `CLIENT` et le profil déclaré ouvre un **brouillon de dossier** ; le rôle vient de la décision admin. |
| Création d'agence | ✅ **corrigé en 3a** | Avant : `POST /agencies` ouvert à tout compte connecté, formule gratuite (les frais `PLANS` jamais facturés). Maintenant la route est supprimée : l'agence naît de l'approbation d'un dossier `AGENCY`, avec la formule du dossier et `activationFee` enregistré (débit à trancher, §11.4). |
| Ajout d'un chauffeur à une agence | ✅ **corrigé en 3a** | Avant : `POST /agencies/drivers` passait n'importe quel numéro en `DRIVER` rattaché à l'agence, sans consentement ni vérification. Maintenant : dossier `DRIVER` **approuvé** exigé, plafond de formule respecté, chauffeur notifié, rattachement journalisé et réversible (`DELETE /agencies/drivers/:userId`). |
| Statut de compte | ✅ **corrigé en 3a** | `User.status` (`ACTIVE` / `PENDING_VALIDATION` / `BLOCKED`) ajouté, relu à chaque requête authentifiée : une suspension prend effet immédiatement. |
| Artisans | ❌ **Coquille vide** | `ArtisanRequest` = `{ clientId, category, status }`. Pas d'`artisanId`, pas de prix, pas de créneau. `GET /artisans` liste les `User` de rôle ARTISAN, que personne ne peut plus s'auto-attribuer. Le filtre `?category=` est ignoré. → étape 3d. |
| Coursiers / livraison | ❌ **Côté livreur absent** | `Delivery.courierId` n'est jamais renseigné, aucun endpoint de missions disponibles, aucune vérification de propriété sur les confirmations OTP, rien n'est facturé. → étape 3d. |
| Écran Agence (mobile) | ⚠️ **Backend prêt** | `AgencyDashboardScreen.tsx` : 0 appel API, tout est codé en dur. `GET /agencies/dashboard` renvoie désormais des chiffres réels (CA, commissions, note moyenne, sièges, roster avec état des chauffeurs) — il reste à brancher l'écran. → étape 3d. |
| Écran Admin (mobile) | ⚠️ **Backend prêt** | `AdminDashboardScreen.tsx` : 0 appel API, 8 boutons qui ne mènent à rien. Les routes de validation existent (`/admin/providers*`) — il reste l'interface. → étape 3c. |
| Chauffeur indépendant | ✅ **Réel** | `DriverHomeScreen.tsx` (étape 2) : GPS, socket, missions en direct, acceptation, paiement wallet, annulation. C'est la référence pour les autres espaces métier. |

**Conclusion** : il manque la colonne vertébrale (dossier + validation + statut) et 3 espaces
métiers sur 4. Le chauffeur indépendant sert de référence.

---

## 2. Principe directeur

> **Un compte client est créé en 30 secondes. Un compte prestataire est *accordé*.**

1. L'inscription OTP crée **toujours** un compte `CLIENT` (comme aujourd'hui).
2. Le prestataire dépose un **dossier** (identité, métier/véhicule, pièces, zone).
3. Un **administrateur** examine et décide : approuver, demander une pièce, rejeter.
4. Le **rôle et l'accès métier ne sont accordés qu'à l'approbation** — jamais avant.
5. Chaque décision est **journalisée** (qui, quand, pourquoi) et **notifiée** au prestataire.

Un seul modèle de dossier pour les 4 types : mêmes statuts, mêmes pièces, même console
admin. Seuls le formulaire et l'espace métier changent selon le type.

---

## 3. Modèle de données (Prisma)

```prisma
enum ProviderType {
  DRIVER    // chauffeur indépendant (zem, zem électrique, voiture)
  AGENCY    // agence / flotte
  ARTISAN   // plombier, électricien, maçon, couturier…
  COURIER   // livreur de colis / coursier
}

enum ProviderStatus {
  DRAFT         // brouillon, non soumis (reprise possible)
  SUBMITTED     // déposé, en file d'attente
  UNDER_REVIEW  // un admin a ouvert le dossier
  NEED_INFO     // pièce manquante ou illisible → retour au prestataire
  APPROVED      // validé : rôle accordé, espace métier ouvert
  REJECTED      // refusé avec motif (ré-inscription possible après délai)
  SUSPENDED     // actif mais gelé (litige, document expiré, signalement)
}

enum DocumentKind {
  CNI                 // pièce d'identité
  SELFIE              // selfie de vérification (comparaison à la CNI)
  PERMIS              // permis de conduire
  CARTE_GRISE         // carte grise du véhicule
  ASSURANCE           // attestation d'assurance
  VISITE_TECHNIQUE    // visite technique véhicule
  PHOTO_VEHICULE      // photo du véhicule (plaque visible)
  RCCM                // registre du commerce (agence)
  IFU                 // identifiant fiscal (agence)
  STATUTS             // statuts de la société (agence)
  DIPLOME             // diplôme / certificat de qualification (artisan)
  EXTRAIT_CASIER      // extrait de casier judiciaire
}

enum DocumentStatus {
  PENDING
  VALID
  INVALID
}

enum ProviderEventType {
  CREATED  SUBMITTED  DOCUMENT_ADDED  DOCUMENT_VALIDATED  DOCUMENT_REJECTED
  REVIEW_STARTED  INFO_REQUESTED  APPROVED  REJECTED  SUSPENDED  REINSTATED
}

model ProviderProfile {
  id           String         @id @default(uuid())
  userId       String         @unique
  user         User           @relation(fields: [userId], references: [id])

  type         ProviderType
  status       ProviderStatus @default(DRAFT)

  // Identité déclarée
  fullName     String
  city         String                        // Cotonou, Porto-Novo, Abomey-Calavi…
  zones        String[]                      // quartiers / communes desservies
  bio          String?                       // artisans : description de l'activité
  experienceYears Int?

  // Spécifique au type
  vehicleType  VehicleType?                  // DRIVER / COURIER
  plateNumber  String?                       // DRIVER / COURIER
  vehicleModel String?
  categoryId   String?                       // ARTISAN
  agencyId     String?                       // DRIVER/COURIER rattaché à une agence
  agency       Agency?        @relation(fields: [agencyId], references: [id])

  // Suivi du dossier
  submittedAt  DateTime?
  reviewedAt   DateTime?
  reviewedById String?                       // admin ayant statué
  rejectReason String?
  suspensionReason String?

  // Vie du compte après approbation
  activatedAt  DateTime?
  rating       Float          @default(0)
  jobsCompleted Int           @default(0)
  kycScore     Int            @default(0)    // 0-100, calculé (pièces valides + non expirées)

  documents ProviderDocument[]
  events    ProviderEvent[]

  @@index([status, type])
  @@index([agencyId])
}

model ProviderDocument {
  id         String         @id @default(uuid())
  providerId String
  provider   ProviderProfile @relation(fields: [providerId], references: [id], onDelete: Cascade)

  kind       DocumentKind
  url        String                         // stockage objet (voir §8)
  mimeType   String
  sizeBytes  Int
  status     DocumentStatus @default(PENDING)
  expiresAt  DateTime?                      // permis, assurance, visite technique, CNI
  reviewerNote String?
  uploadedAt DateTime       @default(now())
  reviewedAt DateTime?

  @@index([providerId, kind])
  @@index([status])
}

model ProviderEvent {
  id         String            @id @default(uuid())
  providerId String
  provider   ProviderProfile   @relation(fields: [providerId], references: [id], onDelete: Cascade)
  actorId    String?                         // null = le prestataire lui-même
  type       ProviderEventType
  comment    String?
  createdAt  DateTime          @default(now())

  @@index([providerId, createdAt])
}

// Ajouts au modèle User
model User {
  // …champs existants…
  status   UserStatus       @default(ACTIVE)
  provider ProviderProfile?
}

enum UserStatus {
  ACTIVE               // compte normal
  PENDING_VALIDATION   // dossier déposé : accès client OK, accès métier verrouillé
  BLOCKED              // suspendu par l'admin (plus de connexion utile)
}
```

**Migration** : les `User` déjà en `DRIVER`/`AGENCY` (créés avant cette évolution) restent
utilisables — on leur génère un `ProviderProfile` en `APPROVED` avec `kycScore = 0` et un
drapeau « régularisation requise », pour ne pas casser tes comptes de test.

---

## 4. API

### 4.1 Côté prestataire (rôle CLIENT suffisant, le dossier fait foi)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/providers/me` | ✅ **3a** — Mon dossier : statut, identité, checklist des pièces, champs manquants, délais/SLA, journal (timeline) |
| `POST` | `/providers/applications` | ✅ **3a** — Créer/mettre à jour un brouillon (type, identité, zone, véhicule/métier, formule) |
| `POST` | `/providers/applications/:id/documents` | ✅ **3a** (déclaration) — Déclare une pièce (type, expiration). ⏳ **3d** : dépôt du fichier (multipart, ≤ 8 Mo, jpg/png/pdf) |
| `POST` | `/providers/applications/:id/submit` | ✅ **3a** — Soumettre → `SUBMITTED` (+ notification aux admins) |
| `GET` | `/providers/me/stats` | ⏳ **3d** — Gains, missions, note (après approbation) |

Règles :
- `submit` refuse si une pièce obligatoire du type manque (voir §6).
- Un dossier `REJECTED` ne peut être re-soumis qu'après **7 jours**, sauf si toutes les
  pièces signalées ont été remplacées.
- `NEED_INFO` rouvre l'édition ; les pièces déjà validées sont conservées.

### 4.2 Côté admin (`@Roles(ADMIN)`)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/admin/providers?status=SUBMITTED&type=DRIVER&city=Cotonou&page=1` | ✅ **3a** — File d'attente filtrable, paginée, triée par ancienneté (SLA) + compteurs par statut |
| `GET` | `/admin/providers/stats` | ✅ **3a** — Par statut/type, dossiers en attente, en dépassement de SLA, délai moyen de traitement |
| `GET` | `/admin/providers/:id` | ✅ **3a** — Dossier complet : identité, pièces, checklist, timeline, compte et wallet du candidat |
| `POST` | `/admin/providers/:id/start-review` | ✅ **3a** — Verrou optimiste (`updateMany` avec le statut dans le WHERE) : deux admins ne peuvent pas instruire le même dossier |
| `POST` | `/admin/providers/:id/documents/:docId/decision` | ✅ **3a** — `{ decision: VALID \| INVALID, note?, expiresAt? }`, recalcule le score KYC et notifie |
| `POST` | `/admin/providers/:id/decision` | ✅ **3a** — `{ decision: APPROVE \| REJECT \| NEED_INFO \| SUSPEND, reason, overrideDocuments? }` |
| `POST` | `/admin/providers/:id/reinstate` | ✅ **3a** — Lever une suspension |
| `GET` | `/admin/audit-log?actorId=&from=&to=` | ⏳ **3c** — Le journal existe déjà (`ProviderEvent`) ; il reste la route de consultation globale |

**Effets de `APPROVE` (une seule transaction Prisma)** :
1. `ProviderProfile.status = APPROVED`, `activatedAt = now()`, `kycScore` recalculé ;
2. `User.role = <type>` (DRIVER / AGENCY / ARTISAN) et `User.status = ACTIVE` ;
3. pour une **agence** : création de l'`Agency` avec la formule choisie **et débit du fee
   d'activation** depuis le wallet (`WalletService.transfer` existant) — refus si solde
   insuffisant ;
4. pour un **chauffeur rattaché** : `agencyId` posé + notification à l'agence ;
5. écriture du `ProviderEvent` + `Notification` au prestataire (+ SMS quand la passerelle
   sera branchée).

---

## 5. Parcours complet

### 5.1 Inscription (identique pour tous)
```
Téléphone (+229) → OTP 4 chiffres → compte CLIENT créé → wallet AZƆ̀ Pay ouvert
```
Aucun choix de rôle à cette étape. **Le sélecteur « Client / Conducteur / Agence » de
l'écran de connexion disparaît** : c'est la fin du trou de sécurité actuel.

### 5.2 Devenir prestataire — wizard en 5 étapes (brouillon auto-sauvegardé)
1. **Type d'activité** — cartes : Zem / Zem électrique / Voiture · Agence de flotte ·
   Artisan (catégorie) · Livreur. Une seule demande active par compte.
2. **Identité** — nom complet (tel que sur la CNI), ville, zones desservies, années
   d'expérience ; pour une agence : raison sociale, RCCM, IFU, formule choisie avec le
   tarif affiché (45 000 → 500 000 F) et le solde wallet disponible.
3. **Pièces** — checklist dynamique selon le type, appareil photo direct
   (`expo-image-picker`), aperçu + recadrage, statut de chaque pièce visible, `expiresAt`
   saisi pour les documents à durée limitée.
4. **Véhicule / métier** — type de véhicule, modèle, plaque, photo du véhicule ; ou pour
   l'artisan : description, tarif horaire indicatif, photos de réalisations (galerie).
5. **Récapitulatif + engagement** — résumé, cases à cocher (exactitude des informations,
   charte AZƆ̀, consentement géolocalisation pendant les missions) → **Soumettre**.

À tout moment : quitter sans perdre (brouillon), reprendre, modifier jusqu'à la soumission.

### 5.3 Après soumission — écran « Dossier en cours »
- Timeline verticale avec dates réelles : *Déposé → En cours d'examen → Décision*.
- SLA affiché : « Réponse sous 48 h ouvrées », compteur de jours écoulés.
- Si `NEED_INFO` : la pièce manquante est mise en évidence avec le commentaire de l'admin
  et un bouton « Remplacer la pièce » → re-soumission en 1 tap.
- Si `REJECTED` : motif lisible + date de ré-inscription possible.
- Le compte reste pleinement utilisable comme **client** (commander une course, payer,
  wallet) pendant l'attente — seule l'entrée métier est verrouillée.
- Mise à jour en temps réel : socket `provider:status` + notification push/SMS.

### 5.4 Revue admin
File d'attente → fiche dossier en 3 colonnes : identité/timeline · pièces en grand format
(zoom, comparaison CNI/selfie) · checklist de décision. Boutons : **Valider une pièce**,
**Demander une pièce**, **Approuver**, **Rejeter (motif obligatoire)**, **Suspendre**.
Chaque action écrit dans `ProviderEvent` et notifie le prestataire.

### 5.5 Activation
Notification « Ton compte prestataire est actif » → l'app bascule sur l'espace métier
correspondant, le wallet prestataire est utilisable (retraits après branchement FedaPay),
et le prestataire apparaît dans le matching (courses, missions, recherche d'artisan).

---

## 6. Pièces obligatoires par type

| Type | Obligatoires | Optionnelles / recommandées |
|---|---|---|
| **DRIVER** | CNI, SELFIE, PERMIS, CARTE_GRISE, ASSURANCE, PHOTO_VEHICULE | VISITE_TECHNIQUE, EXTRAIT_CASIER |
| **COURIER** | CNI, SELFIE, PERMIS (si 2 roues), PHOTO_VEHICULE | ASSURANCE |
| **AGENCY** | CNI du représentant, SELFIE, RCCM, IFU, STATUTS | PHOTO_VEHICULE par véhicule déclaré |
| **ARTISAN** | CNI, SELFIE, DIPLOME *ou* 3 photos de réalisations | EXTRAIT_CASIER |

Règle commune : toute pièce avec `expiresAt` dépassé fait passer le dossier en
`SUSPENDED` automatiquement (cron quotidien) avec notification « Ton assurance expire dans
15 jours » en amont (J-30, J-15, J-3).

---

## 7. Espace métier par type de prestataire

Chaque espace partage le même châssis — **4 onglets** : *Missions · Gains · Dossier · Profil*.

### 7.1 Chauffeur indépendant (DRIVER) — existe déjà à 90 %
On garde `DriverHomeScreen` (GPS, socket, acceptation, paiement wallet) et on ajoute :
- onglet **Gains** : CA du jour/semaine/mois, commission 15 % détaillée course par course,
  solde AZƆ̀ Pay, bouton retrait ;
- onglet **Dossier** : état des pièces, dates d'expiration, alerte de renouvellement ;
- bandeau permanent si `SUSPENDED` : « Compte suspendu — motif », avec accès au support.

### 7.2 Agence (AGENCY) — à brancher sur l'existant
`AgencyDashboardScreen` passe de maquette à réel :
- **Vue d'ensemble** : `GET /agencies/dashboard` (déjà implémenté) — CA net flotte,
  chauffeurs actifs, courses terminées, note moyenne ;
- **Flotte** : liste des chauffeurs rattachés avec statut (en course / disponible / hors
  ligne), ajout **par invitation** (le chauffeur reçoit une demande et accepte — plus de
  changement de rôle imposé), retrait, plafond de la formule (10 / 25 / 100 / 1 000) ;
- **Véhicules** : parc, affectation, documents (carte grise, assurance, visite technique)
  avec échéances ;
- **Finance** : commission de la formule (3 % / 2,5 % / 2 % / 1 %), factures d'activation,
  reversements, export ;
- **Recrutement** : liens d'invitation pour les chauffeurs sans compte.

### 7.3 Artisan (ARTISAN) — à créer
- **Missions** : demandes reçues par catégorie et par zone (`ArtisanRequest` à étendre :
  `artisanId`, `scheduledAt`, `quotedPrice`, `status` PENDING → QUOTED → ACCEPTED →
  IN_PROGRESS → DONE), accepter/refuser, envoyer un devis, photos avant/après ;
- **Profil public** (vu par le client) : photo, métier, note, nombre d'interventions,
  tarif indicatif, zone, disponibilité ;
- **Gains** : interventions facturées, commission AZƆ̀, solde ;
- **Galerie** de réalisations (alimente aussi le référencement dans la recherche client).

### 7.4 Coursier (COURIER) — à créer
Même châssis que le chauffeur, adapté à la livraison :
- missions de livraison disponibles à proximité (le pendant de `/rides/pending`) ;
- parcours à **double OTP** déjà prévu côté client : le coursier saisit le code de retrait
  chez l'expéditeur puis le code de remise au destinataire ;
- preuve de livraison (photo du colis remis) ;
- gains au colis + distance.

### 7.5 Admin
- **Console de validation** (§5.4) — c'est le cœur du chantier ;
- tableau de bord réel sur `GET /admin/stats` + `/admin/providers/stats` ;
- gestion des utilisateurs (`GET /admin/users` existe) avec blocage/déblocage ;
- paramétrage : tarifs, formules d'agence, commission, SLA de validation.

**Où loger la console admin ?** Deux options :
- **A. Dans l'app mobile** (rôle ADMIN) — rapide à livrer, réutilise le thème existant,
  mais l'examen de pièces sur petit écran est pénible ;
- **B. Une app web séparée** (`azo-admin`, React + Vite, mêmes endpoints JWT) — grand
  écran, comparaison CNI/selfie côte à côte, tableaux filtrables, export. **Recommandé** :
  la validation de documents est un travail de bureau, et le backend ne change pas.

---

## 8. Stockage des pièces (KYC = données sensibles)

- Fichiers **hors de la base** : stockage objet (S3-compatible : Cloudflare R2, Wasabi,
  ou MinIO en auto-hébergé) avec **URL signées à durée limitée** (5 min) — jamais d'URL
  publique devinable.
- En développement local : dossier `azo-backend/uploads/` servi derrière
  `GET /admin/providers/:id/documents/:docId/file` avec garde ADMIN (pas de statique public).
- Contrôles à l'upload : type MIME réel (pas l'extension), taille ≤ 8 Mo, dimensions
  minimales (lisibilité), EXIF de localisation supprimé.
- Accès : le prestataire voit **ses** pièces, l'admin voit tout, un client ne voit que le
  profil public (nom, note, métier — jamais la CNI).
- Conformité : durée de conservation définie (ex. 5 ans après fermeture du compte),
  suppression effective du fichier en cascade.

---

## 9. Sécurité (à traiter avec ce chantier)

1. **Supprimer l'auto-attribution du rôle** dans `verify-otp` : `profile` ne sert plus qu'à
   pré-remplir le type de dossier demandé ; le rôle vient de la décision admin.
2. ** ADMIN ne se déclare jamais ** : aucun chemin API ne peut produire un rôle ADMIN.
   Un seul admin créé par script de seed (`prisma/seed.ts`) à partir d'un numéro autorisé
   dans `.env` (`ADMIN_PHONE`).
3. **Journal d'audit** immutable (`ProviderEvent` + table d'audit admin) : qui a approuvé
   quoi, quand, avec quelle IP.
4. **Verrou de revue** : `start-review` atomique (`updateMany` avec le statut dans le
   WHERE) pour éviter deux admins sur le même dossier.
5. **Secrets** : retirer le `JWT_SECRET` de secours codé en dur (`jwt.strategy.ts`,
   `auth.module.ts`) → l'API refuse de démarrer sans variable d'environnement ; sortir
   `.env` du dépôt git (il est actuellement tracké dans un dépôt **public**).
6. **OTP** : limite de tentatives (3 essais puis blocage 15 min), code à 6 chiffres,
   anti-renvoi (60 s).
7. **Socket.IO** : authentification par JWT à la connexion (aujourd'hui ouvert à tous avec
   CORS `*`) — sinon n'importe qui peut écouter la position des chauffeurs.
8. **Suspension réversible et motivée** : jamais de suppression sèche d'un compte
   prestataire (traçabilité des litiges).

---

## 10. Découpage proposé

| Étape | Contenu | Livrable vérifiable |
|---|---|---|
| **3a — Socle backend** ✅ **fait** | Migration `20261001200000_providers` (ProviderProfile, ProviderDocument, ProviderEvent, UserStatus), module `providers` (11 routes), rôle retiré de l'inscription, lecture du rôle/statut en base à chaque requête JWT, agences verrouillées (création par dossier, rattachement d'un chauffeur approuvé seulement), seed ADMIN + commandes `providers:list` / `providers:approve` | Un dossier peut être créé, soumis, instruit, approuvé/rejeté/suspendu en HTTP ; le rôle n'est accordé qu'à l'approbation ; `tsc` → 0 erreur |
| **3b — Parcours mobile prestataire** | Wizard 5 étapes, déclaration des pièces, écran « Dossier en cours » avec timeline, gestion NEED_INFO/REJECTED | Sur téléphone : dépôt d'un dossier chauffeur complet et suivi jusqu'à la décision |
| **3c — Console admin** | File d'attente, fiche dossier, validation des pièces, décisions, audit — **dans l'app mobile** (choix retenu) | Un admin valide un dossier de bout en bout depuis son téléphone |
| **3d — Espaces métier + fichiers** | Upload réel des pièces (photos/PDF), agence réelle (branche `GET /agencies/dashboard` + flotte), Artisan (modèle + missions + profil public), Coursier (missions + double OTP), débit des frais d'activation | Chaque prestataire travaille réellement et voit ses gains |
| **3e — Durcissement** | JWT secret obligatoire, OTP limité (6 chiffres, 3 essais), socket authentifié, `.env` et `node_modules/` hors git | Aucun trou de la liste §9 ne subsiste |

3b puis 3c forment un ensemble cohérent (on ne peut pas valider un dossier sans console).
3d et 3e sont indépendants et peuvent être intervertis.

---

## 11. Décisions retenues (1er octobre 2026)

1. **Périmètre du premier lot** : chauffeur + agence. `ARTISAN` et `COURIER` existent déjà
   dans le modèle de données mais le dépôt de dossier est refusé tant que leur espace
   métier n'existe pas (`ENABLED_PROVIDER_TYPES` dans `providers.module.ts`).
2. **Console admin** : dans l'app mobile (rôle ADMIN), pas d'app web séparée pour l'instant.
3. **Pièces justificatives** : le modèle, la checklist et la validation admin sont en place ;
   une pièce se **déclare** (type + date d'expiration) et le **dépôt du fichier** arrive en 3d.
   Conséquence assumée : un dossier peut être soumis avec des pièces manquantes, et
   l'approbation exige alors une dérogation tracée (`overrideDocuments: true`, inscrite au
   journal). C'est ce qui permet d'activer un compte de test aujourd'hui.
4. **Frais d'activation des agences** : le montant de la formule est **enregistré**
   (`Agency.activationFee`, `feePaidAt = null`) mais **pas encore débité** — la décision
   attend le branchement de la passerelle de paiement. À trancher avant la mise en service.
5. **Suspension** : `User.status = BLOCKED` coupe l'accès immédiatement (le rôle et le statut
   sont relus en base à chaque requête authentifiée), sans attendre l'expiration du JWT.
6. **Comptes existants** : les `DRIVER`/`AGENCY`/`ARTISAN` déjà en base sont régularisés par
   la migration (dossier `APPROVED`, score KYC 0) — ils apparaissent dans la console admin
   comme « pièces à fournir ».
